import { useCallback, useEffect, useRef, useState } from "react";
import PanoramaViewer from "./PanoramaViewer.jsx";

function Mark({ className = "" }) {
  return <span className={`brand-symbol ${className}`} aria-hidden="true"><i /><i /><i /></span>;
}

function Chevron({ direction = "right" }) {
  return <svg className={`chevron chevron-${direction}`} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h9M8 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function RoomIllustration() {
  return (
    <div className="scene-card">
      <div className="scene-topline"><span>RESIDENCE / 01</span><span>38° 54′ 15.2″ N</span></div>
      <svg className="room-illustration" viewBox="0 0 760 530" role="img" aria-label="Illustrated interior with two marked architectural stops">
        <defs>
          <linearGradient id="roomWall" x1=".1" y1=".1" x2=".9" y2="1"><stop stopColor="#687461" /><stop offset="1" stopColor="#37463a" /></linearGradient>
          <linearGradient id="roomRight" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#56604c" /><stop offset="1" stopColor="#30382f" /></linearGradient>
          <linearGradient id="roomFloor" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#74715b" /><stop offset="1" stopColor="#383b31" /></linearGradient>
          <linearGradient id="windowLight" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#d3d2ab" /><stop offset="1" stopColor="#97a38a" /></linearGradient>
          <filter id="roomGrain"><feTurbulence type="fractalNoise" baseFrequency=".72" numOctaves="2" stitchTiles="stitch" /><feColorMatrix type="saturate" values="0" /><feComponentTransfer><feFuncA type="table" tableValues="0 .055" /></feComponentTransfer><feBlend in="SourceGraphic" mode="soft-light" /></filter>
        </defs>
        <rect width="760" height="530" fill="#2a332c" />
        <path d="M52 52h500v325H52z" fill="url(#roomWall)" />
        <path d="M552 52l156 45v280l-156 0z" fill="url(#roomRight)" />
        <path d="M52 377h656l-122 153H52z" fill="url(#roomFloor)" />
        <path d="M98 83h228v218H98z" fill="#333d34" />
        <path d="M111 96h202v192H111z" fill="url(#windowLight)" />
        <path d="M212 96v192M111 192h202" stroke="#687162" strokeWidth="8" />
        <path d="M378 105h107v272H378z" fill="#303b32" />
        <path d="M389 116h85v261h-85z" fill="#726d54" />
        <circle cx="460" cy="247" r="4" fill="#d2cf9c" />
        <path d="M540 389h112v92H540z" fill="#42493b" />
        <path d="M529 383h135v14H529z" fill="#969073" />
        <path d="M563 406v70M625 406v70" stroke="#8b896e" />
        <path d="M0 507h760" stroke="#c8c4a55c" />
        <path d="M70 407l135 123M173 407l135 123M276 407l135 123M379 407l135 123M482 407l135 123M585 407l135 123" stroke="#9c987447" />
        <g filter="url(#roomGrain)"><rect width="760" height="530" fill="#fff" opacity=".01" /></g>
        <path className="scene-scan" d="M170 0v530" />
        <g className="scene-pin" transform="translate(98 75)"><circle r="17" /><text y="4">01</text><path d="M17 0h86" /><rect x="103" y="-13" width="106" height="26" rx="2" /><text className="pin-label" x="111" y="4">WINDOW EDGE</text></g>
        <g className="scene-pin scene-pin-two" transform="translate(480 104)"><circle r="17" /><text y="4">02</text><path d="M17 0h39" /><rect x="56" y="-13" width="83" height="26" rx="2" /><text className="pin-label" x="64" y="4">THRESHOLD</text></g>
      </svg>
      <div className="scene-foot"><span>FIELD NOTE&nbsp; / &nbsp;014</span><span>DRAG TO EXPLORE <b>↔</b></span></div>
      <div className="scene-side-index">01 / 01</div>
    </div>
  );
}

function App() {
  const [screen, setScreen] = useState("home");
  const [panorama, setPanorama] = useState(null);
  const [stops, setStops] = useState([]);
  const [snapToStops, setSnapToStops] = useState(true);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [stream, setStream] = useState(null);
  const [recorder, setRecorder] = useState(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [processingStep, setProcessingStep] = useState(0);
  const imageInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const cameraRef = useRef(null);
  const recorderRef = useRef(null);
  const viewerRef = useRef(null);
  const cancelCaptureRef = useRef(false);
  const recordingStartedRef = useRef(0);
  const nextStopIdRef = useRef(1);

  useEffect(() => {
    if (cameraRef.current && stream) cameraRef.current.srcObject = stream;
  }, [stream, screen]);

  useEffect(() => () => {
    if (panorama?.owned) URL.revokeObjectURL(panorama.src);
  }, [panorama]);

  useEffect(() => {
    if (screen !== "camera" || !recording) return undefined;
    const timer = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - recordingStartedRef.current) / 1000);
      setElapsed(Math.min(seconds, 30));
      if (seconds >= 30) recorderRef.current?.state === "recording" && recorderRef.current.stop();
    }, 200);
    return () => window.clearInterval(timer);
  }, [recording, screen]);

  useEffect(() => {
    if (screen !== "processing") return undefined;
    const timers = [
      window.setTimeout(() => setProcessingStep(1), 1800),
      window.setTimeout(() => setProcessingStep(2), 5200),
      window.setTimeout(() => setProcessingStep(3), 12000),
    ];
    return () => timers.forEach(window.clearTimeout);
  }, [screen]);

  function goHome() {
    cancelCaptureRef.current = true;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    setRecorder(null);
    recorderRef.current = null;
    setRecording(false);
    setPanorama(null);
    setStops([]);
    setError("");
    setScreen("home");
  }

  function openPanorama(file) {
    if (!file) return;
    setPanorama({ src: URL.createObjectURL(file), owned: true });
    setStops([]);
    nextStopIdRef.current = 1;
    setStatusMessage("Panorama ready. Drag through the view or detect architectural edges.");
    setScreen("viewer");
  }

  const handlePanoramaError = useCallback(() => {
    setPanorama(null);
    setError("We couldn't open that image. Try a JPEG or PNG panorama.");
    setScreen("home");
  }, []);

  const handleViewerReady = useCallback(({ wrap }) => {
    if (!wrap) return;
    const corners = viewerRef.current?.detectEdges() || [];
    const automaticStops = corners.map((center, index) => ({ id: index + 1, center }));
    setStops(automaticStops);
    nextStopIdRef.current = automaticStops.length + 1;
    setStatusMessage(automaticStops.length === 4
      ? "Full room view ready. Four wall-corner stops were added automatically."
      : `Full room view ready. ${automaticStops.length} strong wall edges were added as stops.`);
  }, []);

  async function stitchVideo(file, filename = file.name || "camera-pan.webm") {
    setScreen("processing");
    setProcessingStep(0);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file, filename);
      const response = await fetch("/stitch", { method: "POST", body: formData });
      if (!response.ok) {
        let detail = "Couldn't stitch. Pan slower with good light and try again.";
        if (response.status === 413) {
          detail = "This video is too large for the deployment upload limit. Record in Edge Stop Viewer or shorten and compress the clip.";
        }
        try { detail = (await response.json()).detail || detail; } catch { /* Keep the clear fallback. */ }
        throw new Error(detail);
      }
      setPanorama({
        src: URL.createObjectURL(await response.blob()),
        owned: true,
        wrap: response.headers.get("X-Panorama-Wrap") === "true",
      });
      setStops([]);
      nextStopIdRef.current = 1;
      setStatusMessage("Panorama ready. Drag through the view or detect architectural edges.");
      setScreen("viewer");
    } catch (cause) {
      setError(cause.message || "Couldn't stitch. Pan slower with good light and try again.");
      setScreen("videoUpload");
    }
  }

  async function startCapture() {
    setError("");
    cancelCaptureRef.current = false;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError("This browser can't record video. Upload a pan video or open a panorama image instead.");
      return;
    }
    setScreen("camera");
    let cameraStream = null;
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      if (cancelCaptureRef.current) {
        cameraStream.getTracks().forEach((track) => track.stop());
        return;
      }
      setStream(cameraStream);
      const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
      const mimeType = types.find((type) => MediaRecorder.isTypeSupported(type));
      const recorderOptions = { videoBitsPerSecond: 850_000 };
      if (mimeType) recorderOptions.mimeType = mimeType;
      const nextRecorder = new MediaRecorder(cameraStream, recorderOptions);
      const chunks = [];
      nextRecorder.addEventListener("dataavailable", (event) => event.data.size && chunks.push(event.data));
      nextRecorder.addEventListener("stop", () => {
        cameraStream.getTracks().forEach((track) => track.stop());
        setStream(null);
        setRecording(false);
        if (cancelCaptureRef.current) return;
        const blob = new Blob(chunks, { type: nextRecorder.mimeType || "video/webm" });
        stitchVideo(blob, "camera-pan.webm");
      }, { once: true });
      recorderRef.current = nextRecorder;
      setRecorder(nextRecorder);
      recordingStartedRef.current = Date.now();
      setElapsed(0);
      nextRecorder.start(500);
      setRecording(true);
    } catch (cause) {
      cameraStream?.getTracks().forEach((track) => track.stop());
      setStream(null);
      setScreen("home");
      setError(cause.name === "NotAllowedError" || cause.name === "PermissionDeniedError"
        ? "Camera permission was denied. Allow camera access in your browser settings, or upload a video or panorama image."
        : `Couldn't open the camera. ${cause.message || "Upload a video or panorama image instead."}`);
    }
  }

  function stopCapture() {
    if (recorder?.state === "recording") recorder.stop();
  }

  function onVideoSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => {
      URL.revokeObjectURL(probe.src);
      if (probe.duration > 30.5) {
        setError("Videos must be 30 seconds or shorter.");
        setScreen("videoUpload");
      } else {
        stitchVideo(file);
      }
    };
    probe.onerror = () => {
      URL.revokeObjectURL(probe.src);
      setError("Couldn't read that video. Try an MP4, MOV, or WebM recording.");
      setScreen("videoUpload");
    };
    probe.src = URL.createObjectURL(file);
  }

  function addStop(center, announce = true) {
    if (!Number.isFinite(center)) return;
    const width = viewerRef.current?.getPanoramaWidth() || 0;
    if (!width) return;
    const duplicate = stops.find((stop) => Math.abs(stop.center - center) < width * .015);
    if (duplicate) {
      if (announce) setStatusMessage(`Already marked as stop ${duplicate.id}.`);
      return;
    }
    const stop = { id: nextStopIdRef.current++, center };
    setStops((current) => [...current, stop].sort((a, b) => a.center - b.center));
    if (announce) setStatusMessage(`Stop ${stop.id} saved.`);
  }

  function addCurrentStop() {
    addStop(viewerRef.current?.getCenter());
  }

  function detectEdges() {
    const centers = viewerRef.current?.detectEdges() || [];
    if (!centers.length) {
      setStatusMessage("No strong vertical edges found. Add a stop by hand instead.");
      return;
    }
    centers.forEach((center) => addStop(center, false));
    setStatusMessage(`Detected ${centers.length} strong vertical edges and added them as stops.`);
  }

  const processCopy = [
    ["Reading your pan", "Finding the clearest frames in your recording."],
    ["Matching the overlap", "Aligning shared details from frame to frame."],
    ["Stitching the scene", "Blending each frame into one continuous view."],
    ["Finishing the panorama", "A full room turn can take up to two minutes while the wall views are aligned."],
  ][processingStep];

  return (
    <div className={`app-shell screen-${screen}`}>
      <header className="topbar">
        <button className="wordmark" onClick={goHome} type="button" aria-label="Edge Stop Viewer home">
          <Mark /><span>EDGE<span className="wordmark-light">STOP</span></span>
        </button>
        <div className="topbar-center"><span className="online-dot" /> SPATIAL FIELDWORK / 01</div>
        <div className="topbar-right"><span>DESIGNED TO SEE MORE</span><span className="topbar-rule" /><span>01—03</span></div>
      </header>
      <input ref={imageInputRef} hidden type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; openPanorama(file); }} />
      <input ref={videoInputRef} hidden type="file" accept="video/*" onChange={onVideoSelected} />

      {screen === "home" && (
        <>
          <main className="home-main">
            <section className="hero-section">
              <div className="hero-copy">
                <div className="eyebrow"><span className="eyebrow-dash" /> A FULL TURN AROUND THE ROOM</div>
                <h1>See the whole<br /><em>space.</em></h1>
                <p className="hero-description">Record one slow turn inside a room. Explore the complete panorama and get wall-corner stops automatically.</p>
                <div className="hero-actions">
                  <button className="button button-dark" onClick={startCapture} type="button"><span className="button-record-dot" /> Start a capture <Chevron /></button>
                  <button className="button button-quiet" onClick={() => imageInputRef.current?.click()} type="button"><span className="button-open-icon">↗</span> Open a panorama</button>
                </div>
                <div className="capture-note"><span className="note-star">✳</span><span>Slow movement</span><i /><span>Good light</span><i /><span>30 sec max</span></div>
                {error && <p className="inline-error" role="alert">{error}</p>}
                <button className="quiet-link" onClick={() => { setError(""); setScreen("videoUpload"); }} type="button">Have a pan video? <span>Upload it here ↗</span></button>
              </div>
              <div className="hero-art"><RoomIllustration /></div>
              <div className="hero-index">01 <span>/</span> 03</div>
            </section>

            <section className="benefit-strip" aria-label="How it works">
              <div className="benefit-heading"><span className="eyebrow-dash" /> FROM PAN TO PLAN</div>
              <article><span className="benefit-number">01</span><div><h2>Capture the sweep</h2><p>Move slowly through your space and let the camera take it in.</p></div></article>
              <article><span className="benefit-number">02</span><div><h2>Explore every angle</h2><p>Drag through one continuous view with room to look around.</p></div></article>
              <article><span className="benefit-number">03</span><div><h2>Keep what matters</h2><p>Save a stop by hand or find strong edges automatically.</p></div></article>
              <div className="benefit-end">A BETTER FIELD NOTE <span>↗</span></div>
            </section>
          </main>
          <footer className="footer"><button className="wordmark footer-brand" onClick={goHome} type="button"><Mark /><span>EDGE<span className="wordmark-light">STOP</span></span></button><span>BUILT FOR THE SHAPE OF A PLACE</span><span>EST. 2026</span></footer>
        </>
      )}

      {screen === "camera" && (
        <main className="workspace capture-workspace">
          <div className="workspace-head"><div><div className="eyebrow"><span className="eyebrow-dash" /> LIVE CAPTURE / 360°</div><h1>One full turn.<br /><em>Take it slowly.</em></h1></div><button className="quiet-link" onClick={goHome} type="button">← Back to start</button></div>
          <div className="camera-frame">
            <video ref={cameraRef} autoPlay playsInline muted />
            <div className="camera-topline"><span className="rec-indicator"><i /> RECORDING</span><span className="timer-display">00:{String(elapsed).padStart(2, "0")} <span>/ 00:30</span></span></div>
            <div className="camera-instruction"><span className="instruction-icon">↻</span><span>Turn once, slowly, all the way around</span></div>
            <div className="camera-guides"><span>START</span><i><b /></i><span>BACK TO START</span></div>
            <div className="camera-corner camera-corner-tl" /><div className="camera-corner camera-corner-tr" /><div className="camera-corner camera-corner-bl" /><div className="camera-corner camera-corner-br" />
          </div>
          <div className="capture-footer"><p><span className="note-star">✳</span> Hold the phone sideways near the room center. Keep it level and finish where you started.</p><button className="button button-stop" onClick={stopCapture} type="button"><span className="stop-square" /> Stop &amp; stitch <Chevron /></button></div>
        </main>
      )}

      {screen === "processing" && (
        <main className="workspace processing-workspace">
          <div className="processing-orbit"><span /><i /></div>
          <div className="eyebrow"><span className="eyebrow-dash" /> WORKING ON YOUR PANORAMA</div>
          <h1>{processCopy[0]}</h1><p>{processCopy[1]}</p>
          <div className="processing-progress"><i /></div>
          <span className="processing-caption">FULL ROOM STITCHING CAN TAKE UP TO TWO MINUTES</span>
        </main>
      )}

      {screen === "viewer" && panorama && (
        <main className="workspace viewer-workspace">
          <div className="workspace-head viewer-head">
            <div><div className="eyebrow"><span className="eyebrow-dash" /> YOUR PANORAMA</div><h1>Take it all in.</h1></div>
            <div className="viewer-head-actions">
              <label className="snap-switch"><span>SNAP TO STOPS</span><input type="checkbox" checked={snapToStops} onChange={(event) => setSnapToStops(event.target.checked)} /><i /></label>
              <button className="quiet-link" onClick={goHome} type="button">↥ New panorama</button>
            </div>
          </div>
          <div className="viewer-card">
            <PanoramaViewer key={panorama.src} ref={viewerRef} src={panorama.src} stops={stops} snapToStops={snapToStops} wrap={panorama.wrap} onReady={handleViewerReady} onLoadError={handlePanoramaError} />
            <div className="viewer-controls">
              <div className="stop-navigation"><button className="nav-square" aria-label="Previous stop" onClick={() => viewerRef.current?.moveToStop(-1)} type="button">←</button><button className="nav-square" aria-label="Next stop" onClick={() => viewerRef.current?.moveToStop(1)} type="button">→</button><span className="control-divider" /><button className="button button-add" onClick={addCurrentStop} type="button"><span>＋</span> Add stop here</button><button className="button button-edge" onClick={detectEdges} type="button"><span>⌁</span> Detect edges</button></div>
              <span className="stop-total"><b>{String(stops.length).padStart(2, "0")}</b> {stops.length === 1 ? "STOP" : "STOPS"}</span>
            </div>
          </div>
          <div className="viewer-status" role="status" aria-live="polite"><span className="status-mark">✳</span>{statusMessage}</div>
        </main>
      )}

      {screen === "videoUpload" && (
        <main className="workspace upload-workspace">
          <div className="workspace-head"><div><div className="eyebrow"><span className="eyebrow-dash" /> STITCH A RECORDING</div><h1>Bring the pan.</h1></div><button className="quiet-link" onClick={goHome} type="button">← Back to start</button></div>
          <div className="upload-panel"><div className="upload-glyph">↥</div><h2>Choose a full room turn</h2><p>Upload one steady video recorded sideways as you turn once around the room and end where you started.</p><span className="upload-types">MP4 · MOV · WEBM &nbsp; / &nbsp; UP TO 30 SECONDS</span><button className="button button-dark" onClick={() => videoInputRef.current?.click()} type="button">Choose a video <Chevron /></button></div>
          {error && <p className="inline-error upload-error" role="alert">{error}</p>}
        </main>
      )}
    </div>
  );
}

export default App;
