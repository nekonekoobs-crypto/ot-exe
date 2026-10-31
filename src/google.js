// Inicio de sesión con Google por el navegador (PKCE con redirección a 127.0.0.1). Solo Node.
const http = require('http');
const { nuevoPkce } = require('./lib/supa');

/**
 * Abre el navegador con la pantalla de Google (vía Supabase) y espera el código de regreso.
 * abrir(url) abre el navegador del sistema. Devuelve { code, verifier }.
 */
function iniciar(supa, abrir, esperaMs) {
  const { verifier, challenge } = nuevoPkce();
  return new Promise((ok, mal) => {
    let terminado = false;
    const fin = (fn, v) => { if (terminado) return; terminado = true; clearTimeout(t); try { srv.close(); } catch (e) { /* ya cerrado */ } fn(v); };
    const srv = http.createServer((q, s) => {
      const u = new URL(q.url, 'http://127.0.0.1');
      if (u.pathname !== '/callback') { s.statusCode = 404; s.end(); return; }
      const code = u.searchParams.get('code'); const err = u.searchParams.get('error_description') || u.searchParams.get('error');
      s.setHeader('Content-Type', 'text/html; charset=utf-8');
      s.end(`<!doctype html><meta charset="utf-8"><title>OT TRACSA</title><body style="font-family:Segoe UI,Arial;background:#0f1623;color:#e6ebf2;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2>${code ? 'Listo, ya puedes volver a OT TRACSA' : 'No se pudo iniciar sesión'}</h2><p>Puedes cerrar esta pestaña.</p></div>`);
      if (code) fin(ok, { code, verifier }); else fin(mal, new Error(err || 'Google no devolvió el código'));
    });
    const t = setTimeout(() => fin(mal, new Error('Se agotó el tiempo esperando a Google. Inténtalo otra vez.')), esperaMs || 180000);
    srv.on('error', (e) => fin(mal, e));
    srv.listen(0, '127.0.0.1', () => {
      const redir = `http://127.0.0.1:${srv.address().port}/callback`;
      const url = `${supa.url}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redir)}&code_challenge=${challenge}&code_challenge_method=s256`;
      Promise.resolve(abrir(url)).catch((e) => fin(mal, e));
    });
  });
}
module.exports = { iniciar };
