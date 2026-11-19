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
