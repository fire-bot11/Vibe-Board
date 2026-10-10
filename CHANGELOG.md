## v39 — July 29, 2026

### Fixed: several visible Deep Zoom structures had no hotspot
Spotted from a screenshot: the mitochondria (the orange capsule/pill
shapes) in the Organelle tier had no hotspot, unlike the nucleus/ER/Golgi
next to them. Turned out to be a broader gap, not a one-off — audited
every tier for the same pattern (a mesh that gets drawn but was never
added to its tier's `hotspots` array) and found four:

- **Mitochondria** — missing in both the Cell tier and the Organelle tier.
- **Nucleolus** — missing in the Cell tier (it was already present in the
  Nucleus tier).
- **Chloroplasts** — missing in the Cell tier's plant variant.
- **Chromatin strands** — missing in the Nucleus tier.

All four now have proper hotspots (dot + sidebar-list entry + click-to-
glow + fact), consistent with everything else in Deep Zoom. Caught one
placement bug while fixing this: chromatin is built from `TubeGeometry`
tubes, whose shape comes entirely from the curve passed into them — the
mesh's own `.position` stays at the origin. My first pass used
`strand.position` for the hotspot's marker position, which would have put
the dot at the group's center instead of on the actual strand; fixed to
read a real point off the curve instead (`curve.getPoint(0.5)`).

Verified by building every cell/organelle/nucleus tier for both organisms
and confirming each hotspot has a non-empty mesh reference, a valid
(non-NaN) position, and that simulating a click on every single one
completes without error.

## v44 — July 30, 2026

### Fixed: Imagery tab's Organism tier didn't look like a worm or plant
Root cause for the worm: every modality (DIC, GFP, BODIPY, EM) drew the
body as a single flat straight ellipse (`ctx.ellipse(0,0,wLen/2,wH/2,...)`)
— no curve, no taper differentiation. GFP/BODIPY were worse: puncta
scattered across a bounding region with no body outline at all (BODIPY's
worm branch scattered across the *entire canvas*, not even constrained to
an oval). Root cause for the plant: the root was built from 4 independent
overlapping ellipses (root cap, meristem, elongation, maturation zones)
stacked with no continuous outline, reading as a lumpy compound blob
rather than an elongated root — and sized small relative to the canvas.

Added shared silhouette helpers (`traceWormBody`/`randomPointInWorm` for
the worm, `traceRootBody`/`randomPointInRoot` for the plant) and rewrote
all 4 modalities for both organisms to use them consistently:

- **Worm**: real S-curve tapered body (matching the same locomotion curve
  the 3D model uses), with visible ring segmentation, a distinct but
  un-bulbous head, and GFP/BODIPY puncta now sampled *inside* the actual
  curved body shape instead of a bounding oval or the whole canvas.
- **Plant**: one continuous tapered root silhouette (rounded tip at the
  root cap, gently widening toward the shoot) instead of stacked ellipses,
  sized to actually fill the frame, with visible root hairs sticking out
  along the maturation zone — the single most recognizable "this is a
  root" visual cue in real micrographs, which was completely absent
  before.
- Also toned down the DIC worm's gonad coloring from hot pink to pale
  cream, matching the same fix already made to the 3D model (v42).
- **Left the EM modality's cell-level framing alone on purpose** — its
  data description is explicitly "intestinal cross-section" / "root cell
  ultrastructure," a genuine cellular close-up rather than a whole-
  organism view. That's scientifically appropriate for TEM and isn't part
  of the "doesn't look like the organism" issue, since cross-sections
  aren't expected to show the whole shape.

Verified by rendering all 8 images (both organisms × 4 modalities) and
visually confirming each one — the worm now shows a clear curved,
tapered, segmented body across all 4 modalities; the plant root is
unmistakably root-shaped (tapered, root-hair-fringed) in DIC/GFP/BODIPY.

## v43 — July 30, 2026

### Fixed: 3D hotspots disappearing and snapping back to place
Two real bugs in `updateHotspotScreenPositions()` (3D Anatomy tab), and
the same first bug in Deep Zoom's equivalent function:

- **Disappearing at some angles**: the visibility check only tested
  whether a hotspot was *behind* the camera (`v.z > 1`), never whether its
  projected position had swung *outside* the visible frame. A hotspot at
  a grazing/edge angle stayed `display:flex` but positioned outside the
  clipped canvas area — invisible, but not because it was hidden on
  purpose. The new pan controls (v42) made this far easier to trigger,
  since panning routinely pushes the model off-center. Fixed: now hides
  on out-of-frame projection too (`|x| > 1.08` or `|y| > 1.08` in NDC
  space), not just behind-camera.
- **Snapping back into place**: the position-smoothing code re-read its
  easing baseline from `anchor.el.style.left/top` — the DOM style string —
  every frame. While a hotspot was hidden (or on its first-ever frame),
  that style value simply wasn't being updated, so when it reappeared the
  code eased from a stale, sometimes wildly-wrong old position instead of
  the current one, reading as a jump/snap. Fixed: smoothing state now
  lives in memory on the anchor object itself, and the first frame after
  becoming visible snaps immediately (no easing baseline to speak of yet)
  rather than animating in from garbage.

Verified directly: a hotspot at world-x=50 (deliberately far off-axis)
now correctly reports `display:none` instead of rendering at a
9035px-off-canvas position; moving it back into view snaps immediately to
~450px instead of jumping from that stale value; a subsequent small move
still eases smoothly (confirms the smoothing itself isn't broken, just
the baseline it was reading from).

## v42 — July 30, 2026

### Redesigned the worm model
Traced the likely cause: a smooth, glossy, fairly translucent tapered
tube with a pronounced bulge near the head, plus hot-pink internal organs
(gonad, vulva) visible through the body wall via transmission — reasonable
that combination reads as inappropriate rather than "nematode."

- **Reduced the head bulge**: the pharynx-region taper went from 0.06→0.16
  (a 2.5× swell) down to 0.06→0.145, much closer to the main body radius
  so it reads as anatomical detail rather than a pronounced bulb.
- **Added real visible ring segmentation to the geometry itself**, not just
  the flat texture map — amplitude increased 5× (0.0012→0.006) so the body
  silhouette itself clearly reads as ringed/segmented (real C. elegans
  cuticular annuli), breaking up what was previously a smooth continuous
  taper.
- **Reduced transmission** (0.18→0.05) and **clearcoat** (0.20→0.10) on the
  body material — far less "wet/glossy," internal organs no longer visible
  through the body wall by default (they're still viewable via the
  transparent/wireframe toggle added earlier — that's the intentional way
  to see internals, not permanent see-through skin).
- **Recolored the gonad and vulva** away from hot pink (`#d97bc0`,
  `#e682c8`) to pale cream (`#dcd4a8`) and muted terracotta (`#c8926a`) —
  both more biologically accurate (real gonad tissue is pale/translucent,
  not bright pink) and far less flesh-toned. Also recolored the Multivulva
  mutant phenotype bumps to match.
- Verified via the headless pipeline: rendered from 3 angles, confirmed
  0% hot-pink pixels in the output (previously a clearly visible pink
  internal structure), confirmed the geometry didn't break (sensible
  bounding boxes, no NaN/exploded mesh), and re-ran the full 14-image Deep
  Zoom regression suite since `buildWormModel()` is shared with that view.

### Added: move the model around in 3D (3D Anatomy tab)
Previously only orbit (drag) and zoom (scroll/pinch) were available.
Added pan: **right-click-drag** on desktop, **two-finger drag** on touch
— working alongside pinch-zoom in the same two-finger gesture, matching
standard touch-map conventions (pinch distance → zoom, midpoint movement
→ pan, simultaneously). Pan speed scales with current zoom distance so it
feels consistent whether zoomed in or out. Reset now also re-centers the
pan offset back to the model. Verified via the headless pipeline:
confirmed the orbit target actually moves on both right-drag and
two-finger-drag, and confirmed reset correctly zeroes it back out.

## v41 — July 30, 2026

### Added: right-side stage detail at each time-lapse pause
Now that Time-Lapse and Stage List are separate pages (v38) rather than
sharing screen space, it's safe to populate the shared right-side sidebar
from the time-lapse again — the scenario that caused the earlier "yanks
the sidebar away" bug (v37) can't happen anymore since only one page is
ever visible at once.

Populates the sidebar with the stage's full detail (matching what
clicking its card in the Stage List shows) at every actual pause:
auto-pause at a stage boundary, the ⏮/⏭ step buttons, and manually
pressing pause — but deliberately **not** continuously during playback,
which is what made it a problem before. Verified via the headless
pipeline: confirmed exactly one sidebar update per pause event (auto-pause,
step, manual pause), and confirmed zero updates while continuous-loop
playback runs uninterrupted through multiple stages.

## v40 — July 30, 2026

### Fixed: procedural microscopy images looked fake/flat
Confirmed via direct render + pixel analysis: the EM (electron microscopy)
images were the worst offender — almost no local pixel-to-pixel variation,
reading as flat gray vector shapes rather than a grainy micrograph. Real
EM images are essentially *built from* texture; there's no such thing as
a flat-filled region in a real one.

Rebuilt the shared `applyMicroscopyPostFX()` post-processing pipeline
(one function, used by every modality × every zoom tier × both organisms
— so this fix reaches the whole Imagery tab, not just the 4 top-level
images per organism):

- **Cached noise-tile texture** instead of sparse individual dots: a small
  noise/hatch tile is generated once ever (via `getImageData`/
  `putImageData`, real per-pixel randomness) and reused as a repeating
  `canvas` pattern on every subsequent image — far denser, more convincing
  grain than before, without paying a per-image pixel-generation cost.
- **EM** gets heavy, high-contrast stipple (two overlaid noise scales).
- **DIC** gets fine diagonal hatching at the same angle as its existing
  directional light/shadow sweep, approximating the characteristic
  shadow-cast microtexture real DIC optics produce.
- **Fluorescence (GFP/BODIPY)** gets background speckle/autofluorescence
  (scattered dim specks + rare bright out-of-focus flecks) plus light
  grain, since real fluorescence shots are never a clean black field
  around the signal.

**Real bug caught mid-implementation**: the first pass used `overlay`
blend mode for all the new texture, which measurably failed on EM
specifically — `overlay` is mathematically near-inert on very dark or
very light base pixels, and EM images are predominantly dark. Verified
this by isolating the blend on a solid dark swatch (13 unique colors with
`overlay` vs. 51 with `source-over` on identical noise) before switching
every texture pass to `source-over` and re-verifying.

**Verification method note**: initial "unique colors" pixel-counting
undersold the improvement for grayscale-heavy images like EM — added
noise stays within the same narrow gray range, so it doesn't add new
color buckets even though real grain is clearly present. Switched to
measuring local pixel-to-pixel brightness variance (actual grain/
roughness) instead, which is the metric that matters here: EM roughness
increased 30–49× (0.43→13.28, 0.27→13.30), DIC 15–21×, GFP/BODIPY 2–8×,
confirmed across all 8 top-level images for both organisms by rendering
before/after through the same headless `node-canvas` pipeline used for
the 3D validation work.

## v39 — July 30, 2026

### Verified: mitochondria (and full hotspot coverage generally) in Deep Zoom
Question from a screenshot: the orange capsule shapes in the Organelle
tier are mitochondria, and they were missing a hotspot. Checked the
current code and that gap is already closed — the Organelle tier's
`mitochondria` hotspot (5 capsules, real "did you know" fact about
mitochondrial DNA) is present and verified building correctly end-to-end
through the headless pipeline (parts-list row, on-model dot, click target
all confirmed).

Since that was a real gap worth catching, audited every other tier for
the same category of issue — a visible, distinct structure with no way to
select it — rather than stopping at the one spotted:

- **Cell tier**: nucleus, membrane, mitochondria, nucleolus, and (for the
  plant) chloroplast all confirmed present and hotspotted.
- **Nucleus tier**: envelope, nucleolus, and chromatin all confirmed
  hotspotted.
- **Chromosome, DNA tiers**: centromere/band and base-pair/backbone
  covered; repeated identical elements (the other 3 chromosome bands, the
  other 21 base pairs) intentionally share one representative hotspot
  each rather than getting 20+ near-duplicate labels — same reasoning as
  the Tissue tier's repeated cells, not an oversight.

If you're still seeing only 3 rows (Nucleus / ER / Golgi, no
Mitochondria) in the Organelle tier's list, that's this exact gap in the
v38 build you had — this fresh package should show all 4.

## v38 — July 29, 2026

### Changed: Time-Lapse and Stage List are now separate full-height pages
Previously stacked in the same view, sharing space, which capped the
time-lapse panel at a fixed ~260px regardless of screen size. Now they're
two full-height pages under the same Life Cycle tab, switched via a
pill toggle ("🎬 Time-Lapse" / "📋 Stage List") at the top — whichever is
active gets the entire available height, so the time-lapse model is
dramatically larger instead of being squeezed to a strip.

- Switching away from the time-lapse skips its actual GPU render call
  (canvas is `display:none` and invisible anyway) while keeping the
  animation loop and progress math alive underneath, so switching back is
  instant with no re-init delay and no lost playback position.
- Switching back to the time-lapse explicitly re-triggers a resize —
  hidden (`display:none`) elements report zero size, so the renderer needs
  to be told its real (now much larger) box size once it's visible again.
- Fixed a stray duplicate `id="tl-caption"` element left over from a
  previous edit (invalid HTML — `getElementById` was silently only ever
  reaching the first one; the second was dead markup).

### Improved: time-lapse plant now also reuses the real Anatomy model
Brought `tlBuildPlant()` in line with `tlBuildWorm()`, which already
reused `buildWormModel()` — the plant was still on the earlier simplified
tube-based geometry. Now calls the real `buildPlantModel()` for the same
textured, detailed geometry as Deep Zoom and the 3D Anatomy tab, with
leaves/flower/silique growth still animated via the same named-mesh-lookup
+ growth-profile system. Also named the stem mesh (`'stem'`) in
`buildPlantModel()` itself, matching the lookup-by-name convention already
used for its other parts, for reliable reuse by other views.

### Process note
Caught and fixed a stale test fixture during this work — my headless test
harness had been using a snapshot of `app.js` taken earlier in the
session, which was missing a mesh-naming fix (`bodyMesh.name = 'body'`)
added afterward. That mismatch briefly looked like a real bug (a "failed"
material lookup) before I traced it to the stale copy rather than the
actual shipped code. Regenerated the test snapshot from current source;
noting this here since it's exactly the kind of testing-methodology gap
worth being transparent about rather than glossing over. (Also: this
changelog has a small pre-existing duplicate-header artifact around v37
from that same session gap — left as-is rather than risk further edits to
reconcile old entries; it's documentation debris, not a code issue.)

## v37 — July 29, 2026

### Fixed: time-lapse was hijacking the shared stage-card sidebar
Root cause of "the top-right section changed to Larval Stage unexpectedly":
the time-lapse called the app's shared `selectLcStage()` on every stage
transition during playback, which overwrote whatever the person was
actually reading in the stage-card list's sidebar. The two areas are
supposed to be independent. Fixed: the time-lapse now has its own caption
directly under its canvas (stage name, duration, description) and no
longer touches the shared sidebar at all. Also added a safety min-height
to the stage-card section so it can't get visually squeezed out on
shorter viewports.

### Added: transparent/wireframe mode in Deep Zoom
Same feature as the 3D Anatomy tab's "◐" toggle — switches every mesh in
the currently-cached tiers to wireframe so internal structures are visible
through the surface, at any zoom level. Applies to all cached tiers (not
just the one on screen) and persists onto newly-built tiers as you keep
zooming, so toggling it on once carries through the whole dive instead of
resetting at each tier.

### Improved: Life Cycle time-lapse worm/plant no longer look plain
Compared to Deep Zoom's organism tier and the 3D Anatomy tab, the
time-lapse's own worm/plant models were still using the older flat,
textureless treatment. Upgraded to match: the shared detail/bump texture
on the worm body, pharynx, and plant stem; the same subsurface glow shell
used elsewhere; finer tube/capsule segment counts; and roughness/clearcoat
tuning on the gonad, vulva, egg cluster, leaves, flower, and silique pods.

### Verified
All three changes tested through the same headless pipeline as recent
work, this time loading `app.js` + `deepzoom.js` + `timelapse.js` together
(matching production load order) to confirm cross-file function sharing
works as intended: wireframe toggling correctly flips 8/8 test meshes on
and 0/8 back off, a freshly-built tier picks up the currently-active wire
mode automatically, and the time-lapse worm's body mesh confirmed carrying
both a texture map and a glow-shell child after building.

## v37 — July 29, 2026

### Fixed: time-lapse was hijacking the shared sidebar
Root cause of "the top-right section changed to Larval Stage": the
time-lapse was calling the app's shared `selectLcStage()` on every stage
transition, which overwrote the sidebar out from under anyone reading a
stage card in the list below — pressing play would yank their view away to
whatever stage the animation had reached. Fixed: the time-lapse now has
its own dedicated caption area (`#tl-caption`, under its own controls) and
no longer touches the shared sidebar at all. The two areas are fully
independent now, matching the "separate area... one of the original and
the new time-lapse" request.

### Fixed: original stage list could get squeezed out of view
The time-lapse panel had a fixed height that could leave too little room
for the original stage-card list below it on shorter viewports. Both
sections now split available vertical space with equal flex-grow shares
(each with a sensible minimum height) instead of one taking a fixed slice
and the other getting whatever's left over.

### Added: transparent/wireframe toggle in Deep Zoom
Same feature as the 3D Anatomy tab's shading toggle (the "◐" button) —
lets you see internal structures at any zoom tier by switching to
wireframe. Applies to every cached tier (not just the one currently
visible), so the mode persists as you continue zooming deeper, and newly-
built tiers pick up the current mode automatically. Verified end-to-end:
toggling on correctly set `wireframe = true` on 8/8 materials in a test
tier, and toggling off correctly cleared all of them back to 0/8.

### Confirmed: Life Cycle time-lapse worm/plant detail
The worm and plant models in the time-lapse already reuse the same detail
texture, bump mapping, and subsurface glow shell techniques proven out in
Deep Zoom (via `dzGetDetailTexture()`/`dzAddGlowShell()`, available since
`deepzoom.js` loads first) — confirmed this actually applies at runtime
(not just falls back) when loaded in the real production script order,
which an earlier isolated test of `timelapse.js` alone couldn't verify
(it correctly falls back to plain materials without `deepzoom.js` loaded,
by design, but that meant the enhanced path was untested until now).

## v36 — July 29, 2026

### Added: clear section separation + pause-at-each-stage for Life Cycle
Two changes to the Life Cycle tab:

- **Visually separated the two areas** with explicit section headers —
  "🎬 Time-Lapse Animation" above the 3D animation panel, "📋 Stage
  Details" above the original stage-card list — so it reads as two
  distinct areas in one tab rather than one panel blending into the other.
- **Auto-pauses at each stage boundary** by default (new "⏸ Pause each
  stage" toggle, on by default). Playback now advances through one stage's
  growth, automatically pauses right as it crosses into the next stage,
  and waits there until the person presses play again — rather than
  blowing through all 6 stages in one uninterrupted 22-second loop. Toggle
  it off for the old continuous-loop behavior. Verified via the headless
  pipeline: simulated 40 seconds of playback and confirmed it auto-paused
  at ~3.7s intervals (matching 22s ÷ 6 stages) landing on the correct
  stage each time, and confirmed toggling the mode off correctly resumes
  uninterrupted continuous looping through all stages.

## v35 — July 29, 2026

### Fixed: Life Cycle time-lapse looked stuck at the first stage
The playback logic itself was actually working correctly when tested in
isolation (verified: 30 simulated seconds of real playback correctly
cycled through all 6 stages and wrapped into a second loop). The real
problem was UX, not a broken loop: growth in the first few seconds (early
embryo/seed) is genuinely subtle frame-to-frame, so it read as frozen even
while technically advancing, and playback required first finding and
clicking a small ▶ button with no other way to move between stages.

- **Auto-starts playing** the first time the Life Cycle tab is opened, so
  motion is immediately visible without requiring a click.
- **Added explicit ⏮/⏭ step buttons** that jump straight to the next/
  previous stage's midpoint — an unambiguous, immediate way to move
  through stages regardless of how subtle the animated growth looks.

### Changed: Deep Zoom's Organism tier now reuses the real 3D Anatomy models
Previously a simplified stand-in (a bare tube for the worm, a few primitives
for the plant) with only 2 hardcoded hotspots. Now calls the same
`buildWormModel()` / `buildPlantModel()` functions the 3D Anatomy tab
itself uses — full cuticle/bump textures, physical-material clearcoat, the
subsurface glow shell, every real anatomical structure, and it reflects the
Anatomy tab's live mutant-toggle state since it reads the same shared flag.

- **Required a real (not cosmetic) refactor**: those functions wrote
  directly to `orgGroup`/`scene`, the 3D Anatomy tab's own shared globals —
  calling them as-is from Deep Zoom would have deleted whatever the Anatomy
  tab was currently displaying. Both functions now take an optional
  `targetGroup` parameter; called with no argument (every existing call
  site, unchanged) they behave exactly as before, and Deep Zoom passes its
  own isolated group instead.
- **Hotspots now come from the real data** (`hotspots3d` + `data[id].anatomy.desc`
  from the organism's JSON) instead of 2 hand-written stand-ins, with
  click-to-glow targets collected by mesh name (`buildWormModel` names
  several meshes identically, e.g. all 8 leaves are `'leaf'` — the glow
  now correctly lights up all of them together, not just the first match).
- **Fixed the same opacity-baseline bug class from v28.1**, now applied to
  these reused meshes: they weren't built through this file's own
  materials helper, so a one-time pass now captures each material's
  as-built opacity/emissive as its baseline right after construction, or
  the tier-blend fade would have silently forced them all fully opaque.
- Given the real model's larger native scale, this tier now carries its
  own "rest scale" (0.6×) rather than assuming every tier is built at the
  same natural size — otherwise it would have grown past the fixed camera
  during the tier's own zoom animation.
- **Verified end-to-end** through the same headless pipeline as recent
  changes, now loading a stripped (bootstrap-call-removed) copy of the
  real `app.js` alongside `deepzoom.js` so the actual shared functions run,
  not a reimplementation. Confirmed correct hotspot/mesh wiring, correct
  rest-scale framing, and non-blank rendered output. One honest limitation
  surfaced by this: the reused body material uses `MeshPhysicalMaterial`
  `transmission`, which needs WebGL2 — this sandbox's headless GL context
  only provides WebGL1, so that one material's shader failed to compile in
  this test specifically (logged, non-fatal, rest of the model rendered
  fine). Real browsers negotiate WebGL2 by default, so this shouldn't
  affect the deployed app, but it's the one piece I couldn't get a fully
  faithful pixel preview of from here.

## v34 — July 28, 2026

### Added: Life Cycle time-lapse animation
New panel at the top of the Life Cycle tab — a continuous, looping 3D
animation of the organism growing through its entire life cycle, synced to
the existing stage-card list below it (nothing there was removed or
restructured, just built on top of).

- **Growth approach**: every visual part (body, pharynx, gonad, vulva, egg
  cluster for the worm; stem, root, seed, 6 leaves, flower, silique pods for
  the plant) is built once per organism and cached, exactly like Deep
  Zoom's tier caching. Each part carries a small growth-profile function
  mapping continuous progress (0→1 across the whole life cycle) to a
  scale/opacity pair, re-evaluated every frame — nothing is rebuilt or
  swapped, so the growth reads as continuous rather than a slideshow.
  Worm size grows via uniform group scale; the plant grows non-uniformly
  (stem/root stretch vertically) so leaves and the flower don't inflate
  sideways as it gets taller.
- **Stage boundaries are evenly spaced** across progress (1/6 per stage)
  rather than parsed from the JSON's free-text `duration` fields (e.g.
  "2-6 weeks") — those are elapsed-time-since-germination windows, not
  per-stage lengths, and reliably parsing them into relative weights
  wasn't worth the fragility for an illustrative animation.
- **Playback controls**: play/pause, a 0.5×/1×/2× speed cycle, and a
  scrubbable timeline track with a stage-colored segment strip and a
  draggable playhead. Scrubbing pauses playback (matches standard video-
  player UX). One full loop takes 22 seconds at 1× speed.
- **Reuses, not duplicates, the existing stage UI**: as the animation
  crosses each stage boundary, it calls the tab's existing
  `selectLcStage()` function — the same one the stage cards already use —
  so the sidebar detail panel and the active/expanded card below stay in
  sync automatically, with zero new code paths to keep in sync by hand.
- Same demand-based render discipline as Deep Zoom: its own isolated
  renderer/scene/camera, only ever animating while the Life Cycle tab is
  the active view.
- **Verified end-to-end** the same way as the last several features: ran
  it through the real headless render pipeline, simulating actual
  timeline-scrub clicks through the real DOM event-listener code path (not
  a reimplementation), and confirmed monotonic, correctly-shaped growth in
  the rendered pixels for both organisms across their full stage range.

## v33 — July 28, 2026

### Confirmed: v31's realism pass measurably changed the render
Rendered the pre-v31 code (flat Lambert materials, perfect-sphere geometry)
side by side with current code using the same headless pipeline from v32,
same organism, same camera. Concrete pixel-level difference, not just
impression:

| Tier | Brightness range before → after | Unique colors before → after |
|---|---|---|
| Organism | 22.3 → 226.0 | 14 → 170 |
| Cell | 70.0 → 176.3 | 13 → 132 |

The old renders were nearly flat-shaded (a ~22-70 brightness range across
the whole visible object); the new ones have real specular highlights,
gloss, and organic shading gradients (~176-226 range). The old cell tier
in particular was a visibly uniform, nearly single-color blob — confirms
the PBR + organic-geometry work actually did what it was meant to do.

### Added: sidebar parts list for Deep Zoom
A calmer, uncluttered complement to the on-model hotspot dots (which stay,
per request) — a list in the sidebar naming every structure in the
*current* tier, so every part is named somewhere on screen even when only
2-3 dots are visible on the model at once. Clicking a list row calls the
exact same `dzSelectHotspot()` path as clicking its on-model dot — same
mesh glow, same fact shown, same active-state highlighting — so the two
are just two doors into the same thing rather than a separate feature to
maintain. The list rebuilds automatically as the dominant tier changes
while zooming, and again on organism switch.

## v32 — July 28, 2026

### Verified: Deep Zoom actually rendered and inspected end-to-end
Previously all review of this feature was static (reading code, hand-tracing
math). This time I built a real headless rendering pipeline: `headless-gl`
(software GL context via Mesa/llvmpipe under Xvfb) + `node-canvas` (for
`CanvasTexture` support) driving the project's *actual* bundled
`three.min.js` and the *actual* `deepzoom.js` — not a reimplementation. The
harness calls the real `initDeepZoom()`, `dzSetZoom()`, and `dzAnimate()`
functions exactly as the browser would, then reads back real pixels.
Rendered both organisms across all 7 tiers (14 images) with zero runtime
errors — confirms the PBR materials, organic geometry, glow shells,
opacity-based cross-fading, and mesh-targeted click highlighting all
actually execute correctly, not just pass a syntax check.

- **Fixed**: chromosome banding was cycling through 5 similar hues per
  segment, which read as slightly busy/confetti-like in the actual render
  rather than clean banding. Simplified to true 2-tone alternating light/dark
  colors, matching how real G-banding actually looks.
- **Known testing-environment caveats** (things that could look different
  in this headless render vs. a real browser, so take the render as strong
  but not perfect evidence): the headless GL context only negotiates WebGL
  1.0 (browsers typically get WebGL 2), and `node-canvas`-backed
  `CanvasTexture`s hit a "no color space conversion applied" warning
  internally — so exact texture gamma/color fidelity may differ slightly
  on real hardware. Geometry, camera framing, lighting coverage, and
  translucency/opacity behavior are not affected by either caveat and are
  now directly confirmed rather than inferred.

## v31 — July 28, 2026

### Improved: Deep Zoom materials/geometry made more realistic
Click-to-glow highlighting worked well, but the models themselves still
looked flat and geometric. This pass:

- **Switched every material from flat `MeshLambertMaterial` to
  `MeshPhysicalMaterial`** (roughness + clearcoat), so surfaces actually
  pick up specular highlights and a glossy sheen from the light rig instead
  of looking like matte flat-shaded plastic. Skipped `transmission` (real
  glass-like refraction) deliberately — it requires an extra render-target
  pass per transmissive material each frame, which is a real cost multiplied
  across however many translucent meshes are visible at once, and the look
  achievable without a proper environment map for it to refract wasn't
  worth that cost.
- **Organic (non-primitive) surface geometry**: added `dzOrganicGeometry()`,
  which displaces an icosahedron's vertices along their own normals with
  layered sine waves (cheap deterministic pseudo-noise, no library needed)
  so cell membranes, nuclei, nucleoli, and organelles read as lumpy/organic
  rather than obviously-a-sphere. Applied to every animal cell membrane,
  the single-cell tier's membrane and nucleus, the organelle tier's nucleus,
  and the nucleolus at every tier it appears. Left plant cell walls and the
  nuclear envelope as clean geometric shapes on purpose — plant walls
  really are angular, and the envelope needed to stay a true sphere for its
  pore positions (computed against an exact radius) to still land on the
  surface.
- **Glow shell**: added `dzAddGlowShell()`, a thin BackSide/low-opacity
  unlit shell just outside a mesh's surface — the same subsurface-
  scattering trick the Anatomy tab's worm uses for a "living tissue" sheen
  rather than flat plastic. Cheap: `MeshBasicMaterial` skips all lighting
  math entirely. Applied to the worm body, plant stem, the single-cell
  membrane, and the nuclear envelope.
- **Bump mapping**: the shared detail texture now doubles as a `bumpMap`
  (not just a color multiply) on the worm body/pharynx and plant stem, for
  actual surface relief under the light rig instead of a flat color pattern.
- **Light rig retuned** (~25-40% brighter across the board) to compensate —
  PBR materials read measurably darker than the old flat Lambert shading at
  the same light intensities.

## v30 — July 28, 2026

### Added: click-to-glow hotspot highlighting in Deep Zoom
Brought the 3D Anatomy tab's `highlight3dStructure()` behavior into Deep
Zoom — tapping a hotspot now makes the actual structure glow (emissive
boost), not just update the sidebar text. Every hotspot across all 7 tiers
now carries a real reference to the mesh(es) it represents (previously only
a label position existed), so e.g. tapping "Nucleolus" glows the nucleolus
mesh itself, tapping "Golgi apparatus" glows all 5 of its torus arcs, tapping
"Chromosome band" glows that whole banded arm. Each material remembers its
own authored baseline emissive so deselecting restores it exactly (matters
for meshes that already had a subtle glow before being selected, e.g. the
nucleolus or DNA base pairs).

### Added: shared procedural detail texture
Not the Anatomy tab's full cuticle+bump `MeshPhysicalMaterial` treatment —
that's real per-organism texture work, too costly to repeat across 7
simultaneously-cached deep zoom tiers — but one small mottled/speckle
canvas texture, built once and cloned cheaply wherever a big flat surface
needed to stop reading as a solid color swatch (worm body, pharynx, plant
stem). Cloned per-material rather than shared directly, since mutating a
single shared texture's `.repeat` would have re-tiled every mesh using it.

## v28.1 — July 27, 2026

### Fixed: Deep Zoom tiers looked flat/opaque and had a dark back side
Two real bugs found from screenshots, not just polish requests:

- **Opacity bug:** `dzSetGroupOpacity()` was overwriting every material's
  opacity to a flat `1.0` whenever a tier was fully settled (not mid
  cross-fade). Several tiers were *designed* translucent on purpose — the
  nuclear envelope, cell membrane, single-cell membrane — specifically so
  you could see the nucleolus/chromatin/organelles glowing inside. The bug
  silently made all of those fully opaque, hiding the internal detail
  entirely (this is why the Nucleus and Cell tiers looked like plain solid
  balls). Fixed: materials now store their authored `baseOpacity`, and
  tier-blend fading multiplies against that instead of replacing it.
- **Lighting:** replaced the single key light + ambient with a 4-direction
  light rig (opposing front/back, up/down pairs) + a stronger ambient floor,
  so no orbit angle ever lands on a fully dark/black face.

### Improved: geometry detail
- Tissue/cell membranes switched from low-subdivision flat-shaded
  icosahedrons to smooth, higher-subdivision spheres.
- Chromosome arms rebuilt as alternating light/dark banded segments (real
  visible G-banding contrast) instead of thin same-hue embossed rings that
  were nearly invisible.
- Added subtle emissive tinting to nucleoli, chromatin, mitochondria, ER,
  Golgi, and DNA base-pair rungs so colored detail reads clearly under the
  new even lighting instead of looking washed out.

## v28 — July 26, 2026

### Added: "Deep Zoom" — a new tab, unified 3D continuous zoom
New view/tab alongside 3D Anatomy, Microscopy & Imagery, Life Cycle, and
Experimental Workflows. The 3D model itself is now the thing you zoom
through, continuously, from whole organism down to a real 3D DNA double
helix: **organism → tissue → cell → organelle → nucleus → chromosome → DNA**.

- Real `THREE.Geometry`/meshes at every tier (tube/box/icosahedron/torus/
  capsule/cylinder), not flat canvas art — including an actual 3D double
  helix built from two intertwined `TubeGeometry` backbones with colored
  base-pair rungs, and an X-shaped 3D chromosome with banded chromatid arms.
- Continuous LOD: the camera stays fixed; each tier's group grows smoothly
  within its own zoom band, and near each tier boundary the outgoing and
  incoming tiers' geometry cross-fade and co-grow simultaneously, so
  crossing a threshold reads as one continuous "dive" rather than a swap.
- Hotspots at every tier (not just top-level anatomy), each pinned to real
  mesh-space 3D coordinates and projected to screen every frame, matching
  the existing 3D Anatomy hotspot pattern rather than 2D screen coordinates.
  All hotspot DOM elements are built once per organism and just shown/hidden
  per active tier, to avoid the aspect-ratio/DOM-rebuild bugs the 2D zoom
  system hit.
- Reuses the "did you know" facts from the 2D imagery zoom's `TIER_HOTSPOTS`
  content, now anchored to 3D geometry instead of 2D image regions.
- Own isolated WebGL renderer/scene/camera + demand-based ~30fps-capped
  render loop that only runs while this tab is active (same CPU discipline
  as the 3D Anatomy tab: Lambert-only materials, no textures, capped pixel
  ratio, low light count) — verified not to touch the existing 3D Anatomy
  or Microscopy & Imagery code paths at all.
- **Not yet done / worth knowing:** camera is fixed-radius orbit only (no
  dolly); brand-new custom-added organisms fall back to the animal/worm
  tissue+cell geometry since only worm/plant variants exist so far; this
  was built and syntax/logic-reviewed in a sandbox with no real GPU, so —
  per the lesson learned from the 3D Anatomy view — please test on the
  actual VIBE Board early, especially the tier cross-fade at various
  aspect ratios and real-device frame timing during the blend windows.

## v27 — July 23, 2026

### Fixed: "Nuclear envelope" hotspot landing on blank space
Root cause: the Nucleus tier's nucleus circle is sized as `radius =
min(width, height) * 0.46` — using the *smaller* of the canvas's two
dimensions, a deliberate choice so the circle always fits on screen regardless
of aspect ratio. But my hotspot's *x position* was stored as a fixed fraction
of *width alone*. Those two don't move together: on a wide display, the
canvas's width grows much faster than its height, so the nucleus (bounded by
the smaller dimension) shrinks relative to the full width — meaning a fixed
x-fraction that worked on my test browser's window shape could land well past
the actual edge of the nucleus on a wider screen. This is exactly the class of
bug the v24 "Nuclear envelope"/"Cell membrane" edge-position fix addressed for
staying on-screen during zoom, but I hadn't considered the same math also
depends on the viewer's aspect ratio, not just the zoom level.

Computed the actual worst-case nucleus edge position across a range of
realistic aspect ratios (from a very wide board display down to a near-square
window) and picked a position + size that reliably lands inside the nucleus
across that whole range, rather than a position tuned to one specific window
shape.

**Verified properly this time — across 5 different realistic viewport aspect
ratios** (2.9:1 down to 1.33:1 canvas ratio), not just the one shape my dev
browser happened to use, sampling the actual pixel color under the hotspot
and checking it against the modality's real background gradient colors (not
just "is it pure black") to catch cases where the hotspot lands on generic
background rather than real structure. All 5 realistic ratios now pass; only
a deliberately extreme, physically-implausible 8.8:1 ratio (which would break
plenty of other UI too) still fails.

### Also audited the rest of TIER_HOTSPOTS for the same class of bug
Went through every hotspot position that depends on `min(w,h)`-based drawing
formulas (Nucleolus in the Nucleus tier, Nucleus in the Cell tier for the
plant) and computed their aspect-ratio sensitivity the same way. Both have
small enough multipliers in the underlying formula that their existing
tolerance already covers the realistic range — no changes needed there, but
now confirmed rather than assumed.

### Verified
- Full black-space regression re-run: 0 misses / 125 samples, unchanged from
  v26 (confirms this fix didn't disturb anything already working).
- Pinch-to-zoom (v26) reconfirmed still working.
## v26 — July 23, 2026

### New: two-finger pinch-to-zoom for the imagery viewer
Found via real device testing: the imagery viewer only supported single-finger
pan via touch — there was no pinch-zoom handling at all (the touch handlers
explicitly checked `e.touches.length === 1` and did nothing for 2+ fingers).
Only the +/- buttons worked for zooming on a touchscreen. Added proper
two-finger pinch support, mirroring the pattern already working in the 3D
view: tracks the distance between two touch points, scales `imgZoomLevel` by
the change in that distance each frame, and also lets the pinch midpoint pan
the view (so a natural two-finger drag-while-pinching gesture pans and zooms
together, not just zooms from a fixed point). Handles the transition between
2-finger pinch and 1-finger pan cleanly in both directions — lifting one
finger mid-pinch resumes single-finger panning from that finger's current
position instead of jumping.

Verified with synthetic multi-touch events: pinch-out (fingers spreading)
zooms in (1x → 10x), pinch-in zooms back out, and the 2-finger→1-finger
transition changes pan smoothly with no jump or crash.

### Fixed: Intestine hotspot floating over blank space
Root cause: the JSON region data for "Intestine" (and its GFP-modality
counterpart "elt-2::GFP") had `y: 0.38`, but the actual gut structure in the
procedural art is drawn centered at `y: 0.5` (verified independently by reading
the real ellipse-drawing coordinates in three separate modality functions —
DIC, GFP, and EM's worm-rendering code all agree). The elongated glow shape
added in v24 made this ~12%-of-height mismatch obvious for the first time
(previously it was just a small circle, so the miss was less visually jarring).

Corrected the position of all three DIC hotspots plus their GFP counterparts
using the actual drawing geometry rather than approximation: Pharynx, Intestine,
and Vulva now all land precisely on their real structures. Verified by
sampling the pixel color at the exact center of each glow after clicking it —
all three now match their structure's real fill color almost exactly (e.g.
Intestine samples ~(208,164,118), matching the gut gradient's `#c89a6a`–`#d8aa7a`
range; Vulva samples (226,152,212), matching its `#e898d8` fill almost exactly).

### Fixed: rick-roll video link
Found a `video` field on the C. elegans GFP imagery entry pointing to
`youtube.com/embed/dQw4w9WgXcQ` — the "Never Gonna Give You Up" video, clearly
placeholder/joke content left in by a prior session. Set back to `null`,
matching what the README already (incorrectly) claimed: "none of the current
entries have a real video attached."

### Verified
- Full black-space regression re-run after the position fix: 0 misses out of
  125 samples across all modalities/tiers/organisms (unchanged from v25 --
  confirms this fix didn't disturb the earlier one).
- Full imagery matrix (2 organisms × 4 modalities × 4 zoom levels) with zero
  console/page errors.
## v25 — July 21, 2026

### Removed: ambient motion
Per real-device testing feedback: it lagged, and the plant's whole-group sway
didn't read as organic movement anyway (rotating the entire rigid group rather
than individual leaves/stem looks more like the whole plant tipping over than
swaying in a breeze). Disabled via `AMBIENT_MOTION_ENABLED = false` — the
render loop goes back to true 0%-when-idle, matching v20's CPU behavior.

### Fixed: hotspot buttons landing on black/empty space
Two separate, unrelated bugs were both contributing to this:

**1. Randomized structure positions in Tissue/Cell tiers.** The Tissue tier's
grid cells are jittered ±15% of cell size for visual variety, and each cell's
nucleus only had an 85% chance of being drawn at all — so a hotspot anchored
at a fixed coordinate could miss the actual (randomly-shifted, sometimes
entirely absent) structure on any given render. Fixed by making the *specific*
cell each hotspot targets fully deterministic (zero jitter, guaranteed
nucleus), while every other cell in the grid keeps its randomization for
visual variety. Verified by clearing the image cache and re-rendering 15 times
per tier/organism, sampling the exact pixel under each hotspot each time: 0
background-hits out of 120 samples (previously would have missed
unpredictably depending on the random seed).

**2. A rendering bug from v22's realism pass, unrelated to hotspot positions
at all.** The CSS `contrast()` filter used for per-modality color grading
mathematically crushes near-black pixels to literal `(0,0,0)` — verified with
the actual filter math: `contrast(1.18)` (EM's setting) crushes anything under
~19.5/255 straight to pure black. EM's background colors are `#141414`/`#0e0e0e`
(values 14–20), so nearly the *entire* EM background was being wiped into a
flat black void, independent of any hotspot — this affected the visual quality
of EM images broadly, not just hotspot accuracy. GFP and BODIPY have similarly
dark backgrounds and were partially affected too, just less severely (their
lower contrast values kept just enough headroom). Fixed by dropping
`contrast()` from all four modalities' grading filters, keeping only
brightness/saturate (which don't have this clamping behavior — brightness is
a simple multiply, no hard floor). The per-structure color contrast was
already baked into the hand-picked palette anyway, so the filter wasn't adding
real value, just breaking dark backgrounds.

Combined fix verified with a full matrix sweep: 2 organisms × 4 modalities ×
6 zoom tiers × cache-cleared re-render × pixel-sample every hotspot = 624
samples, **0 background-hits** (down from 54 before the fix, concentrated
entirely in EM).

### Verified
- Confirmed ambient motion is fully off (orgGroup transform unchanged over time).
- Re-confirmed touch-drag-after-idle (the v18/v23 fix) still works, checking
  actual camera position this time rather than the ambient-motion-only
  `orgGroup.rotation` value a first pass mistakenly reused from the ambient
  motion check just above it.
- Mutant toggle and shape-matched glow (v24) reconfirmed working.
## v24 — July 21, 2026

### New: shape-matched glow (2D imagery now highlights like the 3D view)
Previously the imagery glow was always a plain circle, regardless of what
structure was clicked — unlike the 3D view, where clicking a hotspot makes the
*actual mesh* glow (so the pharynx-shaped mesh lights up in its real shape, not
a generic marker). The 2D glow now works the same way: every hotspot carries
real shape data (`rx`, `ry`, `rot` — an ellipse radius and rotation in fractions
of the image size) matching the actual proportions of that structure as drawn,
instead of a uniform circle.

Examples measured directly from the running app: Pharynx renders as a
moderately elongated oval (3.3:1 width:height ratio), Intestine as a long
stretched oval (5.2:1, matching how far the gut actually spans the body), and
Vulva as a small, only mildly elongated shape (2.2:1) — three visibly distinct
shapes instead of three identical circles.

Shape data comes from two places:
- **Organism-tier hotspots** (JSON `regions`): dimensions approximated from the
  actual procedural drawing code for each structure (e.g. the pharynx ellipse's
  real radii in `OrganismTierArt.dic()`).
- **Deep-tier hotspots** (TIER_HOTSPOTS, added in v23): dimensions taken
  directly from the exact formulas already used to draw those structures (e.g.
  the nucleolus's real radius in `drawNucleusShape()`), since that code is
  original to this project.

The glow itself is now three concentric shapes — a soft Gaussian-blurred halo,
a filled body, and a pulsing outline — giving it a genuine glow quality closer
to the 3D view's emissive highlighting, rather than a flat marker sitting on
top of the image.

### Fixed while implementing this: two deep-tier hotspots could drift off-screen
Found via automated testing, not by inspection: "Nuclear envelope" (nucleus
tier, x=0.90) and "Cell membrane" (cell tier, x=0.10) were positioned close
enough to the frame edge that they could scroll off-screen as the *local*
per-tier zoom grows toward the top of that tier's zoom band (each tier scales
locally within its own range, established in v20 so deeper content doesn't
inherit a huge accumulated zoom number). This was invisible before because
these are new in v23. Pulled both inward to a safe margin; verified
systematically (not just by re-testing the same two) by computing worst-case
on-screen position for every one of the ~30 hotspot entries against its tier's
actual maximum local-zoom ratio.

### Verified
- 125 hotspot clicks across the full matrix (2 organisms × 4 modalities × 7
  tiers, every hotspot at every tier) — zero failures, zero console/page errors.
- Confirmed three different structures produce three genuinely different
  ellipse shapes (not silently defaulting to a circle).
- Re-confirmed the v23 glow-position-alignment fix and A-then-B glow-snap fix
  both still hold with the new shape system, at both the organism tier and
  deep tiers.
- Note on test methodology: an earlier test run showed ~40 "failures", which
  traced back entirely to the test script itself (not waiting for the
  organism-tier zoom-to-hotspot animation to settle before forcing a new zoom
  level, and reusing a stale hotspot count across zoom levels) — worth noting
  since it's a good example of why a failing test needs to be root-caused
  before treating it as evidence of an app bug.
## v23 — July 20, 2026

### Fixed: glow not snapping to the second hotspot clicked
**Root cause:** a race condition in the pulse-animation cleanup. When hotspot A's
glow is showing and you click hotspot B, `drawStructureHighlight()` correctly
swaps the global glow tracking (`currentImgGlowSVG`/`currentImgGlowHotspot`) over
to B — but hotspot A's *old* pulse animation loop was still scheduled for one more
frame. When it ran, it saw it was no longer the active hotspot and unconditionally
nulled out those globals — even though they'd already been reassigned to B.
Every future position update (`updateGlowPosition()`) then silently no-opped,
because it early-returns whenever those globals are null. B's glow kept
*pulsing* in place (its own loop was unaffected) but never moved again, frozen
wherever it was first drawn.

**Fix:** the stale cleanup now only clears the globals if they still point at
its own SVG element (`if(currentImgGlowSVG === svg)`), not unconditionally.
**Verified two ways:** (1) reverted the fix in an isolated copy and confirmed
the same test now measures the glow **1030px off** from the real hotspot
position — proving the test actually catches the regression, not just
rubber-stamping; (2) the fixed version measures **0.0px** offset in the same
scenario, both at the organism tier and at every deep zoom tier.

### New: hotspots at every zoom tier
Previously hotspots only existed in the outermost "Organism" tier — deeper tiers
(Tissue → DNA) had no clickable regions at all. Every tier now has 2–3 hotspots,
positioned at the actual deterministic (non-randomized) structure coordinates in
each tier's drawing code, so they reliably land on real visible structures:
Nucleus, Cell membrane/wall, Endoplasmic reticulum, Golgi apparatus, Nuclear
envelope, Nucleolus, Centromere, Base pair, Sugar-phosphate backbone — varying
slightly by organism (plant cells get "Cell wall", animal cells get "Cell
membrane", etc).

**While wiring this up, found and fixed a second, deeper bug it exposed:** the
hotspot layer's CSS transform was always scaling by the raw, large accumulated
`imgZoomLevel` (e.g. 12x, 28x...), while the canvas image itself scales by a much
smaller *tier-relative* zoom for anything past the Organism tier (established in
v20, so each tier enters the screen at a readable size instead of inheriting a
huge accumulated number). This mismatch was invisible before because deep-tier
hotspots were always hidden — nothing to notice being misaligned. The moment
they became visible, clicking one threw `element is outside of the viewport`
errors, since hotspots were scaling ~6x more than the image underneath them.
Fixed by using the same tier-relative scale for the hotspot layer transform and
the glow position math (`getEffectiveDrawZoom()`), matching what the canvas
already does. Verified sub-pixel glow/hotspot alignment (<0.02px) at organelle,
chromosome, and DNA tiers specifically, not just the organism tier.

### New: fun facts
Clicking a hotspot at any tier beyond Organism shows a "did you know" style fact
in the sidebar instead of dry textbook description — e.g. "There are only 4
letters in the DNA alphabet — A, T, G, and C — yet their ordering across ~3
billion positions in the human genome is enough to spell out an entire person."
Organism-tier hotspots are unchanged (still show the full technique/description/
tags/video panel from the real JSON data).

### Verified
- Full regression: 2 organisms × 4 modalities × 7 zoom tiers × hotspot click at
  every tier = zero console/page errors.
- Tier-crossing cleanup confirmed: switching tiers with an active glow correctly
  removes the old one and rebuilds the new tier's hotspot set (no leftover DOM).
- Ambient motion, mutant toggle, and touch-drag-freeze fix all reconfirmed
  working alongside the new hotspot system.
## v22 — July 19, 2026

### New: more realistic procedural microscopy imagery
Applied a uniform "shot through a real microscope" post-processing pass across
every modality × tier × organism combination, plus more organic (less
perfectly-geometric) cell and nucleus shapes:

- **Per-modality color/contrast grading** — EM gets punchier contrast and
  slightly desaturated grayscale; DIC gets a subtle contrast lift; GFP and
  BODIPY get a small saturation boost to make fluorescence read as brighter.
- **Fluorescence bloom** — GFP and BODIPY images now get a soft glow around
  bright structures, approximating the point-spread-function halo real
  fluorescence microscopy shows around emitting structures.
- **DIC pseudo-relief sweep** — a soft diagonal light/shadow overlay
  approximating the characteristic embossed, pseudo-3D look of differential
  interference contrast optics (a full normal-map emboss isn't cheap in 2D
  canvas; this approximates the same visual read far more cheaply).
- **Vignette** — every image now darkens slightly toward the edges, like a
  real microscope's field of view. Verified via pixel sampling: corners
  measurably darker than center across all 4 modalities.
- **Film grain** — sparse, subtle noise instead of the previous flat/clean
  digital look. Deliberately implemented as sparse dot-scatter rather than
  true per-pixel noise (`getImageData`/`putImageData`), which would be far
  more expensive for a purely cosmetic effect.
- **Organic cell/nucleus shapes** — animal cell membranes and nuclear
  envelopes are now wobbly, irregular blobs instead of perfect
  ellipses (real cells are never geometrically perfect). Plant cells
  deliberately keep their rectangular walls — rigid cellulose walls really
  do look geometric, so that was already correct.

All of this is applied at a single choke point (`dispatchProceduralTier` →
`applyMicroscopyPostFX`) rather than duplicated across each of the 6 tier ×
4 modality drawing functions, so it's consistent everywhere automatically.

**Performance:** measured cold-generation time (cache miss, worst case) per
tier: 5–24ms depending on tier complexity, even in this sandbox's software
rendering. Completely imperceptible during actual use, and every combination
is cached after first generation anyway (per modality/tier/organism/size, as
established in v20).

**Verified:** full regression — 2 organisms × 4 modalities × 7 zoom tiers —
zero console/page errors. Vignette confirmed present via corner-vs-center
pixel brightness comparison on all 4 modalities. Contrast/brightness
statistics confirmed distinct per-modality grading is actually being applied
(e.g. EM measurably darker/higher-contrast than DIC, as intended).
## v21 — July 19, 2026

### New: ambient idle motion
The 3D model no longer sits frozen when nobody's touching it:
- **C. elegans**: gentle idle drift/bob, plus a subtle pharynx pump-pulse (real
  pharynx pumping is one of the most recognizable C. elegans behaviors, ~200
  pumps/min in life — slowed way down here for a readable idle effect).
- **Arabidopsis**: gentle multi-axis sway, like a light breeze.

**Design trade-off, stated honestly:** the CPU work in v19 made the 3D view
render *zero* times per second when fully idle. Ambient motion necessarily
gives some of that back — idle now renders at a throttled ~5fps instead of 0fps.
This is a deliberate choice given the "fun and alive" goal, not an oversight.
Verified the throttle itself works correctly (measured ~7.5fps against an 8fps
target before we lowered it to 5fps). The *absolute* CPU cost of that 5fps
couldn't be honestly measured here — this sandbox has no real GPU, so every
render costs ~100ms of software rasterization regardless of scene complexity,
which would inflate any number reported from here into a misleading scare
figure. On real hardware, where a frame this size should cost low
single-digit milliseconds, 5fps of idle motion should be cheap. If it turns
out not to be on your actual VIBE Board hardware, flip `AMBIENT_MOTION_ENABLED`
to `false` near the top of the render loop in `app.js` — one constant, no
other changes needed.

### New: mutant vs. wild-type comparison
A toggle switch in the 3D Anatomy view (bottom-left) swaps in a real, notable
mutant phenotype for the current organism:

- **C. elegans — Multivulva (Muv)**: a hyperactive *let-60/Ras* mutation causes
  extra vulva-like protrusions to form along the body instead of one. One of
  the most famous phenotypes in developmental genetics — and the same Ras
  signaling pathway targeted by many cancer drugs, which is why this one was
  picked over other options: it's a genuine bridge to why a medical company
  would care.
- **Arabidopsis — short-root (shr)**: loss of the SHORT-ROOT transcription
  factor collapses the root's internal cell-layer pattern, producing a short,
  thick stub instead of the long, elaborately branched wild-type root.

An info banner explains the gene and phenotype whenever mutant view is active.
Hotspot clicking, highlighting, and the info sidebar all continue to work
normally in mutant view. Toggling is a full, clean model rebuild (reusing the
existing `clearOrgGroup()`/`buildWormModel()`/`buildPlantModel()` pipeline —
no risk of leftover geometry or memory leaks between toggles).

This is intentionally scoped to two well-implemented, scientifically real
examples rather than a shallow toggle across every structure — the pattern
(add a `MUTANT_INFO` entry + a conditional branch in the relevant
`build___Model()` function) is there to extend to more later.

### Verified
- Ambient motion confirmed actually changing model rotation/position over
  time (not a no-op).
- Mutant toggle confirmed: adds/removes geometry cleanly (3 Muv bumps
  created on toggle-on, 0 remaining after toggle-off), banner text and toggle
  label update correctly per organism, hotspot interaction unaffected.
- Full regression across both organisms × mutant toggle × all 4 imagery
  modalities × all 7 zoom tiers × zoom buttons × touch-drag: zero console/page
  errors.
## v20 — July 18, 2026

### New: multi-scale zoom (organism → tissue → cell → organelle → nucleus → chromosome → DNA)

The microscopy imagery viewer now has 7 zoom tiers instead of one fixed image
that just scales up:

| Tier | Zoom range | What you see |
|---|---|---|
| Organism | 0.5x – 3.2x | The existing whole-organism art (unchanged), hotspots active |
| Tissue | 3.2x – 6x | A mosaic of individual cells with visible walls/membranes and nuclei |
| Cell | 6x – 10x | 3-4 large individual cells: nucleus, mitochondria, (plant: vacuole + chloroplasts) |
| Organelle | 10x – 16x | Inside one cell: nucleus with pores, mitochondria with cristae, ER, Golgi, ribosomes |
| Nucleus | 16x – 24x | Nuclear envelope, nucleolus, chromatin threads, condensing chromosomes |
| Chromosome | 24x – 34x | A single metaphase chromosome: sister chromatids, centromere, banding |
| DNA | 34x – 50x | The double helix, base-pair rungs colored A/T/G/C |

Each of the 4 microscopy modalities (DIC, GFP/Confocal, BODIPY/Widefield, EM/TEM)
renders every tier in its own distinct palette (e.g. GFP tiers glow green around
fluorescently-tagged structures, BODIPY tiers show yellow lipid droplets, EM tiers
are grayscale ultrastructure) — verified these are genuinely different renders per
modality (30-96% of pixels differ pairwise at the same tier), not just recolored
copies. Plant vs. animal cells also diverge from the cell tier onward (chloroplasts,
cell wall, central vacuole for the plant).

**How it's built:** the zoom badge shows the tier name once you're past the
organism view (e.g. "Cell · 700%"). Within the organism tier, the canvas scales
1:1 with the same zoom value the hotspot layer uses, so the existing hotspot/glow
alignment fix stays exact. Past that tier, hotspots don't correspond to specific
screen regions anymore (there's no per-organelle click data), so they fade out
smoothly and stop intercepting clicks/drags -- and reappear automatically if you
zoom back out below 3.2x. Clicking a hotspot still zooms to 3x as before, which
stays inside the organism tier on purpose, so the hotspot you just clicked doesn't
vanish out from under you.

**Also fixed while building this:** the procedural-image cache key didn't include
which organism was selected, so switching organisms while on the same modality
could occasionally show cached art from the previous organism. Cache key now
includes organism + zoom tier.

**Housekeeping:** removed ~235 lines of dead, disconnected code (`ProceduralImagesZoomed`
and `imgZoomInfo`/`updateZoomInfo`) that were an earlier, incomplete attempt at this
same feature — defined but never actually called from anywhere, and even if it had
been wired up, the image cache key didn't include zoom level, so it would have kept
serving the first tier's bitmap forever regardless of zoom.

### Fixed: zoom +/-/Reset buttons were unclickable
Found while re-testing after resuming this work: the hotspot layer is a
full-viewer-sized transparent div. `buildImgHotspots()` correctly grants
`pointer-events` only to the small individual hotspot circles within it (so
clicks pass through everywhere else) — but the tier-visibility code above was
setting the *entire layer* to `pointer-events: auto` whenever hotspots should
be visible, which made that full-screen div intercept clicks anywhere on top
of it, including the +/-/Reset buttons in the corner (mouse-wheel zoom still
worked, since wheel events bubble to the outer container regardless of exact
target — only direct button clicks were affected). Fixed by keeping the layer
itself at `pointer-events: none` always, and toggling only the individual
hotspot circles' `pointer-events` based on tier instead. Verified: 30/30 button
clicks now succeed in sequence (previously failed after the 1st click).

### Verified
- All 7 tiers produce genuinely distinct rendered output (confirmed via pixel-diff
  and targeted color-presence checks, not just visual spot-checking)
- DNA tier confirmed to contain all 4 base-pair colors in meaningful quantity
- Plant-specific chloroplast content confirmed present at cell + organelle tiers
- Hotspot layer correctly shows/hides/re-shows across the tier boundary, in both
  directions, including via the existing click-to-zoom path
- Full regression pass (3D tab, all 4 modalities x hotspot-click x deep-zoom-to-50x
  x reset, lifecycle, workflow, organism switching): zero console/page errors

### Still open
- Realism pass on the procedural art now that the zoom mechanics work
## v19 — July 18, 2026

### Fixed: imagery hotspot / glow / zoom-target misalignment
**Root cause:** `zoomToHotspot()`, `drawStructureHighlight()`, and `updateGlowPosition()`
all computed positions using `mc.width`/`mc.height` — the canvas's **device-pixel**
backing-store size (`CSS size × devicePixelRatio`). But `imgPanX`/`imgPanY` are tracked
in **CSS pixels** (from raw mouse/touch drag deltas), and the hotspot layer's CSS
`transform` also expects CSS pixels. On any screen with `devicePixelRatio !== 1`
(virtually all touch panels, including the VIBE Board S1), that unit mismatch meant:
- Clicking a hotspot zoomed to the wrong location (target pan computed in device px,
  applied in CSS-px context)
- The pulsing highlight glow and the hotspot button itself ended up in different
  spots (each doing its own inconsistent unit math)
- The glow SVG's `width`/`height` attributes were also set from device-pixel canvas
  size, making the whole SVG render 1.5–2x too large for its container

**Fix:** introduced a single `getImgLogicalSize()` helper returning the canvas's
CSS-pixel (logical) size, and made every hotspot/glow/zoom calculation use it
consistently. Verified with an automated test at `devicePixelRatio=2`: hotspot button
and glow circle now align to **0.0px** offset, and a clicked hotspot lands exactly
centered in the viewer after the zoom animation (0.0px offset from viewer center).

### Optimized: 3D view CPU usage
Several changes, in order of expected real-world impact:
- **Pixel ratio capped at 1x** (was 1.5x) — removes ~55% of per-pixel shading work;
  the sharpness gain from 1.5x is barely visible on a kiosk display viewed from a
  few feet away.
- **Switched `MeshStandardMaterial` → `MeshLambertMaterial`** on all organ meshes.
  Standard material computes full PBR (Cook-Torrance) lighting per pixel per light;
  Lambert is a much cheaper diffuse-only model. Visually near-identical for this
  flat, stylized art style.
- **Dropped the 3rd ("rim") light**, down to key + fill + ambient. Every light is a
  full extra shading pass across the scene; Lambert has no specular term to show off
  the extra light anyway.
- **Reduced mesh tessellation** — main worm body cut from 240×32 to 130×16 segments
  (~73% fewer triangles), with proportional cuts across intestine, gonad, root, stem,
  leaf, and vulva/meristem geometry.
- **Frame-rate cap at ~30fps** for the render loop during drag/auto-rotate/momentum.
  Camera/orbit state still updates on every raw input event, so dragging stays
  responsive — only the actual `renderer.render()` draw call rate is throttled.
- **Removed a forced-layout call on every single frame** — `updateHotspotScreenPositions()`
  was calling `getBoundingClientRect()` (forces synchronous layout) 60 times/sec; now
  the rect is cached and only recomputed on resize.

**Measured impact** (headless software-rendering test harness, since this sandbox has
no real GPU — SwiftShader/CPU rasterization, so absolute numbers won't match real
hardware, but the relative delta is real and was verified, not estimated):
sustained drag interaction went from **4.96 fps (201.7ms/frame) to 6.49 fps
(154.0ms/frame)** — about **24% faster per frame** for the same CPU budget. Real
hardware with actual GPU acceleration typically shows a *larger* relative gain from
these specific changes (cheaper shading, fewer lights) than a CPU-bound software
fallback does, since a GPU parallelizes exactly that kind of per-pixel/per-light work.

### Still open (large scope, tracked separately)
- More photorealistic procedural microscopy imagery
- Multi-scale zoom progression (organism → tissue → cell → organelle → chromosome/DNA)
# Changelog

## v18 — July 17, 2026
**Target device:** VIBE Board S1 (touchscreen kiosk)

### Fixed
- **3D model froze after CPU-usage optimization.** The demand-based render
  loop (introduced to cut idle CPU usage) stopped `requestAnimationFrame`
  entirely when nothing was happening, and relied on a single one-shot
  `setTimeout` to notice if the user started dragging again. If a drag began
  after that ~100ms window, the loop never restarted and the model appeared
  frozen until a full page refresh. Replaced with an `ensure3DAnimating()`
  wake-up called directly from every interaction entry point (mousedown,
  mousemove-while-dragging, touchstart, touchmove, wheel, and the
  reset/zoom/wireframe toolbar buttons), so the loop reliably restarts
  itself while still going back to sleep when idle.

### Touch-hardening for VIBE Board S1
- `html, body` now set `touch-action: none`, `overscroll-behavior: none`,
  and disable tap-highlight/text-selection, so the OS/browser's own
  pinch-zoom, pull-to-refresh, and text-selection gestures can't fight the
  app's custom pan/zoom/orbit handling on a touchscreen.
- `.img-viewer` / `.img-canvas` (the microscopy image pan/zoom surface) now
  also set `touch-action: none` for the same reason — previously only the 3D
  canvas had this set, so single-finger pan or pinch-zoom on the imagery tab
  could occasionally be intercepted by the browser instead of the app.

### Carried over from prior fix rounds
- 3D structure highlighting isolated to the selected mesh only (named
  meshes + emissive reset/target pattern).
- Imagery hotspot highlight coordinate math corrected (canvas transform
  order), fixing highlights rendering in the wrong location.
- Zoom-to-hotspot pan centering formula corrected; zoom-out animates from
  actual current state instead of an assumed 3x.
- Event listener leaks fixed on organism switch and imagery tab re-open.
- DOM element caching, reduced procedural-image noise iterations, capped
  device pixel ratio, disabled shadows/antialiasing for kiosk performance.

---
## Earlier versions
See BUG_FIXES_AND_OPTIMIZATIONS.md, CRITICAL_FIXES_APPLIED.md,
IMAGERY_BUGS_FIXED.md, and 3D_HIGHLIGHTING_FIXES.md for the detailed
bug-by-bug history that led up to this release.
