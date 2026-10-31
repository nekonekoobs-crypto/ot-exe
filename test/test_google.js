const assert = require('assert'); const { iniciar } = require('../src/google'); const { Supa, nuevoPkce } = require('../src/lib/supa'); const crypto = require('crypto');
(async () => {
  const supa = new Supa({ url: 'https://x.supabase.co', key: 'k', prefs: { get() {}, set() {}, borrar() {} } });
  let urlAbierta = '';
  const p = iniciar(supa, async (u) => { urlAbierta = u; const red = new URL(u).searchParams.get('redirect_to'); setTimeout(() => fetch(red + '?code=ABC123'), 50); });
  const r = await p; assert.strictEqual(r.code, 'ABC123'); const u = new URL(urlAbierta);
  assert.strictEqual(u.searchParams.get('provider'), 'google'); assert.strictEqual(u.searchParams.get('code_challenge'), crypto.createHash('sha256').update(r.verifier).digest('base64url'));
  assert.ok(u.searchParams.get('redirect_to').startsWith('http://127.0.0.1:'));
  await assert.rejects(iniciar(supa, async (u) => { setTimeout(() => fetch(new URL(u).searchParams.get('redirect_to') + '?error=access_denied&error_description=No'), 30); }), /No/);
  await assert.rejects(iniciar(supa, async () => {}, 200), /tiempo/);
  console.log('OK google pkce');
})().catch((e) => { console.error(e); process.exit(1); });
