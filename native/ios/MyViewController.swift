// Tells the app shell about the Skyward plug-ins (camera, Apple Weather). See IOS.md, step 5.
import UIKit
import Capacitor

class MyViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SkyCamPlugin())
        bridge?.registerPluginInstance(SkyWeatherPlugin())
    }
}
