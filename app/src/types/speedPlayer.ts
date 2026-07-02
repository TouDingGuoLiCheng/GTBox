export type SpeedPlayerSiteId = "bilibili";

export interface SpeedPlayerSite {
  id: SpeedPlayerSiteId;
  name: string;
  description: string;
  icon: string;
  homeUrl: string;
}

export const SPEED_PLAYER_SITES: SpeedPlayerSite[] = [
  {
    id: "bilibili",
    name: "哔哩哔哩",
    description: "跟弹教学视频，自由倍速与 AB 循环",
    icon: "simple-icons:bilibili",
    homeUrl: "https://www.bilibili.com/",
  },
];

export type SpeedPlayerPhase = "picker" | "site";

export interface SpeedMarker {
  time: number;
  label: string;
}

export interface SpeedPlayerDiagnostics {
  videoId: string | null;
  targetRate: number;
  actualRate: number | null;
  hasVideo: boolean;
  drift: boolean;
  rateCorrections?: number;
  href?: string;
  injected: boolean;
  error?: string;
}

export type SpeedPlayerAction =
  | "rate-dec"
  | "rate-inc"
  | "set-a"
  | "set-b"
  | "toggle-ab"
  | "clear-ab"
  | "add-marker";
