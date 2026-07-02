import type { LanMessage, LanRole } from "../../types/gomokuLan";
import { parseLanMessage, serializeLanMessage } from "./lanProtocol";

export type LanWsStatus = "connecting" | "open" | "closed" | "error";

export interface LanWsCallbacks {
  onMessage: (msg: LanMessage) => void;
  onStatus: (status: LanWsStatus, detail?: string) => void;
}

export class GomokuLanClient {
  private ws: WebSocket | null = null;

  connect(url: string, callbacks: LanWsCallbacks) {
    this.disconnect();
    callbacks.onStatus("connecting");
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => callbacks.onStatus("open");
    ws.onerror = () => callbacks.onStatus("error", "连接失败");
    ws.onclose = () => callbacks.onStatus("closed");
    ws.onmessage = (event) => {
      const msg = parseLanMessage(String(event.data));
      if (msg) callbacks.onMessage(msg);
    };
  }

  sendHello(role: LanRole, nickname: string, reconnectToken?: string) {
    const msg: LanMessage = {
      version: 1,
      type: "hello",
      role,
      nickname,
      reconnectToken,
    };
    this.send(msg);
  }

  send(msg: LanMessage) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(serializeLanMessage(msg));
  }

  sendRaw(raw: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(raw);
  }

  disconnect() {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  get isOpen() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
