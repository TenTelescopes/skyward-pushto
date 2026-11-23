# Handoff notes for the next working session

Read this first, then `README.md`. Written 2026-11-16 at Build 54.

## How the project is worked on

- The app is a plain web app (HTML, CSS, vanilla ES modules) in `docs/`, served by GitHub Pages at
  https://tentelescopes.github.io/skyward-pushto/ from branch `main` of `TenTelescopes/skyward-pushto`.
- Bryan commits and pushes himself with GitHub Desktop. Do not commit or push for him without an explicit yes.
- After every delivery, end with the link above and the build label to expect, so he can tap it and confirm what his phone loaded.
- Each build: bump the label in `docs/index.html` ("Build NN · Mon DD") and the cache name in `docs/sw.js`
  (`skyward-pushto-vNN`). New files under `docs/` must be added to the FILES list in `docs/sw.js`.
- Writing files to the PC has, more than once, reported success without changing the file. After every write, read the
  files back and compare them byte for byte with what was tested. Rewrite any that differ.
- Audience: first-time astronomers. Keep it practical and fun, few hurdles before the app starts, plain wording.
  Bryan wants direct, evidence-based answers and to be told plainly what is untested.

## Testing

- Unit tests: `npm test` (9 files in `test/`). All pass at Build 54.
- Browser walkthroughs: `tools/walk/` (Playwright, iPhone-sized). Serve `docs/` first: `python3 -m http.server 8765`
  from `docs/`, then `node tools/walk/<script>.js`. They load `http://localhost:8765/?sim`, which shows a
  "Simulate sensors" button on the start screen. In the page, `window.sim` is the simulated phone (`bend`, `noise`,
  `trueOffset`, `alpha`, `beta`) and `window.simGoto(label)` points the simulated scope at an object.
  - `walk2.js`, `walk3.js`, `walk4.js`: every screen, secondary flows, no-sensor paths (look for `errors: []`).
  - `sky31.js`: the sky darkness check pictures.
  - `look28.js`: splash, start screen, Day/Night fader, in-app look (screenshots).
  - `guess27.js`: unaligned sky view with no compass, direction set by hand, no sensor data.
  - `corr.js`, `jump.js`, `domeshot.js`: sky correction end to end, heading jumps, the dome card (slow: allow 5–10 min).
  - `blank43.js`: draws every target in every eyepiece and lists any preview that comes up empty.
  - `gate.mjs`: thousands of simulated sessions for the sky-correction safeguards (Node only, no browser).
  - Start-screen flow in scripts: untick `[data-step=...]`, click `[data-act=...]`, then click `#l-go`.
- Nothing has been tested on a real telescope. On a real iPhone only informally, by Bryan.

## Not yet verified on real hardware

- Sky correction (Build 26): simulator only. The dome card shows replay numbers; read them on the first night out.
- Sounds (the iPhone silent switch may mute them), screen wake lock, the motion-permission prompt.
- The Phone check-up has never been run on the telescope.
- Posting scores to the Wix leaderboard from a phone.

## Open questions waiting on Bryan

- Build 27: on his iPhone 16 Pro, the unaligned sky view was blank. Two causes were found and fixed in the simulator,
  but which one his phone hit is unknown. Ask what the line above the chart says in Explore with no set-up:
  "No compass." (compass reading missing), "Sensors are off" (motion access), or just the chart (something else).
- Start screen (Build 28) takes two taps (tile, then Start). He may prefer one.
- Eyepiece apparent field: 62° assumed for the 23, 10 and 4 mm. (The 200 Visual is confirmed as 200 mm f/4, 800 mm.)
- `docs/data/blurbs.js`: about 95 object notes and the double-star figures were written from general knowledge. Skim them.
- Light-pollution map by GPS: the candidate data is CC BY-NC; needs a licence decision before use.

## Next feature: satellite alerts (not started)

Bryan's request: alerts for the roughly 100 brightest or most notable satellites and space stations, about one minute
before they appear, with a short note on what each is. The user can switch it off.

Plan:
- Orbit data: CelesTrak "visual" group (about 100 brightest), fetched by the app and cached; refresh every few days.
  The feature needs internet occasionally; say so in the app and degrade quietly when the data is stale or missing.
- Orbit maths: an SGP4 library (satellite.js is the usual one). Vendor it into `docs/vendor/` with its licence and add it
  to the service-worker FILES list, rather than loading it from a CDN at runtime.
- A pass is worth an alert only if the satellite is sunlit, the observer's sky is dark enough (sun below about −6°),
  and it climbs above about 20°. Compute passes for the next few hours in the background, not every frame.
- Alert: a toast about a minute ahead with where to look (direction and height), how long it lasts, and one line on
  what it is. Tapping it could show the track on the sky view. Setting in More, on by default.
- Test against a published pass prediction for the ISS at a known place and time before trusting it.

This was deferred because the previous session could not install packages or reach CelesTrak from its workspace.
Check both first. If the workspace still cannot reach CelesTrak, vendor the library, mock the data for tests, and tell
Bryan the live fetch is untested until he tries it.

## Double-star classification (labels agreed with Bryan; data incomplete)

Labels, agreed 2026-11-16: **True binary**, **Likely binary**, **True multiple**, **Likely multiple**, **Optical double**,
**Optical multiple**, and plain **Double star** when not known. "True" = bound by gravity and confirmed (an orbit is
measured somewhere in the system); "Likely" = same distance and common motion but not proven. Lists show only the label;
the object page adds one plain sentence ("bound by gravity" is spelled out there).

`docs/data/blurbs.js` has `DOUBLE_NATURE` with codes (tb, lb, tm, lm, od, om, unsure) for about two dozen well-known
doubles, entered from general knowledge. The other ~95 show as "Double star", and no optical doubles are marked yet.
Fill the rest from a real source: Washington Double Star Catalog note codes first (orbit, proper motion says physical or
not, parallax same or different), Gaia distances and motions for both components to fill gaps; leave anything unclear
as "Double star". The catalogue entries carry a `wds` discoverer code to match on. Label by the main pair; mention an
unrelated extra star in the object-page sentence. Still open with Bryan: whether to add a small symbol beside the label
(linked rings = bound, separate dots = optical) and a "True pairs only" filter in Find.

## Smaller ideas not built

- A realistic sky background in the eyepiece preview.
- Feeding observing-log results back into the visibility ratings.

## Build 55 notes
- Splash now uses Bryan's own side-view render (`docs/icons/skyward.webp`, cut out from his image) instead of a drawing. He wants to start realistic and move toward whimsical from there. The tube no longer swings (single image).
- First-run question "Does your telescope have a phone dock?" (`askDock` in main.js, `state.dock` 'yes'/'no', changeable in Setup). Naming: the **phone dock** is standard; it sits on a **bridge mount** that is specific to the telescope. No link for people without a dock yet (Bryan has not given one). `state.dock` does not change the pointing maths.
- Build 56: splash image regenerated from Bryan's second, line-free render: simplified, thin lines between features, slim cream edge, gold sparkle, original logo pasted back. He called it "fine for a little phone splash screen".
- Build 57: chart label for the unaligned scope marker is now "Best guess" (was "scope? (guess)"). Note: another chat is editing the same deploy copy (focuser picker in Setup); the PC main.js for Build 57 does NOT include that picker.

## Build 58 notes
- **Blocked sky** (`docs/js/horizon.js`, UI `renderHorizon` in main.js, More → Blocked sky). `state.horizon = { h: [72 heights, 5° bins], how: 'taps'|'trace', rough, lat, lon, when }`. Quick way: tap one of 8 compass wedges to step clear → 15° → 30° → 50° → blocked. Accurate way: trace the skyline with the scope (uses `pointing()` when aligned; falls back to the compass guess, flagged "rough"). Used by: the chart (shaded band), `rateNow` (cause `blocked`), `planTargets` (`horizon` option), and the Marathon.
- **Messier Marathon** (`docs/js/marathon.js`: `marathonList`, `pick`, `nightOf`; UI `renderMar`/`updateMar` in main.js). `state.marathon = { night, start, found: {key: ms}, tap: [], later: {key: ms}, over }`, `state.marathonBest`. Order: anything that would be lost if left (deadline rule) first, otherwise nearest hop weighted by time left. "Got it" is accepted when the sensors agree (within 3 found-radii), otherwise needs a second tap and is counted as "on your word". Finds go into the observing log.
- Game tab is now two cards: Messier Marathon and Race (the three race styles are a dropdown).
- Includes the focuser picker in Setup that another chat added to the shared working copy (checked: renders and saves).
- Tests: `test/marathon.test.mjs` (horizon + marathon). Walk-throughs: `tools/walk/b58.js`, `b58b.js`, `b58c.js`. Older walk scripts that click the old Game lobby style buttons will need updating.
- Simulator only. Not tried on a real phone or telescope.
- Build 59: Blocked sky is reachable from the start screen (`#l-hz`), Plan (`#pl-hz`), Push (`#p-hz`) and More; `openHorizon(from)` and the back button return to where you came from. "Trace the skyline" starts the motion sensors itself if they are off (`beginTrace`). The trace now waits for a "Scope is on the skyline — start" tap before recording, and sweeping over a direction again replaces the earlier reading.
- Build 60: Marathon sync stars. Before a hop that ends more than 40° from the last thing synced on, the Marathon offers a bright star within 25° of the target (`syncStarFor` in marathon.js): Centred — Sync, or Skip the star. On by default; `state.marSync` toggles it (Play screen checkbox and a button during the marathon). Sync stars do not score.
- Build 61: M40 (Winnecke 4) had no pair data, so its eyepiece preview was empty. Added the pair (9.7/10.1, 52.8″, PA about 77°) and marked it as the first "Optical double". PA is from memory, not looked up.
- Build 62: the Sync button in the observing action bar now shows the target name above "Centred — Sync", so the previous/next arrows show what they changed.
- Build 63: the Sync button label is now "It’s centred — sync" everywhere (observing bar and Marathon sync-star step).
- Build 64: guards on Sync (`doSync`). Refused outright when the scope height differs from the object by more than 4° (10° before alignment), since height comes from gravity. A sideways correction over 15° on the sky needs a second tap within 8 s, unless the app was put away (`align.suspect`). `undoSync()` restores heading, drift and correction data; button on the Align screen. `doSync` returns false when refused.

## Build 65 notes (Nov 17)
- **Saved places** (`docs/js/places.js`, UI at the top of Blocked sky). `state.places = [{ id, name, lat, lon, elev, horizon }]`, `state.placeId`. Every horizon change goes through `setHorizon()` so the current place keeps its own map. `usePlace(id)` sets the site and the horizon. `siteMoved()` runs after a GPS fix or typed coordinates: stays, switches to the one saved place within 0.5 km, asks when several are there, or leaves. No reverse geocoding (it would send the location to an outside service), so place names come from the user: quick chips (Backyard, Front yard, Cottage, Park, Dark site) or a typed name.
- **Kept plans**. `state.plan` (working plan) now has `id, notes, name, nameSet, placeName`; `state.plans` holds the others, newest first, max 60. Nothing needs a Save button: "New plan" and "Open" stash the working plan automatically if it has targets or notes. Names are automatic ("Tue Nov 17 evening · Backyard", from `planAutoName`) until renamed. Notes are a free-text box on the plan.
- Tests: `test/places.test.mjs`. Walk-through: `tools/walk/b65.js`. Simulator only.
- Build 66: blocked sky is drawn on the charts as see-through diagonal hatching (`hzFill`), with a show/hide toggle (`state.hzShow`; button `#z-hz` in the chart controls, checkbox on the Blocked sky screen). Hiding it only changes the drawing; blocked targets are still left out of suggestions.
- Build 67: Blocked sky is a fourth star on the start-screen path (`PATH`, `STEP_INFO.horizon`, `stepOn`). On by default until the spot has a map or a saved place, then off unless ticked. In the flow the screen shows "Done — carry on" (`hzDone`). The separate Blocked sky button on the start screen became an "Open" button on that row. Older walk scripts that launch Explore or Plan must now also untick `[data-step=horizon]`.
- Build 68: the skyline trace finishes itself (`hzSaveTrace(true)` from `updateHorizon`) when every direction is swept, or the scope has turned a full 355° with at least 60% of directions covered (gaps are bridged). A partial sweep still needs the Save button.
- Build 69: **Route preview** (Plan → "▶ Preview the route"; tab `route`, code under "ROUTE PREVIEW" in main.js: `routeStops`, `renderRoute`, `routeCard`, `updateRoute`, `drawRouteMap`). Stops = the alignment stars the Align screen would offer at the session start, then every plan item in order (targets spread evenly through the session). Whole-sky map (N up, E right, same as the Blocked sky ring) with the blocked sky hatched, the path traced as it plays, and beside it the stop in the widest eyepiece ("Find it") and the recommended one ("Then look"). Plays by itself; ‹ › step and pause. Simulator only.
- Build 70: on the Blocked sky screen the trace is now the "Quick way: one slow turn" with the big primary button; tapping directions moved below it as "Or mark it by hand" / "Your blocked sky".
- Build 71: **marking blocked sky by tapping is removed** (Bryan's call). The ring on the Blocked sky screen is now only a picture of the traced result. The trace has two modes (`hzTrace.mode`): **phone in the hand** (default; `handPointing()` = the phone's top edge, height from gravity, direction from the compass; a 3-second countdown after Start so the phone can be raised to the eye) and **phone on the telescope** (offered only when star-aligned; uses `pointing()`). Saved horizons carry `by: 'hand' | 'scope'`. `setWedge`/`LEVELS` remain in horizon.js for tests and summaries. Older walk scripts that click `[data-wedge]` no longer work; seed `state.horizon` in localStorage instead (see `b66.js`).
- Build 72: **plan ordering rewritten** (`orderTargets` in plan.js, used by `routePlan`). Old: nearest-next, with anything under 45 minutes from setting jumping the queue at every step, which split neighbours (reproduced: M82 → M57 → Albireo → M81 at 8 pm on Nov 17). New: things under 45 minutes from setting at the start go first; the rest starts nearest-next and is then improved by moving, swapping and reversing until total sky travel stops shrinking, with heavy charges for visiting a target below the height limit or outside its window and a small charge for height lost by sinking targets. Sync stars are added afterwards and are never also targets. Tests in `test/plan.test.mjs` (neighbours adjacent, travel compared with nearest-next, pair not split at the height limit).
- Build 73: drag to reorder the plan. In Edit mode each row has a grip (≡); rows are shifted visually during the drag and `P.items` is spliced on drop (`bindPlanList`). Window-level pointer listeners, `touch-action: none` on the grip, edge auto-scroll. The ↑ ↓ buttons are kept as a fallback until the drag is confirmed on a real touch screen (Playwright can only drive it with a mouse).
- Nov 17: usability audit of Build 73 written to `AUDIT.md` (26 findings, ranked). Nothing fixed yet; waiting for Bryan to choose.
- Build 74: audit fixes. See the table at the end of `AUDIT.md`. New: in-app dialogs (`askText`, `#dlg`), `askLocation`, `openBackup`/`backupData`/`restoreData`, `planSchedule`, `backTo`, tabs renamed Observe and Play, 44 px touch targets, check-up optional by default (`DEFAULTS.launch.check = false`), `SYNC_DIST` 50. Walk scripts written before this build need `#loc-skip` (or a seeded `site` with source "entered manually") to get past the location question.


## Build 75 — phone position picker (Nov 17)

- `MOUNTINGS` in `docs/js/model.js` now has seven positions (on top ×2, on the side with the screen facing out ×2, across the tube ×2, camera along the tube). Each is just the tube direction in the phone's frame; `where`/`edge` are the picker captions.
- Side positions use the same axis as the dock ([0, ±1, 0]): rolling the phone around the tube does not change the pointing. They are separate entries only so the picture matches what the user sees.
- Picker: `mountSVG`, `mountPickerHTML`, `setMounting` (clears every scope's remembered tilt and the alignment), `wireMountPicker` in `main.js`. Shown in Setup → Phone mount and sensors, and from the dock question ("My phone sits another way").
- Simulator: `simGoto` uses `eulerForMounting`, so `?sim` behaves like a phone in the chosen position (side positions are rolled 80°).
- Tests: `test/mount.test.mjs`; walk: `tools/walk/b75.js` (run as CommonJS; start sensors with `#gate-sim` after `#l-go`).
- NOT done: landscape layout. A side-mounted or across-the-tube phone will often be seen sideways and the browser may rotate the page; layout is still portrait-only. Nothing here has been tried on a real phone.

## Build 76 — picker trimmed to three (Nov 18)

- The picker offers only `MOUNT_OFFERED` = on top (top edge to sky end), on the side (screen out, top edge to sky end), camera along the tube. The other four stay in `MOUNTINGS` (maths and tests unchanged) and one already saved from an older build is still shown.

## Build 77 — camera plate solving, first pass (Nov 18)

- `docs/js/solve.js`: plate solver for wide phone frames. `makeIndex(FIELD)`, `solveField(stars, w, h, index, { prior })`, `project`. Solves focal length along with pointing (no per-phone calibration); pair hypotheses + TRIAD + early rejection + least-squares refine; refuses rather than guesses (needs margin over the runner-up).
- `docs/js/skycam.js`: `skyMask` (which tiles are sky: smooth-surface fit, texture, saturation, edge steps, region growing, star-vetted patches), `findStars(lum, w, h, mask, K)`, `planIntegration` (frame length from sky brightness; total stacking from the faintest needed star), `skyWord`, `drawRejected` (grey stripes).
- `docs/camtest.html` (Test page 4): live stripes over the preview, frame-time trial judged on sky only, adaptive stacking, solve, report. Linked from More; cached by the service worker.
- Tests: `test/solve.test.mjs`, `test/skycam.test.mjs` (synthetic skies only).
- NOT done: no real-sky frame has been solved; the solve is not yet used for pointing (needs camera-to-tube calibration and a sync button); planets are not in the solver's catalogue; native Swift camera plug-in not written. See `IOS.md` for the Xcode/Capacitor steps.

## Build 78 — camera star finder inside the app (Nov 18)

- The separate test page is gone (`docs/camtest.html` is now only a redirect to the app). Camera code lives in `docs/js/camera.js` (`SkyCamera`: open/close, sky-only exposure trial, adaptive stacking, `find()`; plus `analyse`, `solve`, `drawResult`, `reportText`).
- App screen: tab `camera` (sub-screen of More; `renderCamera`, `cameraFind`, `attachCamera`, `closeCamera` — the camera is closed whenever another screen is shown). Also offered from Star alignment when the phone position is "Looking along".
- Using a fix (`applyCameraFix`): only when `state.mounting === 'camera'` and sensors are live. The solution gives the telescope's true alt/az (`camTruth`); it is fed to the existing machinery as an observation with its own position (`o.fix`): unaligned → alignment observation (`align.obs`, `refit`; second fix must be ≥ 20° from the first), aligned → `doSync` (altitude guard kept as a sanity check against the tilt sensor; the stray-tap swing guard is skipped).
- Camera-to-eyepiece line-up: `profile().camBore` is a unit ray in the camera frame (default dead centre). Set from a solved picture by naming the star that is centred in the eyepiece; refused if that star is more than 12° from the middle.
- Solver hint: when aligned, the current pointing is given as a 25° prior; if that fails it searches the whole sky.
- Walk: `tools/walk/b78.js` (needs Chromium's fake camera fed a .y4m of a known field; see the header).
- NOT done / unknown: no real sky frame yet; planets are not in the solver's catalogue; landscape screen rotation is untested; native exposure control (Swift) not written.

## Build 79 — frames lined up before stacking (Nov 18)

- `skycam.js`: `halfLum` (half-size brightness from RGBA), `registerStars(ref, cur, w, h)` (vote on the shift, then fit twist + shift and re-match; null when unmatched), `addFrame(sum, cnt, rgba, w, h, tf)` (nearest-pixel warp; `cnt` counts frames per pixel).
- `camera.js` `find()`: first frame is the reference; each frame's brightest stars (half-size, threshold 8σ, top 14) give its transform. Unmatched frames are left out. After four still frames in a row only every sixth is checked. Falls back to plain adding when a single frame shows fewer than two stars. `?noalign` switches it off for comparison.
- The solution describes the reference frame, so the phone attitude used for the fix is captured at that moment (`onReference` → `o.R` in `makeObs`), not at the end of the stack.
- Walk: `tools/walk/b79.js` (needs a wandering fake-camera video).
- Unknown: whether single short frames from a real phone show two stars to lock onto; speed on a phone.

## Build 80 — native iPhone camera path (Nov 18)

- `native/ios/SkyCamPlugin.swift` (Capacitor 8 local plug-in, jsName `SkyCam`: `open`, `setExposure({seconds, iso})`, `frame`, `close`; AVFoundation, Y plane as base64) and `native/ios/MyViewController.swift` (registers it). **Never compiled.** `IOS.md` has the Xcode steps (Capacitor 8 needs Xcode 26+, Node 22+, Swift Package Manager by default).
- `camera.js`: the stacking loop is now `collectLight(src, …)`, shared by `SkyCamera` (web) and `NativeSkyCamera` (plug-in). The native class chooses exposure and gain from the sky background (aim ~11% of full scale: long frames under a dark sky, short under a bright one, gain down if still too bright), draws its own preview into a canvas, and returns the same result shape.
- `main.js`: `nativeCam()` = `cap('SkyCam')`; `renderCamera` uses a canvas instead of a video for the native camera.
- Walk: `tools/walk/b80.js` runs the native path against a pretend plug-in built on Chromium's fake camera (dark sky → 0.8 s frames, bright sky → 1/20 s; both solve).

## Build 81 — picture scale as a solving hint (Nov 18)

- `camera.js` `solve(stars, w, h, FIELD, prior, scale)`: tries (scale + prior) → (scale) → (prior) → (nothing), so a wrong hint costs time but never a solution. `fovRange`, `focalFromFov`.
- Sources of the scale: a previous high-confidence fix (`state.camScale` keyed 'w' web / 'n' native, with the picture size it belongs to; ±5%), or, in the native app before any fix, the lens angle the phone reports (`fieldOfView` from the plug-in, taken as the long side; ±15% because video crop is not known).
- Report gains arcminutes per pixel and a "Scale hint" line.
- Pixel pitch and physical focal length are not needed: the plate scale is focal length in pixels, which the stars (or the reported lens angle) give directly.

## Build 82 — times follow the calendar (Nov 19)

- Bug: an app left open in the background kept showing the day it was drawn (sunset, darkness, Moon) until a screen was redrawn; the start screen in the morning used last night's numbers ("Daylight", Moon set from the night before); a plan starting after midnight showed the next day's sunset.
- `sky.nightAt(when)` (astro.js): last night until sunrise, tonight after. Used by the plan header, `defaultStart`, the start-screen line, and `nightOf` (marathon; ids are still named after the evening).
- Plans roll forward when their night is over (after that night's sunrise), not "two hours after the session".
- `refreshForTime()` redraws the open screen (and the start screen if showing) when the app comes back after 10+ minutes or on a new date, and a once-a-minute check catches the date turning while it sits open. Skipped while the plan is being edited.
- Walk: `tools/walk/b82.js`.

## Build 83 — RAW frames from the native camera (Nov 19)

- `SkyCamPlugin.swift`: session preset `.photo` (full 4:3 sensor); `AVCapturePhotoOutput` with the first Bayer RAW format; new `raw()` — capture, `CIRAWFilter` with boost/noise reduction/sharpness/contrast/detail/local tone map at 0 and lens correction on, rendered linear (linear sRGB, RGBA16), 2×2 block average of (R+G+B)/3, turned upright if landscape, returned as 16-bit LE base64 (`bits: 16, linear: true`). Preview `frame()` now block-averages down to ≤ ~1000 px (the `.photo` preset can deliver large preview frames). `open()` reports `raw` and `binned`. **Never compiled.**
- `skycam.js`: `halfLum` and `addFrame` accept a brightness array (length w·h) as well as RGBA.
- `camera.js` `NativeSkyCamera`: `_sci()` = RAW when offered (brightness 0..765 from 16-bit), else preview; exposure trial judged on that frame's sky (`levelOf`); under a bright sky with RAW, gain is reduced before exposure. Display of RAW frames uses a square-root stretch (display only). Report says RAW or "offers no RAW".
- Unknowns: does RAW capture honour the custom exposure (believed yes; the report shows exposure/ISO read from the photo's EXIF); time per RAW frame on a phone (capture + develop + 6 MB over the bridge); whether the quarter-turn leaves the picture upside down (harmless to solving).

## Build 84 — superpixel RAW and a learned hot-pixel list (Nov 19)

- `SkyCamPlugin.swift` `raw()`: from `photo.pixelBuffer` (Bayer, 16 bits per photosite) sums each 2×2 block, subtracts the black level (DNG `BlackLevel`, one or four values, via ImageIO) and scales by `WhiteLevel` so 65535 = four photosites at white. No demosaic, colour matrix or white balance. Falls back to the Build 83 `CIRAWFilter` path if the buffer is planar/odd or the DNG tags are missing. Result carries `method`, `black`, `white`. **Never compiled.** Lens distortion and vignetting are no longer corrected on the superpixel path.
- `skycam.js` `learnHot(list, spots, where)` / `dropHot(stars, list, k)`: an unrecognised spot at the same pixel (±1.6 px) in fixes ≥ 5° apart, three times → hot. Learned only from high-confidence fixes; stored per camera ('w'/'n') with its picture size in `state.hotPix`. Applied to candidates, trusted stars and the half-size stars used for lining frames up.
- Report lines: RAW method with black/white levels; "Hot pixels: N known and ignored, M newly confirmed".
- Note: a lone hot photosite is already rejected by the single-pixel test in `findStars`; the list catches small clusters and defects that a short star might otherwise be confused with.
- Walk: `tools/walk/b84.js` (three fake skies with the same defects, persistent browser profile).

## Build 85 — the native camera stops freezing the app (Nov 20)
- First run on an iPhone 16 Pro: frames started, then the app stopped responding. Cause: 2×2-binned RAW frames (~3 MP)
  analysed on the main thread, plus blind solves of several seconds each.
- Plug-in bins RAW 4×4 by default (`raw({bin})`, even 2–8); preview frames at most ~480 px.
- Every plug-in call has a time limit (`NativeSkyCamera._call`); a yield after each RAW frame.
- Solving runs in a Web Worker (`docs/js/solve-worker.js`, `solveInBackground`), with a 20 s budget (deadline checked
  inside `solveField`). Pictures brighter than half scale or with <10% sky are not searched at all.

## Build 86 — the camera explains itself (Nov 20)
- On the phone, Build 84/85 sat on `setExposure` for minutes, then failed with "Cannot Record". Cause not yet known:
  frames appear to stop arriving (setExposure only answers once a frame with the new settings arrives).
- Plug-in: watches session interruptions and runtime errors (logged as `SkyCam:` lines in the Xcode console, restarts
  after an error), counts preview frames, new `status()` method; `setExposure` answers anyway after 2×exposure + 2 s with
  `confirmed: false`; error messages carry the AVFoundation code and the camera state.
- Photo output: zero-shutter-lag and responsive capture off, quality priority `.speed`, no rotation on the photo
  connection (RAW is turned in `finish()`), all suspected of interfering with long manual exposures. Untested.
- JS: a RAW failure during the exposure trial switches to preview frames for the rest of that fix; a failed fix leaves
  the error and the camera log on screen with a Copy button (`camErr`).
- Found on the phone (Build 86 first run): iOS stopped the app with "setActiveVideoMinFrameDuration: Unsupported frame
  duration" for a 1/100 s exposure. The frame duration was computed via frames-per-second (1/30 → 33333 µs, i.e. just
  over 30 fps) and fell outside Apple's range. Now clamped with CMTime to the ranges' own min/max durations
  (`frameLimits`), and the exposure likewise to the format's own CMTime limits. Probably the cause of the earlier hang too.
- First complete run on the phone (indoors, Build 86): no crash, RAW superpixel works, 17 RAW frames of 0.1 s took
  31 s (~1.8 s overhead per RAW photo — too slow for stacking as is). Sky level stayed ~345–363 of 765 while ISO went
  8000 → 80 (photo EXIF confirms those ISOs), noise only 0.27: the RAW numbers look clipped or mis-scaled. Added a
  "RAW check" line per trial frame (mean per Bayer position, max, % at white, pixel format) and the format's frame/
  exposure limits to the report. Also seen: after a few RAW photos the longest allowed frame dropped to 1/24 s.
- Second RAW check (dark room): buffer 'bgg4' (14-bit Bayer BGGR in 16 bits), 4224×3024, while the DNG tags say black
  528 / white 4095 (12-bit). Mean ~2018 in all four Bayer positions at every ISO from 8000 to 50, max ~2277. Either the
  photos are nearly unexposed, or the buffer is on a different scale from the DNG tags (14-bit black ≈ 4×528?) so the
  black subtraction is wrong — which would also explain the constant "sky level" ~340 that drove the gain DOWN in the
  dark. Added to the trial RAW check: value percentiles, the buffer's extra columns, the preview's mean at that moment,
  and Apple's own linear development of the same DNG (`raw({check:true})`, trial frames only).
- Third RAW check (lamp/room, ISO 8000 → 50): Apple's own development scales properly with ISO (G 0.34 → 0.0005),
  so the photos do catch light. The buffer is 14-bit: dark median 2120 ≈ 4 × the DNG's 528, and the right-hand 192
  columns are zero padding. Fix: superpixel puts black/white on the buffer's scale (×4 when the format's fourcc ends
  in '4' and the DNG white ≤ 4095) and bins only the picture's own width. Also: raw signal above black was 114 at
  ISO 400, 134 at 1600, 133 at 8000 — RAW gain is analogue only up to roughly ISO 400–1600; above that Apple only
  multiplies in development. RAW ISO now capped at 800 (`_isoMax`); longer exposures instead.
- To do (asked Nov 20): let the user save the stacked picture (e.g. PNG of the stretched stack with the overlay, and
  perhaps the linear 16-bit data as FITS/TIFF for astronomy software). Not started.
- FIRST REAL-SKY FIX ON THE PHONE (Nov 20, 01:31, Guelph): native RAW, one 1 s frame at ISO 800, sky level 4.3/765,
  20 clear stars; solved blind (no pointing hint) at RA 5h29m, Dec −5.2° (Orion), 18 of 20 matched, fit 1.94 px
  (9.5′) at 701 px focal length (phone's own hint 693 px ±15%, used), 3 ms in the worker. Fit is loose for the
  number of stars: likely lens distortion (72° lens, no correction on raw data) — a radial distortion term in the
  solver's refine step is the next accuracy improvement. Collection also stopped after one frame (20 stars = enough).

## Build 87 — camera, eyepiece and red-dot finder lined up together (Nov 20)
- Context: first real-sky native fix (handheld, Orion) solved blind; Bryan asked for an alignment flow in which the
  red-dot finder, the telescope and the phone all agree.
- Camera screen, phone looking along the tube: "Line up the camera, telescope and red-dot finder" (`camWiz`,
  `wizardFix`, `wizardHTML`, `wireWizard`). Steps: 1 rough fix → `wizPick` names the bright star (mag ≤ 2.5, within 15°
  of the telescope mark, score = offset + 4×mag) and rings it; 2 user centres it in the eyepiece, "It's centred" takes a
  fix → where that star sits in the picture becomes `profile().camBore`, the alignment restarts and this same fix is
  the first alignment fix (`applyCameraFix`, which still refuses if the tilt sensor disagrees); 3 without moving, the
  user sets the red-dot finder on the star (`profile().finder = {star, t}`) or says there is none; 4 one more fix
  elsewhere unless one is enough (saved mount tilt / calibrate off). "Align with the camera" on the alignment screen
  starts it when the camera has never been lined up. The by-hand line-up (pick a star from a list) stays, hidden while
  the guided one runs.
- Classic star alignment (any phone position): after the first star is centred, a "Red-dot finder check" card asks
  to set the dot on that star (once a session, `finderAsked`); if that star completes the alignment, the app waits for
  the answer before moving on.
- Native camera in this build: 14-bit black/white fix and RAW ISO cap 800 (see Build 86 notes).
- Walks: b78 (now with the guided line-up, sensors aligned via simGoto), b87 (pretend native plug-in), b80, b75 pass.
  The older walks b58–b66 stop at a dialog that later builds added before the sensor gate; they need updating, not
  related to this build.

## Build 88 — red-dot finder first, with drawings (Nov 20)
- Bryan: the finder should come first — it is how the star gets into the eyepiece, and turning its knobs nudges the
  telescope, so the camera picture must come after the last nudge.
- Camera line-up steps now: 1 rough fix names the star → 2 `finder`: get it in the eyepiece with the finder (or line
  the finder up on it), buttons "It's centred and the dot is on it" / "It's centred — no finder"; the picture button is
  disabled in this step → 3 `shoot`: re-check centred, "It's centred" takes the fix that sets `camBore` and is the first
  alignment fix → 4 `second` (or done).
- Star alignment: the same finder help (`finderHowHTML`) sits under the first star, open until a finder has been set,
  with a "I set the red-dot finder on X" box read when that star is confirmed. The post-confirmation card is gone.
- Drawings: `finderArtSVG` (dot on the star in the finder with its two knobs; star in the middle of the eyepiece) and
  `docs/img/finder-mount.png`, cropped from page 28 of the Skyward 150 Assembly Manual v0.1f (finder on its mount).
  The manual has no finder-alignment or collimation pages; it is assembly only.
- Web camera: `find()` waits up to 5 s for the first video frame (a redraw creates a new video element; tapping right
  after gave "has not produced a picture yet").
- Collimation page (More → "Collimate your Skyward", tab `collim`, `renderCollim`, `collimSVG`): laser method —
  safety and set-up, 1 secondary (dot into the primary's centre ring; the three screws in the secondary holder),
  2 primary (return spot into the laser's centre hole; the knob pairs at the back, adjust + lock), 3 repeat both; the
  laser's own error (dot circling as it turns); optional star test at night. Drawings made in code; photos cropped from
  the Skyward 150 build manual (p24 secondary screws → img/secondary-screws.png, p30 render → img/primary-knobs.jpg;
  the original 150 design, the Compact may differ). "Collimated today" saves `profile().collimated` (shown in More).
  Bryan said "laser like in the build manual", but manual v0.1f in the Skyward150 repo has no laser pages; the 150
  Compact sourcing guide and the SW200 RASC packing list both include a laser collimator. Ask for the newer manual.
- iOS home-screen icon and launch picture: `native/ios/AppIcon-1024.png` (the Skyward render from docs/icons/
  skyward.webp on a starry navy-to-violet gradient) and `native/ios/splash-2732.png` (same, smaller, centred);
  `scripts/patch-native.mjs` copies them over Capacitor's placeholders in Assets.xcassets. App name already
  "Skyward Push-To" (capacitor.config.json appName / CFBundleDisplayName).

## Build 89 — home button, More menu regrouped (Nov 20)
- Header: house button `#hb-home` opens the start screen from any screen (was the last item in More). Header gaps
  and button widths trimmed so "Not aligned — tap" still fits beside four buttons in a browser (the full-screen
  button is hidden in the iPhone app and when installed to the home screen).
- More, grouped by when you need it: Each night (Star alignment, Camera star finder, Sky darkness check) · Now and
  then (Collimate, Blocked sky, Phone check-up) · Your records (Observing log, Back up) · Setup (telescope, eyepieces,
  location and phone mount) · Quick settings. b75 walk now opens Setup by `[data-go=setup]`.

## Build 90 — floating progress, user-set light (Nov 20)
- While the camera collects light, a panel floats above the camera buttons (`camFloat`, `#cam-float`) with the
  status line, a progress bar and "Stop and use what I have" (`camStop` → `opts.shouldStop`: collectLight finishes
  with what it has and still solves; the native exposure trial also stops early). Removed when done or when the
  camera closes.
- "Light to collect" slider on the camera screen, 1–10 s, default 3 (`state.camLight` → `opts.maxLight`): caps the
  total light (`planIntegration` maxTotal), the waiting time (6 + 2.5 × light, at most 30 s) and, natively, the single
  frame length. Collection still stops early once there are 12 clear stars.
- Native exposure trial no longer runs Apple's own RAW development per trial frame (`raw({check:false})`); the cheap
  RAW-number line stays in the log. Both were diagnostics for the 14-bit black-level problem, now fixed.
- Walk b90 (= b80 + the floating panel): passes; b87, b78 pass. "Stop" itself is not yet exercised by a walk.

## Build 91 — names on the picture, save the picture (Nov 20)
- After a fix the picture names bright stars (magnitude limit by field width), planets and the Moon
  (`sky.raDecJ2000`, new in astro.js) and Messier/Caldwell objects (blue dashed circles), only where the mask says
  sky, brightest first, at most 24, none overlapping (`camLabels`; `drawResult(..., { labels })`).
- "Save picture" (the stretched stack alone) and "Save with names" (markings and names, no grey stripes, plus a
  caption: time, RA/Dec, field, stars recognised, light collected) (`savePicture`). iPhone app: new plug-in
  method `savePhoto({data})` adds the PNG to Photos with add-only permission (`NSPhotoLibraryAddUsageDescription`,
  also in patch-native). Web: share sheet with the file, else a download.
- Walk b91 (= b90 + saving with a pretend `savePhoto`): passes. The Swift method has not been compiled yet.

## Build 92 — a window of its own while collecting light; no stripes on the live view (Nov 21)
- `camFloat` now opens a full-screen window (`.camwin`): title, "keep the telescope still", the live picture (the
  camera's `.camstage` element is moved into it for the duration and the screen is redrawn after), status,
  progress bar, "Stop and use what I have". Replaces the floating panel that could sit half off-screen.
- The sky/not-sky stripes are no longer drawn on the live view (web `_live` is now empty; native `_show` no longer
  draws them): too jumpy on single preview frames. They still show on the result picture after collection.
- Walks b91, b87, b78 pass.

## Build 93 — choosing the exposure faster (Nov 21)
- Bryan: the window spent a long time on "Reading the sky to choose the exposure".
- Native trial: at most 3 test pictures (was 5); the first is also the first light frame. In the dark, once the
  frame is as long as allowed, the gain jumps straight to what is needed (up to ×16, capped at ISO 800) instead of
  doubling per step. Status shows "test picture k of up to 3 (exposure, ISO)".
- The settings that worked are remembered (`state.camGood`, per camera) and used to start the next session.
- Swift: an unconfirmed `setExposure` now answers after exposure + 0.6 s (was 2 × exposure + 2 s — up to 4 s lost per
  test picture at 1 s frames).
- Walks b91, b87 pass.
- Timing in the report (first 4 RAW pictures of each attempt): camera time (exposure + Apple's processing, from
  `capturePhoto` to `didFinishProcessingPhoto`), binning (Swift, incl. the RAW-check statistics), hand-over (bridge +
  base64) and unpacking (JS). Bryan suggested subsampling for the exposure tests; measure first — the analysis already
  runs on the 4×4-binned picture, and the suspicion is that Apple's capture pipeline and the Debug build (Swift loops
  run unoptimised from Xcode's Run) dominate. Try Release (Edit Scheme › Run › Build Configuration) as a comparison.

## Build 94 — "Not aligned yet" instead of "Best guess" (Nov 21)
- Bryan: while exploring, "Best guess" should say it is not aligned yet, so people know alignment improves it.
- Chart label under the telescope circle: "Not aligned yet" (was "Best guess"); banner "NOT ALIGNED YET — ROUGH
  POSITION" with "… · align to make it accurate". Sky view (Explore) with only a compass: the status line now says
  "Not aligned yet — the position comes from the phone's compass, so it's rough" with an Align button (it was empty).

## Build 95 — RAW binning ~10× faster (expected) (Nov 21)
- Timing from the phone (indoors, Build 94): camera 22–250 ms (the photo arrives almost at once — less than the 1 s
  exposure, so Apple hands over a frame already being exposed), hand-over 14 ms, unpacking 5 ms — and **binning
  1.9–2.3 s**. The Swift superpixel loop was the bottleneck (array subscripts, Double maths, unoptimised Debug build).
- Binning now uses raw pointers, integer sums and one black subtraction per block; the RAW-number statistics run only
  for the first test picture of each attempt (`raw({check:true})`, `wantStats`); the Apple-development check is gone.
- Debug builds now compile Swift with `-O` (project-level `SWIFT_OPTIMIZATION_LEVEL`, also set by patch-native), so
  Xcode's ▶ Run gives App Store speed. Side effect: the debugger shows fewer variables. Not yet measured on the phone.

## Build 96 — light-pollution estimate from a built-in map (Nov 22) — app side done, map data pending
- Bryan: use location plus light-pollution maps to estimate the sky in Plan and elsewhere.
- Data choice: NASA Black Marble yearly night lights (VNP46A4, US government work, current) rather than the World
  Atlas 2016 (CC BY-NC 4.0: a grey area for an app tied to a business, ~10 years old, 2.9 GB). Black Marble measures
  upward light, so sky glow is modelled: `tools/lightmap/build.py` (sum to 0.025°, glow = Σ light ×
  (d² + 5²)^-1.25 × exp(-d/150 km) within 250 km, SQM = 21.9 − 2.5·log10(1 + glow/G0), G0 fitted to anchors.json;
  written on a 0.05° grid, one byte per cell). `--selftest` checks the model (a city calibrated to 17.0 gives ~20.3 at
  50 km, matching Walker's-law expectations). Needs h5py, which this workspace cannot install: run it on the Mac (or
  the desktop Linux VM) once the tiles are downloaded.
- Anchors: only one measured value so far (downtown Toronto 16.8–17.0 mag/arcsec², University of Toronto
  photometry, 2002, pre-LED). Add Bryan's own Sky darkness checks (Guelph etc.) as more anchors.
- App: `docs/js/skyglow.js` (load/parse `data/skyglow.bin`, bilinear lookup, SQM→NELM, Bortle). `skyNelm()` now uses,
  in order: the user's sky check, the map estimate for `state.site`, then the suburban default. Plan shows e.g.
  "Suburban sky (light-pollution map, about Bortle 6)"; More › Sky darkness check shows the estimate. Ratings caches
  key on `skyNelm()`, so they update when the map arrives. No map file yet: the app behaves as before.
- First tiles requested from Bryan: h08v04 h09v04 h10v04 h08v05 h09v05 h10v05 (southern Ontario, NE US), into
  `Documents/GitHub/skyward-lightdata/` (outside the repo). When `docs/data/skyglow.bin` exists, add it to sw.js FILES.
- Tests: `test/skyglow.test.mjs` (in npm test). Checked in Chromium with a made-up map: Plan and More show the estimate.
- Icons: home-screen icon, launch picture and the web app's icons (docs/icons/icon-192/512.png) are now the Ten
  Telescopes logo (telescope against a starry Moon, navy background), from Bryan's logo file; crop centred on the art.

## Build 97 — first real light-pollution map (Nov 22)
- `docs/data/skyglow.bin` (240 kB): 2025 Black Marble tiles h08–h10 × v04–v05 (lon −100…−70, lat 30…50), built on
  Bryan's Mac with `tools/lightmap/build.py` in a venv (`~/skyward-venv`; Homebrew Python refuses pip installs).
  Downloads: built-in browser, one at a time (NASA returned 502 to several at once); the Earthdata profile needed
  User Type / Organization / Study Area before NASA would serve files.
- Sample estimates (SQM, Bortle): Toronto 17.0 (anchor), Chicago 16.5, Detroit 16.7, Hamilton 17.7, Kitchener 18.0,
  Guelph 18.35 (B8), Orangeville 19.2, Wellington County 20.0, Muskoka 20.6, Torrance Barrens 21.2, Algonquin 21.8,
  Tobermory 21.7, Cherry Springs PA 21.6. Mid-sized city centres look too bright (one anchor only, 2002 pre-LED):
  needs more anchors — Bryan's own sky checks — before trusting the city end. Dark sites look sensible.
- Added to sw.js FILES (offline). Grid edge: places outside the six tiles get no estimate (suburban default).

## Build 98 (Nov 22)
- Bortle shown after a sky darkness check too: "(about Bortle N)" from the measured limiting magnitude
  (`nelmToSqm`, `bortleOfNelm` in skyglow.js; the stored label is unchanged, so logs are unaffected).
- `test/skyglow.test.mjs` now runs in `npm test`.
- App Store prep in `scripts/patch-native.mjs`: `ITSAppUsesNonExemptEncryption = NO`, iPhone-only
  (`TARGETED_DEVICE_FAMILY = 1`), Xcode build number = the "Build NN" label. Version stays 1.0.
- Owner enrolling in the Apple Developer Program as an individual (not incorporated).
- Audit fixes (same build): Plan tab crashed (`state.skyq.label` of undefined) for anyone inside the light-pollution
  map with no sky check (Build 96 regression); the start screen and ratings now refresh when the map loads
  (`rateCache` was keeping ratings made with the default sky); sky names now follow the Bortle class
  (`skyLabel` uses `bortleOfNelm`), and the Plan sky picker lists Bortle 9 to 1.
- Icon (same build): the Ten Telescopes "Ten" mark from the website header (T drawn as a Newtonian spider star) in white, with "Skyward" (Inter Bold, gold) and "Push-To" (Inter Regular, white) below, on the app's night-blue gradient. Launch screen: same, centred small enough to survive the portrait crop.

## Build 99 (Nov 22)
- Your sky (light pollution): opening the sky darkness check (More, Plan, start-up path) now shows a "Your sky" page
  first: the light-pollution map estimate (Bortle, SQM, limiting magnitude), your last check, and a map of the area
  coloured by Bortle class (interpolated from data/skyglow.bin; Closer/Wider ~110/280/670 km tall; "You" marker, scale
  bar, ~65 town labels in `LP_TOWNS`, overlaps skipped), then "Do the 30-second darkness check" (`runSkyCheck`, the old
  check). The result page compares with the map. Setup → Location keeps one line plus a button to that page.
  `openSkyCheck`, `runSkyCheck`, `lightHereHTML`, `wireLightMap`, `drawLightMap` in main.js; `skyGlowGrid`, `cellSqm` in skyglow.js.

## Build 100 (Nov 22)
- Start-up location: `autoLocate()` 2.6 s after launch. If the phone already allows location, a quiet GPS refresh
  (`getGPS(true)`, no toasts); if location was never set, the "Where are you observing from?" dialog, with
  "Use this phone's location", "Not now" (asks again next launch) and "Don't ask again" (`state.locNever`, also
  skips the ask before the first activity; location stays settable under More → Telescope, eyepieces, location). The start screen's tonight line ends with "sky about Bortle N (light-pollution
  map)" or "your sky about Bortle N".
- Sky darkness check: each picture shows its Bortle class; the darkest picture reads "Bortle 5 or darker" because the
  Little Dipper can't tell darker skies apart. There `checkNelm()` goes by the map when the map is darker (e.g.
  Torrance: Bortle 4), and the result says so. `skyNelm()` uses `checkNelm()`.
- "Update location" buttons (GPS, fresh fix: `maximumAge 0` when pressed) with a "📍 place · coordinates · GPS today
  8:15 PM" line (`whereText`, `wireUpdateLoc`) on the start screen, in Plan's Tonight box and on the "Your sky" page;
  Setup's button now reads "Update location (GPS)". `getGPS` redraws all of them when the fix arrives.

## Build 101 (Nov 22)
- Owner's phone showed "your sky about Bortle 9" after Update location: it came from a sky darkness check made under
  a 96% Moon, which overrode the map everywhere and was then counted twice (the ratings add the Moon again).
  Now: a check counts only within 15 km of where it was taken (`skyQ`). A check made with the Moon up or in
  twilight measured light pollution + moonlight; `moonlessNelm` (vis.js) takes the modelled moonlight (Krisciunas &
  Schaefer, Moon vs Polaris direction) and twilight away to get the light pollution alone (`q.base`), which the
  ratings start from before adding the Moon back per target and time. If the Moon is >85% of what was seen, the
  light pollution can't be told: the check isn't used for ratings and the map is. Checks saved earlier get `base`
  worked out from their time (`checkBase`). Result page and tonight line say which happened
  ("your sky about Bortle 6 (your check, Moon glow taken away)").
- `getGPS` now resolves true/false and says why it failed (location off for the app → where to turn it on in
  Settings; no fix in 30 s; browser blocked). Update location buttons return to normal straight away on failure.
- Plan for another place: Plan's Tonight box → "Plan for another place" opens `openPlacePicker` (the light-pollution
  map: drag to pan, Closer/Wider over 5 spans, tap to drop a pin, or type coordinates; shows the spot's name from
  `LP_TOWNS` via `spotName` and its Bortle class). Stored as `plan.site {lat, lon, name}`. `withPlanSite(fn)` swaps the
  Sky's site to it while the plan and its suggestions are worked out (`renderPlan`, `fillPlanSuggestions`), and
  `here()` makes the map estimate, the 15 km check rule and the blocked sky (that place's saved one, if any) follow
  it. Your own location, the start screen and Observe are untouched. "Use where I am" clears it. The rating cache key
  now includes the place. `drawLightMap(cv, g, {center, pin, hLat, aspect})` returns its view for taps.
  Not done: the route preview from a plan elsewhere still uses your location.
- Town names: every place of 500+ people in the map's area from GeoNames cities500 (CC BY 4.0; 16,736 places after
  dropping neighbourhoods/historical; `tools/towns/build.py` → `docs/data/towns.txt`, 526 kB, ~250 kB gzipped,
  largest first). The Nov 2026 copy was taken in the built-in browser (range requests + DecompressionStream, cut to
  the area there). `docs/js/towns.js`: `loadTowns`, `nearestName` (dark-sky site within 6 km, else nearest town with a
  small preference for bigger ones, "near X, ON" beyond 3 km, none beyond 30 km), `DARK_SITES` (10 RASC/IDA sites,
  coordinates from Wikipedia and go-astronomy.com). The maps label dark-sky sites first (gold star), then towns by
  size until about one label per 3,500 px², skipping overlaps and keeping the scale bar and north clear.
  Known gap: GeoNames has no population for some hamlets (e.g. Bala, Washago), so they don't appear.
- Streets layer (with internet): the light-pollution maps are now Web Mercator (`drawLightMap` returns `px`/`ll`) so
  OpenStreetMap tiles line up; tiles for the view only (`osmTile`, in-memory cache of 300, browser HTTP cache does the
  rest; the service worker ignores cross-origin requests), under a dark veil with the Bortle colours at 40 % on top,
  "© OpenStreetMap" on the map, Hide/Show streets (`state.streets`), hidden when offline. Picker zooms to ~3 km.
  `appendUserAgent: "SkywardPushTo/1.0 (+https://tentelescopes.com)"` in capacitor.config.json (OSM requires an app
  to name itself). No offline download of street tiles (OSM policy forbids it).
  Coverage of the light-pollution map: 30°–50° N, 70°–100° W, ~5.65 million km², every cell has data; within ~250 km
  of the edges the sky glow is underestimated (towns beyond the edge are not counted).

## Build 102 (Nov 22)
- Start screen, Explore: Star alignment is offered as an optional stop ("optional — 2 min, makes the chart match the
  real sky"), off by default with its own switch (`state.launch.alignExplore`, `stepKey`), so ticking it for Explore
  doesn't change Observe's.
- Top-left telescope button reads "Scope:" over the name ("200 Visual"), two lines so it fits on a 375 px phone.
- Start screen path heading: "Start-up refinements — tap a star to add or skip one" (was "Your path — tap a star to skip a stop").
- Sky darkness check pictures also show the faintest-star magnitude, so "Two stars" (2.8) and "Three stars" (3.5) read differently though both are Bortle 9 (the scale lumps every sky brighter than about magnitude 4 into class 9).
- Streets contrast: tiles load with CORS and go through `contrastTile` (OSM pale-blue water → dark blue, white and coloured main roads kept bright, everything else ×0.55); veil 0.5 → 0.2 and Bortle colours 40 % → 32 %. If the tile server refuses CORS, the plain tile is used with the lighter veil. Checked with a stand-in tile in OSM colours; real tiles still to be seen on the phone.
- Web app (GitHub Pages) home-screen icon: a red monochrome version of the iPhone icon (Ten mark, Skyward, Push-To in red on near-black), icons/icon-192/512.png and a new 180 px icons/apple-touch-icon.png. The iPhone app keeps the full-colour icon (native/ios/AppIcon-1024.png). Phones show a new web icon only after removing the home-screen shortcut and adding it again from Safari.
- "This week's highlights" in Plan (above Suggestions): reads docs/data/highlights.json (`loadHighlights`,
  `fillHighlights`); the iPhone app tries the live GitHub Pages copy first, then its bundled one. Items past their end
  are hidden; "+ Plan" when `target` matches a catalogue object or planet (`hlTarget`). The file is written weekly
  by the "Eyepiece Daily debrief" scheduled task (claude.ai, 7:07 am Toronto) on a `highlights/<date>` branch with a
  pull request that the owner merges. Schema: { generated, validUntil, region, items: [{ id, title, start, end, look
  (eye|binoculars|telescope|any), what, why, target, source }] }. No file yet: the section stays hidden.
  The daily debrief page (feedback by taps) is a claude.ai artifact, not part of this repo.
- Owner's phone at a lake near Haliburton (45.04 N, 78.26 W; map: Bortle 4) still showed "your sky about Bortle 9"
  from an earlier check. `checkDoubt`: a check more than 2 mag/arcsec² brighter than the map for its spot is not used
  (clouds, haze, Moon, a nearby light or a test run); the result page and "Your sky" say why. Update location now
  writes why it failed under the button (`gpsError`), not only in a toast. Open question: on the owner's phone, Update
  location left the place "typed in" after he allowed location access; the new message should show the reason.

## Build 103 (Nov 23): meteor showers, northern lights, comets and novae
- New `docs/js/transients.js`:
  - `SHOWERS`: 12 major showers from the IMO 2026 calendar (Table 5), keyed by solar longitude so they work in any year. `activeShowers(date)` gives each active shower with a ZHR that falls off either side of the peak. `hourlyRate` = ZHR · sin(radiant altitude) / r^(6.5 − limiting magnitude).
  - Comet positions from orbital elements: Kepler, parabolic (Barker) or hyperbolic orbits, with one light-time step. Earth's position comes from Astronomy Engine. Tested: Mars from its orbital elements lands within 0.08′ of Astronomy Engine.
  - Comet magnitude = H + 5 log Δ + k log r.
  - Aurora: Kp forecast from NOAA SWPC (`noaa-planetary-k-index-forecast.json`, cached 30 min). The auroral oval edge is at about 66.5 − 2.05·Kp geomagnetic latitude, and the aurora counts as visible from here when that edge comes within 5° of the observer. Toronto sits at about 52.8° geomagnetic, so Kp 5+ is needed there.
  - Whether NOAA allows the web app to read it (CORS) is untested; if not, the aurora line simply doesn't appear.
- `highlights.json` takes two optional lists:
  - `comets: [{ id, name, tp, q, e, i, node, peri, H, k, coma, note, source }]`
  - `fixed: [{ id, name, ra, dec (degrees), mag, kind, note, source }]`
  - These become targets (`cm:` and `tr:` keys, types CM Comet / TR Nova-transient) that the app can point to and plan.
  - The Eyepiece Daily task prompt now asks for them, taken from JPL/MPC/COBS and AAVSO/TNS.
- Sky charts: `drawZones`
  - Each active shower gets a 40° dashed circle around its radiant, with marching-ants dashes, a pulsing stroke and twinkling streaks inside it. It is labelled "☄︎ Geminids radiant · meteors anywhere in the dashed circle", and the labels are kept inside the round chart (`labelX`).
  - When aurora is possible, a green dashed arc runs low in the north (azimuth 300°–60°).
  - Seen in a browser test with a mocked Geminid night: the circle, its label and the sparks all draw. The aurora arc has not been seen yet, because the test view never faced north.
- Plan, "Passing through" (`#pl-ev`, `fillEvents`): lists showers (peak status, best time tonight, about N an hour), comets and novae (magnitude, best time and altitude) and the aurora outlook, each with "+ Plan".
- `rate()` gives showers a level from the hourly rate (15+ → 0, 5+ → 1, 1+ → 2).
- Tests: `test/transients.test.mjs` (in `npm test`).
- Plan previews: tapping a target in "Your plan" did nothing; the rows had `data-goplan` but no handler. They now open
  the target sheet (eyepiece views, rating, best time), with arrows and swipes stepping through the plan. Not while
  reordering. Rows in "Passing through" and "This week's highlights" that have a target open it too. A meteor shower's
  sheet replaces the eyepiece views with a short "no telescope needed" note.
- Double-star power for unequal pairs (`splitArcsec` in vis.js): the apparent gap wanted grows from 4′ for pairs within
  2 magnitudes of each other to 15′ at 6 or more magnitudes apart. Polaris (18.4″, 2.0/9.1) now asks for about 49× (the
  10 mm) instead of 13× (the 23 mm). Observers report Polaris B at 37–74× in small scopes (Astronomy, April 2019).
  Almach goes from 26× to 38×; Albireo is unchanged.
