/**
 * Brightness Game — 浏览器端逻辑（须通过本仓库启动的 Node 服务访问，以保证同源调用 `/api/brightness`）。
 *
 * 使用步骤：
 * 1. 在本机运行 `server.js`（见仓库 README / server.js 顶部注释），用浏览器打开提示的本地 URL。
 * 2. 在「文件」「URL」「麦克风」标签中任选一种音源；文件/URL 需播放开始后才开始可视化。
 * 3. 底部「亮度模式」：关闭 | 页面色彩 | 页面亮度 | 屏幕亮度。
 *    - 「屏幕亮度」：按音量间歇 POST `{ value }` 到 `/api/brightness`，由服务端调用 macOS 上的 `set_brightness` 改系统显示器亮度（仅 macOS + 已编译辅助程序时有效）。
 *    - 「页面色彩 / 页面亮度」：仅在当前网页画布上叠加效果，不修改系统亮度。
 * 4. 麦克风与跨域音频 URL 可能受浏览器权限或 CORS 策略限制。
 */
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let audioCtx, analyser, source, animFrame;
let audioElement = null;
let isActive = false;
let micStream = null;
let lastBrightnessUpdate = 0;
const BRIGHTNESS_INTERVAL = 80;
let brightnessMode = 'off'; // 'off' | 'color' | 'page' | 'screen'

// --- Resize ---
/** 将画布尺寸设为当前窗口宽高，使可视化全屏适配。 */
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// --- Brightness mode selector ---
document.querySelectorAll('.bmode').forEach(btn => {
  btn.addEventListener('click', () => {
    const prev = brightnessMode;
    brightnessMode = btn.dataset.mode;
    document.querySelectorAll('.bmode').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (prev === 'screen' && brightnessMode !== 'screen') updateBrightness(1.0);
    if (brightnessMode === 'color') updateBrightness(1.0);
  });
});

// --- Tab switching ---
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// --- File input label ---
document.getElementById('file-input').addEventListener('change', (e) => {
  const f = e.target.files[0];
  document.getElementById('file-name').textContent = f ? f.name : '未选择';
});

// --- Seekbar & play/pause ---
const seekbarWrap  = document.getElementById('seekbar-wrap');
const seekbar      = document.getElementById('seekbar');
const seekFill     = document.getElementById('seek-fill');
const seekThumb    = document.getElementById('seek-thumb');
const seekCur      = document.getElementById('seek-cur');
const seekDur      = document.getElementById('seek-dur');
const btnPlayPause = document.getElementById('btn-playpause');

/**
 * 将秒数格式化为 `分:秒` 字符串（用于进度条时间展示）。
 * @param {number} s 秒数
 * @returns {string} 如 `3:05`；非法输入时为 `0:00`
 */
function fmtTime(s) {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

/** 根据当前 `audioElement` 播放进度更新进度条填充与两侧时间文案。 */
function updateSeek() {
  if (!audioElement || !audioElement.duration) return;
  const pct = audioElement.currentTime / audioElement.duration * 100;
  seekFill.style.width = pct + '%';
  seekThumb.style.left = pct + '%';
  seekCur.textContent  = fmtTime(audioElement.currentTime);
  seekDur.textContent  = fmtTime(audioElement.duration);
}

/** 根据 `audioElement` 暂停状态切换播放/暂停按钮上的符号。 */
function updatePlayPauseBtn() {
  btnPlayPause.textContent = (!audioElement || audioElement.paused) ? '▶' : '⏸';
}

btnPlayPause.addEventListener('click', () => {
  if (!audioElement) return;
  if (audioElement.paused) {
    audioElement.play();
  } else {
    audioElement.pause();
  }
  updatePlayPauseBtn();
});

/**
 * 从鼠标或触摸事件中读取相对于视口的 X 坐标（用于拖动进度条）。
 * @param {MouseEvent|TouchEvent} e
 * @returns {number}
 */
function getClientX(e) {
  return e.touches ? e.touches[0].clientX : e.clientX;
}

/**
 * 将进度定位到进度条上与 `clientX` 对应的比例位置。
 * @param {number} clientX 视口 X 坐标
 */
function seekTo(clientX) {
  if (!audioElement || !audioElement.duration) return;
  const rect = seekbar.getBoundingClientRect();
  const pct  = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  audioElement.currentTime = pct * audioElement.duration;
  updateSeek();
}

let seeking = false;
seekbar.addEventListener('mousedown', (e) => {
  seeking = true;
  seekbar.classList.add('dragging');
  seekTo(e.clientX);
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => { if (seeking) seekTo(e.clientX); });
window.addEventListener('mouseup', () => {
  if (seeking) { seeking = false; seekbar.classList.remove('dragging'); }
});
seekbar.addEventListener('touchstart', (e) => {
  seeking = true;
  seekbar.classList.add('dragging');
  seekTo(e.touches[0].clientX);
}, { passive: true });
window.addEventListener('touchmove', (e) => {
  if (seeking) seekTo(e.touches[0].clientX);
}, { passive: true });
window.addEventListener('touchend', () => {
  if (seeking) { seeking = false; seekbar.classList.remove('dragging'); }
});

// --- Audio context setup ---
/**
 * 创建并配置用于频谱/波形分析的 `AnalyserNode`。
 * @param {AudioContext} ctx Web Audio 上下文
 * @returns {AnalyserNode}
 */
function createAnalyser(ctx) {
  const a = ctx.createAnalyser();
  a.fftSize = 2048;
  a.smoothingTimeConstant = 0.82;
  return a;
}

// --- Stop everything ---
/** 停止动画帧、断开音频节点、关闭 AudioContext、停止麦克风和 `<audio>`，并隐藏进度条区域。 */
function stop() {
  isActive = false;
  if (animFrame) cancelAnimationFrame(animFrame);
  if (source) { try { source.disconnect(); } catch (_) {} source = null; }
  if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  if (audioElement) { audioElement.pause(); audioElement = null; }
  seekbarWrap.classList.add('hidden');
}

/**
 * 在面板底部显示状态文案，并可附带样式类名（如 ok / error / warn）。
 * @param {string} msg 提示文本
 * @param {string} [type=''] 应用到 `#status` 的 class
 */
function setStatus(msg, type = '') {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = type;
}

// --- Mic ---
const btnMic = document.getElementById('btn-mic');
btnMic.addEventListener('click', async () => {
  if (isActive) {
    stop();
    btnMic.textContent = '开始监听';
    btnMic.classList.remove('active');
    setStatus('已停止');
    return;
  }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    audioCtx = new AudioContext();
    analyser = createAnalyser(audioCtx);
    source = audioCtx.createMediaStreamSource(micStream);
    source.connect(analyser);
    startDraw();
    btnMic.textContent = '停止';
    btnMic.classList.add('active');
    setStatus('麦克风已连接', 'ok');
  } catch (e) {
    setStatus('麦克风失败: ' + e.message, 'error');
  }
});

// --- File ---
document.getElementById('btn-file').addEventListener('click', () => {
  const file = document.getElementById('file-input').files[0];
  if (!file) { setStatus('请先选择文件', 'warn'); return; }
  loadAudio(URL.createObjectURL(file), file.name);
});

// --- URL ---
document.getElementById('btn-url').addEventListener('click', () => {
  const url = document.getElementById('url-input').value.trim();
  if (!url) { setStatus('请输入 URL', 'warn'); return; }
  loadAudio(url, url.split('/').pop() || url);
});

/**
 * 停止上一路音源后，用给定地址加载音频：接入 Web Audio、驱动可视化并开始播放。
 * @param {string} src 音频 URL（含 blob:）或远程 URL
 * @param {string} label 状态栏展示的简短名称
 */
function loadAudio(src, label) {
  stop();
  audioCtx = new AudioContext();
  analyser = createAnalyser(audioCtx);

  audioElement = new Audio();
  audioElement.crossOrigin = 'anonymous';
  audioElement.src = src;

  source = audioCtx.createMediaElementSource(audioElement);
  source.connect(analyser);
  source.connect(audioCtx.destination);

  audioElement.addEventListener('timeupdate', updateSeek);
  audioElement.addEventListener('pause', updatePlayPauseBtn);
  audioElement.addEventListener('play',  updatePlayPauseBtn);
  audioElement.addEventListener('loadedmetadata', () => {
    seekbarWrap.classList.remove('hidden');
    updateSeek();
  });

  audioElement.play()
    .then(() => { startDraw(); setStatus(`▶ ${label}`, 'ok'); })
    .catch(e => setStatus('播放失败: ' + e.message, 'error'));

  audioElement.addEventListener('ended', () => setStatus('播放结束'));
}

// --- Draw loop ---
/**
 * 启动 `requestAnimationFrame` 绘制循环：解析频段与 RMS 音量，绘制 Canvas，并按模式更新页面或请求系统亮度。
 */
function startDraw() {
  isActive = true;
  const freqBuf = new Uint8Array(analyser.frequencyBinCount);
  const timeBuf = new Uint8Array(analyser.fftSize);

  /** 单帧：拉取分析器数据、更新表计与亮度、绘制背景与几何图形。 */
  function frame() {
    if (!isActive) return;
    animFrame = requestAnimationFrame(frame);

    analyser.getByteFrequencyData(freqBuf);
    analyser.getByteTimeDomainData(timeBuf);

    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;
    const sampleRate = audioCtx.sampleRate;
    const binHz = sampleRate / analyser.fftSize;
    const bufLen = freqBuf.length;

    const bassEnd   = Math.max(1, Math.floor(300 / binHz));
    const midEnd    = Math.max(bassEnd + 1, Math.floor(3000 / binHz));
    const trebleEnd = bufLen;

    // Band averages (0–1)
    let bSum = 0, mSum = 0, tSum = 0;
    for (let i = 0; i < bassEnd; i++) bSum += freqBuf[i];
    for (let i = bassEnd; i < midEnd; i++) mSum += freqBuf[i];
    for (let i = midEnd; i < trebleEnd; i++) tSum += freqBuf[i];
    const bass   = bSum / bassEnd / 255;
    const mid    = mSum / (midEnd - bassEnd) / 255;
    const treble = tSum / (trebleEnd - midEnd) / 255;

    // RMS volume
    let sq = 0;
    for (let i = 0; i < timeBuf.length; i++) { const v = (timeBuf[i] - 128) / 128; sq += v * v; }
    const volume = Math.min(1, Math.sqrt(sq / timeBuf.length) * 4);

    // Dominant hue: bass=0°, mid=120°, treble=240°
    const total = bass + mid + treble + 1e-4;
    const hue = (bass * 0 + mid * 120 + treble * 240) / total;

    // Update UI meters
    document.getElementById('m-bass').style.width   = (bass   * 100).toFixed(1) + '%';
    document.getElementById('m-mid').style.width    = (mid    * 100).toFixed(1) + '%';
    document.getElementById('m-treble').style.width = (treble * 100).toFixed(1) + '%';

    // Brightness modes
    const now = performance.now();
    const bVal = 0.08 + volume * 0.92;
    if (now - lastBrightnessUpdate > BRIGHTNESS_INTERVAL) {
      lastBrightnessUpdate = now;
      if (brightnessMode === 'screen') updateBrightness(bVal);
      document.getElementById('m-brightness').style.width = (bVal * 100).toFixed(0) + '%';
      document.getElementById('brightness-val').textContent = (bVal * 100).toFixed(0) + '%';
    }

    // ── Background ──────────────────────────────────────────────
    const bgL = 3 + volume * 12;
    ctx.fillStyle = `hsl(${hue}, 60%, ${bgL}%)`;
    ctx.fillRect(0, 0, W, H);

    const baseR = Math.min(W, H) * 0.22;

    // ── Radial frequency bars ────────────────────────────────────
    const numBars = Math.min(bufLen, 200);
    const innerR  = baseR * 1.05;
    const maxBar  = baseR * 1.6;

    ctx.save();
    for (let i = 0; i < numBars; i++) {
      const t     = i / numBars;
      const angle = t * Math.PI * 2 - Math.PI / 2;
      const val   = freqBuf[i] / 255;
      const len   = val * maxBar;

      // color gradient: bass=red → mid=green → treble=blue
      const barHue = t < 0.2 ? lerp(0, 30, t / 0.2)
                   : t < 0.6 ? lerp(90, 150, (t - 0.2) / 0.4)
                   :            lerp(200, 270, (t - 0.6) / 0.4);

      const x1 = cx + Math.cos(angle) * innerR;
      const y1 = cy + Math.sin(angle) * innerR;
      const x2 = cx + Math.cos(angle) * (innerR + len);
      const y2 = cy + Math.sin(angle) * (innerR + len);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = `hsl(${barHue}, 85%, ${45 + val * 35}%)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();

    // ── Circular waveform ────────────────────────────────────────
    ctx.save();
    ctx.beginPath();
    const wLen = timeBuf.length;
    for (let i = 0; i < wLen; i++) {
      const angle = (i / wLen) * Math.PI * 2 - Math.PI / 2;
      const v = (timeBuf[i] - 128) / 128;
      const r = baseR + v * baseR * 0.75;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = `hsl(${hue + 60}, 90%, 72%)`;
    ctx.lineWidth = 1.8;
    ctx.shadowBlur = 12;
    ctx.shadowColor = `hsl(${hue + 60}, 100%, 80%)`;
    ctx.stroke();
    ctx.restore();

    // ── Center hexagon (bass reactive) ──────────────────────────
    const t = performance.now() / 1000;
    drawPoly(cx, cy, 6, baseR * 0.38 * (1 + bass * 0.9),
      t * (0.4 + bass * 1.8),
      `hsl(${hue + 180}, 90%, ${55 + bass * 30}%)`,
      2 + bass * 4, 20 * bass, hue + 180);

    // ── Inner triangle (treble reactive) ────────────────────────
    drawPoly(cx, cy, 3, baseR * 0.18 * (1 + treble * 0.7),
      -t * (0.9 + treble * 4),
      `hsl(${hue + 300}, 90%, ${65 + treble * 25}%)`,
      1.5 + treble * 2.5, 14 * treble, hue + 300);

    // ── Mid square ──────────────────────────────────────────────
    drawPoly(cx, cy, 4, baseR * 0.26 * (1 + mid * 0.5),
      t * (0.25 + mid * 1.2) + Math.PI / 4,
      `hsl(${hue + 60}, 80%, ${50 + mid * 30}%)`,
      1.5 + mid * 2, 10 * mid, hue + 60);

    // ── Page color overlay: BASS=R, MID=G, HI=B ────────────────
    if (brightnessMode !== 'off') {
      const r = Math.round(bass * 255);
      const g = Math.round(mid * 255);
      const b = Math.round(treble * 255);
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // ── Page brightness overlay ──────────────────────────────────
    if (brightnessMode === 'page') {
      const alpha = lerp(0.88, 0, volume);
      ctx.fillStyle = `rgba(0,0,0,${alpha.toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  frame();
}

/**
 * 线性插值。
 * @param {number} a 起点
 * @param {number} b 终点
 * @param {number} t 比例 [0,1]
 * @returns {number}
 */
function lerp(a, b, t) { return a + (b - a) * t; }

/**
 * 以描边方式绘制正多边形（可带发光），用于频谱中心的装饰图形。
 * @param {number} cx 中心 X
 * @param {number} cy 中心 Y
 * @param {number} sides 边数
 * @param {number} r 外接圆半径
 * @param {number} rotation 起始转角（弧度）
 * @param {string} color 描边颜色（CSS）
 * @param {number} lineW 线宽
 * @param {number} glow `shadowBlur` 强度
 * @param {number} glowHue 发光色的色相
 */
function drawPoly(cx, cy, sides, r, rotation, color, lineW, glow, glowHue) {
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i <= sides; i++) {
    const angle = (i / sides) * Math.PI * 2 + rotation;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = lineW;
  if (glow > 0) {
    ctx.shadowBlur = glow;
    ctx.shadowColor = `hsl(${glowHue}, 100%, 85%)`;
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * 向本机服务的 `/api/brightness` 发送 POST，请求将系统显示器亮度设为 `value`（服务端会再钳制）。
 * @param {number} value 亮度系数，典型范围约 0～1
 */
async function updateBrightness(value) {
  try {
    await fetch('/api/brightness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value })
    });
  } catch (_) {}
}
