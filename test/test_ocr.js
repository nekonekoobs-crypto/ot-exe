const assert = require('assert'); const P = require('../src/lib/ocrparser');
// Simula lo que entrega el OCR de una OT: encabezado + tabla con columna No. y columna PROVEEDOR
let y = 40; const L = []; const W = (t, x, yy, w, h = 24) => { const words = t.split(' ').map((s, i) => ({ text: s, x0: x + i * 60, x1: x + i * 60 + 50, y0: yy, y1: yy + h })); L.push({ text: t, x0: x, y0: yy, x1: x + Math.max(w, 60 * words.length), y1: yy + h, slope: 0, words }); };
W('SEGURO: MAFRE', 40, 40, 300); W('ELABORACION', 400, 40, 160); W('ENTREGA', 640, 40, 120); W('20/10/2026', 400, 80, 150); W('13/ENERO/2027', 640, 80, 200);
W('OT 4521', 40, 120, 120); W('KENWORTH T880', 40, 160, 300); W('VIN', 400, 120, 60); W('3WKDD40X5LF123456', 480, 120, 400); W('MODELO', 40, 200, 100); W('2020', 160, 200, 60); W('JIMENEZ', 700, 200, 150);
W('PZ', 120, 260, 40); W('CONCEPTO', 200, 260, 200); W('PROVEEDOR', 900, 260, 200);
const filas = [['1', '2', 'FARO IZQUIERDO LED'], ['2', '1', 'COFRE COMPLETO'], ['3', '4', 'TORNILLO DE SUJECION'], ['4', '1', 'ESPEJO RETROVISOR DERECHO CON CALEFACCION INTEGRADA Y ABATIBLE']];
filas.forEach(([n, pz, c], i) => { const yy = 320 + i * 50; W(n, 20, yy, 30); W(pz + ' ' + c, 120, yy, 600); });
W('carlos 12/10', 920, 320, 120);
const o = P.parse(L);
assert.strictEqual(o.seguro, 'MAFRE'); assert.strictEqual(o.elaboracion, '20/10/2026'); assert.strictEqual(o.entrega, '13/01/2027');
assert.strictEqual(o.ot, '4521'); assert.strictEqual(o.modelo, '2020'); assert.strictEqual(o.vin, '3WKDD40X5LF123456'); assert.strictEqual(o.unidad, 'KENWORTH T880'); assert.strictEqual(o.taller, 'JIMENEZ');
console.log(o.items.map((i) => [i.num, i.pz, i.concepto, i.concepto.length].join('|')));
assert.deepStrictEqual(o.items.slice(0, 3).map((i) => [i.num, i.pz, i.concepto]), [[1, '2', 'FARO IZQUIERDO LED'], [2, '1', 'COFRE COMPLETO'], [3, '4', 'TORNILLO DE SUJECION']]);
assert.ok(o.items.length >= 5, 'concepto largo se parte'); assert.ok(o.items.every((i) => i.concepto.length <= 56));
assert.ok(!o.items.some((i) => /carlos/i.test(i.concepto)), 'columna proveedor excluida');
assert.ok(P.completo(o)); assert.ok(!P.completo(P.parse([]))); console.log('OK ocr parser');
