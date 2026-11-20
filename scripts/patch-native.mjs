// Idempotent patches applied after `npx cap add` / `npx cap sync`:
//  - iOS: motion + location + camera usage strings, portrait only, keep screen awake,
//         and the Skyward camera plug-in (native/ios/*.swift copied in, added to the Xcode project, registered)
//  - Android: location permissions, portrait only, keep screen awake
import fs from 'node:fs';
const log = (m) => console.log('[patch-native] ' + m);
const edit = (file, fn) => { if (!fs.existsSync(file)) return log(`skip ${file} (platform not added)`); const a = fs.readFileSync(file, 'utf8'); const b = fn(a); if (a !== b) { fs.writeFileSync(file, b); log(`patched ${file}`); } else log(`ok ${file}`); };

// ---- iOS
edit('ios/App/App/Info.plist', (s) => {
  const add = (key, xml) => s.includes(`<key>${key}</key>`) ? s : s.replace(/<dict>/, `<dict>\n\t<key>${key}</key>\n\t${xml}`);
  s = add('NSMotionUsageDescription', '<string>Motion sensors measure where your telescope is pointing.</string>');
  s = add('NSCameraUsageDescription', '<string>The camera finds stars to work out where your telescope is pointing, and scans game codes from other players\' phones.</string>');
  s = add('NSLocationWhenInUseUsageDescription', '<string>Your location is used to compute where objects are in your sky. It never leaves the phone.</string>');
  s = s.replace(/(<key>UISupportedInterfaceOrientations<\/key>\s*<array>)[\s\S]*?(<\/array>)/, '$1\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t$2');
  s = s.replace(/(<key>UISupportedInterfaceOrientations~ipad<\/key>\s*<array>)[\s\S]*?(<\/array>)/, '$1\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t$2');
  return s;
});
edit('ios/App/App/AppDelegate.swift', (s) => s.includes('isIdleTimerDisabled') ? s :
  s.replace(/(didFinishLaunchingWithOptions[^{]*\{)/, '$1\n        // Keep the screen on while observing\n        UIApplication.shared.isIdleTimerDisabled = true'));

// ---- iOS: the Skyward camera plug-in (native exposure control and RAW frames)
if (fs.existsSync('ios/App/App')) {
  const SWIFT = ['SkyCamPlugin.swift', 'MyViewController.swift'];
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
  // Capacitor 8 builds its window in SceneDelegate; use our view controller there so the plug-in gets registered.
  edit('ios/App/App/SceneDelegate.swift', (s) => s.replace('window?.rootViewController = CAPBridgeViewController()', 'window?.rootViewController = MyViewController()    // registers the Skyward camera plug-in'));
  // Older templates use the storyboard instead.
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
