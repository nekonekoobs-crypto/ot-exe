const assert = require('assert'); const fs = require('fs'); const cp = require('child_process');
const os = require('os'); const path = require('path');
const D = require('../src/lib/documentos'); const M = require('../src/lib/models'); const { escribirXlsx } = require('../src/lib/xlsx'); const { crearZip } = require('../src/lib/zip');
// 1) ida y vuelta con nuestro propio Excel
const o = M.nuevaOrden({ id: 1, seguro: 'MAPFRE', elaboracion: '20/10/2026', entrega: '13/01/2027', ot: '4521', unidad: 'KENWORTH T880', vin: '3WKDD40X5LF123456', modelo: '2020', taller: 'JIMENEZ', jefeTaller: 'LUIS PEREZ',
  items: [M.nuevoItem({ id: 1, num: 1, pz: '2', concepto: 'Faro izq', proveedor: 'ABC' }), M.nuevoItem({ id: 2, num: 2, pz: '1', concepto: 'Cofre & tapa', baja: true }), M.nuevoItem({ id: 3, num: 3, pz: '4', concepto: 'Tornillo' })] });
const r = D.leerArchivo('x.xlsx', escribirXlsx(o));
console.log(r.seguro, r.elaboracion, r.ot, r.unidad, r.vin, r.modelo, r.taller, r.jefeTaller, r.items.map((i) => [i.num, i.pz, i.concepto, i.proveedor]));
assert.strictEqual(r.items.length, 3); assert.strictEqual(r.items[1].concepto, 'Cofre & tapa'); assert.strictEqual(r.items[0].pz, '2'); assert.strictEqual(r.items[2].num, 3);
// 2) Excel de verdad (openpyxl: cadenas compartidas y fechas como serial). Solo si hay Python con openpyxl.
const REAL = path.join(os.tmpdir(), 'real.xlsx').replace(/\\/g, '/');
try {
  fs.writeFileSync(path.join(os.tmpdir(), 'mk.py'), `
import openpyxl, datetime
wb=openpyxl.Workbook(); ws=wb.active
ws.append(['SEGURO:','AXA']); ws.append(['ELABORACIÓN:',datetime.date(2026,10,20)]); ws.append(['OT:',4522]); ws.append(['MODELO:',2021]); ws.append(['VIN:','1FUJGLDR5CLBP8834'])
ws.append(['No.','PZ.','CONCEPTO','PROVEEDOR']); ws.append([1,2,'Defensa delantera','X']); ws.append([2,1,'Parrilla']); ws.append([None,None,'Total'])
wb.save('${REAL}')`);
  cp.execSync('python -I "' + path.join(os.tmpdir(), 'mk.py') + '"', { stdio: 'ignore' });
  const r2 = D.leerArchivo('real.xlsx', fs.readFileSync(REAL));
  console.log(r2.seguro, r2.elaboracion, r2.ot, r2.modelo, r2.vin, r2.items.map((i) => [i.num, i.pz, i.concepto]));
  assert.strictEqual(r2.elaboracion, '20/10/2026'); assert.strictEqual(r2.items.length, 2); assert.strictEqual(r2.ot, '4522'); assert.strictEqual(r2.vin, '1FUJGLDR5CLBP8834');
} catch (e) { if (e.name === 'AssertionError') throw e; console.log('(se omite la prueba con Excel real: no hay Python con openpyxl)'); }
// 3) Word con tabla (docx hecho a mano)
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'; const p = (t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`; const tc = (t) => `<w:tc><w:tcPr><w:tcW w:w="1000"/></w:tcPr>${p(t)}</w:tc>`; const tr = (a) => `<w:tr>${a.map(tc).join('')}</w:tr>`;
const doc = `<?xml version="1.0"?><w:document ${W}><w:body>${p('SEGURO: QUALITAS')}${p('OT: 4600')}${p('MODELO: 2019')}<w:tbl>${tr(['No.', 'PZ', 'CONCEPTO'])}${tr(['1', '3', 'Luz &amp; reflejante'])}${tr(['2', '1', 'Espejo'])}</w:tbl></w:body></w:document>`;
const r3 = D.leerArchivo('o.docx', crearZip([{ name: 'word/document.xml', data: Buffer.from(doc) }])); console.log(r3.seguro, r3.ot, r3.modelo, r3.items.map((i) => [i.num, i.pz, i.concepto]));
assert.strictEqual(r3.items.length, 2); assert.strictEqual(r3.items[0].concepto, 'Luz & reflejante'); assert.strictEqual(r3.ot, '4600');
assert.throws(() => D.leerArchivo('a.xls', Buffer.alloc(0)), /antiguo/); assert.throws(() => D.leerArchivo('a.txt', Buffer.alloc(0)), /no compatible/); assert.throws(() => D.leerArchivo('a.xlsx', crearZip([{ name: 'xl/worksheets/sheet1.xml', data: Buffer.from('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>hola</t></is></c></row></sheetData></worksheet>') }])), /CONCEPTO/);
console.log('OK documentos');
