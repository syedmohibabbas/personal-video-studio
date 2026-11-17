# Personal Video Studio — v0.3.0

A local-first browser video editing foundation with a multi-clip media library, sequence ordering, clip trimming, preview controls, aspect-ratio preview, project settings, and a FastAPI + FFmpeg export endpoint.

## v0.3 features
- Rename projects; project names are shown in the workspace and saved in project files.
- Save and restore the selected preview aspect ratio (16:9 landscape or 9:16 portrait).
- Keyboard shortcuts: Space toggles playback, Left/Right arrows seek by 5 seconds, Ctrl/Cmd+S saves the project.
- Save project files with v0.3 metadata while retaining compatibility with earlier `.pvsproject` files.
- Retains v0.2 media import, clip ordering, per-clip trim points, audio preview, fullscreen preview, and single-clip export.

## Known limitations
- Project files save edit settings and media filenames, **not original media files**. Re-import source videos when reopening a project.
- Background audio is for browser preview only; it is not mixed into exported MP4 files.
- Export currently renders the selected clip only, not the complete multi-clip sequence.
- The AI Director remains a roadmap placeholder. No AI scene understanding, automatic creative editing, motion-graphics generation, or AI finishing is active.
- GitHub Pages hosts the static interface only. FastAPI and FFmpeg must be hosted separately for MP4 export.

## Requirements
Python 3.10+, FFmpeg and FFprobe on PATH, modern desktop browser.

## API
- `GET /api/health`
- `POST /api/analyze` multipart field `file`
- `POST /api/export` multipart fields `file`, `start`, `end`

Never commit API keys or `.env` files. Do not send private footage to cloud services without consent.
