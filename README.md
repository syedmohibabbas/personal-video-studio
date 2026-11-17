# Personal Video Studio — v0.4.0

A local-first browser video editing workspace with multi-clip sequencing, trimming, drag-to-reorder timeline, soundtrack controls, project settings, and a FastAPI + FFmpeg sequence renderer.

## v0.4 features
- Export the **complete ordered sequence** as one MP4 instead of exporting only the selected clip.
- Mix an optional background music file into the exported sequence; soundtrack loops to the sequence duration and has an adjustable volume control.
- Drag clips left or right on the timeline to change sequence order.
- Save and restore project name, preview aspect ratio, clip trim points, and soundtrack volume.
- Landscape (16:9) and portrait (9:16) output selection follows the preview aspect setting.
- Retains media import, clip selection, trim controls, fullscreen preview, and keyboard shortcuts.

## Known limitations
- Project files save edit settings and source filenames, **not the original media files**. Re-import the same source videos after reopening a project. Background audio must also be re-imported.
- Sequence rendering requires the FastAPI backend and FFmpeg/FFprobe. GitHub Pages serves only the static frontend. Use **Connect engine** in the footer to enter the separately hosted FastAPI backend URL; the backend allows the project's GitHub Pages origin and local development origins.
- Rendering is a straightforward ordered cut/concat workflow. Crossfades, advanced transitions, animated motion graphics, keyframes, color grading controls, and multi-track editing are not implemented yet.
- AI Director remains a roadmap item: AI scene understanding, automatic creative decisions, AI-generated motion graphics, and AI finishing are not active.
- The backend currently has no user accounts or cloud project storage. Treat it as a personal/private deployment and do not expose it publicly without adding authentication and resource controls.

## Requirements
Python 3.10+, FFmpeg and FFprobe on PATH, modern desktop browser.

## API
- `GET /api/health`
- `POST /api/analyze` — basic FFprobe metadata
- `POST /api/export` — legacy single-clip export
- `POST /api/export-sequence` — full ordered sequence render with optional background music

Never commit API keys or `.env` files. Do not send private footage to cloud services without consent.
