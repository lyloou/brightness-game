//
// set_brightness — macOS 命令行工具：将当前所有活动显示器的亮度设为同一数值。
//
// 用法：
//   ./set_brightness <0.0～1.0>
//   示例：./set_brightness 0.35
//
// 编译（需已安装 Xcode Command Line Tools：`xcode-select --install`）：
//   swiftc set_brightness.swift -o set_brightness \
//     -F /System/Library/PrivateFrameworks -framework DisplayServices
//
// 说明：
// - 使用 DisplayServices 私有 API（DisplayServicesSetBrightness）；系统大版本更新后存在失效可能。
// - 缺少参数或无法解析为浮点数时，向 stderr 打印 Usage 并以退出码 1 退出。
// - 传入值会被限制在闭区间 [0.0, 1.0]。
//
import Foundation
import CoreGraphics

/// 链接到 DisplayServices 中的符号：将指定显示器的亮度设为 `brightness`（0～1）。
@_silgen_name("DisplayServicesSetBrightness")
func DisplayServicesSetBrightness(_ display: CGDirectDisplayID, _ brightness: Float) -> Int32

guard CommandLine.arguments.count > 1,
      let value = Float(CommandLine.arguments[1]) else {
    fputs("Usage: set_brightness <0.0-1.0>\n", stderr)
    exit(1)
}

let clamped = max(0.0, min(1.0, value))

var displayCount: UInt32 = 0
CGGetActiveDisplayList(0, nil, &displayCount)
var displays = [CGDirectDisplayID](repeating: 0, count: Int(displayCount))
CGGetActiveDisplayList(displayCount, &displays, &displayCount)

for id in displays {
    _ = DisplayServicesSetBrightness(id, clamped)
}
