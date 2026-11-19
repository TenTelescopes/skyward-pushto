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
    npm install @capacitor/core @capacitor/cli @capacitor/ios
    npx cap add ios
    npx cap sync ios
    npx cap open ios

`npx cap add ios` creates an `ios/` folder holding the Xcode project; the last command opens it in Xcode.
`capacitor.config.json` (already in the repository) supplies the app's name, its identifier and the `docs/` folder.

## 3. Permissions (once)

In Xcode's left-hand list open **App › App › Info** (the file `Info.plist`) and add two rows with the + button:

| Key | Value |
|---|---|
| Privacy - Camera Usage Description | Skyward uses the camera to find stars and work out where the telescope is pointing. |
| Privacy - Motion Usage Description | Skyward uses the motion sensors to follow where the telescope is pointing. |

Without the camera row, iOS closes the app the moment it asks for the camera.

## 4. Signing, and a first run without the native camera

1. Click **App** at the very top of the left-hand list, then the **Signing & Capabilities** tab. Tick *Automatically
   manage signing* and pick your Apple ID as the Team (add it under Xcode › Settings › Accounts if it is not listed).
2. Plug the iPhone in and unlock it. On the phone, turn on **Settings › Privacy & Security › Developer Mode**
   (the switch appears after the phone has been connected to Xcode once) and restart when asked.
3. Choose the iPhone in the device menu at the top of the Xcode window and press the **Run** triangle.
4. The first time, the phone refuses to open the app: go to **Settings › General › VPN & Device Management**, tap
   your Apple ID and trust it. Press Run again.

You should see the normal start screen with the build number. **Stop here and check it works** before step 5.
At this stage More › Camera star finder uses the same camera a web page gets.

## 5. Add the native camera

1. In Finder, open the repository's `native/ios/` folder. Drag **SkyCamPlugin.swift** and **MyViewController.swift**
   onto the yellow **App** folder (the inner one, next to `AppDelegate.swift`) in Xcode's left-hand list. In the
   sheet that appears, tick **Copy items if needed** and make sure the **App** target is ticked.
2. In the left-hand list click **Main** (the file `Main.storyboard`). In the outline that opens, click
   **Bridge View Controller**. Open the right-hand panel (View › Inspectors › Identity) and change **Class** from
   `CAPBridgeViewController` to `MyViewController`. Tick **Inherit Module From Target** if it is not ticked.
3. Press **Run**.

In the app, open **More › Camera star finder › Start the camera**. If the native camera is in use, the sentence
about "In a web browser the phone chooses the exposure" is gone, and after a fix the technical report's
"Single-frame time" line ends with **set by the app**.

If the build fails, copy the red error lines (click the red ⊗ at the top of the Xcode window to list them).

## Day-to-day

- Change the app as before (files under `docs/`), then in Terminal `npx cap sync ios`, then Run in Xcode.
- If `native/ios/*.swift` changes in the repository, copy the new version over the one inside `ios/App/App/`.
- Commit the `ios/` folder so the project is not lost. `node_modules/` stays out of the repository.
- With a free Apple ID the installed app stops opening after 7 days; press Run again to renew it. The paid
  developer programme removes that limit and adds TestFlight.

## What the plug-in does

`SkyCamPlugin.swift` opens the back wide camera using the whole 4:3 sensor, locks focus at infinity and offers five
calls to the app: `open`, `setExposure({ seconds, iso })`, `frame` (a small preview frame, shrunk by averaging),
`raw` and `close`.

`raw` takes a **Bayer RAW photo** (the sensor's own data, not Apple ProRAW, which is already processed), develops it
**linearly** with noise reduction, sharpening, contrast and tone mapping switched off and lens distortion corrected,
then averages every 2×2 block of pixels itself, so every pixel's light is counted by our code. It returns 16-bit
brightness. If a phone offers no RAW, the app falls back to the preview frames and says so in the technical report.

The app (`docs/js/camera.js`, class `NativeSkyCamera`) reads the sky's brightness from the RAW frames, sets the gain
and exposure to suit it (under a bright sky it turns the gain down before it shortens the exposure, so it needs fewer
photos), then collects frames, lines them up, and recognises the stars exactly as the web version does.

If you added the Swift files before Build 83, copy the new `native/ios/SkyCamPlugin.swift` over the one in Xcode's
App folder (or delete it there and drag the new one in again).
