// Interpreta el texto leído de la foto de una OT (port de OcrParser.kt).
// Entrada: líneas de OCR [{ text, x0, y0, x1, y1, slope?, words: [{ text, x0, y0, x1, y1 }] }]. Funciona en Node y en el navegador.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./models'), require('./fechas'));
  else root.OcrParser = factory(root.Models, root.Fechas);
})(typeof self !== 'undefined' ? self : this, function (M, F) {
  const ETIQUETAS = ['SEGURO', 'ELABORACI', 'ENTREGA', 'MODELO', 'VIN', 'TRAZO'];
  const MARCAS = ['KENWORTH', 'FREIGHTLINER', 'VOLVO', 'INTERNATIONAL', 'PETERBILT', 'MACK', 'SCANIA', 'MERCEDES', 'HINO', 'ISUZU', 'FORD',
    'CHEVROLET', 'DODGE', 'NISSAN', 'TOYOTA', 'FOTON', 'JAC', 'IVECO', 'DINA', 'MAN', 'KW'];
  const MARCA_RX = new RegExp('\\b(' + MARCAS.join('|') + ')\\b', 'u');
  const FECHA_SRC = '\\d{1,2}\\s*[/\\-.]\\s*(?:\\d{1,2}|[A-ZÁÉÍÓÚ]{3,10})\\s*[/\\-.]\\s*\\d{2,4}';
  const FECHA = new RegExp(FECHA_SRC, 'u');
  const completa = (src) => new RegExp('^(?:' + src + ')$', 'u');
  const esEtiqueta = (s) => { const u = s.toUpperCase(); return ETIQUETAS.some((e) => u.includes(e)); };
  const cuenta = (s, f) => { let n = 0; for (const c of s) if (f(c)) n++; return n; };
  const esDig = (c) => /\d/.test(c);
  const esLet = (c) => /\p{L}/u.test(c);
  const mediana = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

  /** Inclinación típica del texto (pendiente) para enderezar las alturas. */
  function pendiente(lineas) {
    const lista = [];
    for (const l of lineas) {
      if (l.slope === undefined || l.slope === null || l.text.length < 8) continue;
      if (l.x1 - l.x0 < 100) continue;
      lista.push(l.slope);
    }
    if (!lista.length) return 0;
    const m = mediana(lista);
    return m > 0.25 || m < -0.25 ? 0 : m;
  }

  function buscar(cab, etiqueta, valor, mismaFila) {
    const lab = cab.find((l) => etiqueta.test(l.text.toUpperCase()));
    if (!lab) return '';
    const mismo = new RegExp(etiqueta.source + '\\W{0,4}(' + valor.source + ')', 'u').exec(lab.text.toUpperCase());
    if (mismo) return mismo[1];
    const vcomp = completa(valor.source);
    let mejor = ''; let mejorD = Infinity;
    for (const l of cab) {
      if (l === lab) continue;
      if (esEtiqueta(l.text)) continue;
      const txt = l.text.toUpperCase().trim();
      if (!vcomp.test(txt)) continue;
      const dy = l.y - lab.y; const dx = l.cx - lab.cx;
      let d;
      if (Math.abs(dy) < lab.h * 0.7 && dx > 0) d = dx;
      else if (!mismaFila && dy > 0 && dy < lab.h * 4) d = dy * 1.5 + Math.abs(dx);
      else continue;
      if (d < mejorD) { mejorD = d; mejor = txt; }
    }
    return mejor;
  }

  /** Una línea del OCR puede traer varias filas de la tabla: se separa una fila por cada altura distinta. */
  function separarFilas(l, k) {
    const alto = Math.round(l.y1 - l.y0);
    const cx = Math.trunc((l.x0 + l.x1) / 2);
    const words = l.words || [];
    const els = words.map((w) => [w.text, w.x0]);
    const unica = [{ text: l.text.trim(), x: l.x0, cx, y: Math.trunc((l.y0 + l.y1) / 2 - k * cx), h: alto, els }];
    if (words.length < 2) return unica;
    const altoEl = mediana(words.map((w) => w.y1 - w.y0));
    if (!(altoEl > 0)) return unica;
    const yDe = (w) => (w.y0 + w.y1) / 2 - k * ((w.x0 + w.x1) / 2);
    const grupos = [];
    for (const w of words.slice().sort((a, b) => yDe(a) - yDe(b))) {
      const g = grupos[grupos.length - 1];
      if (g && Math.abs(yDe(w) - yDe(g[g.length - 1])) < altoEl * 0.8) g.push(w); else grupos.push([w]);
    }
    if (grupos.length < 2) return unica;
    return grupos.map((g) => {
      const ord = g.slice().sort((a, b) => a.x0 - b.x0);
      const izq = Math.min(...ord.map((w) => w.x0)); const der = Math.max(...ord.map((w) => w.x1));
      const yy = Math.trunc(ord.reduce((s, w) => s + yDe(w), 0) / ord.length);
      return { text: ord.map((w) => w.text).join(' '), x: izq, cx: Math.trunc((izq + der) / 2), y: yy, h: Math.round(altoEl), els: ord.map((w) => [w.text, w.x0]) };
    });
  }

  function parse(ocrLineas) {
    const k = pendiente(ocrLineas);
    const lines = [];
    for (const l of ocrLineas) for (const f of separarFilas(l, k)) lines.push(f);
    const base = Date.now();
    if (!lines.length) return M.nuevaOrden({ id: base });

    const titulos = /CONC|PROVEED|COSTO/u; const soloPz = /^PZS?\W*$/u;
    const minY = (a) => a.reduce((m, x) => (m === null || x.y < m.y ? x : m), null);
    const ancla = minY(lines.filter((l) => { const u = l.text.toUpperCase().trim(); return titulos.test(u) || soloPz.test(u); }));
    const primeraPieza = minY(lines.filter((l) => /^\d{1,2}(\s+\p{L}.*)?$/u.test(l.text.trim())));
    let headerY;
    if (ancla) headerY = ancla.y;
    else if (primeraPieza) headerY = primeraPieza.y - primeraPieza.h;
    else { const mn = Math.min(...lines.map((l) => l.y)); const mx = Math.max(...lines.map((l) => l.y)); headerY = mn + Math.trunc((mx - mn) * 0.10); }
    const cab = lines.filter((l) => l.y < headerY);

    let seguro = buscar(cab, /SEGURO/u, /\p{L}{3,}/u, true);
    if (esEtiqueta(seguro)) seguro = '';

    let elaboracion = buscar(cab, /ELABORACI.N/u, FECHA, false);
    let entrega = buscar(cab, /ENTREGA/u, FECHA, false);
    if (!elaboracion.trim() || !entrega.trim()) {
      const fechas = cab.slice().sort((a, b) => a.cx - b.cx).map((l) => { const m = FECHA.exec(l.text.toUpperCase()); return m ? m[0] : null; }).filter((x) => x);
      if (!elaboracion.trim() && fechas.length) elaboracion = fechas[0];
      if (!entrega.trim() && fechas.length > 1) entrega = fechas[1];
    }

    let ot = buscar(cab, /\b[O0][T7]\b/u, /\d{3,6}/u, true);
    if (!ot.trim()) {
      ot = '';
      for (const l of cab) { const m = /^[O0][T7]\W*(\d{3,6})$/u.exec(l.text.toUpperCase().trim()); if (m) { ot = m[1]; break; } }
    }

    let modelo = buscar(cab, /MODEL[O0]/u, /(?:19|20)\d{2}/u, true);
    if (!modelo.trim()) {
      modelo = '';
      for (const l of cab) { const m = /^((?:19|20)\d{2})$/u.exec(l.text.trim()); if (m) { modelo = m[1]; break; } }
    }

    let vin = '';
    for (const l of cab) {
      const s = l.text.toUpperCase().replace(/ /g, '');
      const m = /[A-Z0-9]{17}/u.exec(s); if (!m) continue;
      const v = m[0];
      if (cuenta(v, esDig) >= 3 && cuenta(v, esLet) >= 3) { vin = v; break; }
    }
    vin = vin.replace(/O/g, '0').replace(/I/g, '1').replace(/Q/g, '0');

    const candidata = (l) => {
      const u = l.text.toUpperCase().trim();
      if (u.length < 4) return false;
      if (esEtiqueta(u)) return false;
      if (FECHA.test(u)) return false;
      if (u.replace(/ /g, '').length >= 15) return false;
      if (MARCA_RX.test(u)) return true;
      return cuenta(u, esLet) >= 3 && cuenta(u, esDig) > 0;
    };
    const candidatas = cab.filter(candidata);
    let unidadL = candidatas.find((l) => MARCA_RX.test(l.text.toUpperCase()));
    if (!unidadL) unidadL = candidatas.slice().sort((a, b) => a.y - b.y || a.x - b.x)[0];
    const unidad = unidadL ? unidadL.text : '';

    const tallerC = cab.filter((l) => {
      const u = l.text.toUpperCase().trim();
      return u.length >= 4 && [...u].every(esLet) && !esEtiqueta(u) && u !== seguro.toUpperCase() && !MARCA_RX.test(u);
    });
    const taller = tallerC.length ? tallerC.reduce((m, x) => (x.cx > m.cx ? x : m)).text : '';

    // ---------- Piezas ----------
    const titProv = minY(lines.filter((l) => l.text.toUpperCase().includes('PROVEED')));
    const anchoPag = Math.max(...lines.map((l) => l.cx));
    const limiteX = titProv && titProv.x > anchoPag * 0.45 ? titProv.x - Math.trunc(titProv.h * 1.5) : Infinity;

    const body = lines.filter((l) => l.y > headerY + Math.trunc((ancla ? ancla.h : 0) / 2)).sort((a, b) => a.y - b.y);
    const soloNum = /^\d{1,2}$/u; const conQty = /^(\d{1,2})\s+(\p{L}.*)$/u; const numRx = /^(\d{1,3})\s*[.,]?$/u;
    const encabezadoRx = /^(SEGURO\b|ELABORACI|ENTREGA\b|MODELO\b|VIN\b|TRAZO\b)/u;

    const titPz = lines.find((l) => soloPz.test(l.text.toUpperCase().trim()));
    const colNum = !titPz ? [] : body.filter((l) => numRx.test(l.text.replace(/ /g, '')) && l.cx < titPz.x);
    const numeros = body.filter((l) => soloNum.test(l.text.replace(/ /g, '')) && !colNum.includes(l));

    const altos = body.filter((l) => l.text.length >= 6).map((l) => l.h).sort((a, b) => a - b);
    const altura = altos.length ? altos[Math.floor(altos.length / 2)] : 30;

    const numCercano = (l) => {
      let c = null;
      for (const x of colNum) if (Math.abs(x.y - l.y) < altura * 0.8 && (c === null || Math.abs(x.y - l.y) < Math.abs(c.y - l.y))) c = x;
      if (!c) return null;
      const m = numRx.exec(c.text.replace(/ /g, '')); return m ? parseInt(m[1], 10) : null;
    };

    const porNumero = colNum.length >= 3;
    const items = [];
    let ultX = 0; let ultY = -Infinity; let continuo = false;
    for (const l of body) {
      const recorte = limiteX !== Infinity && l.els.length ? l.els.filter((e) => e[1] < limiteX).map((e) => e[0]).join(' ') : l.text;
      const up = recorte.trim(); const u = up.toUpperCase();
      if (![...up].some(esLet)) continue;
      if (u.includes('PROVEEDOR') || u.includes('COSTOS') || u.includes('CONCEPTO')) continue;
      if (encabezadoRx.test(u) || FECHA.test(u)) continue;
      const u17 = u.replace(/ /g, '');
      if (u17.length === 17 && cuenta(u17, esDig) >= 3 && cuenta(u17, esLet) >= 3) continue;
      if (u === unidad.toUpperCase() || u === taller.toUpperCase() || u === seguro.toUpperCase()) continue;

      let texto = up.replace(/^\d{1,2}[.,]\s+/u, '');
      let pz = null;
      const m = conQty.exec(texto);
      if (m) { pz = m[1]; texto = m[2]; }
      else {
        let q = null;
        for (const n of numeros) if (n.x < l.x && Math.abs(n.y - l.y) < altura * 0.7 && l.x - n.x < altura * 3.5 && (q === null || n.x > q.x)) q = n;
        if (q) pz = q.text.replace(/ /g, '');
      }
      const numFila = numCercano(l);
      if (pz === null && porNumero && numFila !== null) pz = '1';

      if (pz !== null) {
        items.push(M.nuevoItem({ id: base + items.length, pz, concepto: texto.trim(), num: numFila || 0 }));
        ultX = l.x; ultY = l.y; continuo = false;
      } else {
        const dy = l.y - ultY;
        const esCont = items.length > 0 && !continuo && dy > 0 && dy < altura * 1.25 && Math.abs(l.x - ultX) < 50;
        if (esCont) {
          const last = items.pop();
          items.push(Object.assign({}, last, { concepto: (last.concepto + ' ' + texto).trim() }));
          ultY = l.y; continuo = true;
        } else if (!porNumero && texto.length >= 4) {
          items.push(M.nuevoItem({ id: base + items.length, pz: '1', concepto: texto.trim() }));
          ultX = l.x; ultY = l.y; continuo = false;
        }
      }
    }

    let ult = 0;
    const numerados = [];
    items.forEach((p, i) => {
      const ok = p.num > 0 && (i === 0 || (p.num > ult && p.num <= ult + 3));
      const n = ok ? p.num : ult + 1; ult = n;
      const q = Object.assign({}, p, { num: n });
      M.partirConcepto(q.concepto).forEach((parte, j) => {
        numerados.push(Object.assign({}, q, { id: q.id + 1000 * j, concepto: parte, pz: j === 0 ? q.pz : '1', num: j === 0 ? q.num : 0 }));
      });
    });

    return M.nuevaOrden({ id: base, seguro, elaboracion: F.normalizarFecha(elaboracion), entrega: F.normalizarFecha(entrega), ot, unidad, vin, modelo, taller, items: numerados });
  }

  /** Completa los huecos de a con b (primera lectura mejorada + lectura de la foto original). */
  function combinar(a, b) {
    const t = (x, y) => (x && String(x).trim() ? x : y);
    return Object.assign({}, a, { seguro: t(a.seguro, b.seguro), elaboracion: t(a.elaboracion, b.elaboracion), entrega: t(a.entrega, b.entrega), ot: t(a.ot, b.ot),
      unidad: t(a.unidad, b.unidad), vin: t(a.vin, b.vin), modelo: t(a.modelo, b.modelo), taller: t(a.taller, b.taller), items: a.items.length ? a.items : b.items });
  }
  const completo = (o) => o.items.length > 0 && !!o.ot.trim() && !!o.unidad.trim() && !!o.modelo.trim();

  return { parse, combinar, completo };
});
