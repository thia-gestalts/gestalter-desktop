const { app, BrowserWindow, dialog, ipcMain, protocol } = require('electron');
const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { StorageClient } = require('./client.cjs');
const { pythonCommand } = require('./platform.cjs');

const entryUrl = 'gestalter://app/index.html';
protocol.registerSchemesAsPrivileged([{
  scheme: 'gestalter',
  privileges: { standard: true, secure: true, corsEnabled: true },
}]);

const contentTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
};

async function asset(request) {
  const { hostname, pathname } = new URL(request.url);
  if (request.method !== 'GET' || hostname !== 'app'
      || (pathname !== '/index.html' && !/^\/assets\/[\w-]+\.(js|css)$/.test(pathname))) {
    return new Response(null, { status: 404 });
  }
  try {
    const file = await readFile(path.join(app.getAppPath(), 'dist', pathname.slice(1)));
    return new Response(file, { headers: { 'Content-Type': contentTypes[path.extname(pathname)] } });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return new Response(null, { status: 404 });
  }
}

const methods = new Set([
  'listNotes', 'getNote', 'saveNote', 'deleteNote', 'link',
  'attachImage', 'detachImage', 'getImage', 'importPractice', 'recentPractice',
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  launch();
}

function launch() {
  let window;
  let storage;
  let closeApproved = false;
  let closing = false;

  function fromApp(event) {
    const frame = event.senderFrame;
    return window && event.sender === window.webContents && frame?.parent === null
      && frame.url.split('#')[0] === entryUrl;
  }

  ipcMain.handle('storage', async (event, method, args) => {
    if (!fromApp(event) || !methods.has(method) || !Array.isArray(args)) {
      return { error: 'Unknown storage request.' };
    }
    try {
      return { result: await storage.call(method, args) };
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.on('close-result', (event, success) => {
    if (!fromApp(event) || !closing) return;
    closing = false;
    if (success === true) {
      closeApproved = true;
      window.close();
    }
  });

  app.on('second-instance', () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => storage?.close());

  app.whenReady().then(async () => {
    storage = new StorageClient(pythonCommand(app));
    await storage.ready;
    protocol.handle('gestalter', asset);
    window = new BrowserWindow({
      width: 1120,
      height: 780,
      minWidth: 540,
      minHeight: 440,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.on('close', (event) => {
      if (closeApproved || window.webContents.isCrashed() || window.webContents.isLoadingMainFrame()) return;
      event.preventDefault();
      if (!closing) {
        closing = true;
        window.webContents.send('flush-for-close');
      }
    });
    window.on('closed', () => { window = undefined; });
    await window.loadURL(entryUrl);
  }).catch((error) => {
    closeApproved = true;
    dialog.showErrorBox('Gestalter could not start', error.message);
    app.quit();
  });
}
