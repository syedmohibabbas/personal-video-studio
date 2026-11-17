(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = { clips: [], selectedId: null, projectName: 'Untitled Project', previewAspect: 'landscape', audioFile: null, audioUrl: null, audio: new Audio(), audioVolume: 0.35, draggingId: null, apiBase: localStorage.getItem('pvs_api_base') || '', backendOnline: false, exporting: false, toastTimer: null, pendingProject: null };
  const video = $('video-preview');
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const fmt = s => { s = Number.isFinite(s) && s > 0 ? s : 0; return `${String(Math.floor(s/60)).padStart(2,'0')}:${(s%60).toFixed(2).padStart(5,'0')}`; };
  const short = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const selected = () => state.clips.find(c => c.id === state.selectedId) || null;
  function revealPreviewControls() {
    const stage = $('preview-stage');
    if (stage.classList.contains('has-video')) stage.classList.add('controls-visible');
  }
  function hidePreviewControls() {
    $('preview-stage').classList.remove('controls-visible');
  }
  const toast = message => { const el=$('toast'); el.textContent=message; el.classList.add('show'); clearTimeout(state.toastTimer); state.toastTimer=setTimeout(()=>el.classList.remove('show'),3200); };

  const apiUrl = path => (state.apiBase.endsWith('/') ? state.apiBase.slice(0, -1) : state.apiBase) + path;

  async function checkHealth() {
    try {
      const r = await fetch(apiUrl('/api/health'));
      if (!r.ok) throw new Error();
      const d = await r.json(); state.backendOnline = true;
      $('backend-status').innerHTML = `<i class="status-dot"></i> ENGINE ${esc(String(d.status || 'ONLINE').toUpperCase())}${d.ffmpeg_available ? ' · FFMPEG READY' : ' · FFMPEG MISSING'}`;
    } catch {
      state.backendOnline = false;
      $('backend-status').innerHTML = '<i class="status-dot offline"></i> BACKEND NOT CONNECTED';
    }
  }

  function totalDuration() { return state.clips.reduce((sum,c)=>sum+Math.max(0,c.end-c.start),0); }
  function render() {
    const count=state.clips.length;
    $('project-name').textContent = state.projectName;
    $('media-count').textContent=`${count} ${count===1?'ITEM':'ITEMS'}`;
    $('media-list').innerHTML = count ? state.clips.map((c,i)=>`
      <div class="media-item ${c.id===state.selectedId?'selected':''}" data-id="${esc(c.id)}">
        <button class="media-select" data-select="${esc(c.id)}"><span class="media-thumb">▶</span><span class="media-info"><strong title="${esc(c.name)}">${esc(c.name)}</strong><small>${short(c.end-c.start)} · ${c.width||'—'}×${c.height||'—'}</small></span></button>
        <div class="media-order"><button data-up="${esc(c.id)}" title="Move up" ${i===0?'disabled':''}>↑</button><button data-down="${esc(c.id)}" title="Move down" ${i===count-1?'disabled':''}>↓</button></div>
      </div>`).join('') : '<div class="empty-media"><span>▧</span><p>Your imported media<br>will appear here.</p></div>';
    $('timeline-clips').innerHTML = state.clips.map((c,i)=>`<button class="sequence-clip ${c.id===state.selectedId?'active':''}" data-sequence="${esc(c.id)}" style="flex:${Math.max(.12,c.end-c.start)}" draggable="true"><b>${i+1}</b><span>${esc(c.name)}</span><small>${short(c.end-c.start)}</small></button>`).join('');
    $('track-placeholder').hidden=!!count;
    $('sequence-duration').textContent=`${short(totalDuration())} TOTAL`;
    $('timeline-status').textContent=count?`${count} clip${count===1?'':'s'} in sequence`:'No clips loaded';
    $('audio-track-name').textContent=state.audioFile?`♫ ${state.audioFile.name}`:'No audio imported';
    $('audio-track-name').classList.toggle('has-audio',!!state.audioFile);
    $('export-button').disabled=!count || !state.backendOnline || state.exporting;
    updateInspector();
  }
  function updateInspector() {
    const c=selected();
    $('inspector-empty').hidden=!!c; $('inspector-content').hidden=!c;
    if(!c)return;
    $('property-filename').textContent=c.name;
    $('property-duration').textContent=short(c.duration);
    $('property-resolution').textContent=`${c.width} × ${c.height}`;
    $('trim-start').value=Number(c.start.toFixed(2));
    $('trim-end').value=Number(c.end.toFixed(2));
  }
  function selectClip(id) {
    const c=state.clips.find(x=>x.id===id); if(!c)return;
    state.selectedId=id; video.pause(); state.audio.pause(); video.src=c.url; video.hidden=false; $('preview-empty').hidden=true; $('preview-stage').classList.add('has-video'); $('preview-stage').classList.remove('is-playing'); hidePreviewControls();
    $('preview-resolution').textContent=`${c.width} × ${c.height}`;
    $('preview-hint').textContent=`CLIP ${state.clips.indexOf(c)+1} OF ${state.clips.length}`;
    video.onloadedmetadata=()=>{video.currentTime=Math.min(c.start,Math.max(0,c.duration-.05));$('total-time').textContent=fmt(c.end-c.start);};
    render();
  }
  async function addVideo(file) {
    if(!file)return;
    if(!/\.(mp4|mov|webm|mkv)$/i.test(file.name)){toast(`Skipped unsupported file: ${file.name}`);return;}
    const url=URL.createObjectURL(file), probe=document.createElement('video'); probe.preload='metadata'; probe.src=url;
    probe.onloadedmetadata=()=>{
      const duration=Number.isFinite(probe.duration)?probe.duration:0;
      const saved=state.pendingProject?.clips?.find(x=>x.name===file.name && !state.clips.some(y=>y.name===x.name && y._restored));
      const c={id:uid(),file,url,name:file.name,duration,start:saved?Math.max(0,Math.min(Number(saved.start)||0,duration)):0,end:saved?Math.max(0,Math.min(Number(saved.end)||duration,duration)):duration,width:probe.videoWidth,height:probe.videoHeight,_restored:!!saved};
      if(c.end<=c.start)c.end=duration;
      state.clips.push(c); state.selectedId=c.id; selectClip(c.id); render(); toast(`${file.name} added to sequence.`);
      probe.removeAttribute('src');
    };
    probe.onerror=()=>{URL.revokeObjectURL(url);toast(`Could not read ${file.name}.`);};
  }
  function removeClip(id) {
    const i=state.clips.findIndex(c=>c.id===id); if(i<0)return;
    const [c]=state.clips.splice(i,1); URL.revokeObjectURL(c.url);
    if(state.selectedId===id){state.selectedId=state.clips[Math.min(i,state.clips.length-1)]?.id||null;
      if(state.selectedId)selectClip(state.selectedId);else{video.pause();video.removeAttribute('src');video.load();video.hidden=true;$('preview-stage').classList.remove('has-video','is-playing','controls-visible');$('preview-empty').hidden=false;$('preview-resolution').textContent='NO MEDIA';$('total-time').textContent='00:00.00';$('current-time').textContent='00:00.00';}}
    render();
  }
  function moveClip(id,delta) {
    const i=state.clips.findIndex(c=>c.id===id), j=i+delta; if(i<0||j<0||j>=state.clips.length)return;
    [state.clips[i],state.clips[j]]=[state.clips[j],state.clips[i]]; render();
  }
  function applyTrim() {
    const c=selected(); if(!c)return;
    const a=Number($('trim-start').value),b=Number($('trim-end').value);
    if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b>c.duration||a>=b){toast('Invalid trim range. Out must be after In and within the clip.');return;}
    c.start=a;c.end=b; if(state.clips.length)selectClip(c.id); render(); toast('Trim points applied.');
  }
  function saveProject() {
    const data={format:'PVS_PROJECT',version:'0.4.0',projectName:state.projectName,previewAspect:state.previewAspect,audioVolume:state.audioVolume,clips:state.clips.map(c=>({name:c.name,duration:c.duration,start:c.start,end:c.end,width:c.width,height:c.height})),audioName:state.audioFile?.name||null};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=(state.projectName.trim().replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').toLowerCase()||'personal-video-studio')+'.pvsproject';a.click();URL.revokeObjectURL(url);
    toast('Project settings saved. Re-import the source media when reopening.');
  }
  async function loadProject(file) {
    try {
      const data=JSON.parse(await file.text());
      if(data.format!=='PVS_PROJECT'||!Array.isArray(data.clips))throw new Error('This is not a valid PVS project file.');
      toast('Project settings loaded. Re-import the source videos; saved trim points will be restored by filename.');
      state.projectName = String(data.projectName || file.name.replace(/\.(pvsproject|json)$/i,''));
      state.previewAspect = data.previewAspect === 'portrait' ? 'portrait' : 'landscape';
      state.audioVolume = Number.isFinite(Number(data.audioVolume)) ? Math.max(0,Math.min(1,Number(data.audioVolume))) : 0.35;
      $('audio-volume').value = Math.round(state.audioVolume * 100);
      $('audio-volume-value').textContent = `${Math.round(state.audioVolume * 100)}%`;
      setPreviewAspect(state.previewAspect);
      state.pendingProject=data;
      render();
    } catch(e){toast(e.message||'Could not open project file.');}
  }
  async function exportSequence() {
    if (!state.clips.length || state.exporting) return;
    if (!state.backendOnline) { toast('Full sequence export needs the FastAPI + FFmpeg backend.'); return; }
    state.exporting = true;
    $('export-button').disabled = true;
    $('export-button').textContent = 'Rendering sequence…';
    try {
      const form = new FormData();
      state.clips.forEach(c => {
        form.append('files', c.file, c.name);
      });
      form.append('edits', JSON.stringify(state.clips.map(c => ({ start: c.start, end: c.end, name: c.name }))));
      form.append('aspect', state.previewAspect);
      form.append('audio_volume', String(state.audioVolume));
      if (state.audioFile) form.append('audio', state.audioFile, state.audioFile.name);
      const response = await fetch(apiUrl('/api/export-sequence'), { method: 'POST', body: form });
      if (!response.ok) {
        let message = 'Sequence export failed. Check the backend and FFmpeg.';
        try { message = (await response.json()).detail || message; } catch {}
        throw new Error(message);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = (state.projectName.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'personal-video-studio') + '-export.mp4';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      toast('Full sequence export is ready.');
    } catch (error) {
      toast(error.message || 'Sequence export failed.');
    } finally {
      state.exporting = false;
      $('export-button').textContent = 'Export sequence ↗';
      render();
    }
  }

  const previewAspectButtons = { landscape: $('aspect-landscape'), portrait: $('aspect-portrait') };
  function setPreviewAspect(mode) {
    const stage = $('preview-stage');
    const portrait = mode === 'portrait';
    state.previewAspect = portrait ? 'portrait' : 'landscape';
    stage.classList.toggle('aspect-portrait', portrait);
    stage.classList.toggle('aspect-landscape', !portrait);
    previewAspectButtons.landscape.classList.toggle('is-active', !portrait);
    previewAspectButtons.portrait.classList.toggle('is-active', portrait);
    previewAspectButtons.landscape.setAttribute('aria-pressed', String(!portrait));
    previewAspectButtons.portrait.setAttribute('aria-pressed', String(portrait));
  }
  async function openFullscreenPreview() {
    const stage = $('preview-stage');
    if (!stage.classList.contains('has-video')) { toast('Import and select a clip first.'); return; }
    try {
      if (!document.fullscreenElement) await stage.requestFullscreen();
    } catch { toast('Full screen preview is not available in this browser.'); }
  }
  async function closeFullscreenPreview() {
    if (document.fullscreenElement === $('preview-stage')) await document.exitFullscreen();
  }
  $('fullscreen-preview').onclick = openFullscreenPreview;
  $('fullscreen-close').onclick = event => { event.stopPropagation(); closeFullscreenPreview(); };
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.fullscreenElement === $('preview-stage')) closeFullscreenPreview();
  });
  $('aspect-landscape').onclick = () => setPreviewAspect('landscape');
  $('aspect-portrait').onclick = () => setPreviewAspect('portrait');

  $('rename-project').onclick = () => {
    const next = prompt('Enter project name:', state.projectName);
    if (next === null) return;
    const clean = next.trim().slice(0, 80);
    if (!clean) { toast('Project name cannot be empty.'); return; }
    state.projectName = clean; render(); toast('Project renamed.');
  };

  $('video-drop').onclick=()=>$('video-input').click();
  $('video-input').onchange=async e=>{for(const f of Array.from(e.target.files||[]))await addVideo(f);e.target.value='';};
  $('video-drop').ondragover=e=>{e.preventDefault();$('video-drop').classList.add('dragging');};
  $('video-drop').ondragleave=()=>$('video-drop').classList.remove('dragging');
  $('video-drop').ondrop=async e=>{e.preventDefault();$('video-drop').classList.remove('dragging');for(const f of Array.from(e.dataTransfer.files||[]))await addVideo(f);};
  $('audio-import').onclick=()=>$('audio-input').click();
  $('audio-volume').oninput=e=>{state.audioVolume=Math.max(0,Math.min(1,Number(e.target.value)/100));state.audio.volume=state.audioVolume;$('audio-volume-value').textContent=`${e.target.value}%`;};
  $('audio-input').onchange=e=>{const f=e.target.files?.[0];if(!f)return;if(state.audioUrl)URL.revokeObjectURL(state.audioUrl);state.audioFile=f;state.audioUrl=URL.createObjectURL(f);state.audio.src=state.audioUrl;state.audio.loop=true;state.audio.volume=state.audioVolume;render();toast('Background audio added for preview.');};
  $('media-list').onclick=e=>{const b=e.target.closest('[data-select],[data-up],[data-down]');if(!b)return;if(b.dataset.select)selectClip(b.dataset.select);if(b.dataset.up)moveClip(b.dataset.up,-1);if(b.dataset.down)moveClip(b.dataset.down,1);};
  $('timeline-clips').onclick=e=>{const b=e.target.closest('[data-sequence]');if(b)selectClip(b.dataset.sequence);};

  const timelineClips = $('timeline-clips');
  timelineClips.addEventListener('dragstart', event => {
    const item = event.target.closest('[data-sequence]');
    if (!item) return;
    state.draggingId = item.dataset.sequence;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', state.draggingId);
    item.classList.add('is-dragging');
  });
  timelineClips.addEventListener('dragover', event => {
    if (state.draggingId) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }
  });
  timelineClips.addEventListener('drop', event => {
    event.preventDefault();
    const target = event.target.closest('[data-sequence]');
    const from = state.clips.findIndex(c => c.id === state.draggingId);
    const to = target ? state.clips.findIndex(c => c.id === target.dataset.sequence) : -1;
    if (from >= 0 && to >= 0 && from !== to) {
      const [moved] = state.clips.splice(from, 1);
      state.clips.splice(to, 0, moved);
      render();
      toast('Sequence order updated.');
    }
    state.draggingId = null;
  });
  timelineClips.addEventListener('dragend', () => {
    state.draggingId = null;
    timelineClips.querySelectorAll('.is-dragging').forEach(el => el.classList.remove('is-dragging'));
  });

  $('apply-trim').onclick=applyTrim;$('remove-clip').onclick=()=>{const c=selected();if(c)removeClip(c.id);};
  $('move-left').onclick=()=>{const c=selected();if(c)moveClip(c.id,-1);};$('move-right').onclick=()=>{const c=selected();if(c)moveClip(c.id,1);};
  $('export-button').onclick=exportSequence;$('save-project').onclick=saveProject;
  $('backend-connect').onclick = () => {
    const entered = prompt('Paste your FastAPI backend base URL (example: https://your-api.example.com). Leave blank to use same-origin hosting:', state.apiBase);
    if (entered === null) return;
    const raw = entered.trim();
    const clean = raw.endsWith('/') ? raw.slice(0, -1) : raw;
    if (clean) {
      try {
        const parsed = new URL(clean);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      } catch {
        toast('Enter a valid http:// or https:// backend URL.');
        return;
      }
    }
    state.apiBase = clean;
    localStorage.setItem('pvs_api_base', clean);
    checkHealth();
    toast(clean ? 'Backend address saved. Checking connection…' : 'Using same-origin backend.');
  };
  $('load-project').onclick=()=>$('project-input').click();$('project-input').onchange=e=>{const f=e.target.files?.[0];if(f)loadProject(f);e.target.value='';};
  $('new-project').onclick=()=>{if(!confirm('Start a new project and clear all imported media?'))return;state.clips.forEach(c=>URL.revokeObjectURL(c.url));state.clips=[];state.selectedId=null;state.projectName='Untitled Project';state.previewAspect='landscape';setPreviewAspect('landscape');if(state.audioUrl)URL.revokeObjectURL(state.audioUrl);state.audio.pause();state.audioFile=null;state.audioUrl=null;state.audioVolume=.35;$('audio-volume').value=35;$('audio-volume-value').textContent='35%';video.pause();video.removeAttribute('src');video.load();video.hidden=true;$('preview-stage').classList.remove('has-video');$('preview-empty').hidden=false;$('preview-resolution').textContent='NO MEDIA';$('project-name').textContent=state.projectName;$('current-time').textContent='00:00.00';$('total-time').textContent='00:00.00';render();};
  $('play-button').onclick=()=>{const c=selected();if(!c)return toast('Import and select a clip first.');if(video.paused){if(video.currentTime<c.start||video.currentTime>=c.end)video.currentTime=c.start;video.play().catch(()=>toast('Playback could not start.'));if(state.audioFile){state.audio.currentTime=Math.max(0,video.currentTime-c.start);state.audio.play().catch(()=>{});}}else{video.pause();state.audio.pause();}};
  function syncPlaybackButtons(){
    const icon=video.paused?'▶':'Ⅱ',label=video.paused?'Play':'Pause';
    $('play-button').textContent=icon;
    $('overlay-play-button').title=label;$('overlay-play-button').setAttribute('aria-label',label);
    $('preview-stage').classList.toggle('is-playing',!video.paused);
  }
  video.onplay=syncPlaybackButtons;video.onpause=syncPlaybackButtons;
  const previewStage=$('preview-stage');
  // Clicking the preview toggles playback and the in-video play glyph together.
  // Pause = show the large play glyph; play = hide it.
  previewStage.addEventListener('click',event=>{
    if(event.target.closest('.overlay-control')) return;
    if(event.target===video || event.target===previewStage){
      $('play-button').click();
      if(video.paused) revealPreviewControls();
      else hidePreviewControls();
    }
  });
  $('overlay-play-button').onclick=event=>{
    event.stopPropagation();
    $('play-button').click();
    hidePreviewControls();
  };
  $('seek-backward').onclick=event=>{
    event.stopPropagation();
    const c=selected();if(c)video.currentTime=Math.max(c.start,video.currentTime-10);
    hidePreviewControls();
    event.currentTarget.blur();
  };
  $('seek-forward').onclick=event=>{
    event.stopPropagation();
    const c=selected();if(c)video.currentTime=Math.min(c.end,video.currentTime+10);
    hidePreviewControls();
    event.currentTarget.blur();
  };
  video.ontimeupdate=()=>{const c=selected();if(!c)return;$('current-time').textContent=fmt(Math.max(0,video.currentTime-c.start));if(video.currentTime>=c.end){video.pause();state.audio.pause();video.currentTime=c.end;}};
  $('jump-start').onclick=()=>{const c=selected();if(c)video.currentTime=c.start;};
  $('jump-end').onclick=()=>{const c=selected();if(c)video.currentTime=c.end;};
  function stepClip(delta){const i=state.clips.findIndex(c=>c.id===state.selectedId),c=state.clips[i+delta];if(c)selectClip(c.id);}
  $('previous-clip').onclick=()=>stepClip(-1);$('next-clip').onclick=()=>stepClip(1);
  $('fit-timeline').onclick=()=>toast('Timeline fitted to the current sequence.');

  // Keyboard shortcuts: Space toggles playback, arrows seek, Ctrl/Cmd+S saves.
  document.addEventListener('keydown', event => {
    const target = event.target;
    const typing = target && (target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target.tagName));
    if (typing || event.altKey) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(); return; }
    if (event.key === ' ' && !event.ctrlKey && !event.metaKey) { event.preventDefault(); $('play-button').click(); return; }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const c = selected(); if (!c) return;
      event.preventDefault(); video.currentTime = Math.max(c.start, Math.min(c.end, video.currentTime + (event.key === 'ArrowLeft' ? -5 : 5)));
    }
  });
  checkHealth();render();
})();