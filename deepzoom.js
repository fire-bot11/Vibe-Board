/* ============================================================
   DEEP ZOOM — continuous 3D LOD, organism → tissue → cell →
   organelle → nucleus → chromosome → DNA

   HOW THE "CONTINUOUS" ZOOM WORKS
   A literal single camera flying through nested real-world scale
   (mm organism -> nm DNA, an 8-order-of-magnitude range) isn't
   meaningful to render or navigate. Instead, each tier is built as
   its own small Three.js group sized to roughly fill the frame at
   "rest". The camera never moves. A continuous zoom value (dzZoom)
   drives two things every frame: (1) each visible group's scale,
   which grows smoothly as the user zooms deeper into that tier's
   band, and (2) near each tier boundary, a blend window where the
   *current* tier keeps growing/fading out while the *next* tier's
   group fades in already mid-grow. That simultaneous grow+crossfade
   is what sells "diving through" one scale into the next as one
   continuous gesture rather than a discrete swap -- the same trick
   nested/cosmic-zoom visualizations use. It reuses the tier-band
   concept (ZOOM_TIERS/getZoomTier) proven out in organisms.js.

   CPU DISCIPLINE (matches lessons from the 3D Anatomy view):
   Low segment counts, capped pixel ratio, a small fixed 4-light + ambient
   rig (no shadow maps, no environment map), ~30fps render cap, demand
   based rendering (loop stops entirely when this tab isn't active), and
   only the 1-2 tiers actually visible at a given zoom are ever
   updated/rendered per frame -- the rest sit inert in the cache. Materials
   are MeshPhysicalMaterial (clearcoat, no transmission -- transmission
   requires an extra render-target pass per material and was judged not
   worth the cost here) for real specular highlights instead of flat
   Lambert shading.
   ============================================================ */

/* ---------- tier bands ----------
   Mirrors the *shape* of organisms.js's ZOOM_TIERS (7 named bands,
   same ids/labels) but with a finite top end, since each band here
   also needs a numeric span to drive continuous scale-growth math. */
const DZ_TIERS = [
  { id:'organism',   min:1,  max:5,  label:'Organism',   icon:'🧫' },
  { id:'tissue',     min:5,  max:11, label:'Tissue',     icon:'🧱' },
  { id:'cell',       min:11, max:18, label:'Cell',       icon:'🔵' },
  { id:'organelle',  min:18, max:26, label:'Organelle',  icon:'🟠' },
  { id:'nucleus',    min:26, max:34, label:'Nucleus',    icon:'🟣' },
  { id:'chromosome', min:34, max:42, label:'Chromosome', icon:'🧬' },
  { id:'dna',        min:42, max:50, label:'DNA',        icon:'🔗' },
];
const DZ_ZOOM_MIN = 1, DZ_ZOOM_MAX = 50;
const DZ_CAMERA_RADIUS = 4.3; // fixed camera distance -- comfortably beyond the largest
                               // tier's bounding radius (~2) even at max DZ_GROWTH scale
const DZ_BLEND = 0.28;      // fraction of a tier's band spent crossfading into the next
const DZ_GROWTH = 2.0;      // how many x a tier's group grows across its own band -- kept
                             // modest relative to DZ_CAMERA_RADIUS below so scaled geometry
                             // never reaches (let alone clips through) the fixed camera

/* ---------- state ---------- */
let dzRenderer, dzScene, dzCamera;
let dzReady = false;
let dzAnimId = null;
let dzZoom = DZ_ZOOM_MIN;
let dzOrbit = { theta: 0.5, phi: 1.2 };   // simple fixed-radius orbit, no dolly
let dzDragging = false, dzLastX = 0, dzLastY = 0, dzPinchDist = 0;
let dzTierCache = {};        // key: `${orgId}:${isPlant}:${tierId}` -> { group, hotspots:[{id,label,color,localPos,fact}] }
let dzHotspotAnchors = [];   // flattened, rebuilt whenever the org changes
let dzActiveHsKey = null;
let dzLastRenderTime = 0;
const DZ_RENDER_INTERVAL = 1000 / 30;
let dzCachedRect = null;

const dzDom = {};
function dzCacheDom(){
  dzDom.canvas = document.getElementById('dz-canvas');
  dzDom.wrap = document.getElementById('dz-canvas-wrap');
  dzDom.hotspotLayer = document.getElementById('dz-hotspot-layer');
  dzDom.badge = document.getElementById('dz-tier-badge');
  dzDom.strip = document.getElementById('dz-tier-strip');
  dzDom.loadBadge = document.getElementById('dz-load-badge');
  dzDom.sidTitle = document.getElementById('sid-title-dz');
  dzDom.sidSub = document.getElementById('sid-sub-dz');
  dzDom.sidBody = document.getElementById('sid-body-dz');
  dzDom.partsList = document.getElementById('dz-parts-list');
}

/* ---------- small color helper (no texture generation needed here) ---------- */
function dzShade(hex, amt){
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
function initDeepZoom(){
  dzCacheDom();
  if(!dzDom.canvas || typeof THREE === 'undefined') return;

  dzRenderer = new THREE.WebGLRenderer({ canvas: dzDom.canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  dzRenderer.setPixelRatio(1); // same CPU lever as the main 3D view
  dzRenderer.shadowMap.enabled = false;
  dzRenderer.outputColorSpace = THREE.SRGBColorSpace;

  dzScene = new THREE.Scene();
  dzScene.background = new THREE.Color(0x080c12);

  dzCamera = new THREE.PerspectiveCamera(40, 1, 0.05, 50);

  // 360-DEGREE LIGHT RIG. The original single key+ambient light left the
  // far side of every mesh dark as soon as you orbited around it. Four
  // directional lights aimed from opposing corners (front/back, up/down
  // pairs) plus a strong ambient floor mean every possible camera angle
  // always has at least 2-3 lights hitting it -- nothing goes fully black --
  // while still keeping enough directional variation between the four to
  // read as real 3D shading (not a flat, shadeless wash).
  const rig = [
    { pos: [ 3,  2,  3], intensity: 1.5 },
    { pos: [-3,  1.5, -3], intensity: 1.3 },
    { pos: [-2, -2,  2.5], intensity: 1.2 },
    { pos: [ 2, -1.5, -3], intensity: 1.1 },
  ];
  rig.forEach(l => {
    const light = new THREE.DirectionalLight(0xffffff, l.intensity);
    light.position.set(l.pos[0], l.pos[1], l.pos[2]);
    dzScene.add(light);
  });
  const ambient = new THREE.AmbientLight(0xb8c0cc, 1.0);
  dzScene.add(ambient);

  dzWireControls();
  dzBuildTierStrip();
  dzReady = true;
  dzResize();
}

function dzBuildTierStrip(){
  if(!dzDom.strip || dzDom.strip.childElementCount) return;
  DZ_TIERS.forEach(t => {
    const chip = document.createElement('div');
    chip.className = 'dz-tier-chip';
    chip.dataset.tier = t.id;
    chip.textContent = t.icon + ' ' + t.label;
    chip.onclick = () => dzSetZoom(t.min + (t.max - t.min) * 0.15);
    dzDom.strip.appendChild(chip);
  });
}

function dzWireControls(){
  const el = dzDom.canvas;

  function updateCam(){
    const r = DZ_CAMERA_RADIUS;
    const sinPhi = Math.sin(dzOrbit.phi);
    dzCamera.position.set(
      r * sinPhi * Math.sin(dzOrbit.theta),
      r * Math.cos(dzOrbit.phi),
      r * sinPhi * Math.cos(dzOrbit.theta)
    );
    dzCamera.lookAt(0, 0, 0);
  }
  dzCamera && updateCam();
  dzWireControls._updateCam = updateCam;

  el.addEventListener('mousedown', e => { dzDragging = true; dzLastX = e.clientX; dzLastY = e.clientY; });
  window.addEventListener('mousemove', e => {
    if(!dzDragging) return;
    dzOrbit.theta -= (e.clientX - dzLastX) * 0.006;
    dzOrbit.phi = Math.max(0.3, Math.min(Math.PI - 0.3, dzOrbit.phi - (e.clientY - dzLastY) * 0.006));
    dzLastX = e.clientX; dzLastY = e.clientY;
    dzRequestRender();
  });
  window.addEventListener('mouseup', () => dzDragging = false);

  el.addEventListener('wheel', e => {
    e.preventDefault();
    dzSetZoom(dzZoom + (e.deltaY < 0 ? 1.4 : -1.4));
  }, { passive: false });

  el.addEventListener('touchstart', e => {
    if(e.touches.length === 1){ dzDragging = true; dzLastX = e.touches[0].clientX; dzLastY = e.touches[0].clientY; }
    else if(e.touches.length === 2){
      const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY;
      dzPinchDist = Math.sqrt(dx*dx + dy*dy);
    }
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if(e.touches.length === 2){
      const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY;
      const d = Math.sqrt(dx*dx + dy*dy);
      dzSetZoom(dzZoom + (d - dzPinchDist) * 0.05);
      dzPinchDist = d;
      return;
    }
    if(e.touches.length === 1 && dzDragging){
      dzOrbit.theta -= (e.touches[0].clientX - dzLastX) * 0.006;
      dzOrbit.phi = Math.max(0.3, Math.min(Math.PI - 0.3, dzOrbit.phi - (e.touches[0].clientY - dzLastY) * 0.006));
      dzLastX = e.touches[0].clientX; dzLastY = e.touches[0].clientY;
      dzRequestRender();
    }
  }, { passive: true });
  el.addEventListener('touchend', () => dzDragging = false, { passive: true });

  window.addEventListener('resize', dzResize);
}

function dzResize(){
  if(!dzReady) return;
  const r = dzDom.wrap.getBoundingClientRect();
  if(r.width < 2 || r.height < 2) return;
  dzRenderer.setSize(r.width, r.height, false);
  dzCamera.aspect = r.width / r.height;
  dzCamera.updateProjectionMatrix();
  dzCachedRect = r;
  dzRequestRender();
}

let dzRenderNeeded = true;
function dzRequestRender(){ dzRenderNeeded = true; dzEnsureAnimating(); }
function dzEnsureAnimating(){
  if(currentView === 'deepzoom' && dzReady && !dzAnimId){
    dzAnimId = requestAnimationFrame(dzAnimate);
  }
}

/* ============================================================
   GEOMETRY BUILDERS — one THREE.Group per tier, built once per
   (organism, isPlant, tier) and cached.
   ============================================================ */
function dzDisposeGroup(group){
  group.traverse(obj => {
    if(obj.geometry) obj.geometry.dispose();
    if(obj.material){
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => m.dispose());
    }
  });
}
function dzClearCache(){
  Object.values(dzTierCache).forEach(entry => { if(entry.group.parent) dzScene.remove(entry.group); dzDisposeGroup(entry.group); });
  dzTierCache = {};
}

/* Cheap shared detail texture -- NOT the Anatomy tab's full cuticle/bump
   MeshPhysicalMaterial treatment (that's real per-organism texture work and
   too much draw/shader cost to repeat across 7 simultaneously-cached deep
   zoom tiers). This is one small grayscale mottled/speckle canvas, built
   once and reused as a multiply-map wherever a big flat surface needs to
   stop looking like a solid color swatch (worm body, plant stem/leaves).
   Material.color still does all the actual coloring -- the texture only
   contributes surface noise. */
let dzDetailTexBase = null;
function dzGetDetailTexture(repeatX, repeatY){
  if(!dzDetailTexBase){
    const w = 512, h = 128;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    for(let x = 0; x < w; x += 6){
      ctx.globalAlpha = (x % 12 === 0) ? 0.18 : 0.06;
      ctx.fillStyle = '#000000';
      ctx.fillRect(x, 0, 1.5, h);
    }
    ctx.globalAlpha = 1;
    for(let i = 0; i < 4000; i++){
      const x = Math.random() * w, y = Math.random() * h;
      ctx.globalAlpha = Math.random() * 0.14;
      ctx.fillStyle = Math.random() > 0.55 ? '#ffffff' : '#000000';
      ctx.beginPath(); ctx.arc(x, y, Math.random() * 1.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    dzDetailTexBase = new THREE.CanvasTexture(c);
    dzDetailTexBase.wrapS = THREE.RepeatWrapping; dzDetailTexBase.wrapT = THREE.RepeatWrapping;
    if(THREE.SRGBColorSpace) dzDetailTexBase.colorSpace = THREE.SRGBColorSpace;
  }
  // Every material needs its own repeat tiling, so hand out a clone (shares
  // the same underlying canvas image -- cheap, no extra GPU upload cost for
  // the pixel data) rather than mutating the one shared instance, which
  // would silently re-tile every other mesh already using it.
  const tex = dzDetailTexBase.clone();
  tex.needsUpdate = true;
  tex.repeat.set(repeatX || 1, repeatY || 1);
  return tex;
}

function dzMakeMat(color, opacity, extra){
  const m = new THREE.MeshPhysicalMaterial(Object.assign({
    color, transparent: true, opacity,
    roughness: 0.5, metalness: 0.04,
    clearcoat: 0.28, clearcoatRoughness: 0.38,
    emissive: 0x000000, emissiveIntensity: 0
  }, extra || {}));
  m.userData.baseOpacity = opacity; // the tier's *designed* translucency (e.g. a
                                     // nuclear envelope meant to stay see-through) --
                                     // fading during tier blend must scale this, not
                                     // replace it, or every mesh ends up opaque
  m.userData.baseEmissiveHex = m.emissive.getHex();
  m.userData.baseEmissiveIntensity = m.emissiveIntensity;
  return m;
}

/* Organic (non-perfectly-geometric) surface: displaces an icosahedron's
   vertices along their own normals using layered sine waves as cheap,
   deterministic pseudo-noise (no noise library needed). Real cells,
   nuclei, and organelles are never perfect spheres -- this is what breaks
   the "clearly a primitive shape" look the flat icosahedrons had. */
function dzOrganicGeometry(radius, detail, noiseAmt, seed){
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for(let i = 0; i < pos.count; i++){
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const noise = Math.sin(n.x * 5.3 + seed) * Math.sin(n.y * 4.7 + seed * 1.3) * Math.sin(n.z * 6.1 + seed * 0.7)
                + Math.sin(n.x * 11 + seed * 2) * 0.3;
    v.multiplyScalar(1 + noise * noiseAmt);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/* Thin translucent "glow shell" just outside a mesh's surface, unlit and
   additive-ish via BackSide + low opacity -- the same subsurface-scattering
   trick the Anatomy tab's worm uses to look like living tissue rather than
   flat plastic. Cheap: MeshBasicMaterial skips all lighting math entirely. */
function dzAddGlowShell(group, geometry, colorHex, opacity, scale){
  const mat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity, side: THREE.BackSide, depthWrite: false });
  mat.userData.baseOpacity = opacity; // so tier-blend fading (which reads this) scales it correctly
  const glow = new THREE.Mesh(geometry, mat);
  glow.scale.setScalar(scale || 1.05);
  group.add(glow);
  return glow;
}

/* Click-to-glow highlighting, same idea as the 3D Anatomy tab's
   highlight3dStructure(): boost the selected structure's emissive, and
   restore every mesh's own authored baseline (not just 0) on deselect. */
let dzHighlightedMeshes = [];
function dzClearHighlight(){
  dzHighlightedMeshes.forEach(mesh => {
    const m = mesh && mesh.material;
    if(!m || !m.emissive) return;
    m.emissive.setHex(m.userData.baseEmissiveHex || 0);
    m.emissiveIntensity = m.userData.baseEmissiveIntensity || 0;
  });
  dzHighlightedMeshes = [];
}
function dzApplyHighlight(target){
  dzClearHighlight();
  const meshes = Array.isArray(target) ? target : [target];
  meshes.forEach(mesh => {
    if(!mesh || !mesh.material || !mesh.material.emissive) return;
    mesh.material.emissive.setHex(0xffe14d);
    mesh.material.emissiveIntensity = 1.4;
    dzHighlightedMeshes.push(mesh);
  });
  dzRequestRender();
}

/* ---- Tier 0: Organism (simplified silhouette, cheaper than the Anatomy tab's) ---- */
/* Collects every mesh in a subtree whose .name matches (buildWormModel /
   buildPlantModel name several meshes identically, e.g. all 8 leaves are
   named 'leaf' -- for click-to-glow we want ALL of them, not just the first
   .getObjectByName() match). */
function dzCollectMeshesByName(root, name){
  const out = [];
  root.traverse(obj => { if(obj.isMesh && obj.name === name) out.push(obj); });
  return out;
}

/* buildWormModel()/buildPlantModel() build materials directly (not through
   dzMakeMat), so they don't carry the userData.baseOpacity/baseEmissive
   bookkeeping the tier-blend fade and click-glow systems both depend on.
   Capture each material's AS-BUILT opacity/emissive as its baseline here,
   once, right after construction -- same fix as the earlier opacity bug,
   just applied to meshes built outside this file. */
function dzNormalizeReusedMaterials(root){
  root.traverse(obj => {
    if(!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach(m => {
      if(m.userData.baseOpacity === undefined) m.userData.baseOpacity = m.opacity;
      if(m.emissive && m.userData.baseEmissiveHex === undefined) m.userData.baseEmissiveHex = m.emissive.getHex();
      if(m.userData.baseEmissiveIntensity === undefined) m.userData.baseEmissiveIntensity = m.emissiveIntensity || 0;
      m.transparent = true; // so the fade multiply in dzSetGroupOpacity actually renders
    });
  });
}

/* ---- Tier 0: Organism — reuses the ACTUAL 3D Anatomy tab models
   (buildWormModel/buildPlantModel), not a simplified stand-in, so this tier
   is exactly as detailed as the Anatomy tab: real cuticle/bump textures,
   physical-material clearcoat+transmission, subsurface glow shell, and
   every real anatomical structure (nerve ring, intestine, gonad arms, etc,
   not just the 2 landmarks the old simplified version had). Reflects the
   Anatomy tab's live mutant-toggle state too, since it reads the same
   shared `mutantViewActive` flag. ---- */
function dzBuildOrganismTier(isPlant, color){
  const grp = new THREE.Group();
  const positions = isPlant ? buildPlantModel(grp) : buildWormModel(grp);
  dzNormalizeReusedMaterials(grp);

  const hotspots = (currentOrg.hotspots3d || []).map(hs => {
    const pos = positions && positions[hs.id] ? positions[hs.id] : { x: hs.pos[0], y: hs.pos[1], z: hs.pos[2] };
    const anatomyDesc = currentOrg.data && currentOrg.data[hs.id] && currentOrg.data[hs.id].anatomy
      ? currentOrg.data[hs.id].anatomy.desc
      : (hs.sub || hs.name);
    return {
      id: hs.id, label: hs.name, color: hs.color,
      localPos: [pos.x, pos.y, pos.z],
      mesh: dzCollectMeshesByName(grp, hs.id),
      fact: anatomyDesc,
    };
  });

  // The real models are built at the 3D Anatomy tab's own scale (worm ~4
  // units long) rather than this tier's original ~2.6-unit stand-in, so
  // this tier gets its own rest scale instead of the shared default of 1 --
  // otherwise it would grow past the fixed Deep Zoom camera (see
  // DZ_CAMERA_RADIUS) during the tier's own grow/blend animation.
  return { group: grp, hotspots, restScale: 0.6 };
}

/* ---- Tier 1: Tissue — a patch of cells, angular (plant) or rounded (animal) ---- */
function dzBuildTissueTier(isPlant, color){
  const group = new THREE.Group();
  const hotspots = [];
  const n = 4, spacing = 0.42;
  let wallHotspotSet = false, nucleusHotspotSet = false;
  for(let i = 0; i < n; i++){
    for(let j = 0; j < n; j++){
      const x = (i - (n-1)/2) * spacing, y = (j - (n-1)/2) * spacing;
      const z = (Math.sin(i*1.7+j*0.9) * 0.03);
      let cellMesh;
      if(isPlant){
        cellMesh = new THREE.Mesh(new THREE.BoxGeometry(spacing*0.92, spacing*0.92, 0.3), dzMakeMat(dzShade(color, 40), 0.35));
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(cellMesh.geometry), new THREE.LineBasicMaterial({ color: 0xffcf5c, transparent:true, opacity:1 }));
        cellMesh.add(edges);
      } else {
        cellMesh = new THREE.Mesh(dzOrganicGeometry(spacing*0.46, 3, 0.14, i*3.1+j*1.7), dzMakeMat(dzShade(color, 30), 0.42, { roughness: 0.4, clearcoat: 0.4, clearcoatRoughness: 0.25 }));
      }
      cellMesh.position.set(x, y, z);
      group.add(cellMesh);
      const nucleus = new THREE.Mesh(dzOrganicGeometry(spacing*0.16, 2, 0.1, i*2.2+j*4.4), dzMakeMat(0x7f9cff, 0.95, { emissive: 0x2a3a8f, emissiveIntensity: 0.35, roughness: 0.35, clearcoat: 0.4 }));
      nucleus.position.set(x + spacing*0.05, y - spacing*0.04, z + 0.05);
      group.add(nucleus);
      if(i === 1 && j === 2 && !wallHotspotSet){
        wallHotspotSet = true;
        hotspots.push({ id:'wall', label: isPlant ? 'Cell wall' : 'Cell membrane', color:'#ffcf5c',
          localPos:[x + spacing*0.4, y, z+0.1], mesh: cellMesh,
          fact: isPlant
            ? "Plant cells build their own rigid armor out of cellulose — the same molecule that makes cotton, paper, and celery crunchy. It's also why a tree doesn't need a skeleton to stand 300 feet tall."
            : "Unlike a plant cell, this one has no rigid wall — just a flexible membrane. That's exactly why animal cells (and this worm's) can squish, change shape, and even crawl." });
      }
      if(i === 2 && j === 1 && !nucleusHotspotSet){
        nucleusHotspotSet = true;
        hotspots.push({ id:'nucleus', label:'Nucleus', color:'#7f9cff', localPos:[x + spacing*0.05, y - spacing*0.04, z+0.15], mesh: nucleus,
          fact:"Every cell you can see here is carrying a full copy of the genome — the complete instruction manual for building the whole organism, packed into something a few thousandths of a millimeter wide." });
      }
    }
  }
  return { group, hotspots };
}

/* ---- Tier 2: single Cell ---- */
function dzBuildCellTier(isPlant, color){
  const group = new THREE.Group();
  let membrane;
  const chloroplasts = [];
  if(isPlant){
    membrane = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 0.55), dzMakeMat(dzShade(color, 40), 0.28));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(membrane.geometry), new THREE.LineBasicMaterial({ color: 0xffcf5c, transparent:true, opacity:1 }));
    membrane.add(edges);
    for(let i = 0; i < 5; i++){
      const chloro = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), dzMakeMat(0x2f7a3a, 0.95, { emissive: 0x1a4a20, emissiveIntensity: 0.35, roughness: 0.4, clearcoat: 0.4 }));
      chloro.scale.set(1.3, 0.8, 0.8);
      chloro.position.set((Math.random()-0.5)*1.1, (Math.random()-0.5)*1.1, 0.15);
      group.add(chloro);
      chloroplasts.push(chloro);
    }
  } else {
    membrane = new THREE.Mesh(dzOrganicGeometry(0.78, 4, 0.1, 1.2), dzMakeMat(dzShade(color, 30), 0.32, { roughness: 0.35, clearcoat: 0.45, clearcoatRoughness: 0.2 }));
  }
  group.add(membrane);
  dzAddGlowShell(group, membrane.geometry, dzShade(color, 60), 0.045, 1.04);
  const nucleus = new THREE.Mesh(dzOrganicGeometry(0.34, 3, 0.09, 4.4), dzMakeMat(0x7f5f8a, 0.9, { emissive: 0x3a2a5f, emissiveIntensity: 0.3, roughness: 0.4, clearcoat: 0.4 }));
  nucleus.position.set(0.05, -0.02, 0.1);
  group.add(nucleus);
  const nucleolus = new THREE.Mesh(dzOrganicGeometry(0.1, 2, 0.15, 7.7), dzMakeMat(0xffd23c, 1, { emissive: 0xaa7a00, emissiveIntensity: 0.4, roughness: 0.35, clearcoat: 0.5 }));
  nucleolus.position.set(0.13, 0.03, 0.28);
  group.add(nucleolus);
  const mitochondria = [];
  for(let i = 0; i < 4; i++){
    const mito = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.16, 4, 6), dzMakeMat(0xe8a830, 0.95, { roughness: 0.4, clearcoat: 0.4 }));
    const a = (i/4) * Math.PI * 2;
    mito.position.set(Math.cos(a)*0.45, Math.sin(a)*0.4, -0.1);
    mito.rotation.z = a;
    group.add(mito);
    mitochondria.push(mito);
  }
  const hotspots = [
    { id:'nucleus', label:'Nucleus', color:'#7f9cff', localPos:[0.05,-0.02,0.44], mesh: nucleus,
      fact:"If you uncoiled the DNA packed into just this one nucleus, it would stretch about 2 meters — roughly a thousand times longer than the cell itself." },
    { id:'membrane', label: isPlant ? 'Cell wall' : 'Cell membrane', color:'#ffcf5c', localPos:[0.6,0.55,0.2], mesh: membrane,
      fact: isPlant
        ? "Plant cells build their own rigid armor out of cellulose, giving them that characteristic rectangular, tightly-packed look under a microscope."
        : "A cell membrane is only about 2 nanometers thick. Stack 30,000 of them and you'd barely match the width of a human hair — yet it precisely controls everything entering or leaving the cell." },
    { id:'mitochondria', label:'Mitochondria', color:'#e8a830', localPos:[0.45, 0, -0.1], mesh: mitochondria,
      fact:"Mitochondria are the cell's power plants — they convert nutrients into ATP, the energy currency nearly every process in the cell runs on." },
    { id:'nucleolus', label:'Nucleolus', color:'#ffd23c', localPos:[0.13, 0.03, 0.28], mesh: nucleolus,
      fact:"The nucleolus is where ribosomes get built — it's the busiest-looking spot inside the nucleus because a growing cell needs a constant supply of fresh ribosomes to keep making proteins." }
  ];
  if(isPlant && chloroplasts.length){
    const c0 = chloroplasts[0];
    hotspots.push({ id:'chloroplast', label:'Chloroplast', color:'#2f7a3a', localPos:[c0.position.x, c0.position.y, c0.position.z + 0.2], mesh: chloroplasts,
      fact:"Chloroplasts have their own DNA too, just like mitochondria — another leftover from an ancient free-living bacterium that a plant cell's ancestor absorbed and kept around for its photosynthesis." });
  }
  return { group, hotspots };
}

/* ---- Tier 3: Organelles — nucleus, ER, Golgi, mitochondria as real meshes ---- */
function dzBuildOrganelleTier(color){
  const group = new THREE.Group();
  const nucleus = new THREE.Mesh(dzOrganicGeometry(0.5, 3, 0.08, 2.6), dzMakeMat(0x7f5f8a, 0.55, { emissive: 0x2a1a4a, emissiveIntensity: 0.25, roughness: 0.4, clearcoat: 0.4 }));
  nucleus.position.set(-0.35, 0.25, 0);
  group.add(nucleus);
  const envelope = new THREE.Mesh(new THREE.SphereGeometry(0.54, 20, 20), dzMakeMat(0x9d85b8, 0.22, { side: THREE.BackSide }));
  envelope.position.copy(nucleus.position);
  group.add(envelope);

  // ER — a stack of gently wavy sheets built from a lathe-free ribbon (ExtrudeGeometry along a wavy shape)
  const erGroup = new THREE.Group();
  const erSheets = [];
  for(let s = 0; s < 3; s++){
    const shape = new THREE.Shape();
    shape.moveTo(-0.5, 0);
    for(let x = -0.5; x <= 0.5; x += 0.1) shape.lineTo(x, Math.sin(x*6 + s)*0.06);
    shape.lineTo(0.5, 0.12);
    for(let x = 0.5; x >= -0.5; x -= 0.1) shape.lineTo(x, Math.sin(x*6 + s)*0.06 + 0.12);
    shape.closePath();
    const sheet = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled:false }), dzMakeMat(0xffb37a, 0.85, { side: THREE.DoubleSide, emissive: 0x662f00, emissiveIntensity: 0.25, roughness: 0.35, clearcoat: 0.5 }));
    sheet.position.set(0.3, 0.35 - s*0.16, -0.1 + s*0.05);
    erGroup.add(sheet);
    erSheets.push(sheet);
  }
  group.add(erGroup);

  // Golgi — stacked torus arcs
  const golgiGroup = new THREE.Group();
  const golgiArcs = [];
  for(let i = 0; i < 5; i++){
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.16 - i*0.018, 0.016, 8, 20, Math.PI*1.5), dzMakeMat(0x8ee6c0, 1, { emissive: 0x1f6b4d, emissiveIntensity: 0.3, roughness: 0.35, clearcoat: 0.5 }));
    arc.position.set(0.55, -0.35 + i*0.045, 0.15);
    arc.rotation.x = Math.PI/2;
    golgiGroup.add(arc);
    golgiArcs.push(arc);
  }
  group.add(golgiGroup);

  // Mitochondria scattered
  const mitochondria = [];
  for(let i = 0; i < 5; i++){
    const mito = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.22, 6, 10), dzMakeMat(0xe8a830, 1, { emissive: 0x7a4c00, emissiveIntensity: 0.25, roughness: 0.4, clearcoat: 0.4 }));
    const a = (i/5) * Math.PI * 2;
    mito.position.set(Math.cos(a)*0.75 - 0.1, Math.sin(a)*0.65 - 0.15, -0.2 + (i%2)*0.1);
    mito.rotation.z = a * 0.7;
    group.add(mito);
    mitochondria.push(mito);
  }

  const hotspots = [
    { id:'nucleus', label:'Nucleus', color:'#7f9cff', localPos:[-0.35, 0.65, 0.2], mesh: nucleus,
      fact:"The nucleus is often called the cell's control center, but it doesn't send instructions out directly — it ships out RNA copies of genes, like sending photocopies instead of the original blueprint." },
    { id:'er', label:'Endoplasmic reticulum', color:'#ffb37a', localPos:[0.3, 0.35, 0.1], mesh: erSheets,
      fact:"The ER is basically the cell's factory floor — roughly a third of all the proteins your body makes get built and folded here before heading anywhere else." },
    { id:'golgi', label:'Golgi apparatus', color:'#8ee6c0', localPos:[0.55, -0.2, 0.2], mesh: golgiArcs,
      fact:"The Golgi apparatus works like a post office: it takes proteins fresh from the ER, packages them, and addresses each one for delivery to exactly the right destination in (or outside of) the cell." },
    { id:'mitochondria', label:'Mitochondria', color:'#e8a830', localPos:[Math.cos(0)*0.75 - 0.1, Math.sin(0)*0.65 - 0.15, -0.2], mesh: mitochondria,
      fact:"Mitochondria have their own small DNA, separate from the nucleus — a leftover from billions of years ago when they were free-living bacteria that got absorbed into what became complex cells." }
  ];
  return { group, hotspots };
}

/* ---- Tier 4: Nucleus — envelope with pores, nucleolus, chromatin strands ---- */
function dzBuildNucleusTier(){
  const group = new THREE.Group();
  const envelope = new THREE.Mesh(new THREE.SphereGeometry(0.85, 24, 24), dzMakeMat(0x7f9cff, 0.24, { side: THREE.DoubleSide, roughness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.15 }));
  group.add(envelope);
  const innerMembrane = new THREE.Mesh(new THREE.SphereGeometry(0.78, 24, 24), dzMakeMat(0x6a86e0, 0.16, { side: THREE.DoubleSide, roughness: 0.3, clearcoat: 0.5 }));
  group.add(innerMembrane);
  dzAddGlowShell(group, envelope.geometry, 0xaabfff, 0.05, 1.03);
  // Pores: small torus ring around the envelope
  for(let i = 0; i < 18; i++){
    const a = (i/18) * Math.PI * 2;
    const pore = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.014, 8, 10), dzMakeMat(0x1a2030, 1));
    pore.position.set(Math.cos(a)*0.85, Math.sin(a*2.3)*0.35, Math.sin(a)*0.85*0.5);
    pore.lookAt(0,0,0);
    group.add(pore);
  }
  const nucleolus = new THREE.Mesh(dzOrganicGeometry(0.32, 3, 0.16, 5.5), dzMakeMat(0xffd23c, 1, { emissive: 0xaa7a00, emissiveIntensity: 0.4, roughness: 0.35, clearcoat: 0.5 }));
  nucleolus.position.set(0.2, -0.1, 0.15);
  group.add(nucleolus);
  // Chromatin: a few thin wandering tubes
  const chromatinStrands = [];
  let chromatinHotspotPos = null;
  for(let c = 0; c < 6; c++){
    const pts = [];
    let p = new THREE.Vector3((Math.random()-0.5)*1.2, (Math.random()-0.5)*1.2, (Math.random()-0.5)*0.6);
    for(let i = 0; i < 6; i++){
      pts.push(p.clone());
      p = p.clone().add(new THREE.Vector3((Math.random()-0.5)*0.4, (Math.random()-0.5)*0.4, (Math.random()-0.5)*0.2));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const strand = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.03, 8, false), dzMakeMat(0xc0a8f0, 1, { emissive: 0x4a2f7a, emissiveIntensity: 0.3, roughness: 0.3, clearcoat: 0.5 }));
    group.add(strand);
    chromatinStrands.push(strand);
    if(c === 0) chromatinHotspotPos = curve.getPoint(0.5); // tube meshes keep .position at origin -- their shape comes from the curve, so grab a real point on it instead
  }
  const hotspots = [
    { id:'envelope', label:'Nuclear envelope', color:'#7f9cff', localPos:[0.85, 0, 0], mesh:[envelope, innerMembrane],
      fact:"The nuclear envelope is dotted with thousands of tiny pores — wide enough to let RNA and small proteins pass through, but tight enough to keep the DNA safely locked inside." },
    { id:'nucleolus', label:'Nucleolus', color:'#ffd23c', localPos:[0.2, -0.1, 0.47], mesh: nucleolus,
      fact:"The nucleolus isn't wrapped in its own membrane at all — it's just a dense clump of proteins and RNA that forms wherever the cell is busy manufacturing ribosomes." },
    { id:'chromatin', label:'Chromatin', color:'#c0a8f0', localPos:[chromatinHotspotPos.x, chromatinHotspotPos.y, chromatinHotspotPos.z], mesh: chromatinStrands,
      fact:"Chromatin is DNA in its everyday, loosely-spooled working form. It only coils up tight into the classic X-shaped chromosome you'd recognize right before a cell divides." }
  ];
  return { group, hotspots };
}

/* ---- Tier 5: a single Chromosome — X-shaped, 4 chromatid arms + centromere ---- */
function dzBuildChromosomeTier(){
  const group = new THREE.Group();
  const armLen = 0.75, thick = 0.15, segCount = 7;
  const dirs = [[-0.55,0.83],[-0.83,-0.55],[0.55,-0.83],[0.83,0.55]];
  const bandColors = [0xe8b8e6, 0x7a3f7e]; // true 2-tone alternating banding (real G-banding is light/dark, not multi-hued)
  let firstArmSegments = [];
  dirs.forEach(([dx,dy], armIdx) => {
    for(let s = 0; s < segCount; s++){
      const t0 = s / segCount, t1 = (s + 1) / segCount;
      const p0 = new THREE.Vector3(dx*armLen*t0, dy*armLen*t0, 0);
      const p1 = new THREE.Vector3(dx*armLen*t1, dy*armLen*t1, 0);
      const segRadius = thick * 0.5 * (1 - t0*0.25); // very slight taper toward the tip
      const seg = new THREE.Mesh(
        new THREE.CylinderGeometry(segRadius, segRadius*0.97, p0.distanceTo(p1)*1.04, 12),
        dzMakeMat(bandColors[s % bandColors.length], 1, { roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.2 })
      );
      seg.position.copy(p0).lerp(p1, 0.5);
      seg.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), p1.clone().sub(p0).normalize());
      group.add(seg);
      if(armIdx === 0) firstArmSegments.push(seg);
    }
    // Rounded tip cap
    const tip = new THREE.Mesh(new THREE.SphereGeometry(thick*0.38, 10, 10), dzMakeMat(bandColors[bandColors.length-1], 1, { roughness: 0.35, clearcoat: 0.5 }));
    tip.position.set(dx*armLen, dy*armLen, 0);
    group.add(tip);
  });
  const centromere = new THREE.Mesh(new THREE.SphereGeometry(thick*0.62, 16, 16), dzMakeMat(0xff9dbc, 1, { emissive: 0x8a2f5f, emissiveIntensity: 0.35, roughness: 0.3, clearcoat: 0.55 }));
  group.add(centromere);
  const hotspots = [
    { id:'centromere', label:'Centromere', color:'#ff9dbc', localPos:[0,0,thick*0.6], mesh: centromere,
      fact:"Right before a cell divides, each chromosome's two identical copies stay zipped together at the centromere — then get yanked apart to opposite ends of the cell in a matter of minutes." },
    { id:'band', label:'Chromosome band', color:'#8a4f86', localPos:[dirs[0][0]*armLen*0.6, dirs[0][1]*armLen*0.6, 0], mesh: firstArmSegments,
      fact:"The banded pattern on a chromosome isn't decorative — it reflects real differences in how tightly the DNA is packed, and scientists use these exact bands to identify which chromosome is which under a microscope." }
  ];
  return { group, hotspots };
}

/* ---- Tier 6: DNA — an actual 3D double helix ---- */
function dzBuildDnaTier(){
  const group = new THREE.Group();
  const h = 2.2, turns = 4, amplitude = 0.32;
  const baseColors = { A:0x3ddc73, T:0xff5c5c, G:0x4d9eff, C:0xffd23c };
  const pairs = [['A','T'],['T','A'],['G','C'],['C','G']];
  const strands = [];
  [0, Math.PI].forEach(phase => {
    const pts = [];
    for(let i = 0; i <= 60; i++){
      const y = -h/2 + (i/60)*h;
      const ang = (i/60) * Math.PI * 2 * turns + phase;
      pts.push(new THREE.Vector3(Math.cos(ang)*amplitude, y, Math.sin(ang)*amplitude));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const strand = new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.04, 10, false), dzMakeMat(0x8aa0f0, 1, { emissive: 0x2a3a7a, emissiveIntensity: 0.2, roughness: 0.3, clearcoat: 0.55, clearcoatRoughness: 0.15 }));
    group.add(strand);
    strands.push(strand);
  });
  const rungCount = 22;
  const emissiveMap = { A:0x1a6a3a, T:0x8a2a2a, G:0x1a4a8a, C:0x8a6a00 };
  let firstRungMeshes = [];
  for(let i = 0; i < rungCount; i++){
    const y = -h/2 + (i/rungCount)*h;
    const ang = (i/rungCount) * Math.PI * 2 * turns;
    const x1 = Math.cos(ang)*amplitude, z1 = Math.sin(ang)*amplitude;
    const x2 = Math.cos(ang+Math.PI)*amplitude, z2 = Math.sin(ang+Math.PI)*amplitude;
    const [b1, b2] = pairs[i % pairs.length];
    const mid = new THREE.Vector3((x1+x2)/2, y, (z1+z2)/2);
    [[new THREE.Vector3(x1,y,z1), mid, b1], [mid, new THREE.Vector3(x2,y,z2), b2]].forEach(([p1,p2,base]) => {
      const len = p1.distanceTo(p2);
      const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, len, 8), dzMakeMat(baseColors[base], 1, { emissive: emissiveMap[base], emissiveIntensity: 0.4, roughness: 0.3, clearcoat: 0.55 }));
      rung.position.copy(p1).lerp(p2, 0.5);
      rung.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), p2.clone().sub(p1).normalize());
      group.add(rung);
      if(i === 0) firstRungMeshes.push(rung);
    });
  }
  const hotspots = [
    { id:'basepair', label:'Base pair', color:'#3ddc73', localPos:[0, 0.1, amplitude], mesh: firstRungMeshes,
      fact:"There are only 4 letters in the DNA alphabet — A, T, G, and C — yet their ordering across ~3 billion positions in the human genome is enough to spell out an entire person." },
    { id:'backbone', label:'Sugar-phosphate backbone', color:'#4d9eff', localPos:[amplitude, 0.6, 0], mesh: strands[0],
      fact:"The twisting 'rails' of the double helix are made of alternating sugar and phosphate molecules. The helix completes one full twist roughly every 10 base pairs." }
  ];
  return { group, hotspots };
}

const DZ_BUILDERS = {
  organism:   (isPlant, color) => dzBuildOrganismTier(isPlant, color),
  tissue:     (isPlant, color) => dzBuildTissueTier(isPlant, color),
  cell:       (isPlant, color) => dzBuildCellTier(isPlant, color),
  organelle:  (isPlant, color) => dzBuildOrganelleTier(color),
  nucleus:    (isPlant, color) => dzBuildNucleusTier(),
  chromosome: (isPlant, color) => dzBuildChromosomeTier(),
  dna:        (isPlant, color) => dzBuildDnaTier(),
};

function dzGetOrBuildTier(tierId){
  const org = currentOrg;
  if(!org) return null;
  const isPlant = org.model && org.model.type === 'plant';
  const key = `${org.id}:${isPlant}:${tierId}`;
  if(dzTierCache[key]) return dzTierCache[key];
  const built = DZ_BUILDERS[tierId](isPlant, org.color || '#888888');
  built.group.visible = false;
  dzScene.add(built.group);
  dzTierCache[key] = built;
  if(dzWireMode) dzSetGroupWireframe(built.group, true);
  return built;
}

/* ---- Transparent/wireframe toggle, same idea as the 3D Anatomy tab's
   toggleWire() -- lets you see internal structures at any tier. Applies
   to every cached tier (not just the currently visible one) so the mode
   persists as you continue zooming through the model. ---- */
let dzWireMode = false;
function dzSetGroupWireframe(group, on){
  group.traverse(obj => {
    if(!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach(m => { if('wireframe' in m) m.wireframe = on; });
  });
}
function dzToggleWire(){
  dzWireMode = !dzWireMode;
  const btn = document.getElementById('dz-wire-btn');
  if(btn) btn.classList.toggle('active', dzWireMode);
  Object.values(dzTierCache).forEach(entry => dzSetGroupWireframe(entry.group, dzWireMode));
  dzRequestRender();
}

/* ============================================================
   ORG SWITCH / VIEW ENTER-LEAVE
   ============================================================ */
function dzOnOrgChanged(){
  dzClearCache();
  dzHotspotAnchors = [];
  dzHighlightedMeshes = []; // old meshes are about to be disposed -- drop refs, don't try to restore them
  if(dzDom.hotspotLayer) dzDom.hotspotLayer.innerHTML = '';
  dzActiveHsKey = null;
  dzPartsListTierId = null; // force rebuild -- same tier id, but a different organism's hotspots
  if(dzDom.partsList) dzDom.partsList.innerHTML = '';
  if(currentView === 'deepzoom') dzBuildHotspotDom();
}

function dzOnEnterView(){
  if(!dzReady) initDeepZoom();
  if(!dzReady){
    if(dzDom.loadBadge){
      dzDom.loadBadge.style.display = 'block';
      dzDom.loadBadge.textContent = typeof THREE === 'undefined'
        ? '3D engine not loaded — Deep Zoom needs the same Three.js library as the Anatomy tab.'
        : 'Initializing deep zoom…';
    }
    return;
  }
  if(dzDom.loadBadge) dzDom.loadBadge.style.display = 'none';
  if(dzDom.hotspotLayer && !dzDom.hotspotLayer.childElementCount) dzBuildHotspotDom();
  dzResize();
  dzRequestRender();
}
function dzOnLeaveView(){
  if(dzAnimId){ cancelAnimationFrame(dzAnimId); dzAnimId = null; }
}

/* ============================================================
   HOTSPOT DOM (built once per org; shown/hidden per active tier)
   ============================================================ */
function dzBuildHotspotDom(){
  const layer = dzDom.hotspotLayer;
  if(!layer) return;
  layer.innerHTML = '';
  dzHotspotAnchors = [];
  DZ_TIERS.forEach(tier => {
    const entry = dzGetOrBuildTier(tier.id);
    if(!entry) return;
    entry.hotspots.forEach(hs => {
      const el = document.createElement('div');
      el.className = 'hs-dot';
      el.textContent = hs.label[0];
      el.style.borderColor = hs.color;
      el.style.color = hs.color;
      el.style.background = hs.color + '22';
      el.style.display = 'none';
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', hs.label);
      const handler = () => dzSelectHotspot(tier.id, hs.id);
      el.addEventListener('click', handler);
      el.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' ') handler(); });
      layer.appendChild(el);
      dzHotspotAnchors.push({ tierId: tier.id, hs, group: entry.group, el });
    });
  });
}

function dzSelectHotspot(tierId, hsId){
  dzActiveHsKey = tierId + ':' + hsId;
  dzHotspotAnchors.forEach(a => a.el.classList.toggle('active', (a.tierId+':'+a.hs.id) === dzActiveHsKey));
  if(dzDom.partsList) Array.from(dzDom.partsList.children).forEach(row => row.classList.toggle('active', row.dataset.hsKey === dzActiveHsKey));
  const entry = dzGetOrBuildTier(tierId);
  const hs = entry.hotspots.find(h => h.id === hsId);
  if(!hs) return;
  dzDom.sidTitle.textContent = hs.label;
  dzDom.sidSub.textContent = DZ_TIERS.find(t => t.id === tierId).label + ' tier';
  dzDom.sidBody.innerHTML = `<div class="fact"><div class="fact-lbl">Did you know</div><div class="fact-val">${hs.fact}</div></div>`;
  if(hs.mesh) dzApplyHighlight(hs.mesh);
}

/* Sidebar list of every part in the CURRENT tier -- a calmer, uncluttered
   complement to the on-model hotspot dots (which stay too, per request).
   Same click target (dzSelectHotspot) as the dots, so both paths glow the
   same mesh and show the same fact; this just means every part is named
   somewhere on screen even when only 2-3 dots are shown at once. */
let dzPartsListTierId = null;
function dzUpdatePartsList(tierId){
  if(!dzDom.partsList || tierId === dzPartsListTierId) return;
  dzPartsListTierId = tierId;
  const entry = dzGetOrBuildTier(tierId);
  dzDom.partsList.innerHTML = '';
  if(!entry) return;
  entry.hotspots.forEach(hs => {
    const row = document.createElement('div');
    row.className = 'dz-part-row';
    row.dataset.hsKey = tierId + ':' + hs.id;
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    const dot = document.createElement('div');
    dot.className = 'dz-part-dot';
    dot.style.background = hs.color;
    dot.style.color = hs.color;
    const label = document.createElement('span');
    label.textContent = hs.label;
    row.appendChild(dot);
    row.appendChild(label);
    row.classList.toggle('active', row.dataset.hsKey === dzActiveHsKey);
    const handler = () => dzSelectHotspot(tierId, hs.id);
    row.addEventListener('click', handler);
    row.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' ') handler(); });
    dzDom.partsList.appendChild(row);
  });
}

/* ============================================================
   PER-FRAME TIER BLEND STATE
   ============================================================ */
function dzGetTierState(zoom){
  zoom = Math.max(DZ_ZOOM_MIN, Math.min(DZ_ZOOM_MAX, zoom));
  let idx = DZ_TIERS.findIndex(t => zoom < t.max);
  if(idx === -1) idx = DZ_TIERS.length - 1;
  const tier = DZ_TIERS[idx];
  const span = tier.max - tier.min;
  const t = Math.max(0, Math.min(1, (zoom - tier.min) / span));
  const hasNext = idx < DZ_TIERS.length - 1;
  let blend = 0;
  if(hasNext && t > (1 - DZ_BLEND)) blend = (t - (1 - DZ_BLEND)) / DZ_BLEND;
  return { idx, tier, t, blend, next: hasNext ? DZ_TIERS[idx + 1] : null };
}

let dzLastPrimaryTierId = null;
function dzApplyTierVisibility(state){
  // Hide the previously-active tiers that are no longer relevant (cheap: only
  // ever 1-2 groups are visible, so there's nothing expensive to sweep here).
  DZ_TIERS.forEach(t => {
    if(t.id !== state.tier.id && !(state.next && t.id === state.next.id)){
      const key = `${currentOrg.id}:${currentOrg.model.type==='plant'}:${t.id}`;
      if(dzTierCache[key]) dzTierCache[key].group.visible = false;
    }
  });

  const curEntry = dzGetOrBuildTier(state.tier.id);
  curEntry.group.visible = true;
  const curRest = curEntry.restScale || 1;
  const curScale = curRest * (1 + state.t * (DZ_GROWTH - 1));
  curEntry.group.scale.setScalar(curScale);
  const curOpacity = state.blend > 0 ? (1 - state.blend) : 1;
  dzSetGroupOpacity(curEntry.group, curOpacity);

  if(state.next){
    const nextEntry = dzGetOrBuildTier(state.next.id);
    if(state.blend > 0){
      nextEntry.group.visible = true;
      const nextRest = nextEntry.restScale || 1;
      const nextScale = nextRest * (0.18 + state.blend * 0.82);
      nextEntry.group.scale.setScalar(nextScale);
      dzSetGroupOpacity(nextEntry.group, state.blend);
    } else {
      nextEntry.group.visible = false;
    }
  }

  // Badge + tier strip
  if(dzDom.badge) dzDom.badge.textContent = `${state.tier.icon} ${state.tier.label} · ${dzZoom.toFixed(1)}×`;
  if(dzDom.strip){
    Array.from(dzDom.strip.children).forEach(chip => {
      chip.classList.toggle('active', chip.dataset.tier === state.tier.id);
    });
  }
  dzUpdatePartsList(state.tier.id);

  // Hotspots: only show the dominant tier's hotspots, and only when settled
  // (not mid-blend) to avoid dots jittering through the crossfade.
  const showTierId = state.blend < 0.06 ? state.tier.id : null;
  if(showTierId !== dzLastPrimaryTierId){
    dzLastPrimaryTierId = showTierId;
    if(!showTierId){
      dzHotspotAnchors.forEach(a => a.el.style.display = 'none');
    }
  }
}

function dzSetGroupOpacity(group, fade){
  group.traverse(obj => {
    if((obj.isMesh || obj.isLineSegments) && obj.material){
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => {
        if(m.opacity === undefined) return;
        const base = m.userData && m.userData.baseOpacity !== undefined ? m.userData.baseOpacity : 1;
        m.transparent = true;
        m.opacity = base * fade;
      });
    }
  });
}

function dzUpdateHotspotScreenPositions(){
  if(!dzHotspotAnchors.length || dzLastPrimaryTierId === null) return;
  if(!dzCachedRect) dzCachedRect = dzDom.wrap.getBoundingClientRect();
  const rect = dzCachedRect;
  const tmp = new THREE.Vector3();
  dzHotspotAnchors.forEach(a => {
    const visible = a.tierId === dzLastPrimaryTierId;
    if(!visible){ a.el.style.display = 'none'; return; }
    tmp.set(a.hs.localPos[0], a.hs.localPos[1], a.hs.localPos[2]);
    a.group.localToWorld(tmp);
    tmp.project(dzCamera);
    // Same fix as the 3D Anatomy tab: hide if behind the camera OR
    // projected outside the visible frame, not just behind-camera.
    if(tmp.z > 1 || tmp.z < -1 || Math.abs(tmp.x) > 1.08 || Math.abs(tmp.y) > 1.08){
      a.el.style.display = 'none';
      return;
    }
    const x = (tmp.x * 0.5 + 0.5) * rect.width;
    const y = (-tmp.y * 0.5 + 0.5) * rect.height;
    a.el.style.left = x + 'px';
    a.el.style.top = y + 'px';
    a.el.style.display = 'flex';
  });
}

/* ============================================================
   ZOOM CONTROL
   ============================================================ */
function dzSetZoom(v){
  dzZoom = Math.max(DZ_ZOOM_MIN, Math.min(DZ_ZOOM_MAX, v));
  dzRequestRender();
}
function dzZoomStep(delta){ dzSetZoom(dzZoom + delta); }
function dzResetView(){
  dzZoom = DZ_ZOOM_MIN;
  dzOrbit = { theta: 0.5, phi: 1.2 };
  dzRequestRender();
}

/* ============================================================
   RENDER LOOP (demand-based, ~30fps cap, matches main 3D view)
   ============================================================ */
function dzAnimate(now){
  if(currentView !== 'deepzoom'){ dzAnimId = null; return; }
  if(!currentOrg){ dzAnimId = requestAnimationFrame(dzAnimate); return; }

  const elapsed = now - dzLastRenderTime;
  if((dzRenderNeeded || dzDragging) && elapsed >= DZ_RENDER_INTERVAL){
    wireControlsUpdateCam();
    const state = dzGetTierState(dzZoom);
    dzApplyTierVisibility(state);
    dzUpdateHotspotScreenPositions();
    dzRenderer.render(dzScene, dzCamera);
    dzRenderNeeded = false;
    dzLastRenderTime = now;
  }
  dzAnimId = requestAnimationFrame(dzAnimate);
}
function wireControlsUpdateCam(){
  if(dzWireControls._updateCam) dzWireControls._updateCam();
}
