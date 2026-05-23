<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    theme?: "dark" | "light";
    intensity?: number;
    starTrails?: boolean;
    showFlares?: boolean;
    showMeteors?: boolean;
  }>(),
  {
    theme: "dark",
    intensity: 60,
    starTrails: true,
    showFlares: true,
    showMeteors: false,
  },
);

const canvasRef = ref<HTMLCanvasElement | null>(null);

type StarKind = "white" | "cool" | "warm" | "gold" | "cyan";

interface TrailPoint {
  x: number;
  y: number;
}

/** 绕共同极点（地轴视角）匀速公转，半径各异 */
interface Star {
  orbitR: number;
  angle: number;
  x: number;
  y: number;
  trail: TrailPoint[];
  radius: number;
  phase: number;
  twinkleSpeed: number;
  kind: StarKind;
  /** 1=普通星；<0.5 为背景暗星 */
  brightness: number;
}

const KIND_WEIGHTS: { kind: StarKind; w: number }[] = [
  { kind: "white", w: 0.44 },
  { kind: "cool", w: 0.34 },
  { kind: "cyan", w: 0.14 },
  { kind: "warm", w: 0.04 },
  { kind: "gold", w: 0.04 },
];

interface Flare {
  x: number;
  y: number;
  bornAt: number;
  duration: number;
  scale: number;
  warm: boolean;
  twinkleFreq: number;
}

/** 流星尾迹：白色虚线状微粒，停留 0.5s 后消失 */
interface MeteorDebris {
  x: number;
  y: number;
  bornAt: number;
  angle: number;
}

interface Meteor {
  bornAt: number;
  duration: number;
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  dirAngle: number;
  trail: TrailPoint[];
  warm: boolean;
  lastDebrisX: number;
  lastDebrisY: number;
}

const METEOR_DEBRIS_TTL_MS = 500;
const METEOR_DEBRIS_SPACING_PX = 11;

let raf = 0;
let stars: Star[] = [];
let flares: Flare[] = [];
let meteors: Meteor[] = [];
let meteorDebris: MeteorDebris[] = [];
let viewW = 0;
let viewH = 0;
let lastFrameTime = 0;
let poleX = 0;
let poleY = 0;
let omega = 0;

function intensityT() {
  return props.intensity / 100;
}

function pickKind(): StarKind {
  const r = Math.random();
  let acc = 0;
  for (const { kind, w } of KIND_WEIGHTS) {
    acc += w;
    if (r <= acc) return kind;
  }
  return "white";
}

function mainStarCount() {
  const t = intensityT();
  const base = viewW * viewH * 0.00011;
  return Math.floor(base * (0.7 + t * 1.1));
}

function dimStarCount() {
  const t = intensityT();
  const base = viewW * viewH * 0.00042;
  return Math.floor(base * (0.85 + t * 0.65));
}

/** 轨迹点最小间距（px），保证慢速公转也能看见弧线 */
const TRAIL_STEP_PX = 2;

/** 绘制星轨时单条折线最多段数 */
const MAX_TRAIL_SEGMENTS = 56;

/** 离开可视区后在此边距外重生（避免公转后边角长期缺星） */
const RESPAWN_OUT_MARGIN = 36;

const canvasContextOptions: CanvasRenderingContext2DSettings = {
  desynchronized: true,
};

function pushTrailAlongArc(s: Star, fromAngle: number, toAngle: number) {
  const dAngle = toAngle - fromAngle;
  const arcLen = Math.abs(dAngle * s.orbitR);
  const steps = Math.max(1, Math.ceil(arcLen / TRAIL_STEP_PX));
  for (let k = 1; k <= steps; k++) {
    const a = fromAngle + (dAngle * k) / steps;
    s.trail.push({
      x: poleX + s.orbitR * Math.cos(a),
      y: poleY + s.orbitR * Math.sin(a),
    });
  }
}

function updatePoleAndOmega() {
  poleX = viewW * 0.58;
  poleY = viewH * 0.46;
  const t = intensityT();
  omega = -(0.0022 + t * 0.0016);
}

function createStar(
  x0: number,
  y0: number,
  isLight: boolean,
  dim = false,
): Star {
  const depth = dim ? 0.15 + Math.random() * 0.35 : 0.25 + Math.random() * 0.75;
  const kind = pickKind();
  const isWarm = kind === "warm" || kind === "gold";
  const sizeBoost = isLight ? 1.12 : 1;

  let orbitR = Math.hypot(x0 - poleX, y0 - poleY);
  if (orbitR < 12) orbitR = 12 + Math.random() * 40;
  const angle = Math.atan2(y0 - poleY, x0 - poleX);

  return {
    orbitR,
    angle,
    x: x0,
    y: y0,
    trail: [{ x: x0, y: y0 }],
    radius: dim
      ? 0.28 + Math.random() * 0.42
      : Math.random() < 0.05
        ? (0.55 + Math.random() * (isWarm ? 1.2 : 1.0)) *
          (0.7 + depth * 0.4) *
          sizeBoost
        : (0.28 + Math.random() * 0.4) * sizeBoost,
    phase: Math.random() * Math.PI * 2,
    twinkleSpeed: dim ? 0.25 + Math.random() * 0.45 : 0.5 + Math.random() * 1.2,
    kind,
    brightness: dim ? 0.32 + Math.random() * 0.28 : 1,
  };
}

function randomSpawnPoint(): { x0: number; y0: number } {
  return { x0: Math.random() * viewW, y0: Math.random() * viewH };
}

/** 与极点公转圆相交后，四角空白三角区在每条边上的跨度（像素） */
function computeCornerVoidSpans() {
  const cx = poleX;
  const cy = poleY;
  const rCover =
    Math.min(
      Math.hypot(cx, cy),
      Math.hypot(viewW - cx, cy),
      Math.hypot(cx, viewH - cy),
      Math.hypot(viewW - cx, viewH - cy),
    ) * 0.92;

  const xTopLeft = cx - Math.sqrt(Math.max(0, rCover * rCover - cy * cy));
  const xTopRight = cx + Math.sqrt(Math.max(0, rCover * rCover - cy * cy));
  const yLeftTop = cy - Math.sqrt(Math.max(0, rCover * rCover - cx * cx));
  const yLeftBottom = cy + Math.sqrt(Math.max(0, rCover * rCover - cx * cx));

  const yBottom = viewH - cy;
  const xBottomLeft = cx - Math.sqrt(Math.max(0, rCover * rCover - yBottom * yBottom));
  const xBottomRight = cx + Math.sqrt(Math.max(0, rCover * rCover - yBottom * yBottom));

  const xRight = viewW - cx;
  const yRightTop = cy - Math.sqrt(Math.max(0, rCover * rCover - xRight * xRight));
  const yRightBottom = cy + Math.sqrt(Math.max(0, rCover * rCover - xRight * xRight));

  return {
    tl: { alongTop: Math.max(24, xTopLeft), alongLeft: Math.max(24, yLeftTop) },
    tr: {
      alongTop: Math.max(24, viewW - xTopRight),
      alongRight: Math.max(24, yRightTop),
    },
    bl: {
      alongBottom: Math.max(24, xBottomLeft),
      alongLeft: Math.max(24, viewH - yLeftBottom),
    },
    br: {
      alongBottom: Math.max(24, viewW - xBottomRight),
      alongRight: Math.max(24, viewH - yRightBottom),
    },
  };
}

function exteriorOutOffset() {
  const minOut = 8;
  const maxOut = RESPAWN_OUT_MARGIN - 4;
  return minOut + Math.random() * (maxOut - minOut);
}

/**
 * 补星：在四角空白三角区对应的两条边外侧略出屏（L 形 + 角尖），再公转进入画面
 */
function randomCornerOutsideSpawnPoint(): { x0: number; y0: number } {
  if (viewW < 80 || viewH < 80) {
    const o = exteriorOutOffset();
    return { x0: -o, y0: -o };
  }

  const spans = computeCornerVoidSpans();
  const out = exteriorOutOffset();
  const corner = Math.floor(Math.random() * 4);
  const roll = Math.random();

  switch (corner) {
    case 0: {
      const { alongTop, alongLeft } = spans.tl;
      if (roll < 0.28) return { x0: -out, y0: -out };
      if (roll < 0.62) {
        return { x0: Math.random() * alongTop, y0: -out };
      }
      return { x0: -out, y0: Math.random() * alongLeft };
    }
    case 1: {
      const { alongTop, alongRight } = spans.tr;
      if (roll < 0.28) return { x0: viewW + out, y0: -out };
      if (roll < 0.62) {
        return { x0: viewW - Math.random() * alongTop, y0: -out };
      }
      return { x0: viewW + out, y0: Math.random() * alongRight };
    }
    case 2: {
      const { alongBottom, alongLeft } = spans.bl;
      if (roll < 0.28) return { x0: -out, y0: viewH + out };
      if (roll < 0.62) {
        return { x0: Math.random() * alongBottom, y0: viewH + out };
      }
      return { x0: -out, y0: viewH - Math.random() * alongLeft };
    }
    default: {
      const { alongBottom, alongRight } = spans.br;
      if (roll < 0.28) return { x0: viewW + out, y0: viewH + out };
      if (roll < 0.62) {
        return { x0: viewW - Math.random() * alongBottom, y0: viewH + out };
      }
      return { x0: viewW + out, y0: viewH - Math.random() * alongRight };
    }
  }
}

/** 飞出屏幕后在四角外侧补生，再公转进入画面 */
function respawnStar(s: Star, isLight: boolean) {
  const dim = s.brightness < 0.5;
  const { x0, y0 } = randomCornerOutsideSpawnPoint();
  const fresh = createStar(x0, y0, isLight, dim);
  s.orbitR = fresh.orbitR;
  s.angle = fresh.angle;
  s.x = fresh.x;
  s.y = fresh.y;
  s.trail = fresh.trail;
  s.radius = fresh.radius;
  s.phase = fresh.phase;
  s.twinkleSpeed = fresh.twinkleSpeed;
  s.kind = fresh.kind;
  s.brightness = fresh.brightness;
}

function advanceStar(s: Star, dt: number, isLight: boolean) {
  const fromAngle = s.angle;
  const dAngle = omega * dt;
  s.angle += dAngle;
  s.x = poleX + s.orbitR * Math.cos(s.angle);
  s.y = poleY + s.orbitR * Math.sin(s.angle);
  s.phase += s.twinkleSpeed * dt;

  if (props.starTrails) {
    pushTrailAlongArc(s, fromAngle, s.angle);
  }

  if (
    s.x < -RESPAWN_OUT_MARGIN ||
    s.x > viewW + RESPAWN_OUT_MARGIN ||
    s.y < -RESPAWN_OUT_MARGIN ||
    s.y > viewH + RESPAWN_OUT_MARGIN
  ) {
    respawnStar(s, isLight);
  }
}

function initStars() {
  updatePoleAndOmega();
  const isLight = props.theme === "light";
  const mainCount = Math.max(55, Math.min(420, mainStarCount()));
  const faintCount = Math.max(120, Math.min(2800, dimStarCount()));
  stars = [
    ...Array.from({ length: mainCount }, () => {
      const { x0, y0 } = randomSpawnPoint();
      return createStar(x0, y0, isLight, false);
    }),
    ...Array.from({ length: faintCount }, () => {
      const { x0, y0 } = randomSpawnPoint();
      return createStar(x0, y0, isLight, true);
    }),
  ];
  flares = [];
  meteors = [];
  meteorDebris = [];
}

/** 射线与扩展视口矩形求交，得到屏外起点与屏外终点 */
function clipRayToOuterRect(
  px: number,
  py: number,
  dx: number,
  dy: number,
  w: number,
  h: number,
  pad: number,
): { sx: number; sy: number; ex: number; ey: number } | null {
  const xmin = -pad;
  const xmax = w + pad;
  const ymin = -pad;
  const ymax = h + pad;
  const ts: number[] = [];
  if (Math.abs(dx) > 1e-9) {
    ts.push((xmin - px) / dx, (xmax - px) / dx);
  }
  if (Math.abs(dy) > 1e-9) {
    ts.push((ymin - py) / dy, (ymax - py) / dy);
  }
  const hits: number[] = [];
  for (const t of ts) {
    const x = px + dx * t;
    const y = py + dy * t;
    if (x >= xmin - 0.5 && x <= xmax + 0.5 && y >= ymin - 0.5 && y <= ymax + 0.5) {
      hits.push(t);
    }
  }
  if (hits.length < 2) return null;
  hits.sort((a, b) => a - b);
  const t0 = hits[0];
  const t1 = hits[hits.length - 1];
  return {
    sx: px + dx * t0,
    sy: py + dy * t0,
    ex: px + dx * t1,
    ey: py + dy * t1,
  };
}

function meteorPoint(m: Meteor, u: number): TrailPoint {
  return {
    x: m.sx + (m.ex - m.sx) * u,
    y: m.sy + (m.ey - m.sy) * u,
  };
}

function isInsideView(x: number, y: number, margin = 0) {
  return x >= margin && x <= viewW - margin && y >= margin && y <= viewH - margin;
}

function createMeteor(): Meteor {
  const pad = 110;
  const w = viewW;
  const h = viewH;
  const minLen = Math.hypot(w, h) * 0.55;

  for (let attempt = 0; attempt < 16; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const px = w * (0.05 + Math.random() * 0.9);
    const py = h * (0.05 + Math.random() * 0.9);
    const seg = clipRayToOuterRect(px, py, dx, dy, w, h, pad);
    if (!seg) continue;

    const len = Math.hypot(seg.ex - seg.sx, seg.ey - seg.sy);
    if (len < minLen) continue;

    return {
      bornAt: performance.now(),
      duration: 320 + (len / Math.min(w, h)) * 220 + Math.random() * 180,
      sx: seg.sx,
      sy: seg.sy,
      ex: seg.ex,
      ey: seg.ey,
      dirAngle: angle,
      trail: [],
      warm: Math.random() < 0.32,
      lastDebrisX: seg.sx,
      lastDebrisY: seg.sy,
    };
  }

  const angle = Math.random() * Math.PI * 2;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const cx = w * 0.5;
  const cy = h * 0.5;
  const half = Math.hypot(w, h) * 0.65;
  return {
    bornAt: performance.now(),
    duration: 520 + Math.random() * 200,
    sx: cx - dx * half,
    sy: cy - dy * half,
    ex: cx + dx * half,
    ey: cy + dy * half,
    dirAngle: angle,
    trail: [],
    warm: false,
    lastDebrisX: cx - dx * half,
    lastDebrisY: cy - dy * half,
  };
}

function pushMeteorDebris(x: number, y: number, angle: number, now: number) {
  meteorDebris.push({
    x: x + (Math.random() - 0.5) * 2,
    y: y + (Math.random() - 0.5) * 2,
    bornAt: now,
    angle: angle + (Math.random() - 0.5) * 0.15,
  });
}

function advanceMeteor(m: Meteor, now: number): boolean {
  const age = now - m.bornAt;
  const p = age / m.duration;
  if (p >= 1) return false;

  const prevU = Math.max(0, p - 0.03);
  const curr = meteorPoint(m, p);
  const prev = meteorPoint(m, prevU);

  const segLen = Math.hypot(curr.x - prev.x, curr.y - prev.y);
  if (segLen >= 2) {
    m.trail.push(curr);
  }
  if (m.trail.length > 40) {
    m.trail.splice(0, m.trail.length - 40);
  }

  const debrisDist = Math.hypot(curr.x - m.lastDebrisX, curr.y - m.lastDebrisY);
  const onPathVisible =
    isInsideView(curr.x, curr.y, -30) ||
    isInsideView(prev.x, prev.y, -30) ||
    segmentCrossesView(prev, curr);

  if (onPathVisible && debrisDist >= METEOR_DEBRIS_SPACING_PX) {
    pushMeteorDebris(curr.x, curr.y, m.dirAngle, now);
    m.lastDebrisX = curr.x;
    m.lastDebrisY = curr.y;
  }

  return true;
}

function segmentCrossesView(a: TrailPoint, b: TrailPoint) {
  return (
    isInsideView(a.x, a.y, 0) ||
    isInsideView(b.x, b.y, 0) ||
    isInsideView((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, 0)
  );
}

function drawMeteorDebris(ctx: CanvasRenderingContext2D, now: number, isLight: boolean) {
  meteorDebris = meteorDebris.filter((d) => now - d.bornAt < METEOR_DEBRIS_TTL_MS);
  for (const d of meteorDebris) {
    const age = now - d.bornAt;
    const life = 1 - age / METEOR_DEBRIS_TTL_MS;
    if (life <= 0) continue;
    const alpha = life * (isLight ? 0.7 : 0.95);
    const dashLen = 2 + life * 4;

    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(d.angle);
    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.lineWidth = 0.85;
    ctx.lineCap = "round";
    ctx.setLineDash([dashLen * 0.55, dashLen * 0.4]);
    ctx.beginPath();
    ctx.moveTo(-dashLen * 0.55, 0);
    ctx.lineTo(dashLen * 0.55, 0);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

function meteorRgb(warm: boolean, isLight: boolean): [number, number, number] {
  if (warm) return isLight ? [251, 191, 36] : [255, 215, 165];
  return isLight ? [186, 198, 220] : [210, 228, 255];
}

function drawMeteor(ctx: CanvasRenderingContext2D, m: Meteor, now: number, isLight: boolean) {
  const age = now - m.bornAt;
  const p = Math.min(1, age / m.duration);
  const head = meteorPoint(m, p);

  if (!isInsideView(head.x, head.y, -80)) return;

  const tailFade =
    age > m.duration * 0.55
      ? Math.max(0, 1 - (age - m.duration * 0.55) / (m.duration * 0.45))
      : 1;
  const [r, g, b] = meteorRgb(m.warm, isLight);

  if (m.trail.length >= 2) {
    const pts = m.trail;
    const last = pts.length - 1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1];
      const p1 = pts[i];
      if (!p0 || !p1) continue;
      if (!isInsideView(p0.x, p0.y, -60) && !isInsideView(p1.x, p1.y, -60)) continue;
      const frac = i / last;
      const alpha = frac * frac * 0.75 * tailFade;
      if (alpha < 0.02) continue;
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      ctx.lineWidth = 0.7 + frac * 2;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
  }

  const headAlpha = 0.92 * tailFade;
  ctx.fillStyle = `rgba(255, 255, 255, ${headAlpha})`;
  ctx.beginPath();
  ctx.arc(head.x, head.y, 2.2, 0, Math.PI * 2);
  ctx.fill();
  if (!isLight) {
    ctx.shadowBlur = 5 * tailFade;
    ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${headAlpha * 0.55})`;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

function trySpawnMeteor() {
  if (!props.showMeteors) return;
  const t = intensityT();
  const cap = Math.floor(1 + t * 1.5);
  if (meteors.length >= cap) return;
  if (Math.random() > 0.00028 + t * 0.0005) return;
  meteors.push(createMeteor());
}

function colorForKind(kind: StarKind, alpha: number, isLight: boolean): string {
  const a = Math.min(1, alpha);
  if (isLight) {
    switch (kind) {
      case "warm":
        return `rgba(251, 191, 36, ${a * 0.85})`;
      case "gold":
        return `rgba(245, 158, 11, ${a * 0.8})`;
      case "cyan":
        return `rgba(14, 116, 144, ${a * 0.75})`;
      case "cool":
        return `rgba(148, 163, 184, ${a})`;
      default:
        return `rgba(71, 85, 105, ${a})`;
    }
  }
  switch (kind) {
    case "warm":
      return `rgba(255, 220, 170, ${a * 0.9})`;
    case "gold":
      return `rgba(255, 200, 120, ${a * 0.85})`;
    case "cyan":
      return `rgba(180, 230, 255, ${a * 0.8})`;
    case "cool":
      return `rgba(230, 240, 255, ${a})`;
    default:
      return `rgba(255, 255, 255, ${a})`;
  }
}

function baseAlpha(twinkle: number, t: number, isLight: boolean, kind: StarKind) {
  const isWarm = kind === "warm" || kind === "gold";
  if (isLight) {
    const floor = isWarm ? 0.38 : 0.34;
    const ceil = isWarm ? 0.82 : 0.8;
    return (floor + t * (ceil - floor)) * twinkle;
  }
  const floor = isWarm ? 0.28 : 0.24;
  const ceil = isWarm ? 0.88 : 0.9;
  return (floor + t * (ceil - floor)) * twinkle;
}

function sampleTrailForDraw(trail: TrailPoint[], headX: number, headY: number): TrailPoint[] {
  const path: TrailPoint[] = [...trail, { x: headX, y: headY }];
  const maxPoints = MAX_TRAIL_SEGMENTS + 1;
  if (path.length <= maxPoints) return path;

  const sampled: TrailPoint[] = [];
  const last = path.length - 1;
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round((i * last) / (maxPoints - 1));
    const p = path[idx];
    if (p) sampled.push(p);
  }
  return sampled;
}

function drawStarTrail(
  ctx: CanvasRenderingContext2D,
  s: Star,
  headAlpha: number,
  isLight: boolean,
) {
  if (s.trail.length < 1) return;

  const a = headAlpha * 0.9 * s.brightness;
  if (a < 0.02) return;

  const drawPoints = sampleTrailForDraw(s.trail, s.x, s.y);
  const first = drawPoints[0];
  if (!first || drawPoints.length < 2) return;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < drawPoints.length; i++) {
    const p = drawPoints[i];
    if (p) ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = colorForKind(s.kind, a, isLight);
  ctx.lineWidth = s.radius * 2;
  ctx.stroke();
}

function drawStar(ctx: CanvasRenderingContext2D, s: Star, t: number, isLight: boolean) {
  const twinkleAmp = s.brightness < 0.5 ? 0.08 : 0.22;
  const twinkleBase = s.brightness < 0.5 ? 0.92 : 0.72;
  const twinkle = twinkleBase + (Math.sin(s.phase) * 0.5 + 0.5) * twinkleAmp;
  const alpha = baseAlpha(twinkle, t, isLight, s.kind) * s.brightness;
  if (alpha < 0.02) return;

  ctx.shadowBlur = 0;
  if (props.starTrails) drawStarTrail(ctx, s, alpha, isLight);

  ctx.beginPath();
  ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
  ctx.fillStyle = colorForKind(s.kind, alpha, isLight);
  ctx.fill();
}

function trySpawnFlare(now: number) {
  if (!props.showFlares) return;
  const t = intensityT();
  const cap = Math.floor(1 + t * 2);
  if (flares.length >= cap) return;
  const chance = 0.00035 + t * 0.00065;
  if (Math.random() > chance) return;

  flares.push({
    x: Math.random() * viewW,
    y: Math.random() * viewH,
    bornAt: now,
    duration: 1400 + Math.random() * 1400,
    scale: 0.55 + Math.random() * 0.35,
    warm: Math.random() < 0.1,
    twinkleFreq: 0.75 + Math.random() * 0.55,
  });
}

function smoothstep(t: number) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function flareBrightness(p: number, twinkleFreq: number) {
  const fadeInEnd = 0.3;
  const fadeOutStart = 0.68;
  let envelope = 1;
  if (p < fadeInEnd) {
    envelope = smoothstep(p / fadeInEnd);
  } else if (p > fadeOutStart) {
    envelope = smoothstep((1 - p) / (1 - fadeOutStart));
  }
  const twinkleT = Math.max(0, (p - fadeInEnd) / Math.max(0.001, fadeOutStart - fadeInEnd));
  const wave = 0.5 + 0.5 * Math.sin(twinkleT * Math.PI * twinkleFreq);
  const pulse = 0.82 + 0.18 * wave * wave;
  return envelope * pulse;
}

function flareRgb(warm: boolean, isLight: boolean): [number, number, number] {
  if (warm) return isLight ? [251, 191, 36] : [255, 215, 165];
  return isLight ? [71, 85, 105] : [255, 255, 255];
}

/** 四尖内凹星芒：竖长、横向窄 */
function tracePinchStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  armX: number,
  armY: number,
) {
  const pinch = 0.05;
  const cpx = armX * pinch;
  const cpy = armY * pinch;

  ctx.beginPath();
  ctx.moveTo(cx, cy - armY);
  ctx.quadraticCurveTo(cx + cpx, cy - cpy, cx + armX, cy);
  ctx.quadraticCurveTo(cx + cpx, cy + cpy, cx, cy + armY);
  ctx.quadraticCurveTo(cx - cpx, cy + cpy, cx - armX, cy);
  ctx.quadraticCurveTo(cx - cpx, cy - cpy, cx, cy - armY);
  ctx.closePath();
}

function drawFlare(ctx: CanvasRenderingContext2D, f: Flare, now: number, isLight: boolean) {
  const age = now - f.bornAt;
  if (age < 0 || age > f.duration) return;

  const p = age / f.duration;
  const alpha = flareBrightness(p, f.twinkleFreq);
  if (alpha < 0.02) return;

  const [r, g, b] = flareRgb(f.warm, isLight);
  const base = (3 + f.scale * 2.2) * 0.5;
  const armY = base * 3.35;
  const armX = base * 1.0;

  ctx.save();
  ctx.shadowBlur = isLight ? 0 : alpha * 2;
  ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${alpha * 0.4})`;
  tracePinchStar(ctx, f.x, f.y, armX, armY);
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
  ctx.fill();
  ctx.restore();
}

function drawFrame(now: number) {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d", canvasContextOptions);
  if (!ctx) return;

  const dt = lastFrameTime ? Math.min(0.05, (now - lastFrameTime) / 1000) : 0.016;
  lastFrameTime = now;
  const t = intensityT();
  const isLight = props.theme === "light";

  ctx.clearRect(0, 0, viewW, viewH);
  ctx.shadowBlur = 0;

  const pad = 56;
  for (const s of stars) advanceStar(s, dt, isLight);

  const drawLayer = (dimOnly: boolean) => {
    for (const s of stars) {
      const isDim = s.brightness < 0.5;
      if (dimOnly !== isDim) continue;
      if (s.x < -pad || s.x > viewW + pad || s.y < -pad || s.y > viewH + pad) continue;
      drawStar(ctx, s, t, isLight);
    }
  };

  drawLayer(true);
  drawLayer(false);

  if (props.showFlares) {
    trySpawnFlare(now);
    flares = flares.filter((f) => now - f.bornAt < f.duration);
    for (const f of flares) {
      drawFlare(ctx, f, now, isLight);
    }
  }

  if (props.showMeteors) {
    trySpawnMeteor();
    meteors = meteors.filter((m) => advanceMeteor(m, now));
    drawMeteorDebris(ctx, now, isLight);
    for (const m of meteors) {
      drawMeteor(ctx, m, now, isLight);
    }
  } else {
    meteorDebris = meteorDebris.filter((d) => now - d.bornAt < METEOR_DEBRIS_TTL_MS);
    if (meteorDebris.length) {
      drawMeteorDebris(ctx, now, isLight);
    }
  }

  raf = requestAnimationFrame(drawFrame);
}

function resize() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const parent = canvas.parentElement;
  if (!parent) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = parent.clientWidth;
  const h = parent.clientHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext("2d", canvasContextOptions);
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
  }
  viewW = w;
  viewH = h;
  lastFrameTime = 0;
  initStars();
}

function start() {
  cancelAnimationFrame(raf);
  resize();
  raf = requestAnimationFrame(drawFrame);
}

function stop() {
  cancelAnimationFrame(raf);
}

let resizeObserver: ResizeObserver | undefined;

function onVisibility() {
  if (document.hidden) stop();
  else start();
}

onMounted(() => {
  start();
  resizeObserver = new ResizeObserver(() => resize());
  if (canvasRef.value?.parentElement) {
    resizeObserver.observe(canvasRef.value.parentElement);
  }
  document.addEventListener("visibilitychange", onVisibility);
});

onUnmounted(() => {
  stop();
  resizeObserver?.disconnect();
  document.removeEventListener("visibilitychange", onVisibility);
});

watch(
  () =>
    [props.theme, props.intensity, props.starTrails, props.showFlares, props.showMeteors] as const,
  () => start(),
);
</script>

<template>
  <canvas
    ref="canvasRef"
    class="pointer-events-none absolute inset-0 h-full w-full"
    aria-hidden="true"
  />
</template>
