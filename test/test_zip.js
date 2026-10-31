const assert = require('assert'); const { crearZip, leerZip } = require('../src/lib/zip'); const fs = require('fs'); const cp = require('child_process');
const e = [{ name: 'ordenes/1.json', data: Buffer.from('{"a":"ñandú"}'.repeat(100)) }, { name: 'fotos_baja/x.jpg', data: Buffer.from([1,2,3,4,5]) }, { name: 'vacio.txt', data: Buffer.alloc(0) }];
const z = crearZip(e); const f = process.argv[2] || '/tmp/prueba_zip.zip'; fs.writeFileSync(f, z);
const r = leerZip(z); assert.strictEqual(r.length, 3); assert.ok(r[0].data().equals(e[0].data)); assert.ok(r[1].data().equals(e[1].data)); assert.strictEqual(r[2].data().length, 0);
console.log('ida y vuelta ok, tamaño', z.length, 'vs', e[0].data.length);
