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


def stitch_video(video_bytes: bytes, suffix: str = ".mp4") -> bytes:
    """Sample, resize, and stitch the uploaded video; return encoded JPEG bytes."""
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
        # extraction above, but use a uniform subset so feature matching stays
        # responsive in a serverless function.
        if len(frames) > 30:
            frame_indices = np.linspace(0, len(frames) - 1, 30, dtype=int)
            frames = [frames[index] for index in frame_indices]

        panorama = None
        last_status = cv2.Stitcher_ERR_NEED_MORE_IMGS
        # A phone pan is usually close to a planar scan. Scan mode is much faster
        # for that motion; retain panorama mode as a fallback for perspective.
        cv2.setNumThreads(2)
        for mode in (cv2.Stitcher_SCANS, cv2.Stitcher_PANORAMA):
            stitcher = cv2.Stitcher_create(mode)
            stitcher.setPanoConfidenceThresh(0.25)
            # Feature registration is the expensive part. Keep it at a smaller
            # scale while the compositor still uses the full 1000px frames.
            stitcher.setRegistrationResol(0.04)
            stitcher.setSeamEstimationResol(0.04)
            last_status, candidate = stitcher.stitch(frames)
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
        return encoded.tobytes()
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
        image_bytes = stitch_video(file.file.read(), Path(file.filename or "pan.mp4").suffix)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except cv2.error as exc:
        logger.exception("OpenCV raised an error while stitching the uploaded video")
        raise HTTPException(
            status_code=422,
            detail="Couldn't stitch. Pan slower with good light and try again.",
        ) from exc
    return Response(content=image_bytes, media_type="image/jpeg")


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True, check_dir=False), name="frontend")
