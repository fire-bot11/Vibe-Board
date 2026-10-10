/* ============================================================
   APP STATE
   ============================================================ */
let currentOrg = null;
let currentMode = 'anatomy';
let currentView = '3d';
let render3DNeeded = true;      // Flag: does 3D need rendering?
let animationFrameId = null;    // Track animation frame ID to cancel it
let activeHs = null;
let kioskMode = false;

/* ============================================================
   FULLSCREEN / KIOSK
   ============================================================ */
function toggleFullscreen(){
  if(!document.fullscreenElement){
    document.documentElement.requestFullscreen().catch(()=>{});
    document.getElementById('fs-btn').textContent='⤢';
  } else {
    document.exitFullscreen().catch(()=>{});
    document.getElementById('fs-btn').textContent='⛶';
  }
}
document.addEventListener('fullscreenchange',()=>{
  document.getElementById('fs-btn').textContent=document.fullscreenElement?'⤢':'⛶';
  setTimeout(()=>{ onResize(); },150);
});
function toggleKioskMode(){
  kioskMode = !kioskMode;
  document.body.classList.toggle('kiosk-mode', kioskMode);
  document.getElementById('kiosk-btn').classList.toggle('active', kioskMode);
  document.getElementById('kiosk-btn').textContent = kioskMode ? '🔓 Exit kiosk' : '🔒 Kiosk mode';
}

/* ============================================================
   EXPLORE DEEPER / MEDIA PANEL
   ============================================================ */
function exploreDeeper(title, bodyHtml, videoUrl){
  document.getElementById('explore-title').textContent = title;
  document.getElementById('explore-body').innerHTML = bodyHtml;
  const vw = document.getElementById('explore-video-wrap');
  const vf = document.getElementById('explore-video');
  if(videoUrl){
    vf.src = videoUrl; vw.style.display = 'block';
  } else {
    vf.src = ''; vw.style.display = 'none';
  }
  document.getElementById('explore-panel').classList.add('show');
}
document.getElementById('explore-panel').addEventListener('click', e => {
  if(e.target.id === 'explore-panel'){
    document.getElementById('explore-panel').classList.remove('show');
    document.getElementById('explore-video').src = '';
  }
});

/* ============================================================
   WEBGL 3D ENGINE (Three.js) — real geometry, real lighting
   ============================================================ */
let renderer, scene, camera, controls;
let orgGroup = null;          // current organism's 3D group
let hotspotAnchors = [];      // {id, worldPos: THREE.Vector3, el}
let autoRotate = false;
let wireMode = false;
let glReady = false;

// Cache frequently accessed DOM elements for better performance (initialized immediately)
const domCache = {
  glCanvas: document.getElementById('gl-canvas'),
  imgMainCanvas: document.getElementById('img-main-canvas'),
  imgHighlightCanvas: document.getElementById('img-highlight-canvas'),
  imgHotspotLayer: document.getElementById('img-hotspot-layer'),
  imgZoomBadge: document.getElementById('img-zoom-badge'),
  hotsportLayer: document.getElementById('hotspot-layer'),
  canvasWrap: document.getElementById('canvas-wrap'),
  sidTitle3d: document.getElementById('sid-title-3d'),
  sidBody3d: document.getElementById('sid-body-3d'),
  sidSub3d: document.getElementById('sid-sub-3d'),
  sidTitleImg: document.getElementById('sid-title-img'),
  sidBodyImg: document.getElementById('sid-body-img'),
  imgViewer: document.getElementById('img-viewer')
};

function initWebGL(){
  const canvas = document.getElementById('gl-canvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1); // Capped at 1x -- 1.5x was costing ~2.25x the pixel-shading
                              // work for a barely-visible sharpness gain on a kiosk display
                              // viewed from a few feet away; this is the single biggest CPU lever.
  renderer.shadowMap.enabled = false; // Disable shadows for better performance on kiosk
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080c12);
  scene.fog = new THREE.Fog(0x080c12, 6, 16);

  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0.6, 4.2);

  // Lighting rig: key + fill, so the model still reads as solid 3D from any angle.
  // (Previously had a 3rd "rim" light too -- with MeshLambertMaterial, every extra
  // light is a full extra per-pixel lighting pass across the whole scene, so cutting
  // this to 2 lights + ambient meaningfully reduces shading cost with barely any
  // visible difference, since Lambert has no specular highlight to show it off anyway.)
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(3, 4, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xbdd4ff, 1.1);
  fill.position.set(-4, 0, 3);
  scene.add(fill);

  const ambient = new THREE.AmbientLight(0x4a5568, 0.65);
  scene.add(ambient);

  // Ground shadow catcher (subtle, helps depth perception)
  const groundGeo = new THREE.PlaneGeometry(20, 20);
  const groundMat = new THREE.ShadowMaterial({ opacity: 0.28 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.55;
  ground.receiveShadow = true;
  scene.add(ground);

  controls = new OrbitControlsLite(camera, canvas);
  controls.target.set(0, 0, 0);
  controls.minDistance = 1.8;
  controls.maxDistance = 9;

  glReady = true;
  onResize();
  animationFrameId = requestAnimationFrame(animate);  // Start animation loop on demand
}

/* ============================================================
   Lightweight orbit-controls implementation (drag-to-orbit,
   wheel/pinch-to-zoom, momentum) — avoids needing the separate
   OrbitControls.js addon file, which isn't part of three.min.js.
   ============================================================ */
function OrbitControlsLite(camera, domElement){
  const self = this;
  this.target = new THREE.Vector3();
  this.minDistance = 1; this.maxDistance = 20;
  let spherical = { radius: 4.2, theta: 0.6, phi: 1.25 }; // theta=azimuth, phi=polar
  let dragging = false, panning = false, lastX = 0, lastY = 0;
  let velTheta = 0, velPhi = 0;
  let pinchDist = 0, panMidX = 0, panMidY = 0;

  function updateCamera(){
    const sinPhi = Math.sin(spherical.phi);
    camera.position.x = self.target.x + spherical.radius * sinPhi * Math.sin(spherical.theta);
    camera.position.y = self.target.y + spherical.radius * Math.cos(spherical.phi);
    camera.position.z = self.target.z + spherical.radius * sinPhi * Math.cos(spherical.theta);
    camera.lookAt(self.target);
  }

  // Screen-space pan: moves the orbit target (and so the whole model,
  // visually) using the camera's own current right/up basis vectors, so it
  // feels consistent regardless of orbit angle. Speed scales with distance
  // so panning feels the same whether zoomed in or out.
  function panBy(dx, dy){
    camera.updateMatrixWorld(true);
    const distFactor = spherical.radius * 0.0018;
    const te = camera.matrixWorld.elements;
    const rightVec = new THREE.Vector3(te[0], te[1], te[2]);
    const upVec = new THREE.Vector3(te[4], te[5], te[6]);
    self.target.addScaledVector(rightVec, -dx * distFactor);
    self.target.addScaledVector(upVec, dy * distFactor);
  }

  function onDown(x, y){ dragging = true; lastX = x; lastY = y; velTheta = 0; velPhi = 0; }
  function onMove(x, y){
    if(!dragging) return;
    const dx = x - lastX, dy = y - lastY;
    velTheta = -dx * 0.006; velPhi = -dy * 0.006;
    spherical.theta += velTheta;
    spherical.phi = Math.max(0.25, Math.min(Math.PI - 0.25, spherical.phi + velPhi));
    lastX = x; lastY = y;
    updateCamera();
  }
  function onUp(){ dragging = false; panning = false; }

  domElement.addEventListener('contextmenu', e => e.preventDefault()); // so right-drag-to-pan doesn't pop the browser menu
  domElement.addEventListener('mousedown', e => {
    if(e.button === 2 || e.shiftKey){ panning = true; lastX = e.clientX; lastY = e.clientY; }
    else { onDown(e.clientX, e.clientY); }
    ensure3DAnimating();
  });
  window.addEventListener('mousemove', e => {
    if(panning){ panBy(e.clientX - lastX, e.clientY - lastY); lastX = e.clientX; lastY = e.clientY; updateCamera(); ensure3DAnimating(); return; }
    onMove(e.clientX, e.clientY); if(dragging) ensure3DAnimating();
  });
  window.addEventListener('mouseup', onUp);

  domElement.addEventListener('touchstart', e => {
    if(e.touches.length === 1) onDown(e.touches[0].clientX, e.touches[0].clientY);
    else if(e.touches.length === 2){
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchDist = Math.sqrt(dx*dx + dy*dy);
      panMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      panMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    }
    ensure3DAnimating();
  }, { passive: true });
  domElement.addEventListener('touchmove', e => {
    ensure3DAnimating();
    if(e.touches.length === 2){
      // Two-finger gesture does both at once: pinch distance -> zoom,
      // midpoint movement -> pan. Matches standard touch map conventions.
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const d = Math.sqrt(dx*dx + dy*dy);
      const delta = d / pinchDist;
      spherical.radius = Math.max(self.minDistance, Math.min(self.maxDistance, spherical.radius / delta));
      pinchDist = d;
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      panBy(midX - panMidX, midY - panMidY);
      panMidX = midX; panMidY = midY;
      updateCamera();
      return;
    }
    if(e.touches.length === 1) onMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  domElement.addEventListener('touchend', onUp, { passive: true });

  domElement.addEventListener('wheel', e => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.9 : 1.1;
    spherical.radius = Math.max(self.minDistance, Math.min(self.maxDistance, spherical.radius * delta));
    updateCamera();
    ensure3DAnimating();
  }, { passive: false });

  this.dampen = function(){
    if(!dragging && (Math.abs(velTheta) > 0.0001 || Math.abs(velPhi) > 0.0001)){
      velTheta *= 0.92; velPhi *= 0.92;
      spherical.theta += velTheta;
      spherical.phi = Math.max(0.25, Math.min(Math.PI - 0.25, spherical.phi + velPhi));
      updateCamera();
      return true;
    }
    return false;
  };
  this.autoRotateStep = function(speed){
    spherical.theta += speed;
    updateCamera();
  };
  this.zoomBy = function(factor){
    spherical.radius = Math.max(self.minDistance, Math.min(self.maxDistance, spherical.radius * factor));
    updateCamera();
  };
  this.reset = function(){
    spherical = { radius: 4.2, theta: 0.6, phi: 1.25 };
    self.target.set(0, 0, 0);
    velTheta = 0; velPhi = 0;
    updateCamera();
  };
  this.isDragging = function(){ return dragging; };
  this.hasMomentum = function(){ return !dragging && (Math.abs(velTheta) > 0.0001 || Math.abs(velPhi) > 0.0001); };

  updateCamera();
}

let cachedCanvasWrapRect = null;
function onResize(){
  if(!glReady) return;
  const wrap = document.getElementById('canvas-wrap');
  const r = wrap.getBoundingClientRect();
  if(r.width < 2 || r.height < 2) return;
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
  cachedCanvasWrapRect = r;
  render3DNeeded = true;
  ensure3DAnimating();
}
window.addEventListener('resize', onResize);

let lastRender3DTime = 0;
const RENDER_3D_INTERVAL = 1000 / 30; // Cap actual draws at ~30fps -- halves render() calls
                                        // during drag/auto-rotate/momentum, which is when CPU
                                        // usage is highest. Camera/orbit state still updates on
                                        // every raw input event, so dragging still feels responsive;
                                        // only the on-screen redraw rate is throttled.

const AMBIENT_MOTION_ENABLED = false; // Disabled per real-device testing: caused
                                        // noticeable lag, and the plant's whole-group
                                        // sway didn't read as organic movement anyway
                                        // (rotating the whole rigid group, not the
                                        // individual leaves/stem, looks more like the
                                        // whole plant tipping over than swaying).
const AMBIENT_INTERVAL = 1000 / 5; // Idle "alive" motion throttled to ~5fps. NOTE: this
                                     // sandbox has no real GPU (SwiftShader software
                                     // rendering), where each render() call costs ~100ms+
                                     // regardless of scene complexity -- so idle CPU% measured
                                     // here isn't representative of real hardware, where each
                                     // frame should cost low single-digit milliseconds. The
                                     // throttle itself was verified to hit its target rate
                                     // (confirmed ~7.5fps against an 8fps target in testing);
                                     // 5fps is a conservative default given that uncertainty.
                                     // The sine-wave motion is slow enough that 5fps still
                                     // reads as smooth, gentle movement, not choppy.

function applyAmbientMotion(t){
  if(!orgGroup) return;
  const isPlant = currentOrg && currentOrg.model && currentOrg.model.type === 'plant';
  if(isPlant){
    // Gentle windy sway -- two slightly out-of-phase sine waves so it doesn't
    // read as a mechanical metronome.
    orgGroup.rotation.z = Math.sin(t * 0.5) * 0.025 + Math.sin(t * 1.3) * 0.008;
    orgGroup.rotation.x = Math.sin(t * 0.35 + 1) * 0.012;
  } else {
    // Worm: subtle idle drift + bob
    orgGroup.rotation.y = Math.sin(t * 0.3) * 0.05;
    orgGroup.position.y = Math.sin(t * 0.6) * 0.02;
    // Pharynx pump pulse -- biologically apt (real pumping is a defining, well-known
    // C. elegans behavior, ~200 pumps/min; slowed way down here for a readable idle
    // effect rather than a literal rate), and cheap: just scaling one small mesh.
    const pharynx = orgGroup.getObjectByName('pharynx');
    if(pharynx){
      const pulse = 1 + Math.sin(t * 3.2) * 0.05;
      pharynx.scale.set(pulse, pulse, pulse);
    }
  }
}

function animate(now){
  // DEMAND-BASED RENDERING: Only render when necessary
  
  // Stop rendering if not on 3D tab
  if(currentView !== '3d'){
    animationFrameId = null;
    return;
  }
  
  // Check if rendering is needed
  let needsRender = false;
  
  // Always render during animations (orbit/zoom)
  if(autoRotate && !controls.isDragging()) {
    controls.autoRotateStep(0.0035);
    needsRender = true;
  }
  
  // Render when model is being dragged
  if(controls.isDragging()) {
    needsRender = true;
  }
  
  // Render if momentum is active (damping)
  if(controls.hasMomentum()) {
    controls.dampen();
    needsRender = true;
  }
  
  const isActive = needsRender || render3DNeeded;
  const elapsed = now - lastRender3DTime;

  if(isActive && elapsed >= RENDER_3D_INTERVAL) {
    updateHotspotScreenPositions();
    renderer.render(scene, camera);
    render3DNeeded = false;
    lastRender3DTime = now;
  } else if(!isActive && AMBIENT_MOTION_ENABLED && elapsed >= AMBIENT_INTERVAL) {
    applyAmbientMotion(now / 1000);
    updateHotspotScreenPositions();
    renderer.render(scene, camera);
    lastRender3DTime = now;
  }
  
  // Keep looping continuously while on the 3D tab -- either actively animating
  // (drag/momentum/autorotate) or idling with cheap ambient motion. Only stop
  // entirely when the person leaves the 3D tab.
  if(currentView === '3d') {
    animationFrameId = requestAnimationFrame(animate);
  } else {
    animationFrameId = null;
  }
}

// DEMAND-BASED RENDERING: the loop above stops itself whenever nothing is
// happening (to save CPU). Whenever the user starts interacting with the
// model again, wake the loop back up immediately instead of waiting on a
// timer (which could otherwise miss the drag and leave the view frozen
// until a page refresh).
function ensure3DAnimating(){
  if(currentView === '3d' && glReady && !animationFrameId){
    animationFrameId = requestAnimationFrame(animate);
  }
}

function resetView(){ controls.reset(); render3DNeeded = true; ensure3DAnimating(); }
function zoom3d(factor){ controls.zoomBy(factor); render3DNeeded = true; ensure3DAnimating(); }
function toggleAuto(){
  autoRotate = !autoRotate;
  document.getElementById('auto-btn').classList.toggle('active', autoRotate);
  ensure3DAnimating();
}
function toggleWire(){
  wireMode = !wireMode;
  document.getElementById('wire-btn').classList.toggle('active', wireMode);
  if(orgGroup){
    orgGroup.traverse(obj => {
      if(obj.isMesh && obj.material){
        if(Array.isArray(obj.material)) obj.material.forEach(m => m.wireframe = wireMode);
        else obj.material.wireframe = wireMode;
      }
    });
  }
  render3DNeeded = true;
  ensure3DAnimating();
}

let _hintHidden = false;
function hideDragHintOnce(){
  if(_hintHidden) return; _hintHidden = true;
  const el = document.getElementById('drag-hint');
  if(el){ el.style.opacity = '0'; setTimeout(() => el && el.remove(), 500); }
}
document.getElementById('gl-canvas').addEventListener('mousedown', hideDragHintOnce);
document.getElementById('gl-canvas').addEventListener('touchstart', hideDragHintOnce, { passive: true });

// Deselect hotspots when clicking empty canvas
document.getElementById('gl-canvas').addEventListener('click', (e) => {
  // Only deselect if clicking on canvas itself, not on a hotspot
  if(e.target.id === 'gl-canvas'){
    activeHs = null;
    hotspotAnchors.forEach(a => a.el.classList.remove('active'));
    domCache.sidTitle3d.textContent = 'Select a structure';
    domCache.sidBody3d.innerHTML = '<div class="sid-empty"><div class="big-icon">👆</div>Tap any labeled point on the 3D model</div>';
    
    // Remove highlighting glow
    orgGroup.traverse(obj => {
      if(obj.isMesh && obj.material){
        if(obj.material.emissive){
          obj.material.emissiveIntensity = 0;
        }
        if(obj.material.opacity !== undefined){
          obj.material.opacity = 0.95;
        }
      }
    });
    animate();
  }
});

/* ============================================================
   ORGANISM 3D GEOMETRY BUILDERS
   Real volumetric meshes (TubeGeometry, lathe, extrusions) with
   PBR-ish materials and proper normals — this is what gives true
   shading/depth instead of a flat sprite.
   ============================================================ */
function clearOrgGroup(){
  if(orgGroup){
    scene.remove(orgGroup);
    orgGroup.traverse(obj => {
      if(obj.geometry) obj.geometry.dispose();
      if(obj.material){
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => m.dispose());
      }
    });
  }
  orgGroup = new THREE.Group();
  scene.add(orgGroup);
}

/* Enhanced procedural cuticle texture with realistic annuli striations,
   lateral alae ridges, and subtle lipid deposits seen in real C. elegans. */
function buildWormCuticleTexture(){
  const w = 2048, h = 512;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  
  // Base body color gradient (living tissue, slightly translucent appearance)
  const base = ctx.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, '#a8c978');    // dorsal (lighter)
  base.addColorStop(0.5, '#9ab968');  // mid
  base.addColorStop(1, '#88a850');    // ventral (slightly darker)
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  
  // Circumferential annuli (cuticle rings ~1-2μm spacing)
  ctx.globalAlpha = 0.18;
  for(let x = 0; x < w; x += 5){
    ctx.fillStyle = (x % 10 === 0) ? '#2a3a1a' : '#d4e89a';
    ctx.fillRect(x, 0, 1.5, h);
  }
  
  // Lateral alae (dorsal and ventral ridges)
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#4a5a2a';
  ctx.fillRect(0, h * 0.15, w, 4);
  ctx.fillRect(0, h * 0.85, w, 4);
  
  // Faint medial lines
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = '#3a4a1a';
  ctx.fillRect(0, h * 0.45, w, 1);
  ctx.fillRect(0, h * 0.55, w, 1);
  
  ctx.globalAlpha = 1;
  
  // Organic speckle noise (bacteria on cuticle, small debris, etc.)
  for(let i = 0; i < 12000; i++){
    const x = Math.random() * w, y = Math.random() * h;
    const r = Math.random() * 1.8;
    ctx.globalAlpha = Math.random() * 0.08;
    ctx.fillStyle = Math.random() > 0.6 ? '#f0ffb0' : '#2a3a0a';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  
  ctx.globalAlpha = 1;
  
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(8, 1);
  if(THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildWormBumpTexture(){
  const w = 2048, h = 512;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#888888';
  ctx.fillRect(0, 0, w, h);
  
  // Annuli height map
  for(let x = 0; x < w; x += 5){
    ctx.fillStyle = (x % 10 === 0) ? '#404040' : '#b0b0b0';
    ctx.fillRect(x, 0, 1.5, h);
  }
  
  // Alae ridges (raised)
  ctx.fillStyle = '#606060';
  ctx.fillRect(0, h * 0.15, w, 4);
  ctx.fillRect(0, h * 0.85, w, 4);
  
  // Fine organic noise
  for(let i = 0; i < 8000; i++){
    const x = Math.random() * w, y = Math.random() * h;
    ctx.globalAlpha = Math.random() * 0.12;
    ctx.fillStyle = Math.random() > 0.5 ? '#ffffff' : '#000000';
    ctx.beginPath(); ctx.arc(x, y, Math.random() * 1.6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(8, 1);
  return tex;
}

let organMeshes = {}; // Track mesh references for highlighting by hotspot ID
let mutantViewActive = false; // Toggled by the Wild-type/Mutant switch in the 3D view

function buildWormModel(targetGroup){
  let grp = targetGroup;
  if(!grp){ clearOrgGroup(); grp = orgGroup; }
  organMeshes = {}; // Reset mesh tracking

  // High-resolution body curve: realistic sinusoidal locomotion path
  // C. elegans typically ~1mm long, ~70μm diameter (here scaled for visualization)
  const segments = 128;
  const pts = [];
  for(let i = 0; i <= segments; i++){
    const t = i / segments;
    // Main locomotor wave: primary + secondary high-frequency undulation
    const x = (t - 0.5) * 4.0;
    const primary = Math.sin(t * Math.PI * 1.9) * 0.38 * (1 - t * 0.18);
    const secondary = Math.sin(t * Math.PI * 8.2) * 0.008;
    const y = primary + secondary;
    const z = Math.sin(t * Math.PI * 3.3) * 0.12 + Math.sin(t * Math.PI * 9.5) * 0.006;
    pts.push(new THREE.Vector3(x, y, z));
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.25);

  // Radius taper: head/tail fine, pharynx bulb, mid-body fuller
  function radiusAt(t){
    let r;
    if(t < 0.02) r = THREE.MathUtils.lerp(0.001, 0.06, t / 0.02);
    else if(t < 0.10) r = THREE.MathUtils.lerp(0.06, 0.145, (t - 0.02) / 0.08); // pharynx bulge -- kept subtle, close to body radius rather than a pronounced bulb
    else if(t > 0.96) r = THREE.MathUtils.lerp(0.11, 0.0008, (t - 0.96) / 0.04);
    else if(t > 0.89) r = THREE.MathUtils.lerp(0.135, 0.11, (t - 0.89) / 0.07); // tail taper
    else r = 0.138 + Math.sin((t - 0.10) / 0.79 * Math.PI) * 0.028;
    // Visible circumferential body rings (real C. elegans cuticular annuli) --
    // strong enough to actually read in the silhouette, not just the flat
    // texture map, so the body silhouette itself is clearly a ringed/
    // segmented worm rather than a smooth continuous taper.
    r += Math.sin(t * Math.PI * 48) * 0.006;
    return r;
  }

  // Build tapered tube with high tessellation for smooth appearance
  const tubularSegments = 130, radialSegments = 16;
  const tubeGeo = new THREE.TubeGeometry(curve, tubularSegments, 1, radialSegments, false);
  const posAttr = tubeGeo.attributes.position;
  const normAttr = tubeGeo.attributes.normal;
  
  // Apply radial taper by displacing vertices
  for(let i = 0; i <= tubularSegments; i++){
    const t = i / tubularSegments;
    const r = radiusAt(t);
    const center = curve.getPoint(t);
    for(let j = 0; j <= radialSegments; j++){
      const idx = i * (radialSegments + 1) + j;
      if(idx >= posAttr.count) continue;
      const nx = normAttr.getX(idx), ny = normAttr.getY(idx), nz = normAttr.getZ(idx);
      posAttr.setXYZ(idx, center.x + nx * r, center.y + ny * r, center.z + nz * r);
    }
  }
  posAttr.needsUpdate = true;
  tubeGeo.computeVertexNormals();

  const cuticleMap = buildWormCuticleTexture();
  const bumpMap = buildWormBumpTexture();

  // Physically-based material mimicking translucent living tissue
  const bodyMat = new THREE.MeshPhysicalMaterial({
    map: cuticleMap,
    bumpMap: bumpMap,
    bumpScale: 0.008,
    color: 0xffffff,
    clearcoat: 0.10,
    clearcoatRoughness: 0.6,
    transmission: 0.05,
    thickness: 0.5,
    ior: 1.4,
    transparent: true,
    opacity: 0.97,
    side: THREE.FrontSide
  });
  bodyMat.emissive = new THREE.Color(0x1a2a0a);
  bodyMat.emissiveIntensity = 0.08;

  const bodyMesh = new THREE.Mesh(tubeGeo, bodyMat);
  bodyMesh.name = 'body'; // reliable lookup for other views (Deep Zoom, time-lapse) that reuse this model
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  grp.add(bodyMesh);

  // Subsurface scattering shell (thin, translucent outer layer)
  const glowGeo = tubeGeo.clone();
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xb8e070,
    transparent: true,
    opacity: 0.04,
    side: THREE.BackSide,
    depthWrite: false
  });
  const glowMesh = new THREE.Mesh(glowGeo, glowMat);
  glowMesh.scale.setScalar(1.04);
  grp.add(glowMesh);

  // Internal organs as real 3D meshes positioned along the curve
  function ptAt(t){ return curve.getPoint(t); }

  // Pharynx — bi-lobed capsule near head
  const pharynxGeo = new THREE.CapsuleGeometry(0.07, 0.22, 4, 8);
  const pharynxMat = new THREE.MeshLambertMaterial({ 
    color: 0xd9a838,
    emissive: 0x000000,
    emissiveIntensity: 0
  });
  const pharynx = new THREE.Mesh(pharynxGeo, pharynxMat);
  pharynx.name = 'pharynx';  // ID for highlighting
  pharynx.position.copy(ptAt(0.14)); pharynx.rotation.z = Math.PI / 2;
  pharynx.castShadow = true;
  grp.add(pharynx);

  // Nerve ring — torus around the pharynx
  const nerveGeo = new THREE.TorusGeometry(0.085, 0.018, 10, 24);
  const nerveMat = new THREE.MeshLambertMaterial({ 
    color: 0x9088e8, 
    emissive: 0x000000,
    emissiveIntensity: 0
  });
  const nerve = new THREE.Mesh(nerveGeo, nerveMat);
  nerve.name = 'nerve';  // ID for highlighting
  nerve.position.copy(ptAt(0.20)); nerve.rotation.y = Math.PI / 2;
  grp.add(nerve);

  // Intestine — tapered tube following body curve from 0.22 to 0.85
  const gutPts = [];
  for(let i = 0; i <= 24; i++){
    const t = 0.22 + (i / 24) * (0.85 - 0.22);
    gutPts.push(ptAt(t));
  }
  const gutCurve = new THREE.CatmullRomCurve3(gutPts);
  const gutGeo = new THREE.TubeGeometry(gutCurve, 26, 0.075, 8, false);
  const gutMat = new THREE.MeshLambertMaterial({ 
    color: 0xd6863a, 
    transparent: true, 
    opacity: 0.85,
    emissive: 0x000000,
    emissiveIntensity: 0
  });
  const gut = new THREE.Mesh(gutGeo, gutMat);
  gut.name = 'intestine';  // ID for highlighting
  gut.castShadow = true;
  grp.add(gut);

  // Gonad arms — two curved tubes (U-shaped)
  [[-0.08, 0.16], [-0.08, -0.16]].forEach(([zOff, yOff]) => {
    const gp = [];
    for(let i = 0; i <= 16; i++){
      const t = 0.35 + (i / 16) * 0.35;
      const base = ptAt(t);
      gp.push(new THREE.Vector3(base.x, base.y + yOff * Math.sin(i/16*Math.PI), base.z + zOff));
    }
    const gCurve = new THREE.CatmullRomCurve3(gp);
    const gGeo = new THREE.TubeGeometry(gCurve, 16, 0.045, 6, false);
    const gMat = new THREE.MeshLambertMaterial({ 
      color: 0xdcd4a8, 
      transparent: true, 
      opacity: 0.75,
      emissive: 0x000000,
      emissiveIntensity: 0
    });
    const gMesh = new THREE.Mesh(gGeo, gMat);
    gMesh.name = 'gonad';  // ID for highlighting
    grp.add(gMesh);
  });

  // Vulva — small sphere mid-body ventral
  const vulvaGeo = new THREE.SphereGeometry(0.045, 8, 8);
  const vulvaMat = new THREE.MeshLambertMaterial({ 
    color: 0xc8926a,
    emissive: 0x000000,
    emissiveIntensity: 0
  });
  const vulva = new THREE.Mesh(vulvaGeo, vulvaMat);
  vulva.name = 'vulva';  // ID for highlighting
  vulva.position.copy(ptAt(0.52)).add(new THREE.Vector3(0, -0.1, 0));
  grp.add(vulva);

  // MUTANT PHENOTYPE: Multivulva (Muv) -- a real, famous C. elegans phenotype
  // caused by hyperactive let-60/Ras signaling (the same Ras pathway targeted by
  // many cancer drugs). Instead of one vulva, extra vulva-like protrusions form
  // along the ventral body. Purely visual/additive -- doesn't touch the real
  // 'vulva' hotspot mesh above, just adds extra bumps nearby when toggled on.
  if(mutantViewActive){
    const muvMat = new THREE.MeshLambertMaterial({
      color: 0xd9705a, emissive: 0x000000, emissiveIntensity: 0
    });
    [0.36, 0.46, 0.60].forEach(t => {
      const bump = new THREE.Mesh(new THREE.SphereGeometry(0.036, 8, 8), muvMat);
      bump.name = 'muv-bump';
      bump.position.copy(ptAt(t)).add(new THREE.Vector3(0, -0.095, 0));
      grp.add(bump);
    });
  }

  grp.userData.curve = curve;
  grp.userData.ptAt = ptAt;

  // Position hotspots using actual mesh-space coordinates along curve
  return {
    pharynx: ptAt(0.14),
    nerve: ptAt(0.20),
    gonad: ptAt(0.45).clone().add(new THREE.Vector3(0, 0.05, 0)),
    vulva: ptAt(0.52).clone().add(new THREE.Vector3(0, -0.1, 0)),
    intestine: ptAt(0.62)
  };
}

function buildPlantModel(targetGroup){
  let grp = targetGroup;
  if(!grp){ clearOrgGroup(); grp = orgGroup; }

  const positions = {};

  // Soil disc
  const soilGeo = new THREE.CylinderGeometry(0.9, 1.0, 0.12, 16);
  const soilMat = new THREE.MeshLambertMaterial({ color: 0x4a3a22, });
  const soil = new THREE.Mesh(soilGeo, soilMat);
  soil.position.y = -1.15;
  soil.receiveShadow = true;
  grp.add(soil);

  // Primary root (tapered cylinder, going down into soil)
  // MUTANT PHENOTYPE: short-root (shr) -- a well-known Arabidopsis mutant. Loss of
  // SHORT-ROOT (a GRAS-family transcription factor required for the ground tissue
  // radial pattern) collapses cortex/endodermis formation and dramatically stunts
  // root growth. Visually: a short, thick stub instead of the long, elaborately
  // branched wild-type root system.
  const rootCurve = mutantViewActive
    ? new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, -1.1, 0),
        new THREE.Vector3(0.01, -1.22, 0.005),
        new THREE.Vector3(0, -1.32, 0)
      ])
    : new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, -1.1, 0),
        new THREE.Vector3(0.02, -1.5, 0.01),
        new THREE.Vector3(-0.02, -1.9, -0.01),
        new THREE.Vector3(0, -2.3, 0)
      ]);
  const rootGeo = new THREE.TubeGeometry(rootCurve, mutantViewActive ? 10 : 20, mutantViewActive ? 0.06 : 0.045, 6, false);
  const rootMat = new THREE.MeshLambertMaterial({ 
    color: 0xb8966a,
    emissive: 0x000000,
    emissiveIntensity: 0
  });
  const root = new THREE.Mesh(rootGeo, rootMat);
  root.name = 'root';  // ID for highlighting
  root.castShadow = true;
  grp.add(root);
  positions.root = rootCurve.getPoint(mutantViewActive ? 0.6 : 0.4);

  // Lateral roots (wild-type only -- shr mutants essentially lack an elaborated
  // lateral root system, part of what makes the phenotype so visually striking)
  if(!mutantViewActive){
    [[0.35, -1.55, 0.55], [0.4, -1.8, -0.5], [-0.4, -1.65, 0.4], [-0.35, -1.95, -0.45]].forEach(([x,y,z]) => {
      const lc = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, y, 0),
        new THREE.Vector3(x * 0.6, y - 0.05, z * 0.6),
        new THREE.Vector3(x, y - 0.15, z)
      ]);
      const lGeo = new THREE.TubeGeometry(lc, 8, 0.018, 5, false);
      const lMesh = new THREE.Mesh(lGeo, rootMat);
      lMesh.name = 'root';  // Also root
      grp.add(lMesh);
    });
  }

  // Main stem
  const stemCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -1.1, 0),
    new THREE.Vector3(0, -0.4, 0),
    new THREE.Vector3(0.01, 0.3, 0),
    new THREE.Vector3(0, 1.0, 0),
    new THREE.Vector3(-0.01, 1.5, 0)
  ]);
  const stemGeo = new THREE.TubeGeometry(stemCurve, 26, 0.035, 8, false);
  const stemMat = new THREE.MeshLambertMaterial({ 
    color: 0x5a9a35,
    emissive: 0x000000,
    emissiveIntensity: 0
  });
  const stem = new THREE.Mesh(stemGeo, stemMat);
  stem.name = 'stem'; // reliable lookup for other views (Deep Zoom, time-lapse) that reuse this model
  stem.castShadow = true; stem.receiveShadow = true;
  grp.add(stem);
  
  // Meristem — small sphere at growing tip
  const meristPos = stemCurve.getPoint(0.62);
  const meristemGeo = new THREE.SphereGeometry(0.04, 10, 10);
  const meristemMat = new THREE.MeshLambertMaterial({
    color: 0x7ac940,
    emissive: 0x000000,
    emissiveIntensity: 0
  });
  const meristem = new THREE.Mesh(meristemGeo, meristemMat);
  meristem.name = 'meristem';  // ID for highlighting
  meristem.position.copy(meristPos);
  grp.add(meristem);
  positions.meristem = meristPos;

  // Rosette leaves — curved, tapered blade shapes using ExtrudeGeometry-ish lathe of a leaf profile via custom mesh
  function makeLeaf(angle, tilt, scaleF, color){
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.quadraticCurveTo(0.18, 0.05, 0.42, 0.02);
    shape.quadraticCurveTo(0.5, 0, 0.42, -0.04);
    shape.quadraticCurveTo(0.18, -0.07, 0, 0);
    const leafGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 });
    const leafMat = new THREE.MeshLambertMaterial({ 
      color, 
      side: THREE.DoubleSide,
      emissive: 0x000000,
      emissiveIntensity: 0
    });
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    leaf.name = 'leaf';  // ID for highlighting
    leaf.scale.setScalar(scaleF);
    leaf.rotation.x = tilt;
    leaf.rotation.y = angle;
    leaf.position.set(0, -0.55, 0);
    leaf.castShadow = true;
    return leaf;
  }
  const leafColors = [0x6bbf3a, 0x5aa82e, 0x7ac940];
  for(let i = 0; i < 8; i++){
    const angle = (i / 8) * Math.PI * 2;
    const tilt = -0.25 - (i % 2) * 0.15;
    const leaf = makeLeaf(angle, tilt, 1.0 + (i % 3) * 0.1, leafColors[i % leafColors.length]);
    grp.add(leaf);
  }
  positions.leaf = new THREE.Vector3(-0.85, -0.55, 0.2);

  // Siliques (seed pods) — small elongated capsules near top
  const siliqueMat = new THREE.MeshLambertMaterial({ 
    color: 0x9bc869,
    emissive: 0x000000,
    emissiveIntensity: 0
  });
  const siliquePositions = [];
  for(let i = 0; i < 6; i++){
    const t = 0.7 + (i / 6) * 0.22;
    const base = stemCurve.getPoint(t);
    const sGeo = new THREE.CapsuleGeometry(0.012, 0.16, 4, 6);
    const s = new THREE.Mesh(sGeo, siliqueMat);
    s.name = 'silique';  // ID for highlighting
    const ang = (i / 6) * Math.PI * 2;
    s.position.set(base.x + Math.cos(ang) * 0.08, base.y, base.z + Math.sin(ang) * 0.08);
    s.rotation.z = Math.PI / 2.4;
    s.rotation.y = ang;
    s.castShadow = true;
    grp.add(s);
    siliquePositions.push(s.position.clone());
  }
  positions.silique = siliquePositions[0];

  // Flower at apex — small sphere + petal discs
  const flowerCenter = stemCurve.getPoint(1.0);
  const centerGeo = new THREE.SphereGeometry(0.03, 10, 10);
  const centerMat = new THREE.MeshLambertMaterial({ 
    color: 0xf5e040, 
    emissive: 0x000000,
    emissiveIntensity: 0
  });
  const centerMesh = new THREE.Mesh(centerGeo, centerMat);
  centerMesh.name = 'flower';  // ID for highlighting
  centerMesh.position.copy(flowerCenter);
  grp.add(centerMesh);

  const petalMat = new THREE.MeshLambertMaterial({ color: 0xfff8e0, side: THREE.DoubleSide });
  for(let i = 0; i < 5; i++){
    const a = (i / 5) * Math.PI * 2;
    const petalGeo = new THREE.CircleGeometry(0.045, 8, 0, Math.PI);
    const petal = new THREE.Mesh(petalGeo, petalMat);
    petal.position.copy(flowerCenter).add(new THREE.Vector3(Math.cos(a) * 0.05, Math.sin(a) * 0.04, 0.01));
    petal.rotation.z = a;
    petal.rotation.y = 0.3;
    grp.add(petal);
  }
  positions.flower = flowerCenter.clone();

  return positions;
}

function buildGenericModel(org){
  clearOrgGroup();
  const geo = new THREE.IcosahedronGeometry(0.9, 1);
  const mat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(org.color || '#888888'), flatShading: true
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  orgGroup.add(mesh);
  return {};
}

/* ============================================================
   HOTSPOT 3D -> 2D SCREEN PROJECTION
   ============================================================ */
function updateHotspotScreenPositions(){
  if(!hotspotAnchors.length || !glReady) return;
  if(!cachedCanvasWrapRect) cachedCanvasWrapRect = domCache.canvasWrap.getBoundingClientRect();
  const rect = cachedCanvasWrapRect;

  hotspotAnchors.forEach(anchor => {
    const v = anchor.worldPos.clone().project(camera);
    // Hide if behind the camera OR projected well outside the visible frame.
    // Previously only checked "behind camera" -- a hotspot swinging to a
    // grazing/edge angle (very easy to hit now that panning can move the
    // model off-center) stayed display:flex but positioned outside the
    // clipped canvas area, which read as "disappearing" unpredictably
    // rather than hiding cleanly.
    const outOfView = v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.08 || Math.abs(v.y) > 1.08;
    if(outOfView){
      anchor.el.style.display = 'none';
      anchor._wasVisible = false;
      return;
    }

    const x = (v.x * 0.5 + 0.5) * rect.width;
    const y = (-v.y * 0.5 + 0.5) * rect.height;

    // Smoothing state is tracked in memory on the anchor itself, not
    // re-parsed from the DOM style string each frame. Re-parsing style.left
    // was the actual cause of the "snaps back into place" jump: while an
    // anchor was hidden (or on its very first frame), its style position
    // wasn't being updated at all, so when it reappeared the code eased
    // from that stale/arbitrary old value instead of the current one. Snap
    // immediately (skip easing) on the first frame an anchor becomes
    // visible, since there's no real continuity to smooth from there.
    if(!anchor._wasVisible || anchor._smoothX === undefined){
      anchor._smoothX = x;
      anchor._smoothY = y;
    } else {
      anchor._smoothX += (x - anchor._smoothX) * 0.25;
      anchor._smoothY += (y - anchor._smoothY) * 0.25;
    }
    anchor._wasVisible = true;

    anchor.el.style.left = anchor._smoothX + 'px';
    anchor.el.style.top = anchor._smoothY + 'px';
    anchor.el.style.display = 'flex';
  });
}

function buildHotspotsForOrg(org, positionMap){
  const layer = domCache.hotsportLayer;
  // Remove old listeners before clearing HTML
  layer.querySelectorAll('.hs-dot').forEach(el => {
    el.removeEventListener('click', el._clickHandler);
    el.removeEventListener('keydown', el._keyHandler);
  });
  layer.innerHTML = '';
  hotspotAnchors = [];
  (org.hotspots3d || []).forEach(hs => {
    const worldPos = positionMap[hs.id]
      ? positionMap[hs.id].clone()
      : new THREE.Vector3(hs.pos[0], hs.pos[1], hs.pos[2]);
    const el = document.createElement('div');
    el.className = 'hs-dot';
    el.textContent = hs.label;
    el.style.borderColor = hs.color;
    el.style.color = hs.color;
    el.style.background = hs.color + '22';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', hs.name);
    
    // Store handlers so we can remove them later
    el._clickHandler = () => select3dHotspot(hs.id);
    el._keyHandler = (e) => { if(e.key === 'Enter' || e.key === ' ') select3dHotspot(hs.id); };
    
    el.addEventListener('click', el._clickHandler);
    el.addEventListener('keydown', el._keyHandler);
    layer.appendChild(el);
    hotspotAnchors.push({ id: hs.id, worldPos, el });
  });
}

/* ============================================================
   ORGANISM SWITCHING / VIEW MANAGEMENT
   ============================================================ */
function loadOrgInto3D(org){
  let positions = {};
  if(org.model && org.model.type === 'worm') positions = buildWormModel();
  else if(org.model && org.model.type === 'plant') positions = buildPlantModel();
  else positions = buildGenericModel(org);

  if(wireMode){
    orgGroup.traverse(obj => { if(obj.isMesh && obj.material) obj.material.wireframe = true; });
  }
  buildHotspotsForOrg(org, positions);
}

function select3dHotspot(id){
  activeHs = id;
  hotspotAnchors.forEach(a => a.el.classList.toggle('active', a.id === id));
  
  // Highlight 3D structure with emissive glow
  highlight3dStructure(id);
  
  const org = currentOrg;
  const hs = (org.hotspots3d || []).find(h => h.id === id);
  const d = (org.data || {})[id];
  if(!hs || !d) return;
  const mdata = d[currentMode] || d.anatomy;
  domCache.sidTitle3d.textContent = hs.name;
  domCache.sidSub3d.textContent = hs.sub;
  const lbl = { anatomy: 'Anatomy', genetics: 'Genetics & genes', experiment: 'Experimental use' }[currentMode] || '';
  const tc = { anatomy: 'blue', genetics: 'purple', experiment: 'teal' }[currentMode] || 'blue';
  const tags = (mdata.tags || []).map(t => `<span class="tag ${tc}">${t}</span>`).join('');
  domCache.sidBody3d.innerHTML = `
    <div class="fact"><div class="fact-lbl">${lbl}</div><div class="fact-val">${mdata.desc}</div></div>
    <div class="tags">${tags}</div>
    <button class="deep-btn" onclick='exploreDeeper(${JSON.stringify(hs.name + " — " + lbl)}, ${JSON.stringify(`<p style="margin-bottom:14px">${mdata.desc}</p><div class="tags">${tags}</div>`)})'>📘 Explore deeper</button>`;
}

function highlight3dStructure(hotspotId){
  if(!orgGroup) return;
  
  console.log('Highlighting:', hotspotId); // Debug: see what ID we're getting
  
  // Reset all meshes to normal
  orgGroup.traverse(obj => {
    if(obj && obj.isMesh && obj.material && obj.material.emissive){
      obj.material.emissiveIntensity = 0;
    }
  });
  
  // Highlight only the selected mesh by exact name match
  orgGroup.traverse(obj => {
    if(obj && obj.isMesh && obj.name === hotspotId){
      console.log('Found mesh to highlight:', obj.name);
      if(obj.material && obj.material.emissive){
        obj.material.emissiveIntensity = 1.5;
        obj.material.emissive.setHex(0xffff00); // Bright yellow
      }
    }
  });
  
  // Force render
  if(renderer) renderer.render(scene, camera);
}

function setMode(m){
  currentMode = m;
  ['anatomy', 'genetics', 'experiment'].forEach(x => document.getElementById('chip-' + x).classList.toggle('active', x === m));
  if(activeHs) select3dHotspot(activeHs);
}

function setView(v){
  currentView = v;
  ['3d', 'imagery', 'lifecycle', 'workflow', 'deepzoom'].forEach(x => {
    document.getElementById('view-' + x).style.display = x === v ? 'flex' : 'none';
    document.getElementById('vbtn-' + x).classList.toggle('active', x === v);
  });
  
  // DEMAND-BASED RENDERING: Control animation loop based on active view
  if(v === '3d'){
    onResize();
    render3DNeeded = true;
    // Start animation loop when 3D view becomes active
    if(!animationFrameId){
      animationFrameId = requestAnimationFrame(animate);
    }
  } else {
    // Stop animation loop when leaving 3D view (CPU savings!)
    if(animationFrameId){
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  // Deep Zoom has its own independent renderer/loop -- only ever running
  // while this tab is the active view (same demand-based discipline as 3D Anatomy).
  if(v === 'deepzoom') dzOnEnterView();
  else dzOnLeaveView();

  // Same pattern for the Life Cycle tab's time-lapse renderer.
  if(v === 'lifecycle') tlOnEnterView();
  else tlOnLeaveView();

  if(v === 'imagery') initImagery();
  if(v === 'lifecycle') initLifecycle();
  if(v === 'workflow') initWorkflow();
}

function buildTabs(){
  const tabs = document.getElementById('org-tabs');
  tabs.innerHTML = '';
  OrganismStore.list().forEach(org => {
    const div = document.createElement('div');
    div.className = 'org-tab' + (currentOrg && org.id === currentOrg.id ? ' active' : '');
    div.innerHTML = `<span class="org-dot" style="background:${org.color || '#888'}"></span>${org.commonName || org.name}`;
    div.onclick = () => switchOrg(org.id);
    tabs.appendChild(div);
  });
  const add = document.createElement('div');
  add.className = 'add-org-btn';
  add.innerHTML = '➕ Add';
  add.onclick = () => document.getElementById('modal-add').classList.add('show');
  tabs.appendChild(add);
}

function switchOrg(id){
  const org = OrganismStore.get(id);
  if(!org) return;
  currentOrg = org;
  activeHs = null;
  
  // Clear cached images to free memory
  ImageCache.clear();
  
  buildTabs();
  document.getElementById('sid-body-3d').innerHTML = '<div class="sid-empty"><div class="big-icon">👆</div>Tap any labeled point on the 3D model</div>';
  document.getElementById('sid-title-3d').textContent = 'Select a structure';
  document.getElementById('sid-sub-3d').textContent = 'Tap a hotspot';
  document.getElementById('topbar-sub').textContent = `Viewing ${org.name} — ${org.tagline || ''} · v44`;
  if(typeof THREE !== 'undefined' && glReady){
    try{ loadOrgInto3D(org); resetView(); }
    catch(err){ console.error('Failed to load 3D model for', org.id, err); }
  }
  if(currentView === 'imagery') initImagery();
  if(currentView === 'lifecycle') initLifecycle();
  if(currentView === 'workflow') initWorkflow();
  if(typeof dzOnOrgChanged === 'function') dzOnOrgChanged();
  if(currentView === 'deepzoom' && typeof dzOnEnterView === 'function') dzOnEnterView();
  if(typeof tlOnOrgChanged === 'function') tlOnOrgChanged();
  if(currentView === 'lifecycle' && typeof tlOnEnterView === 'function') tlOnEnterView();
  updateMutantToggleUI();
  updateMutantBanner();
}

/* ============================================================
   MUTANT / WILD-TYPE COMPARISON
   ============================================================ */
const MUTANT_INFO = {
  cel: {
    name: 'Multivulva (Muv)',
    gene: 'let-60 (Ras)',
    html: `<b>Mutant: Multivulva (Muv)</b> — a hyperactive <b>let-60/Ras</b> mutation
      causes extra vulva-like protrusions to form along the body instead of one.
      This is one of the most famous phenotypes in developmental genetics.
      <span class="mib-tag">Same Ras pathway targeted by many cancer drugs</span>`
  },
  ara: {
    name: 'short-root (shr)',
    gene: 'SHORT-ROOT (SHR)',
    html: `<b>Mutant: short-root (shr)</b> — loss of the <b>SHORT-ROOT</b>
      transcription factor collapses the root's internal cell-layer pattern,
      leaving a short, thick stub instead of the long, branching wild-type root.
      <span class="mib-tag">Classic root-patterning gene</span>`
  }
};

function updateMutantBanner(){
  const banner = document.getElementById('mutant-info-banner');
  if(!banner) return;
  const info = currentOrg && MUTANT_INFO[currentOrg.id];
  if(mutantViewActive && info){
    banner.innerHTML = info.html;
    banner.style.display = 'block';
  } else {
    banner.style.display = 'none';
  }
}

function updateMutantToggleUI(){
  const toggle = document.getElementById('mutant-toggle');
  const label = document.getElementById('mutant-toggle-label');
  const sub = document.getElementById('mutant-toggle-sub');
  if(!toggle) return;
  toggle.classList.toggle('active', mutantViewActive);
  const info = currentOrg && MUTANT_INFO[currentOrg.id];
  if(mutantViewActive && info){
    label.textContent = info.name;
    sub.textContent = 'Tap to see wild-type';
  } else {
    label.textContent = 'Wild-type';
    sub.textContent = 'Tap to see a mutant';
  }
}

function toggleMutantView(){
  mutantViewActive = !mutantViewActive;
  updateMutantToggleUI();
  updateMutantBanner();
  if(currentOrg && typeof THREE !== 'undefined' && glReady){
    try{ loadOrgInto3D(currentOrg); }
    catch(err){ console.error('Failed to rebuild 3D model for mutant toggle', err); }
  }
  render3DNeeded = true;
  ensure3DAnimating();
}

function addOrganism(){
  const name = document.getElementById('add-name').value.trim();
  const abbr = document.getElementById('add-abbr').value.trim().slice(0, 3);
  const desc = document.getElementById('add-desc').value.trim();
  if(!name || !abbr){ alert('Name and abbreviation are required'); return; }
  const id = 'custom_' + Date.now();
  OrganismStore.addCustom(id, {
    id, name, commonName: name, abbr, color: '#7F77DD', tagline: desc,
    model: { type: 'generic' },
    hotspots3d: [], data: {}, imagery: [], lifecycle: [], workflows: []
  });
  document.getElementById('modal-add').classList.remove('show');
  ['add-name', 'add-abbr', 'add-desc'].forEach(x => document.getElementById(x).value = '');
  buildTabs();
  switchOrg(id);
}

/* ============================================================
   IMAGERY VIEW (zoom/pan on procedural or real images + hotspots)
   ============================================================ */
let imgZoomLevel = 1, imgPanX = 0, imgPanY = 0, imgDragging = false, imgLX = 0, imgLY = 0;

// All hotspot/glow/zoom math below works in CSS-pixel ("logical") space, matching
// the units of mouse drag deltas and CSS transforms. The canvas itself is drawn at
// device-pixel resolution (mc.width/mc.height, scaled by devicePixelRatio) purely
// for sharpness -- that device-pixel size must never leak into pan/hotspot math,
// or positions drift by exactly devicePixelRatio on any non-1x screen.
function getImgLogicalSize(){
  const mc = domCache.imgMainCanvas || document.getElementById('img-main-canvas');
  let w = mc && mc.style.width ? parseFloat(mc.style.width) : 0;
  let h = mc && mc.style.height ? parseFloat(mc.style.height) : 0;
  if(!w || !h){
    const viewer = document.getElementById('img-viewer');
    const r = viewer.getBoundingClientRect();
    w = r.width; h = r.height;
  }
  return { w, h };
}
let imgZoomAnimating = false;  // Track if currently animating zoom
let imgTargetZoom = 1, imgTargetPanX = 0, imgTargetPanY = 0;  // Animation targets
let imgAnimationProgress = 0;  // 0 to 1 for smooth interpolation
let imgAnimationSpeed = 0.08;  // How fast to animate (lower = slower)
let imgAnimToken = 0; // Bumped on every new zoom animation call. Each animation loop
                       // captures its own token and checks it against the current value
                       // every frame -- if they no longer match, a newer animation has
                       // started (e.g. "Zoom Out" clicked mid zoom-in), so this older
                       // loop stops itself instead of continuing to fight over the same
                       // shared imgZoomLevel/imgPanX/imgPanY/imgAnimationProgress state.
let currentImgIdx = 0;
let activeImgHs = null;
let currentHotspotSetKey = null; // tracks tier|organism|image, so the hotspot DOM
                                   // only gets rebuilt when that combination changes
let currentImgGlowHotspot = null;  // Track which hotspot has the glow
let currentImgGlowSVG = null;      // Track the SVG element for the glow

function initImagery(){
  const org = currentOrg;
  const imgs = org.imagery || [];
  currentImgIdx = 0; activeImgHs = null;
  buildThumbStrip(imgs);
  if(imgs.length > 0) showImage(0);
  else {
    const mc = document.getElementById('img-main-canvas');
    const r = document.getElementById('img-viewer').getBoundingClientRect();
    mc.width = r.width; mc.height = r.height;
    const cx = mc.getContext('2d');
    cx.fillStyle = 'rgba(255,255,255,.04)'; cx.fillRect(0, 0, r.width, r.height);
    cx.fillStyle = 'rgba(255,255,255,.3)'; cx.font = '15px sans-serif';
    cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillText('No imagery available for this organism yet', r.width / 2, r.height / 2);
    document.getElementById('img-hotspot-layer').innerHTML = '';
    document.getElementById('img-thumb-strip').innerHTML = '';
  }
  document.getElementById('sid-title-img').textContent = 'Imagery';
  document.getElementById('sid-sub-img').textContent = org.name || '';
  document.getElementById('sid-body-img').innerHTML = '<div class="sid-empty"><div class="big-icon">🔬</div>Click a highlighted region</div>';
}

function buildThumbStrip(imgs){
  const strip = document.getElementById('img-thumb-strip');
  strip.innerHTML = '';
  imgs.forEach((img, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'img-thumb' + (i === 0 ? ' active' : '');
    wrap.title = img.label;
    const tc = document.createElement('canvas'); tc.width = 192; tc.height = 144;
    wrap.appendChild(tc);
    const lbl = document.createElement('div'); lbl.className = 'img-thumb-lbl'; lbl.textContent = img.modality || img.label;
    wrap.appendChild(lbl);
    wrap.onclick = () => showImage(i);
    strip.appendChild(wrap);
    const renderThumb = () => {
      const src = resolveImageSource(img.image);
      if(src.kind === 'procedural'){
        const full = getProceduralCanvas(src.key, 480, 360);
        tc.getContext('2d').drawImage(full, 0, 0, 192, 144);
      } else {
        const im = new Image();
        im.onload = () => tc.getContext('2d').drawImage(im, 0, 0, 192, 144);
        im.src = src.url;
      }
    };
    if('requestIdleCallback' in window) requestIdleCallback(renderThumb, { timeout: 800 });
    else setTimeout(renderThumb, 40 * i + 30);
  });
}

function showImage(idx){
  const org = currentOrg;
  const imgs = org.imagery || [];
  if(!imgs[idx]) return;
  currentImgIdx = idx; 
  imgZoomLevel = 1; 
  imgPanX = 0; 
  imgPanY = 0;
  imgZoomAnimating = false;  // Cancel any ongoing animation
  imgAnimToken++; // Invalidate any in-flight zoom animation loop
  activeImgHs = null;  // Deselect hotspot
  document.querySelectorAll('.img-thumb').forEach((el, i) => el.classList.toggle('active', i === idx));
  const loadingEl = document.getElementById('img-loading');
  loadingEl.style.opacity = '1'; loadingEl.style.display = 'flex';
  const imgData = imgs[idx];
  requestAnimationFrame(() => {
    drawMainImage(imgData);
    document.getElementById('img-zoom-badge').textContent = '100%';
    buildImgHotspots(imgData);
    currentHotspotSetKey = 'organism|' + (currentOrg ? currentOrg.id : '') + '|' + imgData.id;
    // Initialize hotspot layer transform
    const hotspotLayer = document.getElementById('img-hotspot-layer');
    hotspotLayer.style.transform = 'translate(0, 0) scale(1)';
    hotspotLayer.style.transformOrigin = '50% 50%';
    loadingEl.style.opacity = '0';
    setTimeout(() => { loadingEl.style.display = 'none'; }, 300);
  });
  document.getElementById('sid-title-img').textContent = imgData.label;
  document.getElementById('sid-sub-img').textContent = `${imgData.modality} · ${imgData.mag}`;
  const videoBtn = imgData.video ? `<button class="video-btn" onclick='exploreDeeper(${JSON.stringify(imgData.label)}, ${JSON.stringify(imgData.desc)}, ${JSON.stringify(imgData.video)})'>▶ Watch related video</button>` : '';
  document.getElementById('sid-body-img').innerHTML = `<div class="fact"><div class="fact-lbl">Description</div><div class="fact-val">${imgData.desc}</div></div>${videoBtn}<div class="sid-empty" style="height:70px"><div class="big-icon">👆</div>Click a colored hotspot on the image</div>`;
}

function drawMainImage(imgData){
  const viewer = document.getElementById('img-viewer');
  const mc = document.getElementById('img-main-canvas');
  const vr = viewer.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  mc.width = Math.round(vr.width * dpr); mc.height = Math.round(vr.height * dpr);
  mc.style.width = vr.width + 'px'; mc.style.height = vr.height + 'px';
  const cx = mc.getContext('2d');
  const src = resolveImageSource(imgData.image);
  if(src.kind === 'procedural'){
    const canvasSrc = getProceduralCanvas(src.key, mc.width, mc.height);
    cx.drawImage(canvasSrc, 0, 0, mc.width, mc.height);
  } else {
    const im = new Image();
    im.onload = () => cx.drawImage(im, 0, 0, mc.width, mc.height);
    im.src = src.url;
  }
}

function buildImgHotspots(imgData){
  if(!imgData || !imgData.regions) return;
  
  const layer = domCache.imgHotspotLayer;
  if(!layer) return;
  
  layer.innerHTML = '';
  layer.style.pointerEvents = 'none';
  (imgData.regions || []).forEach((r, i) => {
    if(!r || !r.label || !r.color) return; // Skip invalid regions
    
    const el = document.createElement('div');
    el.className = 'img-hs';
    el.style.left = (r.x * 100) + '%'; 
    el.style.top = (r.y * 100) + '%';
    el.style.pointerEvents = 'all';
    
    const ring = document.createElement('div');
    ring.className = 'img-hs-ring' + (imgData.video ? ' has-video' : '');
    ring.style.borderColor = r.color; 
    ring.style.color = r.color; 
    ring.style.background = r.color + '22';
    ring.textContent = String.fromCharCode(65 + i);
    ring.classList.toggle('active', r.label === activeImgHs);
    
    ring.onclick = () => {
      activeImgHs = r.label;
      layer.querySelectorAll('.img-hs-ring').forEach(x => x.classList.remove('active'));
      ring.classList.add('active');
      
      domCache.sidTitleImg.textContent = r.label;
      const sidSubImg = document.getElementById('sid-sub-img');
      if(sidSubImg) sidSubImg.textContent = (imgData.label || 'Image') + ' · ' + (imgData.modality || 'microscopy');
      
      const tagsHtml = `<span class="tag blue">${imgData.type || 'image'}</span><span class="tag teal">${imgData.modality || 'light'}</span><span class="tag amber">${imgData.mag || '40×'}</span>`;
      const videoBtn = imgData.video ? `<button class="video-btn" onclick='exploreDeeper(${JSON.stringify(r.label)}, ${JSON.stringify(`<p>${r.label} as seen via ${imgData.modality} microscopy (${imgData.mag}) of ${currentOrg?.name || 'organism'}.</p><p style="margin-top:10px">${imgData.desc || ''}</p>`)}, ${JSON.stringify(imgData.video)})'>▶ Watch related video</button>` : '';
      
      const zoomOutBtn = `<button class="deep-btn" style="background:#0066cc; margin-bottom:8px;" onclick='zoomOutFromHotspot()'>🔍 Zoom Out</button>`;
      
      domCache.sidBodyImg.innerHTML = `
        ${zoomOutBtn}
        <div class="fact"><div class="fact-lbl">Region</div><div class="fact-val">${r.label}</div></div>
        <div class="fact"><div class="fact-lbl">Technique</div><div class="fact-val">${imgData.modality || 'microscopy'} at ${imgData.mag || '40×'}</div></div>
        <div class="fact"><div class="fact-lbl">Image context</div><div class="fact-val">${imgData.desc || 'No description available'}</div></div>
        <div class="tags">${tagsHtml}</div>
        ${videoBtn}
        <button class="deep-btn" onclick='exploreDeeper(${JSON.stringify(r.label)}, ${JSON.stringify(`<p>${r.label} as seen via ${imgData.modality} microscopy (${imgData.mag}) of ${currentOrg?.name || 'organism'}.</p><p style="margin-top:10px">${imgData.desc || ''}</p><div class="tags" style="margin-top:12px">${tagsHtml}</div>`)})'>📘 Explore deeper</button>`;
      
      // Draw structure highlight on the image
      drawStructureHighlight(r, imgData);
      
      // Show quantitative data (Feature #3)
      showDataPanel(r);
      
      // Smoothly zoom and pan to hotspot
      zoomToHotspot(r);
    };
    
    el.appendChild(ring); 
    layer.appendChild(el);
  });
}

function buildTierHotspots(tierId, isPlant){
  const layer = domCache.imgHotspotLayer;
  if(!layer) return;

  const list = (typeof getTierHotspots === 'function') ? getTierHotspots(tierId, isPlant) : null;
  layer.innerHTML = '';
  layer.style.pointerEvents = 'none';
  if(!list || !list.length) return;

  list.forEach((r, i) => {
    const el = document.createElement('div');
    el.className = 'img-hs';
    el.style.left = (r.x * 100) + '%';
    el.style.top = (r.y * 100) + '%';
    el.style.pointerEvents = 'all';

    const ring = document.createElement('div');
    ring.className = 'img-hs-ring';
    ring.style.borderColor = r.color;
    ring.style.color = r.color;
    ring.style.background = r.color + '22';
    ring.textContent = String.fromCharCode(65 + i);
    ring.classList.toggle('active', r.label === activeImgHs);

    ring.onclick = () => {
      activeImgHs = r.label;
      layer.querySelectorAll('.img-hs-ring').forEach(x => x.classList.remove('active'));
      ring.classList.add('active');

      domCache.sidTitleImg.textContent = r.label;
      const sidSubImg = document.getElementById('sid-sub-img');
      if(sidSubImg) sidSubImg.textContent = 'Did you know?';

      const zoomOutBtn = imgZoomLevel > 1.05
        ? `<button class="deep-btn" style="background:#0066cc; margin-bottom:8px;" onclick='zoomOutFromHotspot()'>🔍 Zoom Out</button>`
        : '';

      domCache.sidBodyImg.innerHTML = `
        ${zoomOutBtn}
        <div class="fun-fact-card">
          <div class="fun-fact-icon">💡</div>
          <div class="fun-fact-text">${r.fact}</div>
        </div>
        <div class="fact"><div class="fact-lbl">Structure</div><div class="fact-val">${r.label}</div></div>`;

      // Reuse the same glow highlight system as organism-tier hotspots -- no
      // imgData needed here, it's unused by drawStructureHighlight itself.
      drawStructureHighlight(r, null);
    };

    el.appendChild(ring);
    layer.appendChild(el);
  });
}

// Same tier-relative scale factor redrawImgMain uses for the canvas and hotspot
// layer: within the "organism" tier this equals the raw imgZoomLevel; beyond it,
// each tier scales locally within its own zoom band. drawStructureHighlight and
// updateGlowPosition need this too, or the glow ends up scaled by the much larger
// raw zoom number while the image/hotspots underneath it use the smaller local one.
function getEffectiveDrawZoom(){
  const tier = getZoomTier(imgZoomLevel);
  return tier.id === 'organism' ? imgZoomLevel : (imgZoomLevel / tier.min);
}

function drawStructureHighlight(hotspot, imgData){
  if(!hotspot || !hotspot.label) return;
  
  const mc = domCache.imgMainCanvas;
  if(!mc) return;
  
  // Remove any existing highlight
  const existing = document.querySelector('.img-highlight-svg');
  if(existing) existing.remove();
  
  const viewer = document.getElementById('img-viewer');
  if(!viewer) return;
  
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'img-highlight-svg');
  const { w: logicalW, h: logicalH } = getImgLogicalSize();
  svg.setAttribute('width', logicalW);
  svg.setAttribute('height', logicalH);
  svg.style.position = 'absolute';
  svg.style.top = '0';
  svg.style.left = '0';
  svg.style.pointerEvents = 'none';
  svg.style.display = 'block';
  svg.style.zIndex = '10';

  const color = hotspot.color || '#00ff00';

  // Soft blur filter for the outer halo -- gives the shape a glow quality similar
  // in spirit to the 3D view's emissive mesh highlighting, rather than a hard-edged
  // marker sitting on top of the image.
  const filterId = 'img-glow-blur-' + Math.random().toString(36).slice(2, 9);
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  filter.setAttribute('id', filterId);
  filter.setAttribute('x', '-80%'); filter.setAttribute('y', '-80%');
  filter.setAttribute('width', '260%'); filter.setAttribute('height', '260%');
  const blur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
  blur.setAttribute('stdDeviation', '5');
  filter.appendChild(blur);
  defs.appendChild(filter);
  svg.appendChild(defs);

  // Three concentric shapes -- soft blurred halo, filled body, pulsing outline --
  // all sized/rotated to match the structure's real proportions (hotspot.rx/ry/rot,
  // set in TIER_HOTSPOTS / the JSON region data) instead of a uniform circle.
  const glowShape = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
  glowShape.setAttribute('fill', color);
  glowShape.setAttribute('fill-opacity', '0.30');
  glowShape.setAttribute('filter', `url(#${filterId})`);
  svg.appendChild(glowShape);

  const filledShape = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
  filledShape.setAttribute('fill', color);
  filledShape.setAttribute('fill-opacity', '0.22');
  svg.appendChild(filledShape);

  const borderShape = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
  borderShape.setAttribute('fill', 'none');
  borderShape.setAttribute('stroke', color);
  borderShape.setAttribute('stroke-width', '2.5');
  borderShape.setAttribute('stroke-opacity', '0.9');
  svg.appendChild(borderShape);

  viewer.appendChild(svg);
  
  // STORE GLOW REFERENCE so updateGlowPosition can update it during zoom/pan
  currentImgGlowSVG = svg;
  currentImgGlowHotspot = hotspot;

  // Position/size everything immediately (shares math with updateGlowPosition,
  // called again on every subsequent redraw during zoom/pan animation)
  updateGlowPosition();
  
  // Pulse animation -- the whole shape breathes in and out, not just a border ring
  let scale = 1;
  let growing = true;
  
  function pulse(){
    if(activeImgHs !== hotspot.label){
      svg.remove();
      // Only clear the global tracking if it still points at THIS svg. A newer
      // hotspot click may have already replaced currentImgGlowSVG/Hotspot with
      // its own glow by the time this stale frame runs -- clobbering those
      // unconditionally here was exactly what caused the newer glow to freeze
      // in place instead of tracking the zoom-in animation to its target.
      if(currentImgGlowSVG === svg){
        currentImgGlowSVG = null;
        currentImgGlowHotspot = null;
      }
      return;
    }
    
    scale += growing ? 0.025 : -0.025;
    if(scale > 1.3) growing = false;
    if(scale < 0.9) growing = true;
    
    borderShape.dataset.pulseScale = scale;
    updateGlowPosition();
    requestAnimationFrame(pulse);
  }
  
  pulse();
}

function imgZoom(f){
  imgZoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, imgZoomLevel * f));
  redrawImgMain();
}
function imgReset(){
  imgZoomLevel = 1; imgPanX = 0; imgPanY = 0;
  imgZoomAnimating = false;
  imgAnimToken++; // Invalidate any in-flight zoom animation loop
  redrawImgMain();
}

function zoomToHotspot(hotspot){
  if(!hotspot) return;
  
  const mc = domCache.imgMainCanvas;
  if(!mc) return;
  
  // Target zoom level
  imgTargetZoom = 3.0;
  
  // Hotspot position in CSS-pixel logical space (0-1 normalized to pixel coordinates,
  // same units as imgPanX/Y and the hotspot-layer CSS transform)
  const { w: logicalW, h: logicalH } = getImgLogicalSize();
  const hotspotX = hotspot.x * logicalW;
  const hotspotY = hotspot.y * logicalH;
  
  // Canvas transform is:
  // translate(width/2 + pan) -> scale(zoom) -> translate(-width/2) -> drawImage()
  // Point (x,y) becomes: ((x - width/2) * zoom) + width/2 + pan
  //
  // To center hotspot at screen center (width/2):
  // width/2 = ((hotspotX - width/2) * zoom) + width/2 + pan
  // 0 = ((hotspotX - width/2) * zoom) + pan
  // pan = -(hotspotX - width/2) * zoom
  
  imgTargetPanX = -((hotspotX - logicalW / 2) * imgTargetZoom);
  imgTargetPanY = -((hotspotY - logicalH / 2) * imgTargetZoom);
  
  // Capture the REAL current state as the interpolation start -- not a hardcoded
  // assumption of zoom=1/pan=(0,0). Without this, clicking a hotspot while already
  // zoomed/panned (e.g. from a previous hotspot, or manual wheel/drag) would cause
  // the animation to jump-start from the wrong place.
  const startZoom = imgZoomLevel;
  const startPanX = imgPanX;
  const startPanY = imgPanY;
  
  // Start animation -- bump the token so any still-running previous animation
  // (e.g. an interrupted zoom-out, or a zoom-in to a different hotspot) stops
  // itself on its next tick instead of continuing to fight over shared state.
  imgZoomAnimating = true;
  imgAnimationProgress = 0;
  const myToken = ++imgAnimToken;
  
  // Animate zoom and pan smoothly
  function animateZoom(){
    if(myToken !== imgAnimToken) return; // a newer animation has taken over
    
    imgAnimationProgress += imgAnimationSpeed;
    
    if(imgAnimationProgress >= 1){
      imgAnimationProgress = 1;
      imgZoomAnimating = false;
    }
    
    // Smooth easing (ease-out cubic)
    const easeProgress = 1 - Math.pow(1 - imgAnimationProgress, 3);
    
    // Interpolate current values towards target
    imgZoomLevel = startZoom + (imgTargetZoom - startZoom) * easeProgress;
    imgPanX = startPanX + (imgTargetPanX - startPanX) * easeProgress;
    imgPanY = startPanY + (imgTargetPanY - startPanY) * easeProgress;
    
    redrawImgMain();
    
    if(myToken === imgAnimToken && imgAnimationProgress < 1){
      requestAnimationFrame(animateZoom);
    }
  }
  
  animateZoom();
}

function zoomOutFromHotspot(){
  // Store current zoom/pan as the "from" state for animation
  const currentZoom = imgZoomLevel;
  const currentPanX = imgPanX;
  const currentPanY = imgPanY;
  
  imgTargetZoom = 1;
  imgTargetPanX = 0;
  imgTargetPanY = 0;
  imgZoomAnimating = true;
  imgAnimationProgress = 0;
  const myToken = ++imgAnimToken;
  
  function animateZoomOut(){
    if(myToken !== imgAnimToken) return; // a newer animation has taken over
    
    imgAnimationProgress += imgAnimationSpeed;
    
    if(imgAnimationProgress >= 1){
      imgAnimationProgress = 1;
      imgZoomAnimating = false;
    }
    
    const easeProgress = 1 - Math.pow(1 - imgAnimationProgress, 3);
    imgZoomLevel = currentZoom + (1 - currentZoom) * easeProgress;
    imgPanX = currentPanX + (0 - currentPanX) * easeProgress;
    imgPanY = currentPanY + (0 - currentPanY) * easeProgress;
    
    redrawImgMain();
    
    if(myToken === imgAnimToken && imgAnimationProgress < 1){
      requestAnimationFrame(animateZoomOut);
    }
  }
  
  animateZoomOut();
}

// Update glow position when zoom/pan changes
function updateGlowPosition(){
  if(!currentImgGlowHotspot || !currentImgGlowSVG) return;
  
  const { w: logicalW, h: logicalH } = getImgLogicalSize();
  currentImgGlowSVG.setAttribute('width', logicalW);
  currentImgGlowSVG.setAttribute('height', logicalH);
  
  // Recalculate glow position based on current zoom/pan (CSS-pixel space)
  const baseX = currentImgGlowHotspot.x * logicalW;
  const baseY = currentImgGlowHotspot.y * logicalH;
  
  // Apply zoom (from canvas center)
  const drawZoom = getEffectiveDrawZoom();
  const zoomX = (baseX - logicalW/2) * drawZoom + logicalW/2;
  const zoomY = (baseY - logicalH/2) * drawZoom + logicalH/2;
  
  // Apply pan offset
  const canvasX = zoomX + imgPanX;
  const canvasY = zoomY + imgPanY;

  // Shape dimensions (fraction of image size -> actual pixels at current zoom).
  // Falls back to a small circle if a hotspot somehow lacks shape data.
  const rxFrac = currentImgGlowHotspot.rx != null ? currentImgGlowHotspot.rx : 0.05;
  const ryFrac = currentImgGlowHotspot.ry != null ? currentImgGlowHotspot.ry : 0.05;
  const rotDeg = (currentImgGlowHotspot.rot || 0) * 180 / Math.PI;
  const baseRx = rxFrac * logicalW * drawZoom;
  const baseRy = ryFrac * logicalH * drawZoom;

  const ellipses = currentImgGlowSVG.querySelectorAll('ellipse');
  if(!ellipses.length) return;
  const [glowEl, filledEl, borderEl] = ellipses;
  const pulseScale = (borderEl && borderEl.dataset.pulseScale) ? parseFloat(borderEl.dataset.pulseScale) : 1;

  [[glowEl, 1.18], [filledEl, 1.0], [borderEl, pulseScale]].forEach(([el, mult]) => {
    if(!el) return;
    el.setAttribute('cx', canvasX);
    el.setAttribute('cy', canvasY);
    el.setAttribute('rx', Math.max(2, baseRx * mult));
    el.setAttribute('ry', Math.max(2, baseRy * mult));
    if(rotDeg) el.setAttribute('transform', `rotate(${rotDeg} ${canvasX} ${canvasY})`);
    else el.removeAttribute('transform');
  });
}

function redrawImgMain(){
  const org = currentOrg;
  const imgs = org.imagery || [];
  const imgData = imgs[currentImgIdx];
  if(!imgData) return;
  const viewer = document.getElementById('img-viewer');
  const mc = document.getElementById('img-main-canvas');
  const vr = viewer.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  mc.width = Math.round(vr.width * dpr); mc.height = Math.round(vr.height * dpr);
  mc.style.width = vr.width + 'px'; mc.style.height = vr.height + 'px';
  const cx = mc.getContext('2d');
  const src = resolveImageSource(imgData.image);

  const tier = getZoomTier(imgZoomLevel);
  const isOrganismTier = tier.id === 'organism';
  // Within the "organism" tier, the canvas must scale 1:1 with the raw imgZoomLevel,
  // since that's what the hotspot layer's CSS transform also uses -- keeping the two
  // in exact alignment. Beyond that tier, hotspots no longer apply to specific JSON
  // regions (we're inside freshly-generated cell/organelle/DNA art instead), so each
  // tier is scaled locally within its own zoom band: 1x when you first cross into the
  // tier, growing up to (tier.max/tier.min)x by the time you reach the next tier.
  // This keeps every tier entering the screen at a sensible, readable size instead of
  // inheriting the outer, much larger accumulated zoom number.
  const drawZoom = isOrganismTier ? imgZoomLevel : (imgZoomLevel / tier.min);

  const draw = (drawable) => {
    cx.save();
    cx.translate(mc.width / 2 + imgPanX * dpr, mc.height / 2 + imgPanY * dpr);
    cx.scale(drawZoom, drawZoom);
    cx.translate(-mc.width / 2, -mc.height / 2);
    cx.drawImage(drawable, 0, 0, mc.width, mc.height);
    cx.restore();
  };
  if(src.kind === 'procedural') draw(getProceduralCanvas(src.key, mc.width, mc.height, tier));
  else { const im = new Image(); im.onload = () => draw(im); im.src = src.url; }
  
  // Update hotspot layer transform to match canvas zoom/pan with same center point
  const hotspotLayer = document.getElementById('img-hotspot-layer');
  
  if(hotspotLayer && mc && viewer){
    // Canvas size in CSS pixels (not device pixels)
    const canvasW = mc.style.width ? parseFloat(mc.style.width) : viewer.offsetWidth;
    const canvasH = mc.style.height ? parseFloat(mc.style.height) : viewer.offsetHeight;
    
    // Center of canvas
    const ccx = canvasW / 2;
    const ccy = canvasH / 2;
    
    // Build transform: scale from center + pan
    // Same order as canvas rendering: translate to center → pan → scale → translate back
    hotspotLayer.style.transformOrigin = `${ccx}px ${ccy}px`;
    hotspotLayer.style.transform = `translate(${imgPanX}px, ${imgPanY}px) scale(${drawZoom})`;
    hotspotLayer.style.transition = 'opacity 0.25s ease';
    hotspotLayer.style.opacity = '1';
    hotspotLayer.style.pointerEvents = 'none';

    // Hotspots now exist at every zoom tier: the "organism" tier uses the real
    // per-image JSON region data (unchanged from before); every deeper tier uses
    // the fun-fact hotspots defined in TIER_HOTSPOTS (organisms.js), since that
    // art is freshly-generated per tier rather than photographed at fixed regions.
    // Only rebuild the DOM when the active set actually changes (tier, organism,
    // or image) -- not on every redraw, which happens many times per second during
    // a zoom/pan animation.
    const isPlant = currentOrg && currentOrg.id === 'ara';
    const setKey = tier.id + '|' + (currentOrg ? currentOrg.id : '') + '|' + imgData.id;
    if(setKey !== currentHotspotSetKey){
      currentHotspotSetKey = setKey;
      if(activeImgHs !== null) activeImgHs = null;
      if(currentImgGlowSVG){ currentImgGlowSVG.remove(); currentImgGlowSVG = null; currentImgGlowHotspot = null; }
      if(isOrganismTier){
        buildImgHotspots(imgData);
      } else {
        buildTierHotspots(tier.id, isPlant);
      }
    }
    // Individual hotspot circles carry their own pointer-events:'all' (set once when
    // built) independent of the layer, which always stays pointer-events:none itself
    // (a full-viewer-sized div with pointer-events:auto would intercept clicks meant
    // for the zoom +/-/reset buttons that visually sit above it).
    hotspotLayer.style.zIndex = '15';
  }
  
  // UPDATE GLOW POSITION if one is active (fixes glow staying in place during zoom/pan)
  updateGlowPosition();

  updateZoomBadge(tier);
}

function updateZoomBadge(tier){
  const badge = document.getElementById('img-zoom-badge');
  if(!badge) return;
  const t = tier || getZoomTier(imgZoomLevel);
  const pct = Math.round(imgZoomLevel * 100) + '%';
  badge.textContent = t.id === 'organism' ? pct : (t.label + ' · ' + pct);
}

// Store image event handlers so we can remove them
let imgWheelHandler = null;
let imgMouseDownHandler = null;
let imgMouseMoveHandler = null;
let imgMouseUpHandler = null;
let imgTouchStartHandler = null;
let imgTouchMoveHandler = null;
let imgTouchEndHandler = null;
let imgPinchDist = 0;
let imgPinchMidX = 0;
let imgPinchMidY = 0;

function cleanupImageryListeners(){
  if(!imgViewerEl) return;
  if(imgWheelHandler) imgViewerEl.removeEventListener('wheel', imgWheelHandler);
  if(imgMouseDownHandler) imgViewerEl.removeEventListener('mousedown', imgMouseDownHandler);
  if(imgMouseMoveHandler) window.removeEventListener('mousemove', imgMouseMoveHandler);
  if(imgMouseUpHandler) window.removeEventListener('mouseup', imgMouseUpHandler);
  if(imgTouchStartHandler) imgViewerEl.removeEventListener('touchstart', imgTouchStartHandler);
  if(imgTouchMoveHandler) imgViewerEl.removeEventListener('touchmove', imgTouchMoveHandler);
  if(imgTouchEndHandler) imgViewerEl.removeEventListener('touchend', imgTouchEndHandler);
}

function setupImageryListeners(){
  cleanupImageryListeners();
  
  imgWheelHandler = (e) => { e.preventDefault(); imgZoomAnimating = false; imgAnimToken++; imgZoom(e.deltaY < 0 ? 1.15 : .87); };
  imgMouseDownHandler = (e) => { imgDragging = true; imgLX = e.clientX; imgLY = e.clientY; imgViewerEl.classList.add('dragging'); imgZoomAnimating = false; imgAnimToken++; };
  imgMouseMoveHandler = (e) => { if(!imgDragging) return; imgPanX += e.clientX - imgLX; imgPanY += e.clientY - imgLY; imgLX = e.clientX; imgLY = e.clientY; redrawImgMain(); };
  imgMouseUpHandler = () => { imgDragging = false; imgViewerEl.classList.remove('dragging'); };

  imgTouchStartHandler = (e) => {
    imgZoomAnimating = false; imgAnimToken++;
    if(e.touches.length === 1){
      imgDragging = true;
      imgLX = e.touches[0].clientX; imgLY = e.touches[0].clientY;
    } else if(e.touches.length === 2){
      // Two fingers: stop single-finger panning and start tracking pinch distance
      imgDragging = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      imgPinchDist = Math.sqrt(dx*dx + dy*dy);
      imgPinchMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      imgPinchMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    }
  };

  imgTouchMoveHandler = (e) => {
    if(e.touches.length === 2){
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if(imgPinchDist > 0){
        imgZoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, imgZoomLevel * (dist / imgPinchDist)));
      }
      imgPinchDist = dist;
      // Let the pinch midpoint drift pan too, so a natural two-finger pinch+drag
      // gesture pans and zooms together rather than only zooming from a fixed point
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      if(imgPinchMidX){ imgPanX += midX - imgPinchMidX; imgPanY += midY - imgPinchMidY; }
      imgPinchMidX = midX; imgPinchMidY = midY;
      redrawImgMain();
      return;
    }
    if(!imgDragging || e.touches.length !== 1) return;
    imgPanX += e.touches[0].clientX - imgLX; imgPanY += e.touches[0].clientY - imgLY;
    imgLX = e.touches[0].clientX; imgLY = e.touches[0].clientY;
    redrawImgMain();
  };

  imgTouchEndHandler = (e) => {
    imgDragging = false;
    imgPinchDist = 0; imgPinchMidX = 0; imgPinchMidY = 0;
    // If lifting from two fingers down to one, resume single-finger panning
    // cleanly from that remaining finger's current position instead of jumping
    if(e.touches && e.touches.length === 1){
      imgDragging = true;
      imgLX = e.touches[0].clientX; imgLY = e.touches[0].clientY;
    }
  };
  
  imgViewerEl.addEventListener('wheel', imgWheelHandler, { passive: false });
  imgViewerEl.addEventListener('mousedown', imgMouseDownHandler);
  window.addEventListener('mousemove', imgMouseMoveHandler);
  window.addEventListener('mouseup', imgMouseUpHandler);
  imgViewerEl.addEventListener('touchstart', imgTouchStartHandler, { passive: true });
  imgViewerEl.addEventListener('touchmove', imgTouchMoveHandler, { passive: true });
  imgViewerEl.addEventListener('touchend', imgTouchEndHandler, { passive: true });
}

const imgViewerEl = domCache.imgViewer; // Alias for backward compatibility

// Cache frequently accessed DOM elements for better performance
setupImageryListeners(); // Initialize listeners once

/* ============================================================
   LIFE CYCLE VIEW
   ============================================================ */
let activeLcId = null;
let lcSubView = 'timelapse';
function lcSetSubView(v){
  lcSubView = v;
  document.getElementById('tl-panel').style.display = v === 'timelapse' ? 'flex' : 'none';
  document.getElementById('lifecycle-panel').style.display = v === 'original' ? 'block' : 'none';
  document.getElementById('lc-subnav-timelapse').classList.toggle('active', v === 'timelapse');
  document.getElementById('lc-subnav-original').classList.toggle('active', v === 'original');
  // The time-lapse canvas was hidden (display:none doesn't report real
  // dimensions), so its renderer needs an explicit resize + render now
  // that it's visible again and has its real (now full-height) box size.
  if(v === 'timelapse' && typeof tlResize === 'function'){
    tlResize();
    tlRequestRender();
  }
}

function initLifecycle(){
  const org = currentOrg;
  const stages = org.lifecycle || [];
  const panel = document.getElementById('lifecycle-panel');
  panel.innerHTML = '';
  document.getElementById('sid-title-lc').textContent = org.name + ' life cycle';
  document.getElementById('sid-sub-lc').textContent = 'Click a stage';
  document.getElementById('sid-body-lc').innerHTML = '<div class="sid-empty"><div class="big-icon">🔄</div>Select a stage</div>';
  if(!stages.length){ panel.innerHTML = '<p style="color:rgba(255,255,255,.3);font-size:14px;padding:24px">No life cycle data for this organism yet.</p>'; return; }
  stages.forEach((s, i) => {
    const div = document.createElement('div'); div.className = 'lc-stage'; div.onclick = () => selectLcStage(s.id);
    const icon = document.createElement('div'); icon.className = 'lc-icon';
    icon.style.background = s.color + '22'; icon.style.border = `2px solid ${s.color}55`; icon.style.color = s.color;
    icon.textContent = (i + 1) + '';
    const col = document.createElement('div'); col.className = 'lc-col'; // vertical stack: info on top, detail below
    const info = document.createElement('div'); info.className = 'lc-info';
    info.innerHTML = `<div class="lc-name">${s.name}</div><div class="lc-desc">${s.desc.slice(0, 100)}…</div><div class="lc-duration">⏱ ${s.duration}</div>`;
    const detail = document.createElement('div'); detail.className = 'lc-detail'; detail.id = 'lc-detail-' + s.id;
    detail.innerHTML = `<p>${s.desc}</p><div class="lc-detail-tags">${(s.tags || []).map(t => `<span class="lc-detail-tag">${t}</span>`).join('')}</div>`;
    col.appendChild(info); col.appendChild(detail);
    div.appendChild(icon); div.appendChild(col); div.id = 'lc-stage-' + s.id;
    panel.appendChild(div);
    if(i < stages.length - 1){ const arr = document.createElement('div'); arr.className = 'lc-arrow'; arr.textContent = '↓'; panel.appendChild(arr); }
  });
}
function selectLcStage(id){
  activeLcId = id;
  const org = currentOrg;
  const s = org.lifecycle.find(x => x.id === id);
  if(!s) return;
  document.querySelectorAll('.lc-stage').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.lc-detail').forEach(el => el.classList.remove('show'));
  const el = document.getElementById('lc-stage-' + id); if(el) el.classList.add('active');
  const det = document.getElementById('lc-detail-' + id); if(det) det.classList.add('show');
  document.getElementById('sid-title-lc').textContent = s.name;
  document.getElementById('sid-sub-lc').textContent = s.duration;
  const tags = (s.tags || []).map(t => `<span class="tag teal">${t}</span>`).join('');
  document.getElementById('sid-body-lc').innerHTML = `
    <div class="fact"><div class="fact-lbl">Duration</div><div class="fact-val">${s.duration}</div></div>
    <div class="fact"><div class="fact-lbl">Stage details</div><div class="fact-val">${s.desc}</div></div>
    <div class="tags">${tags}</div>
    <button class="deep-btn" onclick='exploreDeeper(${JSON.stringify(s.name)}, ${JSON.stringify(`<p style="margin-bottom:14px">${s.desc}</p><div class="tags">${tags}</div>`)})'>📘 Explore deeper</button>`;
}

/* ============================================================
   WORKFLOW VIEW
   ============================================================ */
let activeWfId = null, activeWfStep = null;
function initWorkflow(){
  const org = currentOrg;
  const wfs = org.workflows || [];
  const sel = document.getElementById('wf-selector'); sel.innerHTML = '';
  const panel = document.getElementById('workflow-panel'); panel.innerHTML = '';
  document.getElementById('sid-title-wf').textContent = 'Workflow';
  document.getElementById('sid-sub-wf').textContent = 'Select a step';
  document.getElementById('sid-body-wf').innerHTML = '<div class="sid-empty"><div class="big-icon">🧪</div>Select a step</div>';
  if(!wfs.length){ sel.innerHTML = '<p style="color:rgba(255,255,255,.3);font-size:13px;padding:20px">No workflows yet.</p>'; return; }
  wfs.forEach((wf, i) => {
    const btn = document.createElement('div'); btn.className = 'wf-sel-item' + (i === 0 ? ' active' : '');
    btn.innerHTML = `<span class="dot" style="background:${wf.color}"></span>${wf.name}`;
    btn.onclick = () => {
      sel.querySelectorAll('.wf-sel-item').forEach(x => x.classList.remove('active'));
      btn.classList.add('active');
      showWorkflow(wf.id);
    };
    sel.appendChild(btn);
  });
  if(wfs.length) showWorkflow(wfs[0].id);
}
function showWorkflow(id){
  activeWfId = id; activeWfStep = null;
  const org = currentOrg;
  const wf = org.workflows.find(w => w.id === id);
  if(!wf) return;
  const panel = document.getElementById('workflow-panel'); panel.innerHTML = '';
  document.getElementById('sid-title-wf').textContent = wf.name;
  document.getElementById('sid-sub-wf').textContent = `${wf.steps.length} steps`;
  document.getElementById('sid-body-wf').innerHTML = '<div class="sid-empty"><div class="big-icon">🧪</div>Click a step for details</div>';
  wf.steps.forEach((step, i) => {
    const div = document.createElement('div'); div.className = 'wf-step';
    const line = document.createElement('div'); line.className = 'wf-line';
    const num = document.createElement('div'); num.className = 'wf-num';
    num.style.cssText = `border-color:${wf.color}88;color:${wf.color};background:${wf.color}15`;
    num.textContent = i + 1;
    const body = document.createElement('div'); body.className = 'wf-body';
    const text = document.createElement('div'); text.className = 'wf-text';
    text.innerHTML = `<div class="wf-step-title">${step.title}</div><div class="wf-step-desc">${step.desc}</div><span class="wf-duration">⏱ ${step.duration}</span>`;
    const preview = document.createElement('div'); preview.className = 'wf-img-preview';
    const pc = document.createElement('canvas'); pc.width = 320; pc.height = 180;
    preview.appendChild(pc);
    const vizFn = WorkflowDiagrams[step.viz] || WorkflowDiagrams.plasmid;
    vizFn(pc.getContext('2d'), 320, 180, wf.color);
    body.appendChild(text); body.appendChild(preview);
    div.appendChild(line); div.appendChild(num); div.appendChild(body);
    div.onclick = () => {
      activeWfStep = i;
      panel.querySelectorAll('.wf-step').forEach(x => x.classList.remove('active'));
      div.classList.add('active');
      document.getElementById('sid-title-wf').textContent = `Step ${i + 1}: ${step.title}`;
      document.getElementById('sid-sub-wf').textContent = wf.name;
      document.getElementById('sid-body-wf').innerHTML = `
        <div class="fact"><div class="fact-lbl">Step ${i + 1} of ${wf.steps.length}</div><div class="fact-val">${step.title}</div></div>
        <div class="fact"><div class="fact-lbl">Protocol</div><div class="fact-val">${step.desc}</div></div>
        <div class="fact"><div class="fact-lbl">Duration</div><div class="fact-val">${step.duration}</div></div>
        <div class="tags"><span class="tag blue">${wf.name}</span></div>`;
    };
    panel.appendChild(div);
  });
}

/* ============================================================
   INIT
   ============================================================ */
async function init(){
  await OrganismStore.loadAll();
  if(OrganismStore.order.length === 0){
    document.getElementById('topbar-sub').textContent = 'No organism data loaded — check /data/manifest.json';
    showFatalError(
      'Couldn\u2019t load organism data',
      'The app could not read /data/manifest.json or the organism JSON files. If you opened this file directly (double-clicked it), browsers block local file reads for security — please serve this folder from a local web server instead (see README.md) or upload it to any web host.'
    );
    return;
  }
  buildTabs();

  if(typeof THREE === 'undefined'){
    // Three.js CDN failed to load (offline, blocked, firewall, etc).
    // Degrade gracefully instead of leaving a silent dead spinner.
    document.getElementById('topbar-sub').textContent = `${OrganismStore.order.length} organisms loaded — 3D view unavailable (offline)`;
    document.getElementById('load-badge').innerHTML =
      '⚠ 3D engine could not load.<br><span style="font-size:12px;opacity:.7">This kiosk needs an internet connection on first load to fetch the 3D library.<br>Microscopy, Life Cycle, and Workflow tabs still work fully offline.</span>';
    currentOrg = OrganismStore.list()[0];
    document.getElementById('sid-body-3d').innerHTML = '<div class="sid-empty"><div class="big-icon">⚠️</div>3D view needs an internet connection on first load.</div>';
    // Auto-switch to a view that works without WebGL so the kiosk isn't dead on arrival
    setView('imagery');
    return;
  }

  try{
    initWebGL();
    switchOrg(OrganismStore.order[0]);
  }catch(err){
    console.error('3D initialization failed:', err);
    document.getElementById('topbar-sub').textContent = `${OrganismStore.order.length} organisms loaded — 3D view failed to start`;
    document.getElementById('load-badge').innerHTML = '⚠ 3D view failed to start. Try the Microscopy, Life Cycle, or Workflow tabs instead.';
    setView('imagery');
    return;
  }

  document.getElementById('view-imagery').style.display = 'none';
  document.getElementById('view-lifecycle').style.display = 'none';
  document.getElementById('view-workflow').style.display = 'none';
  setTimeout(() => {
    const b = document.getElementById('load-badge');
    if(b){ b.style.opacity = '0'; setTimeout(() => b && b.remove(), 300); }
  }, 500);
}

function showFatalError(title, message){
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#7a2d1c;color:#fff;font-size:13px;padding:14px 24px;z-index:999;text-align:center;font-family:sans-serif;line-height:1.6';
  banner.innerHTML = `<strong>${title}</strong> — ${message}`;
  document.body.prepend(banner);
}

init();

/* ============================================================
   FEATURE #3: QUANTITATIVE DATA OVERLAY
   ============================================================ */

function showDataPanel(hotspot) {
  if(!hotspot || !hotspot.data) return;
  
  const panel = document.getElementById('data-panel');
  const body = document.getElementById('data-panel-body');
  const title = document.getElementById('data-panel-title');
  
  // Set title
  title.textContent = hotspot.name || 'Structure Data';
  
  // Build content
  let html = '';
  
  // Add all data fields except 'function'
  for(const [key, value] of Object.entries(hotspot.data)){
    if(key === 'function') continue;
    
    const displayKey = key
      .replace(/_/g, ' ')
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    
    html += `<div class="data-item">
      <div class="data-key">${displayKey}</div>
      <div class="data-value">${value}</div>
    </div>`;
  }
  
  // Add function as highlighted section
  if(hotspot.data.function){
    html += `<div class="data-function">
      <strong>Function:</strong> ${hotspot.data.function}
    </div>`;
  }
  
  body.innerHTML = html;
  panel.style.display = 'block';
}

function closeDataPanel() {
  const panel = document.getElementById('data-panel');
  panel.style.display = 'none';
}

/* LIFECYCLE/WORKFLOW VIEW */
function initLifecycleView() {
  const panel = document.getElementById('lifecycle-panel');
  const org = currentOrg;
  
  let html = `<div style="padding:20px;color:#e0e6ff">
    <h2 style="color:#4a9eff;margin-bottom:20px">${org.name} - Life Cycle</h2>`;
  
  if(org.id === 'ara') {
    html += `
    <div style="line-height:2;font-size:14px">
      <div style="margin-bottom:20px">
        <strong style="color:#7ab8ff">Seed Germination (0-5 days)</strong>
        <p>Seed absorbs water → Radicle emerges → Primary root forms</p>
      </div>
      <div style="margin-bottom:20px">
        <strong style="color:#7ab8ff">Seedling Stage (1-2 weeks)</strong>
        <p>Cotyledons emerge → True leaves develop → Root system expands</p>
      </div>
      <div style="margin-bottom:20px">
        <strong style="color:#7ab8ff">Vegetative Growth (2-6 weeks)</strong>
        <p>Rosette leaves form → ~20-40 leaves produced → Root hairs increase nutrient uptake</p>
      </div>
      <div style="margin-bottom:20px">
        <strong style="color:#7ab8ff">Bolting (6-8 weeks)</strong>
        <p>Inflorescence meristem activated → Stem elongates → Flowering begins</p>
      </div>
      <div style="margin-bottom:20px">
        <strong style="color:#7ab8ff">Flowering (8-10 weeks)</strong>
        <p>~200-500 flowers produced → Self-fertilization occurs → Siliques develop</p>
      </div>
      <div style="margin-bottom:20px">
        <strong style="color:#7ab8ff">Seed Maturation (10-12 weeks)</strong>
        <p>Seeds mature in siliques → ~5000-10000 seeds per plant → Senescence begins</p>
      </div>
    </div>`;
  } else {
    html += `
    <div style="line-height:2;font-size:14px">
      <div style="margin-bottom:20px">
        <strong style="color:#7ab8ff">Embryonic (0 hrs - 380 min)</strong>
        <p>Cell divisions → Body axis formation → 302 neurons generated → 7000+ synapses established</p>
      </div>
      <div style="margin-bottom:20px">
        <strong style="color:#7ab8ff">Larval Stage 1 (L1: 12 hrs)</strong>
        <p>Growth by cell division → Pharynx feeding starts → Intestinal cells active (~35 cells)</p>
      </div>
      <div style="margin-bottom:20px">
        <strong style="color:#7ab8ff">Larval Stage 2-4 (L2-L4: 24-48 hrs)</strong>
        <p>Continued growth → Gonad develops (~1000 oocytes) → Vulva forms (6 cells)</p>
      </div>
      <div style="margin-bottom:20px">
        <strong style="color:#7ab8ff">Adult Stage (48 hrs onward)</strong>
        <p>Sexual maturity reached → Self-fertilization begins → ~300 progeny produced</p>
      </div>
      <div style="margin-bottom:20px">
        <strong style="color:#7ab8ff">Reproductive Phase (3-4 days)</strong>
        <p>Peak egg production → Intestine stores nutrients → Gonad maximally active</p>
      </div>
      <div style="margin-bottom:20px">
        <strong style="color:#7ab8ff">Aging (4+ days)</strong>
        <p>Reproduction declines → Lipid accumulation → Senescence begins (lifespan ~20 days)</p>
      </div>
    </div>`;
  }
  
  html += `</div>`;
  panel.innerHTML = html;
}

// Call when switching views
const origSwitchView = window.switchView || (() => {});
window.switchView = function(viewId) {
  if(viewId === 'lifecycle') initLifecycleView();
  origSwitchView(viewId);
};

/* WORKFLOW STEP VISUALIZATIONS */
const WorkflowDiagrams = {
  culture(ctx, w, h, color) {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);
    // Petri dish
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(w/2, h/2, 60, 40, 0, 0, Math.PI*2);
    ctx.stroke();
    // Worms inside
    ctx.fillStyle = color;
    for(let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(w/2 - 30 + i*30, h/2, 8, 4, 0, 0, Math.PI*2);
      ctx.fill();
    }
  },
  mount(ctx, w, h, color) {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);
    // Slide
    ctx.fillStyle = '#555';
    ctx.fillRect(w/4, h*0.6, w/2, 15);
    // Coverslip
    ctx.fillStyle = 'rgba(100,150,255,0.3)';
    ctx.fillRect(w/4, h*0.4, w/2, 15);
    // Worm
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(w/2, h/2, 30, 10, 0, 0, Math.PI*2);
    ctx.stroke();
  },
  scope(ctx, w, h, color) {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);
    // Microscope
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(w/2, h*0.3, 25, 0, Math.PI*2);
    ctx.stroke();
    // Green dots (GFP)
    ctx.fillStyle = '#64ff96';
    for(let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(w/2 - 15 + i*8, h*0.3, 2, 0, Math.PI*2);
      ctx.fill();
    }
  },
  analysis(ctx, w, h, color) {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);
    // Graph
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w*0.2, h*0.7);
    ctx.lineTo(w*0.8, h*0.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w*0.2, h*0.7);
    ctx.lineTo(w*0.2, h*0.2);
    ctx.stroke();
    // Line plot
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w*0.25, h*0.5);
    ctx.lineTo(w*0.4, h*0.4);
    ctx.lineTo(w*0.55, h*0.45);
    ctx.lineTo(w*0.7, h*0.25);
    ctx.stroke();
  },
  mutagen(ctx, w, h, color) {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);
    // Beaker
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(w*0.3, h*0.3, w*0.4, h*0.4);
    ctx.stroke();
    // Chemical symbol
    ctx.fillStyle = color;
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('EMS', w/2, h*0.55);
  },
  cross(ctx, w, h, color) {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);
    // Two circles (parents)
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(w*0.3, h/2, 15, 0, Math.PI*2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(w*0.7, h/2, 15, 0, Math.PI*2);
    ctx.stroke();
    // Arrow
    ctx.beginPath();
    ctx.moveTo(w*0.45, h/2);
    ctx.lineTo(w*0.55, h/2);
    ctx.stroke();
    // Arrow head
    ctx.beginPath();
    ctx.moveTo(w*0.55, h/2);
    ctx.lineTo(w*0.5, h/2 - 5);
    ctx.lineTo(w*0.5, h/2 + 5);
    ctx.closePath();
    ctx.fill();
  },
  screen(ctx, w, h, color) {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);
    // Grid of worms
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    for(let i = 0; i < 3; i++) {
      for(let j = 0; j < 3; j++) {
        ctx.beginPath();
        ctx.ellipse(w*0.25 + i*w*0.25, h*0.3 + j*h*0.2, 8, 5, 0, 0, Math.PI*2);
        ctx.stroke();
      }
    }
  },
  map(ctx, w, h, color) {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);
    // Chromosome
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w*0.2, h/2);
    ctx.lineTo(w*0.8, h/2);
    ctx.stroke();
    // Markers
    ctx.fillStyle = color;
    for(let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(w*0.3 + i*w*0.15, h/2, 4, 0, Math.PI*2);
      ctx.fill();
    }
  },
  sterilize(ctx, w, h, color) {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);
    // Spray bottle
    ctx.fillStyle = color;
    ctx.fillRect(w*0.4, h*0.35, 15, 30);
    ctx.beginPath();
    ctx.arc(w/2 + 7.5, h*0.3, 7, 0, Math.PI*2);
    ctx.fill();
    // Spray mist
    ctx.fillStyle = 'rgba(100,150,255,0.3)';
    for(let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.arc(w/2 + 15 + i*3, h/2, 1, 0, Math.PI*2);
      ctx.fill();
    }
  },
  plate(ctx, w, h, color) {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);
    // Plate
    ctx.fillStyle = 'rgba(100,100,100,0.3)';
    ctx.beginPath();
    ctx.ellipse(w/2, h/2, 50, 35, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  },
  growth(ctx, w, h, color) {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);
    // Plant roots
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w/2, h*0.2);
    ctx.lineTo(w/2, h*0.8);
    ctx.stroke();
    // Root hairs
    for(let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(w/2, h*0.3 + i*h*0.1);
      ctx.lineTo(w/2 + 10, h*0.3 + i*h*0.1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(w/2, h*0.3 + i*h*0.1);
      ctx.lineTo(w/2 - 10, h*0.3 + i*h*0.1);
      ctx.stroke();
    }
  },
  measure(ctx, w, h, color) {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);
    // Ruler
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w*0.2, h/2);
    ctx.lineTo(w*0.8, h/2);
    ctx.stroke();
    // Tick marks
    for(let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.moveTo(w*0.2 + i*w*0.1, h/2 - 5);
      ctx.lineTo(w*0.2 + i*w*0.1, h/2 + 5);
      ctx.stroke();
    }
  },
  bolt(ctx, w, h, color) {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);
    // Plant in rosette
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    for(let i = 0; i < 5; i++) {
      const angle = (i/5) * Math.PI*2;
      ctx.beginPath();
      ctx.moveTo(w/2, h/2);
      ctx.lineTo(w/2 + Math.cos(angle)*30, h/2 + Math.sin(angle)*30);
      ctx.stroke();
    }
    // Flowering stem
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w/2, h/2);
    ctx.lineTo(w/2, h*0.2);
    ctx.stroke();
  },
  flower(ctx, w, h, color) {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);
    // Flower
    ctx.fillStyle = color;
    for(let i = 0; i < 4; i++) {
      const angle = (i/4) * Math.PI*2;
      ctx.beginPath();
      ctx.ellipse(w/2 + Math.cos(angle)*15, h/2 + Math.sin(angle)*15, 8, 12, angle, 0, Math.PI*2);
      ctx.fill();
    }
    // Center
    ctx.fillStyle = '#ffff00';
    ctx.beginPath();
    ctx.arc(w/2, h/2, 5, 0, Math.PI*2);
    ctx.fill();
  },
  harvest(ctx, w, h, color) {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);
    // Silique
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(w/2, h/2, 10, 40, 0, 0, Math.PI*2);
    ctx.stroke();
    // Divider line
    ctx.beginPath();
    ctx.moveTo(w/2, h*0.2);
    ctx.lineTo(w/2, h*0.8);
    ctx.stroke();
  },
  seeds(ctx, w, h, color) {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);
    // Seeds in silique
    ctx.fillStyle = color;
    for(let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.arc(w/2 - 5, h*0.3 + i*h*0.08, 3, 0, Math.PI*2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(w/2 + 5, h*0.3 + i*h*0.08, 3, 0, Math.PI*2);
      ctx.fill();
    }
  }
};
