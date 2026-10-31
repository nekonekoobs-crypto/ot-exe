// Conexión con Supabase (port de Supa.kt): inicio de sesión, rol, renovación de token. Solo Node.
const crypto = require('crypto');

class ErrorRed extends Error {}

class Supa {
  /** cfg: { url, key, prefs } */
  constructor(cfg) { this.url = cfg.url.replace(/\/$/, ''); this.key = cfg.key; this.prefs = cfg.prefs; this._renovando = null; }

  async peticion(metodo, ruta, cuerpo, token, cab) {
    const h = Object.assign({ apikey: this.key }, cab || {});
    if (token) h.Authorization = 'Bearer ' + token;
    let r;
    try { r = await fetch(this.url + ruta, { method: metodo, headers: h, body: cuerpo === undefined || cuerpo === null ? undefined : cuerpo }); }
    catch (e) { throw new ErrorRed('Sin conexión a internet.'); }
    const buf = Buffer.from(await r.arrayBuffer());
    return { codigo: r.status, cuerpo: buf, ok: r.status >= 200 && r.status <= 299, texto: buf.toString('utf8') };
  }
  json(metodo, ruta, obj, token, cab) {
    return this.peticion(metodo, ruta, JSON.stringify(obj === undefined ? {} : obj), token, Object.assign({ 'Content-Type': 'application/json' }, cab || {}));
  }

  errorDe(r) {
    try {
      const j = JSON.parse(r.texto);
      return j.error_description || j.msg || j.message || j.error || `Error ${r.codigo}`;
    } catch (e) { return `Error ${r.codigo}`; }
  }

  mensaje(e) { return e instanceof ErrorRed ? 'Sin conexión a internet.' : (e && e.message) || 'No se pudo completar la operación.'; }

  // ---------- Sesión guardada ----------
  sesion() { return this.prefs.get('sesion', null); }
  guardarSesion(s) { this.prefs.set('sesion', s); }
  cerrarSesion() { this.prefs.borrar('sesion'); }

  _leerSesion(j, rol) {
    return { access: j.access_token, refresh: j.refresh_token, expiraMs: Date.now() + (j.expires_in || 3600) * 1000, email: (j.user && j.user.email) || '', rol };
  }

  async entrarConClave(correo, clave) {
    const r = await this.json('POST', '/auth/v1/token?grant_type=password', { email: correo.trim(), password: clave });
    if (!r.ok) throw new Error('Correo o contraseña incorrectos.');
    return this._completarLogin(JSON.parse(r.texto));
  }

  /** Google por navegador (PKCE): ver google.js. Aquí solo se canjea el código. */
  async entrarConCodigo(code, verifier) {
    const r = await this.json('POST', '/auth/v1/token?grant_type=pkce', { auth_code: code, code_verifier: verifier });
    if (!r.ok) throw new Error('No se pudo entrar con Google: ' + this.errorDe(r));
    return this._completarLogin(JSON.parse(r.texto));
  }

  _nombreDe(j) {
    const m = (j.user && j.user.user_metadata) || {};
    return m.full_name || m.name || '';
  }

  async registrarAcceso(token, nombre) { await this.json('POST', '/rest/v1/rpc/registrar_acceso', { p_nombre: nombre }, token); }

  async registrarAccesoSiToca(token) {
    const ahora = Date.now();
    if (ahora - this.prefs.get('ult_acceso', 0) < 6 * 3600 * 1000) return;
    await this.registrarAcceso(token, '');
    this.prefs.set('ult_acceso', ahora);
  }

  async _completarLogin(j) {
    const base = this._leerSesion(j, '');
    await this.registrarAcceso(base.access, this._nombreDe(j));
    const rol = await this.consultarRol(base.access);
    if (rol === 'almacenista' || rol === 'lector') {
      const s = Object.assign({}, base, { rol });
      this.guardarSesion(s);
      this.prefs.set('ult_acceso', Date.now());
      return s;
    }
    if (rol === 'pendiente') throw new Error(`Tu solicitud con ${base.email} quedó registrada. Un almacenista debe aprobar tu acceso; vuelve a intentarlo después.`);
    if (rol === 'rechazado') throw new Error(`Tu acceso (${base.email}) no fue autorizado.`);
    throw new Error(`La cuenta ${base.email} no está autorizada.`);
  }

  async consultarRol(token) {
    const r = await this.json('POST', '/rest/v1/rpc/mi_rol', {}, token);
    if (!r.ok) throw new Error('No se pudo verificar la cuenta (' + this.errorDe(r) + ').');
    const t = r.texto.trim();
    if (!t || t === 'null') return null;
    try { const v = JSON.parse(t); return typeof v === 'string' && v.trim() ? v : null; } catch (e) { return null; }
  }

  /** true si el almacenista solo puede modificar las OT que él subió; null si no se pudo saber. */
  async consultarRestringido(token) {
    const r = await this.json('POST', '/rest/v1/rpc/mi_restringido', {}, token);
    if (!r.ok) return null;
    return r.texto.trim() === 'true';
  }

  /** Token vigente (lo renueva si está por vencer). null si no hay sesión o no se pudo renovar sin conexión. */
  async tokenVigente() {
    const s = this.sesion();
    if (!s) return null;
    if (Date.now() < s.expiraMs - 60000) return s.access;
    if (this._renovando) return this._renovando;
    this._renovando = (async () => {
      try {
        const r = await this.json('POST', '/auth/v1/token?grant_type=refresh_token', { refresh_token: s.refresh });
        if (r.ok) { const n = this._leerSesion(JSON.parse(r.texto), s.rol); this.guardarSesion(n); return n.access; }
        if (r.codigo >= 400 && r.codigo <= 403) this.cerrarSesion();
        return null;
      } catch (e) { return null; } finally { this._renovando = null; }
    })();
    return this._renovando;
  }
}

/** Genera el par PKCE para el inicio de sesión con Google. */
function nuevoPkce() {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

module.exports = { Supa, ErrorRed, nuevoPkce };
