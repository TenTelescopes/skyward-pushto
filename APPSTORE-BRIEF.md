# Skyward Push-To — brief for the pre-App-Store audit

Start here in a fresh session. Read this, then `HANDOFF.md` (build-by-build history, newest at the bottom),
`AUDIT.md` (the Build 73 usability audit and what was fixed) and `IOS.md`. The app is at Build 90 (Nov 20 2026).

## What the app is

An offline push-to guide for Ten Telescopes' open-source, 3D-printed Skyward telescopes (Skyward 150 Compact,
Skyward 200 Visual f/4). The phone sits on the telescope; its motion sensors show where the telescope points and
arrows lead to targets. Also: planner, observing log, Messier marathon and games, phone check-up, blocked-sky
tracing, camera star finder (plate solving with frame stacking), guided camera / eyepiece / red-dot finder line-up,
laser collimation guide.

- Web app (vanilla ES modules) in `docs/`, served by GitHub Pages: https://tentelescopes.github.io/skyward-pushto/
- Native iPhone app: the same `docs/` wrapped with Capacitor 8 (`ios/`), plus a Swift camera plug-in
  (`native/ios/SkyCamPlugin.swift`: manual exposure/ISO, 4×4 superpixel-binned Bayer RAW, 14-bit buffer).
  `scripts/patch-native.mjs` re-applies every native change after `npx cap sync` (Info.plist strings, icon,
  splash, plug-in files and registration). `npm run ios:sync` does both.
- Android: not built yet; the web camera path is its fallback.

## Ground rules from the owner (keep these)

- Audience: beginners, school groups, first-time observers. Practical, few hurdles, plain words.
- Be direct and evidence-based. Say plainly what is untested; never present a guess as fact.
- The owner commits and pushes himself (GitHub Desktop). Ask before committing, pushing, publishing or posting.
- Public repo: no personal names, no email addresses, nothing private in files.
- When the owner wants to talk something through, discuss before building.
- After each change that reaches the phone or the web, give the build label to look for
  (`<p id="build">Build NN · Mon DD</p>` in `docs/index.html`; bump the cache name in `docs/sw.js` with it) and the
  link https://tentelescopes.github.io/skyward-pushto/

## How to test

- Unit tests: `npm test` (Node only).
- Walks: end-to-end in Chromium with Playwright (`tools/walk/*.js`; run as CommonJS — copy to `.cjs` — with
  `docs/` served on port 8765). Camera walks use a fake camera video:
  `gunzip -k tools/walk/media/orion-1280x720.y4m.gz` (synthetic Orion field, RA 83.8° Dec −1.2°, with a
  foreground), then e.g. `node b90.cjs orion-1280x720.y4m`, `node b78.cjs out orion-1280x720.y4m`,
  `node b87.cjs orion-1280x720.y4m`. Passing at Build 90: b75, b78, b87, b90. The older walks b58–b66 stop at a
  dialog that later builds added: update or retire them.
- iPhone: `npx cap open ios`, ▶ in Xcode onto an iPhone 16 Pro (iOS 26). On the Mac, `xcodebuild` can compile
  the Swift plug-in to catch errors before the owner runs it.

## Known gaps (from real-phone tests, Nov 19–20)

Camera / plate solving
- First real-sky native fix worked: handheld, one 1 s RAW frame at ISO 800, Orion solved blind, 18 of 20 stars,
  fit 1.94 px (9.5′). The fit is loose: add a radial lens-distortion term to the solver's refine step.
- About 1 s of overhead per RAW photo (AVCapturePhotoOutput). Look for faster capture (bursts, smaller RAW, or
  stacking video frames where they are good enough).
- RAW analogue gain stops between ISO 400 and 1600 on this phone (capped at 800). The sky mask counts dark tree
  silhouettes as sky. "Stop and use what I have" is not exercised by a walk.
- The guided line-up (camera + eyepiece + red-dot finder) has only run in walks, never on a telescope.
- Wanted: save the stacked picture (PNG; maybe 16-bit FITS/TIFF for astronomy software).

App / UX
- `docs/camtest.html` was to be removed (owner: "ditch camtest").
- No landscape layout (side-mounted phones); iPad not designed for — make the iOS target iPhone-only.
- Collimation page uses drawings from the original Skyward 150 manual; the Compact may differ. The owner may have
  a newer manual with a laser-collimation section.
- Open items in `AUDIT.md`: plan edit mode, toasts over content, rise/transit/set times, help/feedback entry.

App Store readiness
- Still to do: paid Apple Developer account (owner), signing team, iPhone-only target,
  `ITSAppUsesNonExemptEncryption = NO`, version and build numbers, privacy policy page on tentelescopes.com (no data
  collected; location stays on the phone), store listing, 6.9-inch iPhone screenshots, notes for the reviewer (no
  telescope: how to try Explore, what the camera and sensors are for).
- Guideline 4.2 risk (a website in a wrapper): the native camera control and sensors help; make that value obvious.
- The owner's Mac is an Intel MacBook Pro with Xcode 26.6: fine for uploads now. Apple usually raises the required
  Xcode each spring and Xcode 27 needs Apple silicon, so uploads from this Mac likely end around spring 2027.

## Suggested order

1. Walk every screen as a beginner would, on a phone-sized viewport, in the Day and Night looks; read the code.
2. List problems by severity: wrong pointing, data loss, crashes first; then confusing steps; then polish.
3. Agree the list with the owner before large changes.
4. Fix in small builds, each with tests and a build label; keep `HANDOFF.md` current.
5. App Store preparation, then TestFlight with the blog-post testers, then submission.
