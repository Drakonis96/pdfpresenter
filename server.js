const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');
const QRCode = require('qrcode');

let server;
let wss;
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
  blackScreen: false
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

function startServer(dataDirPath) {
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
      const pdfPath = path.join(dataDir, `${req.params.id}.pdf`);
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
      const url = `http://${ip}:${server.address().port}/mobile/`;
      const qr = await QRCode.toDataURL(url, { width: 300, margin: 2 });
      res.json({ qr, url, ip });
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
    wss.on('connection', (ws) => {
      clients.add(ws);

      // Send current state to new client
      ws.send(JSON.stringify({ type: 'state', data: currentState }));

      ws.on('message', (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw);
        } catch { return; }

        switch (msg.type) {
          case 'navigate':
            currentState.currentSlide = msg.slide;
            currentState.videoPlaying = false;
            broadcast({ type: 'state', data: currentState });
            // Also tell Electron presentation window
            notifyElectron('navigate', msg.slide);
            break;

          case 'next':
            if (currentState.currentSlide < currentState.totalSlides) {
              currentState.currentSlide++;
              currentState.videoPlaying = false;
              broadcast({ type: 'state', data: currentState });
              notifyElectron('next');
            }
            break;

          case 'prev':
            if (currentState.currentSlide > 1) {
              currentState.currentSlide--;
              currentState.videoPlaying = false;
              broadcast({ type: 'state', data: currentState });
              notifyElectron('prev');
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
        }
      });

      ws.on('close', () => {
        clients.delete(ws);
      });
    });

    const PORT = 3491;
    server.listen(PORT, '0.0.0.0', () => {
      const ip = getLocalIP();
      console.log(`Server running at http://${ip}:${PORT}`);
      resolve({ ip, port: PORT });
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
  getCurrentState: () => currentState
};
