# Skyward Push-To

**Try it on a phone:** https://tentelescopes.github.io/skyward-pushto/ (GitHub Pages, served from `docs/`)

Offline push-to guidance and sensor testing for Ten Telescopes' **Skyward 150 Compact** and **Skyward 200 Visual**.
The phone rides in the Skyward bridge mount (screen up, top edge toward the sky end) and tells you which way to push.

Everything runs on the phone: catalog, star positions, planets and Moon (computed on-device), and all pointing math.
No network is needed after installation. GPS is optional and also works with no cell signal.

## What's in it

- **Find**: Messier (110), Caldwell (109), Herschel 400, RASC double stars (110), SAC named asterisms (114), planets and Moon, and 78 bright stars.
  It can show only objects above your horizon, sorted by catalog number, altitude or brightness.
- **Push**: azimuth and altitude deltas, and a zoomable chart (pinch, or buttons from eyepiece field out to 60°) with the eyepiece's true field drawn to scale.
  The chart shows stars to magnitude 8 when zoomed in and constellation figures and the horizon when zoomed out, so you can match the star pattern to what you see.
  It can centre on the target to preview a field before you push, and it has one-tap **Sync** when the target is centred.
- **Align**: gyro azimuth with star alignment. Two or three stars solve the phone-to-tube tilt in the bridge mount.
  You save that tilt per scope, and after that one star is enough each night. Syncs measure gyro drift, and you can choose to apply that drift.
- **Phone check** (first thing a new user sees): a 4-minute guided test, no stars needed, that grades the phone in its mount as Solid / Usable / Poor / Not suitable.
  It checks for a gyroscope, tilt-sensor consistency (table reversal), and jitter and drift while still. A horizon-to-zenith sweep finds the altitude where azimuth stops being reliable and separates phone-not-square geometry from sensor error, with an optional altitude zero if the tube is confirmed horizontal using a level. Full turns at the horizon give return error, tilt error while moving, how level the base is, and compass distortion, all without stars. Each one is graded against the field of the eyepiece you'll use.
  The cut-offs are design choices, not yet validated on many phones. Raw numbers are saved with the phone model so the thresholds can be tuned from real results.
- **Accuracy-aware chart**: after a Phone check, the app estimates pointing uncertainty live. It combines jitter, gyro drift × time since the last sync, slew error × distance from the last sync, and the alignment fit.
  The chart won't zoom tighter than about 3× that uncertainty, draws it as a dashed circle, says "sweep or sync" instead of "in the field" when the uncertainty is wider than the eyepiece, and flags eyepieces narrower than the phone can support.
- **Guided alignment**: the app picks bright stars at good heights (a second star well separated, to calibrate the phone tilt) and gives plain directions ("about 4 fists up in the west, the brightest star in Lyra") with a finder chart.
  Altitude guidance works before alignment, since gravity gives altitude. A wrong-star check compares the scope's altitude, and the angle between the two stars, with the catalogue.
- **Long-push stopovers**: when the estimated error at a far target exceeds the eyepiece field, Push suggests a bright check star near the target. After you sync there it returns you to the target with a smaller error.
- **Sky-consistency dome** (Align tab): every centred object (alignment, syncs, accuracy test) is plotted on a dome, looking up, as truth vs what the sensors said. The azimuth offset, phone tilt and gyro drift are removed first, so only distortion remains, drawn as a warped mesh. White is the true sky; the mesh is coloured by local mismatch against the eyepiece field: green perfect (≤ r/10), blue good (≤ r/4), yellow fair (≤ r/2), red poor. A Red-only switch keeps night vision at the eyepiece.
  There's also a model-free pair-distance check. Points that disagree with the rest are named, with a Remove button.
- **Where am I**: Push shows live which constellation you're in, using the official IAU boundaries (B1875, Stellarium/pbarbier data). The lookup was checked against all 669 catalog objects' listed constellations, with 669/669 matching. It also shows any named asterism you're inside and the nearest named star or Messier object. The line flashes when you cross into a new constellation.
- **Auto-zoom while slewing**: the chart zooms out (20–50° depending on speed) while the scope is moving and eases back when it settles. **Lock** keeps the zoom fixed.
- **Game**: the app picks the best 10 targets for your sky, scope and time. The rules: 25–80° up, within the scope's reach, a mix of types, spread out, twilight-aware. It plans a short route, then times you, and each find is confirmed by holding the target in the eyepiece field for 2 seconds.
  Three styles: **Push race** (arrows), **Star-hop** (finder chart only), **Hybrid** (Hint shows arrows for 10 s, +30 s penalty). Skip costs 120 s. Ranking is targets found first, then time.
  - **Same site, offline**: the host shows a challenge QR code and others scan it (or paste the code) to play the identical 10 in the same order. Afterwards, players scan each other's result codes into a local table. Codes carry a checksum, so edited codes are rejected.
  - **Remote**: scores post to the Ten Telescopes Wix site (CMS collection `SkywardScores`) through a public Wix headless client id with anonymous visitor tokens. Anyone can add and read; only the site owner can edit or delete. Without signal, scores are queued and sent later.
    Players at other sites can play the same challenge code; targets not above 20° there are left out without penalty.
  - **Honest limits**: results are sensor-confirmed but not cheat-proof. Anyone determined could post fake rows, and the site owner can delete them in the Wix CMS.
- **Get observing** (Find tab): a checklist that ticks itself off. It covers whether the phone is tested (skipped once a Phone check exists), location (GPS fetched automatically the first time), and alignment (1 star when the mount tilt is saved). It ends with tonight's best six targets, one tap each to start pushing.
- **In the eyepiece** (Push tab): the target centred in the 23, 10 or 4 mm eyepiece, drawn to scale.
  Stars come from Hipparcos to magnitude 8. Deep-sky shapes use their OpenNGC size and position angle, and planet discs use their real size tonight. It's shown in the orientation your Newtonian gives, computed from the scope's altitude and the focuser position, assuming your head is upright. It has N, E and zenith markers, and reports magnification, true field and exit pupil. Brightness dims with exit pupil² for extended objects, but not for stars.
- **Test**: four detailed sensor tests, saved and exportable as CSV or JSON:
  - *Precision & drift*: scope untouched. Reports noise (1σ, peak-to-peak) and drift rate for the gyro and the compass.
  - *Repeatability*: return to the same land or sky target several times and report the scatter. Sky motion is removed for sky targets.
  - *Level bias (reversal)*: phone flat, then rotated 180°. Separates accelerometer bias from table tilt with no reference.
  - *Sky accuracy*: centre known stars. Reports altitude error, compass error and a compass deviation curve versus azimuth (picks up nearby steel), plus the aligned push-to error.
- **Setup**: scope presets, eyepieces (with a drift-timing tool to measure true field), mounting, compass or gyro mode, location, red brightness.

## Build the iOS and Android apps

You need Node 20+, then **Xcode** on a Mac for iOS and **Android Studio** for Android.

```bash
npm install
npm run native:add      # creates ios/ and android/, copies the Capacitor runtime, applies permissions/portrait/keep-awake
npm run native:icons    # app icons + splash from assets/icon.png
npm run ios             # opens Xcode: pick your team under Signing, then Run on a device
npm run android         # opens Android Studio: Run, or Build > Build APK(s)
```

After changing anything in `docs/`, run `npm run sync` (or `npm run ios` / `npm run android`).

`scripts/patch-native.mjs` adds the motion and location usage strings (iOS), location permissions (Android), portrait lock, and a keep-screen-on flag.
It is safe to run repeatedly. It was checked against the Capacitor 8.6 project templates.

### Desktop testing

`npm run serve`, then open `http://localhost:8080/index.html?sim=1` and choose **Simulate sensors**.
The arrow keys move the simulated scope (Shift for fine moves). In the console, `sim.drift` (°/min), `sim.noise` (°) and `sim.trueOffset` (°) change its behaviour.

## Tests

`npm test` runs the pointing-math tests (Euler→pointing, alignment recovery with exact and noisy synthetic data for all three mountings, guidance, projection, compass deviation fit).

## How the pointing works

- Altitude comes from gravity, so it is absolute. The mount doesn't need to be level.
- Gyro azimuth has an arbitrary zero. One centred star sets the offset θ.
- The phone never sits perfectly parallel to the tube. Two or more stars solve that tilt (two angles) by least squares, and it is saved per scope.
- Gyro azimuth drifts slowly. **Sync** on anything you centre resets θ. Two syncs at least 2 minutes apart give a measured drift rate, which you can apply.
- Compass mode skips alignment and uses the magnetometer plus a correction (true − magnetic). The Sky accuracy test measures that correction for you.
- Near the zenith the phone is vertical and azimuth readings become unstable. Every phone-sensor push-to has this limit.

## Rebuilding the catalog

`tools/build_catalog.py` regenerates `docs/data/catalog.js` from OpenNGC and the PiFinder catalog lists:

```bash
git clone --depth 1 https://github.com/mattiaverga/OpenNGC ../data/OpenNGC
git clone --depth 1 https://github.com/brickbots/PiFinder ../data/PiFinder
npm run catalog
```

## Credits and licences

- App code: MIT (see `LICENSE`).
- Astronomy Engine © Don Cross, MIT (`docs/vendor/astronomy-engine.LICENSE`).
- Deep-sky data from OpenNGC © Mattia Verga, CC BY-SA 4.0. `docs/data/catalog.js` is a derived work under the same licence.
- The Caldwell, Herschel 400, RASC double-star and bright-star selections were compiled from the PiFinder project's `astro_data` files.
  Only identifiers, positions and numeric data were taken; no descriptive text.
- QR codes: qrcode-generator © Kazuhiko Arase (MIT); jsQR (Apache-2.0).
- Star field: Hipparcos main catalogue (ESA 1997), stars to V 8.0 with proper motion applied to J2000.
- Constellation figures: Stellarium 'modern' sky culture. Named asterisms: Saguaro Astronomy Club asterism list v3.2 (names, positions and sizes only).
- Scope specs come from the TenTelescopes Skyward150 and Skyward200 repositories (CC BY-NC 4.0).
