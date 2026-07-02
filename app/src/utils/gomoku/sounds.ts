import { pushDebugLine } from "../mediaDebug";

const SOUND_SRC = {
  place: "/gomoku/sounds/place.wav",
  click: "/gomoku/sounds/click.wav",
  gameEnd: "/gomoku/sounds/game-end.mp3",
} as const;

type SoundKind = keyof typeof SOUND_SRC;

const bgm = new Audio("/gomoku/sounds/bgm.ogg");
bgm.loop = true;
bgm.volume = 0.45;

let sfxEnabled = true;
let bgmEnabled = false;
let audioCtx: AudioContext | null = null;
const bufferCache = new Map<SoundKind, AudioBuffer>();
let preloadPromise: Promise<void> | null = null;

function resumeContext() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === "suspended") {
    void audioCtx.resume();
  }
}

async function ensureContext() {
  resumeContext();
  if (!audioCtx) return;
  if (audioCtx.state === "suspended") {
    await audioCtx.resume();
  }
}

async function preloadSounds() {
  if (preloadPromise) return preloadPromise;
  preloadPromise = (async () => {
    await ensureContext();
    if (!audioCtx) return;
    for (const kind of Object.keys(SOUND_SRC) as SoundKind[]) {
      if (bufferCache.has(kind)) continue;
      try {
        const res = await fetch(SOUND_SRC[kind]);
        if (!res.ok) {
          pushDebugLine("五子棋", "sfx-load-fail", `${kind} HTTP ${res.status}`);
          continue;
        }
        const data = await res.arrayBuffer();
        bufferCache.set(kind, await audioCtx.decodeAudioData(data.slice(0)));
      } catch (e) {
        pushDebugLine("五子棋", "sfx-decode-fail", kind, { error: String(e) });
      }
    }
  })();
  return preloadPromise;
}

function tryPlayWebAudio(kind: SoundKind): boolean {
  const buffer = bufferCache.get(kind);
  if (!buffer || !audioCtx) return false;
  resumeContext();
  try {
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start(0);
    return true;
  } catch (e) {
    pushDebugLine("五子棋", "sfx-wa-play-fail", kind, { error: String(e) });
    return false;
  }
}

function playWithHtmlAudio(kind: SoundKind) {
  const audio = new Audio(SOUND_SRC[kind]);
  audio.volume = 1;
  void audio.play().catch((e) => {
    pushDebugLine("五子棋", "sfx-play-fail", kind, { error: String(e) });
  });
}

/** 在用户点击/触摸时调用，恢复 AudioContext 并预加载音效 */
export function unlockGomokuAudio() {
  resumeContext();
  void ensureContext().then(() => preloadSounds());
}

export function setSoundEnabled(value: boolean) {
  sfxEnabled = value;
}

export function setBgmEnabled(value: boolean) {
  bgmEnabled = value;
  if (!value) {
    bgm.pause();
    return;
  }
  void bgm.play().catch(() => {
    /* 需用户交互后才能播放 */
  });
}

export function syncBgm(playing: boolean) {
  if (!bgmEnabled) {
    bgm.pause();
    return;
  }
  if (playing) {
    void bgm.play().catch(() => {});
  } else {
    bgm.pause();
  }
}

export function playSound(kind: SoundKind) {
  if (!sfxEnabled) return;
  if (tryPlayWebAudio(kind)) {
    void preloadSounds();
    return;
  }
  // 必须在用户手势的同步调用栈内播放，不能 await 预加载后再 play()
  playWithHtmlAudio(kind);
  void preloadSounds();
}
