// Manejadores del puente entre la ventana y los servicios. Lo usa Electron (main.js) y también las pruebas.
const path = require('path');
const fs = require('fs');
const M = require('./lib/models');

/** d: { dialog, shell, ventana: () => BrowserWindow|null, documentos: carpeta por omisión, google, ocr } */
function crearManejadores(sv, d) {
  const m = {};
  const h = (canal, fn) => {
    m[canal] = async (...a) => {
      try { return { ok: true, v: await fn(...a) }; } catch (e) { return { ok: false, error: sv.supa.mensaje(e) || e.message || String(e) }; }
    };
  };
  const filtrosDoc = [{ name: 'Excel, Word, PDF o imagen', extensions: ['xlsx', 'docx', 'pdf', 'jpg', 'jpeg', 'png', 'bmp', 'webp', 'xls', 'doc'] }];

  h('estado', () => sv.estado());
  h('ordenes', () => sv.ordenes());
  h('orden', (id) => { const o = sv.store.cargar(id); return o ? Object.assign(M.toJson(o), { _editable: sv.puedeEditar(o.id) }) : null; });
  h('guardarOrden', (j) => sv.guardarOrden(j));
  h('borrarOrden', (id) => sv.borrarOrden(id));
  h('guardarFoto', (nombre, datos) => sv.guardarFoto(nombre, Buffer.from(datos)));
  h('leerFoto', (nombre) => { const b = sv.leerFoto(nombre); return b ? new Uint8Array(b) : null; });

  h('entrarClave', async (c, k) => { const s = await sv.supa.entrarConClave(c, k); return { email: s.email, rol: s.rol }; });
  h('entrarGoogle', async () => {
    const { code, verifier } = await d.google.iniciar(sv.supa, (u) => d.shell.openExternal(u));
    const v = d.ventana(); if (v) { if (v.isMinimized()) v.restore(); v.focus(); }
    const s = await sv.supa.entrarConCodigo(code, verifier); return { email: s.email, rol: s.rol };
  });
  h('salir', () => sv.cerrarSesion());
  h('sincronizar', (bajar) => sv.sync.sincronizar(!!bajar));

  h('exportar', async (id) => {
    const o = sv.store.cargar(id); if (!o) throw new Error('OT no encontrada');
    const r = await d.dialog.showSaveDialog(d.ventana(), { title: 'Guardar Excel', defaultPath: path.join(d.documentos, sv.nombreXlsx(o)), filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, sv.exportarXlsx(id)); return r.filePath;
  });
  h('elegirDocumento', async () => {
    const r = await d.dialog.showOpenDialog(d.ventana(), { title: 'Importar archivo', properties: ['openFile'], filters: filtrosDoc });
    if (r.canceled || !r.filePaths.length) return null;
    const f = r.filePaths[0]; const nombre = path.basename(f); const ext = path.extname(f).toLowerCase();
    if (['.xlsx', '.docx', '.xls', '.doc'].includes(ext)) return { tipo: 'orden', orden: sv.leerDocumento(nombre, fs.readFileSync(f)) };
    if (ext === '.pdf') return { tipo: 'pdf', nombre, datos: new Uint8Array(fs.readFileSync(f)) };
    if (['.jpg', '.jpeg', '.png', '.bmp', '.webp'].includes(ext)) return { tipo: 'imagen', nombre, datos: new Uint8Array(fs.readFileSync(f)) };
    throw new Error('Tipo de archivo no compatible. Usa Excel (.xlsx), Word (.docx), PDF o una imagen.');
  });
  h('elegirImagen', async () => {
    const r = await d.dialog.showOpenDialog(d.ventana(), { title: 'Elegir foto', properties: ['openFile'], filters: [{ name: 'Imágenes', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'webp'] }] });
    if (r.canceled || !r.filePaths.length) return null;
    return { nombre: path.basename(r.filePaths[0]), datos: new Uint8Array(fs.readFileSync(r.filePaths[0])) };
  });

  h('respaldoToca', () => sv.respaldoToca());
  h('respaldar', () => sv.respaldar());
  h('carpetaRespaldos', () => { fs.mkdirSync(sv.descargas, { recursive: true }); d.shell.openPath(sv.descargas); return sv.descargas; });
  h('respaldoElegir', async () => {
    const r = await d.dialog.showOpenDialog(d.ventana(), { title: 'Cargar copia de seguridad', defaultPath: sv.descargas, properties: ['openFile'], filters: [{ name: 'Copia de seguridad', extensions: ['zip'] }] });
    if (r.canceled || !r.filePaths.length) return null;
    const buf = fs.readFileSync(r.filePaths[0]); const resumen = sv.respaldoInspeccionar(buf);
    sv._respaldoPend = buf; return resumen;
  });
  h('respaldoRestaurar', (subir) => {
    if (!sv._respaldoPend) throw new Error('Primero elige una copia de seguridad.');
    const r = sv.respaldoRestaurar(sv._respaldoPend, !!subir); sv._respaldoPend = null; return r;
  });

  h('ocr', (datos) => d.ocr.leer(datos));
  h('usuarios', () => sv.usuarios());
  h('cambiarRol', (e, r) => sv.cambiarRol(e, r));
  return m;
}

module.exports = { crearManejadores };
