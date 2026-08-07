# -*- coding: utf-8 -*-
"""Generate ShippingBin datapack for Farmers Delight + Youkai Homecoming crops."""
import json
from pathlib import Path

saves = Path(r"d:\Game\MineCraft\.minecraft\saves")
world = next(saves.iterdir())
pack_root = world / "datapacks" / "shippingbin_fd_yk_crops"
ws = Path(r"d:\VS\工具箱开发\datapacks\shippingbin_fd_yk_crops")

COPPER = "lightmanscurrency:coin_copper"
GOLD = "lightmanscurrency:coin_gold"
EMERALD = "lightmanscurrency:coin_emerald"

trades: list[tuple[str, str, int, str, int]] = []


def add(fid: str, item: str, n_in: int, out: str, n_out: int) -> None:
    trades.append((fid, item, n_in, out, n_out))


# Farmers Delight core crops (aligned with vanilla 24 wheat -> 1 emerald)
for name in ["cabbage", "tomato", "onion", "rice", "rice_panicle"]:
    add(f"fd_{name}", f"farmersdelight:{name}", 24, EMERALD, 1)

add("fd_cabbage_leaf", "farmersdelight:cabbage_leaf", 32, EMERALD, 1)
add("fd_pumpkin_slice", "farmersdelight:pumpkin_slice", 32, EMERALD, 1)
add("fd_rotten_tomato", "farmersdelight:rotten_tomato", 64, COPPER, 1)
add("fd_brown_mushroom_colony", "farmersdelight:brown_mushroom_colony", 8, EMERALD, 1)
add("fd_red_mushroom_colony", "farmersdelight:red_mushroom_colony", 8, EMERALD, 1)

for name in [
    "cabbage_crate",
    "tomato_crate",
    "onion_crate",
    "rice_bag",
    "rice_bale",
]:
    add(f"fd_{name}", f"farmersdelight:{name}", 1, GOLD, 4)

# Youkai Homecoming farm crops
for name in [
    "cucumber",
    "red_grape",
    "black_grape",
    "white_grape",
    "redbean",
    "soybean",
    "pods",
]:
    add(f"yk_{name}", f"youkaishomecoming:{name}", 24, EMERALD, 1)

add("yk_cucumber_slice", "youkaishomecoming:cucumber_slice", 32, EMERALD, 1)
add("yk_raisin", "youkaishomecoming:raisin", 16, EMERALD, 1)
add("yk_tea_leaves", "youkaishomecoming:tea_leaves", 16, EMERALD, 1)

for name in [
    "green_tea_leaves",
    "black_tea_leaves",
    "oolong_tea_leaves",
    "white_tea_leaves",
    "dark_tea_leaves",
    "yellow_tea_leaves",
]:
    add(f"yk_{name}", f"youkaishomecoming:{name}", 12, EMERALD, 1)

add("yk_matcha", "youkaishomecoming:matcha", 12, EMERALD, 1)
add("yk_camellia", "youkaishomecoming:camellia", 12, EMERALD, 1)
add("yk_coffee_berries", "youkaishomecoming:coffee_berries", 16, EMERALD, 1)
add("yk_green_coffee_bean", "youkaishomecoming:green_coffee_bean", 16, EMERALD, 1)
add("yk_coffee_beans", "youkaishomecoming:coffee_beans", 12, EMERALD, 1)

# Mandrake: same tier as wheat (24 -> 1 emerald coin)
for name in [
    "mandrake_root",
    "stripped_mandrake_root",
    "mandrake_flower",
    "dried_mandrake_flower",
]:
    add(f"yk_{name}", f"youkaishomecoming:{name}", 24, EMERALD, 1)

# Udumbara: rare — higher sell value than before (was 8 -> 1)
add("yk_udumbara_seeds", "youkaishomecoming:udumbara_seeds", 4, EMERALD, 1)
add("yk_udumbara_flower", "youkaishomecoming:udumbara_flower", 2, EMERALD, 1)

for name, n_gold in [
    ("cucumber_crate", 4),
    ("red_grape_crate", 4),
    ("black_grape_crate", 4),
    ("white_grape_crate", 4),
    ("pod_crate", 4),
    ("soybean_bag", 4),
    ("redbean_bag", 4),
    ("coffee_bean_bag", 5),
    ("tea_leaf_bag", 5),
    ("green_tea_bag", 6),
    ("black_tea_bag", 6),
    ("oolong_tea_bag", 6),
    ("white_tea_bag", 6),
    ("dark_tea_bag", 6),
    ("yellow_tea_bag", 6),
]:
    add(f"yk_{name}", f"youkaishomecoming:{name}", 1, GOLD, n_gold)

pack_mcmeta = {
    "pack": {
        "pack_format": 15,
        "description": (
            "ShippingBin: Farmers Delight + Youkai Homecoming crops "
            "sell for Lightman's coins"
        ),
    }
}

readme = """# Shipping Bin · 农夫乐事 + 妖怪的归家 作物出售

货币使用 Lightman's Currency 硬币（普通作物 24 个 = 1 绿宝石币，对齐原版小麦价）。

## 启用

已安装到存档 `datapacks/shippingbin_fd_yk_crops`。

若未生效：

```
/datapack enable "file/shippingbin_fd_yk_crops"
/reload
```

## 价位

| 类型 | 示例 | 比例 |
|------|------|------|
| 普通作物 | 卷心菜/番茄/黄瓜/葡萄/红豆/大豆 | 24 → 1 绿宝石币 |
| 切片/副产物 | 菜叶/黄瓜丝/南瓜片 | 32 → 1 绿宝石币 |
| 茶/咖啡 | 生茶叶 16、成品茶叶/咖啡豆 12 | → 1 绿宝石币 |
| 普通稀有作物 | 曼德拉（同小麦） | 24 → 1 绿宝石币 |
| 极稀有 | 幻昙华叶片 4、花朵 2 | → 1 绿宝石币 |
| 箱/袋 | 作物箱 | 1 → 4~6 金币 |
| 烂番茄 | rotten_tomato | 64 → 1 铜币 |
"""


def write_pack(root: Path) -> int:
    trades_dir = root / "data" / "shippingbin" / "trades"
    trades_dir.mkdir(parents=True, exist_ok=True)
    (root / "pack.mcmeta").write_text(
        json.dumps(pack_mcmeta, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (root / "README.md").write_text(readme, encoding="utf-8")
    for fid, item, n_in, out, n_out in trades:
        obj = {
            "attribute": "shippingbin:crop_sell_multiplier",
            "input": {"count": n_in, "ingredient": {"item": item}},
            "output": {"item": out, "count": n_out},
        }
        (trades_dir / f"{fid}.json").write_text(
            json.dumps(obj, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return len(trades)


n1 = write_pack(pack_root)
n2 = write_pack(ws)
print(f"Wrote {n1} trades -> {pack_root}")
print(f"Wrote {n2} trades -> {ws}")
for t in trades:
    print(f"  {t[1]} x{t[2]} -> {t[3]} x{t[4]}")
