const assert = require('assert'); const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const { Telegram } = require('../src/lib/telegram'); const { Store } = require('../src/lib/store'); const R = require('../src/lib/respaldo'); const M = require('../src/lib/models');
(async () => {
  // servidor falso de Telegram
  const guardados = {}; let borrado = null; let n = 100;
  const srv = http.createServer((q, s) => { const ch = []; q.on('data', (d) => ch.push(d)); q.on('end', () => { const b = Buffer.concat(ch);
    if (q.url.endsWith('/sendDocument')) { const ini = b.indexOf('octet-stream\r\n\r\n') + 16; const fin = b.lastIndexOf('\r\n--'); const id = 'F' + (++n); guardados[id] = b.subarray(ini, fin);
      s.end(JSON.stringify({ ok: true, result: { message_id: n, document: { file_id: id } } })); }
    else if (q.url.endsWith('/getFile')) { const id = JSON.parse(b).file_id; s.end(JSON.stringify(guardados[id] ? { ok: true, result: { file_path: 'docs/' + id } } : { ok: false, description: 'no existe' })); }
    else if (q.url.includes('/file/bot')) { s.end(guardados[q.url.split('/').pop()]); }
    else if (q.url.endsWith('/deleteMessage')) { borrado = JSON.parse(b); s.end('{"ok":true}'); } else { s.statusCode = 404; s.end('{}'); } }); });
  await new Promise((ok) => srv.listen(0, ok)); const base = 'http://127.0.0.1:' + srv.address().port;
  const key = crypto.randomBytes(32).toString('base64');
  const tg = new Telegram({ token: 'TOK', chat: '-1001', key, base }); assert.ok(tg.configurado()); assert.ok(!new Telegram({ token: 'a', chat: 'b', key: 'corta' }).configurado());
  const foto = crypto.randomBytes(5000); const a = await tg.subir('123/x.jpg', foto); assert.ok(a.fileId && a.mensajeId);
  assert.ok(!guardados[a.fileId].includes(foto.subarray(0, 32)), 'texto cifrado');
  assert.ok((await tg.bajar(a.fileId, '123/x.jpg')).equals(foto)); await assert.rejects(tg.bajar(a.fileId, '123/otra.jpg')); await assert.rejects(tg.bajar('nada', 'x'));
  await tg.borrar(a.mensajeId); assert.strictEqual(borrado.message_id, a.mensajeId);
  // compat con formato Android/WebCrypto/Java: IV(12)||ct+tag, AAD utf8 — verificado con openssl vía Python más abajo
  fs.writeFileSync(path.join(os.tmpdir(), 'tg_vec.json'), JSON.stringify({ key, ruta: '123/x.jpg', datos: foto.toString('base64'), cif: tg.cifrar(foto, '123/x.jpg').toString('base64') }));
  srv.close();
  // respaldo
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-')); const st = new Store(dir + '/a');
  assert.ok(!R.toca(st, 0));
  st.guardar(M.nuevaOrden({ id: 11, ot: 'A', items: [M.nuevoItem({ id: 1, concepto: 'Faro', fotoBaja: '11_1.jpg', baja: true })] })); st.guardar(M.nuevaOrden({ id: 12, ot: 'B' })); st.guardarFoto('11_1.jpg', foto);
  assert.ok(R.toca(st, 0)); assert.ok(!R.toca(st, Date.now() - 14 * 864e5)); assert.ok(R.toca(st, Date.now() - 15 * 864e5));
  for (let i = 0; i < 8; i++) R.crear(st, dir + '/resp', Date.UTC(2026, 0, 1 + i)); assert.strictEqual(fs.readdirSync(dir + '/resp').length, 6);
  const z = fs.readFileSync(path.join(dir, 'resp', fs.readdirSync(dir + '/resp').sort().pop())); assert.deepStrictEqual(R.inspeccionar(z), { ordenes: 2, fotos: 1 });
  const st2 = new Store(dir + '/b'); const r = R.restaurar(st2, z); assert.strictEqual(r.ordenes.length, 2); assert.ok(st2.leerFoto('11_1.jpg').equals(foto)); assert.strictEqual(st2.cargar(11).items[0].concepto, 'Faro');
  assert.throws(() => R.inspeccionar(require('../src/lib/zip').crearZip([{ name: 'x.txt', data: Buffer.from('x') }])));
  assert.throws(() => st2.rutaFoto('../x'));
  fs.writeFileSync(path.join(os.tmpdir(), 'resp_prueba.zip'), z); console.log('OK telegram + respaldo');
})().catch((e) => { console.error(e); process.exit(1); });
