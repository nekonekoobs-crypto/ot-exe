// Prueba de la interfaz real (Chromium) contra los servicios reales y servidores falsos de Supabase/Telegram.
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const { chromium } = require('playwright'); const http = require('http');
const { fakeTelegram, fakeSupabase } = require('./fakes'); const { Servicios } = require('../src/servicios'); const { crearManejadores } = require('../src/ipc');
const M = require('../src/lib/models'); const { escribirXlsx } = require('../src/lib/xlsx');
const SHOTS = path.join(__dirname, '..', '..', 'shots');

(async () => {
  const tg = await fakeTelegram();
  const sb = await fakeSupabase({ 'a@x.com': { rol: 'almacenista', clave: '1' }, 'l@x.com': { rol: 'lector', clave: '2' }, 'n@x.com': { rol: 'pendiente', clave: '3' } });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-'));
  const sv = new Servicios(dir, { supabase: { url: sb.url, key: 'k' }, telegram: { token: 'T', chat: '1', key: crypto.randomBytes(32).toString('base64'), base: tg.base } }, path.join(dir, 'copias'));
  // Excel para importar
  const orden = M.nuevaOrden({ id: 1, seguro: 'MAPFRE', elaboracion: '20/10/2026', entrega: '13/01/2027', ot: '4521', unidad: 'KENWORTH T880', vin: '3WKDD40X5LF123456', modelo: '2020', taller: 'JIMENEZ',
    items: ['Faro izquierdo LED', 'Cofre completo', 'Tornillo de sujeción', 'Espejo retrovisor', 'Rejilla frontal'].map((c, i) => M.nuevoItem({ id: i + 1, num: i + 1, pz: String(i + 1), concepto: c })) });
  fs.writeFileSync(path.join(dir, 'importar.xlsx'), escribirXlsx(orden));
  let proximoArchivo = null; let proximoGuardar = null; const abiertos = [];
  const dialog = { showOpenDialog: async () => (proximoArchivo ? { canceled: false, filePaths: [proximoArchivo] } : { canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: false, filePath: proximoGuardar }) };
  const lineasOcr = [];
  const W = (t, x, yy, w, h = 24) => { const words = t.split(' ').map((s, i) => ({ text: s, x0: x + i * 60, x1: x + i * 60 + 50, y0: yy, y1: yy + h })); lineasOcr.push({ text: t, x0: x, y0: yy, x1: x + Math.max(w, 60 * words.length), y1: yy + h, slope: 0, words }); };
  W('SEGURO: AXA', 40, 40, 300); W('OT 9001', 40, 120, 120); W('KENWORTH T880', 40, 160, 300); W('MODELO', 40, 200, 100); W('2022', 160, 200, 60); W('PZ', 120, 260, 40); W('CONCEPTO', 200, 260, 200);
  [['1', '2', 'FARO DERECHO'], ['2', '1', 'DEFENSA'], ['3', '3', 'TORNILLO']].forEach(([n, pz, c], i) => { W(n, 20, 320 + i * 50, 30); W(pz + ' ' + c, 120, 320 + i * 50, 400); });
  const man = crearManejadores(sv, { dialog, shell: { openExternal: async (u) => abiertos.push(u), openPath: async (p) => abiertos.push(p) }, ventana: () => null, documentos: dir, google: { iniciar: async () => { throw new Error('Google no disponible en la prueba'); } }, ocr: { leer: async () => lineasOcr } });

  const nav = await chromium.launch(); const ctx = await nav.newContext({ viewport: { width: 1360, height: 860 }, acceptDownloads: true }); const page = await ctx.newPage();
  const errores = []; page.on('pageerror', (e) => errores.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errores.push('console: ' + m.text()); });
  await page.exposeFunction('__llamar', async (c, a) => { const r = await man[c](...(a || []).map((x) => (x && x.__ta ? Uint8Array.from(Buffer.from(x.b64, 'base64')) : x))); return JSON.parse(JSON.stringify(r, (k, v) => (v instanceof Uint8Array ? { __ta: 1, b64: Buffer.from(v).toString('base64') } : v))); });
  await page.addInitScript(() => {
    const ev = {}; const aTA = (x) => (x instanceof Uint8Array ? { __ta: 1, b64: btoa(String.fromCharCode(...x)) } : x);
    const deTA = (v) => { if (v && v.__ta) return Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0)); if (Array.isArray(v)) return v.map(deTA); if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = deTA(v[k]); } return v; };
    window.api = { llamar: async (c, ...a) => deTA(await window.__llamar(c, a.map(aTA))), alEvento: (c, f) => { ev[c] = f; return () => {}; } };
  });
  const foto = async (n) => page.screenshot({ path: path.join(SHOTS, n + '.png') });
  const esperarToast = async (txt) => page.waitForSelector(`.toast:has-text("${txt}")`, { timeout: 8000 });

  // La app se sirve por HTTP (en Electron va por app://): los módulos ES y los workers se comportan igual
  const RAIZ = path.resolve(path.join(__dirname, '..')); const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
  const web = http.createServer((q, s) => { const f = path.join(RAIZ, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(RAIZ) || !fs.existsSync(f)) { s.statusCode = 404; return s.end(); } s.setHeader('Content-Type', tipos[path.extname(f)] || 'application/octet-stream'); s.end(fs.readFileSync(f)); });
  await new Promise((ok) => web.listen(0, '127.0.0.1', ok));
  await page.goto('http://127.0.0.1:' + web.address().port + '/src/renderer/index.html');
  await page.waitForSelector('#pantalla-login:not([hidden])'); await foto('01_login');
  // clave mala
  await page.fill('#login-correo', 'a@x.com'); await page.fill('#login-clave', 'mala'); await page.click('#btn-entrar'); await page.waitForSelector('#login-error:not([hidden])'); assert.ok((await page.textContent('#login-error')).includes('incorrectos'));
  // pendiente
  await page.fill('#login-correo', 'n@x.com'); await page.fill('#login-clave', '3'); await page.click('#btn-entrar'); await page.waitForFunction(() => /solicitud/.test(document.querySelector('#login-error').textContent));
  // Google sin servicio
  await page.click('#btn-google'); await page.waitForFunction(() => /Google no disponible/.test(document.querySelector('#login-error').textContent));
  // entrar bien
  await page.fill('#login-correo', 'a@x.com'); await page.fill('#login-clave', '1'); await page.click('#btn-entrar'); await page.waitForSelector('#app:not([hidden])'); await page.waitForSelector('.vacio');
  assert.ok((await page.textContent('#usr-rol')).includes('Almacenista')); await foto('02_lista_vacia');

  // Importar Excel -> revisión -> guardar
  proximoArchivo = path.join(dir, 'importar.xlsx'); await page.click('[data-menu="importar"]'); await page.waitForSelector('[data-rev="guardar"]'); assert.strictEqual(await page.locator('.pieza').count(), 5); await foto('03_revision');
  await page.click('[data-rev="enumerar"]'); await page.locator('[data-rdiv]').first().click(); await page.waitForSelector('#div-a'); await page.click('.modal-footer .btn-primary'); assert.strictEqual(await page.locator('.pieza').count(), 6);
  await page.locator('[data-runir]').first().click(); assert.strictEqual(await page.locator('.pieza').count(), 5);
  await page.click('[data-rev="guardar"]'); await page.waitForSelector('#piezas .pieza'); assert.strictEqual(await page.inputValue('#c-ot'), '4521'); await foto('04_detalle');

  // Estados con colores
  const p0 = page.locator('.pieza').nth(0); await p0.locator('[data-estado="alta"]').check(); assert.ok(await page.locator('.pieza.e-alta').count() === 1);
  await page.locator('.pieza').nth(1).locator('[data-estado="baja"]').check(); await page.locator('.pieza').nth(2).locator('[data-estado="prestamo"]').check();
  await page.locator('.pieza').nth(2).locator('textarea').fill('Prestado a Juan'); await page.locator('.pieza').nth(3).locator('[data-estado="devolucion"]').check(); await page.locator('.pieza').nth(3).locator('textarea').fill('Devuelto ok'); await page.locator('.pieza').nth(4).locator('[data-estado="sobrante"]').check();
  // un solo estado a la vez
  await page.locator('.pieza').nth(0).locator('[data-estado="baja"]').check(); assert.strictEqual(await page.locator('.pieza').nth(0).locator('[data-estado="alta"]').isChecked(), false);
  await page.locator('.pieza').nth(0).locator('[data-estado="alta"]').check();
  // foto de salida desde equipo (galería)
  proximoArchivo = '/tmp/foto_prueba.jpg'; const pb = page.locator('.pieza').nth(1); await pb.locator('[data-foto="fotoBaja"]').click(); await page.click('.modal-footer >> text=Elegir del equipo'); await page.waitForSelector('.pieza.e-baja .mini-foto'); await page.waitForTimeout(400);
  const fotos = fs.readdirSync(sv.store.dirFotos); assert.strictEqual(fotos.length, 1); const peso = fs.statSync(path.join(sv.store.dirFotos, fotos[0])).size; console.log('foto comprimida:', peso, 'bytes'); assert.ok(peso <= 250000 && peso > 1000);
  await foto('05_estados');
  // ver y eliminar foto con confirmación
  await page.click('.pieza.e-baja .mini-foto'); await page.waitForSelector('.visor img'); await foto('06_visor'); await page.click('.modal-footer >> text=Eliminar foto'); await page.waitForSelector('.modal-body:has-text("eliminar esta foto")'); await page.click('.modal-footer >> text=Cancelar');
  assert.strictEqual(await page.locator('.pieza.e-baja .mini-foto').count(), 1);
  await page.click('.pieza.e-baja .mini-foto'); await page.click('.modal-footer >> text=Eliminar foto'); await page.click('.modal-footer .btn-peligro'); await page.waitForFunction(() => !document.querySelector('.pieza.e-baja .mini-foto')); await page.waitForTimeout(300); assert.strictEqual(fs.readdirSync(sv.store.dirFotos).length, 0);
  // encabezado plegable + búsqueda de piezas
  await page.click('[data-acc="enc"]'); assert.ok(await page.locator('#enc-cuerpo').isHidden()); assert.ok((await page.textContent('#enc-resumen')).includes('4521')); await foto('07_encabezado_plegado');
  await page.fill('#busqueda', 'espejo'); assert.strictEqual(await page.locator('.pieza').count(), 1); await page.fill('#busqueda', '');
  // agregar y borrar pieza
  await page.click('[data-acc="nueva-pieza"]'); assert.strictEqual(await page.locator('.pieza').count(), 6); await page.locator('.pieza').nth(5).locator('[data-acc="borrar-pieza"]').click(); await page.click('.modal-footer .btn-peligro'); assert.strictEqual(await page.locator('.pieza').count(), 5);
  // exportar
  proximoGuardar = path.join(dir, 'salida.xlsx'); await page.click('[data-acc="exportar"]'); await esperarToast('Excel guardado'); assert.ok(fs.statSync(proximoGuardar).size > 500);
  // anexar por foto (OCR simulado): piezas repetidas no se duplican
  await page.click('[data-acc="anexar-foto"]'); proximoArchivo = '/tmp/foto_prueba.jpg'; await page.click('.modal-footer >> text=Elegir del equipo'); await page.waitForSelector('[data-rev="guardar"]', { timeout: 15000 }); assert.ok((await page.locator('.pieza').count()) >= 3); await foto('08_revision_ocr');
  await page.click('[data-rev="guardar"]'); await esperarToast('Se agregaron'); const total = await page.locator('.pieza').count(); assert.ok(total >= 7, 'total ' + total);
  await page.waitForTimeout(700);
  // PDF de 3 páginas: se renderiza con pdf.js y se lee con el mismo OCR (simulado); las piezas repetidas no se duplican
  proximoArchivo = '/tmp/prueba2.pdf'; await page.click('[data-acc="anexar-archivo"]'); await page.waitForSelector('[data-rev="guardar"]', { timeout: 12000 }).catch(async (e) => { console.log('TOASTS:', await page.locator('.toast').allTextContents(), errores); throw e; }); await foto('08b_revision_pdf'); await page.click('[data-rev="cancelar"]'); await page.waitForSelector('#piezas');
  // volver a la lista: totales y baja de OT con confirmación
  await page.click('[data-acc="volver"]'); await page.waitForSelector('.tarjeta-ot'); const stats = await page.locator('.stat-color .n').allTextContents(); console.log('totales', stats); assert.deepStrictEqual(stats.slice(0, 5), ['1', '1', '1', '1', '1']); await foto('09_lista');
  await page.click('[data-baja]'); await page.waitForSelector('.modal-body:has-text("BAJA")'); await page.click('.modal-footer >> text=Cancelar'); assert.strictEqual(await page.locator('.tarjeta-ot.es-baja').count(), 0);
  await page.click('[data-baja]'); await page.click('.modal-footer .btn-peligro'); await page.waitForSelector('.tarjeta-ot.es-baja'); await foto('10_baja_ot');
  await page.click('[data-baja]'); await page.waitForSelector('.modal-body:has-text("quitar la baja")'); await page.click('.modal-footer .btn-primary'); await page.waitForFunction(() => !document.querySelector('.tarjeta-ot.es-baja'));
  // búsqueda en lista
  await page.fill('#busqueda', 'zzz'); await page.waitForSelector('.vacio:has-text("coincidan")'); await page.fill('#busqueda', 'kenworth'); await page.waitForSelector('.tarjeta-ot'); await page.fill('#busqueda', '');
  // sincronizar y comprobar la nube
  await page.click('#btn-sync'); await page.waitForFunction(() => /Sincronizado/.test(document.querySelector('#estado-sync').textContent), null, { timeout: 15000 }); assert.ok(Object.keys(sb.ordenes).length >= 1);
  // usuarios
  await page.click('[data-menu="usuarios"]'); await page.waitForSelector('.usuario'); await foto('11_usuarios'); await page.click('[data-rol="lector"]'); await page.waitForFunction(() => /No hay solicitudes pendientes/.test(document.querySelector('#usr-cuerpo').textContent)); assert.strictEqual(sb.usuarios['n@x.com'].rol, 'lector'); await foto('11b_usuario_aprobado');
  // copias de seguridad
  await page.click('[data-menu="respaldar"]'); await esperarToast('Copia de seguridad guardada'); const zips = fs.readdirSync(path.join(dir, 'copias')); assert.strictEqual(zips.length, 1);
  proximoArchivo = path.join(dir, 'copias', zips[0]); await page.click('[data-menu="cargar-respaldo"]'); await page.waitForSelector('.modal-body:has-text("tal cual estaban")'); await foto('12_cargar_copia'); await page.click('.modal-footer >> text=Restaurar solo aquí'); await esperarToast('Se restauraron');
  // tema claro y vuelta
  await page.click('#btn-tema'); assert.strictEqual(await page.getAttribute('html', 'data-theme'), 'light'); await foto('13_tema_claro'); await page.click('#btn-tema');
  // borrar OT
  await page.click('[data-borrar]'); await page.click('.modal-footer .btn-peligro'); await page.waitForSelector('.vacio');
  // cerrar sesión
  await page.click('#btn-salir'); await page.click('.modal-footer .btn-primary'); await page.waitForSelector('#pantalla-login:not([hidden])');
  // lector: sin acciones de edición
  await page.fill('#login-correo', 'l@x.com'); await page.fill('#login-clave', '2'); await page.click('#btn-entrar'); await page.waitForSelector('#app:not([hidden])'); await page.waitForFunction(() => { const t = document.querySelector('#estado-sync').textContent; return t && !/Sincronizando/.test(t); }, null, { timeout: 15000 });
  assert.strictEqual(await page.locator('[data-menu="nueva"], [data-menu="usuarios"], [data-menu="importar"]').count(), 0); assert.ok((await page.textContent('#usr-rol')).includes('Solo lectura'));
  assert.deepStrictEqual(errores, [], errores.join('\n'));
  console.log('OK interfaz'); await nav.close(); web.close(); tg.srv.close(); sb.srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
