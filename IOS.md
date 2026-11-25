# Running Skyward Push-To as an iPhone app, with the native camera

The app is a web app (HTML and JavaScript). Capacitor puts it inside a native iPhone shell without rewriting it:
the `docs/` folder is the app, and Xcode builds the shell around it. Two small Swift files in `native/ios/` add
the one thing a web page cannot do on an iPhone: set the camera's exposure.

**Status:** none of this has been built or run by the author of these notes. The JavaScript side has been tested
against a pretend plug-in; the Swift has never been compiled. Expect an error or two on the first build and send
the red text back.

## 1. Install the tools on the Mac (once)

1. **Xcode 26 or newer** — App Store › search "Xcode" › Get. It is a large download. If the App Store says your
   macOS is too old, update macOS first. Open Xcode once, accept the licence, and install the **iOS** platform it offers.
2. **Command-line tools** — open Terminal and run `xcode-select --install` (if it says they are already installed, good).
3. **Node.js 22 or newer** — download the LTS installer from https://nodejs.org and run it. Check with `node --version`.
4. **GitHub Desktop** — sign in and clone `TenTelescopes/skyward-pushto`, the same repository the PC uses.

## 2. Create the iPhone project (once)

In Terminal:

    cd ~/Documents/GitHub/skyward-pushto      # wherever GitHub Desktop cloned it
    npm install
    npx cap add ios
    npm run ios:sync

`npx cap add ios` creates the `ios/` folder holding the Xcode project. `npm run ios:sync` copies the app into it and
runs `scripts/patch-native.mjs`, which does all the native set-up for you:

- the permission texts (camera, motion sensors, location) and portrait-only screen in `Info.plist`;
- keeping the screen awake while the app is open;
- copying `native/ios/SkyCamPlugin.swift` and `MyViewController.swift` into the project, adding them to the Xcode
  project file, and making the app start with `MyViewController` (Capacitor 8 creates the first screen in
  `SceneDelegate.swift`), which registers the camera plug-in.

The script is safe to run any number of times. Run `npm run ios:sync` after every change to the app.

## 3. Open it in Xcode and run it on your iPhone

    npx cap open ios

1. Click **App** at the very top of the left-hand list, then the **Signing & Capabilities** tab. Tick *Automatically
   manage signing* and pick your Apple ID as the Team (add it under Xcode › Settings › Accounts if it is not listed).
2. Plug the iPhone in and unlock it; tap **Trust** on the phone if asked. Turn on **Settings › Privacy & Security ›
   Developer Mode** on the phone (the switch appears after the phone has been connected to Xcode once) and restart
   when asked.
3. Choose the iPhone in the device menu at the top of the Xcode window and press the **Run** triangle.
4. The first time, the phone refuses to open the app: go to **Settings › General › VPN & Device Management**, tap your
   Apple ID and trust it. Press Run again.

If the build fails, click the red ⊗ at the top of the Xcode window to list the errors, and send them.

In the app, **More › Camera star finder › Start the camera**. If the native camera is in use, the sentence about "In
a web browser the phone chooses the exposure" is gone, and after a fix the technical report's "Single-frame time"
line mentions RAW.

## 4. Apple Weather (WeatherKit), once

The iPhone app adds Apple Weather to the night's forecast: dew, gusts, high cloud, and cloud anywhere in the world
(Environment Canada stays the main forecast: it is the only one with steadiness and clear-air). `npm run ios:sync`
copies in `SkyWeatherPlugin.swift`, adds it to the project, and writes `ios/App/App/App.entitlements` with the
WeatherKit entitlement. Then, once:

1. developer.apple.com → Certificates, Identifiers & Profiles → Identifiers → `com.tentelescopes.skyward`:
   tick **WeatherKit** under both **Capabilities** and **App Services**, and Save.
2. In Xcode, App target → **Signing & Capabilities**: check WeatherKit is listed (add it with **+ Capability** if not).
3. Build and run. Apple says a newly enabled WeatherKit can take about half an hour to start answering; until then
   (and in the web app) the forecast simply uses Environment Canada alone.

Apple's terms: wherever its weather appears, show the Apple Weather mark and the link to its other data sources. The
forecast panel does this. 500,000 calls a month come with the developer membership; the app asks once per place and
night and keeps the answer for 90 minutes.

## Day-to-day

- Change the app as before (files under `docs/`), then in Terminal `npm run ios:sync`, then Run in Xcode.
- `npm run ios:sync` also copies any new version of `native/ios/*.swift` into the project.
- Before working on either computer, pull in GitHub Desktop; afterwards, commit and push.
- Commit the `ios/` folder so the project is not lost. `node_modules/` stays out of the repository.
- With a free Apple ID the installed app stops opening after 7 days; press Run again to renew it. The paid
  developer programme removes that limit and adds TestFlight.

## What the plug-in does

`SkyCamPlugin.swift` opens the back wide camera using the whole 4:3 sensor, locks focus at infinity and offers five
calls to the app: `open`, `setExposure({ seconds, iso })`, `frame` (a small preview frame, shrunk by averaging),
`raw` and `close`.

`raw` takes a **Bayer RAW photo** (the sensor's own data, not Apple ProRAW, which is already processed) and adds up
each 2×2 block of photosites (one red, two green, one blue) after subtracting the sensor's black level, read from the
photo's DNG tags: "superpixel" binning, with no demosaicing, colour matrix or white balance. It returns 16-bit
brightness. If the RAW buffer is not in the expected layout, it falls back to having Apple develop the RAW linearly
(processing off) and averaging 2×2. If a phone offers no RAW at all, the app uses the preview frames. The technical
report says which happened.

The app learns the sensor's hot pixels by itself: a spot that stays on the same pixel in fixes taken in different parts
of the sky is a defect, and is ignored from then on. No dark frames are needed.

The app (`docs/js/camera.js`, class `NativeSkyCamera`) reads the sky's brightness from the RAW frames, sets the gain
and exposure to suit it (under a bright sky it turns the gain down before it shortens the exposure, so it needs fewer
photos), then collects frames, lines them up, and recognises the stars exactly as the web version does.

