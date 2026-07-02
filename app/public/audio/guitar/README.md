# 电吉他采样



应用使用 **6 根弦空弦音** 作为采样根音，按最近根音 + 变速映射全指板。



## 默认音色：内置合成吉他



默认使用 `scripts/gen-guitar-samples.py` 生成的 **Karplus-Strong 合成吉他**（无需下载）：



```bash

cd app/scripts

python gen-guitar-samples.py

```



输出目录：`app/public/audio/guitar/builtin/`



## 可选音色：真实电吉他采样



若需要更真实的失真/清音电吉他，可安装 FreePats 等 CC0 采样到 `recorded/` 目录，并在应用 **设置 → 音色** 中切换为「真实电吉他采样」。



一键安装（失真电吉他）：



```bash

python app/scripts/install-freepats-guitar.py "D:\Temp\你的解压目录"

```



安装目标：`app/public/audio/guitar/recorded/`



| 文件名 | 音高 | 弦 |

|--------|------|-----|

| `e2.wav` | E2 | 6 弦空弦 |

| `a2.wav` | A2 | 5 弦空弦 |

| `d3.wav` | D3 | 4 弦空弦 |

| `g3.wav` | G3 | 3 弦空弦 |

| `b3.wav` | B3 | 2 弦空弦 |

| `e4.wav` | E4 | 1 弦空弦 |



若未安装真实采样而选择了该选项，应用会自动回退到内置合成吉他。



---



## 推荐下载（CC0，可商用）



### 首选：FreePats 失真电吉他



| 资源 | 链接 |

|------|------|

| Distorted #2 · SFZ WAV | https://freepats.zenvoid.org/ElectricGuitar/distorted-electric-guitar.html |

| Clean #1 · Small WAV | https://freepats.zenvoid.org/ElectricGuitar/clean-electric-guitar.html |



---



## 自己录音



1. 用过载/失真链录 6 弦空弦，每弦 1.5–2 秒 WAV

2. 按上表命名并放入 `recorded/`

3. 在设置中切换为「真实电吉他采样」

