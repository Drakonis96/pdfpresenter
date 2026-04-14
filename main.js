const { app, BrowserWindow, ipcMain, dialog, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer, stopServer, getServerInfo } = require('./server');
const Store = require('electron-store');

const store = new Store();
let mainWindow;
let presentationWindow;
let presenterWindow;

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

function createPresentationWindow(pdfId) {
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
  presentationWindow.loadURL(`http://localhost:${port}/src/presentation.html?pdfId=${encodeURIComponent(pdfId)}`);

  presentationWindow.on('closed', () => {
    presentationWindow = null;
    if (presenterWindow) {
      presenterWindow.close();
      presenterWindow = null;
    }
    if (mainWindow) {
      mainWindow.webContents.send('presentation-ended');
    }
  });
}

function createPresenterWindow(pdfId) {
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
  presenterWindow.loadURL(`http://localhost:${port}/src/presenter.html?pdfId=${encodeURIComponent(pdfId)}`);

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

ipcMain.handle('start-presentation', (event, pdfId) => {
  createPresentationWindow(pdfId);
  return true;
});

ipcMain.handle('start-presenter-mode', (event, pdfId) => {
  createPresentationWindow(pdfId);
  createPresenterWindow(pdfId);
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
  if (prWin && !prWin.isDestroyed()) {
    prWin.close();
  }
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
});

app.whenReady().then(async () => {
  ensureDataDir();

  // Set dock icon on macOS
  if (process.platform === 'darwin' && app.dock) {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'public', 'logo.png'));
    app.dock.setIcon(icon);
  }

  await startServer(DATA_DIR);
  
  // Bridge server events to Electron windows
  const { setElectronCallback, updateState } = require('./server');
  setElectronCallback((action, data) => {
    const msg = { type: action };
    if (action === 'navigate') msg.slide = data;
    else if (action === 'tool') msg.tool = data;
    else if (action === 'tool-data') msg.data = data;
    else if (action === 'tool-size') msg.data = data;
    if (presentationWindow) {
      presentationWindow.webContents.send('presentation-control', msg);
    }
    if (presenterWindow) {
      presenterWindow.webContents.send('presentation-control', msg);
    }
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
