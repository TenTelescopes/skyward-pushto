// Skyward Push-To: the phone's full orientation from Core Motion, referenced to north and straight down (Build 113).
//
// A web page on iOS only gets one compass number (webkitCompassHeading), and which edge of the phone it describes
// changes as the phone is tilted up, so the app's compass guess could land on the wrong side of the sky with the phone
// looking along the tube. Sky apps such as SkySafari avoid that by asking Core Motion for the whole attitude in a
// north-and-vertical frame, which is what this does.
//
// Every update the app gets three unit vectors in the phone's own axes (x to the right of the screen, y to the top
// edge, z out of the screen, the same axes as the web's DeviceOrientation): E (east), N (north) and U (up). The
// direction of any axis a of the phone is then azimuth atan2(a·E, a·N) and altitude asin(a·U), whatever the matrix
// conventions are. The app uses this only for the compass part (which way is north); the gyro and the star alignment
// still do the precise pointing.
//
// North: true north when iOS offers that frame (it needs Location Services, which the app already uses); otherwise
// magnetic north, with the magnetic declination from Core Location's heading (true − magnetic) passed along as `decl`.
//
// JS: window.Capacitor.Plugins.SkyMotion.start({ hz }) / stop(); addListener('motion', d => …) with
//   d = { E: [x,y,z], N: [x,y,z], U: [x,y,z], frame: 'true'|'magnetic', decl: degrees or null, acc: -1…2, t: ms }.
// acc is the magnetometer calibration from Core Motion (-1 uncalibrated, 0 low, 1 medium, 2 high).

import Foundation
import Capacitor
import CoreMotion
import CoreLocation

@objc(SkyMotionPlugin)
public class SkyMotionPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "SkyMotionPlugin"
    public let jsName = "SkyMotion"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    private let motion = CMMotionManager()
    private let queue = OperationQueue()
    private var location: CLLocationManager?
    private var decl: Double? = nil            // true − magnetic heading, degrees (east positive)
    private var frameName = "magnetic"

    @objc func start(_ call: CAPPluginCall) {
        guard motion.isDeviceMotionAvailable else { call.reject("This phone has no motion sensors", "UNAVAILABLE"); return }
        let hz = max(5.0, min(60.0, call.getDouble("hz") ?? 30.0))
        DispatchQueue.main.async {
            // Core Location's heading gives the declination (and turns on what true north needs).
            if self.location == nil {
                let lm = CLLocationManager(); lm.delegate = self
                lm.desiredAccuracy = kCLLocationAccuracyKilometer; lm.headingFilter = 1
                self.location = lm
            }
            let st = self.location!.authorizationStatus
            if st == .authorizedWhenInUse || st == .authorizedAlways {
                self.location!.startUpdatingLocation()
                if CLLocationManager.headingAvailable() { self.location!.startUpdatingHeading() }
            }
            let frames = CMMotionManager.availableAttitudeReferenceFrames()
            let useTrue = frames.contains(.xTrueNorthZVertical) && (st == .authorizedWhenInUse || st == .authorizedAlways)
            let frame: CMAttitudeReferenceFrame = useTrue ? .xTrueNorthZVertical : .xMagneticNorthZVertical
            self.frameName = useTrue ? "true" : "magnetic"
            if self.motion.isDeviceMotionActive { self.motion.stopDeviceMotionUpdates() }
            self.motion.deviceMotionUpdateInterval = 1.0 / hz
            self.motion.startDeviceMotionUpdates(using: frame, to: self.queue) { [weak self] dm, err in
                guard let self = self, let dm = dm else { if let e = err { print("SkyMotion: \(e)") }; return }
                self.send(dm)
            }
            print("SkyMotion: started, \(self.frameName) north, \(Int(hz)) Hz")
            call.resolve(["frame": self.frameName])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        motion.stopDeviceMotionUpdates()
        DispatchQueue.main.async { self.location?.stopUpdatingHeading(); self.location?.stopUpdatingLocation() }
        call.resolve()
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateHeading h: CLHeading) {
        if h.trueHeading >= 0 && h.headingAccuracy >= 0 {
            var d = h.trueHeading - h.magneticHeading
            if d > 180 { d -= 360 } else if d < -180 { d += 360 }
            decl = d
        }
    }
    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let st = manager.authorizationStatus
        if st == .authorizedWhenInUse || st == .authorizedAlways {
            manager.startUpdatingLocation()
            if CLLocationManager.headingAvailable() { manager.startUpdatingHeading() }
        }
    }

    private func send(_ dm: CMDeviceMotion) {
        let m = dm.attitude.rotationMatrix
        // Rows and columns of the matrix, and gravity (in the phone's axes, pointing down) to tell which way it maps:
        // if it takes the phone's axes to the reference frame, its rows are the reference axes seen from the phone;
        // otherwise its columns are. The reference frame is x = north, y = west, z = up.
        let rows = [[m.m11, m.m12, m.m13], [m.m21, m.m22, m.m23], [m.m31, m.m32, m.m33]]
        let cols = [[m.m11, m.m21, m.m31], [m.m12, m.m22, m.m32], [m.m13, m.m23, m.m33]]
        let g = dm.gravity, down = [g.x, g.y, g.z]
        func dot(_ a: [Double], _ b: [Double]) -> Double { a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
        let useRows = -dot(rows[2], down) >= -dot(cols[2], down)
        let ax = useRows ? rows : cols
        let N = ax[0], W = ax[1], U = ax[2], E = [-W[0], -W[1], -W[2]]
        let acc = Int(dm.magneticField.accuracy.rawValue)
        var d: [String: Any] = ["E": E, "N": N, "U": U, "frame": frameName, "acc": acc, "t": Date().timeIntervalSince1970 * 1000]
        if let x = decl { d["decl"] = x }
        notifyListeners("motion", data: d)
    }
}
