# Handoff notes for the next working session

Read this first, then `README.md`. Written 2026-11-16 at Build 40.

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

- Unit tests: `npm test` (9 files in `test/`). All pass at Build 40.
- Browser walkthroughs: `tools/walk/` (Playwright, iPhone-sized). Serve `docs/` first: `python3 -m http.server 8765`
  from `docs/`, then `node tools/walk/<script>.js`. They load `http://localhost:8765/?sim`, which shows a
  "Simulate sensors" button on the start screen. In the page, `window.sim` is the simulated phone (`bend`, `noise`,
  `trueOffset`, `alpha`, `beta`) and `window.simGoto(label)` points the simulated scope at an object.
  - `walk2.js`, `walk3.js`, `walk4.js`: every screen, secondary flows, no-sensor paths (look for `errors: []`).
  - `sky31.js`: the sky darkness check pictures.
  - `look28.js`: splash, start screen, Day/Night fader, in-app look (screenshots).
  - `guess27.js`: unaligned sky view with no compass, direction set by hand, no sensor data.
  - `corr.js`, `jump.js`, `domeshot.js`: sky correction end to end, heading jumps, the dome card (slow: allow 5–10 min).
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
- Eyepiece apparent field: 62° assumed for the 23, 10 and 4 mm. 200 Visual focal length: 812 mm assumed.
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
