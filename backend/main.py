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
app = FastAPI(title='Personal Video Studio API', version='0.2.0')
app.add_middleware(CORSMiddleware, allow_origins=['http://127.0.0.1:8000','http://localhost:8000'], allow_credentials=False, allow_methods=['GET','POST'], allow_headers=['*'])

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

# Keep API routes above the frontend catch-all.
app.mount('/', StaticFiles(directory=BASE_DIR, html=True), name='frontend')
