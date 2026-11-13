// Idempotent patches applied after `npx cap add` / `npx cap sync`:
//  - iOS: motion + location usage strings, portrait only, keep screen awake
//  - Android: location permissions, portrait only, keep screen awake
import fs from 'node:fs';
const log = (m) => console.log('[patch-native] ' + m);
const edit = (file, fn) => { if (!fs.existsSync(file)) return log(`skip ${file} (platform not added)`); const a = fs.readFileSync(file, 'utf8'); const b = fn(a); if (a !== b) { fs.writeFileSync(file, b); log(`patched ${file}`); } else log(`ok ${file}`); };

// ---- iOS
edit('ios/App/App/Info.plist', (s) => {
  const add = (key, xml) => s.includes(`<key>${key}</key>`) ? s : s.replace(/<dict>/, `<dict>\n\t<key>${key}</key>\n\t${xml}`);
  s = add('NSMotionUsageDescription', '<string>Motion sensors measure where your telescope is pointing.</string>');
  s = add('NSCameraUsageDescription', '<string>The camera scans game challenge and result codes from other players\' phones.</string>');
  s = add('NSLocationWhenInUseUsageDescription', '<string>Your location is used to compute where objects are in your sky. It never leaves the phone.</string>');
  s = s.replace(/(<key>UISupportedInterfaceOrientations<\/key>\s*<array>)[\s\S]*?(<\/array>)/, '$1\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t$2');
  s = s.replace(/(<key>UISupportedInterfaceOrientations~ipad<\/key>\s*<array>)[\s\S]*?(<\/array>)/, '$1\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t$2');
  return s;
});
edit('ios/App/App/AppDelegate.swift', (s) => s.includes('isIdleTimerDisabled') ? s :
  s.replace(/(didFinishLaunchingWithOptions[^{]*\{)/, '$1\n        // Keep the screen on while observing\n        UIApplication.shared.isIdleTimerDisabled = true'));

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
