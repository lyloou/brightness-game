import Foundation
import CoreGraphics

@_silgen_name("DisplayServicesSetBrightness")
func DisplayServicesSetBrightness(_ display: CGDirectDisplayID, _ brightness: Float) -> Int32

guard CommandLine.arguments.count > 1,
      let value = Float(CommandLine.arguments[1]) else {
    fputs("Usage: set_brightness <0.0-1.0>\n", stderr)
    exit(1)
}

let clamped = max(0.0, min(1.0, value))
_ = DisplayServicesSetBrightness(CGMainDisplayID(), clamped)
