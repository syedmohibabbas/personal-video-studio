# Personal Video Studio — v0.1

A dark video-editing workspace foundation with browser preview, FastAPI backend, and FFmpeg trim/export.

## Included
- Responsive editor UI; import by picker or drag-and-drop
- Video preview and transport controls
- In/Out trim controls and timeline
- FFprobe metadata analysis and FFmpeg MP4 export
- API health check and GitHub Actions validation

## Important
The AI Director panel is a roadmap placeholder. v0.1 does **not** yet perform AI scene understanding, automatic creative editing, motion-graphics generation, or AI audio/color finishing. Those need real AI models/services integrated in a later release.

## Requirements
Python 3.10+, FFmpeg and FFprobe available on PATH, modern desktop browser.

## Run locally
```bash
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload
```
Open http://127.0.0.1:8000. Health check: `/api/health`.

## API
- `GET /api/health`
- `POST /api/analyze` multipart field `file`
- `POST /api/export` multipart fields `file`, `start`, `end`

Never commit API keys or `.env` files. Uploaded media is handled in temporary request directories. Do not send private footage to cloud services without consent.

## Roadmap
v0.2 multi-clip timeline/audio/project save; v0.3 captions, titles, transitions and keyframes; v0.4 AI transcription and footage understanding; v0.5 AI creative edit decisions and motion graphics; later desktop packaging and advanced finishing.
