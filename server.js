const express = require('express');
const { exec } = require('child_process');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Compiled Swift tool using CoreDisplay private framework (works on macOS Ventura+/Apple Silicon)
const SET_BRIGHTNESS = path.join(__dirname, 'set_brightness');

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
