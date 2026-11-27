# Edge Stop Viewer

Record a slow camera pan or upload an existing panorama, then drag through the stitched view and save points of interest as stops.

## Run locally

The frontend is React 19, built with Vite 7. The Python backend serves the production build and uses FastAPI with OpenCV. Use Node 20.19 or newer and Python 3.10 or newer.

From this directory, install the frontend packages and create the production build:

```powershell
npm install
npm run build
```

Then create and activate a Python virtual environment, install the backend packages, and start the server:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open <http://127.0.0.1:8000>. Camera access requires `localhost` or HTTPS and browser permission. The app prefers the rear camera. Record a steady left-to-right pan in good light; videos are limited to 30 seconds. The `/stitch` endpoint samples a frame every 0.3 seconds, resizes frames to 1000 pixels wide, stitches with OpenCV's panorama mode, trims black borders, and returns a JPEG.

For frontend development with Vite hot reload, start FastAPI in one terminal, then run `npm run dev` in another and open <http://127.0.0.1:5173>.

## Deploy to Vercel

The included `vercel.json` builds the Vite frontend into `app/static` and routes `/stitch` to the FastAPI Python function. The browser recorder uses a lower bitrate to keep typical 30-second clips within the default function upload limit. Larger existing video files may need to be shortened or compressed before upload.

## Create a sample video

Generate a synthetic, textured pan video for trying the stitch endpoint without a camera:

```powershell
python tools/create_sample_video.py sample-pan.mp4
```

The generator creates a small, synthetic 1.5-second sweep for a quick local check.

Then open the app, choose the video file, and press **Stitch video**. The resulting panorama stays in the browser; nothing is saved on the server.

## Notes

- Input panorama images are loaded directly in the browser and are not sent to the backend.
- **Detect edges** scores horizontal luminance gradients by image column, smooths the score, and adds the strongest spaced peaks as stops.
- The in-memory viewer and its stop pins reset when the page is reloaded.
