// Tells the app shell about the Skyward camera plug-in. See IOS.md, step 5.
import UIKit
import Capacitor

class MyViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SkyCamPlugin())
    }
}
