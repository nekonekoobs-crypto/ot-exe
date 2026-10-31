const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const { fakeTelegram, fakeSupabase } = require('./fakes'); const { Supa } = require('../src/lib/supa'); const { Sync } = require('../src/lib/sync'); const { Telegram } = require('../src/lib/telegram');
const { Store } = require('../src/lib/store'); const { Prefs } = require('../src/lib/prefs'); const M = require('../src/lib/models');
(async () => {
  const tgF = await fakeTelegram();
  const sb = await fakeSupabase({ 'a@x.com': { rol: 'almacenista', clave: '1' }, 'b@x.com': { rol: 'almacenista', clave: '2' }, 'ixtac@x.com': { rol: 'almacenista', restringido: true, clave: '3' }, 'l@x.com': { rol: 'lector', clave: '4' }, 'p@x.com': { rol: 'pendiente', clave: '5' }, 'r@x.com': { rol: 'rechazado', clave: '6' } });
  const key = crypto.randomBytes(32).toString('base64');
  const nuevo = (n) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-' + n)); const prefs = new Prefs(dir + '/p.json'); const store = new Store(dir + '/d'); const supa = new Supa({ url: sb.url, key: 'k', prefs }); const tg = new Telegram({ token: 'T', chat: '1', key, base: tgF.base }); return { store, supa, prefs, tg, sync: new Sync(store, supa, tg, prefs) }; };
  const A = nuevo('a'), B = nuevo('b'), I = nuevo('i'), L = nuevo('l'), P = nuevo('p');

  await assert.rejects(A.supa.entrarConClave('a@x.com', 'mala'), /incorrectos/);
  await assert.rejects(P.supa.entrarConClave('p@x.com', '5'), /solicitud/); assert.ok(!P.supa.sesion());
  await assert.rejects(nuevo('r').supa.entrarConClave('r@x.com', '6'), /no fue autorizado/);
  assert.ok(sb.accesos.includes('p@x.com'));
  for (const [c, e, k] of [[A, 'a@x.com', '1'], [B, 'b@x.com', '2'], [I, 'ixtac@x.com', '3'], [L, 'l@x.com', '4']]) assert.strictEqual((await c.supa.entrarConClave(e, k)).rol, c === L ? 'lector' : 'almacenista');

  // A crea una OT con foto
  const foto = crypto.randomBytes(3000);
  const o1 = M.nuevaOrden({ id: 1001, ot: 'OT-1', items: [M.nuevoItem({ id: 1, concepto: 'Faro', baja: true, fotoBaja: '1001_1.jpg' })] });
  A.store.guardar(o1); A.store.guardarFoto('1001_1.jpg', foto); A.sync.marcarPendiente(1001);
  let r = await A.sync.sincronizar(true); assert.ok(/Sincronizado/.test(r.mensaje), r.mensaje); assert.strictEqual(A.sync.pendientes(), 0);
  assert.strictEqual(sb.ordenes[1001].creado_por, 'a@x.com'); assert.ok(sb.ordenes[1001].datos.fotosTg['1001_1.jpg']);
  // B y el lector bajan la OT y la foto descifrada de Telegram
  for (const c of [B, L]) { r = await c.sync.sincronizar(true); assert.ok(c.store.cargar(1001), r.mensaje); assert.ok(c.store.leerFoto('1001_1.jpg').equals(foto)); }
  // el lector no sube nada
  L.store.guardar(M.nuevaOrden({ id: 5, ot: 'x' })); L.sync.marcarPendiente(5); await L.sync.sincronizar(true); assert.ok(!sb.ordenes[5]);
  // restringido (Ixtac): bajó la OT de A pero no puede editarla; sí puede crear la suya
  await I.sync.sincronizar(true); assert.ok(I.sync.restringido()); assert.ok(!I.sync.puedeEditar(1001)); assert.ok(I.sync.puedeEditar(2002)); assert.ok(B.sync.puedeEditar(1001));
  const mala = M.fromJson(M.toJson(I.store.cargar(1001))); mala.ot = 'HACKEADA'; I.store.guardar(mala); I.sync.marcarPendiente(1001);
  await I.sync.sincronizar(true); assert.strictEqual(sb.ordenes[1001].datos.ot, 'OT-1'); assert.strictEqual(I.store.cargar(1001).ot, 'OT-1', 'se baja la versión de la nube');
  const oi = M.nuevaOrden({ id: 2002, ot: 'IXTAC' }); I.store.guardar(oi); I.sync.marcarPendiente(2002); await I.sync.sincronizar(true); assert.strictEqual(sb.ordenes[2002].creado_por, 'ixtac@x.com');
  // A (sin restricción) puede editar la de Ixtac; Ixtac ya no puede borrar la de A
  await A.sync.sincronizar(true); const e = A.store.cargar(2002); e.ot = 'EDITADA'; A.store.guardar(e); A.sync.marcarPendiente(2002); await A.sync.sincronizar(false); assert.strictEqual(sb.ordenes[2002].datos.ot, 'EDITADA');
  // A quita la foto y la OT 1001 se baja con cambios a B; luego se borra la OT
  const e1 = A.store.cargar(1001); A.sync.marcarFotosPorBorrar(1001, ['1001_1.jpg']); e1.items[0].fotoBaja = ''; A.store.guardar(e1); A.sync.marcarPendiente(1001); await A.sync.sincronizar(false);
  assert.strictEqual(tgF.borrados.length, 1); assert.ok(!A.sync._tgMapa()['1001/1001_1.jpg']);
  await B.sync.sincronizar(true); assert.strictEqual(B.store.cargar(1001).items[0].fotoBaja, '');
  const aBorrar = A.store.cargar(1001); A.store.borrar(1001); A.sync.marcarBorrada(aBorrar); await A.sync.sincronizar(true); assert.ok(!sb.ordenes[1001]);
  await B.sync.sincronizar(true); assert.ok(!B.store.cargar(1001)); await L.sync.sincronizar(true); assert.ok(!L.store.cargar(1001));
  // OT local previa a la nube se sube sola
  B.store.guardar(M.nuevaOrden({ id: 3003, ot: 'vieja' })); await B.sync.sincronizar(true); assert.ok(sb.ordenes[3003]);
  // le quitan el permiso -> sesión cerrada
  sb.usuarios['l@x.com'].rol = 'rechazado'; r = await L.sync.sincronizar(true); assert.ok(r.sinSesion); assert.ok(!L.supa.sesion());
  // sin conexión
  const off = nuevo('off'); await off.supa.entrarConClave('a@x.com', '1'); off.supa.url = 'http://127.0.0.1:9'; off.store.guardar(M.nuevaOrden({ id: 9, ot: 'z' })); off.sync.marcarPendiente(9);
  r = await off.sync.sincronizar(true); assert.ok(/Sin conexión/.test(r.mensaje), r.mensaje); assert.ok(off.sync.pendientes() >= 1);
  // Google (código PKCE)
  const G = nuevo('g'); sb.usuarios['google@x.com'] = { rol: 'almacenista' }; assert.strictEqual((await G.supa.entrarConCodigo('codigo-bueno', 'v')).email, 'google@x.com'); await assert.rejects(G.supa.entrarConCodigo('malo', 'v'), /Google/);
  // renovación de token
  const s = A.supa.sesion(); s.expiraMs = 0; A.supa.guardarSesion(s); assert.strictEqual(await A.supa.tokenVigente(), 'tok:a@x.com'); assert.ok(A.supa.sesion().expiraMs > Date.now());
  console.log('OK sync completo'); tgF.srv.close(); sb.srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
