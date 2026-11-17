# Personal Video Studio — v0.2.0

A local-first browser video editing foundation with multi-clip sequencing, per-clip trim points, background audio preview, project settings save/load, and a FastAPI + FFmpeg single-clip export endpoint.

## v0.2 features
- Import multiple MP4, MOV, WEBM, and MKV clips.
- Select clips and reorder them in the sequence.
- Apply independent In/Out trim points to each clip.
- Preview an imported background audio file while previewing the selected video.
- Save project settings to `.pvsproject` JSON and reopen the project file.
- Responsive editor interface and backend health indicator.
- Export the selected clip through the FastAPI + FFmpeg backend.

## Important limitations
- Project files save edit settings and media filenames, **not the original media files**. Re-import the source videos when reopening a project.
- Background audio is currently for browser preview; it is not mixed into the exported MP4.
- Export currently renders the selected clip only, not the complete multi-clip sequence.
- The AI Director is a roadmap placeholder. No AI scene understanding, auto-editing, motion-graphics generation, or AI finishing is active.
- GitHub Pages can host the static interface, but it cannot run FastAPI or FFmpeg. The backend must be hosted separately for MP4 export.

## Requirements
Python 3.10+, FFmpeg and FFprobe on PATH, modern desktop browser.

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
