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
