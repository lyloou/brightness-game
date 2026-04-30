const express = require('express');
const { exec } = require('child_process');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let brightnessAvailable = null;

function checkBrightness(cb) {
  if (brightnessAvailable !== null) return cb(brightnessAvailable);
  exec('which brightness', (err) => {
    brightnessAvailable = !err;
    cb(brightnessAvailable);
  });
}

app.post('/api/brightness', (req, res) => {
  const { value } = req.body;
  if (typeof value !== 'number') return res.status(400).json({ error: 'invalid value' });
  const clamped = Math.max(0.05, Math.min(1.0, value));
  checkBrightness((available) => {
    if (!available) {
      return res.json({ ok: false, error: 'brightness CLI not found. brew install brightness' });
    }
    exec(`brightness ${clamped.toFixed(3)}`, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true, value: clamped });
    });
  });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Brightness Game → http://localhost:${PORT}`);
  checkBrightness((ok) => {
    console.log(ok ? '✓ brightness CLI ready' : '⚠ brightness CLI not found (brew install brightness)');
  });
});
