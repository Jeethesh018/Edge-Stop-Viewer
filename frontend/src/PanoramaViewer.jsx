import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

/** Canvas panorama with bounded or continuous wraparound drag, pins, and a minimap. */
const PanoramaViewer = forwardRef(function PanoramaViewer({ src, stops, snapToStops, wrap = false, onReady, onLoadError }, ref) {
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
  const wrapRef = useRef(wrap);
  const [ready, setReady] = useState(false);
  const [canPan, setCanPan] = useState(false);
  const canPanRef = useRef(false);
  stopsRef.current = stops;
  snapRef.current = snapToStops;
  wrapRef.current = wrap;

  const metrics = useCallback(() => {
    const image = imageRef.current;
    const canvas = viewRef.current;
    if (!image || !canvas) return { scale: 1, viewWidth: 0, maxOffset: 0 };
    const scale = canvas.clientHeight / image.height;
    const viewWidth = canvas.clientWidth / scale;
    const maxOffset = wrapRef.current && image.width > viewWidth
      ? image.width
      : Math.max(0, image.width - viewWidth);
    return { scale, viewWidth, maxOffset };
  }, []);

  const normalizeOffset = useCallback((value) => {
    const image = imageRef.current;
    const { maxOffset } = metrics();
    if (wrapRef.current && image && maxOffset === image.width) {
      return ((value % image.width) + image.width) % image.width;
    }
    return clamp(value, 0, maxOffset);
  }, [metrics]);

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
    const circular = wrapRef.current && maxOffset === image.width;
    const offset = circular ? normalizeOffset(offsetRef.current) : offsetRef.current;
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
    if (circular) {
      for (let x = -(offset * imageScale); x < view.width; x += imageWidth) {
        ctx.drawImage(image, x + stretchRef.current * dpr, 0, imageWidth, view.height);
      }
    } else {
      ctx.drawImage(image, centeredOffset - offset * imageScale + stretchRef.current * dpr, 0, imageWidth, view.height);
    }

    for (const stop of stopsRef.current) {
      const distance = circular ? ((stop.center - offset + image.width) % image.width) : stop.center - offset;
      const x = centeredOffset + distance * imageScale + stretchRef.current * dpr;
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
    const boxX = imageMapX + (offset / image.width) * imageMapWidth;
    const boxWidth = Math.min(imageMapWidth, (viewWidth / image.width) * imageMapWidth);
    mapCtx.fillStyle = "#d6f27638";
    mapCtx.strokeStyle = "#d6f276";
    mapCtx.lineWidth = 2 * mapDpr;
    const firstBoxWidth = Math.min(boxWidth, imageMapX + imageMapWidth - boxX);
    mapCtx.fillRect(boxX, imageMapY, firstBoxWidth, imageMapHeight);
    mapCtx.strokeRect(boxX, imageMapY + 1, firstBoxWidth, Math.max(1, imageMapHeight - 2));
    if (circular && firstBoxWidth < boxWidth) {
      const remaining = boxWidth - firstBoxWidth;
      mapCtx.fillRect(imageMapX, imageMapY, remaining, imageMapHeight);
      mapCtx.strokeRect(imageMapX, imageMapY + 1, remaining, Math.max(1, imageMapHeight - 2));
    }
    for (const stop of stopsRef.current) {
      const x = imageMapX + (stop.center / image.width) * imageMapWidth;
      mapCtx.fillStyle = "#f5f4ea";
      mapCtx.fillRect(x - mapDpr, imageMapY, 2 * mapDpr, imageMapHeight);
    }
  }, [metrics, normalizeOffset]);

  useEffect(() => {
    const image = new Image();
    setReady(false);
    image.onload = () => {
      imageRef.current = image;
      offsetRef.current = 0;
      stretchRef.current = 0;
      setReady(true);
      requestAnimationFrame(() => {
        draw();
        onReady?.({ width: image.width, height: image.height, wrap: wrapRef.current });
      });
    };
    image.onerror = () => onLoadError?.();
    image.src = src;
    return () => { image.onload = null; image.onerror = null; };
  }, [src, draw, onLoadError, onReady]);

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
    let finalTarget = normalizeOffset(target);
    const image = imageRef.current;
    const { maxOffset } = metrics();
    if (wrapRef.current && image && maxOffset === image.width) {
      let delta = finalTarget - normalizeOffset(startOffset);
      if (delta > image.width / 2) delta -= image.width;
      if (delta < -image.width / 2) delta += image.width;
      finalTarget = startOffset + delta;
    }
    const startTime = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - progress, 4);
      offsetRef.current = startOffset + (finalTarget - startOffset) * eased;
      stretchRef.current *= 1 - eased;
      draw();
      if (progress < 1) frameRef.current = requestAnimationFrame(tick);
      else {
        offsetRef.current = normalizeOffset(offsetRef.current);
        stretchRef.current = 0;
        draw();
      }
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [draw, metrics, normalizeOffset]);

  const nearestStop = useCallback((direction = 0) => {
    const { viewWidth } = metrics();
    const image = imageRef.current;
    const circular = wrapRef.current && image && image.width > viewWidth;
    const currentCenter = circular
      ? normalizeOffset(offsetRef.current + viewWidth / 2)
      : offsetRef.current + viewWidth / 2;
    const ordered = [...stopsRef.current].sort((a, b) => a.center - b.center);
    if (!ordered.length) return null;
    const forwardDistance = (center) => circular ? ((center - currentCenter + image.width) % image.width) : center - currentCenter;
    const backwardDistance = (center) => circular ? ((currentCenter - center + image.width) % image.width) : currentCenter - center;
    const circularDistance = (center) => circular
      ? Math.min(forwardDistance(center), backwardDistance(center))
      : Math.abs(center - currentCenter);
    let target = ordered.reduce((best, item) => circularDistance(item.center) < circularDistance(best.center) ? item : best);
    if (direction > 0) target = ordered.filter((item) => forwardDistance(item.center) > 8).sort((a, b) => forwardDistance(a.center) - forwardDistance(b.center))[0] || target;
    if (direction < 0) target = ordered.filter((item) => backwardDistance(item.center) > 8).sort((a, b) => backwardDistance(a.center) - backwardDistance(b.center))[0] || target;
    return target;
  }, [metrics, normalizeOffset]);

  useImperativeHandle(ref, () => ({
    getCenter() {
      const { viewWidth } = metrics();
      const image = imageRef.current;
      return wrapRef.current && image && image.width > viewWidth
        ? normalizeOffset(offsetRef.current + viewWidth / 2)
        : offsetRef.current + viewWidth / 2;
    },
    getPanoramaWidth() {
      return imageRef.current?.width || 0;
    },
    jumpToCenter(center) {
      const { viewWidth, maxOffset } = metrics();
      animateTo(normalizeOffset(center - viewWidth / 2));
    },
    moveToStop(direction) {
      const stop = nearestStop(direction);
      if (!stop) return false;
      const { viewWidth, maxOffset } = metrics();
      animateTo(normalizeOffset(stop.center - viewWidth / 2));
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
      if (wrapRef.current && spaced.length >= 4) {
        const quarter = width / 4;
        const tolerance = width * .12;
        let bestCorners = null;
        let bestScore = -Infinity;
        for (const phase of spaced) {
          const chosen = [];
          let score = 0;
          for (let wall = 0; wall < 4; wall++) {
            const expected = (phase.x + wall * quarter) % width;
            const nearest = spaced
              .filter((peak) => chosen.every((item) => item !== peak))
              .map((peak) => {
                const distance = Math.abs(peak.x - expected);
                return { peak, distance: Math.min(distance, width - distance) };
              })
              .sort((a, b) => a.distance - b.distance)[0];
            if (!nearest || nearest.distance > tolerance) break;
            chosen.push(nearest.peak);
            score += nearest.peak.score - nearest.distance * .2;
          }
          if (chosen.length === 4 && score > bestScore) {
            bestCorners = chosen;
            bestScore = score;
          }
        }
        if (bestCorners) {
          return bestCorners.sort((a, b) => a.x - b.x).map((peak) => (peak.x / width) * image.width);
        }
        const likelyCorners = [];
        for (const peak of spaced) {
          const distantFromAll = likelyCorners.every((item) => {
            const distance = Math.abs(item.x - peak.x);
            return Math.min(distance, width - distance) >= width * .14;
          });
          if (distantFromAll) likelyCorners.push(peak);
          if (likelyCorners.length === 4) break;
        }
        return likelyCorners.sort((a, b) => a.x - b.x).map((peak) => (peak.x / width) * image.width);
      }
      return spaced.map((peak) => (peak.x / width) * image.width);
    },
  }), [animateTo, metrics, nearestStop, normalizeOffset]);

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
    const circular = wrapRef.current && maxOffset === imageRef.current.width;
    offsetRef.current = normalizeOffset(rawOffset);
    const overshoot = circular ? 0 : rawOffset < 0 ? -rawOffset : rawOffset > maxOffset ? maxOffset - rawOffset : 0;
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
        animateTo(normalizeOffset(stop.center - viewWidth / 2));
        return;
      }
    }
    const { maxOffset } = metrics();
    const destination = normalizeOffset(offsetRef.current + velocityRef.current * 260);
    animateTo(destination, clamp(Math.abs(destination - offsetRef.current) * .65, 220, 850));
  }

  function onKeyDown(event) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    if (stopsRef.current.length) {
      const stop = nearestStop(event.key === "ArrowRight" ? 1 : -1);
      if (stop) {
        const { viewWidth, maxOffset } = metrics();
        animateTo(normalizeOffset(stop.center - viewWidth / 2));
      }
      return;
    }
    const { viewWidth, maxOffset } = metrics();
    animateTo(normalizeOffset(offsetRef.current + (event.key === "ArrowRight" ? 1 : -1) * viewWidth * .72));
  }

  function onMapPointerDown(event) {
    if (!imageRef.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const mapScale = Math.min(bounds.width / imageRef.current.width, bounds.height / imageRef.current.height);
    const imageLeft = (bounds.width - imageRef.current.width * mapScale) / 2;
    const imageX = clamp((event.clientX - bounds.left - imageLeft) / mapScale, 0, imageRef.current.width);
    const { viewWidth, maxOffset } = metrics();
    animateTo(normalizeOffset(imageX - viewWidth / 2));
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
        {ready && !canPan && <div className="panorama-narrow-hint">This panorama is too narrow to explore. Hold your phone sideways and make one full, slow turn around the room.</div>}
        <div className="panorama-caption"><span>INTERACTIVE VIEW</span><span>01 — 01</span></div>
        {!ready && <div className="panorama-loading">Loading your view…</div>}
      </div>
      <div className="minimap-block">
        <div className="minimap-label"><span>{wrap ? "FULL ROOM / 360°" : "THE WHOLE PAN"}</span><span>TAP TO JUMP</span></div>
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
              animateTo(normalizeOffset(imageRef.current.width / 2 - viewWidth / 2));
            }
          }}
        />
        <div className="minimap-ends"><span>{wrap ? "START" : "LEFT EDGE"}</span><span>{wrap ? "LOOP BACK" : "RIGHT EDGE"}</span></div>
      </div>
    </div>
  );
});

export default PanoramaViewer;
