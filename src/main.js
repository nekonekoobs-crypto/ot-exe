// Proceso principal de Electron: ventana, servicios y puente (IPC) con la interfaz.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, protocol, net } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { cargar } = require('./config');
const { Servicios } = require('./servicios');
const { crearManejadores } = require('./ipc');
const google = require('./google');
const ocr = require('./ocr');

let ventana = null; let sv = null;
const RAIZ = path.resolve(path.join(__dirname, '..'));

// La interfaz se carga con un protocolo propio (app://) para que funcionen los módulos y workers (pdf.js) con seguridad normal.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

function servirApp() {
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    const f = path.resolve(path.join(RAIZ, decodeURIComponent(u.pathname)));
    if (f !== RAIZ && !f.startsWith(RAIZ + path.sep)) return new Response('Prohibido', { status: 403 });
    return net.fetch(pathToFileURL(f).toString());
  });
}

function crearVentana() {
  ventana = new BrowserWindow({
    width: 1360, height: 860, minWidth: 980, minHeight: 640, backgroundColor: '#0f1623', title: 'OT TRACSA', autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'logo_tracsa.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  Menu.setApplicationMenu(null);
  ventana.loadURL('app://local/src/renderer/index.html');
  // Los enlaces externos se abren en el navegador, nunca dentro de la app
  ventana.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  ventana.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) e.preventDefault(); });
}

const unica = app.requestSingleInstanceLock();
if (!unica) app.quit();
else {
  app.on('second-instance', () => { if (ventana) { if (ventana.isMinimized()) ventana.restore(); ventana.focus(); } });
  app.whenReady().then(() => {
    const datos = app.getPath('userData');
    const docs = path.join(app.getPath('documents'), 'OT TRACSA');
    sv = new Servicios(datos, cargar(datos), docs);
    sv.alSync = (r) => { if (ventana && !ventana.isDestroyed()) ventana.webContents.send('ev:sync', r, sv.estado()); };
    const m = crearManejadores(sv, { dialog, shell, ventana: () => ventana, documentos: app.getPath('documents'), google, ocr });
    for (const [canal, fn] of Object.entries(m)) ipcMain.handle('ot:' + canal, (_e, ...a) => fn(...a));
    servirApp();
    crearVentana();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { ocr.cerrar(); });
}
