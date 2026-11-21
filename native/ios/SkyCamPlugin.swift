// Skyward Push-To: native camera for the star finder.
//
// A web page cannot set a phone camera's exposure on iOS, and it only ever sees processed video. This plug-in:
//   • opens the back camera, locks focus at infinity, and sets the exposure time and gain the app asks for;
//   • takes RAW photos (the sensor's own data, before Apple's noise reduction, sharpening and tone curve) and turns each
//     block of photosites (4×4 by default: four complete red-green-green-blue groups) into one brightness value by adding
//     them, after subtracting the sensor's black level. No demosaicing, no colour matrix, no white balance: every photosite is used exactly once,
//     by code we control. ("Superpixel" binning, as astronomy software does it.)
//   • also hands back small preview frames from the video stream, for the live view and its grey stripes.
// Everything clever (what is sky, lining frames up, stacking, recognising the stars) stays in the app's JavaScript:
// docs/js/camera.js calls this through window.Capacitor.Plugins.SkyCam.
//
// Build 86: the camera now reports what it is doing (status(), and lines starting "SkyCam:" in the Xcode console),
// restarts itself after an interruption, and never leaves a call waiting forever.

import Foundation
import Capacitor
import AVFoundation
import CoreImage
import ImageIO
import Photos

@objc(SkyCamPlugin)
public class SkyCamPlugin: CAPPlugin, CAPBridgedPlugin, AVCaptureVideoDataOutputSampleBufferDelegate, AVCapturePhotoCaptureDelegate {
    public let identifier = "SkyCamPlugin"
    public let jsName = "SkyCam"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setExposure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "frame", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "raw", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "savePhoto", returnType: CAPPluginReturnPromise)
    ]

    private let session = AVCaptureSession()
    private var device: AVCaptureDevice?
    private let videoOut = AVCaptureVideoDataOutput()
    private let photoOut = AVCapturePhotoOutput()
    private var rawFormat: OSType = 0
    private let queue = DispatchQueue(label: "com.tentelescopes.skyward.skycam")                         // camera state
    private let work = DispatchQueue(label: "com.tentelescopes.skyward.develop", qos: .userInitiated)    // developing RAW
    private var waiting: [CAPPluginCall] = []          // frame() calls not yet answered; touched only on `queue`
    private var rawCalls: [Int64: CAPPluginCall] = [:] // raw() calls by capture id; touched only on `queue`
    private var checkFor: [Int64: Bool] = [:]          // raw() calls that asked for the full check (slower); only on `queue`
    private var binFor: [Int64: Int] = [:]             // block size asked for, by capture id; only on `queue`
    private var skip = 0                               // preview frames to drop after a settings change; only on `queue`
    private var configured = false
    private var frames = 0                             // preview frames the camera has delivered since open; only on `queue`
    private var lastFrameAt = Date.distantPast          // when the latest one arrived; only on `queue`
    private var events: [String] = []                  // what happened to the camera session, newest last; only on `queue`
    private var observing = false
    private var previewMean = -1.0                     // average brightness (0–255) of the latest preview frame; only on `queue`

    private func note(_ s: String) {
        let f = DateFormatter(); f.dateFormat = "HH:mm:ss"
        let line = "\(f.string(from: Date())) \(s)"
        NSLog("SkyCam: %@", line)
        events.append(line); if events.count > 12 { events.removeFirst(events.count - 12) }
    }
    /// One line saying how the camera is doing, added to every error so a report shows what went wrong.
    private func state() -> String {
        let ago = lastFrameAt == Date.distantPast ? "never" : String(format: "%.1f s ago", Date().timeIntervalSince(lastFrameAt))
        var s = "camera \(session.isRunning ? "running" : "stopped")\(session.isInterrupted ? ", INTERRUPTED" : ""), \(frames) preview frames, last \(ago)"
        if let d = device { s += String(format: ", exposure %.3f s, ISO %.0f, frame %.3f s", d.exposureDuration.seconds, d.iso, d.activeVideoMaxFrameDuration.seconds) }
        if let e = events.last { s += "; last event: \(e)" }
        return s
    }
    private func why(_ e: Error) -> String {
        let n = e as NSError
        var s = "\(n.localizedDescription) (\(n.domain) \(n.code)"
        if let u = n.userInfo[NSUnderlyingErrorKey] as? NSError { s += "; underlying \(u.domain) \(u.code)" }
        if let r = n.localizedFailureReason { s += "; \(r)" }
        return s + ")"
    }
    private func watch() {
        guard !observing else { return }; observing = true
        let nc = NotificationCenter.default
        nc.addObserver(forName: AVCaptureSession.runtimeErrorNotification, object: session, queue: nil) { n in
            let e = n.userInfo?[AVCaptureSessionErrorKey] as? Error
            self.queue.async {
                self.note("camera error: \(e.map { self.why($0) } ?? "unknown")")
                // Restart once things have settled (this is what Apple's sample code does).
                self.queue.asyncAfter(deadline: .now() + 0.5) { if self.configured && !self.session.isRunning { self.session.startRunning(); self.note("restarted the camera") } }
            }
        }
        nc.addObserver(forName: AVCaptureSession.wasInterruptedNotification, object: session, queue: nil) { n in
            var why = "unknown"
            if let v = n.userInfo?[AVCaptureSessionInterruptionReasonKey] as? Int, let r = AVCaptureSession.InterruptionReason(rawValue: v) {
                switch r {
                case .videoDeviceNotAvailableInBackground: why = "app in the background"
                case .audioDeviceInUseByAnotherClient: why = "audio in use elsewhere"
                case .videoDeviceInUseByAnotherClient: why = "camera in use by something else"
                case .videoDeviceNotAvailableWithMultipleForegroundApps: why = "split screen"
                case .videoDeviceNotAvailableDueToSystemPressure: why = "phone too hot or overloaded"
                default: why = "reason \(v)"
                }
            }
            self.queue.async { self.note("camera interrupted: \(why)") }
        }
        nc.addObserver(forName: AVCaptureSession.interruptionEndedNotification, object: session, queue: nil) { _ in
            self.queue.async { self.note("interruption ended") }
        }
    }
    private lazy var ciContext: CIContext = {
        let linear = CGColorSpace(name: CGColorSpace.linearSRGB)!
        return CIContext(options: [.workingColorSpace: linear, .cacheIntermediates: false])
    }()

    // Longest exposure the current format really allows: limited both by the sensor and by the slowest frame rate.
    private func limits(_ d: AVCaptureDevice) -> (minT: Double, maxT: Double, minISO: Float, maxISO: Float) {
        let f = d.activeFormat
        let maxT = min(f.maxExposureDuration.seconds, frameLimits(d).hi.seconds)
        return (f.minExposureDuration.seconds, maxT, f.minISO, f.maxISO)
    }

    /// Shortest and longest frame durations the camera accepts, exactly as Apple states them. (Converting to frames per
    /// second and back rounds, and a frame duration even slightly outside these makes iOS stop the app.)
    private func frameLimits(_ d: AVCaptureDevice) -> (lo: CMTime, hi: CMTime) {
        let rs = d.activeFormat.videoSupportedFrameRateRanges
        guard var lo = rs.first?.minFrameDuration, var hi = rs.first?.maxFrameDuration else {
            return (d.activeVideoMinFrameDuration, d.activeVideoMaxFrameDuration)
        }
        for r in rs { lo = CMTimeMinimum(lo, r.minFrameDuration); hi = CMTimeMaximum(hi, r.maxFrameDuration) }
        return (lo, hi)
    }

    private func describe(_ d: AVCaptureDevice) -> [String: Any] {
        let l = limits(d)
        let dims = CMVideoFormatDescriptionGetDimensions(d.activeFormat.formatDescription)
        return [
            "minExposure": l.minT, "maxExposure": l.maxT, "minISO": l.minISO, "maxISO": l.maxISO,
            "exposure": d.exposureDuration.seconds, "iso": d.iso,
            "sensorWidth": Int(dims.width), "sensorHeight": Int(dims.height),
            "fieldOfView": d.activeFormat.videoFieldOfView,
            "binned": d.activeFormat.isVideoBinned,
            "raw": rawFormat != 0,
            "camera": d.localizedName,
            "formatInfo": String(format: "%dx%d, frame %.4f–%.3f s, exposure up to %.3f s, now frame %.3f s", Int(dims.width), Int(dims.height),
                                 frameLimits(d).lo.seconds, frameLimits(d).hi.seconds, d.activeFormat.maxExposureDuration.seconds, d.activeVideoMaxFrameDuration.seconds)
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
                        self.session.sessionPreset = .photo                       // the whole 4:3 sensor, not a 16:9 video crop
                        let input = try AVCaptureDeviceInput(device: d)
                        if self.session.canAddInput(input) { self.session.addInput(input) }
                        // Preview: full-range luminance + chroma; the first plane is exactly the brightness the app wants.
                        self.videoOut.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
                        self.videoOut.alwaysDiscardsLateVideoFrames = true
                        self.videoOut.setSampleBufferDelegate(self, queue: self.queue)
                        if self.session.canAddOutput(self.videoOut) { self.session.addOutput(self.videoOut) }
                        if self.session.canAddOutput(self.photoOut) { self.session.addOutput(self.photoOut) }
                        // Bayer RAW only. (Apple ProRAW is already processed, so it is not what we want.)
                        self.rawFormat = self.photoOut.availableRawPhotoPixelFormatTypes.first(where: { AVCapturePhotoOutput.isBayerRAWPixelFormat($0) }) ?? 0
                        // Long manual exposures: switch off the features that take photos from a buffer of earlier frames.
                        self.photoOut.maxPhotoQualityPrioritization = .speed
                        if #available(iOS 17.0, *) {
                            if self.photoOut.isResponsiveCaptureSupported { self.photoOut.isResponsiveCaptureEnabled = false }   // needs ZSL, so off first
                            if self.photoOut.isZeroShutterLagSupported { self.photoOut.isZeroShutterLagEnabled = false }
                        }
                        // Only the preview is turned upright here; RAW photos are turned in finish().
                        for out in [self.videoOut as AVCaptureOutput] {
                            if let c = out.connection(with: .video) {
                                // Deliver upright (portrait) pictures.
                                if #available(iOS 17.0, *) {
                                    if c.isVideoRotationAngleSupported(90) { c.videoRotationAngle = 90 }
                                } else if c.isVideoOrientationSupported {
                                    c.videoOrientation = .portrait
                                }
                            }
                        }
                        self.session.commitConfiguration()
                        self.configured = true
                        self.watch()
                        self.note("opened \(d.localizedName), RAW \(self.rawFormat != 0 ? "yes" : "no")")
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
                    self.frames = 0; self.lastFrameAt = Date.distantPast
                    call.resolve(self.describe(d))
                } catch {
                    call.reject("Could not start the camera: \(self.why(error))")
                }
            }
        }
    }

    /// setExposure({ seconds, iso }) — both are clamped to what the camera allows; the values actually set are returned.
    /// RAW photos and preview frames both use these settings.
    @objc func setExposure(_ call: CAPPluginCall) {
        queue.async {
            guard let d = self.device else { call.reject("The camera is not open."); return }
            let l = self.limits(d)
            let t = min(max(call.getDouble("seconds") ?? l.maxT, l.minT), l.maxT)
            let iso = min(max(call.getFloat("iso") ?? l.maxISO, l.minISO), l.maxISO)
            do {
                try d.lockForConfiguration()
                // Same for the exposure: clamp in Apple's own units, since rounding can step just past a limit.
                let fmt = d.activeFormat, longest = CMTimeMinimum(fmt.maxExposureDuration, self.frameLimits(d).hi)
                let dur = CMTimeMaximum(fmt.minExposureDuration, CMTimeMinimum(longest, CMTime(seconds: t, preferredTimescale: 1_000_000)))
                // The frame rate has to make room for the exposure: one frame per exposure, kept within Apple's own limits.
                let fl = self.frameLimits(d)
                let frame = CMTimeMaximum(fl.lo, CMTimeMinimum(fl.hi, dur))
                // Change them in an order that never leaves the shortest longer than the longest.
                if CMTimeCompare(frame, d.activeVideoMaxFrameDuration) > 0 {
                    d.activeVideoMaxFrameDuration = frame; d.activeVideoMinFrameDuration = frame
                } else {
                    d.activeVideoMinFrameDuration = frame; d.activeVideoMaxFrameDuration = frame
                }
                if d.isExposureModeSupported(.custom) {
                    // Apple answers once a frame with the new settings arrives. If frames have stopped, answer anyway
                    // after a while, saying so, rather than leaving the app waiting.
                    var answered = false
                    let answer = { (confirmed: Bool) in
                        if answered { return }; answered = true
                        self.skip = 2                                  // the next preview frames straddle the change
                        var r = self.describe(d); r["confirmed"] = confirmed
                        if !confirmed { self.note("exposure \(String(format: "%.3f", t)) s not confirmed: \(self.state())"); r["state"] = self.state() }
                        call.resolve(r)
                    }
                    d.setExposureModeCustom(duration: dur, iso: iso) { _ in self.queue.async { answer(true) } }
                    d.unlockForConfiguration()
                    self.queue.asyncAfter(deadline: .now() + 2 * t + 2.0) { answer(false) }
                } else {
                    d.unlockForConfiguration()
                    call.reject("This camera does not allow manual exposure.")
                }
            } catch {
                call.reject("Could not set the exposure: \(self.why(error))")
            }
        }
    }

    /// frame() — the next preview frame, at most about 480 pixels across: { width, height, exposure, iso, bits: 8, data }
    /// where data is brightness, one byte per pixel, row by row, as base64. Shrunk by averaging blocks, never by skipping.
    @objc func frame(_ call: CAPPluginCall) {
        queue.async {
            guard self.session.isRunning else { call.reject("The camera is not open."); return }
            self.waiting.append(call)
        }
    }

    /// raw({ bin }) — one RAW photo at the current exposure, binned: each bin×bin block of photosites (bin even, default 4)
    /// is added up. Returns { width, height, exposure, iso, bits: 16, linear: true, method, bin, black, white, data } where
    /// data is brightness as 16-bit little-endian numbers (0 = black level, 65535 = every photosite in the block at the
    /// sensor's white level), as base64.
    @objc func raw(_ call: CAPPluginCall) {
        let b = call.getInt("bin") ?? 4
        let bin = max(2, min(8, b - b % 2))
        queue.async {
            guard self.session.isRunning else { call.reject("The camera is not open."); return }
            guard self.rawFormat != 0 else { call.reject("This camera does not offer RAW."); return }
            guard !self.session.isInterrupted else { call.reject("The camera is interrupted: \(self.state())"); return }
            let settings = AVCapturePhotoSettings(rawPixelFormatType: self.rawFormat)
            settings.photoQualityPrioritization = .speed
            self.rawCalls[settings.uniqueID] = call
            self.binFor[settings.uniqueID] = bin
            self.checkFor[settings.uniqueID] = call.getBool("check") ?? false
            self.photoOut.capturePhoto(with: settings, delegate: self)
        }
    }

    @objc func close(_ call: CAPPluginCall) {
        queue.async {
            if self.session.isRunning { self.session.stopRunning() }
            for c in self.waiting { c.reject("The camera was closed.") }
            self.waiting.removeAll()
            for (_, c) in self.rawCalls { c.reject("The camera was closed.") }
            self.rawCalls.removeAll()
            call.resolve()
        }
    }

    /// status() — how the camera is doing, for reports: { state, events }
    /// savePhoto({ data: base64 PNG }) — adds the picture to the Photos library (add-only permission: the app never
    /// sees the user's other photos).
    @objc func savePhoto(_ call: CAPPluginCall) {
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else { call.reject("No picture to save."); return }
        let save = {
            PHPhotoLibrary.shared().performChanges({
                PHAssetCreationRequest.forAsset().addResource(with: .photo, data: data, options: nil)
            }) { ok, err in
                if ok { call.resolve() } else { call.reject("Could not save the picture: \(err?.localizedDescription ?? "unknown error")") }
            }
        }
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { st in
            if st == .authorized || st == .limited { save() }
            else { call.reject("The app is not allowed to add photos. Allow it in Settings › Apps › Skyward Push-To › Photos.") }
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        queue.async { call.resolve(["state": self.state(), "events": self.events]) }
    }

    // ---- preview frames (called on `queue` for every frame the camera produces)
    public func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        frames += 1; lastFrameAt = Date()
        if let p = CMSampleBufferGetImageBuffer(sampleBuffer) {     // a quick average (every 16th pixel) for the RAW check
            CVPixelBufferLockBaseAddress(p, .readOnly)
            if let b = CVPixelBufferGetBaseAddressOfPlane(p, 0) {
                let w = CVPixelBufferGetWidthOfPlane(p, 0), h = CVPixelBufferGetHeightOfPlane(p, 0), st = CVPixelBufferGetBytesPerRowOfPlane(p, 0)
                let s = b.assumingMemoryBound(to: UInt8.self); var sum = 0, n = 0
                for y in stride(from: 0, to: h, by: 16) { for x in stride(from: 0, to: w, by: 16) { sum += Int(s[y * st + x]); n += 1 } }
                previewMean = n > 0 ? Double(sum) / Double(n) : -1
            }
            CVPixelBufferUnlockBaseAddress(p, .readOnly)
        }
        if skip > 0 { skip -= 1; return }
        if waiting.isEmpty { return }
        guard let px = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        CVPixelBufferLockBaseAddress(px, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(px, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddressOfPlane(px, 0) else { return }
        let w = CVPixelBufferGetWidthOfPlane(px, 0), h = CVPixelBufferGetHeightOfPlane(px, 0), stride = CVPixelBufferGetBytesPerRowOfPlane(px, 0)
        let k = max(1, Int((Double(max(w, h)) / 480.0).rounded(.up)))           // block size for averaging (preview only)
        let ow = w / k, oh = h / k
        var data = Data(count: ow * oh)
        let src = base.assumingMemoryBound(to: UInt8.self)
        data.withUnsafeMutableBytes { (dst: UnsafeMutableRawBufferPointer) in
            guard let out = dst.baseAddress?.assumingMemoryBound(to: UInt8.self) else { return }
            for oy in 0..<oh {
                for ox in 0..<ow {
                    var s = 0
                    for yy in 0..<k { let row = src + (oy * k + yy) * stride + ox * k; for xx in 0..<k { s += Int(row[xx]) } }
                    out[oy * ow + ox] = UInt8(s / (k * k))
                }
            }
        }
        let result: [String: Any] = [
            "width": ow, "height": oh, "bits": 8,
            "exposure": device?.exposureDuration.seconds ?? 0, "iso": device?.iso ?? 0,
            "data": data.base64EncodedString()
        ]
        let calls = waiting
        waiting.removeAll()
        for c in calls { c.resolve(result) }
    }

    // ---- RAW photos
    public func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        let id = photo.resolvedSettings.uniqueID
        queue.async {
            guard let call = self.rawCalls.removeValue(forKey: id) else { return }
            let bin = self.binFor.removeValue(forKey: id) ?? 4
            if let error = error { self.note("RAW photo failed: \(self.why(error))"); call.reject("The RAW photo failed: \(self.why(error)); \(self.state())"); return }
            guard let dng = photo.fileDataRepresentation() else { call.reject("The RAW photo came back empty."); return }
            let exif = photo.metadata[kCGImagePropertyExifDictionary as String] as? [String: Any]
            let exposure = (exif?[kCGImagePropertyExifExposureTime as String] as? Double) ?? (self.device?.exposureDuration.seconds ?? 0)
            let iso = ((exif?[kCGImagePropertyExifISOSpeedRatings as String] as? [NSNumber])?.first?.doubleValue) ?? Double(self.device?.iso ?? 0)
            let px = photo.pixelBuffer
            let check = self.checkFor.removeValue(forKey: id) ?? false
            let pm = self.previewMean, rawW = Int(photo.resolvedSettings.rawPhotoDimensions.width)
            self.work.async {
                // Preferred: add up the photosites ourselves. Fallback: Apple develops it linearly, then we average 2×2.
                if let px = px, let lv = self.levels(dng), self.superpixel(px, bin: bin, black: lv.black, white: lv.white, exposure: exposure, iso: iso, call: call,
                                                                                  extra: check ? String(format: "; preview frame at the time: mean %.1f of 255; ", pm) + self.appleMean(dng) : "", activeW: rawW) { return }
                self.develop(dng, bin: bin, exposure: exposure, iso: iso, call: call)
            }
        }
    }

    /// Black and white levels from the photo's DNG tags. The black level may be one number or one per Bayer position;
    /// what matters for a 2×2 sum is the total over the four.
    private func levels(_ dng: Data) -> (black: [Double], white: Double)? {
        guard let src = CGImageSourceCreateWithData(dng as CFData, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [String: Any],
              let d = props[kCGImagePropertyDNGDictionary as String] as? [String: Any] else { return nil }
        var black: [Double] = []
        if let a = d[kCGImagePropertyDNGBlackLevel as String] as? [NSNumber] { black = a.map { $0.doubleValue } }
        else if let n = d[kCGImagePropertyDNGBlackLevel as String] as? NSNumber { black = [n.doubleValue] }
        var white = 0.0
        if let a = d[kCGImagePropertyDNGWhiteLevel as String] as? [NSNumber], let f = a.first { white = f.doubleValue }
        else if let n = d[kCGImagePropertyDNGWhiteLevel as String] as? NSNumber { white = n.doubleValue }
        guard !black.isEmpty, white > (black.max() ?? 0) else { return nil }
        return (black, white)
    }

    /// Superpixel binning straight from the Bayer data. Returns false (so the caller falls back) if the buffer is not
    /// the expected one-plane, 16-bits-per-photosite layout.
    private func superpixel(_ px: CVPixelBuffer, bin k: Int, black blackTag: [Double], white whiteTag: Double, exposure: Double, iso: Double, call: CAPPluginCall, extra: String = "", activeW: Int = 0) -> Bool {
        // The DNG tags give black and white on a 12-bit scale (e.g. 528 and 4095), but on iPhone 16 Pro the buffer itself
        // is 14-bit ('bgg4' and friends end in 4): measured dark level ~2100 = 4 × 528. Put the levels on the buffer's scale.
        let ft0 = CVPixelBufferGetPixelFormatType(px)
        let is14 = (ft0 & 0xff) == UInt32(UInt8(ascii: "4"))
        let f = (is14 && whiteTag <= 4095.5) ? 4.0 : 1.0
        let black = blackTag.map { $0 * f }, white = f > 1 ? (whiteTag + 1) * f - 1 : whiteTag
        CVPixelBufferLockBaseAddress(px, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(px, .readOnly) }
        guard !CVPixelBufferIsPlanar(px), let base = CVPixelBufferGetBaseAddress(px) else { return false }
        let W = CVPixelBufferGetWidth(px), H = CVPixelBufferGetHeight(px), rowBytes = CVPixelBufferGetBytesPerRow(px)
        guard rowBytes >= W * 2, W >= 2 * k, H >= 2 * k else { return false }
        // Total black over one 2×2 colour group: four values given in pattern order, or one value used four times.
        // A k×k block holds (k/2)² such groups.
        let blk4 = black.count >= 4 ? black[0] + black[1] + black[2] + black[3] : 4 * (black.reduce(0, +) / Double(black.count))
        let groups = Double((k / 2) * (k / 2)), blkBlock = blk4 * groups
        let scale = 65535.0 / (groups * (4 * white - blk4))
        // A check on the raw numbers themselves (every 16th pair of rows): mean per Bayer position, the largest value, and
        // how much is at or above the stated white level. Tells us whether the settings really changed the photo.
        var sum = [Double](repeating: 0, count: 4), cnt = [Int](repeating: 0, count: 4), mx = 0, clip = 0, n = 0
        for y in stride(from: 0, to: H - 1, by: 16) {
            for dy in 0..<2 {
                let r = (base + (y + dy) * rowBytes).assumingMemoryBound(to: UInt16.self)
                for x in stride(from: 0, to: W - 1, by: 2) {
                    for dx in 0..<2 {
                        let v = Int(r[x + dx]), i = dy * 2 + dx
                        sum[i] += Double(v); cnt[i] += 1; n += 1
                        if v > mx { mx = v }
                        if Double(v) >= white { clip += 1 }
                    }
                }
            }
        }
        // Spread of values (every 16th pair of rows) and, if the buffer is wider than the picture, the extra columns.
        var hist = [Int](repeating: 0, count: 65536), hn = 0, mSum = 0.0, mN = 0
        for y in stride(from: 0, to: H - 1, by: 16) {
            let r = (base + y * rowBytes).assumingMemoryBound(to: UInt16.self)
            for x in 0..<W { let v = Int(r[x]); if activeW > 0 && W > activeW && x >= activeW { mSum += Double(v); mN += 1 } else { hist[v] += 1; hn += 1 } }
        }
        func pct(_ q: Double) -> Int { var acc = 0; let target = Int(Double(hn) * q); for (v, c) in hist.enumerated() { acc += c; if acc > target { return v } }; return 65535 }
        let spread = String(format: "; values 0.1%% %d, 1%% %d, median %d, 99%% %d, 99.9%% %d", pct(0.001), pct(0.01), pct(0.5), pct(0.99), pct(0.999))
            + (mN > 0 ? String(format: "; the %d extra columns average %.0f", W - activeW, mSum / Double(mN)) : String(format: "; picture %d wide", activeW))
        let ft = CVPixelBufferGetPixelFormatType(px)
        let fourcc = String([24, 16, 8, 0].map { Character(UnicodeScalar(UInt8((ft >> UInt32($0)) & 0xff))) })
        let stats = String(format: "raw %dx%d '%@', %d bytes per row; mean by Bayer position %.0f %.0f %.0f %.0f; max %d; %.1f%% at or above white (%.0f); black %@",
                           W, H, fourcc, rowBytes, sum[0] / Double(max(cnt[0], 1)), sum[1] / Double(max(cnt[1], 1)), sum[2] / Double(max(cnt[2], 1)), sum[3] / Double(max(cnt[3], 1)),
                           mx, 100.0 * Double(clip) / Double(max(n, 1)), white, black.map { String(format: "%.0f", $0) }.joined(separator: "/")) + (f > 1 ? " (DNG tags ×4: 14-bit buffer)" : "") + spread + extra
        let usable = activeW > 0 && activeW < W ? activeW : W          // the buffer has empty (zero) columns on the right
        let ow = usable / k, oh = H / k
        var out = [UInt16](repeating: 0, count: ow * oh)
        var rowSum = [Int](repeating: 0, count: ow)
        for oy in 0..<oh {
            for i in 0..<ow { rowSum[i] = 0 }
            for yy in 0..<k {
                let r = (base + (oy * k + yy) * rowBytes).assumingMemoryBound(to: UInt16.self)
                for ox in 0..<ow {
                    var s = 0
                    let x0 = ox * k
                    for xx in 0..<k { s += Int(r[x0 + xx]) }
                    rowSum[ox] += s
                }
            }
            for ox in 0..<ow {
                out[oy * ow + ox] = UInt16(max(0, min(65535, ((Double(rowSum[ox]) - blkBlock) * scale).rounded())))
            }
        }
        finish(out, ow, oh, exposure: exposure, iso: iso, method: "superpixel", bin: k, black: blk4 / 4, white: white, call: call, stats: stats)
        return true
    }

    /// Apple's own linear development of the same photo, as a check on what light the photo really caught.
    private func appleMean(_ dng: Data) -> String {
        guard let f = CIRAWFilter(imageData: dng, identifierHint: "com.adobe.raw-image") else { return "Apple could not read the RAW photo" }
        f.boostAmount = 0; f.boostShadowAmount = 0; f.exposure = 0; f.localToneMapAmount = 0
        guard let img = f.outputImage else { return "Apple could not develop the RAW photo" }
        let small = img.transformed(by: CGAffineTransform(scaleX: 0.0625, y: 0.0625))
        let ext = small.extent.integral, W = Int(ext.width), H = Int(ext.height)
        guard W > 0, H > 0 else { return "Apple's development came back empty" }
        var px = [Float](repeating: 0, count: W * H * 4)
        px.withUnsafeMutableBytes { b in
            ciContext.render(small, toBitmap: b.baseAddress!, rowBytes: W * 16, bounds: ext, format: .RGBAf, colorSpace: CGColorSpace(name: CGColorSpace.linearSRGB)!)
        }
        var s = [Double](repeating: 0, count: 3); var mx: Float = 0
        for i in 0..<(W * H) { for c in 0..<3 { let v = px[i * 4 + c]; s[c] += Double(v); mx = max(mx, v) } }
        let n = Double(W * H)
        return String(format: "Apple's own development of this photo (linear, 0–1): mean R %.4f G %.4f B %.4f, brightest %.3f", s[0] / n, s[1] / n, s[2] / n, mx)
    }

    /// Turn upright to match the preview (the sensor reads out sideways) and send.
    private func finish(_ img: [UInt16], _ w: Int, _ h: Int, exposure: Double, iso: Double, method: String, bin: Int, black: Double, white: Double, call: CAPPluginCall, stats: String = "") {
        var out = img, rw = w, rh = h
        if w > h {
            var rot = [UInt16](repeating: 0, count: w * h)
            for y in 0..<h { for x in 0..<w { rot[x * h + (h - 1 - y)] = img[y * w + x] } }
            out = rot; rw = h; rh = w
        }
        let data = out.withUnsafeBufferPointer { Data(buffer: $0) }       // little-endian on every iPhone
        call.resolve([
            "width": rw, "height": rh, "bits": 16, "linear": true, "method": method, "bin": bin, "black": black, "white": white,
            "exposure": exposure, "iso": iso, "stats": stats,
            "data": data.base64EncodedString()
        ])
    }

    /// Fallback: Apple develops the RAW linearly with its processing switched off, then we average 2×2.
    private func develop(_ dng: Data, bin k: Int, exposure: Double, iso: Double, call: CAPPluginCall) {
        guard let f = CIRAWFilter(imageData: dng, identifierHint: "com.adobe.raw-image") else { call.reject("Could not read the RAW photo."); return }
        // Linear, untouched: no boost curve, no noise reduction, no sharpening, no local tone mapping, no contrast.
        f.boostAmount = 0
        f.boostShadowAmount = 0
        f.luminanceNoiseReductionAmount = 0
        f.colorNoiseReductionAmount = 0
        f.sharpnessAmount = 0
        f.contrastAmount = 0
        f.detailAmount = 0
        f.localToneMapAmount = 0
        f.exposure = 0
        f.isLensCorrectionEnabled = true             // straight lines: the star matcher assumes an undistorted picture
        guard let img = f.outputImage else { call.reject("Could not develop the RAW photo."); return }
        let ext = img.extent.integral, W = Int(ext.width), H = Int(ext.height)
        let linear = CGColorSpace(name: CGColorSpace.linearSRGB)!
        var rgba = [UInt16](repeating: 0, count: W * H * 4)
        rgba.withUnsafeMutableBytes { buf in
            ciContext.render(img, toBitmap: buf.baseAddress!, rowBytes: W * 8, bounds: ext, format: .RGBA16, colorSpace: linear)
        }
        // Average every k×k block of (R + G + B) / 3. Every pixel counts; nothing is skipped.
        let ow = W / k, oh = H / k
        var out = [UInt16](repeating: 0, count: ow * oh)
        for oy in 0..<oh {
            for ox in 0..<ow {
                var s = 0
                for yy in 0..<k {
                    let r = ((oy * k + yy) * W + ox * k) * 4
                    for xx in 0..<k { let a = r + xx * 4; s += Int(rgba[a]) + Int(rgba[a + 1]) + Int(rgba[a + 2]) }
                }
                out[oy * ow + ox] = UInt16(min(65535, s / (3 * k * k)))
            }
        }
        finish(out, ow, oh, exposure: exposure, iso: iso, method: "developed", bin: k, black: 0, white: 0, call: call)
    }
}
