const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const QRCode = require('qrcode');

let server;
let wss;
let connectionPin = null;
let dataDir;
let currentState = {
  presenting: false,
  pdfId: null,
  currentSlide: 1,
  totalSlides: 0,
  notes: {},
  videos: {},
  toolMode: null, // 'flashlight', 'draw', 'pointer', 'zoom'
  videoPlaying: false,
  timerSeconds: 0,
  timerRunning: false,
  blackScreen: false,
  slideZoom: { scale: 1, originX: 50, originY: 50 }
};

const clients = new Set();

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function broadcast(data, excludeWs = null) {
  const msg = JSON.stringify(data);
  for (const client of clients) {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

function startServer(dataDirPath, port) {
  return new Promise((resolve) => {
    dataDir = dataDirPath;
    const app = express();
    server = http.createServer(app);
    wss = new WebSocket.Server({ server });

    app.use(express.json());
    app.use('/mobile', express.static(path.join(__dirname, 'src', 'mobile')));
    app.use('/mobile/logo.png', express.static(path.join(__dirname, 'public', 'logo.png')));
    app.use('/libs', express.static(path.join(__dirname, 'node_modules', 'pdfjs-dist')));
    app.use('/src', express.static(path.join(__dirname, 'src')));
    app.use('/public', express.static(path.join(__dirname, 'public')));

    // Serve PDF files
    app.get('/api/pdf/:id', (req, res) => {
      const safeId = path.basename(req.params.id);
      const pdfPath = path.join(dataDir, `${safeId}.pdf`);
      const resolved = path.resolve(pdfPath);
      if (!resolved.startsWith(path.resolve(dataDir) + path.sep)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (!fs.existsSync(pdfPath)) {
        return res.status(404).json({ error: 'PDF not found' });
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.sendFile(pdfPath);
    });

    // Get current state
    app.get('/api/state', (req, res) => {
      res.json(currentState);
    });

    // Get QR code
    app.get('/api/qr', async (req, res) => {
      const ip = getLocalIP();
      const port = server.address().port;
      const url = `http://${ip}:${port}/mobile/?pin=${connectionPin}`;
      const qr = await QRCode.toDataURL(url, { width: 300, margin: 2 });
      res.json({ qr, url, ip, pin: connectionPin });
    });

    // Get presentations metadata
    app.get('/api/presentations', (req, res) => {
      const metaFile = path.join(dataDir, 'meta.json');
      if (!fs.existsSync(metaFile)) return res.json({ presentations: [], folders: [] });
      const raw = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
      // Backward compat
      if (Array.isArray(raw)) return res.json({ presentations: raw, folders: [] });
      res.json(raw);
    });

    // WebSocket handling
    wss.on('connection', (ws, req) => {
      // Check PIN authentication for non-local connections
      const url = new URL(req.url, `http://${req.headers.host}`);
      const pin = url.searchParams.get('pin');
      const isLocalElectron = req.headers.origin && (
        req.headers.origin.startsWith('http://localhost') ||
        req.headers.origin.startsWith('http://127.0.0.1') ||
        req.headers.origin.startsWith('file://')
      );

      if (!isLocalElectron && pin !== connectionPin) {
        ws.close(4001, 'Invalid PIN');
        return;
      }

      clients.add(ws);

      // Send current state to new client
      ws.send(JSON.stringify({ type: 'state', data: currentState }));

      ws.on('message', (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw);
        } catch { return; }

        switch (msg.type) {
          case 'navigate': {
            const slide = parseInt(msg.slide, 10);
            if (isNaN(slide) || slide < 1 || (currentState.totalSlides > 0 && slide > currentState.totalSlides)) break;
            currentState.currentSlide = slide;
            currentState.videoPlaying = false;
            currentState.slideZoom = { scale: 1, originX: 50, originY: 50 };
            broadcast({ type: 'state', data: currentState });
            // Also tell Electron presentation window
            notifyElectron('navigate', slide);
            break;
          }

          case 'next':
            if (currentState.currentSlide < currentState.totalSlides) {
              currentState.currentSlide++;
              currentState.videoPlaying = false;
              currentState.slideZoom = { scale: 1, originX: 50, originY: 50 };
              broadcast({ type: 'state', data: currentState });
              notifyElectron('navigate', currentState.currentSlide);
            }
            break;

          case 'prev':
            if (currentState.currentSlide > 1) {
              currentState.currentSlide--;
              currentState.videoPlaying = false;
              currentState.slideZoom = { scale: 1, originX: 50, originY: 50 };
              broadcast({ type: 'state', data: currentState });
              notifyElectron('navigate', currentState.currentSlide);
            }
            break;

          case 'tool':
            currentState.toolMode = msg.tool;
            broadcast({ type: 'state', data: currentState });
            notifyElectron('tool', msg.tool);
            break;

          case 'tool-data':
            // Forward drawing/pointer data to presentation
            broadcast({ type: 'tool-data', data: msg.data }, ws);
            notifyElectron('tool-data', msg.data);
            break;

          case 'tool-size':
            broadcast({ type: 'tool-size', data: msg.data });
            notifyElectron('tool-size', msg.data);
            break;

          case 'zoom-factor':
            broadcast({ type: 'zoom-factor', factor: msg.factor });
            notifyElectron('zoom-factor', { factor: msg.factor });
            break;

          case 'video-toggle':
            currentState.videoPlaying = !currentState.videoPlaying;
            broadcast({ type: 'state', data: currentState }, ws);
            notifyElectron('video-toggle');
            break;

          case 'timer-sync':
            currentState.timerSeconds = msg.data.timerSeconds;
            currentState.timerRunning = msg.data.timerRunning;
            broadcast({ type: 'timer-sync', data: msg.data }, ws);
            break;

          case 'timer-toggle':
            currentState.timerRunning = !currentState.timerRunning;
            broadcast({ type: 'timer-sync', data: { timerSeconds: currentState.timerSeconds, timerRunning: currentState.timerRunning } });
            notifyElectron('timer-toggle', { timerSeconds: currentState.timerSeconds, timerRunning: currentState.timerRunning });
            break;

          case 'timer-reset':
            currentState.timerSeconds = 0;
            broadcast({ type: 'timer-sync', data: { timerSeconds: 0, timerRunning: currentState.timerRunning } });
            notifyElectron('timer-reset', { timerSeconds: 0, timerRunning: currentState.timerRunning });
            break;

          case 'black-screen':
            currentState.blackScreen = !currentState.blackScreen;
            broadcast({ type: 'state', data: currentState });
            notifyElectron('black-screen', currentState.blackScreen);
            break;

          case 'volume-get':
            notifyElectron('volume-get', null, (volume) => {
              ws.send(JSON.stringify({ type: 'volume', data: { volume } }));
            });
            break;

          case 'volume-set':
            notifyElectron('volume-set', msg.data.volume);
            broadcast({ type: 'volume', data: { volume: msg.data.volume } }, ws);
            break;

          case 'state-update':
            Object.assign(currentState, msg.data);
            broadcast({ type: 'state', data: currentState }, ws);
            break;

          case 'slide-zoom':
            currentState.slideZoom = msg.data;
            broadcast({ type: 'slide-zoom', data: msg.data }, ws);
            notifyElectron('slide-zoom', msg.data);
            break;
        }
      });

      ws.on('close', () => {
        clients.delete(ws);
      });

      ws.on('error', (err) => {
        console.error('WebSocket client error:', err.message);
        clients.delete(ws);
      });
    });

    // Generate a 6-digit PIN for this session
    connectionPin = String(crypto.randomInt(100000, 999999));

    const PORT = port != null ? port : 3491;
    server.listen(PORT, '0.0.0.0', () => {
      const actualPort = server.address().port;
      const ip = getLocalIP();
      console.log(`Server running at http://${ip}:${actualPort}`);
      resolve({ ip, port: actualPort });
    });
  });
}

// Bridge to Electron main process
let electronCallback = null;
function setElectronCallback(cb) {
  electronCallback = cb;
}
function notifyElectron(action, data, replyCallback) {
  if (electronCallback) electronCallback(action, data, replyCallback);
}

function updateState(newState) {
  Object.assign(currentState, newState);
  broadcast({ type: 'state', data: currentState });
}

function stopServer() {
  if (wss) {
    for (const client of clients) client.close();
    clients.clear();
    wss.close();
  }
  if (server) server.close();
}

function getServerInfo() {
  if (!server || !server.address()) return null;
  return {
    ip: getLocalIP(),
    port: server.address().port,
    url: `http://${getLocalIP()}:${server.address().port}/mobile/`
  };
}

module.exports = {
  startServer,
  stopServer,
  getServerInfo,
  updateState,
  setElectronCallback,
  broadcast,
  getCurrentState: () => currentState,
  getConnectionPin: () => connectionPin
};
