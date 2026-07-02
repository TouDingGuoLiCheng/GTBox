export const NAME_PREFIXES = [
  "爱吃拉面的",
  "好奇的",
  "眼睛圆的",
  "头上有天线的",
  "糊里糊涂的",
  "特会下棋的",
  "绝不放弃的",
  "沉默寡言的",
  "爱喝饮料的",
  "最后王牌的",
  "完全体的",
  "阿姆斯特朗回旋加速式的",
  "隐藏款的",
  "变化莫测的",
  "？？？的",
] as const;

export function randomComputerName(): string {
  const prefix = NAME_PREFIXES[Math.floor(Math.random() * NAME_PREFIXES.length)];
  return `${prefix}电脑`;
}

export function stoneLabel(stone: 1 | 2): string {
  return stone === 1 ? "黑棋" : "白棋";
}
