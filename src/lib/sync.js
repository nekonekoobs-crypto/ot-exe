// Sincronización con Supabase (port de Sync.kt). La app guarda todo en la PC (funciona sin internet);
// el almacenista sube sus cambios y todos bajan lo que hay en la nube. Fotos: cifradas en Telegram.
const fs = require('fs');
const M = require('./models');
const { ErrorRed } = require('./supa');

const igual = (a, b) => JSON.stringify(M.toJson(a)) === JSON.stringify(M.toJson(b));
const hhmm = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

class Sync {
  /** store: Store, supa: Supa, tg: Telegram, prefs: Prefs */
  constructor(store, supa, tg, prefs) {
    this.store = store; this.supa = supa; this.tg = tg; this.prefs = prefs;
    this.ocupado = false; this._timer = null;
    this.fotosFaltan = 0; this.fotosError = ''; this.subirFaltan = 0; this.subirError = '';
  }

  // ----- estado guardado -----
  _set(k) { return new Set(this.prefs.get(k, [])); }
  _guardarSet(k, s) { this.prefs.set(k, Array.from(s)); }
  _obj(k) { return Object.assign({}, this.prefs.get(k, {})); }
  restringido() { return !!this.prefs.get('restringido', false); }
  dueno(id) { const d = this._obj('duenos'); return Object.prototype.hasOwnProperty.call(d, String(id)) ? d[String(id)] : null; }

  puedeEditar(id) {
    const s = this.supa.sesion();
    if (!s || s.rol !== 'almacenista') return false;
    if (!this.restringido()) return true;
    const d = this.dueno(id);
    if (d === null) return true;
    return d.toLowerCase() === String(s.email).toLowerCase();
  }

  // ----- cambios locales pendientes -----
  marcarPendiente(id) {
    const p = this._set('pendientes'); p.add(String(id)); this._guardarSet('pendientes', p);
    const b = this._set('borradas'); if (b.delete(String(id))) this._guardarSet('borradas', b);
  }
  marcarBorrada(o) {
    const p = this._set('pendientes'); if (p.delete(String(o.id))) this._guardarSet('pendientes', p);
    const b = this._set('borradas'); b.add(String(o.id)); this._guardarSet('borradas', b);
    const f = this._set('fotosPorBorrar');
    for (const x of o.items) for (const n of M.fotos(x)) f.add(`${o.id}/${n}`);
    this._guardarSet('fotosPorBorrar', f);
  }
  marcarFotosPorBorrar(ordenId, nombres) {
    if (!nombres.length) return;
    const f = this._set('fotosPorBorrar'); for (const n of nombres) f.add(`${ordenId}/${n}`); this._guardarSet('fotosPorBorrar', f);
  }
  alRestaurar(o) {
    const pb = this._set('fotosPorBorrar'); let c = false;
    for (const x of o.items) for (const n of M.fotos(x)) if (pb.delete(`${o.id}/${n}`)) c = true;
    if (c) this._guardarSet('fotosPorBorrar', pb);
    this.marcarPendiente(o.id);
  }
  pendientes() { return this._set('pendientes').size + this._set('borradas').size; }
  _quitar(k, v) { const s = this._set(k); if (s.delete(String(v))) this._guardarSet(k, s); }

  _tgMapa() { return this._obj('tgMapa'); }
  _absorberFotosTg(idOrden, tg) {
    if (!tg) return;
    const m = this._tgMapa(); let c = false;
    for (const n of Object.keys(tg)) { const k = `${idOrden}/${n}`; if (!m[k] && tg[n]) { m[k] = tg[n]; c = true; } }
    if (c) this.prefs.set('tgMapa', m);
  }

  // ----- disparadores -----
  /** Sube los cambios 3 segundos después del último. */
  programarEnvio(listo) {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => { this.sincronizar(false).then(listo); }, 3000);
  }

  async sincronizar(bajar) {
    if (this.ocupado) { await new Promise((ok) => setTimeout(ok, 3000)); return this.sincronizar(bajar); }
    this.ocupado = true;
    try { return await this._ejecutar(bajar); }
    catch (e) { return this._resultadoDeError(e); }
    finally { this.ocupado = false; }
  }

  async _tk() { const t = await this.supa.tokenVigente(); if (!t) throw new ErrorRed('Sin sesión'); return t; }

  async _ejecutar(bajar) {
    const s = this.supa.sesion();
    if (!s) return { mensaje: '', sinSesion: true };
    const token = await this.supa.tokenVigente();
    if (!token) return this.supa.sesion() ? { mensaje: `Sin conexión. Pendientes por subir: ${this.pendientes()}` } : { mensaje: '', sinSesion: true };
    let rol = s.rol;
    if (bajar) {
      const actual = await this.supa.consultarRol(token);
      if (actual !== 'almacenista' && actual !== 'lector') { this.supa.cerrarSesion(); return { mensaje: '', sinSesion: true }; }
      if (actual !== rol) { rol = actual; this.supa.guardarSesion(Object.assign({}, s, { rol: actual })); }
    }
    const editor = rol === 'almacenista';
    if (bajar && editor) { const r = await this.supa.consultarRestringido(token); if (r !== null) this.prefs.set('restringido', r); }
    if (bajar) { await this.supa.registrarAccesoSiToca(token); this.fotosFaltan = 0; this.fotosError = ''; await this._bajarTodo(editor); }
    if (editor) {
      const descartadas = await this._empujar();
      // Si se descartó un cambio sin permiso, se baja de inmediato la versión de la nube
      if (descartadas > 0 && bajar) await this._bajarTodo(editor);
    }
    let usuariosPendientes = -1;
    if (editor && bajar) { try { usuariosPendientes = await this._contarUsuariosPendientes(); } catch (e) { usuariosPendientes = -1; } }
    const pend = this.pendientes();
    let mensaje = pend > 0 ? `Pendientes por subir: ${pend}` : `Sincronizado a las ${hhmm()}`;
    if (this.subirFaltan > 0) mensaje += ` · ${this.subirFaltan} fotos sin subir: ${this.subirError}`;
    if (bajar && this.fotosFaltan > 0) mensaje += ` · ${this.fotosFaltan} fotos sin descargar: ${this.fotosError}`;
    return { mensaje, sinSesion: false, usuariosPendientes, fotosFaltan: this.fotosFaltan };
  }

  async _contarUsuariosPendientes() {
    const r = await this.supa.peticion('GET', '/rest/v1/usuarios?select=email&rol=eq.pendiente', null, await this._tk());
    if (!r.ok) return -1;
    return JSON.parse(r.texto).length;
  }

  _resultadoDeError(e) {
    if (!this.supa.sesion() && e instanceof ErrorRed && e.message === 'Sin sesión') return { mensaje: '', sinSesion: true };
    const pend = this.pendientes();
    if (e instanceof ErrorRed) return { mensaje: 'Sin conexión.' + (pend > 0 ? ` Pendientes por subir: ${pend}` : '') };
    return { mensaje: 'Error al sincronizar: ' + (e && e.message ? e.message : String(e)) };
  }

  // ----- subir -----
  async _empujar() {
    let descartadas = 0; this.subirFaltan = 0; this.subirError = '';
    for (const idS of this._set('borradas')) {
      const r = await this.supa.peticion('DELETE', `/rest/v1/ordenes?id=eq.${idS}`, null, await this._tk(), { Prefer: 'return=minimal' });
      if (!r.ok) throw new Error(this.supa.errorDe(r));
      this._quitar('borradas', idS); this._quitar('sincronizadas', idS);
      const sl = this._obj('sellos'); delete sl[idS]; this.prefs.set('sellos', sl);
    }
    for (const clave of this._set('fotosPorBorrar')) {
      const m = this._tgMapa(); const dato = m[clave];
      if (dato) {
        try { await this.tg.borrar(parseInt(String(dato).split('|')[1], 10) || 0); } catch (e) { /* no pasa nada */ }
        delete m[clave]; this.prefs.set('tgMapa', m);
      }
      const ruta = clave.split('/').map(encodeURIComponent).join('/');
      const rs = await this.supa.peticion('DELETE', `/storage/v1/object/fotos/${ruta}`, null, await this._tk());
      if (rs.ok || rs.codigo === 404 || rs.codigo === 400) this._quitar('fotosPorBorrar', clave);
    }
    for (const idS of this._set('pendientes')) {
      const o = this.store.cargar(idS);
      if (!o) { this._quitar('pendientes', idS); continue; }
      if (!this.puedeEditar(o.id)) {
        this._quitar('pendientes', idS); const sl0 = this._obj('sellos'); delete sl0[idS]; this.prefs.set('sellos', sl0); descartadas++; continue;
      }
      const fotosOk = await this._subirFotos(o);
      const datos = M.toJson(o);
      const mt = this._tgMapa(); const tgm = {};
      for (const x of o.items) for (const n of M.fotos(x)) { const v = mt[`${o.id}/${n}`]; if (v) tgm[n] = v; }
      datos.fotosTg = tgm;
      const r = await this.supa.json('POST', '/rest/v1/ordenes?select=id,actualizado,creado_por', { id: o.id, datos }, await this._tk(),
        { Prefer: 'resolution=merge-duplicates,return=representation' });
      if (r.codigo === 403) {
        this._quitar('pendientes', idS); const sl1 = this._obj('sellos'); delete sl1[idS]; this.prefs.set('sellos', sl1); descartadas++; continue;
      }
      if (!r.ok) throw new Error(this.supa.errorDe(r));
      let sello = '';
      try {
        const f0 = JSON.parse(r.texto)[0]; sello = f0.actualizado || '';
        const du = this._obj('duenos'); du[idS] = f0.creado_por || ''; this.prefs.set('duenos', du);
      } catch (e) { /* se conserva lo que ya había */ }
      const sl = this._obj('sellos'); sl[idS] = sello; this.prefs.set('sellos', sl);
      const sinc = this._set('sincronizadas'); sinc.add(idS); this._guardarSet('sincronizadas', sinc);
      const actual = this.store.cargar(o.id);
      if (fotosOk && actual && igual(actual, o)) this._quitar('pendientes', idS);
    }
    return descartadas;
  }

  static explicarTelegram(e) { return require('./telegram').Telegram.explicar(e); }

  async _subirFotos(o) {
    let todoBien = true;
    for (const x of o.items) for (const nombre of M.fotos(x)) {
      const clave = `${o.id}/${nombre}`;
      if (this._tgMapa()[clave]) continue;
      const datos = this.store.leerFoto(nombre);
      if (!datos) continue;
      try {
        const a = await this.tg.subir(clave, datos);
        const m = this._tgMapa(); m[clave] = `${a.fileId}|${a.mensajeId}`; this.prefs.set('tgMapa', m);
      } catch (e) {
        todoBien = false; this.subirFaltan++;
        if (!this.subirError) this.subirError = Sync.explicarTelegram(e);
      }
    }
    return todoBien;
  }

  // ----- bajar -----
  async _bajarTodo(editor) {
    const r = await this.supa.peticion('GET', '/rest/v1/ordenes?select=id,actualizado,creado_por&order=id.desc', null, await this._tk());
    if (!r.ok) throw new Error(this.supa.errorDe(r));
    const lista = JSON.parse(r.texto);
    const du = this._obj('duenos'); const sl = this._obj('sellos');
    const pend = this._set('pendientes'); const sinc = this._set('sincronizadas');
    const enNube = new Set(); const aBajar = [];
    for (const f of lista) {
      const id = String(f.id); enNube.add(id);
      du[id] = f.creado_por || '';
      if (pend.has(id)) continue;
      if ((sl[id] || '') !== (f.actualizado || '') || !this.store.cargar(id)) aBajar.push(id);
    }
    for (let i = 0; i < aBajar.length; i += 20) {
      const lote = aBajar.slice(i, i + 20);
      const rr = await this.supa.peticion('GET', `/rest/v1/ordenes?select=id,datos,actualizado&id=in.(${lote.join(',')})`, null, await this._tk());
      if (!rr.ok) throw new Error(this.supa.errorDe(rr));
      for (const f of JSON.parse(rr.texto)) {
        const o = M.fromJson(f.datos); this.store.guardar(o);
        const id = String(f.id); this._absorberFotosTg(id, f.datos.fotosTg);
        sl[id] = f.actualizado || ''; sinc.add(id);
      }
    }
    const nuevas = [];
    for (const loc of this.store.todas()) {
      const id = String(loc.id);
      if (enNube.has(id)) continue;
      if (!editor) { this.store.borrar(loc.id); sinc.delete(id); delete sl[id]; }
      else if (sinc.has(id) && !pend.has(id)) { this.store.borrar(loc.id); sinc.delete(id); delete sl[id]; }
      else if (!pend.has(id)) nuevas.push(id);
    }
    this._guardarSet('sincronizadas', sinc); this.prefs.set('sellos', sl); this.prefs.set('duenos', du);
    if (nuevas.length) { const p = this._set('pendientes'); nuevas.forEach((n) => p.add(n)); this._guardarSet('pendientes', p); }
    for (const o of this.store.todas()) await this._bajarFotos(o);
  }

  _fotoFallo(motivo) { this.fotosFaltan++; if (!this.fotosError) this.fotosError = motivo; }

  async _bajarFotos(o) {
    for (const x of o.items) for (const nombre of M.fotos(x)) {
      if (this.store.existeFoto(nombre)) continue;
      try {
        const dato = this._tgMapa()[`${o.id}/${nombre}`];
        if (dato) {
          const b = await this.tg.bajar(String(dato).split('|')[0], `${o.id}/${nombre}`);
          if (b.length) this.store.guardarFoto(nombre, b); else this._fotoFallo('Telegram devolvió un archivo vacío');
        } else {
          const r = await this.supa.peticion('GET', `/storage/v1/object/authenticated/fotos/${o.id}/${encodeURIComponent(nombre)}`, null, await this._tk());
          if (r.ok && r.cuerpo.length) this.store.guardarFoto(nombre, r.cuerpo);
          else this._fotoFallo('la foto no está en la nube todavía (el teléfono que la tomó debe sincronizar)');
        }
      } catch (e) {
        let m = e && e.message ? e.message : String(e);
        if (/Unsupported state|auth/i.test(m)) m = 'la llave de cifrado (TG_FOTOS_KEY) no es la misma que usa Android';
        this._fotoFallo(m);
      }
    }
  }
}

module.exports = { Sync };
