# Model Organism Explorer — VIBE Board Edition

Interactive touchscreen-friendly explorer for C. elegans and Arabidopsis thaliana.
Built with HTML/CSS/JS + Three.js (WebGL) for the 3D anatomy view.

## How to run it

Browsers block `fetch()` of local JSON files when you just double-click index.html
(file:// security restriction). You need to serve the folder over HTTP:

**Easiest — Python (already on most computers):**
```
cd bio_explorer_v2
python3 -m http.server 8000
```
Then open `http://localhost:8000` in your browser.

**Or — Node:**
```
npx serve .
```

**Or** upload the whole folder to any static web host (Netlify, GitHub Pages,
a school server, etc.) and open it there. For the VIBE Board itself, point its
browser/kiosk app at wherever this folder is hosted.

## Requirements

- Internet connection on first load (to fetch Three.js from a CDN for the 3D
  view). If the board will run on a locked-down/offline network, download
  https://cdnjs.cloudflare.com/ajax/libs/three.js/128/three.min.js once and
  change the `<script src="...">` tag in index.html to a local path instead.
- Modern browser with WebGL support for the 3D Anatomy tab. If WebGL/Three.js
  fails to load for any reason, the app automatically falls back to the
  Microscopy & Imagery tab, which works with no 3D dependency at all.

## File structure

```
index.html        – page shell, loads Three.js + organisms.js + app.js + deepzoom.js + timelapse.js
styles.css        – all styling (dark kiosk theme, 1920x1080 tuned)
organisms.js       – JSON data loader + procedural microscopy image generators
app.js            – all app logic: 3D engine, imagery viewer, life cycle, workflows
deepzoom.js        – Deep Zoom tab: continuous 3D LOD, organism → DNA
timelapse.js       – Life Cycle tab: looping 3D growth time-lapse animation
data/
  manifest.json    – registry of which organism JSON files to load
  c_elegans.json    – all C. elegans content (hotspots, imagery, life cycle, workflows)
  arabidopsis.json  – same, for Arabidopsis thaliana
```

## Adding a new organism

1. Copy `data/c_elegans.json` as a template.
2. Fill in hotspots3d, data (anatomy/genetics/experiment per hotspot), imagery,
   lifecycle, and workflows.
3. Add an entry to `data/manifest.json` pointing at your new file.
4. No code changes needed — the app loads organisms dynamically.

The 3D model itself currently supports two body plans in `app.js`
(`buildWormModel` / `buildPlantModel`). A brand-new organism with a very
different body shape will render as a generic placeholder mesh unless you add
a matching `build____Model()` function and wire it into `loadOrgInto3D()`.

## Known limitations (honest list)

- **3D models are procedurally generated**, not sculpted/scanned real models.
  They're built from code (tapered tube geometry, procedural cuticle texture
  for the worm, extruded leaf shapes for the plant) — built for a clean
  educational silhouette, not photographic realism.
- **Imagery is procedurally generated artwork standing in for real micrographs**,
  not real photography. Each image's `image` field in the JSON files
  (e.g. `"procedural:dic"`) can be swapped for a real photo URL/path — the
  viewer will draw it directly instead, no other code changes needed.
- **Video fields are wired up but unpopulated** — the `video` field per image
  in the JSON accepts an embeddable video URL (YouTube embed, mp4, etc.) and
  the UI will show a "Watch related video" button automatically; none of the
  current entries have a real video attached.
- **I was unable to fully test the 3D WebGL rendering myself** — my dev
  sandbox has no internet access, so I could not load the Three.js CDN script
  to verify the worm/plant 3D models actually render correctly. Everything
  else (Imagery, Life Cycle, Workflows, organism switching, kiosk mode,
  fullscreen) was tested end-to-end with a headless browser. Please check the
  3D Anatomy tab first when you open this for real and let me know if
  anything looks off.
