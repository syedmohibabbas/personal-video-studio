from __future__ import annotations
import json, os, shutil, subprocess, tempfile, threading
from pathlib import Path
from typing import Annotated
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

BASE_DIR = Path(__file__).resolve().parent.parent
MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024
ALLOWED_EXTENSIONS = {'.mp4', '.mov', '.webm', '.mkv'}
app = FastAPI(title='Personal Video Studio API', version='0.6.0')
app.add_middleware(CORSMiddleware, allow_origins=['https://syedmohibabbas.github.io'], allow_origin_regex=r'https?://(localhost|127\.0\.0\.1)(:\d+)?', allow_credentials=False, allow_methods=['GET','POST'], allow_headers=['*'])

def require_api_key(x_api_key: Annotated[str | None, Header()] = None):
    expected = os.getenv('PVS_API_KEY', '').strip()
    if expected and x_api_key != expected:
        raise HTTPException(401, 'Backend API key is missing or incorrect.')

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


# Optional local AI speech recognition. Model downloads on first transcription request.
WHISPER_MODEL_SIZE = os.getenv('PVS_WHISPER_MODEL', 'small')
WHISPER_DEVICE = os.getenv('PVS_WHISPER_DEVICE', 'cpu')
WHISPER_COMPUTE_TYPE = os.getenv('PVS_WHISPER_COMPUTE_TYPE', 'int8')
WHISPER_CACHE = os.getenv('PVS_MODEL_CACHE', '/var/cache/pvs-whisper')
_whisper_model = None
_whisper_lock = threading.Lock()

def get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        with _whisper_lock:
            if _whisper_model is None:
                try:
                    from faster_whisper import WhisperModel
                except ImportError as exc:
                    raise HTTPException(503, 'AI speech model is not installed. Rebuild the backend with the current requirements.') from exc
                Path(WHISPER_CACHE).mkdir(parents=True, exist_ok=True)
                _whisper_model = WhisperModel(WHISPER_MODEL_SIZE, device=WHISPER_DEVICE,
                                              compute_type=WHISPER_COMPUTE_TYPE,
                                              download_root=WHISPER_CACHE)
    return _whisper_model

def srt_timestamp(seconds: float) -> str:
    millis = max(0, round(seconds * 1000))
    hours, millis = divmod(millis, 3_600_000)
    minutes, millis = divmod(millis, 60_000)
    secs, millis = divmod(millis, 1000)
    return f'{hours:02}:{minutes:02}:{secs:02},{millis:03}'

def transcribe_to_srt(source: Path, language: str | None):
    model = get_whisper_model()
    segments, info = model.transcribe(str(source), language=language, vad_filter=True,
                                      beam_size=5, condition_on_previous_text=False)
    rows = []
    for index, segment in enumerate(segments, 1):
        text = (segment.text or '').strip()
        if text:
            rows.append(f'{index}\n{srt_timestamp(segment.start)} --> {srt_timestamp(segment.end)}\n{text}')
    return '\n\n'.join(rows) + ('\n' if rows else ''), info.language, info.language_probability, len(rows)

@app.get('/api/ai/status')
def ai_status():
    try:
        import importlib.util
        installed = importlib.util.find_spec('faster_whisper') is not None
    except (ImportError, ValueError):
        installed = False
    return {'speech_to_text': installed, 'provider': 'faster-whisper', 'model': WHISPER_MODEL_SIZE,
            'device': WHISPER_DEVICE, 'model_loaded': _whisper_model is not None,
            'first_run_download': installed and _whisper_model is None}

@app.post('/api/transcribe' , dependencies=[Depends(require_api_key)])
async def transcribe(file: Annotated[UploadFile, File()],
                     language: Annotated[str, Form()] = 'auto'):
    if Path(file.filename or '').suffix.lower() not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, 'Upload an MP4, MOV, WEBM or MKV video.')
    selected_language = None if language.strip().lower() in {'', 'auto'} else language.strip().lower()
    if selected_language and (len(selected_language) not in (2, 3) or not selected_language.isalpha()):
        raise HTTPException(400, 'Use auto or a valid two/three-letter language code.')
    with tempfile.TemporaryDirectory(prefix='pvs-transcribe-') as td:
        source = Path(td) / ('source' + Path(file.filename or '').suffix.lower())
        await save_upload(file, source)
        srt, detected, confidence, count = await run_in_threadpool(transcribe_to_srt, source, selected_language)
        if not srt.strip():
            raise HTTPException(422, 'No speech was detected in this video.')
        headers = {'Content-Disposition': f'attachment; filename="{Path(file.filename or "video").stem}-captions.srt"',
                   'X-Detected-Language': detected, 'X-Segment-Count': str(count),
                   'X-Language-Confidence': f'{confidence:.3f}'}
        return PlainTextResponse(srt, media_type='application/x-subrip; charset=utf-8', headers=headers)

@app.get('/api/health')
def health(): return {'status':'online','version':app.version,'ffmpeg_available':bool(tool('ffmpeg')),'ffprobe_available':bool(tool('ffprobe'))}


@app.get('/api/capabilities')
def capabilities():
    ffmpeg, _ = require_tools()
    result = run([ffmpeg, '-hide_banner', '-encoders'])
    encoders = result.stdout + result.stderr
    has = lambda name: name in encoders
    formats = {
        'mp4': has('libx264') and has('aac'),
        'mov': has('libx264') and has('aac'),
        'mkv': has('libx264') and has('aac'),
        'webm': has('libvpx-vp9') and has('libopus'),
        'avi': has('mpeg4') and has('pcm_s16le'),
        'gif': has(' gif '),
    }
    return {'formats': formats, 'resolutions': ['source', '720', '1080', '1440', '2160']}

@app.post('/api/analyze' , dependencies=[Depends(require_api_key)])
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

@app.post('/api/export' , dependencies=[Depends(require_api_key)])
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


@app.post('/api/export-sequence' , dependencies=[Depends(require_api_key)])
async def export_sequence(
    files: Annotated[list[UploadFile], File()],
    edits: Annotated[str, Form()],
    aspect: Annotated[str, Form()] = 'landscape',
    audio: Annotated[UploadFile | None, File()] = None,
    audio_volume: Annotated[float, Form()] = 0.35,
    resolution: Annotated[str, Form()] = '1080',
    format: Annotated[str, Form()] = 'mp4',
    quality: Annotated[str, Form()] = 'balanced',
):
    ffmpeg, ffprobe = require_tools()
    if not files or len(files) > 30:
        raise HTTPException(400, 'Add between 1 and 30 clips to export.')
    if aspect not in {'landscape', 'portrait'}:
        raise HTTPException(400, 'Aspect must be landscape or portrait.')
    if resolution not in {'source', '720', '1080', '1440', '2160'}:
        raise HTTPException(400, 'Unsupported output resolution.')
    if format not in {'mp4', 'mov', 'mkv', 'webm', 'avi', 'gif'}:
        raise HTTPException(400, 'Unsupported output format.')
    if quality not in {'high', 'balanced', 'small'}:
        raise HTTPException(400, 'Unsupported quality preset.')
    if not 0 <= audio_volume <= 1:
        raise HTTPException(400, 'Music volume must be between 0 and 1.')
    try:
        edit_list = json.loads(edits)
    except (TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(400, 'Invalid clip edit data.') from exc
    if not isinstance(edit_list, list) or len(edit_list) != len(files):
        raise HTTPException(400, 'Clip edit data does not match uploaded media.')

    enc_result = run([ffmpeg, '-hide_banner', '-encoders'])
    encoders = enc_result.stdout + enc_result.stderr
    required = {'mp4': ('libx264', 'aac'), 'mov': ('libx264', 'aac'),
                'mkv': ('libx264', 'aac'), 'webm': ('libvpx-vp9', 'libopus'),
                'avi': ('mpeg4', 'pcm_s16le'), 'gif': ('gif',)}
    if not all(name in encoders for name in required[format]):
        raise HTTPException(400, f'The connected FFmpeg engine does not support {format.upper()} export.')
    if format == 'gif' and audio is not None and audio.filename:
        audio = None

    td = Path(tempfile.mkdtemp(prefix='pvs-sequence-'))
    output = td / f'personal-video-studio-sequence.{format}'
    try:
        sources, durations, normalized = [], [], []
        first_width = first_height = None
        for index, upload in enumerate(files):
            source = td / f'clip-{index:02d}{Path(upload.filename or "").suffix.lower()}'
            await save_upload(upload, source)
            edit = edit_list[index]
            try:
                begin, finish = float(edit.get('start', 0)), float(edit.get('end', 0))
                speed = max(0.5, min(2.0, float(edit.get('speed', 1))))
                scale_factor = max(0.5, min(2.0, float(edit.get('scale', 1))))
                rotation = max(-180, min(180, float(edit.get('rotation', 0))))
                opacity = max(0, min(1, float(edit.get('opacity', 1))))
                pos_x, pos_y = max(-2000, min(2000, int(edit.get('x', 0)))), max(-2000, min(2000, int(edit.get('y', 0))))
                brightness = max(-0.5, min(0.5, float(edit.get('brightness', 0))))
                contrast = max(0.5, min(2, float(edit.get('contrast', 1))))
                saturation = max(0, min(2, float(edit.get('saturation', 1))))
                volume = max(0, min(2, float(edit.get('volume', 1))))
                fade_in = max(0, min(10, float(edit.get('fadeIn', 0))))
                fade_out = max(0, min(10, float(edit.get('fadeOut', 0))))
            except (TypeError, ValueError, AttributeError) as exc:
                raise HTTPException(400, f'Invalid edit settings for clip {index + 1}.') from exc
            if begin < 0 or finish <= begin:
                raise HTTPException(400, f'Invalid trim range for clip {index + 1}.')
            probe = run([ffprobe, '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', str(source)])
            if probe.returncode:
                raise HTTPException(422, f'Could not read clip {index + 1}.')
            metadata = json.loads(probe.stdout or '{}')
            source_duration = float(metadata.get('format', {}).get('duration') or 0)
            video_stream = next((s for s in metadata.get('streams', []) if s.get('codec_type') == 'video'), {})
            if not first_width:
                first_width, first_height = int(video_stream.get('width') or 1920), int(video_stream.get('height') or 1080)
            if finish > source_duration + 0.1:
                raise HTTPException(400, f'Trim end exceeds clip {index + 1} duration.')
            raw_duration = finish - begin
            effective_duration = raw_duration / speed
            sources.append(source)
            durations.append(effective_duration)
            normalized.append({'start': begin, 'end': finish, 'speed': speed, 'scale': scale_factor,
                               'rotation': rotation, 'opacity': opacity, 'x': pos_x, 'y': pos_y,
                               'brightness': brightness, 'contrast': contrast, 'saturation': saturation,
                               'volume': volume, 'fadeIn': fade_in, 'fadeOut': fade_out})

        if resolution == 'source':
            width, height = first_width, first_height
            if aspect == 'portrait' and width > height: width, height = height, width
            if aspect == 'landscape' and height > width: width, height = height, width
            width, height = max(2, width // 2 * 2), max(2, height // 2 * 2)
        else:
            long_edge = {'720': 1280, '1080': 1920, '1440': 2560, '2160': 3840}[resolution]
            width, height = (long_edge, round(long_edge * 9 / 16)) if aspect == 'landscape' else (round(long_edge * 9 / 16), long_edge)
            width, height = width // 2 * 2, height // 2 * 2

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

        command = [ffmpeg, '-hide_banner', '-loglevel', 'error', '-y']
        for edit, source in zip(normalized, sources):
            command += ['-ss', str(edit['start']), '-t', str(edit['end'] - edit['start']), '-i', str(source)]
        music_index = len(sources)
        if music_path:
            command += ['-stream_loop', '-1', '-i', str(music_path)]

        filters, concat_video, concat_audio = [], [], []
        total_duration = sum(durations)
        for index, (edit, duration) in enumerate(zip(normalized, durations)):
            angle = edit['rotation'] * 3.141592653589793 / 180
            chain = (f'[{index}:v:0]setpts=PTS/{edit["speed"]},'
                     f'scale={width}:{height}:force_original_aspect_ratio=decrease,'
                     f'pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,'
                     f'scale=trunc(iw*{edit["scale"]}/2)*2:trunc(ih*{edit["scale"]}/2)*2,'
                     f'rotate={angle}:ow=rotw(iw):oh=roth(ih):c=black@0,'
                     f'eq=brightness={edit["brightness"]}:contrast={edit["contrast"]}:saturation={edit["saturation"]},'
                     f'format=yuva420p,colorchannelmixer=aa={edit["opacity"]}')
            if edit['fadeIn'] > 0:
                chain += f',fade=t=in:st=0:d={min(edit["fadeIn"], duration)}:alpha=1'
            if edit['fadeOut'] > 0:
                chain += f',fade=t=out:st={max(0, duration-edit["fadeOut"])}:d={min(edit["fadeOut"], duration)}:alpha=1'
            filters.append(chain + f'[fg{index}]')
            filters.append(f'color=c=black:s={width}x{height}:d={duration}[bg{index}]')
            filters.append(f'[bg{index}][fg{index}]overlay=x=(W-w)/2+({edit["x"]}):y=(H-h)/2+({edit["y"]}):shortest=1,format=yuv420p[v{index}]')
            concat_video.append(f'[v{index}]')

            if format != 'gif':
                audio_probe = run([ffprobe, '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=index', '-of', 'csv=p=0', str(sources[index])])
                if audio_probe.returncode == 0 and audio_probe.stdout.strip():
                    audio_chain = f'[{index}:a:0]atempo={edit["speed"]},volume={edit["volume"]},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration={duration},asetpts=PTS-STARTPTS'
                    if edit['fadeIn'] > 0: audio_chain += f',afade=t=in:st=0:d={min(edit["fadeIn"], duration)}'
                    if edit['fadeOut'] > 0: audio_chain += f',afade=t=out:st={max(0, duration-edit["fadeOut"])}:d={min(edit["fadeOut"], duration)}'
                    filters.append(audio_chain + f'[a{index}]')
                else:
                    filters.append(f'anullsrc=r=48000:cl=stereo,atrim=duration={duration},asetpts=PTS-STARTPTS[a{index}]')
                concat_audio.append(f'[a{index}]')

        if format == 'gif':
            filters.append(''.join(concat_video) + f'concat=n={len(sources)}:v=1:a=0[vjoined]')
            filters.append(f'[vjoined]fps=15,scale={width}:{height}:flags=lanczos,split[s0][s1]')
            filters.append('[s0]palettegen[p]')
            filters.append('[s1][p]paletteuse[vfinal]')
        else:
            filters.append(''.join(v + a for v, a in zip(concat_video, concat_audio)) + f'concat=n={len(sources)}:v=1:a=1[vout][aout]')
            if music_path:
                filters.append(f'[{music_index}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume={audio_volume},atrim=duration={total_duration},asetpts=PTS-STARTPTS[bgm]')
                filters.append('[aout][bgm]amix=inputs=2:duration=first:dropout_transition=2[audioout]')
            else:
                filters.append('[aout]anull[audioout]')

        command += ['-filter_complex', ';'.join(filters)]
        if format == 'gif':
            command += ['-map', '[vfinal]', '-loop', '0']
        else:
            command += ['-map', '[vout]', '-map', '[audioout]']
            if format in {'mp4', 'mov', 'mkv'}:
                crf = {'high': '16', 'balanced': '20', 'small': '26'}[quality]
                command += ['-c:v', 'libx264', '-preset', 'medium', '-crf', crf, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k']
                if format == 'mp4': command += ['-movflags', '+faststart']
            elif format == 'webm':
                crf = {'high': '24', 'balanced': '30', 'small': '36'}[quality]
                command += ['-c:v', 'libvpx-vp9', '-crf', crf, '-b:v', '0', '-c:a', 'libopus', '-b:a', '160k']
            elif format == 'avi':
                command += ['-c:v', 'mpeg4', '-q:v', {'high': '2', 'balanced': '4', 'small': '7'}[quality], '-c:a', 'pcm_s16le']
        command += ['-t', str(total_duration), str(output)]
        result = run(command)
        if result.returncode or not output.exists():
            raise HTTPException(422, (result.stderr or 'FFmpeg sequence render failed.')[-1800:])
        media_types = {'mp4': 'video/mp4', 'mov': 'video/quicktime', 'mkv': 'video/x-matroska',
                       'webm': 'video/webm', 'avi': 'video/x-msvideo', 'gif': 'image/gif'}
        return FileResponse(output, media_type=media_types[format],
                            filename=f'personal-video-studio-sequence.{format}',
                            background=BackgroundTask(shutil.rmtree, str(td), ignore_errors=True))
    except Exception:
        shutil.rmtree(td, ignore_errors=True)
        raise

# Keep API routes above the frontend catch-all.
app.mount('/', StaticFiles(directory=BASE_DIR, html=True), name='frontend')
