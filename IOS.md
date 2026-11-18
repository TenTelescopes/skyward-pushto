# Running Skyward Push-To as an iPhone app

The app is a web app (HTML and JavaScript). Capacitor puts it inside a native iPhone shell without rewriting it:
the `docs/` folder is the app, and Xcode builds the shell around it. Nothing here has been built or run by the
author of these notes; expect to hit an error or two and send them back.

## 1. Install the tools on the Mac (once)

1. **Xcode** — open the App Store on the Mac, search "Xcode", install. It is large. Open it once and accept the
   licence; let it install the iOS components it offers.
2. **Node.js** — download the LTS installer from https://nodejs.org and run it.
3. **GitHub Desktop** — sign in and clone `TenTelescopes/skyward-pushto`, the same repository the PC uses.

## 2. Create the iPhone project (once)

Open Terminal, then:

    cd ~/Documents/GitHub/skyward-pushto      # wherever GitHub Desktop cloned it
    npm install @capacitor/core @capacitor/cli @capacitor/ios
    npx cap add ios

This creates an `ios/` folder containing the Xcode project. `capacitor.config.json` (already in the repository)
tells it the app's name, its identifier and that the web files are in `docs/`.

## 3. Let the app use the camera and motion sensors (once)

In Xcode's left-hand list open **App › App › Info** and add two rows:

| Key | Value |
|---|---|
| Privacy - Camera Usage Description | Skyward uses the camera to find stars and work out where the telescope is pointing. |
| Privacy - Motion Usage Description | Skyward uses the motion sensors to follow where the telescope is pointing. |

Without the camera row the app is closed by iOS the moment it asks for the camera.

## 4. Build and run on your iPhone

    npx cap sync ios        # copies docs/ into the iPhone project; run this after every change to the app
    npx cap open ios        # opens Xcode

In Xcode:

1. Click **App** at the top of the left-hand list, then the **Signing & Capabilities** tab. Tick *Automatically
   manage signing* and choose your Apple ID as the Team (add it under Xcode › Settings › Accounts if it is not listed).
2. Plug the iPhone in. On the phone, turn on **Settings › Privacy & Security › Developer Mode** (it appears after
   the phone has been connected to Xcode once) and restart when asked.
3. Pick the iPhone in the device menu at the top of the Xcode window and press the **Run** triangle.
4. The first time, the phone refuses to open the app: go to **Settings › General › VPN & Device Management**, tap
   your Apple ID and trust it. Run again.

With a free Apple ID the app stops opening after 7 days; press Run again to renew it. The paid developer
programme removes that limit and adds TestFlight.

## 5. What works at this stage

Everything the website does, including **More › Camera star finder**: with the phone mounted looking along the
tube it collects light, ignores trees and buildings, recognises the stars and aligns or syncs the pointing from them. Inside this shell the camera has the same limits as in
Safari: the phone, not the app, chooses the exposure.

## 6. Next: native camera control (not written yet)

The reason to go native is exposure control. That needs a small Swift plug-in that sets the exposure time and
gain, adds frames together, and hands the result to the existing JavaScript (`docs/js/skycam.js` decides the
exposure from the sky brightness; `docs/js/solve.js` matches the stars). It is deliberately left until the steps
above work on your Mac, because Swift errors can only be seen and fixed there.

## Day-to-day

- Change the app as before (files under `docs/`), then `npx cap sync ios` and Run in Xcode.
- Commit the `ios/` folder so the project is not lost. `node_modules/` should stay out of the repository.
