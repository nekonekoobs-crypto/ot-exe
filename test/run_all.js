// Corre todas las pruebas que no necesitan navegador (las de interfaz con Chromium están en test/ui_playwright.js).
const { spawnSync } = require('child_process'); const path = require('path');
const pruebas = ['test_zip.js', 'test_xlsx.js', 'test_tg_respaldo.js', 'test_sync.js', 'test_servicios.js', 'test_ocr.js', 'test_docs.js', 'test_google.js'];
let mal = 0;
for (const p of pruebas) {
  const r = spawnSync(process.execPath, [path.join(__dirname, p), path.join(require('os').tmpdir(), 'ot_prueba_' + p + '.out')], { encoding: 'utf8' });
  const ok = r.status === 0; if (!ok) mal++;
  console.log((ok ? 'OK    ' : 'FALLÓ ') + p); if (!ok) console.log(r.stdout + r.stderr);
}
process.exit(mal ? 1 : 0);
