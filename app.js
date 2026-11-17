(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = { clips: [], selectedId: null, audioFile: null, audioUrl: null, audio: new Audio(), backendOnline: false, exporting: false, toastTimer: null, pendingProject: null };
  const video = $('video-preview');
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const fmt = s => { s = Number.isFinite(s) && s > 0 ? s : 0; return `${String(Math.floor(s/60)).padStart(2,'0')}:${(s%60).toFixed(2).padStart(5,'0')}`; };
  const short = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const selected = () => state.clips.find(c => c.id === state.selectedId) || null;
  let controlsHideTimer = null;
  function revealPreviewControls(autoHide = true) {
    const stage = $('preview-stage');
    if (!stage.classList.contains('has-video')) return;
    stage.classList.add('controls-visible');
    clearTimeout(controlsHideTimer);
    if (autoHide && !video.paused) {
      controlsHideTimer = setTimeout(() => {
        if (!stage.matches(':hover') && !stage.contains(document.activeElement)) stage.classList.remove('controls-visible');
      }, 2300);
    }
  }
  function hidePreviewControls() {
    clearTimeout(controlsHideTimer);
    $('preview-stage').classList.remove('controls-visible');
  }
  const toast = message => { const el=$('toast'); el.textContent=message; el.classList.add('show'); clearTimeout(state.toastTimer); state.toastTimer=setTimeout(()=>el.classList.remove('show'),3200); };

  async function checkHealth() {
    try {
      const r = await fetch('/api/health');
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
    $('media-count').textContent=`${count} ${count===1?'ITEM':'ITEMS'}`;
    $('media-list').innerHTML = count ? state.clips.map((c,i)=>`
      <div class="media-item ${c.id===state.selectedId?'selected':''}" data-id="${esc(c.id)}">
        <button class="media-select" data-select="${esc(c.id)}"><span class="media-thumb">▶</span><span class="media-info"><strong title="${esc(c.name)}">${esc(c.name)}</strong><small>${short(c.end-c.start)} · ${c.width||'—'}×${c.height||'—'}</small></span></button>
        <div class="media-order"><button data-up="${esc(c.id)}" title="Move up" ${i===0?'disabled':''}>↑</button><button data-down="${esc(c.id)}" title="Move down" ${i===count-1?'disabled':''}>↓</button></div>
      </div>`).join('') : '<div class="empty-media"><span>▧</span><p>Your imported media<br>will appear here.</p></div>';
    $('timeline-clips').innerHTML = state.clips.map((c,i)=>`<button class="sequence-clip ${c.id===state.selectedId?'active':''}" data-sequence="${esc(c.id)}" style="flex:${Math.max(.12,c.end-c.start)}"><b>${i+1}</b><span>${esc(c.name)}</span><small>${short(c.end-c.start)}</small></button>`).join('');
    $('track-placeholder').hidden=!!count;
    $('sequence-duration').textContent=`${short(totalDuration())} TOTAL`;
    $('timeline-status').textContent=count?`${count} clip${count===1?'':'s'} in sequence`:'No clips loaded';
    $('audio-track-name').textContent=state.audioFile?`♫ ${state.audioFile.name}`:'No audio imported';
    $('audio-track-name').classList.toggle('has-audio',!!state.audioFile);
    $('export-button').disabled=!selected() || !state.backendOnline || state.exporting;
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
    state.selectedId=id; video.pause(); state.audio.pause(); video.src=c.url; video.hidden=false; $('preview-empty').hidden=true; $('preview-stage').classList.add('has-video'); $('preview-stage').classList.remove('is-playing'); revealPreviewControls(false);
    $('project-name').textContent='Untitled Project'; $('preview-resolution').textContent=`${c.width} × ${c.height}`;
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
    const data={format:'PVS_PROJECT',version:'0.2.0',projectName:'Untitled Project',clips:state.clips.map(c=>({name:c.name,duration:c.duration,start:c.start,end:c.end,width:c.width,height:c.height})),audioName:state.audioFile?.name||null};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='personal-video-studio-project.pvsproject';a.click();URL.revokeObjectURL(url);
    toast('Project settings saved. Re-import the source media when reopening.');
  }
  async function loadProject(file) {
    try {
      const data=JSON.parse(await file.text());
      if(data.format!=='PVS_PROJECT'||!Array.isArray(data.clips))throw new Error('This is not a valid PVS project file.');
      toast('Project settings loaded. Re-import the source videos; saved trim points will be restored by filename.');
      $('project-name').textContent=file.name.replace(/\.(pvsproject|json)$/i,'');
      state.pendingProject=data;
    } catch(e){toast(e.message||'Could not open project file.');}
  }
  async function exportSelected() {
    const c=selected(); if(!c||state.exporting)return;
    if(!state.backendOnline){toast('MP4 export needs the FastAPI + FFmpeg backend running separately.');return;}
    state.exporting=true;$('export-button').disabled=true;$('export-button').textContent='Rendering…';
    try {
      const f=new FormData();f.append('file',c.file);f.append('start',String(c.start));f.append('end',String(c.end));
      const r=await fetch('/api/export',{method:'POST',body:f});
      if(!r.ok){let msg='Export failed. Check FFmpeg installation.';try{msg=(await r.json()).detail||msg;}catch{}throw new Error(msg);}
      const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download=`${c.name.replace(/\.[^.]+$/,'')}-edit.mp4`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
      toast('Selected clip export is ready.');
    } catch(e){toast(e.message||'Export failed.');}
    finally{state.exporting=false;$('export-button').textContent='Export selected ↗';render();}
  }

  $('video-drop').onclick=()=>$('video-input').click();
  $('video-input').onchange=async e=>{for(const f of Array.from(e.target.files||[]))await addVideo(f);e.target.value='';};
  $('video-drop').ondragover=e=>{e.preventDefault();$('video-drop').classList.add('dragging');};
  $('video-drop').ondragleave=()=>$('video-drop').classList.remove('dragging');
  $('video-drop').ondrop=async e=>{e.preventDefault();$('video-drop').classList.remove('dragging');for(const f of Array.from(e.dataTransfer.files||[]))await addVideo(f);};
  $('audio-import').onclick=()=>$('audio-input').click();
  $('audio-input').onchange=e=>{const f=e.target.files?.[0];if(!f)return;if(state.audioUrl)URL.revokeObjectURL(state.audioUrl);state.audioFile=f;state.audioUrl=URL.createObjectURL(f);state.audio.src=state.audioUrl;state.audio.loop=true;state.audio.volume=.35;render();toast('Background audio added for preview.');};
  $('media-list').onclick=e=>{const b=e.target.closest('[data-select],[data-up],[data-down]');if(!b)return;if(b.dataset.select)selectClip(b.dataset.select);if(b.dataset.up)moveClip(b.dataset.up,-1);if(b.dataset.down)moveClip(b.dataset.down,1);};
  $('timeline-clips').onclick=e=>{const b=e.target.closest('[data-sequence]');if(b)selectClip(b.dataset.sequence);};
  $('apply-trim').onclick=applyTrim;$('remove-clip').onclick=()=>{const c=selected();if(c)removeClip(c.id);};
  $('move-left').onclick=()=>{const c=selected();if(c)moveClip(c.id,-1);};$('move-right').onclick=()=>{const c=selected();if(c)moveClip(c.id,1);};
  $('export-button').onclick=exportSelected;$('save-project').onclick=saveProject;
  $('load-project').onclick=()=>$('project-input').click();$('project-input').onchange=e=>{const f=e.target.files?.[0];if(f)loadProject(f);e.target.value='';};
  $('new-project').onclick=()=>{if(!confirm('Start a new project and clear all imported media?'))return;state.clips.forEach(c=>URL.revokeObjectURL(c.url));state.clips=[];state.selectedId=null;if(state.audioUrl)URL.revokeObjectURL(state.audioUrl);state.audio.pause();state.audioFile=null;state.audioUrl=null;video.pause();video.removeAttribute('src');video.load();video.hidden=true;$('preview-stage').classList.remove('has-video');$('preview-empty').hidden=false;$('preview-resolution').textContent='NO MEDIA';$('project-name').textContent='Untitled Project';$('current-time').textContent='00:00.00';$('total-time').textContent='00:00.00';render();};
  $('play-button').onclick=()=>{const c=selected();if(!c)return toast('Import and select a clip first.');if(video.paused){if(video.currentTime<c.start||video.currentTime>=c.end)video.currentTime=c.start;video.play().catch(()=>toast('Playback could not start.'));if(state.audioFile){state.audio.currentTime=Math.max(0,video.currentTime-c.start);state.audio.play().catch(()=>{});}}else{video.pause();state.audio.pause();}};
  function syncPlaybackButtons(){
    const icon=video.paused?'▶':'Ⅱ',label=video.paused?'Play':'Pause';
    $('play-button').textContent=icon;
    $('overlay-play-button').title=label;$('overlay-play-button').setAttribute('aria-label',label);
    $('preview-stage').classList.toggle('is-playing',!video.paused);
    if (video.paused) revealPreviewControls(false);
    else revealPreviewControls(true);
  }
  video.onplay=syncPlaybackButtons;video.onpause=syncPlaybackButtons;
  const previewStage=$('preview-stage');
  previewStage.addEventListener('pointerenter',()=>revealPreviewControls(false));
  previewStage.addEventListener('pointermove',()=>revealPreviewControls(true));
  previewStage.addEventListener('pointerleave',()=>{if(video.paused)hidePreviewControls();else{clearTimeout(controlsHideTimer);controlsHideTimer=setTimeout(hidePreviewControls,180);}});
  previewStage.addEventListener('touchstart',()=>revealPreviewControls(true),{passive:true});
  previewStage.addEventListener('focusin',()=>revealPreviewControls(false));
  previewStage.addEventListener('focusout',()=>{if(!previewStage.matches(':hover'))hidePreviewControls();});
  $('overlay-play-button').onclick=()=>$('play-button').click();
  $('seek-backward').onclick=()=>{const c=selected();if(c)video.currentTime=Math.max(c.start,video.currentTime-10);};
  $('seek-forward').onclick=()=>{const c=selected();if(c)video.currentTime=Math.min(c.end,video.currentTime+10);};
  video.ontimeupdate=()=>{const c=selected();if(!c)return;$('current-time').textContent=fmt(Math.max(0,video.currentTime-c.start));if(video.currentTime>=c.end){video.pause();state.audio.pause();video.currentTime=c.end;}};
  $('jump-start').onclick=()=>{const c=selected();if(c)video.currentTime=c.start;};
  $('jump-end').onclick=()=>{const c=selected();if(c)video.currentTime=c.end;};
  function stepClip(delta){const i=state.clips.findIndex(c=>c.id===state.selectedId),c=state.clips[i+delta];if(c)selectClip(c.id);}
  $('previous-clip').onclick=()=>stepClip(-1);$('next-clip').onclick=()=>stepClip(1);
  $('fit-timeline').onclick=()=>toast('Timeline fitted to the current sequence.');
  checkHealth();render();
})();