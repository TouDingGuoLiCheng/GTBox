use futures_util::{SinkExt, StreamExt};
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::Serialize;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::{mpsc, oneshot, Mutex as AsyncMutex};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::accept_async;

const SERVICE_TYPE: &str = "_gomoku._tcp.local.";
const DEFAULT_PORT: u16 = 8765;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanHostInfo {
    pub room_id: String,
    pub port: u16,
    pub addresses: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredRoom {
    pub room_id: String,
    pub host: String,
    pub port: u16,
    pub nickname: String,
}

struct PeerSlots {
    host_tx: AsyncMutex<Option<mpsc::UnboundedSender<String>>>,
    guest_tx: AsyncMutex<Option<mpsc::UnboundedSender<String>>>,
}

impl PeerSlots {
    fn new() -> Self {
        Self {
            host_tx: AsyncMutex::new(None),
            guest_tx: AsyncMutex::new(None),
        }
    }

    async fn register(
        &self,
        role: &str,
        tx: mpsc::UnboundedSender<String>,
    ) -> Result<(), &'static str> {
        match role {
            "host" => {
                let mut slot = self.host_tx.lock().await;
                if slot.is_some() {
                    return Err("host slot taken");
                }
                *slot = Some(tx);
                Ok(())
            }
            "guest" => {
                let mut slot = self.guest_tx.lock().await;
                if slot.is_some() {
                    return Err("guest slot taken");
                }
                *slot = Some(tx);
                Ok(())
            }
            _ => Err("invalid role"),
        }
    }

    async fn unregister(&self, role: &str) {
        match role {
            "host" => *self.host_tx.lock().await = None,
            "guest" => *self.guest_tx.lock().await = None,
            _ => {}
        }
    }

    async fn forward(&self, from_role: &str, payload: String) {
        match from_role {
            "host" => {
                if let Some(tx) = self.guest_tx.lock().await.as_ref() {
                    let _ = tx.send(payload);
                }
            }
            "guest" => {
                if let Some(tx) = self.host_tx.lock().await.as_ref() {
                    let _ = tx.send(payload);
                }
            }
            _ => {}
        }
    }

    async fn notify_peer_left(&self, from_role: &str, msg: &str) {
        let target = if from_role == "host" {
            &self.guest_tx
        } else {
            &self.host_tx
        };
        if let Some(tx) = target.lock().await.as_ref() {
            let _ = tx.send(msg.to_string());
        }
    }
}

struct LanServerInner {
  room_id: String,
  port: u16,
  nickname: String,
  shutdown_tx: oneshot::Sender<()>,
  mdns_daemon: Option<ServiceDaemon>,
}

struct LanServerState {
    inner: Option<LanServerInner>,
}

static LAN_STATE: LazyLock<Mutex<LanServerState>> =
    LazyLock::new(|| Mutex::new(LanServerState { inner: None }));

fn collect_ipv4_addresses() -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(ifaces) = if_addrs::get_if_addrs() {
        for iface in ifaces {
            if iface.is_loopback() {
                continue;
            }
            if let std::net::IpAddr::V4(ip) = iface.ip() {
                out.push(ip.to_string());
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

fn parse_hello_role(text: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    if value.get("type")?.as_str()? != "hello" {
        return None;
    }
    value.get("role")?.as_str().map(str::to_string)
}

fn find_available_port(preferred: u16) -> Result<u16, String> {
    for port in preferred..preferred.saturating_add(20) {
        if std::net::TcpListener::bind(("0.0.0.0", port)).is_ok() {
            return Ok(port);
        }
    }
    Err(format!("端口 {preferred} 起连续 20 个端口均被占用"))
}

async fn handle_connection(
    stream: tokio::net::TcpStream,
    addr: SocketAddr,
    peers: Arc<PeerSlots>,
    running: Arc<AtomicBool>,
) {
    let ws_stream = match accept_async(stream).await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[gomoku_lan] handshake failed from {addr}: {e}");
            return;
        }
    };

    let (mut ws_tx, mut ws_rx) = ws_stream.split();
    let first = match ws_rx.next().await {
        Some(Ok(Message::Text(t))) => t,
        _ => return,
    };

    let role = match parse_hello_role(&first) {
        Some(r) if r == "host" || r == "guest" => r,
        _ => {
            let _ = ws_tx
                .send(Message::Text(
                    r#"{"version":1,"type":"error","message":"首条消息须为 hello"}"#.into(),
                ))
                .await;
            let _ = ws_tx.close().await;
            return;
        }
    };

    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
    if peers.register(&role, out_tx).await.is_err() {
        let _ = ws_tx
            .send(Message::Text(
                r#"{"version":1,"type":"error","message":"房间已满或角色已被占用"}"#.into(),
            ))
            .await;
        let _ = ws_tx.close().await;
        return;
    }

    if role == "guest" {
        if let Some(tx) = peers.host_tx.lock().await.as_ref() {
            let _ = tx.send(first.clone());
        }
    } else if role == "host" {
        if let Some(tx) = peers.guest_tx.lock().await.as_ref() {
            let _ = tx.send(first.clone());
        }
    }

    let role_owned = role.clone();
    let peers_send = peers.clone();
    let running_forward = running.clone();
    let forward_task = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            if !running_forward.load(Ordering::Relaxed) {
                break;
            }
            if ws_tx.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
    });

    while running.load(Ordering::Relaxed) {
        match ws_rx.next().await {
            Some(Ok(Message::Text(text))) => {
                peers_send.forward(&role_owned, text).await;
            }
            Some(Ok(Message::Close(_))) | None => break,
            Some(Err(_)) => break,
            _ => {}
        }
    }

    peers.unregister(&role_owned).await;
    let peer_left = r#"{"version":1,"type":"peer_left"}"#;
    peers.notify_peer_left(&role_owned, peer_left).await;
    forward_task.abort();
}

async fn run_server(port: u16, mut shutdown: oneshot::Receiver<()>) -> Result<(), String> {
    let listener = TcpListener::bind(("0.0.0.0", port))
        .await
        .map_err(|e| format!("绑定端口 {port} 失败: {e}"))?;
    let peers = Arc::new(PeerSlots::new());
    let running = Arc::new(AtomicBool::new(true));

    loop {
        tokio::select! {
            _ = &mut shutdown => {
                running.store(false, Ordering::Relaxed);
                break;
            }
            accept = listener.accept() => {
                match accept {
                    Ok((stream, addr)) => {
                        let peers = peers.clone();
                        let running = running.clone();
                        tokio::spawn(handle_connection(stream, addr, peers, running));
                    }
                    Err(e) => eprintln!("[gomoku_lan] accept error: {e}"),
                }
            }
        }
    }
    Ok(())
}

fn register_mdns(
    room_id: &str,
    port: u16,
    nickname: &str,
) -> Result<ServiceDaemon, String> {
    let daemon = ServiceDaemon::new().map_err(|e| format!("mDNS 初始化失败: {e}"))?;
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "gomoku-host".to_string());
    let service_hostname = format!("{hostname}.local.");
    let props = [("nickname", nickname), ("roomId", room_id)];
    let service = ServiceInfo::new(
        SERVICE_TYPE,
        room_id,
        &service_hostname,
        "",
        port,
        &props[..],
    )
    .map_err(|e| format!("mDNS 服务信息无效: {e}"))?
    .enable_addr_auto();
    daemon
        .register(service)
        .map_err(|e| format!("mDNS 注册失败: {e}"))?;
    Ok(daemon)
}

pub fn stop_lan_host() -> Result<(), String> {
    let mut state = LAN_STATE
        .lock()
        .map_err(|_| String::from("联机服务状态锁异常"))?;
    if let Some(inner) = state.inner.take() {
        let _ = inner.shutdown_tx.send(());
        if let Some(daemon) = inner.mdns_daemon {
            let _ = daemon.shutdown();
        }
    }
    Ok(())
}

pub fn lan_host_status() -> Option<LanHostInfo> {
    let state = LAN_STATE.lock().ok()?;
    let inner = state.inner.as_ref()?;
    Some(LanHostInfo {
        room_id: inner.room_id.clone(),
        port: inner.port,
        addresses: collect_ipv4_addresses(),
    })
}

pub async fn start_lan_host(
    port: Option<u16>,
    nickname: String,
) -> Result<LanHostInfo, String> {
    stop_lan_host()?;

    let preferred = port.unwrap_or(DEFAULT_PORT);
    let bound_port = find_available_port(preferred)?;
    let room_id: String = (1000 + (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        % 9000) as u32)
        .to_string();

    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let mdns_daemon = register_mdns(&room_id, bound_port, &nickname).ok();

    tokio::spawn(async move {
        if let Err(e) = run_server(bound_port, shutdown_rx).await {
            eprintln!("[gomoku_lan] server stopped: {e}");
        }
    });

    let info = LanHostInfo {
        room_id: room_id.clone(),
        port: bound_port,
        addresses: collect_ipv4_addresses(),
    };

    let mut state = LAN_STATE
        .lock()
        .map_err(|_| String::from("联机服务状态锁异常"))?;
    state.inner = Some(LanServerInner {
        room_id,
        port: bound_port,
        nickname,
        shutdown_tx,
        mdns_daemon,
    });

    Ok(info)
}

pub async fn discover_rooms(timeout_ms: Option<u64>) -> Result<Vec<DiscoveredRoom>, String> {
    let wait = timeout_ms.unwrap_or(2500);
    tauri::async_runtime::spawn_blocking(move || discover_rooms_sync(wait))
        .await
        .map_err(|e| format!("mDNS 浏览任务失败: {e}"))?
}

fn discover_rooms_sync(timeout_ms: u64) -> Result<Vec<DiscoveredRoom>, String> {
    let daemon = ServiceDaemon::new().map_err(|e| format!("mDNS 浏览失败: {e}"))?;
    let receiver = daemon
        .browse(SERVICE_TYPE)
        .map_err(|e| format!("mDNS 浏览启动失败: {e}"))?;

    let deadline = std::time::Instant::now() + Duration::from_millis(timeout_ms);
    let mut rooms: HashMap<String, DiscoveredRoom> = HashMap::new();

    while std::time::Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        match receiver.recv_timeout(remaining) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                let room_id = info
                    .get_property_val_str("roomId")
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
                    .unwrap_or_else(|| info.get_fullname().to_string());
                let nickname = info
                    .get_property_val_str("nickname")
                    .unwrap_or("未知房主")
                    .to_string();
                let host = info
                    .get_addresses()
                    .iter()
                    .find_map(|ip| {
                        if let std::net::IpAddr::V4(v4) = ip {
                            Some(v4.to_string())
                        } else {
                            None
                        }
                    })
                    .unwrap_or_else(|| info.get_hostname().to_string());
                let port = info.get_port();
                rooms.insert(
                    room_id.clone(),
                    DiscoveredRoom {
                        room_id,
                        host,
                        port,
                        nickname,
                    },
                );
            }
            Ok(ServiceEvent::ServiceRemoved(_ty, fullname)) => {
                rooms.retain(|_, r| !fullname.contains(&r.room_id));
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }

    let _ = daemon.shutdown();
    let mut list: Vec<_> = rooms.into_values().collect();
    list.sort_by(|a, b| a.nickname.cmp(&b.nickname));
    Ok(list)
}

#[tauri::command]
pub async fn gomoku_lan_start(
    port: Option<u16>,
    nickname: String,
) -> Result<LanHostInfo, String> {
    start_lan_host(port, nickname).await
}

#[tauri::command]
pub fn gomoku_lan_stop() -> Result<(), String> {
    stop_lan_host()
}

#[tauri::command]
pub fn gomoku_lan_status() -> Option<LanHostInfo> {
    lan_host_status()
}

#[tauri::command]
pub async fn gomoku_lan_discover(timeout_ms: Option<u64>) -> Result<Vec<DiscoveredRoom>, String> {
    discover_rooms(timeout_ms).await
}
