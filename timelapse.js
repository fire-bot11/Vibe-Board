/* ============================================================
   TIME-LAPSE — a continuous, looping growth animation through an
   organism's whole life cycle, synced to the existing stage-card list.

   APPROACH: rather than rebuilding geometry every frame (expensive,
   would jitter), every visual part of the organism (body, pharynx,
   gonad bump, vulva bump, leaves, flower, siliques, ...) is built ONCE
   per organism and cached. Each part carries a small "growth profile"
   function mapping continuous progress (0..1 across the whole life
   cycle) to a {scale, opacity} pair. Every frame just re-evaluates
   those profiles and applies scale/opacity -- identical spirit to how
   Deep Zoom animates tier groups, just with more, smaller parts.

   Stage boundaries are spaced evenly across the 6 stages (equal
   fractions of progress) rather than parsed from the free-text
   "duration" strings in the JSON (e.g. "2-6 weeks") -- those are
   elapsed-time-since-germination ranges, not stage lengths, and
   parsing them reliably into relative weights isn't worth the
   fragility for a stylized illustrative animation.
   ============================================================ */

let tlRenderer, tlScene, tlCamera;
let tlReady = false;
let tlAnimId = null;
let tlProgress = 0;       // 0..1 across the whole life cycle, loops
let tlPlaying = false;
let tlPauseAtStage = true; // default: play until the next stage boundary, then auto-pause there
let tlSpeed = 1;          // cycles 0.5 / 1 / 2
const TL_LOOP_SECONDS = 22; // time for one full life-cycle loop at 1x
let tlLastFrameTime = 0;
let tlOrbitTheta = 0.6;
let tlDragging = false, tlLastX = 0;
let tlCache = {}; // orgId -> { group, parts, stageCount }
let tlLastStageId = null;
let tlCachedRect = null;

const tlDom = {};
function tlCacheDom(){
  tlDom.canvas = document.getElementById('tl-canvas');
  tlDom.wrap = document.getElementById('tl-canvas-wrap');
  tlDom.loadBadge = document.getElementById('tl-load-badge');
  tlDom.stageBadge = document.getElementById('tl-stage-badge');
  tlDom.caption = document.getElementById('tl-caption');
  tlDom.playBtn = document.getElementById('tl-play-btn');
  tlDom.track = document.getElementById('tl-track');
  tlDom.segments = document.getElementById('tl-track-segments');
  tlDom.playhead = document.getElementById('tl-playhead');
  tlDom.speed = document.getElementById('tl-speed');
  tlDom.pauseToggle = document.getElementById('tl-pause-toggle');
}

function tlSmoothstep(e0, e1, x){
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
function tlLerpKeyframes(keys, t){
  const n = keys.length - 1;
  let seg = Math.floor(t * n);
  if(seg >= n) seg = n - 1;
  if(seg < 0) seg = 0;
  const localT = Math.max(0, Math.min(1, t * n - seg));
  return keys[seg] + (keys[seg + 1] - keys[seg]) * localT;
}
function tlShade(hex, amt){
  hex = (hex || '#888888').replace('#', '');
  if(hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const num = parseInt(hex, 16);
  let r = (num >> 16) + amt, g = ((num >> 8) & 0xff) + amt, b = (num & 0xff) + amt;
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
  return (r << 16) | (g << 8) | b;
}

/* ============================================================
   INIT
   ============================================================ */
function initTimelapse(){
  tlCacheDom();
  if(!tlDom.canvas || typeof THREE === 'undefined') return;

  tlRenderer = new THREE.WebGLRenderer({ canvas: tlDom.canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  tlRenderer.setPixelRatio(1);
  tlRenderer.shadowMap.enabled = false;
  tlRenderer.outputColorSpace = THREE.SRGBColorSpace;

  tlScene = new THREE.Scene();
  tlScene.background = new THREE.Color(0x080c12);
  tlCamera = new THREE.PerspectiveCamera(38, 1, 0.05, 50);

  // Same 4-light + ambient rig proven out in Deep Zoom (even coverage, no dark side).
  const rig = [
    { pos: [3, 2, 3], intensity: 1.5 }, { pos: [-3, 1.5, -3], intensity: 1.3 },
    { pos: [-2, -2, 2.5], intensity: 1.2 }, { pos: [2, -1.5, -3], intensity: 1.1 },
  ];
  rig.forEach(l => {
    const light = new THREE.DirectionalLight(0xffffff, l.intensity);
    light.position.set(l.pos[0], l.pos[1], l.pos[2]);
    tlScene.add(light);
  });
  tlScene.add(new THREE.AmbientLight(0xb8c0cc, 1.0));

  tlWireControls();
  tlBuildTrackSegments();
  tlReady = true;
  tlResize();
}

function tlWireControls(){
  const el = tlDom.canvas;
  function updateCam(){
    const r = 4.6;
    tlCamera.position.set(r * Math.sin(tlOrbitTheta), 0.6, r * Math.cos(tlOrbitTheta));
    tlCamera.lookAt(0, 0.1, 0);
  }
  tlWireControls._updateCam = updateCam;
  updateCam();

  el.addEventListener('mousedown', e => { tlDragging = true; tlLastX = e.clientX; });
  window.addEventListener('mousemove', e => {
    if(!tlDragging) return;
    tlOrbitTheta -= (e.clientX - tlLastX) * 0.008;
    tlLastX = e.clientX;
    tlRequestRender();
  });
  window.addEventListener('mouseup', () => tlDragging = false);
  el.addEventListener('touchstart', e => { if(e.touches.length===1){ tlDragging = true; tlLastX = e.touches[0].clientX; } }, { passive: true });
  el.addEventListener('touchmove', e => {
    if(e.touches.length === 1 && tlDragging){
      tlOrbitTheta -= (e.touches[0].clientX - tlLastX) * 0.008;
      tlLastX = e.touches[0].clientX;
      tlRequestRender();
    }
  }, { passive: true });
  el.addEventListener('touchend', () => tlDragging = false, { passive: true });

  function scrub(clientX){
    const r = tlDom.track.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    tlProgress = frac;
    tlPlaying = false;
    if(tlDom.playBtn) tlDom.playBtn.textContent = '▶';
    tlRequestRender();
  }
  tlDom.track.addEventListener('mousedown', e => { scrub(e.clientX); const move = ev => scrub(ev.clientX); const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); }; window.addEventListener('mousemove', move); window.addEventListener('mouseup', up); });
  tlDom.track.addEventListener('touchstart', e => scrub(e.touches[0].clientX), { passive: true });
  tlDom.track.addEventListener('touchmove', e => scrub(e.touches[0].clientX), { passive: true });

  window.addEventListener('resize', tlResize);
}

function tlBuildTrackSegments(){
  const org = currentOrg;
  const stages = (org && org.lifecycle) || [];
  if(!tlDom.segments) return;
  tlDom.segments.innerHTML = '';
  if(!stages.length) return;
  stages.forEach(s => {
    const seg = document.createElement('div');
    seg.className = 'tl-track-seg';
    seg.style.background = s.color;
    seg.style.width = (100 / stages.length) + '%';
    tlDom.segments.appendChild(seg);
  });
}

function tlResize(){
  if(!tlReady) return;
  const r = tlDom.wrap.getBoundingClientRect();
  if(r.width < 2 || r.height < 2) return;
  tlRenderer.setSize(r.width, r.height, false);
  tlCamera.aspect = r.width / r.height;
  tlCamera.updateProjectionMatrix();
  tlCachedRect = r;
  tlRequestRender();
}

let tlRenderNeeded = true;
function tlRequestRender(){ tlRenderNeeded = true; tlEnsureAnimating(); }
function tlEnsureAnimating(){
  if(currentView === 'lifecycle' && tlReady && !tlAnimId) tlAnimId = requestAnimationFrame(tlAnimate);
}

/* ============================================================
   BUILDERS — every visual part built once per organism, cached.
   ============================================================ */
function tlDisposeGroup(group){
  group.traverse(obj => {
    if(obj.geometry) obj.geometry.dispose();
    if(obj.material){ (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(m => m.dispose()); }
  });
}
function tlClearCache(){
  Object.values(tlCache).forEach(entry => { if(entry.group.parent) tlScene.remove(entry.group); tlDisposeGroup(entry.group); });
  tlCache = {};
}
function tlMakeMat(color, extra){
  return new THREE.MeshPhysicalMaterial(Object.assign({ color, roughness: 0.5, metalness: 0.04, clearcoat: 0.3, clearcoatRoughness: 0.35, transparent: true, opacity: 1 }, extra || {}));
}

function tlBuildWorm(color){
  const grp = new THREE.Group();

  // Force wild-type for the time-lapse regardless of whatever the Anatomy
  // tab's mutant toggle is currently set to -- this is specifically telling
  // the normal-development story (matches the lifecycle stage text, e.g.
  // "vulva forms" describing typical development), so a mutant phenotype
  // here would contradict the narration. Saved/restored immediately after,
  // so it never actually changes the Anatomy tab's own toggle state.
  const savedMutant = (typeof mutantViewActive !== 'undefined') ? mutantViewActive : false;
  if(typeof mutantViewActive !== 'undefined') mutantViewActive = false;
  const positions = (typeof buildWormModel === 'function') ? buildWormModel(grp) : null;
  if(typeof mutantViewActive !== 'undefined') mutantViewActive = savedMutant;

  const bodyMesh = grp.getObjectByName('body');
  const bodyMat = bodyMesh ? bodyMesh.material : null;
  const collect = (typeof dzCollectMeshesByName === 'function') ? dzCollectMeshesByName : (root, name) => { const out = []; root.traverse(o => { if(o.isMesh && o.name === name) out.push(o); }); return out; };

  const parts = [];
  const gonadMeshes = collect(grp, 'gonad');
  parts.push({ objs: gonadMeshes, grow: p => ({ scale: tlSmoothstep(0.30, 0.42, p), opacity: tlSmoothstep(0.30, 0.42, p) }) });

  const vulvaMeshes = collect(grp, 'vulva');
  parts.push({ objs: vulvaMeshes, grow: p => ({ scale: tlSmoothstep(0.47, 0.60, p), opacity: tlSmoothstep(0.47, 0.60, p) }) });

  // Small decorative egg cluster near the vulva -- not part of the real
  // anatomy model, just a storytelling touch for the adult egg-laying stage.
  const vulvaPos = (positions && positions.vulva) ? positions.vulva : { x: 0.3, y: -0.05, z: 0 };
  const eggGroup = new THREE.Group();
  for(let i = 0; i < 4; i++){
    const egg = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), tlMakeMat(0xf0e6c8, { emissive: 0x4a3f2a, emissiveIntensity: 0.2 }));
    egg.position.set(vulvaPos.x + (i - 1.5) * 0.06, vulvaPos.y - 0.13, vulvaPos.z + 0.06);
    eggGroup.add(egg);
  }
  grp.add(eggGroup);
  parts.push({ obj: eggGroup, grow: p => ({ scale: tlSmoothstep(0.66, 0.78, p), opacity: tlSmoothstep(0.66, 0.78, p) * (1 - tlSmoothstep(0.95, 1.0, p) * 0.4) }) });

  return {
    group: grp, parts, bodyMat,
    sizeKeys: [0.22, 0.42, 0.62, 0.82, 1.0, 1.0, 1.0], // 6 stages -> 7 keyframes
    stageIds: ['emb', 'l1', 'l2', 'l3', 'adult', 'senesce'],
  };
}

function tlBuildPlant(color){
  const grp = new THREE.Group();
  const parts = [];

  const positions = (typeof buildPlantModel === 'function') ? buildPlantModel(grp) : null;

  const collect = (typeof dzCollectMeshesByName === 'function') ? dzCollectMeshesByName : (root, name) => { const out = []; root.traverse(o => { if(o.isMesh && o.name === name) out.push(o); }); return out; };

  // Small decorative seed sphere at the base -- not part of the real
  // anatomy model, just a storytelling touch for the very start.
  const seed = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), tlMakeMat(0x8a5a2a, { roughness: 0.5, clearcoat: 0.3 }));
  seed.position.y = -0.92;
  grp.add(seed);
  parts.push({ obj: seed, grow: p => ({ scale: 1, opacity: 1 - tlSmoothstep(0.05, 0.18, p) * 0.85 }) });

  const leaves = collect(grp, 'leaf');
  leaves.forEach((leaf, i) => {
    const spawnAt = 0.16 + i * (0.16 / Math.max(1, leaves.length)); // staggered growback across rosette formation
    parts.push({ obj: leaf, grow: p => { const s = tlSmoothstep(spawnAt, spawnAt + 0.08, p); return { scale: s, opacity: s }; } });
  });

  const flowerMesh = grp.getObjectByName('flower');
  if(flowerMesh) parts.push({ obj: flowerMesh, grow: p => ({ scale: tlSmoothstep(0.63, 0.75, p), opacity: tlSmoothstep(0.63, 0.75, p) }) });

  const siliques = collect(grp, 'silique');
  if(siliques.length) parts.push({ objs: siliques, grow: p => ({ scale: tlSmoothstep(0.80, 0.92, p), opacity: tlSmoothstep(0.80, 0.92, p) }) });

  return {
    group: grp, parts,
    heightKeys: [0.06, 0.32, 0.58, 0.88, 1.0, 1.0, 1.0], // 6 stages -> 7 keyframes
    stageIds: ['seed', 'seedling', 'rosette', 'bolt', 'flower', 'seed_mature'],
  };
}

function tlGetOrBuild(){
  const org = currentOrg;
  if(!org) return null;
  const isPlant = org.model && org.model.type === 'plant';
  const key = org.id + ':' + isPlant;
  if(tlCache[key]) return tlCache[key];
  const built = isPlant ? tlBuildPlant(org.color || '#5AAA2E') : tlBuildWorm(org.color || '#88B040');
  tlScene.add(built.group);
  tlCache[key] = built;
  return built;
}

/* ============================================================
   ORG / VIEW LIFECYCLE
   ============================================================ */
function tlOnOrgChanged(){
  tlClearCache();
  tlProgress = 0;
  tlLastStageId = null;
  tlBuildTrackSegments();
  if(currentView === 'lifecycle') tlRequestRender();
}
let tlAutoStarted = false;
function tlOnEnterView(){
  if(!tlReady) initTimelapse();
  if(!tlReady){
    if(tlDom.loadBadge){
      tlDom.loadBadge.style.display = 'block';
      tlDom.loadBadge.textContent = typeof THREE === 'undefined'
        ? '3D engine not loaded — time-lapse needs the same Three.js library as the other 3D tabs.'
        : 'Initializing time-lapse…';
    }
    return;
  }
  if(tlDom.loadBadge) tlDom.loadBadge.style.display = 'none';
  tlResize();
  // Auto-play once, the very first time this tab is ever opened, so it's
  // immediately obvious the animation moves rather than requiring a click
  // to discover play exists (early-stage growth is subtle frame-to-frame,
  // which otherwise reads as "stuck" even though it's advancing).
  if(!tlAutoStarted){
    tlAutoStarted = true;
    tlPlaying = true;
    if(tlDom.playBtn) tlDom.playBtn.textContent = '⏸';
  }
  tlRequestRender();
}
function tlOnLeaveView(){
  if(tlAnimId){ cancelAnimationFrame(tlAnimId); tlAnimId = null; }
}

function tlTogglePlay(){
  tlPlaying = !tlPlaying;
  if(tlDom.playBtn) tlDom.playBtn.textContent = tlPlaying ? '⏸' : '▶';
  if(!tlPlaying && tlLastStageId && typeof selectLcStage === 'function'){
    selectLcStage(tlLastStageId); // manual pause -- show the current stage's detail on the right
  }
  tlRequestRender();
}
function tlCycleSpeed(){
  tlSpeed = tlSpeed === 1 ? 2 : (tlSpeed === 2 ? 0.5 : 1);
  if(tlDom.speed) tlDom.speed.textContent = tlSpeed + '×';
}
function tlTogglePauseMode(){
  tlPauseAtStage = !tlPauseAtStage;
  if(tlDom.pauseToggle) tlDom.pauseToggle.classList.toggle('active', tlPauseAtStage);
}

/* Explicit, unambiguous manual navigation -- jump straight to the next/
   previous stage's midpoint (pauses playback, matches "click to jump"
   expectations rather than a subtle scrub). Wraps at either end. */
function tlStepStage(direction){
  const org = currentOrg;
  const stageIds = (org && org.lifecycle) ? org.lifecycle.map(s => s.id) : null;
  const n = stageIds ? stageIds.length : 6;
  let idx = Math.floor(tlProgress * n);
  if(idx >= n) idx = n - 1;
  idx = (idx + direction + n) % n;
  tlProgress = (idx + 0.5) / n; // land mid-stage, clear of the boundary
  tlPlaying = false;
  if(tlDom.playBtn) tlDom.playBtn.textContent = '▶';
  if(stageIds && typeof selectLcStage === 'function') selectLcStage(stageIds[idx]);
  tlRequestRender();
}

/* ============================================================
   RENDER LOOP
   ============================================================ */
function tlUpdate(progress){
  const entry = tlGetOrBuild();
  if(!entry) return;

  if(entry.sizeKeys){ // worm: uniform overall size growth
    const s = tlLerpKeyframes(entry.sizeKeys, progress);
    entry.group.scale.setScalar(s);
    // senescence: gently desaturate/dull the body color rather than shrink it
    const senesceT = tlSmoothstep(0.83, 1.0, progress);
    if(entry.bodyMat) entry.bodyMat.color.setHex(tlShade(currentOrg.color || '#88B040', -senesceT * 60));
  }
  if(entry.heightKeys){ // plant: non-uniform vertical growth (stem/root stretch upward)
    const h = tlLerpKeyframes(entry.heightKeys, progress);
    entry.group.scale.set(1, Math.max(0.05, h), 1);
  }

  entry.parts.forEach(part => {
    const g = part.grow(progress);
    const objs = part.objs || [part.obj];
    objs.forEach(obj => {
      if(!obj) return;
      obj.scale.setScalar(g.scale);
      if(obj.material){ obj.material.opacity = g.opacity; obj.material.transparent = true; }
      else if(obj.traverse){ obj.traverse(o => { if(o.material){ o.material.opacity = g.opacity; o.material.transparent = true; } }); }
    });
  });

  // Own dedicated caption under the canvas for continuous playback, PLUS the
  // shared right-side sidebar gets populated with full stage info at each
  // actual pause (not continuously during playback -- that's what caused
  // the earlier "yanks the sidebar away" problem). Safe to touch the
  // sidebar again now that Time-Lapse and Stage List are separate pages
  // (v38) rather than sharing screen space, so there's no longer a
  // scenario where updating it fights with someone reading the stage list.
  const stageIds = entry.stageIds;
  let idx = Math.floor(progress * stageIds.length);
  if(idx >= stageIds.length) idx = stageIds.length - 1;
  const stageId = stageIds[idx];
  if(stageId !== tlLastStageId){
    const isRealTransition = tlLastStageId !== null; // skip the very first sync (that's initialization, not a "crossing")
    tlLastStageId = stageId;
    const stage = (currentOrg.lifecycle || []).find(s => s.id === stageId);
    if(stage){
      if(tlDom.stageBadge) tlDom.stageBadge.textContent = stage.name;
      if(tlDom.caption) tlDom.caption.innerHTML = `<strong>${stage.name}</strong> (${stage.duration}) — ${stage.desc}`;
    }
    if(isRealTransition && tlPauseAtStage && tlPlaying){
      tlPlaying = false;
      if(tlDom.playBtn) tlDom.playBtn.textContent = '▶';
    }
    // Landed on a new stage while paused (whether from auto-pause just above,
    // or because a step/scrub interaction already paused it before this tick)
    // -- show that stage's full detail on the right, same as clicking its card.
    if(isRealTransition && !tlPlaying && typeof selectLcStage === 'function'){
      selectLcStage(stageId);
    }
  }
  if(tlDom.playhead) tlDom.playhead.style.left = (progress * 100) + '%';
}

function tlAnimate(now){
  if(currentView !== 'lifecycle'){ tlAnimId = null; return; }
  if(!currentOrg){ tlAnimId = requestAnimationFrame(tlAnimate); return; }

  if(tlPlaying){
    const dt = tlLastFrameTime ? (now - tlLastFrameTime) / 1000 : 0;
    tlProgress += (dt * tlSpeed) / TL_LOOP_SECONDS;
    if(tlProgress >= 1) tlProgress -= 1; // loop
    tlRenderNeeded = true;
  }
  tlLastFrameTime = now;

  // Skip the actual GPU render while the stage-list sub-page is showing
  // instead (tl-panel is display:none then) -- keeps the loop alive and
  // progress math live (cheap) so switching back is instant, without
  // paying for a render nobody can see.
  const lcVisible = (typeof lcSubView === 'undefined' || lcSubView === 'timelapse');
  if((tlRenderNeeded || tlDragging || tlPlaying) && lcVisible){
    if(tlWireControls._updateCam) tlWireControls._updateCam();
    tlUpdate(tlProgress);
    tlRenderer.render(tlScene, tlCamera);
    tlRenderNeeded = false;
  }
  tlAnimId = requestAnimationFrame(tlAnimate);
}
