/* ============================================================
   ORGANISM DATA LOADER - v13+ RESTORED (Working Version)
   ============================================================ */

const OrganismStore = {
  organisms: {},
  order: [],
  async loadAll(){
    try{
      const manifestRes = await fetch('data/manifest.json');
      const manifest = await manifestRes.json();
      for(const entry of manifest.organisms){
        try{
          const res = await fetch(entry.file);
          const org = await res.json();
          this.organisms[org.id] = org;
          this.order.push(org.id);
        }catch(err){
          console.error('Failed to load organism file:', entry.file, err);
        }
      }
    }catch(err){
      console.error('Failed to load manifest.json', err);
      this.loadFallback();
    }
    return this.organisms;
  },
  loadFallback(){
    const banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#7a2d1c;color:#fff;font-size:13px;padding:10px 20px;z-index:999;text-align:center;font-family:sans-serif';
    banner.innerHTML = '⚠ Could not load organism JSON. Please serve via http.server (python3 -m http.server)';
    document.body.prepend(banner);
  },
  addCustom(id, organism){ this.organisms[id] = organism; this.order.push(id); },
  get(id){ return this.organisms[id]; },
  list(){ return this.order.map(id => this.organisms[id]); }
};

/* ============================================================
   MULTI-SCALE ZOOM TIER SYSTEM
   The imagery viewer starts at the whole-organism view (the
   existing detailed procedural art, unchanged) and, as the user
   zooms in, progressively swaps in freshly-drawn, more-detailed
   content: tissue -> individual cells -> organelles -> nucleus ->
   a single chromosome -> the DNA double helix.

   Each tier owns a zoom range [min, max). Within the "organism"
   tier, canvas scale tracks imgZoomLevel directly (so hotspot
   positions -- which are only meaningful for the whole-organism
   view -- stay exactly aligned, per the dpr/coordinate-space fix).
   Beyond that, hotspots fade out and each tier's art is drawn
   fresh, scaled locally within its own range (so it always enters
   at a natural 1x size and grows within its band, rather than
   inheriting the outer tier's huge accumulated zoom number).
   ============================================================ */
const ZOOM_TIERS = [
  { id: 'organism',   min: 0.5, max: 3.2,  label: 'Organism' },
  { id: 'tissue',     min: 3.2, max: 6,    label: 'Tissue' },
  { id: 'cell',       min: 6,   max: 10,   label: 'Cell' },
  { id: 'organelle',  min: 10,  max: 16,   label: 'Organelle' },
  { id: 'nucleus',    min: 16,  max: 24,   label: 'Nucleus' },
  { id: 'chromosome', min: 24,  max: 34,   label: 'Chromosome' },
  { id: 'dna',        min: 34,  max: 9999, label: 'DNA' },
];
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 50;

function getZoomTier(zoom){
  for(const t of ZOOM_TIERS){ if(zoom < t.max) return t; }
  return ZOOM_TIERS[ZOOM_TIERS.length - 1];
}

// Hotspots for every zoom tier beyond "organism". Positions are chosen to match
// the deterministic (non-randomized) structure coordinates in each tier's drawing
// function above -- e.g. the organelle tier's nucleus is always at (0.28w, 0.32h),
// never randomized, so a hotspot there reliably lands on the actual drawn nucleus.
// Descriptions are deliberately written as "did you know" facts rather than dry
// textbook copy -- this is meant to be fun to click through, not a study guide.
const TIER_HOTSPOTS = {
  tissue: {
    plant: [
      { x: 0.25, y: 0.1667, label: 'Cell wall', color: '#ffcf5c', rx: 0.07, ry: 0.07,
        fact: "Plant cells build their own rigid armor out of cellulose — the same molecule that makes cotton, paper, and celery crunchy. It's also why a tree doesn't need a skeleton to stand 300 feet tall." },
      { x: 0.5833, y: 0.5, label: 'Nucleus', color: '#7f9cff', rx: 0.027, ry: 0.018,
        fact: "Every cell you can see here is carrying a full copy of the genome — the complete instruction manual for building the whole organism, packed into something a few thousandths of a millimeter wide." }
    ],
    animal: [
      { x: 0.2143, y: 0.25, label: 'Cell membrane', color: '#ffcf5c', rx: 0.07, ry: 0.07,
        fact: "Unlike a plant cell, this one has no rigid wall — just a flexible membrane. That's exactly why animal cells (and this worm's) can squish, change shape, and even crawl." },
      { x: 0.5, y: 0.5833, label: 'Nucleus', color: '#7f9cff', rx: 0.023, ry: 0.027,
        fact: "Every cell you can see here is carrying a full copy of the genome — the complete instruction manual for building the whole organism, packed into something a few thousandths of a millimeter wide." }
    ]
  },
  cell: {
    animal: [
      { x: 0.22, y: 0.28, label: 'Nucleus', color: '#7f9cff', rx: 0.08, ry: 0.08,
        fact: "If you uncoiled the DNA packed into just this one nucleus, it would stretch about 2 meters — roughly a thousand times longer than the cell itself." },
      { x: 0.22, y: 0.28, label: 'Cell membrane', color: '#ffcf5c', rx: 0.24, ry: 0.20,
        fact: "A cell membrane is only about 2 nanometers thick. Stack 30,000 of them and you'd barely match the width of a human hair — yet it precisely controls everything entering or leaving the cell." }
    ],
    plant: [
      { x: 0.28, y: 0.34, label: 'Nucleus', color: '#7f9cff', rx: 0.07, ry: 0.07,
        fact: "If you uncoiled the DNA packed into just this one nucleus, it would stretch about 2 meters — roughly a thousand times longer than the cell itself." },
      { x: 0.22, y: 0.28, label: 'Cell wall', color: '#ffcf5c', rx: 0.22, ry: 0.19,
        fact: "Plant cells build their own rigid armor out of cellulose, giving them that characteristic rectangular, tightly-packed look under a microscope." }
    ]
  },
  organelle: {
    common: [
      { x: 0.28, y: 0.32, label: 'Nucleus', color: '#7f9cff', rx: 0.26, ry: 0.26,
        fact: "The nucleus is often called the cell's control center, but it doesn't send instructions out directly — it ships out RNA copies of genes, like sending photocopies instead of the original blueprint." },
      { x: 0.68, y: 0.68, label: 'Endoplasmic reticulum', color: '#ffb37a', rx: 0.22, ry: 0.15,
        fact: "The ER is basically the cell's factory floor — roughly a third of all the proteins your body makes get built and folded here before heading anywhere else." },
      { x: 0.75, y: 0.28, label: 'Golgi apparatus', color: '#8ee6c0', rx: 0.13, ry: 0.10,
        fact: "The Golgi apparatus works like a post office: it takes proteins fresh from the ER, packages them, and addresses each one for delivery to exactly the right destination in (or outside of) the cell." }
    ]
  },
  nucleus: {
    common: [
      { x: 0.60, y: 0.5, label: 'Nuclear envelope', color: '#7f9cff', rx: 0.12, ry: 0.30,
        fact: "The nuclear envelope is dotted with thousands of tiny pores — wide enough to let RNA and small proteins pass through, but tight enough to keep the DNA safely locked inside." },
      { x: 0.56, y: 0.44, label: 'Nucleolus', color: '#ffd23c', rx: 0.13, ry: 0.11,
        fact: "The nucleolus isn't wrapped in its own membrane at all — it's just a dense clump of proteins and RNA that forms wherever the cell is busy manufacturing ribosomes." }
    ]
  },
  chromosome: {
    common: [
      { x: 0.32, y: 0.5, label: 'Centromere', color: '#ff9dbc', rx: 0.05, ry: 0.035,
        fact: "Right before a cell divides, each chromosome's two identical copies stay zipped together at the centromere — then get yanked apart to opposite ends of the cell in a matter of minutes." },
      { x: 0.68, y: 0.5, label: 'Centromere', color: '#ff9dbc', rx: 0.05, ry: 0.035,
        fact: "The banded pattern on a chromosome isn't decorative — it reflects real differences in how tightly the DNA is packed, and scientists use these exact bands to identify which chromosome is which under a microscope." }
    ]
  },
  dna: {
    common: [
      { x: 0.5, y: 0.5, label: 'Base pair', color: '#3ddc73', rx: 0.09, ry: 0.018,
        fact: "There are only 4 letters in the DNA alphabet — A, T, G, and C — yet their ordering across ~3 billion positions in the human genome is enough to spell out an entire person." },
      { x: 0.66, y: 0.52, label: 'Sugar-phosphate backbone', color: '#4d9eff', rx: 0.025, ry: 0.035,
        fact: "The twisting 'rails' of the double helix are made of alternating sugar and phosphate molecules. The helix completes one full twist roughly every 10 base pairs." }
    ]
  }
};

// Returns the hotspot list for a given tier + organism, or null for tiers with none
// (currently just "organism", which uses the real per-image JSON region data instead).
function getTierHotspots(tierId, isPlant){
  const set = TIER_HOTSPOTS[tierId];
  if(!set) return null;
  const list = [...(set.common || [])];
  if(isPlant && set.plant) list.push(...set.plant);
  if(!isPlant && set.animal) list.push(...set.animal);
  return list;
}

/* ---------- per-modality color palettes ---------- */
const TIER_STYLE = {
  dic: {
    bg1:'#1a1a2e', bg2:'#16213e',
    wallStroke:'rgba(120,100,80,0.9)', cellFill:'rgba(180,160,130,0.18)',
    nucleusFill:'rgba(120,95,70,0.55)', nucleolusFill:'rgba(70,50,35,0.8)',
    chromatinStroke:'rgba(110,90,65,0.55)', nucleusStroke:'rgba(90,70,50,0.9)',
    mitoFill:'rgba(160,140,110,0.35)', mitoStroke:'rgba(110,90,65,0.8)',
    chromFill:'rgba(150,125,95,0.5)', chromStroke:'rgba(90,70,50,0.9)',
    bandStroke:'rgba(70,55,40,0.6)', centromereFill:'rgba(90,70,50,0.9)',
    helixBackbone:'rgba(150,125,95,0.85)', riboFill:'rgba(120,100,80,0.5)',
    chloroplastFill:'#5c7a4a', vacuoleFill:'rgba(60,45,30,0.35)'
  },
  gfp: {
    bg1:'#050912', bg2:'#0a0f1a',
    wallStroke:'rgba(60,120,90,0.4)', cellFill:'rgba(0,0,0,0)',
    nucleusFill:'rgba(30,90,55,0.35)', nucleolusFill:'rgba(90,255,150,0.5)',
    chromatinStroke:'rgba(60,180,110,0.4)', nucleusStroke:'rgba(70,255,140,0.55)',
    mitoFill:'rgba(0,0,0,0)', mitoStroke:'rgba(80,255,150,0.55)',
    chromFill:'rgba(30,90,55,0.3)', chromStroke:'rgba(80,255,150,0.6)',
    bandStroke:'rgba(120,255,180,0.55)', centromereFill:'rgba(120,255,180,0.8)',
    helixBackbone:'rgba(70,220,140,0.6)', riboFill:'rgba(80,220,140,0.4)',
    chloroplastFill:'#1a5c33', vacuoleFill:'rgba(10,40,25,0.4)',
    glow:true
  },
  bodipy: {
    bg1:'#141414', bg2:'#0f0f0f',
    wallStroke:'rgba(90,80,70,0.35)', cellFill:'rgba(0,0,0,0)',
    nucleusFill:'rgba(40,70,120,0.4)', nucleolusFill:'rgba(120,180,255,0.55)',
    chromatinStroke:'rgba(70,110,180,0.4)', nucleusStroke:'rgba(100,160,255,0.6)',
    mitoFill:'rgba(0,0,0,0)', mitoStroke:'rgba(120,110,100,0.4)',
    chromFill:'rgba(40,70,120,0.3)', chromStroke:'rgba(100,160,255,0.55)',
    bandStroke:'rgba(150,190,255,0.4)', centromereFill:'rgba(150,190,255,0.7)',
    helixBackbone:'rgba(120,140,180,0.45)', riboFill:'rgba(100,90,80,0.35)',
    chloroplastFill:'#3a5c33', vacuoleFill:'rgba(20,25,40,0.4)',
    lipid:true
  },
  em: {
    bg1:'#141414', bg2:'#0e0e0e',
    wallStroke:'#c0c0c0', cellFill:'rgba(90,90,90,0.25)',
    nucleusFill:'rgba(58,58,58,0.9)', nucleolusFill:'rgba(20,20,20,0.95)',
    chromatinStroke:'rgba(150,150,150,0.6)', nucleusStroke:'#a0a0a0',
    mitoFill:'rgba(70,70,70,0.6)', mitoStroke:'#b0b0b0',
    chromFill:'rgba(80,80,80,0.7)', chromStroke:'#c0c0c0',
    bandStroke:'rgba(40,40,40,0.7)', centromereFill:'#e0e0e0',
    helixBackbone:'#b8b8b8', riboFill:'#909090',
    chloroplastFill:'#4a4a4a', vacuoleFill:'rgba(20,20,20,0.85)'
  }
};

function jitter(v, amt){ return v + (Math.random() - 0.5) * amt; }

// Real cells and nuclei are never perfect circles/ellipses -- this draws a closed,
// smoothly-wobbled blob outline instead, which reads as far more organic. Cheap:
// just placing points around a circle with randomized radius, then connecting them
// with quadratic curves through their midpoints (a standard smooth-blob technique).
function organicBlobPath(ctx, cx, cy, rx, ry, wobble, pointCount){
  wobble = wobble === undefined ? 0.12 : wobble;
  pointCount = pointCount || 10;
  const pts = [];
  for(let i = 0; i < pointCount; i++){
    const a = (i / pointCount) * Math.PI * 2;
    const rMod = 1 + (Math.random() - 0.5) * wobble * 2;
    pts.push([cx + Math.cos(a) * rx * rMod, cy + Math.sin(a) * ry * rMod]);
  }
  ctx.beginPath();
  const last = pts[pointCount - 1];
  ctx.moveTo((last[0] + pts[0][0]) / 2, (last[1] + pts[0][1]) / 2);
  for(let i = 0; i < pointCount; i++){
    const cur = pts[i], next = pts[(i + 1) % pointCount];
    const mx = (cur[0] + next[0]) / 2, my = (cur[1] + next[1]) / 2;
    ctx.quadraticCurveTo(cur[0], cur[1], mx, my);
  }
  ctx.closePath();
}

function tierFillBG(ctx, w, h, style){
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, style.bg1);
  g.addColorStop(1, style.bg2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/* ---------- shared subcellular drawing primitives ---------- */
function drawMitochondrion(ctx, x, y, size, angle, style){
  ctx.save();
  ctx.translate(x, y); ctx.rotate(angle);
  const w = size, h = size * 0.5;
  ctx.beginPath(); ctx.ellipse(0, 0, w/2, h/2, 0, 0, Math.PI*2);
  ctx.fillStyle = style.mitoFill; ctx.fill();
  ctx.strokeStyle = style.mitoStroke; ctx.lineWidth = Math.max(0.6, size*0.03);
  ctx.stroke();
  const cristaeCount = Math.max(3, Math.floor(size/6));
  ctx.lineWidth = Math.max(0.4, size*0.02);
  for(let i=0; i<cristaeCount; i++){
    const cx = -w/2*0.6 + (i/(cristaeCount-1)) * w*0.6;
    ctx.beginPath(); ctx.moveTo(cx, -h/2*0.6); ctx.lineTo(cx, h/2*0.6); ctx.stroke();
  }
  ctx.restore();
}

function drawGolgi(ctx, x, y, size, angle, style){
  ctx.save();
  ctx.translate(x, y); ctx.rotate(angle);
  ctx.strokeStyle = style.mitoStroke; ctx.lineWidth = Math.max(0.8, size*0.05);
  for(let i=0; i<5; i++){
    const r = size*0.5 - i*size*0.09;
    ctx.beginPath(); ctx.arc(0, i*size*0.08, r, Math.PI*0.15, Math.PI*0.95); ctx.stroke();
  }
  ctx.restore();
}

function drawER(ctx, x, y, size, angle, style, rough){
  ctx.save();
  ctx.translate(x, y); ctx.rotate(angle);
  ctx.strokeStyle = style.mitoStroke; ctx.lineWidth = Math.max(0.6, size*0.025);
  const sheets = 4;
  for(let s=0; s<sheets; s++){
    ctx.beginPath();
    const yOff = -size*0.3 + s*size*0.2;
    for(let px=-size*0.6; px<=size*0.6; px+=size*0.1){
      const py = yOff + Math.sin(px*0.5) * size*0.06;
      if(px === -size*0.6) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    if(rough){
      ctx.fillStyle = style.mitoStroke;
      for(let px=-size*0.55; px<=size*0.55; px+=size*0.12){
        const py = yOff + Math.sin(px*0.5) * size*0.06;
        ctx.beginPath(); ctx.arc(px, py, size*0.02, 0, Math.PI*2); ctx.fill();
      }
    }
  }
  ctx.restore();
}

function drawNucleusShape(ctx, x, y, r, style, withPores){
  ctx.save();
  ctx.translate(x, y);
  organicBlobPath(ctx, 0, 0, r, r * 0.92, 0.06, 12);
  ctx.fillStyle = style.nucleusFill; ctx.fill();
  ctx.strokeStyle = style.nucleusStroke; ctx.lineWidth = Math.max(1, r*0.045);
  ctx.stroke();
  organicBlobPath(ctx, 0, 0, r * 0.9, r * 0.82, 0.05, 12);
  ctx.lineWidth = Math.max(0.6, r*0.02); ctx.stroke();
  organicBlobPath(ctx, r * 0.15, -r * 0.1, r * 0.28, r * 0.24, 0.15, 8);
  ctx.fillStyle = style.nucleolusFill; ctx.fill();
  ctx.strokeStyle = style.chromatinStroke; ctx.lineWidth = Math.max(0.5, r*0.015);
  for(let i=0; i<10; i++){
    ctx.beginPath();
    let px = (Math.random()-0.5)*r*1.6, py = (Math.random()-0.5)*r*1.5;
    ctx.moveTo(px, py);
    for(let s=0; s<4; s++){
      px += (Math.random()-0.5)*r*0.3; py += (Math.random()-0.5)*r*0.3;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  if(withPores){
    ctx.fillStyle = style.bg1;
    const poreCount = 14;
    for(let i=0; i<poreCount; i++){
      const a = (i/poreCount) * Math.PI*2;
      ctx.beginPath(); ctx.arc(Math.cos(a)*r*0.95, Math.sin(a)*r*0.87, r*0.025, 0, Math.PI*2); ctx.fill();
    }
  }
  ctx.restore();
}

function drawChromatidArm(ctx, cx, cy, dx, dy, len, thick, style){
  const nx = -dy, ny = dx;
  const x2 = cx + dx*len, y2 = cy + dy*len;
  ctx.beginPath();
  ctx.moveTo(cx + nx*thick/2, cy + ny*thick/2);
  ctx.lineTo(x2 + nx*thick/2, y2 + ny*thick/2);
  ctx.arc(x2, y2, thick/2, Math.atan2(ny, nx), Math.atan2(-ny, -nx), false);
  ctx.lineTo(cx - nx*thick/2, cy - ny*thick/2);
  ctx.arc(cx, cy, thick/2, Math.atan2(-ny, -nx), Math.atan2(ny, nx), false);
  ctx.closePath();
  ctx.fillStyle = style.chromFill; ctx.fill();
  ctx.strokeStyle = style.chromStroke; ctx.lineWidth = Math.max(1, thick*0.06);
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.rect(Math.min(cx,x2)-thick, Math.min(cy,y2)-thick, Math.abs(x2-cx)+thick*2, Math.abs(y2-cy)+thick*2);
  ctx.clip();
  const bandCount = Math.max(2, Math.floor(len / (thick*0.5)));
  ctx.strokeStyle = style.bandStroke; ctx.lineWidth = thick*0.14;
  for(let i=1; i<bandCount; i++){
    if(Math.random() > 0.5) continue;
    const t = i/bandCount;
    const px = cx + dx*len*t, py = cy + dy*len*t;
    ctx.beginPath();
    ctx.moveTo(px + nx*thick/2, py + ny*thick/2);
    ctx.lineTo(px - nx*thick/2, py - ny*thick/2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawChromosome(ctx, cx, cy, armLen, thick, angle, style){
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(angle);
  const dirs = [
    [Math.cos(-2.1), Math.sin(-2.1)], [Math.cos(-1.05), Math.sin(-1.05)],
    [Math.cos(1.05), Math.sin(1.05)], [Math.cos(2.1), Math.sin(2.1)]
  ];
  dirs.forEach(([dx,dy]) => drawChromatidArm(ctx, 0, 0, dx, dy, armLen, thick, style));
  ctx.beginPath(); ctx.ellipse(0, 0, thick*0.42, thick*0.3, 0, 0, Math.PI*2);
  ctx.fillStyle = style.centromereFill; ctx.fill();
  ctx.restore();
}

function drawHelix(ctx, w, h, style){
  const cx = w/2;
  const amplitude = w*0.16;
  const period = h*0.09;
  const rungSpacing = period/2.2;
  const baseColors = { A:'#3ddc73', T:'#ff5c5c', G:'#4d9eff', C:'#ffd23c' };
  const pairs = [['A','T'],['T','A'],['G','C'],['C','G']];
  for(let strand=0; strand<2; strand++){
    ctx.beginPath();
    const phase = strand === 0 ? 0 : Math.PI;
    for(let y=-h*0.6; y<=h*0.6; y+=2){
      const x = cx + Math.sin((y/period)*Math.PI*2 + phase) * amplitude;
      if(y === -h*0.6) ctx.moveTo(x, y+h/2); else ctx.lineTo(x, y+h/2);
    }
    ctx.strokeStyle = style.helixBackbone;
    ctx.lineWidth = Math.max(2, w*0.012);
    ctx.stroke();
  }
  let ry = -h*0.6, i = 0;
  while(ry <= h*0.6){
    const x1 = cx + Math.sin((ry/period)*Math.PI*2) * amplitude;
    const x2 = cx + Math.sin((ry/period)*Math.PI*2 + Math.PI) * amplitude;
    const depth = Math.cos((ry/period)*Math.PI*2);
    const [b1, b2] = pairs[i % pairs.length];
    ctx.globalAlpha = 0.4 + 0.6 * Math.max(0, depth*0.5 + 0.5);
    ctx.lineWidth = Math.max(1.5, w*0.01) * (0.6 + 0.4*Math.abs(depth));
    ctx.strokeStyle = baseColors[b1];
    ctx.beginPath(); ctx.moveTo(x1, ry+h/2); ctx.lineTo(cx, ry+h/2); ctx.stroke();
    ctx.strokeStyle = baseColors[b2];
    ctx.beginPath(); ctx.moveTo(cx, ry+h/2); ctx.lineTo(x2, ry+h/2); ctx.stroke();
    ctx.globalAlpha = 1;
    ry += rungSpacing; i++;
  }
}

function tierGlow(ctx, style, x, y, r){
  if(!style.glow) return;
  ctx.save();
  ctx.shadowColor = '#5bffa0'; ctx.shadowBlur = r*1.4;
  ctx.beginPath(); ctx.arc(x, y, r*0.6, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(120,255,180,0.5)'; ctx.fill();
  ctx.restore();
}

function tierLipidDroplets(ctx, style, x, y, spread, count){
  if(!style.lipid) return;
  for(let i=0; i<count; i++){
    const dx = x + jitter(0, spread), dy = y + jitter(0, spread);
    const dsize = spread*0.09 + Math.random()*spread*0.06;
    const g = ctx.createRadialGradient(dx, dy, 0, dx, dy, dsize*2.5);
    g.addColorStop(0, 'rgba(255,255,0,1)'); g.addColorStop(1, 'rgba(255,200,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(dx, dy, dsize*2.5, 0, Math.PI*2); ctx.fill();
  }
}

/* Shared worm-silhouette helpers, used by every modality below so the worm
   reads as an actual sinuous, tapered nematode body in all four micrograph
   types -- not a flat straight oval (the previous approach), which is the
   core reason none of them looked like a worm. Matches the same gentle
   S-curve locomotion shape used by the 3D model, just in 2D. */
function wormCenterline(t, wLen, wH){
  return {
    x: (t - 0.5) * wLen,
    y: Math.sin(t * Math.PI * 1.7) * wH * 1.65,
  };
}
function wormRadiusAt(t, wH){
  if(t < 0.05) return wH * (0.12 + (t / 0.05) * 0.68);           // head taper (blunt nose, not a bulb)
  if(t > 0.94) return wH * (0.85 - ((t - 0.94) / 0.06) * 0.82);  // tail taper to a fine point
  return wH * (0.78 + Math.sin((t - 0.05) / 0.89 * Math.PI) * 0.24);
}
// Builds the closed body outline path (call ctx.fill()/.stroke() after).
function traceWormBody(ctx, wLen, wH, segments){
  segments = segments || 48;
  const top = [], bot = [];
  for(let i = 0; i <= segments; i++){
    const t = i / segments;
    const c = wormCenterline(t, wLen, wH);
    const r = wormRadiusAt(t, wH);
    const t2 = Math.min(1, t + 0.01);
    const c2 = wormCenterline(t2, wLen, wH);
    const dx = c2.x - c.x, dy = c2.y - c.y;
    const len = Math.sqrt(dx*dx + dy*dy) || 1;
    const nx = -dy / len, ny = dx / len;
    top.push({ x: c.x + nx * r, y: c.y + ny * r });
    bot.push({ x: c.x - nx * r, y: c.y - ny * r });
  }
  ctx.beginPath();
  ctx.moveTo(top[0].x, top[0].y);
  for(let i = 1; i < top.length; i++) ctx.lineTo(top[i].x, top[i].y);
  for(let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i].x, bot[i].y);
  ctx.closePath();
}
// A random point INSIDE the curved body (for scattering puncta/organelles so
// they follow the worm's actual curved shape, not a flat bounding oval).
function randomPointInWorm(wLen, wH, tRange){
  tRange = tRange || [0.06, 0.94];
  const t = tRange[0] + Math.random() * (tRange[1] - tRange[0]);
  const c = wormCenterline(t, wLen, wH);
  const r = wormRadiusAt(t, wH);
  const t2 = Math.min(1, t + 0.01);
  const c2 = wormCenterline(t2, wLen, wH);
  const dx = c2.x - c.x, dy = c2.y - c.y;
  const len = Math.sqrt(dx*dx + dy*dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const offset = (Math.random() * 2 - 1) * r * 0.82;
  return { x: c.x + nx * offset, y: c.y + ny * offset, t };
}

// Shared root-silhouette helper, same idea as the worm helpers above: one
// continuous tapered outline (narrow rounded tip at the root cap, gently
// widening toward the shoot end) instead of several independent stacked
// ellipses, which is what made the previous version read as a lumpy
// compound blob rather than a recognizable elongated root.
function traceRootBody(ctx, rw, rh, tipY){
  const topY = tipY - rh;
  ctx.beginPath();
  ctx.moveTo(0, tipY);
  ctx.quadraticCurveTo(rw*0.7, tipY - rh*0.06, rw*0.62, tipY - rh*0.32);
  ctx.quadraticCurveTo(rw*0.8, tipY - rh*0.6, rw*0.78, topY);
  ctx.lineTo(-rw*0.78, topY);
  ctx.quadraticCurveTo(-rw*0.8, tipY - rh*0.6, -rw*0.62, tipY - rh*0.32);
  ctx.quadraticCurveTo(-rw*0.7, tipY - rh*0.06, 0, tipY);
  ctx.closePath();
}
function randomPointInRoot(rw, rh, tipY, yRange){
  yRange = yRange || [0.03, 0.97];
  const ty = yRange[0] + Math.random() * (yRange[1] - yRange[0]);
  const y = tipY - rh * ty;
  // width at this height roughly follows the taper used in traceRootBody
  const widthFrac = ty < 0.32 ? 0.25 + (ty/0.32)*0.5 : 0.75 + Math.min(0.05, (ty-0.32)*0.08);
  const x = (Math.random()*2 - 1) * rw * widthFrac * 0.82;
  return { x, y, ty };
}

const OrganismTierArt = {
  dic(ctx, w, h){
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#1a1a2e');
    grad.addColorStop(1, '#16213e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    
    ctx.save();
    ctx.translate(w/2, h/2);
    
    if(currentOrg && currentOrg.id === 'ara'){
      // PLANT ROOT - one continuous tapered silhouette, not stacked ellipses
      const rh = h * 0.8, rw = w * 0.15;
      const tipY = rh * 0.42; // tip near the bottom of the frame

      const bodyShade = ctx.createLinearGradient(0, tipY, 0, tipY - rh);
      bodyShade.addColorStop(0, '#5a4a3a');   // root cap, darkest
      bodyShade.addColorStop(0.18, '#7a6a5a'); // meristem
      bodyShade.addColorStop(0.45, '#8a7a6a'); // elongation zone
      bodyShade.addColorStop(1, '#9a8a7a');    // maturation zone
      ctx.fillStyle = bodyShade;
      traceRootBody(ctx, rw, rh, tipY);
      ctx.fill();
      ctx.strokeStyle = '#4a3a2a';
      ctx.lineWidth = 1.5;
      traceRootBody(ctx, rw, rh, tipY);
      ctx.stroke();

      // Cell-zone banding across the whole length (denser near the tip,
      // matching real meristem-vs-elongation-zone cell size differences)
      ctx.save();
      traceRootBody(ctx, rw, rh, tipY);
      ctx.clip();
      ctx.strokeStyle = 'rgba(74,58,42,0.4)';
      ctx.lineWidth = 0.7;
      for(let ty = 0.04; ty < 0.97; ty += 0.032){
        const y = tipY - rh * ty;
        const spacing = ty < 0.3 ? 0.55 : 1; // tighter bands near the tip = smaller cells
        if(Math.random() > spacing) continue;
        const widthFrac = ty < 0.32 ? 0.25 + (ty/0.32)*0.5 : 0.78;
        ctx.beginPath();
        ctx.moveTo(-rw*widthFrac, y);
        ctx.lineTo(rw*widthFrac, y);
        ctx.stroke();
      }
      ctx.restore();

      // Root hairs -- fine perpendicular hairs along the maturation zone
      // (upper portion), sticking OUT past the body outline. This is the
      // single most recognizable "root" visual cue in real micrographs.
      ctx.strokeStyle = '#7a6a5a';
      ctx.lineWidth = 0.7;
      for(let i = 0; i < 22; i++){
        const ty = 0.55 + Math.random() * 0.4;
        const y = tipY - rh * ty + (Math.random()-0.5)*4;
        const side = Math.random() < 0.5 ? -1 : 1;
        const baseX = side * rw * 0.78;
        const len = rw * (0.35 + Math.random() * 0.55);
        ctx.beginPath();
        ctx.moveTo(baseX, y);
        ctx.lineTo(baseX + side*len, y + (Math.random()-0.5)*8);
        ctx.stroke();
      }

      // Vascular cylinder (center, dark) running the length of the root
      ctx.fillStyle = '#3a2a1a';
      ctx.beginPath();
      ctx.ellipse(0, tipY - rh*0.55, rw*0.16, rh*0.4, 0, 0, Math.PI*2);
      ctx.fill();

      // Xylem (4 groups)
      ctx.fillStyle = '#6a5a4a';
      for(let i = 0; i < 4; i++){
        const angle = (i/4) * Math.PI * 2;
        const vx = Math.cos(angle) * rw * 0.07;
        const vy = tipY - rh*0.55 + Math.sin(angle) * rh * 0.13;
        ctx.beginPath();
        ctx.ellipse(vx, vy, rw*0.028, rh*0.02, 0, 0, Math.PI*2);
        ctx.fill();
      }
    } else {
      // WORM - curved, tapered sinuous body (not a flat oval)
      const wLen = w * 0.72, wH = h * 0.11;

      const bodyShade = ctx.createLinearGradient(0, -wH, 0, wH);
      bodyShade.addColorStop(0, '#8b7a6a');
      bodyShade.addColorStop(0.5, '#b5a89a');
      bodyShade.addColorStop(1, '#9a8a7a');
      ctx.fillStyle = bodyShade;
      traceWormBody(ctx, wLen, wH);
      ctx.fill();
      ctx.strokeStyle = '#6a5a4a';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Faint ring segmentation along the body -- the same cue used to make
      // the 3D model read as "worm" rather than a smooth tube
      ctx.strokeStyle = 'rgba(90,75,60,0.35)';
      ctx.lineWidth = 0.6;
      for(let i = 4; i < 44; i++){
        const t = i / 48;
        const c = wormCenterline(t, wLen, wH);
        const r = wormRadiusAt(t, wH);
        ctx.beginPath();
        ctx.moveTo(c.x, c.y - r * 0.9);
        ctx.lineTo(c.x, c.y + r * 0.9);
        ctx.stroke();
      }

      const headC = wormCenterline(0.06, wLen, wH);
      const pharynxShade = ctx.createLinearGradient(headC.x - wLen*0.07, headC.y - wH*0.3, headC.x + wLen*0.07, headC.y + wH*0.3);
      pharynxShade.addColorStop(0, '#d4a558');
      pharynxShade.addColorStop(0.5, '#e8b76d');
      pharynxShade.addColorStop(1, '#d49548');
      ctx.fillStyle = pharynxShade;
      ctx.beginPath();
      ctx.ellipse(headC.x, headC.y, wLen*0.1, wH*0.62, 0, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = '#9a7a4a';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      const gutC = wormCenterline(0.55, wLen, wH);
      const gutShade = ctx.createLinearGradient(gutC.x - wLen*0.2, gutC.y - wH*0.3, gutC.x + wLen*0.2, gutC.y + wH*0.3);
      gutShade.addColorStop(0, '#c89a6a');
      gutShade.addColorStop(0.5, '#d8aa7a');
      gutShade.addColorStop(1, '#c89058');
      ctx.fillStyle = gutShade;
      ctx.beginPath();
      ctx.ellipse(gutC.x, gutC.y, wLen*0.22, wH*0.42, 0, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = '#8a6a3a';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Gonad arms -- pale cream, not hot pink (matches the 3D model's redesign)
      ctx.strokeStyle = '#d0c4a0';
      ctx.lineWidth = wH*0.22;
      ctx.lineCap = 'round';
      const gA = wormCenterline(0.30, wLen, wH), gB = wormCenterline(0.42, wLen, wH), gC = wormCenterline(0.62, wLen, wH), gD = wormCenterline(0.72, wLen, wH);
      ctx.beginPath();
      ctx.moveTo(gA.x, gA.y - wH*0.5);
      ctx.bezierCurveTo(gB.x, gB.y - wH*0.75, gC.x, gC.y - wH*0.6, gD.x, gD.y - wH*0.15);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(gA.x, gA.y + wH*0.5);
      ctx.bezierCurveTo(gB.x, gB.y + wH*0.75, gC.x, gC.y + wH*0.6, gD.x, gD.y + wH*0.15);
      ctx.stroke();

      const vulvaC = wormCenterline(0.58, wLen, wH);
      ctx.fillStyle = '#c8a878';
      ctx.beginPath();
      ctx.ellipse(vulvaC.x, vulvaC.y + wormRadiusAt(0.58, wH)*0.85, wLen*0.04, wH*0.12, 0, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = '#a8845a';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    
    ctx.restore();
  },

      gfp(ctx, w, h){
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w/2, h/2);
    
    if(currentOrg && currentOrg.id === 'ara'){
      // PLANT: BRIGHT green puncta in root cells, confined to the real tapered root shape
      const rh = h * 0.8, rw = w * 0.15;
      const tipY = rh * 0.42;

      ctx.strokeStyle = 'rgba(80,140,100,0.4)';
      ctx.lineWidth = 1;
      traceRootBody(ctx, rw, rh, tipY);
      ctx.stroke();

      for(let i = 0; i < 55; i++){
        const p = randomPointInRoot(rw, rh, tipY);
        const size = 3 + Math.random() * 4.5;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size*4.5);
        grad.addColorStop(0, 'rgba(100,255,150,1)');
        grad.addColorStop(0.3, 'rgba(80,255,120,0.8)');
        grad.addColorStop(0.7, 'rgba(60,200,100,0.4)');
        grad.addColorStop(1, 'rgba(100,255,150,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size*4.5, 0, Math.PI*2);
        ctx.fill();
      }
    } else {
      // WORM: Green + red puncta, scattered within the actual curved body shape
      const wLen = w * 0.72, wH = h * 0.11;
      ctx.strokeStyle = 'rgba(100,200,100,0.18)';
      ctx.lineWidth = 0.8;
      traceWormBody(ctx, wLen, wH);
      ctx.stroke();

      for(let i = 0; i < 55; i++){
        const p = randomPointInWorm(wLen, wH, [0.1, 0.92]);
        const size = 2 + Math.random() * 3.5;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size*3.8);
        grad.addColorStop(0, 'rgba(80,255,120,1)');
        grad.addColorStop(0.4, 'rgba(60,200,100,0.6)');
        grad.addColorStop(1, 'rgba(80,255,120,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size*3.8, 0, Math.PI*2);
        ctx.fill();
      }

      for(let i = 0; i < 22; i++){
        const p = randomPointInWorm(wLen, wH, [0.02, 0.14]); // clustered near the head (pharynx reporter)
        const size = 1.5 + Math.random() * 2.5;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size*3);
        grad.addColorStop(0, 'rgba(255,100,180,1)');
        grad.addColorStop(0.4, 'rgba(220,70,150,0.7)');
        grad.addColorStop(1, 'rgba(255,100,180,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size*3, 0, Math.PI*2);
        ctx.fill();
      }
    }
    ctx.restore();
  },

      bodipy(ctx, w, h){
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#1a1a1a');
    grad.addColorStop(1, '#0f0f0f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w/2, h/2);
    
    if(currentOrg && currentOrg.id === 'ara'){
      // PLANT: VERY BRIGHT yellow lipids concentrated in root cap + blue nuclei
      const rh = h * 0.8, rw = w * 0.15;
      const tipY = rh * 0.42;

      ctx.strokeStyle = 'rgba(255,220,60,0.08)';
      ctx.lineWidth = 0.8;
      traceRootBody(ctx, rw, rh, tipY);
      ctx.stroke();

      // YELLOW LIPIDS - CONCENTRATED AT ROOT TIP (very visible!)
      for(let i = 0; i < 35; i++){
        const p = randomPointInRoot(rw, rh, tipY, [0.02, 0.22]); // near the tip
        const size = 4 + Math.random() * 8;
        const g = ctx.createRadialGradient(p.x, p.y, size*0.2, p.x, p.y, size*5);
        g.addColorStop(0, 'rgba(255,255,0,1)');
        g.addColorStop(0.2, 'rgba(255,240,50,1)');
        g.addColorStop(0.6, 'rgba(255,200,0,0.7)');
        g.addColorStop(1, 'rgba(255,255,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size*5, 0, Math.PI*2);
        ctx.fill();
      }
      
      // BLUE NUCLEI - scattered in root cells
      for(let i = 0; i < 12; i++){
        const p = randomPointInRoot(rw, rh, tipY);
        const size = 5 + Math.random() * 7;
        const g = ctx.createRadialGradient(p.x, p.y, size*0.3, p.x, p.y, size*3);
        g.addColorStop(0, 'rgba(100,180,255,1)');
        g.addColorStop(0.5, 'rgba(80,160,255,0.7)');
        g.addColorStop(1, 'rgba(100,180,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size*3, 0, Math.PI*2);
        ctx.fill();
      }
    } else {
      // WORM: Yellow lipids + blue nuclei, confined to the curved body (was
      // scattering across the whole canvas before, with no worm shape at all)
      const wLen = w * 0.72, wH = h * 0.11;
      ctx.strokeStyle = 'rgba(255,220,60,0.1)';
      ctx.lineWidth = 0.8;
      traceWormBody(ctx, wLen, wH);
      ctx.stroke();

      for(let i = 0; i < 70; i++){
        const p = randomPointInWorm(wLen, wH, [0.08, 0.94]);
        const size = 2 + Math.random() * 6.5;
        const g = ctx.createRadialGradient(p.x, p.y, size*0.3, p.x, p.y, size*4);
        g.addColorStop(0, 'rgba(255,240,80,1)');
        g.addColorStop(0.3, 'rgba(255,200,40,0.8)');
        g.addColorStop(1, 'rgba(255,220,60,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size*4, 0, Math.PI*2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,150,1)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, size*0.9, 0, Math.PI*2);
        ctx.fill();
      }
      for(let i = 0; i < 25; i++){
        const p = randomPointInWorm(wLen, wH, [0.08, 0.94]);
        const size = 4 + Math.random() * 5.5;
        const g = ctx.createRadialGradient(p.x, p.y, size*0.3, p.x, p.y, size*3);
        g.addColorStop(0, 'rgba(120,180,255,1)');
        g.addColorStop(0.3, 'rgba(100,160,255,0.8)');
        g.addColorStop(1, 'rgba(120,180,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size*3, 0, Math.PI*2);
        ctx.fill();
      }
    }
    ctx.restore();
  },


    em(ctx, w, h){
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#1a1a1a');
    grad.addColorStop(1, '#0f0f0f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w/2, h/2);
    
    if(currentOrg && currentOrg.id === 'ara'){
      // PLANT: BRIGHT cell walls + dark vacuole + gray mitochondria (very distinct from worm!)
      const rh = h * 0.48, rw = w * 0.13;
      
      // CELL WALLS - VERY BRIGHT and PROMINENT (clear rectangular grid)
      ctx.strokeStyle = '#c0c0c0';  // Very bright gray
      ctx.lineWidth = 2;  // Thicker lines
      for(let i = 0; i < 10; i++) {
        const y = -rh*0.35 + i*rh*0.07;
        ctx.beginPath();
        ctx.rect(-rw*0.45, y, rw*0.9, rh*0.065);
        ctx.stroke();
      }
      
      // VACUOLE - VERY DARK center (obvious)
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.ellipse(0, 0, rw*0.8, rh*0.55, 0, 0, Math.PI*2);
      ctx.fill();
      
      // Add vacuole boundary (makes it distinct)
      ctx.strokeStyle = '#505050';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, rw*0.8, rh*0.55, 0, 0, Math.PI*2);
      ctx.stroke();
      
      // MITOCHONDRIA - bright gray dots (very visible inside dark vacuole)
      for(let i = 0; i < 25; i++){
        const x = (Math.random()-0.5) * rw * 1.5;
        const y = (Math.random()-0.5) * rh * 1.0;
        const mw = 3.5 + Math.random() * 4;
        const mh = 2.5 + Math.random() * 3;
        const gray = 100 + Math.random() * 50;  // Brighter!
        ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
        ctx.beginPath();
        ctx.ellipse(x, y, mw, mh, Math.random(), 0, Math.PI*2);
        ctx.fill();
      }
    } else {
      // WORM: Grayscale detail, curved tapered body
      const wLen = w * 0.72, wH = h * 0.11;
      traceWormBody(ctx, wLen, wH);
      ctx.strokeStyle = '#808080';
      ctx.lineWidth = 1.8;
      ctx.stroke();
      const headC = wormCenterline(0.06, wLen, wH);
      ctx.fillStyle = '#3a3a3a';
      ctx.beginPath();
      ctx.ellipse(headC.x, headC.y, wLen*0.1, wH*0.62, 0, 0, Math.PI*2);
      ctx.fill();
      const gutC = wormCenterline(0.55, wLen, wH);
      ctx.fillStyle = '#4a4a4a';
      ctx.beginPath();
      ctx.ellipse(gutC.x, gutC.y, wLen*0.22, wH*0.32, 0, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = '#5a5a5a';
      ctx.lineWidth = wH*0.2;
      ctx.lineCap = 'round';
      const gA = wormCenterline(0.30, wLen, wH), gB = wormCenterline(0.42, wLen, wH), gC = wormCenterline(0.62, wLen, wH), gD = wormCenterline(0.72, wLen, wH);
      ctx.beginPath();
      ctx.moveTo(gA.x, gA.y - wH*0.45);
      ctx.bezierCurveTo(gB.x, gB.y - wH*0.7, gC.x, gC.y - wH*0.55, gD.x, gD.y - wH*0.15);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(gA.x, gA.y + wH*0.45);
      ctx.bezierCurveTo(gB.x, gB.y + wH*0.7, gC.x, gC.y + wH*0.55, gD.x, gD.y + wH*0.15);
      ctx.stroke();
      for(let i = 0; i < 60; i++){
        const p = randomPointInWorm(wLen, wH, [0.08, 0.92]);
        const mw = 2 + Math.random() * 2.2;
        const mh = 1.2 + Math.random() * 1.8;
        const gray = 70 + Math.random() * 30;
        ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, mw, mh, Math.random(), 0, Math.PI*2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
};
/* ---------- tier drawers (shared across all 4 modalities) ---------- */
function drawTissueTier(ctx, w, h, mod, isPlant){
  const style = TIER_STYLE[mod];
  tierFillBG(ctx, w, h, style);
  const cols = isPlant ? 6 : 7, rows = isPlant ? 9 : 6;
  const cw = w/cols, ch = h/rows;
  // Two "hero" cells are drawn fully deterministically (zero jitter, guaranteed
  // nucleus) so the tissue-tier hotspots always land exactly on a real visible
  // cell/nucleus. Every other cell keeps its randomized position/nucleus-chance
  // for visual variety -- only the specific cells a hotspot points at need to
  // be reliable.
  const heroMembraneCell = { r: 1, c: 1 };
  const heroNucleusCell = { r: Math.floor(rows/2), c: Math.floor(cols/2) };
  for(let r=0; r<rows; r++){
    for(let c=0; c<cols; c++){
      const isHeroMembrane = r === heroMembraneCell.r && c === heroMembraneCell.c;
      const isHeroNucleus = r === heroNucleusCell.r && c === heroNucleusCell.c;
      const isHero = isHeroMembrane || isHeroNucleus;
      const x = isHero ? c*cw + cw/2 : c*cw + jitter(cw/2, cw*0.15);
      const y = isHero ? r*ch + ch/2 : r*ch + jitter(ch/2, ch*0.15);
      const cellW = cw*0.9, cellH = ch*0.9;
      ctx.beginPath();
      if(isPlant) ctx.rect(x-cellW/2, y-cellH/2, cellW, cellH);
      else organicBlobPath(ctx, x, y, cellW/2, cellH/2, isHero ? 0.05 : 0.13, 9);
      if(style.cellFill){ ctx.fillStyle = style.cellFill; ctx.fill(); }
      ctx.strokeStyle = style.wallStroke; ctx.lineWidth = Math.max(0.8, cw*0.02);
      ctx.stroke();
      if(isHeroNucleus || Math.random() > 0.15){
        const nx = isHeroNucleus ? x : x + jitter(0, cw*0.1);
        const ny = isHeroNucleus ? y : y + jitter(0, ch*0.1);
        ctx.beginPath(); ctx.ellipse(nx, ny, cw*0.16, ch*0.16, 0, 0, Math.PI*2);
        ctx.fillStyle = style.nucleusFill; ctx.fill();
        tierGlow(ctx, style, nx, ny, cw*0.16);
      }
      tierLipidDroplets(ctx, style, x, y, cw*0.3, Math.random() > 0.6 ? 2 : 0);
    }
  }
}

function drawCellTier(ctx, w, h, mod, isPlant){
  const style = TIER_STYLE[mod];
  tierFillBG(ctx, w, h, style);
  const n = isPlant ? 4 : 3;
  for(let i=0; i<n; i++){
    const p = {
      x: w*(0.22 + (i%2)*0.56) + (i === 0 ? 0 : jitter(0, w*0.05)),
      y: h*(0.28 + Math.floor(i/2)*0.44) + (i === 0 ? 0 : jitter(0, h*0.05)),
      r: Math.min(w,h) * (isPlant ? 0.24 : 0.26)
    };
    ctx.save();
    ctx.beginPath();
    if(isPlant) ctx.rect(p.x-p.r, p.y-p.r*0.9, p.r*2, p.r*1.8);
    else organicBlobPath(ctx, p.x, p.y, p.r, p.r*0.85, 0.09, 11);
    if(style.cellFill && style.cellFill !== 'rgba(0,0,0,0)'){ ctx.fillStyle = style.cellFill; ctx.fill(); }
    ctx.strokeStyle = style.wallStroke; ctx.lineWidth = Math.max(1.5, p.r*0.03);
    ctx.stroke();
    if(isPlant){
      ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r*0.62, p.r*0.55, 0, 0, Math.PI*2);
      ctx.fillStyle = style.vacuoleFill; ctx.fill();
      for(let k=0; k<5; k++){
        const a = (k/5)*Math.PI*2;
        const cx2 = p.x + Math.cos(a)*p.r*0.72, cy2 = p.y + Math.sin(a)*p.r*0.6;
        ctx.beginPath(); ctx.ellipse(cx2, cy2, p.r*0.13, p.r*0.08, a, 0, Math.PI*2);
        ctx.fillStyle = style.chloroplastFill; ctx.fill();
      }
    }
    const nx = p.x + (isPlant ? p.r*0.35 : 0), ny = p.y + (isPlant ? p.r*0.25 : 0);
    drawNucleusShape(ctx, nx, ny, p.r*(isPlant?0.22:0.34), style, false);
    tierGlow(ctx, style, nx, ny, p.r*0.3);
    for(let k=0; k<5; k++){
      const a = Math.random()*Math.PI*2, dist = Math.random()*p.r*0.65;
      drawMitochondrion(ctx, p.x+Math.cos(a)*dist, p.y+Math.sin(a)*dist, p.r*0.16, Math.random()*Math.PI, style);
    }
    tierLipidDroplets(ctx, style, p.x, p.y, p.r*0.6, 6);
    ctx.restore();
  }
}

function drawOrganelleTier(ctx, w, h, mod, isPlant){
  const style = TIER_STYLE[mod];
  tierFillBG(ctx, w, h, style);
  const nucX = w*0.28, nucY = h*0.32, nucR = Math.min(w,h)*0.26;
  drawNucleusShape(ctx, nucX, nucY, nucR, style, true);
  tierGlow(ctx, style, nucX, nucY, nucR*0.5);
  for(let i=0; i<10; i++){
    const x = w*(0.3 + Math.random()*0.65), y = h*(0.15 + Math.random()*0.8);
    drawMitochondrion(ctx, x, y, Math.min(w,h)*0.09, Math.random()*Math.PI, style);
  }
  drawER(ctx, w*0.68, h*0.68, Math.min(w,h)*0.5, -0.3, style, true);
  drawGolgi(ctx, w*0.75, h*0.28, Math.min(w,h)*0.22, 0.4, style);
  ctx.fillStyle = style.riboFill;
  for(let i=0; i<60; i++){
    ctx.beginPath();
    ctx.arc(Math.random()*w, Math.random()*h, Math.max(1, w*0.003), 0, Math.PI*2);
    ctx.fill();
  }
  if(isPlant){
    ctx.strokeStyle = style.wallStroke; ctx.lineWidth = w*0.02;
    ctx.strokeRect(w*0.02, h*0.02, w*0.96, h*0.96);
    const ccx = w*0.7, ccy = h*0.72, cr = Math.min(w,h)*0.18;
    ctx.beginPath(); ctx.ellipse(ccx, ccy, cr, cr*0.65, 0.3, 0, Math.PI*2);
    ctx.fillStyle = style.chloroplastFill; ctx.fill();
    ctx.strokeStyle = style.wallStroke; ctx.lineWidth = cr*0.05; ctx.stroke();
    for(let i=0; i<6; i++){
      ctx.beginPath();
      ctx.ellipse(ccx, ccy-cr*0.4+i*cr*0.14, cr*0.7, cr*0.06, 0.3, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fill();
    }
  }
  tierLipidDroplets(ctx, style, w*0.5, h*0.5, Math.min(w,h)*0.45, 10);
}

function drawNucleusTier(ctx, w, h, mod, isPlant){
  const style = TIER_STYLE[mod];
  tierFillBG(ctx, w, h, style);
  const cx = w/2, cy = h/2, r = Math.min(w,h)*0.46;
  drawNucleusShape(ctx, cx, cy, r, style, true);
  tierGlow(ctx, style, cx, cy, r*0.4);
  for(let i=0; i<3; i++){
    const a = Math.random()*Math.PI*2;
    drawChromosome(ctx, cx+Math.cos(a)*r*0.25, cy+Math.sin(a)*r*0.25, r*0.22, r*0.09, Math.random()*Math.PI, style);
  }
}

function drawChromosomeTier(ctx, w, h, mod, isPlant){
  const style = TIER_STYLE[mod];
  tierFillBG(ctx, w, h, style);
  ctx.fillStyle = style.chromatinStroke;
  ctx.globalAlpha = 0.05; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1;
  for(let i=0; i<2; i++){
    const cx = w*(0.32 + i*0.36), cy = h*0.5;
    drawChromosome(ctx, cx, cy, Math.min(w,h)*0.32, Math.min(w,h)*0.11, i*0.5, style);
    if(style.glow && i === 0) tierGlow(ctx, style, cx, cy - Math.min(w,h)*0.15, Math.min(w,h)*0.08);
  }
}

function drawDnaTier(ctx, w, h, mod, isPlant){
  const style = TIER_STYLE[mod];
  tierFillBG(ctx, w, h, style);
  drawHelix(ctx, w, h, style);
}

/* ---------- tier dispatch: which drawer runs for a given zoom tier ---------- */
function dispatchProceduralTier(ctx, w, h, tier, mod){
  const isPlant = typeof currentOrg !== 'undefined' && currentOrg && currentOrg.id === 'ara';
  const tierId = tier ? tier.id : 'organism';

  // Draw the actual content into an offscreen buffer first, so uniform
  // "microscope look" post-processing (below) can be applied in one place
  // instead of touching every individual shape-drawing function.
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const octx = off.getContext('2d');

  if(tierId === 'organism'){
    OrganismTierArt[mod](octx, w, h);
  } else {
    switch(tierId){
      case 'tissue':     drawTissueTier(octx, w, h, mod, isPlant); break;
      case 'cell':       drawCellTier(octx, w, h, mod, isPlant); break;
      case 'organelle':  drawOrganelleTier(octx, w, h, mod, isPlant); break;
      case 'nucleus':    drawNucleusTier(octx, w, h, mod, isPlant); break;
      case 'chromosome': drawChromosomeTier(octx, w, h, mod, isPlant); break;
      case 'dna':        drawDnaTier(octx, w, h, mod, isPlant); break;
      default:           OrganismTierArt[mod](octx, w, h);
    }
  }

  applyMicroscopyPostFX(ctx, off, w, h, mod);
}

// Cached texture tiles built ONCE ever (keyed by their params) and reused as
// repeating canvas patterns on every subsequent image. This gets much denser,
// more convincing grain than drawing scattered individual dots per image,
// without paying a per-image getImageData/putImageData cost -- the expensive
// pixel-level work happens once total, not once per micrograph.
const _texTileCache = {};
function getNoiseTile(size, density, contrast){
  const key = 'noise_' + size + '_' + density + '_' + contrast;
  if(_texTileCache[key]) return _texTileCache[key];
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const tctx = c.getContext('2d');
  const imgData = tctx.createImageData(size, size);
  for(let i = 0; i < imgData.data.length; i += 4){
    const hit = Math.random() < density;
    const v = hit ? Math.max(0, Math.min(255, 128 + (Math.random() - 0.5) * 255 * contrast)) : 128;
    imgData.data[i] = v; imgData.data[i+1] = v; imgData.data[i+2] = v;
    imgData.data[i+3] = hit ? 255 : 0;
  }
  tctx.putImageData(imgData, 0, 0);
  _texTileCache[key] = c;
  return c;
}
function getHatchTile(size, spacing, lineAlpha){
  const key = 'hatch_' + size + '_' + spacing + '_' + lineAlpha;
  if(_texTileCache[key]) return _texTileCache[key];
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const tctx = c.getContext('2d');
  tctx.strokeStyle = `rgba(255,255,255,${lineAlpha})`;
  tctx.lineWidth = 1;
  for(let x = -size; x < size * 2; x += spacing){
    tctx.beginPath();
    tctx.moveTo(x, 0);
    tctx.lineTo(x + size, size);
    tctx.stroke();
  }
  _texTileCache[key] = c;
  return c;
}
function applyPatternOverlay(ctx, w, h, tile, blendMode, alpha){
  ctx.save();
  ctx.globalCompositeOperation = blendMode;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = ctx.createPattern(tile, 'repeat');
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// Uniform "shot through a real microscope" treatment: per-modality color/contrast
// grading, a soft bloom for fluorescence channels, dense grain texture (modality-
// tuned -- EM gets heavy stipple, DIC gets diagonal hatch relief, fluorescence
// gets light grain plus background speckle/autofluorescence), a vignette
// (virtually every real micrograph has some falloff toward the field edge).
// Applied once here rather than duplicated across every tier x modality
// drawing function.
function applyMicroscopyPostFX(ctx, sourceCanvas, w, h, mod){
  let gradeFilter = '';
  if(mod === 'em')          gradeFilter = 'brightness(0.98) saturate(0.85)';
  else if(mod === 'dic')    gradeFilter = 'saturate(0.92)';
  else if(mod === 'gfp')    gradeFilter = 'saturate(1.18)';
  else if(mod === 'bodipy') gradeFilter = 'saturate(1.12)';

  ctx.save();
  ctx.filter = gradeFilter || 'none';
  ctx.drawImage(sourceCanvas, 0, 0);
  ctx.filter = 'none';
  ctx.restore();

  // Soft bloom for fluorescence modalities -- glow bright structures slightly,
  // approximating the point-spread-function halo real fluorescence shows
  if(mod === 'gfp' || mod === 'bodipy'){
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.3;
    ctx.filter = `blur(${Math.max(2, w * 0.012)}px) brightness(1.35)`;
    ctx.drawImage(sourceCanvas, 0, 0);
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.restore();

    // Background speckle/autofluorescence -- real fluorescence shots are never
    // a clean black field around the signal; scattered dim specks and a few
    // brighter out-of-focus flecks sell "real sensor" over "flat vector fill".
    ctx.save();
    const speckleCount = Math.floor((w * h) / 1800);
    const speckleColor = mod === 'gfp' ? [90, 220, 130] : [230, 190, 90];
    for(let i = 0; i < speckleCount; i++){
      const bright = Math.random() < 0.08;
      const r = bright ? 1.4 + Math.random() * 1.8 : 0.5 + Math.random() * 0.9;
      ctx.globalAlpha = bright ? 0.12 + Math.random() * 0.18 : 0.03 + Math.random() * 0.06;
      ctx.fillStyle = `rgb(${speckleColor[0]},${speckleColor[1]},${speckleColor[2]})`;
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * h, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    applyPatternOverlay(ctx, w, h, getNoiseTile(96, 0.5, 0.35), 'source-over', 0.05);
  }

  // DIC pseudo-relief: real DIC optics render a very characteristic diagonal
  // shadow-cast microtexture (structures look embossed, streaked along one
  // consistent axis) -- a full normal-map emboss isn't cheap in 2D canvas, but
  // a directional light/shadow gradient plus fine diagonal hatching at the
  // same angle approximates the same visual read at a fraction of the cost.
  if(mod === 'dic'){
    ctx.save();
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, 'rgba(255,255,255,0.07)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    applyPatternOverlay(ctx, w, h, getHatchTile(48, 2.5, 0.08), 'source-over', 0.22);
    applyPatternOverlay(ctx, w, h, getNoiseTile(128, 0.6, 0.25), 'source-over', 0.09);
  }

  // EM: real TEM/SEM micrographs are essentially built FROM texture -- there
  // is no such thing as a flat-filled region. Heavy, high-contrast stipple
  // grain is the single biggest thing that reads as "real electron
  // micrograph" rather than "flat gray vector shapes".
  if(mod === 'em'){
    applyPatternOverlay(ctx, w, h, getNoiseTile(96, 0.85, 0.55), 'source-over', 0.22);
    applyPatternOverlay(ctx, w, h, getNoiseTile(256, 0.4, 0.4), 'source-over', 0.13);
  }

  // Vignette
  ctx.save();
  const vign = ctx.createRadialGradient(w/2, h/2, Math.min(w,h)*0.35, w/2, h/2, Math.max(w,h)*0.72);
  vign.addColorStop(0, 'rgba(0,0,0,0)');
  vign.addColorStop(1, 'rgba(0,0,0,0.36)');
  ctx.fillStyle = vign;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // Sparse film grain on top of everything -- a final unifying layer so no
  // modality (even ones without a dedicated texture pass above) looks
  // perfectly smooth/synthetic.
  ctx.save();
  const grainCount = Math.floor((w * h) / 900);
  for(let i = 0; i < grainCount; i++){
    const shade = Math.random() > 0.5 ? 255 : 0;
    ctx.globalAlpha = Math.random() * 0.05;
    ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

const ProceduralImages = {
  dic(ctx, w, h, tier){ dispatchProceduralTier(ctx, w, h, tier, 'dic'); },
  gfp(ctx, w, h, tier){ dispatchProceduralTier(ctx, w, h, tier, 'gfp'); },
  bodipy(ctx, w, h, tier){ dispatchProceduralTier(ctx, w, h, tier, 'bodipy'); },
  em(ctx, w, h, tier){ dispatchProceduralTier(ctx, w, h, tier, 'em'); }
};


const ImageCache = {
  _cache: {},
  _maxSize: 70,
  get(key){ return this._cache[key]; },
  set(key, canvas){
    const keys = Object.keys(this._cache);
    if(keys.length >= this._maxSize){
      keys.slice(0, Math.floor(this._maxSize / 2)).forEach(k => delete this._cache[k]);
    }
    this._cache[key] = canvas;
  },
  clear(){ this._cache = {}; }
};

function getProceduralCanvas(key, w, h, tier){
  const tierId = tier ? tier.id : 'organism';
  const orgId = (typeof currentOrg !== 'undefined' && currentOrg) ? currentOrg.id : 'none';
  const ck = key + '_' + w + 'x' + h + '_' + tierId + '_' + orgId;
  if(ImageCache.get(ck)) return ImageCache.get(ck);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const fn = ProceduralImages[key.split(':').pop()] || ProceduralImages.dic;
  fn(c.getContext('2d'), w, h, tier);
  ImageCache.set(ck, c);
  return c;
}

function resolveImageSource(field){
  if(typeof field === 'string' && field.startsWith('procedural:')){
    return { kind: 'procedural', key: field };
  }
  return { kind: 'url', url: field };
}
