const { app, BrowserWindow, dialog, ipcMain, protocol } = require('electron');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { mkdtemp, readFile, rename, rm, writeFile } = require('node:fs/promises');
const { StorageClient } = require('./client.cjs');
const { pythonCommand } = require('./platform.cjs');

const service = new URL(process.env.OLYMP_ORIGIN || 'http://127.0.0.1:8787');
if (service.protocol !== 'https:' && !(service.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(service.hostname))) {
  throw Error('Olymp requires HTTPS outside loopback.');
}
const entryUrl = 'gestalter://app/index.html';
protocol.registerSchemesAsPrivileged([{
  scheme: 'gestalter',
  privileges: { standard: true, secure: true, corsEnabled: true, supportFetchAPI: true },
}]);

const contentTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.css': 'text/css',
};

async function asset(request) {
  const { hostname, pathname } = new URL(request.url);
  if (hostname === 'app' && pathname.startsWith('/v1/')) {
    const headers = new Headers();
    for (const key of ['authorization', 'x-olymp-account', 'content-type']) {
      if (request.headers.has(key)) headers.set(key, request.headers.get(key));
    }
    try {
      return await fetch(service.origin + pathname, {
        method: request.method, headers, redirect: 'error', signal: request.signal,
        body: request.body ? await request.arrayBuffer() : undefined,
      });
    } catch {
      return new Response(null, { status: 503 });
    }
  }
  const runtime = /^\/olymp\/(client\.js|browser\.js|opaque\/opaque(\.js|_bg\.wasm)|sodium\/libsodium-(wrappers|sumo)\.mjs)$/;
  if (request.method !== 'GET' || hostname !== 'app'
      || (pathname !== '/index.html' && !runtime.test(pathname) && !/^\/assets\/[\w-]+\.(js|css)$/.test(pathname))) {
    return new Response(null, { status: 404 });
  }
  try {
    const file = await readFile(path.join(app.getAppPath(), 'dist', pathname.slice(1)));
    if (pathname === '/index.html') {
      const nonce = randomBytes(24).toString('base64');
      return new Response(file.toString().replaceAll('GESTALTER_STYLE_NONCE', nonce), {
        headers: { 'Content-Type': 'text/html' },
      });
    }
    return new Response(file, { headers: { 'Content-Type': contentTypes[path.extname(pathname)] } });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return new Response(null, { status: 404 });
  }
}

const methods = new Set([
  'listNotes', 'linkTargets', 'getNote', 'saveNote', 'deleteNote', 'link',
  'attachImage', 'detachImage', 'getImage', 'account', 'serviceOrigin', 'importPractice', 'recentPractice', 'learningHistory',
  'zettelkasten', 'placeNote', 'pickInboxFolder', 'importInbox', 'listInbox', 'getInboxItem', 'deferInbox', 'removeInbox',
  'previewBibtex', 'sourceLibrary', 'sourceLinks', 'sourceDetails', 'importSources', 'saveSource', 'deleteSource', 'editSourceLinks', 'reconcileSource', 'addAnnotation',
  'exportBibtex', 'saveBibtexFile',
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
      if (method === 'pickInboxFolder') {
        const { canceled, filePaths } = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
        return { result: canceled ? null : await storage.call('readInboxFolder', [filePaths[0]]) };
      }
      if (method === 'saveBibtexFile') {
        const [text] = args;
        if (typeof text !== 'string') throw Error('Expected BibTeX text.');
        const { canceled, filePath } = await dialog.showSaveDialog(window, {
          title: 'Export BibTeX', defaultPath: 'sources.bib', filters: [{ name: 'BibTeX', extensions: ['bib'] }],
        });
        if (canceled || !filePath) return { result: false };
        if (path.extname(filePath).toLowerCase() !== '.bib') throw Error('Choose a filename ending in .bib.');
        const temporary = await mkdtemp(path.join(path.dirname(filePath), '.gestalter-'));
        try {
          const pending = path.join(temporary, 'sources.bib');
          await writeFile(pending, text, { mode: 0o600 });
          await rename(pending, filePath);
        } finally {
          await rm(temporary, { recursive: true });
        }
        return { result: true };
      }
      return { result: method === 'serviceOrigin' ? service.origin : await storage.call(method, args) };
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
    window.webContents.on('will-navigate', (event) => {
      if (event.url.split('#')[0] !== entryUrl) event.preventDefault();
    });
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
