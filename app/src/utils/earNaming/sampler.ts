export type EarNamingAudioSource = "builtin" | "recorded";

const AUDIO_SOURCE_KEY = "earNaming.audio.source";

const BUILTIN_SAMPLES = [
  { midi: 40, url: "/audio/guitar/builtin/e2.wav" },
  { midi: 45, url: "/audio/guitar/builtin/a2.wav" },
  { midi: 50, url: "/audio/guitar/builtin/d3.wav" },
  { midi: 55, url: "/audio/guitar/builtin/g3.wav" },
  { midi: 59, url: "/audio/guitar/builtin/b3.wav" },
  { midi: 64, url: "/audio/guitar/builtin/e4.wav" },
] as const;

const RECORDED_SAMPLES = [
  { midi: 40, url: "/audio/guitar/recorded/e2.wav" },
  { midi: 45, url: "/audio/guitar/recorded/a2.wav" },
  { midi: 50, url: "/audio/guitar/recorded/d3.wav" },
  { midi: 55, url: "/audio/guitar/recorded/g3.wav" },
  { midi: 59, url: "/audio/guitar/recorded/b3.wav" },
  { midi: 64, url: "/audio/guitar/recorded/e4.wav" },
] as const;

let audioCtx: AudioContext | null = null;
const bufferByMidi = new Map<number, AudioBuffer>();
let loadStarted = false;
let loadFailed = false;
let loadError = "";
let loadedSource: EarNamingAudioSource | null = null;
let activeSource: EarNamingAudioSource = "builtin";

function getContext() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

async function resumeContext() {
  const ctx = getContext();
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
}

export function getEarNamingAudioSource(): EarNamingAudioSource {
  try {
    const raw = localStorage.getItem(AUDIO_SOURCE_KEY);
    return raw === "recorded" ? "recorded" : "builtin";
  } catch {
    return "builtin";
  }
}

export function setEarNamingAudioSource(source: EarNamingAudioSource) {
  activeSource = source;
  try {
    localStorage.setItem(AUDIO_SOURCE_KEY, source);
  } catch {
    /* ignore */
  }
  bufferByMidi.clear();
  loadStarted = false;
  loadFailed = false;
  loadError = "";
  loadedSource = null;
}

function sampleListFor(source: EarNamingAudioSource) {
  return source === "recorded" ? RECORDED_SAMPLES : BUILTIN_SAMPLES;
}

function pickRootMidi(targetMidi: number, roots: readonly { midi: number }[]) {
  let best = roots[0].midi;
  let bestDist = Infinity;
  for (const root of roots) {
    const dist = Math.abs(targetMidi - root.midi);
    if (dist < bestDist) {
      bestDist = dist;
      best = root.midi;
    }
  }
  return best;
}

async function loadSamplesFor(source: EarNamingAudioSource) {
  if (loadStarted && loadedSource === source) return;
  loadStarted = true;
  loadedSource = source;
  bufferByMidi.clear();
  loadFailed = false;
  loadError = "";

  const roots = sampleListFor(source);
  const ctx = getContext();
  try {
    await Promise.all(
      roots.map(async (root) => {
        const response = await fetch(root.url);
        if (!response.ok) {
          throw new Error(`${root.url} HTTP ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        bufferByMidi.set(root.midi, await ctx.decodeAudioData(arrayBuffer.slice(0)));
      }),
    );
  } catch (error) {
    if (source === "recorded") {
      loadStarted = false;
      loadedSource = null;
      await loadSamplesFor("builtin");
      return;
    }
    loadFailed = true;
    loadError = error instanceof Error ? error.message : String(error);
  }
}

function playOscillatorFallback(midi: number) {
  const ctx = getContext();
  const freq = 440 * 2 ** ((midi - 69) / 12);
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc.type = "triangle";
  osc.frequency.value = freq;
  filter.type = "lowpass";
  filter.frequency.value = 2800;
  gain.gain.value = 0;

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.22, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);

  osc.start(now);
  osc.stop(now + 1.25);
}

function playSample(midi: number, roots: readonly { midi: number }[]) {
  const rootMidi = pickRootMidi(midi, roots);
  const sampleBuffer = bufferByMidi.get(rootMidi);
  if (!sampleBuffer) return false;

  const ctx = getContext();
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  const semitoneDiff = midi - rootMidi;
  const rate = 2 ** (semitoneDiff / 12);

  source.buffer = sampleBuffer;
  source.playbackRate.value = rate;
  filter.type = "lowpass";
  filter.frequency.value = Math.min(9000, 4800 * Math.sqrt(rate));
  gain.gain.value = 0.88;

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start(0);
  return true;
}

export async function unlockEarNamingAudio() {
  activeSource = getEarNamingAudioSource();
  await resumeContext();
  void loadSamplesFor(activeSource);
}

export async function playEarNamingMidi(midi: number) {
  activeSource = getEarNamingAudioSource();
  await resumeContext();
  if (bufferByMidi.size === 0 || loadedSource !== activeSource) {
    loadStarted = false;
    loadedSource = null;
    await loadSamplesFor(activeSource);
  }
  const roots = sampleListFor(loadedSource ?? activeSource);
  if (playSample(midi, roots)) return;
  playOscillatorFallback(midi);
}

export function getEarNamingAudioStatus() {
  const source = getEarNamingAudioSource();
  const roots = sampleListFor(source);
  const usingFallback = source === "recorded" && loadedSource === "builtin";
  return {
    source,
    usingFallback,
    sampleReady: bufferByMidi.size === roots.length || (usingFallback && bufferByMidi.size === BUILTIN_SAMPLES.length),
    sampleFailed: loadFailed,
    sampleError: loadError,
    sampleUrl: roots.map((s) => s.url).join(", "),
    sourceLabel:
      source === "recorded" && !usingFallback
        ? "真实电吉他采样（可选）"
        : usingFallback
          ? "真实采样未安装，已回退内置合成吉他"
          : "内置合成吉他（默认）",
  };
}
