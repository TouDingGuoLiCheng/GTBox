use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig, SupportedStreamConfig};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

const TARGET_SAMPLE_RATE: u32 = 16000;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceInfo {
    pub name: String,
    pub is_default: bool,
}

pub struct AudioCapture {
    stop_flag: Arc<Mutex<bool>>,
    thread: JoinHandle<()>,
}

impl AudioCapture {
    pub fn start(
        device_name: Option<&str>,
        on_chunk: Arc<dyn Fn(Vec<f32>) + Send + Sync>,
        on_level: Arc<dyn Fn(f32) + Send + Sync>,
    ) -> Result<Self, String> {
        let host = cpal::default_host();
        let device = if let Some(name) = device_name.filter(|n| !n.is_empty()) {
            host.input_devices()
                .map_err(|e| e.to_string())?
                .find(|d| d.name().map(|n| n == *name).unwrap_or(false))
                .ok_or_else(|| format!("找不到麦克风: {name}"))?
        } else {
            host.default_input_device()
                .ok_or_else(|| "未找到默认麦克风".to_string())?
        };

        let supported = pick_supported_config(&device)?;
        let sample_format = supported.sample_format();
        let sample_rate = supported.sample_rate().0;
        let stream_config: StreamConfig = supported.config();
        let channels = stream_config.channels as usize;
        let stop_flag = Arc::new(Mutex::new(false));
        let stop_for_thread = stop_flag.clone();
        let (sample_tx, sample_rx) = mpsc::channel::<Vec<f32>>();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();

        let device_name = device.name().unwrap_or_else(|_| "?".to_string());
        crate::debug_log::info(format!(
            "audio device: {device_name} format={sample_format:?} rate={sample_rate} channels={channels}"
        ));

        let err_fn = |e| {
            crate::debug_log::error(format!("audio stream error: {e}"));
        };

        let thread = thread::spawn(move || {
            let stream = match sample_format {
                SampleFormat::F32 => device.build_input_stream(
                    &stream_config,
                    move |data: &[f32], _| {
                        let _ = sample_tx.send(samples_to_mono_f32(data, channels));
                    },
                    err_fn,
                    None,
                ),
                SampleFormat::I16 => device.build_input_stream(
                    &stream_config,
                    move |data: &[i16], _| {
                        let mono: Vec<f32> = data
                            .chunks(channels)
                            .map(|frame| {
                                frame.iter().map(|&s| i16_to_f32(s)).sum::<f32>()
                                    / frame.len().max(1) as f32
                            })
                            .collect();
                        let _ = sample_tx.send(mono);
                    },
                    err_fn,
                    None,
                ),
                SampleFormat::U16 => device.build_input_stream(
                    &stream_config,
                    move |data: &[u16], _| {
                        let mono: Vec<f32> = data
                            .chunks(channels)
                            .map(|frame| {
                                frame
                                    .iter()
                                    .map(|&s| u16_to_f32(s))
                                    .sum::<f32>()
                                    / frame.len().max(1) as f32
                            })
                            .collect();
                        let _ = sample_tx.send(mono);
                    },
                    err_fn,
                    None,
                ),
                other => {
                    let _ = ready_tx.send(Err(format!("不支持的麦克风采样格式: {other:?}")));
                    return;
                }
            };

            let stream = match stream {
                Ok(s) => s,
                Err(e) => {
                    let _ = ready_tx.send(Err(format!("无法打开麦克风: {e}")));
                    return;
                }
            };

            if let Err(e) = stream.play() {
                let _ = ready_tx.send(Err(format!("无法启动麦克风: {e}")));
                return;
            }

            let _ = ready_tx.send(Ok(()));

            let mut pending: Vec<f32> = Vec::new();
            let chunk_samples = (TARGET_SAMPLE_RATE as f32 * 0.18) as usize;

            loop {
                if *stop_for_thread.lock().unwrap() {
                    break;
                }
                while let Ok(samples) = sample_rx.try_recv() {
                    on_level(rms_of(&samples));
                    pending.extend(resample_to_16k(&samples, sample_rate));
                }
                if pending.len() >= chunk_samples {
                    let chunk: Vec<f32> = pending.drain(..chunk_samples).collect();
                    on_chunk(chunk);
                }
                thread::sleep(Duration::from_millis(10));
            }

            if !pending.is_empty() {
                on_chunk(pending);
            }
            drop(stream);
        });

        match ready_rx.recv_timeout(Duration::from_secs(3)) {
            Ok(Ok(())) => {
                crate::debug_log::info("audio capture stream playing");
                Ok(Self { stop_flag, thread })
            }
            Ok(Err(e)) => {
                if let Ok(mut f) = stop_flag.lock() {
                    *f = true;
                }
                let _ = thread.join();
                Err(e)
            }
            Err(RecvTimeoutError::Timeout) => {
                if let Ok(mut f) = stop_flag.lock() {
                    *f = true;
                }
                let _ = thread.join();
                Err("麦克风启动超时".to_string())
            }
            Err(RecvTimeoutError::Disconnected) => {
                if let Ok(mut f) = stop_flag.lock() {
                    *f = true;
                }
                let _ = thread.join();
                Err("麦克风线程异常退出".to_string())
            }
        }
    }

    pub fn stop(self) {
        if let Ok(mut f) = self.stop_flag.lock() {
            *f = true;
        }
        let _ = self.thread.join();
    }
}

/// 当前系统默认输入设备名称（Windows 声音设置里选中的那个）
pub fn default_input_device_name() -> Option<String> {
    cpal::default_host()
        .default_input_device()
        .and_then(|d| d.name().ok())
}

pub fn list_input_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    let host = cpal::default_host();
    let default_name = default_input_device_name();
    let devices = host.input_devices().map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for d in devices {
        let Ok(name) = d.name() else {
            continue;
        };
        if !seen.insert(name.clone()) {
            continue;
        }
        out.push(AudioDeviceInfo {
            is_default: default_name.as_ref() == Some(&name),
            name,
        });
    }
    out.sort_by(|a, b| {
        b.is_default
            .cmp(&a.is_default)
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(out)
}

fn pick_supported_config(device: &cpal::Device) -> Result<SupportedStreamConfig, String> {
    let mut configs = device
        .supported_input_configs()
        .map_err(|e| e.to_string())?
        .collect::<Vec<_>>();
    configs.sort_by_key(|c| {
        let rate = if c.min_sample_rate().0 <= TARGET_SAMPLE_RATE
            && c.max_sample_rate().0 >= TARGET_SAMPLE_RATE
        {
            0
        } else {
            (c.max_sample_rate().0 as i64 - TARGET_SAMPLE_RATE as i64).unsigned_abs()
        };
        let fmt_rank = match c.sample_format() {
            SampleFormat::F32 => 0,
            SampleFormat::I16 => 1,
            SampleFormat::U16 => 2,
            _ => 3,
        };
        (rate, fmt_rank, c.channels())
    });
    let cfg = configs
        .into_iter()
        .next()
        .ok_or_else(|| "设备无可用输入配置".to_string())?;
    let sample_rate = if cfg.min_sample_rate().0 <= TARGET_SAMPLE_RATE
        && cfg.max_sample_rate().0 >= TARGET_SAMPLE_RATE
    {
        cpal::SampleRate(TARGET_SAMPLE_RATE)
    } else {
        cfg.max_sample_rate()
    };
    Ok(cfg.with_sample_rate(sample_rate))
}

fn samples_to_mono_f32(data: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return data.to_vec();
    }
    data.chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect()
}

fn i16_to_f32(sample: i16) -> f32 {
    sample as f32 / i16::MAX as f32
}

fn u16_to_f32(sample: u16) -> f32 {
    (sample as f32 - 32768.0) / 32768.0
}

fn resample_to_16k(input: &[f32], from_rate: u32) -> Vec<f32> {
    if from_rate == TARGET_SAMPLE_RATE || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from_rate as f64 / TARGET_SAMPLE_RATE as f64;
    let out_len = ((input.len() as f64) / ratio).ceil() as usize;
    let mut out = Vec::with_capacity(out_len.max(1));
    for i in 0..out_len {
        let src = i as f64 * ratio;
        let idx = src.floor() as usize;
        let frac = (src - idx as f64) as f32;
        let a = input.get(idx).copied().unwrap_or(0.0);
        let b = input.get(idx + 1).copied().unwrap_or(a);
        out.push(a * (1.0 - frac) + b * frac);
    }
    out
}

fn rms_of(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
}
