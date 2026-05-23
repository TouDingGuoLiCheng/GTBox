from __future__ import annotations

from typing import List, Tuple

import numpy as np
from PIL import Image


def _to_gray_array(image: Image.Image) -> np.ndarray:
    gray = image.convert("L")
    arr = np.asarray(gray, dtype=np.uint8)
    if arr.ndim != 2:
        raise ValueError("Expected grayscale 2D array")
    return arr


def _row_scores(gray: np.ndarray) -> np.ndarray:
    arr16 = gray.astype(np.int16)
    row_std = gray.std(axis=1)
    if gray.shape[1] > 1:
        row_diff = np.abs(np.diff(arr16, axis=1)).mean(axis=1)
    else:
        row_diff = np.zeros_like(row_std)

    # Weighted low-information score: lower is better cut position.
    score = (0.65 * row_std) + (0.35 * row_diff)
    return score


def _best_cut_in_window(
    scores: np.ndarray,
    low_info_mask: np.ndarray,
    win_start: int,
    win_end: int,
    target: int,
) -> int:
    if win_end <= win_start:
        return target

    candidate_mask = low_info_mask[win_start:win_end]
    if np.any(candidate_mask):
        indices = np.where(candidate_mask)[0] + win_start
        nearest_idx = int(np.argmin(np.abs(indices - target)))
        return int(indices[nearest_idx])

    local_scores = scores[win_start:win_end]
    local_idx = int(np.argmin(local_scores))
    return win_start + local_idx


def split_smart_ranges(
    image: Image.Image,
    target_height: int,
    max_height: int,
    overlap: int = 0,
    search_radius: int = 300,
    blank_quantile: float = 0.2,
) -> List[Tuple[int, int]]:
    """
    Smart split by choosing cut lines near low-information rows.
    Return [(top, bottom), ...] where bottom is exclusive.
    """
    image_height = image.height
    if image_height <= 0:
        return []
    if target_height <= 0:
        raise ValueError("target_height must be greater than 0")
    if max_height < target_height:
        raise ValueError("max_height must be >= target_height")

    safe_overlap = max(0, min(overlap, max_height - 1))
    min_height = max(200, int(target_height * 0.45))

    gray = _to_gray_array(image)
    scores = _row_scores(gray)

    q = min(max(blank_quantile, 0.01), 0.9)
    cutoff = float(np.quantile(scores, q))
    low_info_mask = scores <= cutoff

    ranges: List[Tuple[int, int]] = []
    top = 0

    while top < image_height:
        remaining = image_height - top
        if remaining <= max_height:
            ranges.append((top, image_height))
            break

        target = top + target_height
        win_start = max(top + min_height, target - search_radius)
        win_end = min(top + max_height, target + search_radius, image_height - 1)

        if win_end <= win_start:
            cut = min(top + max_height, image_height)
        else:
            cut = _best_cut_in_window(scores, low_info_mask, win_start, win_end, target)

        cut = min(max(cut, top + min_height), top + max_height, image_height)
        ranges.append((top, cut))

        if cut >= image_height:
            break
        top = max(cut - safe_overlap, top + 1)

    return ranges

