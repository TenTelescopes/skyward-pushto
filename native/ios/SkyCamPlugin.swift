// Skyward Push-To: native camera for the star finder.
//
// A web page cannot set a phone camera's exposure on iOS. This plug-in can: it opens the back camera, locks focus at
// infinity, sets the exposure time and gain the app asks for, and hands back single frames as plain brightness.
// Everything clever (what is sky, lining frames up, stacking, recognising the stars) stays in the app's JavaScript:
// docs/js/camera.js calls this through window.Capacitor.Plugins.SkyCam.
//
// FIRST DRAFT, NOT YET COMPILED. Written without access to Xcode; expect small errors on the first build.

import Foundation
import Capacitor
import AVFoundation

@objc(SkyCamPlugin)
public class SkyCamPlugin: CAPPlugin, CAPBridgedPlugin, AVCaptureVideoDataOutputSampleBufferDelegate {
    public let identifier = "SkyCamPlugin"
    public let jsName = "SkyCam"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setExposure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "frame", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise)
    ]

    private let session = AVCaptureSession()
    private var device: AVCaptureDevice?
    private let output = AVCaptureVideoDataOutput()
    private let queue = DispatchQueue(label: "com.tentelescopes.skyward.skycam")
    private var waiting: [CAPPluginCall] = []     // frame() calls not yet answered; touched only on `queue`
    private var skip = 0                          // frames to throw away after a settings change; touched only on `queue`
    private var configured = false

    // Longest exposure the current format really allows: limited both by the sensor and by the slowest frame rate.
    private func limits(_ d: AVCaptureDevice) -> (minT: Double, maxT: Double, minISO: Float, maxISO: Float) {
        let f = d.activeFormat
        var slowest = 30.0
        for r in f.videoSupportedFrameRateRanges { slowest = min(slowest, r.minFrameRate) }
        let maxT = min(f.maxExposureDuration.seconds, 1.0 / max(slowest, 0.5))
        return (f.minExposureDuration.seconds, maxT, f.minISO, f.maxISO)
    }

    private func describe(_ d: AVCaptureDevice) -> [String: Any] {
        let l = limits(d)
        let dims = CMVideoFormatDescriptionGetDimensions(d.activeFormat.formatDescription)
        return [
            "minExposure": l.minT, "maxExposure": l.maxT, "minISO": l.minISO, "maxISO": l.maxISO,
            "exposure": d.exposureDuration.seconds, "iso": d.iso,
            "sensorWidth": Int(dims.width), "sensorHeight": Int(dims.height),
            "fieldOfView": d.activeFormat.videoFieldOfView,
            "camera": d.localizedName
        ]
    }

    @objc func open(_ call: CAPPluginCall) {
        AVCaptureDevice.requestAccess(for: .video) { granted in
            guard granted else { call.reject("Camera access was not allowed. Turn it on in Settings › Skyward Push-To."); return }
            self.queue.async {
                do {
                    if !self.configured {
                        guard let d = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
                            call.reject("No back camera found."); return
                        }
                        self.device = d
                        self.session.beginConfiguration()
                        self.session.sessionPreset = .hd1920x1080
                        let input = try AVCaptureDeviceInput(device: d)
                        if self.session.canAddInput(input) { self.session.addInput(input) }
                        // Full-range luminance + chroma: the first plane is exactly the brightness the app wants.
                        self.output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
                        self.output.alwaysDiscardsLateVideoFrames = true
                        self.output.setSampleBufferDelegate(self, queue: self.queue)
                        if self.session.canAddOutput(self.output) { self.session.addOutput(self.output) }
                        if let c = self.output.connection(with: .video) {
                            // Deliver upright (portrait) frames, like the web camera does.
                            if #available(iOS 17.0, *) {
                                if c.isVideoRotationAngleSupported(90) { c.videoRotationAngle = 90 }
                            } else if c.isVideoOrientationSupported {
                                c.videoOrientation = .portrait
                            }
                        }
                        self.session.commitConfiguration()
                        self.configured = true
                    }
                    guard let d = self.device else { call.reject("No camera."); return }
                    try d.lockForConfiguration()
                    if d.isFocusModeSupported(.locked) && d.isLockingFocusWithCustomLensPositionSupported {
                        d.setFocusModeLocked(lensPosition: 1.0, completionHandler: nil)      // 1.0 = as far as the lens goes
                    }
                    if d.hasTorch && d.isTorchActive { d.torchMode = .off }
                    d.unlockForConfiguration()
                    if !self.session.isRunning { self.session.startRunning() }
                    self.skip = 3
                    call.resolve(self.describe(d))
                } catch {
                    call.reject("Could not start the camera: \(error.localizedDescription)")
                }
            }
        }
    }

    /// setExposure({ seconds, iso }) — both are clamped to what the camera allows; the values actually set are returned.
    @objc func setExposure(_ call: CAPPluginCall) {
        queue.async {
            guard let d = self.device else { call.reject("The camera is not open."); return }
            let l = self.limits(d)
            let t = min(max(call.getDouble("seconds") ?? l.maxT, l.minT), l.maxT)
            let iso = min(max(call.getFloat("iso") ?? l.maxISO, l.minISO), l.maxISO)
            do {
                try d.lockForConfiguration()
                let dur = CMTime(seconds: t, preferredTimescale: 1_000_000)
                // The frame rate has to make room for the exposure: one frame per exposure.
                var fastest = 30.0, slowest = 30.0
                for r in d.activeFormat.videoSupportedFrameRateRanges { fastest = max(fastest, r.maxFrameRate); slowest = min(slowest, r.minFrameRate) }
                let frame = CMTime(seconds: min(max(t, 1.0 / fastest), 1.0 / max(slowest, 0.5)), preferredTimescale: 1_000_000)
                d.activeVideoMinFrameDuration = frame
                d.activeVideoMaxFrameDuration = frame
                if d.isExposureModeSupported(.custom) {
                    d.setExposureModeCustom(duration: dur, iso: iso) { _ in
                        self.queue.async {
                            self.skip = 2                                  // the next frames straddle the change
                            call.resolve(self.describe(d))
                        }
                    }
                    d.unlockForConfiguration()
                } else {
                    d.unlockForConfiguration()
                    call.reject("This camera does not allow manual exposure.")
                }
            } catch {
                call.reject("Could not set the exposure: \(error.localizedDescription)")
            }
        }
    }

    /// frame() — resolves with the next settled frame: { width, height, exposure, iso, data } where data is the
    /// brightness plane, one byte per pixel, row by row, as base64.
    @objc func frame(_ call: CAPPluginCall) {
        queue.async {
            guard self.session.isRunning else { call.reject("The camera is not open."); return }
            self.waiting.append(call)
        }
    }

    @objc func close(_ call: CAPPluginCall) {
        queue.async {
            if self.session.isRunning { self.session.stopRunning() }
            for c in self.waiting { c.reject("The camera was closed.") }
            self.waiting.removeAll()
            call.resolve()
        }
    }

    // Called on `queue` for every frame the camera produces.
    public func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        if skip > 0 { skip -= 1; return }
        if waiting.isEmpty { return }
        guard let px = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        CVPixelBufferLockBaseAddress(px, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(px, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddressOfPlane(px, 0) else { return }
        let w = CVPixelBufferGetWidthOfPlane(px, 0), h = CVPixelBufferGetHeightOfPlane(px, 0), stride = CVPixelBufferGetBytesPerRowOfPlane(px, 0)
        var data = Data(count: w * h)
        data.withUnsafeMutableBytes { (dst: UnsafeMutableRawBufferPointer) in
            guard let out = dst.baseAddress else { return }
            for y in 0..<h { memcpy(out + y * w, base + y * stride, w) }      // rows can be padded; copy only the picture
        }
        let result: [String: Any] = [
            "width": w, "height": h,
            "exposure": device?.exposureDuration.seconds ?? 0, "iso": device?.iso ?? 0,
            "data": data.base64EncodedString()
        ]
        let calls = waiting
        waiting.removeAll()
        for c in calls { c.resolve(result) }
    }
}
