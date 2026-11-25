// Skyward Push-To: Apple Weather (WeatherKit) for the night's forecast, in the iPhone app only.
//
// Environment Canada's models stay the main forecast (they are the only ones with seeing and transparency). This adds,
// hour by hour: temperature and dew point (dew on the finder and the secondary mirror), wind and gusts (a light scope
// shakes at high power), cloud at low, middle and high levels (thin high cloud dims faint objects while the sky still
// looks clear; iOS 18 and later), and total cloud everywhere, so the forecast also works outside Canada.
//
// The app calls it through window.Capacitor.Plugins.SkyWeather.hourly({ lat, lon, from, to }) with times in ms.
// It needs the WeatherKit capability on the App ID (Signing & Capabilities in Xcode, and "WeatherKit" under App Services
// for the identifier in the developer portal). Apple's terms: show the Apple Weather mark and the legal link wherever
// this data appears; the plug-in passes both back.

import Foundation
import Capacitor
import CoreLocation
#if canImport(WeatherKit)
import WeatherKit
#endif

@objc(SkyWeatherPlugin)
public class SkyWeatherPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SkyWeatherPlugin"
    public let jsName = "SkyWeather"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "hourly", returnType: CAPPluginReturnPromise),
    ]

    @objc func hourly(_ call: CAPPluginCall) {
        guard let lat = call.getDouble("lat"), let lon = call.getDouble("lon"),
              let fromMs = call.getDouble("from"), let toMs = call.getDouble("to") else {
            call.reject("lat, lon, from and to are needed"); return
        }
        #if canImport(WeatherKit)
        guard #available(iOS 16.0, *) else { call.reject("Apple Weather needs iOS 16 or later", "UNAVAILABLE"); return }
        Task {
            do {
                let service = WeatherService.shared
                let place = CLLocation(latitude: lat, longitude: lon)
                let from = Date(timeIntervalSince1970: fromMs / 1000), to = Date(timeIntervalSince1970: toMs / 1000)
                let hours = try await service.weather(for: place, including: .hourly(startDate: from, endDate: to))
                var out: [[String: Any]] = []
                for h in hours.forecast {
                    var r: [String: Any] = [
                        "t": h.date.timeIntervalSince1970 * 1000,
                        "temp": h.temperature.converted(to: .celsius).value,
                        "dew": h.dewPoint.converted(to: .celsius).value,
                        "hum": h.humidity * 100,
                        "cloud": h.cloudCover * 100,
                        "wind": h.wind.speed.converted(to: .kilometersPerHour).value,
                        "vis": h.visibility.converted(to: .kilometers).value,
                        "pop": h.precipitationChance * 100,
                    ]
                    if let g = h.wind.gust { r["gust"] = g.converted(to: .kilometersPerHour).value }
                    if #available(iOS 18.0, *) {
                        r["low"] = h.cloudCoverByAltitude.low * 100
                        r["mid"] = h.cloudCoverByAltitude.medium * 100
                        r["high"] = h.cloudCoverByAltitude.high * 100
                    }
                    out.append(r)
                }
                let a = try await service.attribution
                call.resolve([
                    "hours": out,
                    "attribution": [
                        "markDark": a.combinedMarkDarkURL.absoluteString,     // for dark backgrounds
                        "markLight": a.combinedMarkLightURL.absoluteString,
                        "legal": a.legalPageURL.absoluteString,
                        "name": a.serviceName,
                    ],
                ])
            } catch {
                print("SkyWeather: \(error)")
                call.reject("Apple Weather: \(error.localizedDescription)", "FAILED")
            }
        }
        #else
        call.reject("Apple Weather is not available in this build", "UNAVAILABLE")
        #endif
    }
}
