"""Generate a deterministic synthetic left-to-right pan for manual stitching checks."""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np


def make_scene(width: int = 2000, height: int = 450) -> np.ndarray:
    rng = np.random.default_rng(17)
    # A continuous room-like scene with texture and crisp vertical features gives
    # OpenCV repeatable corners to track as the camera window moves across it.
    noise = rng.normal(0, 24, (height, width, 1)).astype(np.int16)
    base = np.full((height, width, 3), (112, 127, 112), dtype=np.int16)
    scene = np.clip(base + noise, 0, 255).astype(np.uint8)
    cv2.rectangle(scene, (0, 315), (width, height), (83, 92, 78), -1)
    for x in range(100, width, 340):
        wall_color = tuple(int(value) for value in rng.integers(38, 190, 3))
        cv2.rectangle(scene, (x, 82), (x + 130, 255), wall_color, -1)
        cv2.rectangle(scene, (x + 8, 90), (x + 122, 247), (196, 201, 177), 3)
        cv2.line(scene, (x + 65, 91), (x + 65, 247), (60, 70, 61), 3)
        cv2.line(scene, (x + 8, 168), (x + 122, 168), (60, 70, 61), 3)
        cv2.circle(scene, (x + 40, 278), 11, (46, 54, 47), -1)
        cv2.line(scene, (x + 40, 289), (x + 40, 313), (47, 57, 48), 4)
        cv2.putText(scene, f"ROOM {x // 340 + 1:02d}", (x + 12, 72), cv2.FONT_HERSHEY_SIMPLEX, .4, (226, 228, 207), 1)
    for x in range(0, width, 170):
        cv2.line(scene, (x, 320), (x + 85, 450), (77, 85, 73), 2)
    for _ in range(260):
        center = (int(rng.integers(0, width)), int(rng.integers(20, height - 15)))
        radius = int(rng.integers(2, 9))
        color = tuple(int(value) for value in rng.integers(22, 232, 3))
        cv2.circle(scene, center, radius, color, -1)
    for _ in range(55):
        x = int(rng.integers(0, width - 32))
        y = int(rng.integers(30, 410))
        cv2.rectangle(scene, (x, y), (x + 18, y + 10), (229, 218, 171), -1)
    return scene


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", nargs="?", default="sample-pan.mp4", help="Output MP4 path")
    args = parser.parse_args()
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    scene = make_scene()
    frame_width, frame_height = 1000, 450
    writer = cv2.VideoWriter(str(destination), cv2.VideoWriter_fourcc(*"mp4v"), 30, (frame_width, frame_height))
    if not writer.isOpened():
        raise SystemExit("OpenCV could not open an MP4 video writer in this environment.")
    travel = scene.shape[1] - frame_width
    frame_count = 45
    try:
        for frame_index in range(frame_count):
            # Each frame overlaps its neighbors substantially, like a slow phone pan.
            x = round(travel * frame_index / (frame_count - 1))
            writer.write(scene[:, x : x + frame_width].copy())
    finally:
        writer.release()
    print(f"Created {destination.resolve()} (1.5 seconds, {frame_count} frames)")


if __name__ == "__main__":
    main()

