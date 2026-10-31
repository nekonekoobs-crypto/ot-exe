// Modelos y reglas de las OT. Port de Models.kt (mismo formato JSON que la app de Android).
// Funciona en Node y en el navegador.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Models = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const ESTADOS = ['alta', 'baja', 'prestamo', 'devolucion', 'sobrante'];

  function nuevoItem(p) {
    return Object.assign({
      id: 0, pz: '1', concepto: '', proveedor: '',
      alta: false, baja: false, fotoBaja: '',
      num: 0,
      prestamo: false, descPrestamo: '', fotoPrestamo: '',
      devolucion: false, descDevolucion: '',
      sobrante: false
    }, p || {});
  }

  function nuevaOrden(p) {
    return Object.assign({
      id: Date.now(), seguro: '', elaboracion: '', entrega: '', ot: '', unidad: '', vin: '',
      modelo: '', taller: '', jefeTaller: '', items: [], baja: false
    }, p || {});
  }

  /** Nombres de las fotos que tiene la pieza (salida y préstamo). */
  function fotos(item) {
    return [item.fotoBaja, item.fotoPrestamo].filter((x) => x && String(x).trim() !== '');
  }

  /** Solo un estado a la vez: alta, baja, préstamo, devolución o sobrante. Descripciones y fotos se conservan. */
  function conEstado(item, estado, activo) {
    const limpio = Object.assign({}, item, { alta: false, baja: false, prestamo: false, devolucion: false, sobrante: false });
    if (!activo) return limpio;
    if (ESTADOS.indexOf(estado) >= 0) limpio[estado] = true;
    return limpio;
  }

  /** Estado de la pieza como texto ('' si no tiene). */
  function estadoDe(item) {
    for (const e of ESTADOS) if (item[e]) return e;
    return '';
  }

  /** Totales de piezas por estado de una OT. */
  function cuenta(orden) {
    const c = { alta: 0, baja: 0, prestamo: 0, devolucion: 0, sobrante: 0 };
    for (const i of orden.items) for (const e of ESTADOS) if (i[e]) c[e]++;
    return c;
  }

  // ---------- JSON (igual que Store.toJson / fromJson de Android) ----------
  function itemToJson(i) {
    return {
      id: i.id, pz: i.pz, concepto: i.concepto, proveedor: i.proveedor,
      alta: !!i.alta, baja: !!i.baja, fotoBaja: i.fotoBaja || '', num: i.num || 0,
      prestamo: !!i.prestamo, descPrestamo: i.descPrestamo || '', fotoPrestamo: i.fotoPrestamo || '',
      devolucion: !!i.devolucion, descDevolucion: i.descDevolucion || '', sobrante: !!i.sobrante
    };
  }

  function toJson(o) {
    return {
      id: o.id, seguro: o.seguro, elaboracion: o.elaboracion, entrega: o.entrega, ot: o.ot,
      unidad: o.unidad, vin: o.vin, modelo: o.modelo, taller: o.taller, jefeTaller: o.jefeTaller,
      items: o.items.map(itemToJson), baja: !!o.baja
    };
  }

  const str = (v) => (v === null || v === undefined ? '' : String(v));

  function fromJson(j) {
    if (!j || j.id === undefined || j.id === null) throw new Error('OT sin id');
    const items = (Array.isArray(j.items) ? j.items : []).map((x, n) => nuevoItem({
      id: x.id !== undefined && x.id !== null ? Number(x.id) : n,
      pz: str(x.pz), concepto: str(x.concepto), proveedor: str(x.proveedor),
      alta: !!x.alta, baja: !!x.baja, fotoBaja: str(x.fotoBaja),
      num: parseInt(x.num, 10) || 0,
      prestamo: !!x.prestamo, descPrestamo: str(x.descPrestamo), fotoPrestamo: str(x.fotoPrestamo),
      devolucion: !!x.devolucion, descDevolucion: str(x.descDevolucion), sobrante: !!x.sobrante
    }));
    return nuevaOrden({
      id: Number(j.id), seguro: str(j.seguro), elaboracion: str(j.elaboracion), entrega: str(j.entrega),
      ot: str(j.ot), unidad: str(j.unidad), vin: str(j.vin), modelo: str(j.modelo), taller: str(j.taller),
      jefeTaller: str(j.jefeTaller), items, baja: !!j.baja
    });
  }

  /** Busca en todos los campos del encabezado; cada palabra escrita debe aparecer en alguno. */
  function coincide(o, q) {
    const texto = [o.ot, o.seguro, o.elaboracion, o.entrega, o.unidad, o.vin, o.modelo, o.taller, o.jefeTaller].join(' ').toLowerCase();
    return String(q).split(' ').filter((w) => w.trim() !== '').every((w) => texto.indexOf(w.toLowerCase()) >= 0);
  }

  // ---------- Validador de piezas repetidas ----------
  function normConcepto(s) {
    return String(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]/g, '');
  }

  function distancia(a, b) {
    let prev = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      const cur = new Array(b.length + 1);
      cur[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const costo = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + costo);
      }
      prev = cur;
    }
    return prev[b.length];
  }

  /** Qué tan parecidos son dos conceptos (0 a 1); tolera errores típicos del OCR. */
  function parecido(a, b) {
    const x = normConcepto(a);
    const y = normConcepto(b);
    if (!x.length || !y.length) return 0;
    if (x === y) return 1;
    const corto = Math.min(x.length, y.length);
    if (corto >= 18 && (x.startsWith(y) || y.startsWith(x))) return 1;
    return 1 - distancia(x, y) / Math.max(x.length, y.length);
  }

  function mismaPieza(a, b) { return parecido(a, b) >= 0.85; }

  /**
   * Agrega a la OT solo las piezas que todavía no existen (mismo No. y concepto parecido, o concepto casi idéntico).
   * Las piezas ya guardadas nunca se tocan. Devuelve { items, agregadas, repetidas }.
   */
  function fusionarItems(actuales, nuevos) {
    const lista = actuales.slice();
    let agregadas = 0;
    let repetidas = 0;
    let siguienteId = (lista.length ? Math.max.apply(null, lista.map((x) => x.id)) : Date.now()) + 1;
    for (const n of nuevos) {
      if (!n.concepto || n.concepto.trim() === '') continue;
      const igualNumero = n.num > 0 && lista.some((x) => x.num === n.num && parecido(x.concepto, n.concepto) >= 0.5);
      const igualTexto = lista.some((x) => mismaPieza(x.concepto, n.concepto));
      if (igualNumero || igualTexto) {
        repetidas++;
      } else {
        const id = lista.some((x) => x.id === n.id) ? siguienteId++ : n.id;
        lista.push(Object.assign({}, n, { id }));
        agregadas++;
      }
    }
    return { items: lista, agregadas, repetidas };
  }

  // ---------- Límite de caracteres al capturar por foto ----------
  const MAX_CARACTERES_FOTO = 50;

  function limitarConcepto(texto) {
    const t = String(texto).trim();
    if (t.length <= MAX_CARACTERES_FOTO) return t;
    let fin;
    if (t[MAX_CARACTERES_FOTO - 1] === ' ' || t[MAX_CARACTERES_FOTO] === ' ') {
      fin = MAX_CARACTERES_FOTO;
    } else {
      const i = t.indexOf(' ', MAX_CARACTERES_FOTO);
      fin = i === -1 ? t.length : i;
    }
    return t.substring(0, fin).trim();
  }

  /** Parte un concepto largo en varios, cada uno dentro del límite, sin perder texto. */
  function partirConcepto(texto) {
    const partes = [];
    let resto = String(texto).trim();
    while (resto.length) {
      const parte = limitarConcepto(resto);
      partes.push(parte);
      resto = resto.substring(parte.length).trim();
    }
    return partes.length ? partes : [''];
  }

  /** Completa los datos del encabezado vacíos de a con los de n y fusiona las piezas (como fusionar de Android). */
  function fusionarOrden(a, n) {
    const t = (x, y) => (x && String(x).trim() !== '' ? x : y);
    return Object.assign({}, a, {
      seguro: t(a.seguro, n.seguro), elaboracion: t(a.elaboracion, n.elaboracion), entrega: t(a.entrega, n.entrega),
      ot: t(a.ot, n.ot), unidad: t(a.unidad, n.unidad), vin: t(a.vin, n.vin), modelo: t(a.modelo, n.modelo),
      taller: t(a.taller, n.taller), jefeTaller: t(a.jefeTaller, n.jefeTaller),
      items: fusionarItems(a.items, n.items).items
    });
  }

  return {
    ESTADOS, nuevoItem, nuevaOrden, fotos, conEstado, estadoDe, cuenta, toJson, fromJson, coincide,
    normConcepto, parecido, mismaPieza, fusionarItems, fusionarOrden, MAX_CARACTERES_FOTO, limitarConcepto, partirConcepto
  };
});
