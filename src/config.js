// Configuración: Supabase (pública) y los 3 datos de Telegram, que NO están en el código:
// el instalador los trae en config.json (lo genera GitHub Actions con tus secretos) o, para pruebas, en %APPDATA%/OT TRACSA/config.json.
const fs = require('fs');
const path = require('path');

const SUPABASE = {
  url: 'https://rrxwhelqvbxiwqfcpwus.supabase.co',
  key: 'sb_publishable_SyqWOd6GVH_AtxI4qnIZnw_u6C34uB1'
};

function leerJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return {}; } }

/** Devuelve { supabase, telegram: { token, chat, key } }. */
function cargar(userData) {
  const emb = leerJson(path.join(__dirname, 'config.json'));
  const loc = leerJson(path.join(userData, 'config.json'));
  const c = Object.assign({}, emb, loc);
  return {
    supabase: { url: c.SUPABASE_URL || SUPABASE.url, key: c.SUPABASE_KEY || SUPABASE.key },
    telegram: { token: c.TG_BOT_TOKEN || '', chat: c.TG_CHAT_ID || '', key: c.TG_FOTOS_KEY || '' }
  };
}
module.exports = { cargar, SUPABASE };
