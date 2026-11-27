import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

/** Canvas panorama with bounded drag, spring feedback, inertia, and a minimap. */
const PanoramaViewer = forwardRef(function PanoramaViewer({ src, stops, snapToStops, onLoadError }, ref) {
  const viewRef = useRef(null);
  const mapRef = useRef(null);
  const imageRef = useRef(null);
  const offsetRef = useRef(0);
  const stretchRef = useRef(0);
  const pointerRef = useRef(null);
  const velocityRef = useRef(0);
  const frameRef = useRef(0);
  const stopsRef = useRef(stops);
  const snapRef = useRef(snapToStops);
  const [ready, setReady] = useState(false);
  const [canPan, setCanPan] = useState(false);
  const canPanRef = useRef(false);
  stopsRef.current = stops;
  snapRef.current = snapToStops;

  const metrics = useCallback(() => {
    const image = imageRef.current;
    const canvas = viewRef.current;
    if (!image || !canvas) return { scale: 1, viewWidth: 0, maxOffset: 0 };
    const scale = canvas.clientHeight / image.height;
    const viewWidth = canvas.clientWidth / scale;
    return { scale, viewWidth, maxOffset: Math.max(0, image.width - viewWidth) };
  }, []);

  const draw = useCallback(() => {
    const image = imageRef.current;
    const view = viewRef.current;
    const map = mapRef.current;
    if (!image || !view || !map || !view.clientWidth || !map.clientWidth) return;

    const dpr = window.devicePixelRatio || 1;
    const viewWidthPx = Math.round(view.clientWidth * dpr);
    const viewHeightPx = Math.round(view.clientHeight * dpr);
    if (view.width !== viewWidthPx || view.height !== viewHeightPx) {
      view.width = viewWidthPx;
      view.height = viewHeightPx;
    }
    const { viewWidth, maxOffset } = metrics();
    const hasHorizontalOverflow = maxOffset > 1;
    if (canPanRef.current !== hasHorizontalOverflow) {
      canPanRef.current = hasHorizontalOverflow;
      setCanPan(hasHorizontalOverflow);
    }
    const imageScale = view.height / image.height;
    const ctx = view.getContext("2d");
    ctx.fillStyle = "#141914";
    ctx.fillRect(0, 0, view.width, view.height);
    const imageWidth = image.width * imageScale;
    const centeredOffset = maxOffset === 0 ? (view.width - imageWidth) / 2 : 0;
    ctx.drawImage(image, centeredOffset - offsetRef.current * imageScale + stretchRef.current * dpr, 0, imageWidth, view.height);

    for (const stop of stopsRef.current) {
      const x = centeredOffset + (stop.center - offsetRef.current) * imageScale + stretchRef.current * dpr;
      if (x < -20 * dpr || x > view.width + 20 * dpr) continue;
      ctx.beginPath();
      ctx.moveTo(x, 48 * dpr);
      ctx.lineTo(x, view.height);
      ctx.setLineDash([3 * dpr, 6 * dpr]);
      ctx.strokeStyle = "#d6f27672";
      ctx.lineWidth = dpr;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(x, 30 * dpr, 11 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = "#d6f276";
      ctx.fill();
      ctx.fillStyle = "#20291b";
      ctx.font = `500 ${10 * dpr}px 'DM Mono', monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(stop.id), x, 30 * dpr);
    }

    const mapDpr = window.devicePixelRatio || 1;
    const mapWidth = Math.round(map.clientWidth * mapDpr);
    const mapHeight = Math.round(map.clientHeight * mapDpr);
    if (map.width !== mapWidth || map.height !== mapHeight) {
      map.width = mapWidth;
      map.height = mapHeight;
    }
    const mapCtx = map.getContext("2d");
    mapCtx.clearRect(0, 0, mapWidth, mapHeight);
    const mapScale = Math.min(mapWidth / image.width, mapHeight / image.height);
    const imageMapWidth = image.width * mapScale;
    const imageMapHeight = image.height * mapScale;
    const imageMapX = (mapWidth - imageMapWidth) / 2;
    const imageMapY = (mapHeight - imageMapHeight) / 2;
    mapCtx.fillStyle = "#283229";
    mapCtx.fillRect(0, 0, mapWidth, mapHeight);
    mapCtx.drawImage(image, imageMapX, imageMapY, imageMapWidth, imageMapHeight);
    mapCtx.fillStyle = "#10151055";
    mapCtx.fillRect(imageMapX, imageMapY, imageMapWidth, imageMapHeight);
    const boxX = imageMapX + (offsetRef.current / image.width) * imageMapWidth;
    const boxWidth = Math.min(imageMapWidth, (viewWidth / image.width) * imageMapWidth);
    mapCtx.fillStyle = "#d6f27638";
    mapCtx.fillRect(boxX, 0, boxWidth, mapHeight);
    mapCtx.strokeStyle = "#d6f276";
    mapCtx.lineWidth = 2 * mapDpr;
    mapCtx.strokeRect(boxX, imageMapY + 1, boxWidth, Math.max(1, imageMapHeight - 2));
    for (const stop of stopsRef.current) {
      const x = (stop.center / image.width) * mapWidth;
      mapCtx.fillStyle = "#f5f4ea";
      mapCtx.fillRect(x - mapDpr, imageMapY, 2 * mapDpr, imageMapHeight);
    }
  }, [metrics]);

  useEffect(() => {
    const image = new Image();
    setReady(false);
    image.onload = () => {
      imageRef.current = image;
      offsetRef.current = 0;
      stretchRef.current = 0;
      setReady(true);
      requestAnimationFrame(draw);
    };
    image.onerror = () => onLoadError?.();
    image.src = src;
    return () => { image.onload = null; image.onerror = null; };
  }, [src, draw, onLoadError]);

  useEffect(() => {
    if (!ready) return undefined;
    draw();
    const observer = new ResizeObserver(draw);
    if (viewRef.current) observer.observe(viewRef.current);
    if (mapRef.current) observer.observe(mapRef.current);
    return () => observer.disconnect();
  }, [draw, ready, stops]);

  const animateTo = useCallback((target, duration = 520) => {
    cancelAnimationFrame(frameRef.current);
    const startOffset = offsetRef.current;
    const startTime = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - progress, 4);
      offsetRef.current = startOffset + (target - startOffset) * eased;
      stretchRef.current *= 1 - eased;
      draw();
      if (progress < 1) frameRef.current = requestAnimationFrame(tick);
      else stretchRef.current = 0;
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [draw]);

  const nearestStop = useCallback((direction = 0) => {
    const { viewWidth } = metrics();
    const currentCenter = offsetRef.current + viewWidth / 2;
    const ordered = [...stopsRef.current].sort((a, b) => a.center - b.center);
    if (!ordered.length) return null;
    let target = ordered.reduce((best, item) => Math.abs(item.center - currentCenter) < Math.abs(best.center - currentCenter) ? item : best);
    if (direction > 0) target = ordered.find((item) => item.center > currentCenter + 8) || ordered[0];
    if (direction < 0) target = [...ordered].reverse().find((item) => item.center < currentCenter - 8) || ordered.at(-1);
    return target;
  }, [metrics]);

  useImperativeHandle(ref, () => ({
    getCenter() {
      return offsetRef.current + metrics().viewWidth / 2;
    },
    getPanoramaWidth() {
      return imageRef.current?.width || 0;
    },
    jumpToCenter(center) {
      const { viewWidth, maxOffset } = metrics();
      animateTo(clamp(center - viewWidth / 2, 0, maxOffset));
    },
    moveToStop(direction) {
      const stop = nearestStop(direction);
      if (!stop) return false;
      const { viewWidth, maxOffset } = metrics();
      animateTo(clamp(stop.center - viewWidth / 2, 0, maxOffset));
      return stop.id;
    },
    detectEdges() {
      const image = imageRef.current;
      if (!image) return [];
      const width = Math.min(2200, image.width);
      const height = Math.min(500, Math.max(100, Math.round(image.height * width / image.width)));
      const sample = document.createElement("canvas");
      sample.width = width;
      sample.height = height;
      const sampleContext = sample.getContext("2d", { willReadFrequently: true });
      sampleContext.drawImage(image, 0, 0, width, height);
      const pixels = sampleContext.getImageData(0, 0, width, height).data;
      const scores = new Float64Array(width);
      for (let x = 2; x < width - 2; x++) {
        let score = 0;
        for (let y = 0; y < height; y += 2) {
          const left = (y * width + x - 1) * 4;
          const right = (y * width + x + 1) * 4;
          const luminanceLeft = pixels[left] * .299 + pixels[left + 1] * .587 + pixels[left + 2] * .114;
          const luminanceRight = pixels[right] * .299 + pixels[right + 1] * .587 + pixels[right + 2] * .114;
          score += Math.abs(luminanceRight - luminanceLeft);
        }
        scores[x] = score;
      }
      const smoothed = scores.map((_, x) => (scores[x - 2] + scores[x - 1] + scores[x] + scores[x + 1] + scores[x + 2]) / 5);
      const threshold = smoothed.reduce((best, score) => Math.max(best, score), 0) * .3;
      const peaks = [];
      for (let x = 4; x < width - 4; x++) {
        if (smoothed[x] >= threshold && smoothed[x] >= smoothed[x - 1] && smoothed[x] > smoothed[x + 1]) peaks.push({ x, score: smoothed[x] });
      }
      peaks.sort((a, b) => b.score - a.score);
      const spaced = [];
      const minimumSpacing = Math.max(48, Math.round(width * .035));
      for (const peak of peaks) {
        if (spaced.length === 18) break;
        if (spaced.every((item) => Math.abs(item.x - peak.x) >= minimumSpacing)) spaced.push(peak);
      }
      return spaced.map((peak) => (peak.x / width) * image.width);
    },
  }), [animateTo, metrics, nearestStop]);

  function onPointerDown(event) {
    if (!imageRef.current) return;
    cancelAnimationFrame(frameRef.current);
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = {
      id: event.pointerId,
      startX: event.clientX,
      lastX: event.clientX,
      lastTime: performance.now(),
      startOffset: offsetRef.current,
    };
  }

  function onPointerMove(event) {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    const { scale, maxOffset } = metrics();
    const rawOffset = pointer.startOffset - (event.clientX - pointer.startX) / scale;
    offsetRef.current = clamp(rawOffset, 0, maxOffset);
    const overshoot = rawOffset < 0 ? -rawOffset : rawOffset > maxOffset ? maxOffset - rawOffset : 0;
    stretchRef.current = Math.sign(overshoot) * Math.min(26, Math.abs(overshoot) * scale * .32);
    const now = performance.now();
    velocityRef.current = -((event.clientX - pointer.lastX) / scale) / Math.max(8, now - pointer.lastTime);
    pointer.lastX = event.clientX;
    pointer.lastTime = now;
    draw();
  }

  function onPointerUp(event) {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    pointerRef.current = null;
    // One stop should not pull every drag back to the same center.
    if (snapRef.current && stopsRef.current.length > 1) {
      const stop = nearestStop();
      if (stop) {
        const { viewWidth, maxOffset } = metrics();
        animateTo(clamp(stop.center - viewWidth / 2, 0, maxOffset));
        return;
      }
    }
    const { maxOffset } = metrics();
    const destination = clamp(offsetRef.current + velocityRef.current * 260, 0, maxOffset);
    animateTo(destination, clamp(Math.abs(destination - offsetRef.current) * .65, 220, 850));
  }

  function onKeyDown(event) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    if (stopsRef.current.length) {
      const stop = nearestStop(event.key === "ArrowRight" ? 1 : -1);
      if (stop) {
        const { viewWidth, maxOffset } = metrics();
        animateTo(clamp(stop.center - viewWidth / 2, 0, maxOffset));
      }
      return;
    }
    const { viewWidth, maxOffset } = metrics();
    animateTo(clamp(offsetRef.current + (event.key === "ArrowRight" ? 1 : -1) * viewWidth * .72, 0, maxOffset));
  }

  function onMapPointerDown(event) {
    if (!imageRef.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const mapScale = Math.min(bounds.width / imageRef.current.width, bounds.height / imageRef.current.height);
    const imageLeft = (bounds.width - imageRef.current.width * mapScale) / 2;
    const imageX = clamp((event.clientX - bounds.left - imageLeft) / mapScale, 0, imageRef.current.width);
    const { viewWidth, maxOffset } = metrics();
    animateTo(clamp(imageX - viewWidth / 2, 0, maxOffset));
  }

  return (
    <div className={`panorama-view ${ready ? "is-ready" : "is-loading"}`}>
      <div className="panorama-frame">
        <canvas
          ref={viewRef}
          className="panorama-canvas"
          aria-label="Panorama. Drag or use arrow keys to look around."
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        />
        <div className="panorama-guidance"><span className="move-icon">↔</span> {canPan ? "DRAG TO LOOK AROUND" : "PAN TOO NARROW"}</div>
        {ready && !canPan && <div className="panorama-narrow-hint">This pan is too narrow to explore. Record with your phone sideways and sweep slowly from left to right.</div>}
        <div className="panorama-caption"><span>INTERACTIVE VIEW</span><span>01 — 01</span></div>
        {!ready && <div className="panorama-loading">Loading your view…</div>}
      </div>
      <div className="minimap-block">
        <div className="minimap-label"><span>THE WHOLE PAN</span><span>CLICK TO JUMP</span></div>
        <canvas
          ref={mapRef}
          className="minimap-canvas"
          aria-label="Panorama overview. Tap to jump to a location."
          tabIndex={0}
          onPointerDown={onMapPointerDown}
          onKeyDown={(event) => {
            if (!imageRef.current) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              const { viewWidth, maxOffset } = metrics();
              animateTo(clamp(imageRef.current.width / 2 - viewWidth / 2, 0, maxOffset));
            }
          }}
        />
        <div className="minimap-ends"><span>LEFT EDGE</span><span>RIGHT EDGE</span></div>
      </div>
    </div>
  );
});

export default PanoramaViewer;
