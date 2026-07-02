from __future__ import annotations

from typing import List, Tuple


def split_fixed_ranges(
    image_height: int,
    max_height: int,
    overlap: int = 0,
) -> List[Tuple[int, int]]:
    """Split by fixed height. Return [(top, bottom), ...] (bottom exclusive)."""
    if image_height <= 0:
        return []
    if max_height <= 0:
        raise ValueError("max_height must be greater than 0")

    safe_overlap = max(0, min(overlap, max_height - 1))
    step = max_height - safe_overlap

    ranges: List[Tuple[int, int]] = []
    top = 0
    while top < image_height:
        bottom = min(top + max_height, image_height)
        ranges.append((top, bottom))
        if bottom >= image_height:
            break
        top += step
    return ranges

