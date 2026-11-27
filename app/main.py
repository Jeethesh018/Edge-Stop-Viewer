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


def _stitch_rotation_strips(frames: list[np.ndarray]) -> np.ndarray | None:
    """Join narrow, ordered frame strips using measured horizontal camera motion."""
    if len(frames) < 4:
        return None

    motions: list[float] = []
    previous_gray: np.ndarray | None = None
    for frame in frames:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        small = cv2.resize(gray, (max(1, gray.shape[1] // 2), max(1, gray.shape[0] // 2)))
        if previous_gray is not None:
            points = cv2.goodFeaturesToTrack(
                previous_gray, maxCorners=400, qualityLevel=0.01, minDistance=7, blockSize=7
            )
            if points is not None and len(points) >= 8:
                tracked, status, _ = cv2.calcOpticalFlowPyrLK(
                    previous_gray, small, points, None, winSize=(21, 21), maxLevel=3
                )
                if tracked is not None and status is not None:
                    valid = status.ravel().astype(bool)
                    displacement = (tracked[valid] - points[valid]).reshape(-1, 2)
                    if len(displacement) >= 8:
                        dx = float(np.median(displacement[:, 0]))
                        motions.append(abs(dx) * frame.shape[1] / small.shape[1])
                    else:
                        motions.append(0.0)
                else:
                    motions.append(0.0)
            else:
                motions.append(0.0)
        previous_gray = small

    frame_width = frames[0].shape[1]
    usable = [motion for motion in motions if motion >= 1.0]
    if len(usable) < 3 or sum(usable) < frame_width * 1.25:
        return None

    widths = [max(2, min(round(motion), max(2, frame_width // 4))) for motion in motions]
    valid_widths = [width for width in widths if width > 2]
    seed_width = max(2, int(np.median(valid_widths))) if valid_widths else 2
    center = frame_width // 2
    left = max(0, center - seed_width // 2)
    panorama = frames[0][:, left : left + seed_width].copy()

    # A narrow blend softens seams while preserving the sequence of wall views.
    for frame, strip_width in zip(frames[1:], widths):
        center = frame.shape[1] // 2
        left = max(0, center - strip_width // 2)
        strip = frame[:, left : left + strip_width]
        overlap = min(8, panorama.shape[1], strip.shape[1])
        if overlap:
            ramp = np.linspace(0, 1, overlap, dtype=np.float32)[None, :, None]
            blend = np.clip(
                panorama[:, -overlap:].astype(np.float32) * (1 - ramp)
                + strip[:, :overlap].astype(np.float32) * ramp,
                0,
                255,
            ).astype(np.uint8)
            panorama = np.concatenate((panorama[:, :-overlap], blend, strip[:, overlap:]), axis=1)
        else:
            panorama = np.concatenate((panorama, strip), axis=1)

    return panorama


def stitch_video(video_bytes: bytes, suffix: str = ".mp4") -> bytes:
    """Stitch sampled views from a room video into a JPEG panorama."""
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
        # Phone clips commonly carry a 90° display-rotation tag even though the
        # camera sensor frames are landscape. Keep those landscape pixels for
        # stitching; applying the display tag turns a sideways room sweep into
        # portrait frames and makes wall-to-wall alignment fail.
        if hasattr(cv2, "CAP_PROP_ORIENTATION_AUTO"):
            capture.set(cv2.CAP_PROP_ORIENTATION_AUTO, 0)
        rotation = int(round(capture.get(cv2.CAP_PROP_ORIENTATION_META))) % 360

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
                if rotation == 90:
                    frame = cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE)
                elif rotation == 180:
                    frame = cv2.rotate(frame, cv2.ROTATE_180)
                elif rotation == 270:
                    frame = cv2.rotate(frame, cv2.ROTATE_90_COUNTERCLOCKWISE)
                frames.append(frame)
                next_sample += 0.3
            frame_index += 1
        if len(frames) < 2:
            raise ValueError("The video is too short. Record a slow pan for a few seconds.")

        # If the final view overlaps the starting view, remove that repeated
        # endpoint before stitching so it does not appear twice at the seam.
        if len(frames) > 3:
            gray_start = cv2.cvtColor(frames[0], cv2.COLOR_BGR2GRAY)
            gray_end = cv2.cvtColor(frames[-1], cv2.COLOR_BGR2GRAY)
            orb = cv2.ORB_create(800)
            start_keypoints, start_descriptors = orb.detectAndCompute(gray_start, None)
            end_keypoints, end_descriptors = orb.detectAndCompute(gray_end, None)
            if (
                start_descriptors is not None
                and end_descriptors is not None
                and len(start_descriptors) >= 2
                and len(end_descriptors) >= 2
            ):
                try:
                    matches = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(
                        start_descriptors, end_descriptors, k=2
                    )
                except cv2.error:
                    matches = []
                overlap_matches = [
                    first for pair in matches if len(pair) == 2
                    for first, second in [pair] if first.distance < 0.7 * second.distance
                ]
                if len(overlap_matches) >= 18:
                    points_start = np.float32([start_keypoints[m.queryIdx].pt for m in overlap_matches])
                    points_end = np.float32([end_keypoints[m.trainIdx].pt for m in overlap_matches])
                    transform, inliers = cv2.findHomography(points_start, points_end, cv2.RANSAC, 5.0)
                    if transform is not None and inliers is not None and int(inliers.sum()) >= 14:
                        # Matching features are enough evidence that the end is
                        # a repeated view. Do not reject a video based on an
                        # estimated rotation angle: phone lenses, motion blur,
                        # and room symmetry make that estimate unreliable.
                        frames.pop()

        panorama = _stitch_rotation_strips(frames)
        last_status = cv2.Stitcher_ERR_NEED_MORE_IMGS
        # Panorama mode uses a spherical camera model suited to rotating in place.
        # Scan mode remains a fallback for predominantly planar wall sweeps.
        cv2.setNumThreads(2)
        cv2.ocl.setUseOpenCL(False)
        if panorama is None:
            # The ordered strip path handles a smooth room turn without OpenCV's
            # expensive global spherical warp. Keep the general stitcher as a
            # fallback for shorter or mostly static clips.
            stitch_frames = frames
            if len(stitch_frames) > 10:
                indices = np.linspace(0, len(stitch_frames) - 1, 10, dtype=int)
                stitch_frames = [stitch_frames[index] for index in indices]
            for mode in (cv2.Stitcher_PANORAMA, cv2.Stitcher_SCANS):
                stitcher = cv2.Stitcher_create(mode)
                stitcher.setPanoConfidenceThresh(0.25)
                stitcher.setRegistrationResol(0.2)
                stitcher.setSeamEstimationResol(0.1)
                try:
                    last_status, candidate = stitcher.stitch(stitch_frames)
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
    return Response(
        content=image_bytes,
        media_type="image/jpeg",
        # A video upload is intended to represent one room turn. Allow the
        # viewer to move continuously across its seam after every successful stitch.
        headers={"X-Panorama-Wrap": "true"},
    )


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True, check_dir=False), name="frontend")

