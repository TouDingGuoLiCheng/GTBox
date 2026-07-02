import type { LanMessage } from "../../types/gomokuLan";
import { LAN_PROTOCOL_VERSION } from "../../types/gomokuLan";

export function parseLanMessage(raw: string): LanMessage | null {
  try {
    const data = JSON.parse(raw) as LanMessage;
    if (data.version !== LAN_PROTOCOL_VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

export function serializeLanMessage(msg: LanMessage): string {
  return JSON.stringify({ ...msg, version: LAN_PROTOCOL_VERSION });
}

export function buildWsUrl(host: string, port: number): string {
  const trimmed = host.trim();
  const withScheme = trimmed.startsWith("ws://") || trimmed.startsWith("wss://");
  const base = withScheme ? trimmed : `ws://${trimmed}`;
  if (base.includes(":") && base.match(/:\d+$/)) {
    return base;
  }
  return `${base.replace(/\/$/, "")}:${port}`;
}
