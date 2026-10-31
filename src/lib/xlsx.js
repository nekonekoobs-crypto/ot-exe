// Exportar una OT a .xlsx (port exacto de XlsxWriter.kt: mismas columnas, colores y OBSERVACIONES). Solo Node.
const { crearZip } = require('./zip');

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const str = (ref, t, e) => `<c r="${ref}" s="${e}" t="inlineStr"><is><t>${esc(t)}</t></is></c>`;
const num = (ref, n, e) => `<c r="${ref}" s="${e}"><v>${n}</v></c>`;
const vacia = (ref, e) => `<c r="${ref}" s="${e}"/>`;

function hojaXml(o) {
  let sb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  sb += `<worksheet xmlns="${NS}">`;
  sb += '<sheetViews><sheetView workbookViewId="0"><pane ySplit="11" topLeftCell="A12" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
  sb += '<cols>';
  [6, 8, 55, 26, 15, 15, 13, 8, 40].forEach((w, i) => { sb += `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`; });
  sb += '</cols><sheetData>';
  const campos = [
    ['SEGURO:', o.seguro], ['ELABORACIÓN:', o.elaboracion], ['ENTREGA:', o.entrega],
    ['OT:', o.ot], ['UNIDAD:', o.unidad], ['VIN:', o.vin],
    ['MODELO:', o.modelo], ['RAZÓN SOCIAL:', o.taller], ['JEFE DE TALLER:', o.jefeTaller]
  ];
  campos.forEach(([k, v], i) => {
    const r = i + 1;
    sb += `<row r="${r}">${str('A' + r, k, 5)}${str('B' + r, v || '', 0)}</row>`;
  });
  const titulos = ['No.', 'PZ.', 'CONCEPTO', 'PROVEEDOR', 'ALTA ALMACÉN', 'BAJA ALMACÉN', 'EXISTENCIA', 'OK', 'OBSERVACIONES'];
  sb += '<row r="11">';
  titulos.forEach((t, i) => { sb += str(String.fromCharCode(65 + i) + '11', t, 1); });
  sb += '</row>';
  o.items.forEach((p, idx) => {
    const r = 12 + idx;
    const e = p.alta ? 3 : p.baja ? 4 : p.prestamo ? 6 : p.devolucion ? 7 : p.sobrante ? 8 : 2;
    const n = /^\s*-?\d+(\.\d+)?\s*$/.test(p.pz) ? parseFloat(p.pz) : null;
    sb += `<row r="${r}">`;
    sb += p.num > 0 ? num('A' + r, p.num, e) : vacia('A' + r, e);
    sb += n !== null ? num('B' + r, n, e) : str('B' + r, p.pz, e);
    sb += str('C' + r, p.concepto, e);
    sb += !p.proveedor || !p.proveedor.trim() ? vacia('D' + r, e) : str('D' + r, p.proveedor, e);
    sb += p.alta ? num('E' + r, n !== null ? n : 1, e) : vacia('E' + r, e);
    sb += p.baja ? num('F' + r, n !== null ? n : 1, e) : vacia('F' + r, e);
    sb += `<c r="G${r}" s="${e}"><f>E${r}-F${r}</f></c>`;
    sb += vacia('H' + r, e);
    let obs = '';
    if (p.prestamo) obs = 'Préstamo' + (!p.descPrestamo || !p.descPrestamo.trim() ? '' : ': ' + p.descPrestamo.trim());
    else if (p.devolucion) obs = 'Devolución' + (!p.descDevolucion || !p.descDevolucion.trim() ? '' : ': ' + p.descDevolucion.trim());
    else if (p.sobrante) obs = 'Sobrante';
    sb += !obs.trim() ? vacia('I' + r, e) : str('I' + r, obs, e);
    sb += '</row>';
  });
  sb += '</sheetData></worksheet>';
  return sb;
}

const fill = (rgb) => `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
const borde = '<left style="thin"><color rgb="FF999999"/></left><right style="thin"><color rgb="FF999999"/></right><top style="thin"><color rgb="FF999999"/></top><bottom style="thin"><color rgb="FF999999"/></bottom>';
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS}">
<fonts count="3">
<font><sz val="10"/><name val="Arial"/></font>
<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
<font><b/><sz val="10"/><name val="Arial"/></font>
</fonts>
<fills count="8">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
${fill('FF4F6F52')}
${fill('FFA5D6A7')}
${fill('FFEF9A9A')}
${fill('FFFFF176')}
${fill('FF90CAF9')}
${fill('FFA1887F')}
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border>${borde}<diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="7" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const CT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;
const ROOT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
const WB = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Orden" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
const WBR = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

/** Devuelve un Buffer con el .xlsx de la OT. */
function escribirXlsx(o) {
  const u = (s) => Buffer.from(s, 'utf8');
  return crearZip([
    { name: '[Content_Types].xml', data: u(CT) },
    { name: '_rels/.rels', data: u(ROOT) },
    { name: 'xl/workbook.xml', data: u(WB) },
    { name: 'xl/_rels/workbook.xml.rels', data: u(WBR) },
    { name: 'xl/styles.xml', data: u(STYLES) },
    { name: 'xl/worksheets/sheet1.xml', data: u(hojaXml(o)) }
  ]);
}

module.exports = { escribirXlsx };
