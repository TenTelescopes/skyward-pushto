// Idempotent patches applied after `npx cap add` / `npx cap sync`:
//  - iOS: motion + location + camera usage strings, portrait only, keep screen awake,
//         the Skyward camera and Apple Weather plug-ins (native/ios/*.swift copied in, added to the Xcode project,
//         registered) and the WeatherKit entitlement
//  - Android: location permissions, portrait only, keep screen awake
import fs from 'node:fs';
const log = (m) => console.log('[patch-native] ' + m);
const edit = (file, fn) => { if (!fs.existsSync(file)) return log(`skip ${file} (platform not added)`); const a = fs.readFileSync(file, 'utf8'); const b = fn(a); if (a !== b) { fs.writeFileSync(file, b); log(`patched ${file}`); } else log(`ok ${file}`); };

// ---- iOS
edit('ios/App/App/Info.plist', (s) => {
  const add = (key, xml) => s.includes(`<key>${key}</key>`) ? s : s.replace(/<dict>/, `<dict>\n\t<key>${key}</key>\n\t${xml}`);
  s = add('NSMotionUsageDescription', '<string>Motion sensors measure where your telescope is pointing.</string>');
  s = add('NSCameraUsageDescription', '<string>The camera finds stars to work out where your telescope is pointing, and scans game codes from other players\' phones.</string>');
  s = add('NSPhotoLibraryAddUsageDescription', '<string>Saves your camera star-finder pictures to Photos. The app never reads your photos.</string>');
  s = add('NSLocationWhenInUseUsageDescription', '<string>Your location is used to compute where objects are in your sky. It never leaves the phone.</string>');
  // App Store: the app uses only the encryption built into iOS (HTTPS), which is exempt; saves a question on every upload.
  s = add('ITSAppUsesNonExemptEncryption', '<false/>');
  s = s.replace(/(<key>UISupportedInterfaceOrientations<\/key>\s*<array>)[\s\S]*?(<\/array>)/, '$1\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t$2');
  s = s.replace(/(<key>UISupportedInterfaceOrientations~ipad<\/key>\s*<array>)[\s\S]*?(<\/array>)/, '$1\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t$2');
  return s;
});
edit('ios/App/App/AppDelegate.swift', (s) => s.includes('isIdleTimerDisabled') ? s :
  s.replace(/(didFinishLaunchingWithOptions[^{]*\{)/, '$1\n        // Keep the screen on while observing\n        UIApplication.shared.isIdleTimerDisabled = true'));

// ---- iOS: the Skyward camera plug-in (native exposure control and RAW frames)
if (fs.existsSync('ios/App/App')) {
  const SWIFT = ['SkyCamPlugin.swift', 'MyViewController.swift', 'SkyWeatherPlugin.swift'];
  for (const f of SWIFT) {
    const from = `native/ios/${f}`, to = `ios/App/App/${f}`;
    if (!fs.existsSync(from)) { log(`missing ${from}`); continue; }
    const a = fs.readFileSync(from, 'utf8'), b = fs.existsSync(to) ? fs.readFileSync(to, 'utf8') : null;
    if (a !== b) { fs.writeFileSync(to, a); log(`copied ${from} → ${to}`); } else log(`ok ${to}`);
  }
  // Add the two files to the Xcode project: file references, the App group, and the Sources build phase.
  // Fixed ids (any 24 hex digits unique in the project will do); the patch is skipped if the files are already listed.
  edit('ios/App/App.xcodeproj/project.pbxproj', (s) => {
    if (s.includes('SkyCamPlugin.swift')) return s;
    const F = [['SkyCamPlugin.swift', 'A15C0DE0000000000000F001', 'A15C0DE0000000000000B001'], ['MyViewController.swift', 'A15C0DE0000000000000F002', 'A15C0DE0000000000000B002']];
    for (const [name, ref, build] of F) {
      s = s.replace('/* End PBXBuildFile section */', `\t\t${build} /* ${name} in Sources */ = {isa = PBXBuildFile; fileRef = ${ref} /* ${name} */; };\n/* End PBXBuildFile section */`);
      s = s.replace('/* End PBXFileReference section */', `\t\t${ref} /* ${name} */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ${name}; sourceTree = "<group>"; };\n/* End PBXFileReference section */`);
      s = s.replace(/(\/\* App \*\/ = \{\s*isa = PBXGroup;\s*children = \()/, `$1\n\t\t\t\t${ref} /* ${name} */,`);
      s = s.replace(/(\/\* Sources \*\/ = \{\s*isa = PBXSourcesBuildPhase;\s*buildActionMask = \d+;\s*files = \()/, `$1\n\t\t\t\t${build} /* ${name} in Sources */,`);
    }
    return s;
  });
  // Apple Weather plug-in (Build 111): add it to the Xcode project the same way, if it isn't there yet.
  edit('ios/App/App.xcodeproj/project.pbxproj', (s) => {
    if (s.includes('SkyWeatherPlugin.swift')) return s;
    const [name, ref, build] = ['SkyWeatherPlugin.swift', 'A15C0DE0000000000000F003', 'A15C0DE0000000000000B003'];
    s = s.replace('/* End PBXBuildFile section */', `\t\t${build} /* ${name} in Sources */ = {isa = PBXBuildFile; fileRef = ${ref} /* ${name} */; };\n/* End PBXBuildFile section */`);
    s = s.replace('/* End PBXFileReference section */', `\t\t${ref} /* ${name} */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ${name}; sourceTree = "<group>"; };\n/* End PBXFileReference section */`);
    s = s.replace(/(\/\* App \*\/ = \{\s*isa = PBXGroup;\s*children = \()/, `$1\n\t\t\t\t${ref} /* ${name} */,`);
    s = s.replace(/(\/\* Sources \*\/ = \{\s*isa = PBXSourcesBuildPhase;\s*buildActionMask = \d+;\s*files = \()/, `$1\n\t\t\t\t${build} /* ${name} in Sources */,`);
    return s;
  });
  // WeatherKit capability: the entitlement file, and the build setting that points at it (both configurations).
  // Opt-in: only once WeatherKit is switched on for the App ID (create the empty file native/ios/WEATHERKIT_ON), because
  // signing fails without it ("provisioning profile doesn't include the WeatherKit capability"). Without it the app
  // builds and the forecast simply uses Environment Canada.
  if (!fs.existsSync('native/ios/WEATHERKIT_ON')) {
    edit('ios/App/App.xcodeproj/project.pbxproj', (s) => s.replace(/\n\t*CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/g, ''));
  } else {
  const ENT = 'ios/App/App/App.entitlements';
  const entXml = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n\t<key>com.apple.developer.weatherkit</key>\n\t<true/>\n</dict>\n</plist>\n';
  if (!fs.existsSync(ENT)) { fs.writeFileSync(ENT, entXml); log(`created ${ENT}`); }
  else edit(ENT, (s) => s.includes('com.apple.developer.weatherkit') ? s : s.replace(/<dict>/, '<dict>\n\t<key>com.apple.developer.weatherkit</key>\n\t<true/>'));
  edit('ios/App/App.xcodeproj/project.pbxproj', (s) => s.includes('CODE_SIGN_ENTITLEMENTS') ? s
    : s.replace(/(PRODUCT_BUNDLE_IDENTIFIER = com\.tentelescopes\.skyward;)/g, 'CODE_SIGN_ENTITLEMENTS = App/App.entitlements;\n\t\t\t\t$1'));
  }
  // Capacitor 8 builds its window in SceneDelegate; use our view controller there so the plug-in gets registered.
  edit('ios/App/App/SceneDelegate.swift', (s) => s.replace('window?.rootViewController = CAPBridgeViewController()', 'window?.rootViewController = MyViewController()    // registers the Skyward camera plug-in'));
  // Older templates use the storyboard instead.
  // Optimise Swift even in Debug builds (Xcode's ▶ Run): the RAW binning loop took ~2 s per picture unoptimised.
  edit('ios/App/App.xcodeproj/project.pbxproj', (s) => s.replace(/SWIFT_OPTIMIZATION_LEVEL = "-Onone";/g, 'SWIFT_OPTIMIZATION_LEVEL = "-O";'));
  // iPhone only (no iPad layout yet; an iPad target would need iPad screenshots and an iPad review).
  // Build number = the app's build label in docs/index.html ("Build NN"), so every upload to Apple is new and matches the app.
  const buildNo = (fs.readFileSync('docs/index.html', 'utf8').match(/id="build"[^>]*>Build (\d+)/) || [])[1];
  edit('ios/App/App.xcodeproj/project.pbxproj', (s) => {
    s = s.replace(/TARGETED_DEVICE_FAMILY = "1,2";/g, 'TARGETED_DEVICE_FAMILY = 1;');
    if (buildNo) s = s.replace(/CURRENT_PROJECT_VERSION = \d+;/g, `CURRENT_PROJECT_VERSION = ${buildNo};`);
    return s;
  });
  // Home-screen icon and launch picture (the Skyward on a night sky): replace Capacitor's placeholders.
  const copyBin = (from, to) => { if (!fs.existsSync(from) || !fs.existsSync(to.replace(/\/[^/]+$/, ''))) return log(`skip ${to}`); const a = fs.readFileSync(from), b = fs.existsSync(to) ? fs.readFileSync(to) : null; if (!b || !a.equals(b)) { fs.writeFileSync(to, a); log(`copied ${from} → ${to}`); } else log(`ok ${to}`); };
  copyBin('native/ios/AppIcon-1024.png', 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
  for (const s of ['', '-1', '-2']) copyBin('native/ios/splash-2732.png', `ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732${s}.png`);
  edit('ios/App/App/Base.lproj/Main.storyboard', (s) => s.replace('customClass="CAPBridgeViewController" customModule="Capacitor"', 'customClass="MyViewController" customModuleProvider="target"'));
}

// ---- Android
edit('android/app/src/main/AndroidManifest.xml', (s) => {
  for (const p of ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'CAMERA']) if (!s.includes(`android.permission.${p}`)) s = s.replace(/<\/manifest>/, `    <uses-permission android:name="android.permission.${p}" />\n</manifest>`);
  if (!s.includes('android.hardware.location.gps')) s = s.replace(/<\/manifest>/, '    <uses-feature android:name="android.hardware.location.gps" android:required="false" />\n</manifest>');
  if (!s.includes('android:screenOrientation')) s = s.replace(/<activity\b/, '<activity\n            android:screenOrientation="portrait"');
  return s;
});
const mainAct = (() => { const base = 'android/app/src/main/java'; if (!fs.existsSync(base)) return null; const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : e.name === 'MainActivity.java' ? [`${d}/${e.name}`] : []); return walk(base)[0]; })();
if (mainAct) edit(mainAct, (s) => s.includes('FLAG_KEEP_SCREEN_ON') ? s : s
  .replace(/import com\.getcapacitor\.BridgeActivity;/, 'import com.getcapacitor.BridgeActivity;\nimport android.os.Bundle;\nimport android.view.WindowManager;')
  .replace(/public class MainActivity extends BridgeActivity \{\s*\}/, 'public class MainActivity extends BridgeActivity {\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n        super.onCreate(savedInstanceState);\n        // Keep the screen on while observing\n        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);\n    }\n}'));
else log('skip MainActivity (android not added)');
