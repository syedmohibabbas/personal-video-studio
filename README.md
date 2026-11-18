# Personal Video Studio — v0.5.0

A local-first browser video editing workspace with multi-clip sequencing, a clip Inspector, and a FastAPI + FFmpeg sequence renderer.

## Interface refresh
- Desktop editing workspace inspired by professional nonlinear editors: Project panel on the left, Program Monitor in the center, Effect Controls on the right, and a full-width Timeline below.
- Compact application menu and workspace strip, neutral charcoal panel styling, restrained blue selection accents, and denser controls.
- Responsive tablet and mobile layouts. Existing editing controls and project/export workflows are retained.

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
- Resolution choices specify output dimensions; upscaling a low-resolution source does not create genuine extra detail.
- GIF exports are silent and may be very large; audio is omitted by design.
- WebM, AVI, MOV, MKV, and GIF availability depends on the installed FFmpeg encoders. Only detected formats are selectable.
- Project files save edit settings and source filenames, **not the original media files**. Re-import source videos after reopening. Background audio must also be re-imported.
- Export requires the FastAPI backend and FFmpeg/FFprobe. GitHub Pages serves only the static frontend. Use **Connect engine** to enter the separately hosted FastAPI backend URL.
- This is not yet a complete AI editing system. AI scene understanding, automatic creative decisions, motion graphics generation, advanced transitions, multi-track editing, and advanced color tools remain future work.
- Do not expose a personal backend publicly without authentication, upload limits appropriate to the deployment, and resource controls.

## Requirements
Python 3.10+, FFmpeg and FFprobe on PATH, modern desktop browser.

## API
- `GET /api/health`
- `GET /api/capabilities` — available output encoders/formats
- `POST /api/analyze` — basic FFprobe metadata
- `POST /api/export` — legacy single-clip MP4 export
- `POST /api/export-sequence` — sequence render with per-clip adjustments and optional background audio

Never commit API keys or `.env` files. Do not send private footage to cloud services without consent.
