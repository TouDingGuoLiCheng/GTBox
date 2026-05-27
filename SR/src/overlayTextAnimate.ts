export interface AnimatedChar {
  char: string;
  key: string;
  enter: boolean;
}

/** 将流式识别文本拆成带稳定 key 的字符项，仅对新增字做入场标记 */
export function diffAnimatedChars(
  prev: AnimatedChar[],
  nextText: string,
): AnimatedChar[] {
  if (nextText === "") {
    resetAnimatedCharKeys();
    return [];
  }

  const prevText = prev.map((c) => c.char).join("");
  if (nextText === prevText) {
    return prev.map((c) => ({ ...c, enter: false }));
  }

  if (nextText.startsWith(prevText)) {
    const out = prev.map((c) => ({ ...c, enter: false }));
    for (let i = prevText.length; i < nextText.length; i++) {
      out.push({
        char: nextText[i]!,
        key: nextKey(),
        enter: true,
      });
    }
    return out;
  }

  let shared = 0;
  const limit = Math.min(prevText.length, nextText.length);
  while (shared < limit && prevText[shared] === nextText[shared]) {
    shared++;
  }

  const out: AnimatedChar[] = [];
  for (let i = 0; i < shared; i++) {
    const p = prev[i];
    out.push({
      char: nextText[i]!,
      key: p?.key ?? nextKey(),
      enter: false,
    });
  }
  for (let i = shared; i < nextText.length; i++) {
    out.push({
      char: nextText[i]!,
      key: nextKey(),
      enter: true,
    });
  }
  return out;
}

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `c-${keySeq}`;
}

export function resetAnimatedCharKeys(): void {
  keySeq = 0;
}
