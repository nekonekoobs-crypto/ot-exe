const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const { fakeTelegram, fakeSupabase } = require('./fakes'); const { Servicios } = require('../src/servicios'); const M = require('../src/lib/models');
(async () => {
  const tg = await fakeTelegram(); const sb = await fakeSupabase({ 'a@x.com': { rol: 'almacenista', clave: '1' }, 'l@x.com': { rol: 'lector', clave: '2' }, 'n@x.com': { rol: 'pendiente', clave: '3' } });
  const mk = (n) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-' + n)); return new Servicios(d, { supabase: { url: sb.url, key: 'k' }, telegram: { token: 'T', chat: '1', key: crypto.randomBytes(32).toString('base64'), base: tg.base } }, d + '/resp'); };
  const A = mk('a'); A.tg.base = tg.base; A.tg.k = Buffer.alloc(32, 7);
  assert.strictEqual(A.estado().sesion, null); await A.supa.entrarConClave('a@x.com', '1'); assert.ok(!A.soloLectura());
  const o = M.toJson(M.nuevaOrden({ id: 77, ot: '77', items: [M.nuevoItem({ id: 1, concepto: 'Faro', fotoBaja: '77_1_baja_1.jpg', baja: true })] }));
  A.guardarFoto('77_1_baja_1.jpg', Buffer.from('jpegfalso')); A.guardarOrden(o); assert.strictEqual(A.estado().pendientes, 1);
  let r = await A.sync.sincronizar(true); assert.ok(/Sincronizado/.test(r.mensaje), r.mensaje);
  assert.strictEqual(A.ordenes()[0]._editable, true); assert.ok(A.exportarXlsx(77).length > 500); assert.ok(/OT_77\.xlsx/.test(A.nombreXlsx(A.store.cargar(77))));
  // quitar la foto: se borra del disco y se marca para borrar
  const o2 = Object.assign({}, o, { items: [Object.assign({}, o.items[0], { fotoBaja: '' })] }); A.guardarOrden(o2); assert.ok(!A.store.existeFoto('77_1_baja_1.jpg'));
  await A.sync.sincronizar(false); assert.strictEqual(tg.borrados.length, 1);
  // respaldo + restaurar en otra instalación con subida
  const f = A.respaldar(); assert.ok(fs.existsSync(f)); assert.ok(!A.respaldoToca());
  const B = mk('b'); await B.supa.entrarConClave('a@x.com', '1'); const ins = B.respaldoInspeccionar(fs.readFileSync(f)); assert.strictEqual(ins.ordenes, 1);
  const rs = B.respaldoRestaurar(fs.readFileSync(f), true); assert.strictEqual(rs.ordenes, 1); assert.ok(B.store.cargar(77)); assert.strictEqual(B.estado().pendientes, 1);
  // lector: no edita
  const L = mk('l'); await L.supa.entrarConClave('l@x.com', '2'); await L.sync.sincronizar(true); assert.ok(L.soloLectura()); assert.throws(() => L.guardarOrden(M.toJson(L.store.cargar(77))), /permiso/);
  assert.throws(() => L.borrarOrden(77), /permiso/); assert.strictEqual(L.ordenes()[0]._editable, false);
  // usuarios
  assert.ok((await A.usuarios()).length >= 0);
  console.log('OK servicios'); tg.srv.close(); sb.srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
