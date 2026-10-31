const M = require('../src/lib/models'); const { escribirXlsx } = require('../src/lib/xlsx');
const o = M.nuevaOrden({ id: 1, seguro: 'AXA & Co', ot: 'OT-77', taller: 'Taller <Norte>', items: [
  M.nuevoItem({ id: 1, num: 1, pz: '2', concepto: 'Faro "izq"', alta: true }),
  M.nuevoItem({ id: 2, num: 2, pz: '1', concepto: 'Cofre', baja: true }),
  M.nuevoItem({ id: 3, num: 3, pz: 'ab', concepto: 'Espejo', prestamo: true, descPrestamo: 'a Juan' }),
  M.nuevoItem({ id: 4, num: 0, pz: '1', concepto: 'Calavera', devolucion: true, descDevolucion: 'ok' }),
  M.nuevoItem({ id: 5, pz: '1', concepto: 'Rejilla', sobrante: true }),
  M.nuevoItem({ id: 6, pz: '1', concepto: 'Sin estado' })] });
require('fs').writeFileSync(process.argv[2], escribirXlsx(o));
