"""FastAPI application for stitching short camera pans into panoramas."""

from __future__ import annotations

from pathlib import Path
import tempfile

import cv2
import numpy as np
import logging
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = Path(__file__).resolve().parent / "static"
app = FastAPI(title="Edge Stop Viewer", version="1.0.0")
logger = logging.getLogger(__name__)


def _trim_black_borders(image: np.ndarray) -> np.ndarray:
    """Crop away the black region surrounding an OpenCV stitched panorama."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    # A small threshold tolerates JPEG-like noise while retaining dark scene detail.
    mask = cv2.threshold(gray, 4, 255, cv2.THRESH_BINARY)[1]
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return image
    x, y, width, height = cv2.boundingRect(max(contours, key=cv2.contourArea))
    if width < image.shape[1] * 0.25 or height < image.shape[0] * 0.25:
        return image
    return image[y : y + height, x : x + width]


def stitch_video(video_bytes: bytes, suffix: str = ".mp4") -> tuple[bytes, bool]:
    """Stitch a video and report whether its first and last views form a full turn."""
    if not video_bytes:
        raise ValueError("The uploaded video is empty.")

    # OpenCV's VideoCapture cannot read bytes directly. Write a temporary file so
    # the input works across the codecs supported by the local OpenCV build.
    temp_path: Path | None = None
    capture: cv2.VideoCapture | None = None
    try:
        safe_suffix = suffix.lower() if suffix.lower() in {".mp4", ".mov", ".webm", ".m4v"} else ".mp4"
        with tempfile.NamedTemporaryFile(suffix=safe_suffix, delete=False) as temp_file:
            temp_file.write(video_bytes)
            temp_path = Path(temp_file.name)
        capture = cv2.VideoCapture(str(temp_path))
        if not capture.isOpened():
            raise ValueError("Couldn't read that video. Try an MP4 or WebM recording.")

        fps = capture.get(cv2.CAP_PROP_FPS)
        if not np.isfinite(fps) or fps <= 0:
            fps = 30.0
        frame_count = capture.get(cv2.CAP_PROP_FRAME_COUNT)
        duration = frame_count / fps if frame_count > 0 else 30.0
        if duration > 30.5:
            raise ValueError("Videos must be 30 seconds or shorter.")

        frames: list[np.ndarray] = []
        next_sample = 0.0
        frame_index = 0
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            timestamp = frame_index / fps
            if timestamp + 1e-6 >= next_sample:
                height, width = frame.shape[:2]
                if width != 1000:
                    frame = cv2.resize(
                        frame,
                        (1000, max(1, round(height * 1000 / width))),
                        interpolation=cv2.INTER_AREA if width > 1000 else cv2.INTER_LINEAR,
                    )
                frames.append(frame)
                next_sample += 0.3
            frame_index += 1
        if len(frames) < 2:
            raise ValueError("The video is too short. Record a slow pan for a few seconds.")

        # Long recordings can produce about 100 samples. Keep the full 0.3s
        # extraction above, then use enough evenly spaced views for strong
        # overlap while keeping spherical registration within function limits.
        if len(frames) > 10:
            frame_indices = np.linspace(0, len(frames) - 1, 10, dtype=int)
            frames = [frames[index] for index in frame_indices]

        # A full room turn needs the spherical camera model. Scan mode remains a
        # fallback for recordings that are closer to a flat wall sweep.
        full_turn = False
        if len(frames) > 3:
            gray_start = cv2.cvtColor(frames[0], cv2.COLOR_BGR2GRAY)
            gray_end = cv2.cvtColor(frames[-1], cv2.COLOR_BGR2GRAY)
            orb = cv2.ORB_create(800)
            start_keypoints, start_descriptors = orb.detectAndCompute(gray_start, None)
            end_keypoints, end_descriptors = orb.detectAndCompute(gray_end, None)
            if start_descriptors is not None and end_descriptors is not None:
                matches = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(
                    start_descriptors, end_descriptors, k=2
                )
                overlap_matches = [
                    first for pair in matches if len(pair) == 2
                    for first, second in [pair] if first.distance < 0.7 * second.distance
                ]
                if len(overlap_matches) >= 18:
                    points_start = np.float32([start_keypoints[m.queryIdx].pt for m in overlap_matches])
                    points_end = np.float32([end_keypoints[m.trainIdx].pt for m in overlap_matches])
                    transform, inliers = cv2.findHomography(points_start, points_end, cv2.RANSAC, 5.0)
                    if transform is not None and inliers is not None and int(inliers.sum()) >= 14:
                        height, width = frames[0].shape[:2]
                        corners = np.float32(
                            [[[0, 0], [width, 0], [width, height], [0, height], [width / 2, height / 2]]]
                        )
                        projected = cv2.perspectiveTransform(corners, transform)[0]
                        drift = float(np.linalg.norm(projected - corners[0], axis=1).mean())
                        # A full turn returns close to its starting view; a short
                        # straight sweep may overlap but has a large image shift.
                        full_turn = duration >= 6.0 and drift <= width * 0.14
                        if full_turn and len(frames) > 2:
                            # Keep the first view and remove its repeated copy at
                            # the end so OpenCV can build an open panorama path.
                            frames.pop()

        if not full_turn:
            raise ValueError(
                "Couldn't confirm a full room turn. Hold the phone sideways, turn slowly all the way around, and finish where you started."
            )

        panorama = None
        last_status = cv2.Stitcher_ERR_NEED_MORE_IMGS
        # Panorama mode uses a spherical camera model suited to rotating in place.
        # Scan mode remains a fallback for predominantly planar wall sweeps.
        cv2.setNumThreads(2)
        cv2.ocl.setUseOpenCL(False)
        for mode in (cv2.Stitcher_PANORAMA, cv2.Stitcher_SCANS):
            stitcher = cv2.Stitcher_create(mode)
            stitcher.setPanoConfidenceThresh(0.25)
            # Feature registration is the expensive part. Keep it at a smaller
            # scale while the compositor still uses the full 1000px frames.
            stitcher.setRegistrationResol(0.04)
            stitcher.setSeamEstimationResol(0.04)
            try:
                last_status, candidate = stitcher.stitch(frames)
            except cv2.error:
                logger.warning("OpenCV stitcher mode %s raised; trying the fallback mode", mode, exc_info=True)
                continue
            if last_status == cv2.Stitcher_OK and candidate is not None:
                panorama = candidate
                break

        if panorama is None:
            logger.warning(
                "Panorama registration failed (status=%s, frames=%s, size=%sx%s)",
                last_status,
                len(frames),
                frames[0].shape[1],
                frames[0].shape[0],
            )
            raise ValueError("Couldn't stitch. Pan slower with good light and try again.")

        panorama = _trim_black_borders(panorama)
        ok, encoded = cv2.imencode(".jpg", panorama, [cv2.IMWRITE_JPEG_QUALITY, 92])
        if not ok:
            raise ValueError("The panorama was created but could not be encoded as JPEG.")
        return encoded.tobytes(), full_turn
    finally:
        if capture is not None:
            capture.release()
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


@app.post("/api/stitch", include_in_schema=False)
@app.post("/stitch")
async def stitch(file: UploadFile = File(...)) -> Response:
    """Receive a recorded pan and return its stitched panorama as a JPEG."""
    try:
        image_bytes, full_turn = stitch_video(
            file.file.read(), Path(file.filename or "pan.mp4").suffix
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except cv2.error as exc:
        logger.exception("OpenCV raised an error while stitching the uploaded video")
        raise HTTPException(
            status_code=422,
            detail="Couldn't stitch. Pan slower with good light and try again.",
        ) from exc
    return Response(
        content=image_bytes,
        media_type="image/jpeg",
        headers={"X-Panorama-Wrap": str(full_turn).lower()},
    )


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True, check_dir=False), name="frontend")
