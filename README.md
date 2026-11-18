# Personal Video Studio — v0.6.0

A local-first browser video editing workspace with multi-clip sequencing, a clip Inspector, and a FastAPI + FFmpeg sequence renderer.

## Interface refresh
- Desktop editing workspace inspired by professional nonlinear editors: Project panel on the left, Program Monitor in the center, Effect Controls on the right, and a full-width Timeline below.
- Compact application menu and workspace strip, neutral charcoal panel styling, restrained blue selection accents, and denser controls.
- Responsive tablet and mobile layouts. Existing editing controls and project/export workflows are retained.

## v0.6 AI foundation
- Docker image installs FFmpeg/FFprobe and Python dependencies for a consistent backend runtime.
- Optional local speech recognition using faster-whisper (Whisper multilingual model); first transcription downloads the configured model on the backend host.
- `POST /api/transcribe` generates timestamped SRT subtitles for an imported clip. Supports auto language detection and language hints including English, Urdu, Hindi, Arabic, Spanish, French, German, Portuguese, Turkish, Chinese and Japanese.
- `GET /api/ai/status` reports whether the speech model package is installed and loaded.
- Default model is `small` on CPU with INT8; configure `PVS_WHISPER_MODEL`, `PVS_WHISPER_DEVICE`, `PVS_WHISPER_COMPUTE_TYPE`, and `PVS_MODEL_CACHE` for a suitably provisioned host.
- AI captions are downloaded as SRT files. They are not yet burned into sequence exports or synchronized as editable timeline caption clips.

## v0.5 features
- Clip Inspector: trim in/out, scale, rotation, X/Y position, opacity, playback speed, fade in/out, clip volume, brightness, contrast, and saturation.
- Inspector adjustments are saved in project files and restored when the source media is re-imported.
- Live preview for transform, opacity, speed, clip volume, and basic color adjustments.
- Export dialog with Match Source, 720p, 1080p, 2K (1440p), and 4K (2160p) resolution choices.
- Quality presets: High Quality, Balanced, and Smaller File.
- Export formats: MP4, MOV, MKV, WebM, AVI, and animated GIF where the connected FFmpeg build provides the required encoders.
- The frontend checks `/api/capabilities` and disables formats the connected engine cannot encode.
- Full sequence export applies supported Inspector settings, soundtrack mix, selected aspect ratio, resolution, format, and quality.

## Important behavior and limitations
- GitHub Pages does not run FFmpeg or AI models. Build and host the Docker backend separately, then use **Connect engine** in the editor.
- The first AI transcription downloads a model from the model registry. Keep the model cache volume persistent where possible. Hosting and compute may incur charges; do not deploy a paid instance without reviewing its pricing.
- This AI integration currently provides speech transcription/subtitle files only. Automatic highlight selection, semantic scene understanding, generative motion graphics, and AI editing decisions are not implemented.
- Resolution choices specify output dimensions; upscaling a low-resolution source does not create genuine extra detail.
- GIF exports are silent and may be very large; audio is omitted by design.
- WebM, AVI, MOV, MKV, and GIF availability depends on the installed FFmpeg encoders. Only detected formats are selectable.
- Project files save edit settings and source filenames, **not the original media files**. Re-import source videos after reopening. Background audio must also be re-imported.
- Export requires the FastAPI backend and FFmpeg/FFprobe. GitHub Pages serves only the static frontend. Use **Connect engine** to enter the separately hosted FastAPI backend URL.
- This is not yet a complete AI editing system. AI scene understanding, automatic creative decisions, motion graphics generation, advanced transitions, multi-track editing, and advanced color tools remain future work.
- Set a long random `PVS_API_KEY` secret on any internet-accessible backend. Enter the same key when using **Connect engine**; it is stored only in that browser's local storage and is never committed to GitHub. The backend accepts unauthenticated processing requests only when `PVS_API_KEY` is unset (local development mode). Also configure upload limits, rate limits, disk quotas and resource controls before public production use.

## Requirements
Python 3.10+, FFmpeg and FFprobe on PATH, modern desktop browser. For the Docker backend, build with `docker build -t personal-video-studio .` and run with `docker run -p 10000:10000 -e PORT=10000 -e PVS_API_KEY=replace-with-a-long-random-secret -v pvs-model-cache:/var/cache/pvs-whisper personal-video-studio`. The first transcription downloads the Whisper model; allow outbound network access and sufficient disk/RAM. CPU inference is slower than a supported GPU.

## API
- `GET /api/health`
- `GET /api/capabilities` — available output encoders/formats
- `GET /api/ai/status` — local Whisper runtime status
- `POST /api/transcribe` — generate timestamped SRT captions using local Whisper
- `POST /api/analyze` — basic FFprobe metadata
- `POST /api/export` — legacy single-clip MP4 export
- `POST /api/export-sequence` — sequence render with per-clip adjustments and optional background audio

Never commit API keys or `.env` files. Do not send private footage to cloud services without consent.

## Deploy the backend on Render (free tier)
1. Open the Render Blueprint flow and select this GitHub repository: https://github.com/syedmohibabbas/personal-video-studio
2. Render detects `render.yaml`. Review the service and keep the plan set to **Free** before applying.
3. Render builds the Dockerfile, installs FFmpeg/FFprobe and starts FastAPI. The health check is `/api/health`.
4. After deployment, copy the service's public `https://...onrender.com` URL. In the editor choose **Connect engine**, paste that URL, then paste the generated `PVS_API_KEY` value from the Render service environment.
5. The blueprint auto-deploys future commits from `main`.

**Free-tier caveats:** the service can sleep when idle and the first request may take time to wake it. Its filesystem is ephemeral, so the Whisper model may need to download again after a restart. The blueprint uses the smaller `tiny` Whisper model to reduce memory use, but AI transcription may still exceed free-instance memory or time limits. Large video exports are not reliable on a free instance. Do not store private media or rely on this service for permanent files. No paid plan is selected by this blueprint.
