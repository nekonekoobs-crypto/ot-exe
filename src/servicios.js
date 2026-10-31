// Todos los servicios de la app juntos (para el proceso principal y para las pruebas): sin Electron.
const path = require('path');
const fs = require('fs');
const M = require('./lib/models');
const { Store } = require('./lib/store');
const { Prefs } = require('./lib/prefs');
const { Supa } = require('./lib/supa');
const { Sync } = require('./lib/sync');
const { Telegram } = require('./lib/telegram');
const R = require('./lib/respaldo');
const D = require('./lib/documentos');
const { escribirXlsx } = require('./lib/xlsx');

class Servicios {
  /** datos: carpeta de datos del usuario; cfg: { supabase, telegram }; descargas: carpeta para las copias de seguridad */
  constructor(datos, cfg, descargas) {
    this.datos = datos; this.descargas = descargas;
    this.prefs = new Prefs(path.join(datos, 'ajustes.json'));
    this.store = new Store(path.join(datos, 'datos'));
    this.supa = new Supa({ url: cfg.supabase.url, key: cfg.supabase.key, prefs: this.prefs });
    this.tg = new Telegram(cfg.telegram);
    this.sync = new Sync(this.store, this.supa, this.tg, this.prefs);
    this.alSync = null; // callback (resultado) para avisar a la ventana
  }

  sesion() { return this.supa.sesion(); }
  soloLectura() { const s = this.sesion(); return !s || s.rol !== 'almacenista'; }

  estado() {
    const s = this.sesion();
    return { sesion: s ? { email: s.email, rol: s.rol } : null, soloLectura: this.soloLectura(), restringido: this.sync.restringido(),
      telegram: this.tg.configurado(), pendientes: this.sync.pendientes(), ultimoRespaldo: this.prefs.get('ultimoRespaldo', 0) };
  }

  /** Lista las OT con el permiso de edición de cada una. */
  ordenes() {
    return this.store.todas().map((o) => Object.assign(M.toJson(o), { _editable: this.puedeEditar(o.id), _dueno: this.sync.dueno(o.id) }));
  }
  puedeEditar(id) { return !this.soloLectura() && this.sync.puedeEditar(id); }

  /** Fotos que tenía la OT anterior y ya no tiene la nueva: se borran del disco y se marcan para borrar de la nube. */
  _limpiarFotos(viejo, nuevo) {
    const quedan = new Set(nuevo ? nuevo.items.flatMap(M.fotos) : []);
    const quitadas = [];
    for (const p of viejo.items) for (const f of M.fotos(p)) if (!quedan.has(f)) { this.store.borrarFoto(f); quitadas.push(f); }
    return quitadas;
  }

  guardarOrden(json) {
    const o = M.fromJson(json);
    if (!this.puedeEditar(o.id) && this.store.cargar(o.id)) throw new Error('No tienes permiso para modificar esta OT.');
    const ant = this.store.cargar(o.id);
    this.store.guardar(o);
    if (!this.soloLectura()) {
      if (ant) this.sync.marcarFotosPorBorrar(o.id, this._limpiarFotos(ant, o));
      this.sync.marcarPendiente(o.id);
      this.sync.programarEnvio((r) => this.alSync && this.alSync(r));
    }
    return M.toJson(o);
  }

  borrarOrden(id) {
    const o = this.store.cargar(id); if (!o) return;
    if (!this.puedeEditar(o.id)) throw new Error('No tienes permiso para borrar esta OT.');
    this._limpiarFotos(o, null);
    this.store.borrar(o.id);
    this.sync.marcarBorrada(o);
    this.sync.programarEnvio((r) => this.alSync && this.alSync(r));
  }

  guardarFoto(nombre, datos) { this.store.guardarFoto(nombre, Buffer.from(datos)); return nombre; }
  leerFoto(nombre) { return this.store.leerFoto(nombre); }

  exportarXlsx(id) { const o = this.store.cargar(id); if (!o) throw new Error('OT no encontrada'); return escribirXlsx(o); }
  nombreXlsx(o) { return `OT_${String(o.ot || o.id).replace(/[^\w.\-]+/g, '_')}.xlsx`; }

  leerDocumento(nombre, buf) { return M.toJson(D.leerArchivo(nombre, buf)); }

  // ----- respaldos -----
  respaldoToca() { return R.toca(this.store, this.prefs.get('ultimoRespaldo', 0)); }
  respaldar() { const f = R.crear(this.store, this.descargas); this.prefs.set('ultimoRespaldo', Date.now()); return f; }
  respaldoInspeccionar(buf) { return R.inspeccionar(buf); }
  respaldoRestaurar(buf, subir) {
    const r = R.restaurar(this.store, buf);
    if (subir && !this.soloLectura()) for (const o of r.ordenes) this.sync.alRestaurar(o);
    if (subir && !this.soloLectura()) this.sync.programarEnvio((x) => this.alSync && this.alSync(x));
    return { ordenes: r.ordenes.length, fotos: r.fotos };
  }

  // ----- usuarios -----
  async usuarios() {
    const t = await this.supa.tokenVigente(); if (!t) throw new Error('Sin sesión');
    const r = await this.supa.peticion('GET', '/rest/v1/usuarios?select=email,rol,nombre,creado,ultimo_acceso&order=creado.desc', null, t);
    if (!r.ok) throw new Error(this.supa.errorDe(r));
    return JSON.parse(r.texto).map((x) => ({ email: x.email || '', rol: x.rol || '', nombre: x.nombre || '', creado: x.creado || '', ultimo: x.ultimo_acceso || '' }));
  }
  async cambiarRol(email, rol) {
    const t = await this.supa.tokenVigente(); if (!t) throw new Error('Sin sesión');
    const r = await this.supa.json('POST', '/rest/v1/rpc/cambiar_rol', { p_email: email, p_rol: rol }, t);
    if (!r.ok) throw new Error(this.supa.errorDe(r));
  }

  cerrarSesion() { this.supa.cerrarSesion(); }
}

module.exports = { Servicios };
