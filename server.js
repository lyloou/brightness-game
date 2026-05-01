/**
 * Brightness Game — 本地 HTTP 服务：托管 `public/` 静态前端，并提供调节屏幕亮度的 API。
 *
 * 启动：
 *   先执行 `./install.sh`（npm install + 编译 Swift 得到根目录下的 `set_brightness`），再 `node server.js` 或 `./start.sh`。
 *   浏览器访问：http://localhost:3000（默认端口 3000）。
 *
 * API（浏览器 fetch 或 curl 均可）：
 *   POST /api/brightness
 *   Content-Type: application/json
 *   请求体：{ "value": number }  // 原始亮度系数；服务端会钳制到 [0.05, 1.0]
 *   成功：{ "ok": true, "value": number }
 *   失败：{ "error": string }（如无可执行的 `set_brightness` 或进程报错）
 *
 * 前置：项目根目录存在可执行文件 `set_brightness`，否则调节屏幕亮度会失败。
 */
const express = require('express');
const { exec } = require('child_process');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Compiled Swift tool using CoreDisplay private framework (works on macOS Ventura+/Apple Silicon)
const SET_BRIGHTNESS = path.join(__dirname, 'set_brightness');

/** JSON body：`{ value: number }` → 调用本地 `set_brightness` 可执行文件；成功返回 `{ ok, value }`。 */
app.post('/api/brightness', (req, res) => {
  const { value } = req.body;
  if (typeof value !== 'number') return res.status(400).json({ error: 'invalid value' });
  const clamped = Math.max(0.05, Math.min(1.0, value));
  exec(`"${SET_BRIGHTNESS}" ${clamped.toFixed(3)}`, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true, value: clamped });
  });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Brightness Game → http://localhost:${PORT}`);
});
