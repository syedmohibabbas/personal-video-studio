from __future__ import annotations
import json, shutil, subprocess, tempfile
from pathlib import Path
from typing import Annotated
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.background import BackgroundTask

BASE_DIR = Path(__file__).resolve().parent.parent
MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024
ALLOWED_EXTENSIONS = {'.mp4', '.mov', '.webm', '.mkv'}
app = FastAPI(title='Personal Video Studio API', version='0.4.0')
app.add_middleware(CORSMiddleware, allow_origins=['https://syedmohibabbas.github.io'], allow_origin_regex=r'https?://(localhost|127\.0\.0\.1)(:\d+)?', allow_credentials=False, allow_methods=['GET','POST'], allow_headers=['*'])

def tool(name: str): return shutil.which(name)
def require_tools():
    ffmpeg, ffprobe = tool('ffmpeg'), tool('ffprobe')
    if not ffmpeg or not ffprobe: raise HTTPException(503, 'FFmpeg and FFprobe must be installed and available on PATH.')
    return ffmpeg, ffprobe
async def save_upload(upload: UploadFile, destination: Path):
    if Path(upload.filename or '').suffix.lower() not in ALLOWED_EXTENSIONS: raise HTTPException(400, 'Unsupported video format.')
    total = 0
    try:
        with destination.open('wb') as out:
            while chunk := await upload.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES: raise HTTPException(413, 'Video exceeds the 2 GB upload limit.')
                out.write(chunk)
    finally: await upload.close()
    if total == 0: raise HTTPException(400, 'Uploaded file is empty.')
def run(cmd):
    try: return subprocess.run(cmd, capture_output=True, text=True, timeout=3600, check=False)
    except subprocess.TimeoutExpired as exc: raise HTTPException(504, 'Media processing timed out.') from exc

@app.get('/api/health')
def health(): return {'status':'online','version':app.version,'ffmpeg_available':bool(tool('ffmpeg')),'ffprobe_available':bool(tool('ffprobe'))}

@app.post('/api/analyze')
async def analyze(file: Annotated[UploadFile, File()]):
    _, ffprobe = require_tools()
    with tempfile.TemporaryDirectory(prefix='pvs-analyze-') as td:
        source = Path(td) / ('source' + Path(file.filename or '').suffix.lower())
        await save_upload(file, source)
        result = run([ffprobe,'-v','error','-show_entries','format=duration,format_name:stream=codec_type,width,height,avg_frame_rate','-of','json',str(source)])
        if result.returncode: raise HTTPException(422, 'Could not read video metadata.')
        data = json.loads(result.stdout or '{}'); stream = next((s for s in data.get('streams',[]) if s.get('codec_type') == 'video'), {})
        fmt = data.get('format',{})
        return {'filename':file.filename,'duration':float(fmt.get('duration') or 0),'format':fmt.get('format_name'),'width':stream.get('width'),'height':stream.get('height'),'frame_rate':stream.get('avg_frame_rate')}

@app.post('/api/export')
async def export_video(file: Annotated[UploadFile, File()], start: Annotated[float, Form()], end: Annotated[float, Form()]):
    ffmpeg, _ = require_tools()
    if start < 0 or end <= start: raise HTTPException(400, 'Invalid trim range.')
    td = tempfile.mkdtemp(prefix='pvs-export-'); suffix = Path(file.filename or '').suffix.lower(); source = Path(td) / ('source' + suffix); output = Path(td) / 'personal-video-studio-export.mp4'
    try:
        await save_upload(file, source)
        result = run([ffmpeg,'-hide_banner','-loglevel','error','-y','-ss',str(start),'-i',str(source),'-t',str(end-start),'-map','0:v:0','-map','0:a?','-c:v','libx264','-preset','medium','-crf','20','-c:a','aac','-b:a','192k','-movflags','+faststart',str(output)])
        if result.returncode or not output.exists(): raise HTTPException(422, (result.stderr or 'FFmpeg export failed.')[-1200:])
        return FileResponse(output, media_type='video/mp4', filename=f'{Path(file.filename or "video").stem}-edit.mp4', background=BackgroundTask(shutil.rmtree, td, ignore_errors=True))
    except Exception:
        shutil.rmtree(td, ignore_errors=True)
        raise


@app.post('/api/export-sequence')
async def export_sequence(
    files: Annotated[list[UploadFile], File()],
    edits: Annotated[str, Form()],
    aspect: Annotated[str, Form()] = 'landscape',
    audio: Annotated[UploadFile | None, File()] = None,
    audio_volume: Annotated[float, Form()] = 0.35,
):
    ffmpeg, ffprobe = require_tools()
    if not files or len(files) > 30:
        raise HTTPException(400, 'Add between 1 and 30 clips to export.')
    if aspect not in {'landscape', 'portrait'}:
        raise HTTPException(400, 'Aspect must be landscape or portrait.')
    if not 0 <= audio_volume <= 1:
        raise HTTPException(400, 'Music volume must be between 0 and 1.')
    try:
        edit_list = json.loads(edits)
    except (TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(400, 'Invalid clip edit data.') from exc
    if not isinstance(edit_list, list) or len(edit_list) != len(files):
        raise HTTPException(400, 'Clip edit data does not match uploaded media.')

    td = Path(tempfile.mkdtemp(prefix='pvs-sequence-'))
    output = td / 'personal-video-studio-sequence.mp4'
    try:
        sources = []
        durations = []
        for index, upload in enumerate(files):
            source = td / f'clip-{index:02d}{Path(upload.filename or "").suffix.lower()}'
            await save_upload(upload, source)
            try:
                start = float(edit_list[index].get('start', 0))
                end = float(edit_list[index].get('end', 0))
            except (TypeError, ValueError, AttributeError) as exc:
                raise HTTPException(400, f'Invalid trim points for clip {index + 1}.') from exc
            if start < 0 or end <= start:
                raise HTTPException(400, f'Invalid trim range for clip {index + 1}.')
            probe = run([ffprobe, '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', str(source)])
            if probe.returncode:
                raise HTTPException(422, f'Could not read clip {index + 1}.')
            try:
                source_duration = float(probe.stdout.strip())
            except ValueError as exc:
                raise HTTPException(422, f'Could not determine duration for clip {index + 1}.') from exc
            if end > source_duration + 0.1:
                raise HTTPException(400, f'Trim end exceeds clip {index + 1} duration.')
            sources.append(source)
            durations.append(end - start)

        music_path = None
        if audio is not None and audio.filename:
            allowed_audio = {'.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'}
            suffix = Path(audio.filename).suffix.lower()
            if suffix not in allowed_audio:
                raise HTTPException(400, 'Unsupported background audio format.')
            music_path = td / f'background{suffix}'
            total = 0
            try:
                with music_path.open('wb') as out:
                    while chunk := await audio.read(1024 * 1024):
                        total += len(chunk)
                        if total > MAX_UPLOAD_BYTES:
                            raise HTTPException(413, 'Background audio exceeds the 2 GB upload limit.')
                        out.write(chunk)
            finally:
                await audio.close()
            if total == 0:
                raise HTTPException(400, 'Background audio file is empty.')

        width, height = (1080, 1920) if aspect == 'portrait' else (1920, 1080)
        command = [ffmpeg, '-hide_banner', '-loglevel', 'error', '-y']
        for edit, source in zip(edit_list, sources):
            command += ['-ss', str(float(edit['start'])), '-t', str(float(edit['end']) - float(edit['start'])), '-i', str(source)]
        music_index = len(sources)
        if music_path:
            command += ['-stream_loop', '-1', '-i', str(music_path)]

        filters = []
        concat_inputs = []
        for index, duration in enumerate(durations):
            filters.append(
                f'[{index}:v:0]scale={width}:{height}:force_original_aspect_ratio=decrease,'
                f'pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,'
                f'format=yuv420p,setpts=PTS-STARTPTS[v{index}]'
            )
            audio_probe = run([ffprobe, '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=index', '-of', 'csv=p=0', str(sources[index])])
            if audio_probe.returncode == 0 and audio_probe.stdout.strip():
                filters.append(f'[{index}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration={duration},asetpts=PTS-STARTPTS[a{index}]')
            else:
                filters.append(f'anullsrc=r=48000:cl=stereo,atrim=duration={duration},asetpts=PTS-STARTPTS[a{index}]')
            concat_inputs.append(f'[v{index}][a{index}]')
        filters.append(''.join(concat_inputs) + f'concat=n={len(sources)}:v=1:a=1[vout][aout]')
        total_duration = sum(durations)
        if music_path:
            filters.append(f'[{music_index}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume={audio_volume},atrim=duration={total_duration},asetpts=PTS-STARTPTS[bg]')
            filters.append('[aout][bg]amix=inputs=2:duration=first:dropout_transition=2[audioout]')
        else:
            filters.append('[aout]anull[audioout]')
        command += [
            '-filter_complex', ';'.join(filters),
            '-map', '[vout]', '-map', '[audioout]',
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
            '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
            '-t', str(total_duration), str(output),
        ]
        result = run(command)
        if result.returncode or not output.exists():
            raise HTTPException(422, (result.stderr or 'FFmpeg sequence render failed.')[-1600:])
        safe_name = 'personal-video-studio-sequence.mp4'
        return FileResponse(output, media_type='video/mp4', filename=safe_name, background=BackgroundTask(shutil.rmtree, str(td), ignore_errors=True))
    except Exception:
        shutil.rmtree(td, ignore_errors=True)
        raise

# Keep API routes above the frontend catch-all.
app.mount('/', StaticFiles(directory=BASE_DIR, html=True), name='frontend')
