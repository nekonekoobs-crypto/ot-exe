// Servidores falsos de Supabase y Telegram para probar sin internet.
const http = require('http');
function leer(q) { return new Promise((ok) => { const c = []; q.on('data', (d) => c.push(d)); q.on('end', () => ok(Buffer.concat(c))); }); }
const escuchar = (s) => new Promise((ok) => s.listen(0, '127.0.0.1', () => ok('http://127.0.0.1:' + s.address().port)));

async function fakeTelegram() {
  const guardados = {}; const borrados = []; let n = 100;
  const srv = http.createServer(async (q, s) => { const b = await leer(q);
    if (q.url.endsWith('/sendDocument')) { const ini = b.indexOf('octet-stream\r\n\r\n') + 16; const fin = b.lastIndexOf('\r\n--'); const id = 'F' + (++n); guardados[id] = b.subarray(ini, fin); s.end(JSON.stringify({ ok: true, result: { message_id: n, document: { file_id: id } } })); }
    else if (q.url.endsWith('/getFile')) { const id = JSON.parse(b).file_id; s.end(JSON.stringify(guardados[id] ? { ok: true, result: { file_path: 'docs/' + id } } : { ok: false })); }
    else if (q.url.includes('/file/bot')) s.end(guardados[q.url.split('/').pop()]);
    else if (q.url.endsWith('/deleteMessage')) { borrados.push(JSON.parse(b).message_id); s.end('{"ok":true}'); }
    else { s.statusCode = 404; s.end('{}'); } });
  return { srv, base: await escuchar(srv), guardados, borrados };
}

async function fakeSupabase(usuarios) {
  // usuarios: { email: { rol, restringido, clave } }
  const ordenes = {}; let reloj = 1; const accesos = [];
  const emailDe = (q) => { const a = q.headers.authorization || ''; return a.startsWith('Bearer tok:') ? a.slice(11) : null; };
  const srv = http.createServer(async (q, s) => {
    const b = await leer(q); const u = new URL(q.url, 'http://x'); const p = u.pathname; const em = emailDe(q);
    const sj = (c, o) => { s.statusCode = c; s.setHeader('Content-Type', 'application/json'); s.end(JSON.stringify(o)); };
    if (p === '/auth/v1/token') {
      const j = JSON.parse(b); const g = u.searchParams.get('grant_type');
      if (g === 'password') { const us = usuarios[j.email]; if (!us || us.clave !== j.password) return sj(400, { error_description: 'Invalid login credentials' });
        return sj(200, { access_token: 'tok:' + j.email, refresh_token: 'ref:' + j.email, expires_in: 3600, user: { email: j.email, user_metadata: { full_name: 'Nombre ' + j.email } } }); }
      if (g === 'refresh_token') { const e = j.refresh_token.slice(4); return sj(200, { access_token: 'tok:' + e, refresh_token: j.refresh_token, expires_in: 3600, user: { email: e } }); }
      if (g === 'pkce') { if (j.auth_code === 'codigo-bueno') return sj(200, { access_token: 'tok:google@x.com', refresh_token: 'ref:google@x.com', expires_in: 3600, user: { email: 'google@x.com', user_metadata: { name: 'Goo' } } }); return sj(400, { msg: 'bad code' }); }
    }
    if (!em) return sj(401, { message: 'JWT' });
    const us = usuarios[em] || {};
    if (p === '/rest/v1/rpc/registrar_acceso') { accesos.push(em); if (!usuarios[em]) usuarios[em] = { rol: 'pendiente' }; return sj(200, null); }
    if (p === '/rest/v1/rpc/mi_rol') return sj(200, (usuarios[em] || {}).rol || null);
    if (p === '/rest/v1/rpc/mi_restringido') return sj(200, !!us.restringido);
    if (p === '/rest/v1/usuarios') {
      const f = u.searchParams.get('rol'); const filas = Object.entries(usuarios).filter(([, v]) => !f || ('eq.' + v.rol) === f);
      return sj(200, filas.map(([e, v]) => ({ email: e, rol: v.rol, nombre: v.nombre || '', creado: '2026-10-01T10:00:00Z', ultimo_acceso: null })));
    }
    if (p === '/rest/v1/rpc/cambiar_rol') { const j = JSON.parse(b); if (us.rol !== 'almacenista') return sj(403, { message: 'no' }); if (usuarios[j.p_email]) usuarios[j.p_email].rol = j.p_rol; return sj(200, null); }
    if (p === '/rest/v1/ordenes') {
      if (q.method === 'GET') {
        const f = u.searchParams.get('id'); const ids = f && f.startsWith('in.(') ? f.slice(4, -1).split(',') : null;
        return sj(200, Object.values(ordenes).filter((o) => !ids || ids.includes(String(o.id))).sort((a, c) => c.id - a.id).map((o) => ({ id: o.id, datos: o.datos, actualizado: o.actualizado, creado_por: o.creado_por })));
      }
      if (q.method === 'POST') { const j = JSON.parse(b); const ex = ordenes[j.id];
        if (us.rol !== 'almacenista') return sj(403, { message: 'rls' });
        if (ex && us.restringido && ex.creado_por.toLowerCase() !== em.toLowerCase()) return sj(403, { message: 'rls' });
        const o = ex || { id: j.id, creado_por: em }; o.datos = j.datos; o.actualizado = 't' + (reloj++); ordenes[j.id] = o; return sj(201, [{ id: o.id, actualizado: o.actualizado, creado_por: o.creado_por }]); }
      if (q.method === 'DELETE') { const id = u.searchParams.get('id').slice(3); const ex = ordenes[id]; if (us.rol !== 'almacenista' || (ex && us.restringido && ex.creado_por !== em)) return sj(403, {}); delete ordenes[id]; return sj(204, {}); }
    }
    if (p.startsWith('/storage/v1/object/fotos/')) return sj(404, {});
    sj(404, { message: 'no' });
  });
  return { srv, url: await escuchar(srv), ordenes, usuarios, accesos };
}
module.exports = { fakeTelegram, fakeSupabase };
