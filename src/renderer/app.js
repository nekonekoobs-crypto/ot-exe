'use strict';
// Interfaz de OT TRACSA (Windows). Misma lógica que la app de Android; el tema es Gentelella oscuro.
(function () {
  const M = window.Models; const P = window.OcrParser;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));

  async function api(canal, ...args) {
    const r = await window.api.llamar(canal, ...args);
    if (!r.ok) throw new Error(r.error);
    return r.v;
  }

  const S = {
    estado: null, ordenes: [], vista: 'login', actual: null, encAbierto: true, busqueda: '', revision: null,
    usuariosPend: 0, sincronizando: false, guardarTimer: null, sucio: false, fotos: new Map(), cargando: ''
  };

  // ---------- Avisos y ventanas ----------
  function toast(msg, tipo) {
    const t = document.createElement('div');
    t.className = 'toast' + (tipo ? ' toast-' + tipo : ''); t.textContent = msg;
    t.onclick = () => t.remove();
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), tipo === 'error' ? 8000 : 4500);
  }

  /** Ventana emergente. botones: [{ texto, valor, clase }]. Devuelve el valor del botón pulsado (null si se cierra). */
  function ventana(o) {
    return new Promise((ok) => {
      const capa = $('#capa-modal');
      const fondo = document.createElement('div');
      fondo.className = 'modal-backdrop show';
      fondo.innerHTML = `<div class="modal-dialog ${o.clase || ''}" role="dialog" aria-modal="true">
        <div class="modal-header"><div class="modal-title">${esc(o.titulo || '')}</div><button class="modal-close" aria-label="Cerrar" data-v="__x">×</button></div>
        <div class="modal-body">${o.cuerpo || ''}</div>
        <div class="modal-footer">${(o.botones || []).map((b, i) => `<button class="btn ${b.clase || 'btn-outline'}" data-i="${i}">${esc(b.texto)}</button>`).join('')}</div></div>`;
      const cerrar = (v) => { fondo.remove(); if (o.alCerrar) o.alCerrar(); ok(v); };
      fondo.addEventListener('click', (e) => {
        const b = e.target.closest('[data-i],[data-v]');
        if (b && b.dataset.i !== undefined) { const bt = o.botones[+b.dataset.i]; if (bt.alPulsar) { const r = bt.alPulsar(fondo); if (r === false) return; } cerrar(bt.valor); }
        else if (b || e.target === fondo) cerrar(null);
      });
      capa.appendChild(fondo);
      if (o.alAbrir) o.alAbrir(fondo, cerrar);
      const primero = fondo.querySelector('input,textarea,.btn-primary'); if (primero && o.enfocar !== false) primero.focus();
    });
  }
  const confirmar = (titulo, texto, ok, peligro) => ventana({ titulo, cuerpo: `<p>${esc(texto)}</p>`, botones: [{ texto: 'Cancelar', valor: false }, { texto: ok || 'Aceptar', valor: true, clase: peligro ? 'btn-peligro' : 'btn-primary' }] }).then((v) => v === true);

  function ocupado(texto) {
    S.cargando = texto || '';
    let el = $('#cargando-global');
    if (!texto) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'cargando-global'; el.className = 'toast'; el.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:3000'; document.body.appendChild(el); }
    el.innerHTML = `<span class="cargando"><span class="giro"></span>${esc(texto)}</span>`;
  }

  // ---------- Fotos: lectura, compresión y mejora para el OCR ----------
  const MAX_LADO = 1280; const MAX_BYTES = 250000;
  const aBlob = (c, tipo, q) => new Promise((ok) => c.toBlob(ok, tipo, q));
  const blobABytes = async (b) => new Uint8Array(await b.arrayBuffer());

  async function abrirBitmap(bytes) { return createImageBitmap(new Blob([bytes]), { imageOrientation: 'from-image' }); }
  function lienzo(bmp, maxLado) {
    const lado = Math.max(bmp.width, bmp.height); const e = lado > maxLado ? maxLado / lado : 1;
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * e)); c.height = Math.max(1, Math.round(bmp.height * e));
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0, c.width, c.height);
    return c;
  }
  /** Reduce a 1280 px y baja la calidad del JPEG hasta ~250 KB (igual que la app de Android). */
  async function comprimir(bytes) {
    const bmp = await abrirBitmap(bytes); const c = lienzo(bmp, MAX_LADO); let q = 0.75; let b;
    for (;;) { b = await aBlob(c, 'image/jpeg', q); if (b.size <= MAX_BYTES || q <= 0.4) break; q -= 0.1; }
    return blobABytes(b);
  }
  /** Blanco y negro, contraste 1.35 y nitidez moderada antes del OCR (igual que Imagen.kt). */
  function mejorar(c) {
    const w = c.width; const h = c.height; const x = c.getContext('2d'); const img = x.getImageData(0, 0, w, h); const d = img.data;
    const g = new Uint8Array(w * h); const k = 1.35; const t = 128 * (1 - k);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) { const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; g[j] = Math.max(0, Math.min(255, l * k + t)); }
    const o = new Uint8Array(g);
    for (let y = 1; y < h - 1; y++) for (let xx = 1; xx < w - 1; xx++) { const i = y * w + xx; const v = (6 * g[i] - (g[i - 1] + g[i + 1] + g[i - w] + g[i + w])) / 2; o[i] = v < 0 ? 0 : v > 255 ? 255 : v; }
    for (let i = 0, j = 0; i < d.length; i += 4, j++) { d[i] = d[i + 1] = d[i + 2] = o[j]; d[i + 3] = 255; }
    x.putImageData(img, 0, 0); return c;
  }
  /** Lee una foto de una OT: primero la versión mejorada y, si falta algo, completa con la original. */
  async function leerFoto(bytes) {
    const bmp = await abrirBitmap(bytes); const base = lienzo(bmp, 2200);
    const original = await blobABytes(await aBlob(base, 'image/png'));
    const mej = mejorar(base); const mejBytes = await blobABytes(await aBlob(mej, 'image/png'));
    let o = P.parse(await api('ocr', mejBytes));
    if (!P.completo(o)) { try { o = P.combinar(o, P.parse(await api('ocr', original))); } catch (e) { /* se queda con la primera lectura */ } }
    return o;
  }
  async function leerPdf(bytes) {
    const pdfjs = await import('../../node_modules/pdfjs-dist/build/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', location.href).href;
    const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    let acum = null;
    for (let i = 1; i <= Math.min(doc.numPages, 6); i++) {
      ocupado(`Leyendo el PDF (página ${i} de ${Math.min(doc.numPages, 6)})…`);
      const pag = await doc.getPage(i); const v0 = pag.getViewport({ scale: 1 }); const vp = pag.getViewport({ scale: 2000 / v0.width });
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      await pag.render({ canvasContext: x, viewport: vp }).promise;
      try { const o = await leerFoto(await blobABytes(await aBlob(c, 'image/jpeg', 0.92))); acum = acum ? M.fusionarOrden(acum, o) : o; }
      catch (e) { if (!acum) throw e; break; }
    }
    if (!acum) throw new Error('El PDF no tiene páginas legibles.');
    return acum;
  }

  // ---------- Cámara ----------
  async function tomarConCamara() {
    let flujo = null;
    try { flujo = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 } }, audio: false }); }
    catch (e) { toast('No se pudo abrir la cámara. Revisa que esté conectada y que Windows permita su uso, o elige una foto del equipo.', 'error'); return null; }
    let bytes = null;
    await ventana({
      titulo: 'Tomar foto', clase: 'ancha camara', cuerpo: '<video autoplay playsinline muted></video>', enfocar: false,
      botones: [{ texto: 'Cancelar', valor: false }, {
        texto: '📷 Tomar foto', valor: true, clase: 'btn-primary', alPulsar: (f) => {
          const v = f.querySelector('video'); if (!v.videoWidth) return false;
          const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
          bytes = c; return true;
        }
      }],
      alAbrir: (f) => { f.querySelector('video').srcObject = flujo; }, alCerrar: () => flujo.getTracks().forEach((t) => t.stop())
    });
    return bytes ? blobABytes(await aBlob(bytes, 'image/jpeg', 0.92)) : null;
  }
  const elegirImagen = async () => { const r = await api('elegirImagen'); return r ? r.datos : null; };

  // ---------- Datos ----------
  const soloLectura = () => !S.estado || S.estado.soloLectura;
  const editableActual = () => !!S.actual && !soloLectura() && S.actual._editable !== false;

  async function refrescarOrdenes() { S.ordenes = await api('ordenes'); }
  async function refrescarEstado() { S.estado = await api('estado'); pintarEstado(); }

  function programarGuardado() {
    S.sucio = true; if (S.guardarTimer) clearTimeout(S.guardarTimer);
    S.guardarTimer = setTimeout(guardarYa, 500);
  }
  async function guardarYa() {
    if (S.guardarTimer) { clearTimeout(S.guardarTimer); S.guardarTimer = null; }
    if (!S.sucio || !S.actual) return;
    S.sucio = false;
    try { const e = S.actual._editable; const r = await api('guardarOrden', S.actual); S.actual = Object.assign(r, { _editable: e }); S.actual._guardada = true; }
    catch (e) { toast(e.message, 'error'); }
  }

  // ---------- Estado y menú ----------
  function pintarEstado() {
    const e = S.estado; if (!e || !e.sesion) return;
    $('#usr-correo').textContent = e.sesion.email; $('#usr-correo').title = e.sesion.email;
    $('#usr-rol').textContent = e.soloLectura ? 'Solo lectura' : (e.restringido ? 'Almacenista (solo sus OT)' : 'Almacenista');
    $('#avatar').firstChild.textContent = (e.sesion.email || '?')[0].toUpperCase();
  }
  function pintarSync(msg, mal) { const el = $('#estado-sync'); el.textContent = msg || ''; el.title = msg || ''; el.classList.toggle('mal', !!mal); }

  const ICONO = {
    lista: '<path d="M4 6h16M4 12h16M4 18h10"/>', mas: '<path d="M12 5v14M5 12h14"/>', camara: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    imagen: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>', archivo: '<path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6"/>',
    usuarios: '<circle cx="9" cy="8" r="4"/><path d="M2 20c0-3.9 3.1-7 7-7s7 3.1 7 7M17 11a3 3 0 100-6M22 20c0-2.8-1.8-5-4-6"/>', guardar: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
    subir: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>', carpeta: '<path d="M3 7a2 2 0 012-2h4l2 2h7a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>'
  };
  const ic = (n) => `<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">${ICONO[n]}</svg>`;

  function pintarMenu() {
    const ro = soloLectura(); const act = S.vista;
    const item = (id, icono, texto, extra) => `<button class="nav-link nav-boton${act === id ? ' active' : ''}" data-menu="${id}">${ic(icono)}<span class="nav-text">${texto}</span>${extra || ''}</button>`;
    let h = `<div class="nav-group"><div class="nav-label">Órdenes</div>${item('lista', 'lista', 'Órdenes de trabajo')}${ro ? '' : item('nueva', 'mas', 'Nueva OT')}</div>`;
    if (!ro) h += `<div class="nav-group"><div class="nav-label">Capturar</div>${item('foto-camara', 'camara', 'Tomar foto')}${item('foto-archivo', 'imagen', 'Elegir foto del equipo')}${item('importar', 'archivo', 'Importar Excel, Word o PDF')}</div>`;
    if (!ro) h += `<div class="nav-group"><div class="nav-label">Administración</div>${item('usuarios', 'usuarios', 'Dar de alta usuarios', S.usuariosPend > 0 ? `<span class="badge badge-red nav-sinc-badge">${S.usuariosPend}</span>` : '')}</div>`;
    h += `<div class="nav-group"><div class="nav-label">Copias de seguridad</div>${item('respaldar', 'guardar', 'Hacer copia ahora')}${ro ? '' : item('cargar-respaldo', 'subir', 'Cargar copia de seguridad')}${item('carpeta-respaldos', 'carpeta', 'Abrir carpeta de copias')}</div><div class="nav-group"><div class="nav-label">Ayuda</div>${item('probar-tg', 'subir', 'Probar Telegram (fotos)')}</div>`;
    $('#menu').innerHTML = h;
  }
  function migas(partes) { $('#migas').innerHTML = partes.map((p, i, a) => (i ? '<span class="sep" aria-hidden="true">›</span>' : '') + `<span${i === a.length - 1 ? ' class="current"' : ''}>${esc(p)}</span>`).join(''); }

  // ---------- Lista de OT ----------
  const COLOR = { alta: 'var(--c-alta)', baja: 'var(--c-baja)', prestamo: 'var(--c-prestamo)', devolucion: 'var(--c-devolucion)', sobrante: 'var(--c-sobrante)' };
  const ETQ = { alta: 'Altas', baja: 'Bajas', prestamo: 'Préstamos', devolucion: 'Devoluciones', sobrante: 'Sobrantes' };
  const ETQ_C = { alta: 'Altas', baja: 'Bajas', prestamo: 'Prést.', devolucion: 'Devol.', sobrante: 'Sobr.' };
  const textoSobre = (e) => (e === 'sobrante' ? '#111827' : '#111827');

  function pintarLista() {
    S.vista = 'lista'; S.actual = null; pintarMenu(); migas(['Inicio', 'Órdenes de trabajo']); $('#caja-busqueda').hidden = false; $('#busqueda').placeholder = 'Buscar OT, seguro, unidad, VIN…';
    const q = S.busqueda.trim(); const lista = q ? S.ordenes.filter((o) => M.coincide(o, q)) : S.ordenes;
    const tot = { alta: 0, baja: 0, prestamo: 0, devolucion: 0, sobrante: 0 };
    for (const o of lista) { const c = M.cuenta(o); for (const e of M.ESTADOS) tot[e] += c[e]; }
    let h = (S.estado && !S.estado.telegram) ? '<div class="card" style="margin-bottom:12px;border-color:#f59f00"><div class="card-body"><b>Telegram no está configurado en esta instalación.</b> Sin él no se pueden ver ni subir fotos. Faltan los secretos TG_BOT_TOKEN, TG_CHAT_ID y TG_FOTOS_KEY al compilar (revisa la guía).</div></div>' : '';
    h += `<div class="page-header"><div class="page-header-row"><div><div class="page-pretitle">Almacén</div><h1 class="page-title">Órdenes de trabajo (${lista.length})</h1></div>
      <div class="page-actions">${soloLectura() ? '' : '<button class="btn btn-primary" data-acc="nueva">+ Nueva OT</button>'}</div></div></div>`;
    h += '<div class="fila-stats">' + M.ESTADOS.map((e) => `<div class="stat-color" style="background:${COLOR[e]}"><div class="n">${tot[e]}</div><div class="t">${ETQ[e]}</div></div>`).join('') + '</div>';
    if (!lista.length) h += `<div class="card"><div class="vacio">${q ? 'No hay OT que coincidan con la búsqueda.' : 'Todavía no hay órdenes. Usa “Nueva OT”, una foto o importa un archivo.'}</div></div>`;
    h += '<div class="lista-ot">' + lista.map((o) => {
      const c = M.cuenta(o); const ed = !!o._editable;
      return `<div class="tarjeta-ot${o.baja ? ' es-baja' : ''}" data-abrir="${o.id}">
        <div class="ot-titulo">OT ${esc(o.ot || '(sin número)')}${o.baja ? ' · BAJA' : ''}</div>
        <div class="ot-sub">${esc([o.unidad, o.seguro, o.taller].filter((x) => x).join(' · '))} · ${o.items.length} piezas</div>
        <div class="conteos">${M.ESTADOS.map((e) => `<div class="conteo" style="background:${COLOR[e]}"><b>${c[e]}</b><span>${ETQ_C[e]}</span></div>`).join('')}</div>
        <div class="ot-pie"><label class="casilla${ed ? '' : ' bloqueada'}"><input type="checkbox" data-baja="${o.id}" ${o.baja ? 'checked' : ''} ${ed ? '' : 'disabled'}> Baja de OT</label><span class="espacio"></span>
          ${ed ? `<button class="btn-texto" data-borrar="${o.id}">Borrar</button>` : ''}
          ${!ed && !soloLectura() ? '<span class="solo-lectura">Solo lectura: la subió otro almacenista</span>' : ''}</div></div>`;
    }).join('') + '</div>';
    $('#vista').innerHTML = h;
  }

  async function marcarBaja(id, valor) {
    const o = S.ordenes.find((x) => x.id === id); if (!o) return;
    const ok = await confirmar(valor ? 'Marcar baja de OT' : 'Quitar baja de OT', valor ? `¿Estás seguro de marcar la OT ${o.ot || ''} como BAJA?` : `¿Estás seguro de quitar la baja de la OT ${o.ot || ''}?`, valor ? 'Marcar baja' : 'Quitar baja', valor);
    if (!ok) { pintarLista(); return; }
    try { await api('guardarOrden', Object.assign({}, o, { baja: valor })); await refrescarOrdenes(); await refrescarEstado(); }
    catch (e) { toast(e.message, 'error'); }
    pintarLista();
  }
  async function borrarOt(id) {
    const o = S.ordenes.find((x) => x.id === id); if (!o) return;
    if (!(await confirmar('Borrar OT', `¿Seguro que quieres borrar la OT ${o.ot || '(sin número)'} con sus ${o.items.length} piezas y fotos? No se puede deshacer.`, 'Borrar', true))) return;
    try { await api('borrarOrden', id); await refrescarOrdenes(); await refrescarEstado(); toast('OT borrada', 'success'); } catch (e) { toast(e.message, 'error'); }
    pintarLista();
  }

  // ---------- Detalle de la OT ----------
  const CAMPOS = [['seguro', 'Seguro'], ['elaboracion', 'Elaboración'], ['entrega', 'Entrega'], ['ot', 'OT'], ['unidad', 'Unidad'], ['vin', 'VIN'], ['modelo', 'Modelo'], ['taller', 'Razón social'], ['jefeTaller', 'Jefe de taller']];

  async function abrirOt(id) {
    try { const o = await api('orden', id); if (!o) { toast('No se encontró la OT.', 'error'); return; } S.actual = o; S.busqueda = ''; $('#busqueda').value = ''; S.encAbierto = true; pintarDetalle(); }
    catch (e) { toast(e.message, 'error'); }
  }
  function nuevaOt() { const o = M.toJson(M.nuevaOrden({ id: Date.now() })); o._editable = true; S.actual = o; S.encAbierto = true; S.sucio = false; pintarDetalle(); }

  function resumenEnc(o) { return [o.ot && 'OT ' + o.ot, o.unidad, o.seguro].filter((x) => x).join(' · '); }

  function pintarDetalle() {
    const o = S.actual; const ed = editableActual(); S.vista = 'detalle'; pintarMenu();
    migas(['Inicio', 'Órdenes de trabajo', 'OT ' + (o.ot || '(nueva)')]); $('#caja-busqueda').hidden = false; $('#busqueda').placeholder = 'Buscar piezas…';
    let h = `<div class="barra-acciones"><button class="btn btn-outline" data-acc="volver">← Volver</button><span class="espacio"></span>
      <button class="btn btn-outline" data-acc="exportar">Exportar a Excel</button>
      ${ed ? '<button class="btn btn-outline" data-acc="anexar-foto">📷 Agregar piezas con foto</button><button class="btn btn-outline" data-acc="anexar-archivo">Agregar piezas desde archivo</button>' : ''}</div>`;
    if (!ed && !soloLectura()) h += '<div class="leyenda">Solo lectura: esta OT la subió otro almacenista.</div>';
    h += `<div class="card"><div class="card-header"><button class="encabezado-toggle" data-acc="enc" aria-expanded="${S.encAbierto}"><svg class="flecha" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6l4 4 4-4"/></svg>Encabezado de la OT<span class="enc-resumen" id="enc-resumen">${S.encAbierto ? '' : esc(resumenEnc(o))}</span></button></div>
      <div class="card-body" id="enc-cuerpo" ${S.encAbierto ? '' : 'hidden'}><div class="enc-cuerpo">${CAMPOS.map(([k, t]) => `<div class="form-group"><label class="form-label" for="c-${k}">${t}</label><input class="form-control" id="c-${k}" data-enc="${k}" value="${esc(o[k])}" ${ed ? '' : 'readonly'}></div>`).join('')}</div></div></div>`;
    h += `<div class="barra-acciones" style="margin-top:14px"><h2 class="page-title" id="titulo-piezas"></h2><span class="espacio"></span>${ed ? '<button class="btn btn-primary" data-acc="nueva-pieza">+ Agregar pieza</button>' : ''}</div><div class="piezas" id="piezas"></div>`;
    $('#vista').innerHTML = h; pintarPiezas();
  }

  function pintarPiezas() {
    const o = S.actual; const q = S.busqueda.trim().toLowerCase(); const cont = $('#piezas'); if (!cont) return;
    const vis = o.items.filter((p) => !q || q.split(' ').filter((w) => w).every((w) => [p.concepto, p.proveedor, p.pz, p.num, p.descPrestamo, p.descDevolucion].join(' ').toLowerCase().includes(w)));
    $('#titulo-piezas').textContent = `Piezas (${q ? vis.length + ' de ' : ''}${o.items.length})`;
    cont.innerHTML = vis.length ? '' : `<div class="card"><div class="vacio">${o.items.length ? 'No hay piezas que coincidan.' : 'Esta OT todavía no tiene piezas.'}</div></div>`;
    for (const p of vis) cont.appendChild(tarjetaPieza(p));
  }

  function tarjetaPieza(p) {
    const ed = editableActual(); const e = M.estadoDe(p) || 'neutro'; const ro = ed ? '' : 'readonly'; const dis = ed ? '' : 'disabled';
    const el = document.createElement('div'); el.className = 'pieza e-' + e; el.dataset.id = p.id;
    const casilla = (k, t) => `<label class="casilla${ed ? '' : ' bloqueada'}"><input type="checkbox" data-estado="${k}" ${p[k] ? 'checked' : ''} ${dis}> ${t}</label>`;
    const bloqueFoto = (campo, texto) => `<div class="bloque-foto">${ed ? `<button class="btn-pieza" data-foto="${campo}">📷 ${texto}</button>` : ''}${p[campo] ? `<img class="mini-foto" data-ver="${esc(p[campo])}" alt="Foto">` : ''}</div>`;
    el.innerHTML = `<div class="fila"><label class="campo n">No.<input type="text" data-k="num" value="${p.num > 0 ? p.num : ''}" ${ro}></label>
      <label class="campo pz">PZ<input type="text" data-k="pz" value="${esc(p.pz)}" ${ro}></label>
      <label class="campo grande">Concepto<input type="text" data-k="concepto" value="${esc(p.concepto)}" ${ro}></label></div>
      <div class="fila"><label class="campo grande">Proveedor<input type="text" data-k="proveedor" value="${esc(p.proveedor)}" ${ro}></label></div>
      <div class="fila">${casilla('alta', 'Alta')}${casilla('baja', 'Baja')}${casilla('prestamo', 'Préstamo')}${casilla('devolucion', 'Devolución')}${casilla('sobrante', 'Sobrante')}<span style="flex:1"></span>${ed ? '<button class="btn-texto" data-acc="borrar-pieza">Borrar</button>' : ''}</div>
      ${p.baja ? bloqueFoto('fotoBaja', 'Foto de salida') : ''}
      ${p.prestamo ? `<label class="campo" style="margin-bottom:8px">Descripción del préstamo<textarea data-k="descPrestamo" ${ro}>${esc(p.descPrestamo)}</textarea></label>${bloqueFoto('fotoPrestamo', 'Foto del préstamo')}` : ''}
      ${p.devolucion ? `<label class="campo">Descripción de la devolución<textarea data-k="descDevolucion" ${ro}>${esc(p.descDevolucion)}</textarea></label>` : ''}`;
    el.querySelectorAll('img[data-ver]').forEach((img) => cargarImg(img, img.dataset.ver));
    return el;
  }

  async function urlFoto(nombre) {
    if (S.fotos.has(nombre)) return S.fotos.get(nombre);
    const b = await api('leerFoto', nombre); if (!b) return null;
    const u = URL.createObjectURL(new Blob([b], { type: 'image/jpeg' })); S.fotos.set(nombre, u); return u;
  }
  async function cargarImg(img, nombre) { try { const u = await urlFoto(nombre); if (u) img.src = u; else { img.alt = 'Foto no disponible todavía'; img.style.opacity = '.4'; } } catch (e) { img.style.opacity = '.4'; } }

  const itemPorId = (id) => S.actual.items.find((x) => String(x.id) === String(id));
  function cambiarItem(id, fn) { S.actual.items = S.actual.items.map((x) => (String(x.id) === String(id) ? fn(x) : x)); programarGuardado(); }
  function repintarPieza(id) { const viejo = $(`.pieza[data-id="${id}"]`); const p = itemPorId(id); if (viejo && p) viejo.replaceWith(tarjetaPieza(p)); }

  async function pedirFoto(id, campo) {
    if (!editableActual()) return;
    const origen = await ventana({ titulo: 'Foto', cuerpo: '<p>¿De dónde quieres la foto?</p>', botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Elegir del equipo', valor: 'archivo' }, { texto: '📷 Cámara', valor: 'camara', clase: 'btn-primary' }] });
    if (!origen) return;
    try {
      const crudo = origen === 'camara' ? await tomarConCamara() : await elegirImagen(); if (!crudo) return;
      ocupado('Guardando la foto…'); const bytes = await comprimir(crudo);
      const nombre = `${S.actual.id}_${id}_${campo === 'fotoPrestamo' ? 'prestamo' : 'baja'}_${Date.now()}.jpg`;
      await api('guardarFoto', nombre, bytes);
      cambiarItem(id, (x) => Object.assign({}, x, { [campo]: nombre })); await guardarYa(); repintarPieza(id);
    } catch (e) { toast('No se pudo guardar la foto: ' + e.message, 'error'); } finally { ocupado(''); }
  }
  async function verFoto(id, nombre) {
    const u = await urlFoto(nombre); if (!u) { toast('La foto no se ha descargado. ' + ($('#estado-sync').textContent || 'Sincroniza e inténtalo otra vez.'), 'error'); return; }
    const campo = itemPorId(id) && itemPorId(id).fotoPrestamo === nombre ? 'fotoPrestamo' : 'fotoBaja';
    const r = await ventana({ titulo: 'Foto', clase: 'ancha visor', cuerpo: `<img src="${u}" alt="Foto">`, botones: [editableActual() ? { texto: 'Eliminar foto', valor: 'borrar', clase: 'btn-peligro' } : null, { texto: 'Cerrar', valor: null }].filter((x) => x) });
    if (r === 'borrar' && (await confirmar('Eliminar foto', '¿Estás seguro de eliminar esta foto?', 'Eliminar', true))) {
      cambiarItem(id, (x) => Object.assign({}, x, { [campo]: '' })); await guardarYa(); repintarPieza(id); toast('Foto eliminada', 'success');
    }
  }

  // ---------- Revisión de lo leído ----------
  const mitades = (texto) => {
    const t = texto.trim(); const medio = Math.floor(t.length / 2); const izq = t.lastIndexOf(' ', medio); const der = t.indexOf(' ', medio);
    if (izq === -1 && der === -1) return [t, ''];
    const corte = izq === -1 ? der : der === -1 ? izq : (medio - izq <= der - medio ? izq : der);
    return [t.substring(0, corte).trim(), t.substring(corte).trim()];
  };
  function ordenarPorNumero(lista) {
    let ult = 0; const clave = lista.map((x) => { if (x.num > 0) ult = x.num; else ult += 0.01; return ult; });
    return lista.map((x, i) => i).sort((a, b) => clave[a] - clave[b]).map((i) => lista[i]);
  }

  function empezarRevision(orden, anexando) { S.revision = { orden, anexando }; pintarRevision(); }
  function pintarRevision() {
    const R = S.revision; const lista = R.orden.items; S.vista = 'revision'; pintarMenu(); migas(['Inicio', 'Órdenes de trabajo', 'Revisar piezas']); $('#caja-busqueda').hidden = true;
    let h = `<div class="barra-acciones"><button class="btn btn-outline" data-rev="cancelar">Cancelar</button><button class="btn btn-primary" data-rev="guardar">${R.anexando ? 'Agregar a la OT' : 'Guardar OT'}</button></div>
      <h1 class="page-title">Revisar piezas (${lista.length})</h1>
      <p class="leyenda">Antes de guardar: divide las piezas que salieron juntas, une las que se partieron y enumera para fijar el orden.</p>
      <div class="barra-acciones"><button class="btn btn-outline" data-rev="ordenar">Ordenar por No.</button><button class="btn btn-outline" data-rev="enumerar">Enumerar 1 a ${lista.length}</button></div>`;
    if (!R.anexando) h += `<div class="card" style="margin-bottom:12px"><div class="card-body"><div class="enc-cuerpo">${CAMPOS.map(([k, t]) => `<div class="form-group"><label class="form-label">${t}</label><input class="form-control" data-renc="${k}" value="${esc(R.orden[k])}"></label></div>`).join('')}</div></div></div>`;
    h += '<div class="piezas">' + lista.map((p, i) => `<div class="pieza e-neutro" data-rid="${p.id}"><div class="fila">
      <label class="campo n">No.<input type="text" data-rk="num" value="${p.num > 0 ? p.num : ''}"></label><label class="campo pz">PZ<input type="text" data-rk="pz" value="${esc(p.pz)}"></label>
      <label class="campo grande">Concepto<input type="text" data-rk="concepto" value="${esc(p.concepto)}"></label></div>
      ${p.num === 0 ? '<div class="rev-aviso" style="color:#fbbf24">Sin No.: si es una pieza aparte déjala; si es parte de la anterior, únela.</div>' : p.concepto.length >= 40 ? '<div class="rev-aviso" style="color:#fbbf24">Concepto largo: revisa que no sean 2 piezas.</div>' : ''}
      <div class="fila"><button class="btn-texto" data-rdiv="${p.id}" style="color:var(--text)">Dividir</button>${i > 0 ? `<button class="btn-texto" data-runir="${p.id}" style="color:var(--text)">Unir con anterior</button>` : ''}<span style="flex:1"></span><button class="btn-texto" data-rquitar="${p.id}" style="color:var(--text)">Quitar</button></div></div>`).join('') + '</div>';
    h += '<div class="barra-acciones" style="margin-top:12px"><button class="btn btn-outline" data-rev="agregar">Agregar pieza</button></div>';
    $('#vista').innerHTML = h;
  }
  async function dividirRev(id) {
    const R = S.revision; const p = R.orden.items.find((x) => String(x.id) === String(id)); const [a, b] = mitades(p.concepto);
    const r = await ventana({ titulo: 'Dividir pieza', cuerpo: `<p>Deja cada pieza en su propio campo:</p><div class="form-group"><label class="form-label">Pieza 1</label><input class="form-control" id="div-a" value="${esc(a)}"></div><div class="form-group"><label class="form-label">Pieza 2</label><input class="form-control" id="div-b" value="${esc(b)}"></div>`, botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Dividir', valor: 'ok', clase: 'btn-primary', alPulsar: (f) => { R._a = f.querySelector('#div-a').value; R._b = f.querySelector('#div-b').value; } }] });
    if (r !== 'ok') return;
    const nuevoId = Math.max(0, ...R.orden.items.map((x) => x.id)) + 1;
    R.orden.items = R.orden.items.flatMap((x) => (String(x.id) === String(id) ? [Object.assign({}, x, { concepto: R._a.trim() }), M.nuevoItem({ id: nuevoId, pz: '1', concepto: R._b.trim() })] : [x]));
    pintarRevision();
  }
  async function guardarRevision() {
    const R = S.revision; await guardarYa();
    try {
      ocupado('Guardando…');
      if (R.anexando) {
        const nueva = M.fusionarOrden(S.actual, R.orden); const f = M.fusionarItems(S.actual.items, R.orden.items);
        const e = S.actual._editable; S.actual = Object.assign(await api('guardarOrden', nueva), { _editable: e }); S.revision = null; pintarDetalle();
        toast(`Se agregaron ${f.agregadas} piezas${f.repetidas ? ` (${f.repetidas} ya estaban)` : ''}`, 'success');
      } else {
        const o = await api('guardarOrden', R.orden); S.revision = null; await refrescarOrdenes(); await refrescarEstado(); await abrirOt(o.id); toast('OT guardada', 'success');
      }
    } catch (e) { toast(e.message, 'error'); } finally { ocupado(''); }
  }

  // ---------- Captura (foto o archivo) ----------
  async function capturar(modo, anexando) {
    if (soloLectura()) return;
    try {
      if (anexando) await guardarYa();
      let orden = null;
      if (modo === 'camara') { const b = await tomarConCamara(); if (!b) return; ocupado('Leyendo la foto…'); orden = await leerFoto(b); }
      else if (modo === 'foto') { const b = await elegirImagen(); if (!b) return; ocupado('Leyendo la foto…'); orden = await leerFoto(b); }
      else {
        const r = await api('elegirDocumento'); if (!r) return;
        if (r.tipo === 'orden') orden = r.orden; else if (r.tipo === 'imagen') { ocupado('Leyendo la foto…'); orden = await leerFoto(r.datos); } else { ocupado('Leyendo el PDF…'); orden = await leerPdf(r.datos); }
      }
      ocupado(''); if (!orden.items.length) toast('No se encontraron piezas. Puedes agregarlas a mano en la revisión.');
      empezarRevision(orden, !!anexando);
    } catch (e) { toast(e.message, 'error'); } finally { ocupado(''); }
  }

  // ---------- Usuarios ----------
  async function pintarUsuarios() {
    S.vista = 'usuarios'; pintarMenu(); migas(['Inicio', 'Administración', 'Usuarios']); $('#caja-busqueda').hidden = true;
    $('#vista').innerHTML = '<div class="page-header"><div class="page-header-row"><div><div class="page-pretitle">Administración</div><h1 class="page-title">Usuarios</h1></div><div class="page-actions"><button class="btn btn-outline" data-acc="usr-actualizar">Actualizar</button></div></div></div><p class="leyenda">Quien entra por primera vez queda en “Por aprobar” hasta que lo apruebes.</p><div id="usr-cuerpo"><span class="cargando"><span class="giro"></span>Cargando…</span></div>';
    try {
      const l = await api('usuarios'); const pend = l.filter((u) => u.rol === 'pendiente'); const con = l.filter((u) => u.rol === 'lector' || u.rol === 'almacenista'); const rech = l.filter((u) => u.rol === 'rechazado');
      S.usuariosPend = pend.length; pintarMenu();
      const fila = (u, acc) => `<div class="usuario"><div class="quien"><b>${esc(u.nombre || '(sin nombre)')}</b>${esc(u.email)}<br><small>Primer ingreso: ${esc(u.creado.slice(0, 10))}${u.ultimo ? ' · Último: ' + esc(u.ultimo.slice(0, 10)) : ''}</small></div>${acc}</div>`;
      const btn = (e, r, t, c) => `<button class="btn ${c}" data-rol="${r}" data-email="${esc(e)}">${t}</button>`;
      const sec = (t, n, cuerpo) => `<div class="card" style="margin-bottom:14px"><div class="card-header"><div class="card-title">${t} (${n})</div></div><div class="card-body p-0">${cuerpo}</div></div>`;
      $('#usr-cuerpo').innerHTML = sec('Por aprobar', pend.length, pend.length ? pend.map((u) => fila(u, btn(u.email, 'lector', 'Aprobar', 'btn-primary') + btn(u.email, 'rechazado', 'Rechazar', 'btn-outline'))).join('') : '<div class="vacio">No hay solicitudes pendientes.</div>')
        + sec('Con acceso', con.length, con.map((u) => fila(u, u.rol === 'almacenista' ? '<span class="badge badge-teal">Almacenista (control total)</span>' : '<span class="badge badge-blue">Solo lectura</span>' + btn(u.email, 'rechazado', 'Quitar acceso', 'btn-outline'))).join('') || '<div class="vacio">Nadie todavía.</div>')
        + (rech.length ? sec('Rechazados', rech.length, rech.map((u) => fila(u, btn(u.email, 'lector', 'Aprobar', 'btn-primary'))).join('')) : '');
    } catch (e) { $('#usr-cuerpo').innerHTML = `<div class="form-error">${esc(e.message)}</div>`; }
  }

  // ---------- Copias de seguridad ----------
  async function hacerCopia() { try { ocupado('Creando la copia de seguridad…'); const f = await api('respaldar'); toast('Copia de seguridad guardada en ' + f, 'success'); await refrescarEstado(); } catch (e) { toast(e.message, 'error'); } finally { ocupado(''); } }
  async function cargarCopia() {
    try {
      const r = await api('respaldoElegir'); if (!r) return;
      const op = await ventana({ titulo: 'Cargar copia de seguridad', cuerpo: `<p>La copia trae <b>${r.ordenes}</b> OT y <b>${r.fotos}</b> fotos. Se agregan tal cual estaban; si una OT ya existe se reemplaza por la de la copia.</p><p class="leyenda">¿Quieres que además se suban a la nube para los demás almacenistas?</p>`, botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Restaurar solo aquí', valor: 'local' }, { texto: 'Restaurar y subir', valor: 'subir', clase: 'btn-primary' }] });
      if (!op) return;
      ocupado('Restaurando…'); const x = await api('respaldoRestaurar', op === 'subir'); await refrescarOrdenes(); await refrescarEstado(); pintarLista(); toast(`Se restauraron ${x.ordenes} OT y ${x.fotos} fotos`, 'success');
    } catch (e) { toast(e.message, 'error'); } finally { ocupado(''); }
  }

  // ---------- Sincronización ----------
  async function sincronizar(bajar) {
    if (S.sincronizando) return; S.sincronizando = true; pintarSync('Sincronizando…');
    try {
      const r = await api('sincronizar', bajar);
      if (r.sinSesion) { await mostrarLogin('Tu sesión se cerró o ya no tienes acceso. Vuelve a entrar.'); return; }
      pintarSync(r.mensaje, /Error|Sin conexión|sin descargar|sin subir/.test(r.mensaje)); if (r.usuariosPendientes >= 0) { S.usuariosPend = r.usuariosPendientes; }
      await refrescarEstado(); await refrescarOrdenes();
      if (S.vista === 'lista') pintarLista(); pintarMenu();
    } catch (e) { pintarSync(e.message, true); } finally { S.sincronizando = false; }
  }

  // ---------- Inicio y cierre de sesión ----------
  async function mostrarLogin(aviso) {
    S.vista = 'login'; S.actual = null; $('#app').hidden = true; $('#pantalla-login').hidden = false;
    const er = $('#login-error'); er.hidden = !aviso; er.textContent = aviso || ''; $('#login-clave').value = '';
    $('#btn-entrar').disabled = false; $('#btn-google').disabled = false;
  }
  async function iniciarApp() {
    $('#pantalla-login').hidden = true; $('#app').hidden = false;
    await refrescarEstado(); await refrescarOrdenes(); pintarMenu(); pintarLista(); pintarSync('Sincronizando…');
    sincronizar(true);
    setTimeout(async () => { try { if (S.estado && S.estado.sesion && !soloLectura() && (await api('respaldoToca'))) { const f = await api('respaldar'); toast('Copia de seguridad automática en ' + f, 'success'); } } catch (e) { /* se reintenta en la próxima apertura */ } }, 20000);
  }

  async function entrar(fn, boton) {
    const er = $('#login-error'); er.hidden = true; $('#btn-entrar').disabled = true; $('#btn-google').disabled = true; const txt = boton.textContent; boton.textContent = boton.id === 'btn-google' ? 'Esperando al navegador…' : 'Entrando…';
    try { await fn(); await iniciarApp(); } catch (e) { er.hidden = false; er.textContent = e.message; } finally { boton.textContent = txt; $('#btn-entrar').disabled = false; $('#btn-google').disabled = false; }
  }

  // ---------- Eventos ----------
  async function irA(id) {
    await guardarYa();
    switch (id) {
      case 'lista': await refrescarOrdenes(); S.busqueda = ''; $('#busqueda').value = ''; pintarLista(); break;
      case 'nueva': nuevaOt(); break;
      case 'foto-camara': capturar('camara', false); break;
      case 'foto-archivo': capturar('foto', false); break;
      case 'importar': capturar('doc', false); break;
      case 'usuarios': pintarUsuarios(); break;
      case 'respaldar': hacerCopia(); break;
      case 'cargar-respaldo': cargarCopia(); break;
      case 'probar-tg': {
        ocupado('Probando Telegram…');
        try {
          const r = await api('probarTelegram');
          await ventana({ titulo: r.ok ? 'Telegram funciona' : 'Telegram tiene un problema', cuerpo: r.lineas.map((l) => `<p style="margin:6px 0;color:${l[0] === 'ok' ? '#1ABB9C' : '#f56565'}">${l[0] === 'ok' ? '✓' : '✗'} ${esc(l[1])}</p>`).join('') + (r.ok ? '<p class="leyenda">Las fotos pendientes se suben en la siguiente sincronización.</p>' : ''), botones: [{ texto: 'Cerrar', valor: null, clase: 'btn-primary' }] });
        } catch (e) { toast(e.message, 'error'); } finally { ocupado(''); }
        break;
      }
      case 'carpeta-respaldos': api('carpetaRespaldos').catch((e) => toast(e.message, 'error')); break;
    }
    $('#sidebar').classList.remove('open');
  }

  function iniciarEventos() {
    $('#form-login').addEventListener('submit', (e) => { e.preventDefault(); entrar(() => api('entrarClave', $('#login-correo').value, $('#login-clave').value), $('#btn-entrar')); });
    $('#btn-google').addEventListener('click', () => entrar(() => api('entrarGoogle'), $('#btn-google')));
    $('#menu').addEventListener('click', (e) => { const b = e.target.closest('[data-menu]'); if (b) irA(b.dataset.menu); });
    $('#btn-menu').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
    $('#btn-sync').addEventListener('click', () => sincronizar(true));
    $('#btn-salir').addEventListener('click', async () => { if (await confirmar('Cerrar sesión', '¿Quieres cerrar tu sesión? Las OT guardadas en esta computadora se conservan.', 'Cerrar sesión')) { await guardarYa(); await api('salir'); await mostrarLogin(''); } });
    $('#btn-tema').addEventListener('click', () => { const n = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', n); try { localStorage.setItem('tema', n); } catch (e) { /* sin almacenamiento */ } });
    $('#busqueda').addEventListener('input', (e) => { S.busqueda = e.target.value; if (S.vista === 'lista') pintarLista(); else if (S.vista === 'detalle') pintarPiezas(); });
    window.api.alEvento('sync', (r, est) => { S.estado = est; pintarEstado(); pintarSync(r.mensaje, /Error|Sin conexión|sin descargar|sin subir/.test(r.mensaje)); if (r.sinSesion) mostrarLogin('Tu sesión se cerró o ya no tienes acceso.'); });
    window.addEventListener('beforeunload', () => { guardarYa(); });
    setInterval(() => { if (S.estado && S.estado.sesion && (S.vista === 'lista' || S.vista === 'usuarios') && !document.querySelector('.modal-backdrop')) sincronizar(true); }, 60000);

    const vista = $('#vista');
    vista.addEventListener('click', async (e) => {
      const t = e.target;
      const abrir = t.closest('[data-abrir]'); const baja = t.closest('[data-baja]'); const borrar = t.closest('[data-borrar]');
      if (baja) { e.preventDefault(); marcarBaja(+baja.dataset.baja, baja.checked); return; }
      if (borrar) { borrarOt(+borrar.dataset.borrar); return; }
      if (t.closest('label.casilla') && t.closest('.tarjeta-ot')) return;
      if (abrir && S.vista === 'lista') { abrirOt(+abrir.dataset.abrir); return; }
      const acc = t.closest('[data-acc]'); const rev = t.closest('[data-rev]'); const rol = t.closest('[data-rol]');
      if (rol) { try { await api('cambiarRol', rol.dataset.email, rol.dataset.rol); pintarUsuarios(); } catch (er) { toast(er.message, 'error'); } return; }
      if (rev) {
        const R = S.revision; const a = rev.dataset.rev;
        if (a === 'cancelar') { S.revision = null; if (R.anexando) pintarDetalle(); else pintarLista(); }
        else if (a === 'guardar') guardarRevision();
        else if (a === 'ordenar') { R.orden.items = ordenarPorNumero(R.orden.items); pintarRevision(); }
        else if (a === 'enumerar') { R.orden.items = R.orden.items.map((x, i) => Object.assign({}, x, { num: i + 1 })); pintarRevision(); }
        else if (a === 'agregar') { const l = R.orden.items; R.orden.items = l.concat(M.nuevoItem({ id: Math.max(0, ...l.map((x) => x.id)) + 1, pz: '1', num: Math.max(0, ...l.map((x) => x.num)) + 1 })); pintarRevision(); }
        return;
      }
      const rd = t.closest('[data-rdiv]'); if (rd) { dividirRev(rd.dataset.rdiv); return; }
      const ru = t.closest('[data-runir]'); if (ru) { const R = S.revision; const l = R.orden.items; const i = l.findIndex((x) => String(x.id) === ru.dataset.runir); if (i > 0) { R.orden.items = l.filter((x, j) => j !== i).map((x, j) => (j === i - 1 ? Object.assign({}, x, { concepto: (l[i - 1].concepto + ' ' + l[i].concepto).trim() }) : x)); pintarRevision(); } return; }
      const rq = t.closest('[data-rquitar]'); if (rq) { S.revision.orden.items = S.revision.orden.items.filter((x) => String(x.id) !== rq.dataset.rquitar); pintarRevision(); return; }
      const foto = t.closest('[data-foto]'); if (foto) { pedirFoto(foto.closest('.pieza').dataset.id, foto.dataset.foto); return; }
      const ver = t.closest('[data-ver]'); if (ver) { verFoto(ver.closest('.pieza').dataset.id, ver.dataset.ver); return; }
      if (!acc) return;
      switch (acc.dataset.acc) {
        case 'nueva': nuevaOt(); break;
        case 'volver': await guardarYa(); await refrescarOrdenes(); await refrescarEstado(); S.busqueda = ''; $('#busqueda').value = ''; pintarLista(); break;
        case 'enc': S.encAbierto = !S.encAbierto; acc.setAttribute('aria-expanded', S.encAbierto); $('#enc-cuerpo').hidden = !S.encAbierto; $('#enc-resumen').textContent = S.encAbierto ? '' : resumenEnc(S.actual); break;
        case 'exportar': try { await guardarYa(); if (!S.actual._guardada && !(await api('orden', S.actual.id))) { toast('Primero captura algún dato de la OT.', 'error'); break; } const f = await api('exportar', S.actual.id); if (f) toast('Excel guardado en ' + f, 'success'); } catch (er) { toast(er.message, 'error'); } break;
        case 'anexar-foto': { const o = await ventana({ titulo: 'Agregar piezas con foto', cuerpo: '<p>¿De dónde quieres la foto?</p>', botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Elegir del equipo', valor: 'foto' }, { texto: '📷 Cámara', valor: 'camara', clase: 'btn-primary' }] }); if (o) capturar(o, true); break; }
        case 'anexar-archivo': capturar('doc', true); break;
        case 'nueva-pieza': { const l = S.actual.items; const n = M.nuevoItem({ id: Date.now(), pz: '1', num: Math.max(0, ...l.map((x) => x.num)) + 1 }); S.actual.items = l.concat(n); programarGuardado(); S.busqueda = ''; $('#busqueda').value = ''; pintarPiezas(); const el = $(`.pieza[data-id="${n.id}"] [data-k="concepto"]`); if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); } break; }
        case 'borrar-pieza': { const id = acc.closest('.pieza').dataset.id; if (await confirmar('Borrar pieza', '¿Seguro que quieres borrar esta pieza?', 'Borrar', true)) { S.actual.items = S.actual.items.filter((x) => String(x.id) !== id); programarGuardado(); pintarPiezas(); } break; }
        case 'usr-actualizar': pintarUsuarios(); break;
      }
    });
    vista.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.enc && S.actual && editableActual()) { S.actual[t.dataset.enc] = t.value; programarGuardado(); if (t.dataset.enc === 'ot') migas(['Inicio', 'Órdenes de trabajo', 'OT ' + (t.value || '(nueva)')]); }
      else if (t.dataset.k && S.actual && editableActual()) {
        const id = t.closest('.pieza').dataset.id; let v = t.value;
        if (t.dataset.k === 'num') { v = v.replace(/\D/g, '').slice(0, 3); t.value = v; cambiarItem(id, (x) => Object.assign({}, x, { num: parseInt(v, 10) || 0 })); }
        else cambiarItem(id, (x) => Object.assign({}, x, { [t.dataset.k]: v }));
      } else if (t.dataset.rk && S.revision) {
        const id = t.closest('.pieza').dataset.rid; let v = t.value;
        if (t.dataset.rk === 'num') { v = v.replace(/\D/g, '').slice(0, 3); t.value = v; S.revision.orden.items = S.revision.orden.items.map((x) => (String(x.id) === id ? Object.assign({}, x, { num: parseInt(v, 10) || 0 }) : x)); }
        else S.revision.orden.items = S.revision.orden.items.map((x) => (String(x.id) === id ? Object.assign({}, x, { [t.dataset.rk]: v }) : x));
      } else if (t.dataset.renc && S.revision) S.revision.orden[t.dataset.renc] = t.value;
    });
    vista.addEventListener('change', (e) => {
      const t = e.target; if (!t.dataset.estado || !S.actual || !editableActual()) return;
      const id = t.closest('.pieza').dataset.id; cambiarItem(id, (x) => M.conEstado(x, t.dataset.estado, t.checked)); repintarPieza(id);
    });
  }

  async function arrancar() {
    try { const t = localStorage.getItem('tema'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) { /* tema oscuro por omisión */ }
    iniciarEventos();
    try { S.estado = await api('estado'); } catch (e) { S.estado = null; }
    if (S.estado && S.estado.sesion) await iniciarApp(); else await mostrarLogin('');
  }
  window.__app = { S, api }; // para pruebas
  arrancar();
})();
