# Brightness Game

音频驱动的屏幕亮度与色彩可视化工具。实时分析麦克风或音频文件的频谱，将 BASS / MID / HI 三个频段映射为颜色与亮度，并可同步控制真实显示器亮度。

## 效果

- **几何可视化**：圆形波形 + 放射状频谱条 + 六边形 / 正方形 / 三角形，随音频实时响应
- **页面色彩**：BASS → 红、MID → 绿、HI → 蓝，三频段合成颜色叠加在画面上
- **页面亮度**：黑色蒙层随音量升降，静音时接近全黑
- **屏幕亮度**：调用 macOS 私有接口，直接控制所有显示器的真实亮度

## 要求

- macOS（使用 `DisplayServices` 私有框架控制亮度）
- Node.js 18+
- Swift（Xcode Command Line Tools）

## 安装

```bash
git clone https://github.com/lyloou/brightness-game.git
cd brightness-game
./install.sh
```

## 启动

```bash
./start.sh
```

浏览器打开 [http://localhost:3000](http://localhost:3000)

## 使用

| 输入源 | 说明 |
|--------|------|
| 文件 | 选择本地音频文件（mp3 / wav / flac 等） |
| URL | 粘贴音频直链（目标服务器需允许跨域） |
| 麦克风 | 实时捕获麦克风输入 |

| 亮度模式 | 行为 |
|----------|------|
| 关闭 | 纯可视化，不做任何亮度控制 |
| 页面色彩 | 频段 RGB 染色叠加（默认开启） |
| 页面亮度 | 黑色蒙层随音量变化 |
| 屏幕亮度 | 控制真实显示器亮度，切走时自动恢复 100% |

## 技术说明

屏幕亮度控制使用 macOS `DisplayServices` 私有框架（`DisplayServicesSetBrightness`），支持多显示器同步控制。通过 Node.js 后端暴露 `/api/brightness` 接口供前端调用。

> Homebrew 的 `brightness` CLI 在 macOS Ventura+ / Apple Silicon 上因 IOKit 权限限制已失效，本项目使用 `DisplayServices` 绕过该限制。
