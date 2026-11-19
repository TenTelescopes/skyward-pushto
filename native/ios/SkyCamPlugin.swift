// Skyward Push-To: native camera for the star finder.
//
// A web page cannot set a phone camera's exposure on iOS, and it only ever sees processed video. This plug-in:
//   • opens the back camera, locks focus at infinity, and sets the exposure time and gain the app asks for;
//   • takes RAW photos (the sensor's own data, before Apple's noise reduction, sharpening and tone curve) and turns each
//     2×2 block of photosites (one red, two green, one blue) into one brightness value by adding them, after subtracting
//     the sensor's black level. No demosaicing, no colour matrix, no white balance: every photosite is used exactly once,
//     by code we control. ("Superpixel" binning, as astronomy software does it.)
//   • also hands back small preview frames from the video stream, for the live view and its grey stripes.
// Everything clever (what is sky, lining frames up, stacking, recognising the stars) stays in the app's JavaScript:
// docs/js/camera.js calls this through window.Capacitor.Plugins.SkyCam.
//
// FIRST DRAFT, NOT YET COMPILED. Written without access to Xcode; expect small errors on the first build.

import Foundation
import Capacitor
import AVFoundation
import CoreImage
import ImageIO

@objc(SkyCamPlugin)
public class SkyCamPlugin: CAPPlugin, CAPBridgedPlugin, AVCaptureVideoDataOutputSampleBufferDelegate, AVCapturePhotoCaptureDelegate {
    public let identifier = "SkyCamPlugin"
    public let jsName = "SkyCam"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setExposure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "frame", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "raw", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise)
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
    private var skip = 0                               // preview frames to drop after a settings change; only on `queue`
    private var configured = false
    private lazy var ciContext: CIContext = {
        let linear = CGColorSpace(name: CGColorSpace.linearSRGB)!
        return CIContext(options: [.workingColorSpace: linear, .cacheIntermediates: false])
    }()

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
            "binned": d.activeFormat.isVideoBinned,
            "raw": rawFormat != 0,
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
                        for out in [self.videoOut as AVCaptureOutput, self.photoOut as AVCaptureOutput] {
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
    /// RAW photos and preview frames both use these settings.
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
                            self.skip = 2                                  // the next preview frames straddle the change
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

    /// frame() — the next preview frame, at most about 1000 pixels across: { width, height, exposure, iso, bits: 8, data }
    /// where data is brightness, one byte per pixel, row by row, as base64. Shrunk by averaging blocks, never by skipping.
    @objc func frame(_ call: CAPPluginCall) {
        queue.async {
            guard self.session.isRunning else { call.reject("The camera is not open."); return }
            self.waiting.append(call)
        }
    }

    /// raw() — one RAW photo at the current exposure, superpixel-binned: { width, height, exposure, iso, bits: 16,
    /// linear: true, method, black, white, data } where data is brightness as 16-bit little-endian numbers
    /// (0 = black level, 65535 = all four photosites at the sensor's white level), as base64.
    @objc func raw(_ call: CAPPluginCall) {
        queue.async {
            guard self.session.isRunning else { call.reject("The camera is not open."); return }
            guard self.rawFormat != 0 else { call.reject("This camera does not offer RAW."); return }
            let settings = AVCapturePhotoSettings(rawPixelFormatType: self.rawFormat)
            self.rawCalls[settings.uniqueID] = call
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

    // ---- preview frames (called on `queue` for every frame the camera produces)
    public func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        if skip > 0 { skip -= 1; return }
        if waiting.isEmpty { return }
        guard let px = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        CVPixelBufferLockBaseAddress(px, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(px, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddressOfPlane(px, 0) else { return }
        let w = CVPixelBufferGetWidthOfPlane(px, 0), h = CVPixelBufferGetHeightOfPlane(px, 0), stride = CVPixelBufferGetBytesPerRowOfPlane(px, 0)
        let k = max(1, Int((Double(max(w, h)) / 1000.0).rounded(.up)))          // block size for averaging
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
            if let error = error { call.reject("The RAW photo failed: \(error.localizedDescription)"); return }
            guard let dng = photo.fileDataRepresentation() else { call.reject("The RAW photo came back empty."); return }
            let exif = photo.metadata[kCGImagePropertyExifDictionary as String] as? [String: Any]
            let exposure = (exif?[kCGImagePropertyExifExposureTime as String] as? Double) ?? (self.device?.exposureDuration.seconds ?? 0)
            let iso = ((exif?[kCGImagePropertyExifISOSpeedRatings as String] as? [NSNumber])?.first?.doubleValue) ?? Double(self.device?.iso ?? 0)
            let px = photo.pixelBuffer
            self.work.async {
                // Preferred: add up the photosites ourselves. Fallback: Apple develops it linearly, then we average 2×2.
                if let px = px, let lv = self.levels(dng), self.superpixel(px, black: lv.black, white: lv.white, exposure: exposure, iso: iso, call: call) { return }
                self.develop(dng, exposure: exposure, iso: iso, call: call)
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
    private func superpixel(_ px: CVPixelBuffer, black: [Double], white: Double, exposure: Double, iso: Double, call: CAPPluginCall) -> Bool {
        CVPixelBufferLockBaseAddress(px, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(px, .readOnly) }
        guard !CVPixelBufferIsPlanar(px), let base = CVPixelBufferGetBaseAddress(px) else { return false }
        let W = CVPixelBufferGetWidth(px), H = CVPixelBufferGetHeight(px), rowBytes = CVPixelBufferGetBytesPerRow(px)
        guard rowBytes >= W * 2, W >= 4, H >= 4 else { return false }
        // Total black over one 2×2 block: four values given in pattern order, or one value used four times.
        let blk4 = black.count >= 4 ? black[0] + black[1] + black[2] + black[3] : 4 * (black.reduce(0, +) / Double(black.count))
        let span = 4 * white - blk4, scale = 65535.0 / span
        let ow = W / 2, oh = H / 2
        var out = [UInt16](repeating: 0, count: ow * oh)
        for oy in 0..<oh {
            let r0 = (base + (2 * oy) * rowBytes).assumingMemoryBound(to: UInt16.self)
            let r1 = (base + (2 * oy + 1) * rowBytes).assumingMemoryBound(to: UInt16.self)
            for ox in 0..<ow {
                let s = Double(Int(r0[2 * ox]) + Int(r0[2 * ox + 1]) + Int(r1[2 * ox]) + Int(r1[2 * ox + 1])) - blk4
                out[oy * ow + ox] = UInt16(max(0, min(65535, (s * scale).rounded())))
            }
        }
        finish(out, ow, oh, exposure: exposure, iso: iso, method: "superpixel", black: blk4 / 4, white: white, call: call)
        return true
    }

    /// Turn upright to match the preview (the sensor reads out sideways) and send.
    private func finish(_ img: [UInt16], _ w: Int, _ h: Int, exposure: Double, iso: Double, method: String, black: Double, white: Double, call: CAPPluginCall) {
        var out = img, rw = w, rh = h
        if w > h {
            var rot = [UInt16](repeating: 0, count: w * h)
            for y in 0..<h { for x in 0..<w { rot[x * h + (h - 1 - y)] = img[y * w + x] } }
            out = rot; rw = h; rh = w
        }
        let data = out.withUnsafeBufferPointer { Data(buffer: $0) }       // little-endian on every iPhone
        call.resolve([
            "width": rw, "height": rh, "bits": 16, "linear": true, "method": method, "black": black, "white": white,
            "exposure": exposure, "iso": iso,
            "data": data.base64EncodedString()
        ])
    }

    /// Fallback: Apple develops the RAW linearly with its processing switched off, then we average 2×2.
    private func develop(_ dng: Data, exposure: Double, iso: Double, call: CAPPluginCall) {
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
        // Average every 2×2 block of (R + G + B) / 3. Every pixel counts; nothing is skipped.
        let ow = W / 2, oh = H / 2
        var out = [UInt16](repeating: 0, count: ow * oh)
        for oy in 0..<oh {
            let r0 = (2 * oy) * W * 4, r1 = r0 + W * 4
            for ox in 0..<ow {
                let a = r0 + ox * 8, b = r1 + ox * 8
                var s = 0
                s += Int(rgba[a]) + Int(rgba[a + 1]) + Int(rgba[a + 2]) + Int(rgba[a + 4]) + Int(rgba[a + 5]) + Int(rgba[a + 6])
                s += Int(rgba[b]) + Int(rgba[b + 1]) + Int(rgba[b + 2]) + Int(rgba[b + 4]) + Int(rgba[b + 5]) + Int(rgba[b + 6])
                out[oy * ow + ox] = UInt16(min(65535, s / 12))
            }
        }
        finish(out, ow, oh, exposure: exposure, iso: iso, method: "developed", black: 0, white: 0, call: call)
    }
}
