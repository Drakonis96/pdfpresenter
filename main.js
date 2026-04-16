const { app, BrowserWindow, ipcMain, dialog, screen, nativeImage, session, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { startServer, stopServer, getServerInfo } = require('./server');
const Store = require('electron-store');

const store = new Store();
let mainWindow;
let presentationWindow;
let presenterWindow;
let wsBroadcast = null;
let powerSaveBlockerId = null;

const DATA_DIR = path.join(app.getPath('userData'), 'presentations');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    icon: path.join(__dirname, 'public', 'logo.png'),
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (presentationWindow) {
      presentationWindow.close();
    }
  });
}

function createPresentationWindow(pdfId, startSlide) {
  const displays = screen.getAllDisplays();
  const externalDisplay = displays.length > 1 ? displays[1] : displays[0];

  presentationWindow = new BrowserWindow({
    x: externalDisplay.bounds.x,
    y: externalDisplay.bounds.y,
    width: externalDisplay.bounds.width,
    height: externalDisplay.bounds.height,
    fullscreen: true,
    icon: path.join(__dirname, 'public', 'logo.png'),
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const info = getServerInfo();
  const port = info ? info.port : 3491;
  let url = `http://localhost:${port}/src/presentation.html?pdfId=${encodeURIComponent(pdfId)}`;
  if (startSlide && startSlide > 1) url += `&startSlide=${startSlide}`;
  presentationWindow.loadURL(url);

  presentationWindow.on('closed', () => {
    presentationWindow = null;
    stopPowerSaveBlock();
    if (presenterWindow) {
      presenterWindow.close();
      presenterWindow = null;
    }
    if (mainWindow) {
      mainWindow.webContents.send('presentation-ended');
    }
  });
}

function createPresenterWindow(pdfId, startSlide) {
  const displays = screen.getAllDisplays();
  const primaryDisplay = displays[0];

  presenterWindow = new BrowserWindow({
    x: primaryDisplay.bounds.x,
    y: primaryDisplay.bounds.y,
    width: primaryDisplay.bounds.width,
    height: primaryDisplay.bounds.height,
    fullscreen: true,
    icon: path.join(__dirname, 'public', 'logo.png'),
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const info = getServerInfo();
  const port = info ? info.port : 3491;
  let url = `http://localhost:${port}/src/presenter.html?pdfId=${encodeURIComponent(pdfId)}`;
  if (startSlide && startSlide > 1) url += `&startSlide=${startSlide}`;
  presenterWindow.loadURL(url);

  presenterWindow.on('closed', () => {
    presenterWindow = null;
    if (presentationWindow) {
      presentationWindow.close();
    }
  });
}

// IPC Handlers
ipcMain.handle('get-presentations', () => {
  ensureDataDir();
  const metaFile = path.join(DATA_DIR, 'meta.json');
  if (!fs.existsSync(metaFile)) return { presentations: [], folders: [] };
  const raw = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
  // Backward compat: if raw is array, wrap it
  if (Array.isArray(raw)) {
    return { presentations: raw, folders: [] };
  }
  return { presentations: raw.presentations || [], folders: raw.folders || [] };
});

ipcMain.handle('save-presentations-meta', (event, data) => {
  ensureDataDir();
  const metaFile = path.join(DATA_DIR, 'meta.json');
  // Accept either array (legacy) or object { presentations, folders }
  const toSave = Array.isArray(data) ? { presentations: data, folders: [] } : data;
  fs.writeFileSync(metaFile, JSON.stringify(toSave, null, 2));
  return true;
});

ipcMain.handle('import-pdf', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  });
  if (result.canceled || !result.filePaths.length) return null;

  ensureDataDir();
  const srcPath = result.filePaths[0];
  const fileName = path.basename(srcPath);
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  const destPath = path.join(DATA_DIR, `${id}.pdf`);

  fs.copyFileSync(srcPath, destPath);

  const pdfData = {
    id,
    name: fileName.replace('.pdf', ''),
    fileName,
    pdfPath: destPath,
    createdAt: new Date().toISOString(),
    notes: {},
    videos: {},
    totalPages: 0
  };

  // Save meta
  const metaFile = path.join(DATA_DIR, 'meta.json');
  let stored = { presentations: [], folders: [] };
  if (fs.existsSync(metaFile)) {
    const raw = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
    if (Array.isArray(raw)) {
      stored = { presentations: raw, folders: [] };
    } else {
      stored = { presentations: raw.presentations || [], folders: raw.folders || [] };
    }
  }
  stored.presentations.push(pdfData);
  fs.writeFileSync(metaFile, JSON.stringify(stored, null, 2));

  return pdfData;
});

ipcMain.handle('import-pptx-notes', async (event, pdfId) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'PowerPoint Files', extensions: ['pptx'] }]
  });
  if (result.canceled || !result.filePaths.length) return null;

  const pptxPath = result.filePaths[0];
  const { extractNotes } = require('./src/js/pptx-parser');
  const result2 = await extractNotes(pptxPath);
  return result2;
});

ipcMain.handle('get-pdf-data', (event, pdfId) => {
  ensureDataDir();
  const filePath = path.join(DATA_DIR, `${pdfId}.pdf`);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath).toString('base64');
});

function startPowerSaveBlock() {
  if (powerSaveBlockerId === null || !powerSaveBlocker.isStarted(powerSaveBlockerId)) {
    powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
  }
}

function stopPowerSaveBlock() {
  if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
    powerSaveBlocker.stop(powerSaveBlockerId);
    powerSaveBlockerId = null;
  }
}

ipcMain.handle('start-presentation', (event, pdfId, startSlide) => {
  createPresentationWindow(pdfId, startSlide);
  startPowerSaveBlock();
  return true;
});

ipcMain.handle('start-presenter-mode', (event, pdfId, startSlide) => {
  createPresentationWindow(pdfId, startSlide);
  createPresenterWindow(pdfId, startSlide);
  startPowerSaveBlock();
  return true;
});

ipcMain.handle('stop-presentation', () => {
  const pWin = presentationWindow;
  const prWin = presenterWindow;
  presentationWindow = null;
  presenterWindow = null;
  if (pWin && !pWin.isDestroyed()) {
    pWin.close();
  }
  // Defer closing the caller window so the IPC response is sent first
  if (prWin && !prWin.isDestroyed()) {
    setImmediate(() => {
      if (!prWin.isDestroyed()) prWin.close();
    });
  }
  stopPowerSaveBlock();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('presentation-ended');
  }
  return true;
});

ipcMain.handle('get-server-info', () => {
  return getServerInfo();
});

ipcMain.handle('delete-presentation', (event, pdfId) => {
  ensureDataDir();
  const metaFile = path.join(DATA_DIR, 'meta.json');
  if (!fs.existsSync(metaFile)) return false;

  let raw = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
  let stored;
  if (Array.isArray(raw)) {
    stored = { presentations: raw, folders: [] };
  } else {
    stored = { presentations: raw.presentations || [], folders: raw.folders || [] };
  }
  stored.presentations = stored.presentations.filter(p => p.id !== pdfId);
  fs.writeFileSync(metaFile, JSON.stringify(stored, null, 2));

  const pdfFile = path.join(DATA_DIR, `${pdfId}.pdf`);
  if (fs.existsSync(pdfFile)) {
    fs.unlinkSync(pdfFile);
  }
  return true;
});

// Forward presentation control from server to presentation window
ipcMain.on('presentation-control', (event, action) => {
  if (presentationWindow) {
    presentationWindow.webContents.send('presentation-control', action);
  }
});

// Forward presenter control to presentation window (from presenter view)
ipcMain.on('presenter-control', (event, action) => {
  if (presentationWindow) {
    presentationWindow.webContents.send('presentation-control', action);
  }
  // Broadcast zoom-factor to WebSocket clients (mobile remote)
  if (action && action.type === 'zoom-factor' && wsBroadcast) {
    wsBroadcast({ type: 'zoom-factor', factor: action.factor });
  }
});

// Forward presentation control to presenter window (from audience/presentation view)
ipcMain.on('presentation-control-to-presenter', (event, action) => {
  if (presenterWindow) {
    presenterWindow.webContents.send('presentation-control', action);
  }
});

// Cast / AirPlay: open macOS Screen Mirroring picker
ipcMain.handle('show-cast-picker', async () => {
  if (process.platform !== 'darwin') return false;
  return new Promise((resolve) => {
    // Try to open the Screen Mirroring panel from Control Center
    const script = `
      tell application "System Events"
        tell process "ControlCenter"
          set found to false
          repeat with item_i in menu bar items of menu bar 1
            try
              set d to description of item_i
              if d contains "Screen Mirroring" or d contains "Duplicar" or d contains "Pantalla" then
                click item_i
                set found to true
                exit repeat
              end if
            end try
          end repeat
          if not found then error "not found"
        end tell
      end tell
    `;
    execFile('osascript', ['-e', script], (err) => {
      if (err) {
        // Fallback: open Displays settings
        execFile('open', ['x-apple.systempreferences:com.apple.Displays-Settings.extension'], () => {
          resolve(false);
        });
      } else {
        resolve(true);
      }
    });
  });
});

app.whenReady().then(async () => {
  ensureDataDir();

  // Override User-Agent to look like standard Chrome (not Electron)
  // Electron's UA includes "Electron/" and app name which YouTube/Google flag as a bot
  const defaultUA = session.defaultSession.getUserAgent();
  const cleanUA = defaultUA
    .replace(/\s*Electron\/[\S]+/g, '')
    .replace(/\s*pdfpresenter\/[\S]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  session.defaultSession.setUserAgent(cleanUA);

  // Set dock icon on macOS
  if (process.platform === 'darwin' && app.dock) {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'public', 'logo.png'));
    app.dock.setIcon(icon);
  }

  await startServer(DATA_DIR);
  
  // Bridge server events to Electron windows
  const { setElectronCallback, updateState, broadcast } = require('./server');
  wsBroadcast = broadcast;
  setElectronCallback((action, data, replyCallback) => {
    if (action === 'volume-get') {
      if (process.platform === 'darwin') {
        execFile('osascript', ['-e', 'output volume of (get volume settings)'], (err, stdout) => {
          const vol = err ? 50 : parseInt(stdout.trim()) || 50;
          if (replyCallback) replyCallback(vol);
        });
      } else {
        if (replyCallback) replyCallback(50);
      }
      return;
    }

    if (action === 'volume-set') {
      if (process.platform === 'darwin') {
        const vol = Math.max(0, Math.min(100, parseInt(data) || 0));
        execFile('osascript', ['-e', `set volume output volume ${vol}`]);
      }
      return;
    }

    if (action === 'black-screen') {
      const msg = { type: 'black-screen', enabled: data };
      if (presentationWindow) {
        presentationWindow.webContents.send('presentation-control', msg);
      }
      if (presenterWindow) {
        presenterWindow.webContents.send('presentation-control', msg);
      }
      return;
    }

    if (action === 'timer-toggle' || action === 'timer-reset') {
      if (presenterWindow) {
        presenterWindow.webContents.send('presentation-control', { type: action, data });
      }
      return;
    }

    if (action === 'slide-zoom') {
      const msg = { type: 'slide-zoom', data };
      if (presentationWindow) {
        presentationWindow.webContents.send('presentation-control', msg);
      }
      if (presenterWindow) {
        presenterWindow.webContents.send('presentation-control', msg);
      }
      return;
    }

    const msg = { type: action };
    if (action === 'navigate') msg.slide = data;
    else if (action === 'tool') msg.tool = data;
    else if (action === 'tool-data') msg.data = data;
    else if (action === 'tool-size') msg.data = data;
    else if (action === 'zoom-factor') msg.factor = data.factor;
    if (presentationWindow) {
      presentationWindow.webContents.send('presentation-control', msg);
    }
    if (presenterWindow) {
      presenterWindow.webContents.send('presentation-control', msg);
    }
  });

  // Forward timer-sync from presenter to all clients
  ipcMain.on('timer-sync', (event, data) => {
    updateState({ timerSeconds: data.timerSeconds, timerRunning: data.timerRunning });
    broadcast({ type: 'timer-sync', data });
  });

  // When presentation window sends state updates, push to server
  ipcMain.on('presentation-state-update', (event, stateData) => {
    updateState(stateData);
  });

  createMainWindow();
});

app.on('window-all-closed', () => {
  stopServer();
  app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createMainWindow();
});

module.exports = { getMainWindow: () => mainWindow, getPresentationWindow: () => presentationWindow };
