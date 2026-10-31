// Fotos cifradas en un chat privado de Telegram (port de Telegram.kt). AES-256-GCM: IV(12) || cifrado || etiqueta(16),
// con la ruta "ordenId/nombre" ligada como AAD. Compatible con la app de Android. Solo Node (proceso principal).
const crypto = require('crypto');

class Telegram {
  /** cfg: { token, chat, key (base64 de 32 bytes), base (opcional, para pruebas) } */
  constructor(cfg) {
    this.token = String((cfg && cfg.token) || '').trim();
    this.chat = String((cfg && cfg.chat) || '').trim();
    this.base = (cfg && cfg.base) || 'https://api.telegram.org';
    let k = null;
    try { const b = Buffer.from(String((cfg && cfg.key) || '').trim(), 'base64'); if (b.length === 32) k = b; } catch (e) { /* sin llave */ }
    this.k = k;
  }

  configurado() { return !!(this.token && this.chat && this.k); }

  cifrar(datos, ruta) {
    if (!this.k) throw new Error('Falta la llave de cifrado');
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.k, iv);
    c.setAAD(Buffer.from(ruta, 'utf8'));
    const ct = Buffer.concat([c.update(datos), c.final()]);
    return Buffer.concat([iv, ct, c.getAuthTag()]);
  }

  descifrar(datos, ruta) {
    if (!this.k) throw new Error('Falta la llave de cifrado');
    if (datos.length < 13 + 16 - 1) throw new Error('Archivo cifrado incompleto');
    const iv = datos.subarray(0, 12);
    const tag = datos.subarray(datos.length - 16);
    const ct = datos.subarray(12, datos.length - 16);
    const d = crypto.createDecipheriv('aes-256-gcm', this.k, iv);
    d.setAAD(Buffer.from(ruta, 'utf8'));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
  }

  async _http(metodo, url, cuerpo, tipo) {
    const r = await fetch(url, { method: metodo, headers: tipo ? { 'Content-Type': tipo } : undefined, body: cuerpo || undefined });
    return { codigo: r.status, cuerpo: Buffer.from(await r.arrayBuffer()) };
  }

  async _api(metodo, cuerpo, tipo) {
    for (let intento = 0; intento < 2; intento++) {
      const r = await this._http('POST', `${this.base}/bot${this.token}/${metodo}`, cuerpo, tipo);
      let j = {};
      try { j = JSON.parse(r.cuerpo.toString('utf8')); } catch (e) { j = {}; }
      if (r.codigo === 429 && intento === 0) {
        const espera = (j.parameters && j.parameters.retry_after) || 2;
        await new Promise((ok) => setTimeout(ok, Math.min(espera, 8) * 1000));
        continue;
      }
      return j;
    }
    return {};
  }

  /** Cifra la foto y la manda al chat. Devuelve { fileId, mensajeId }. */
  async subir(ruta, foto) {
    if (!this.configurado()) throw new Error('Telegram no está configurado en esta versión de la app');
    const cifrado = this.cifrar(foto, ruta);
    const limite = '----OTTRACSA' + crypto.randomUUID().replace(/-/g, '');
    const cuerpo = Buffer.concat([
      Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${this.chat}\r\n`),
      Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="document"; filename="${crypto.randomUUID()}.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      cifrado,
      Buffer.from(`\r\n--${limite}--\r\n`)
    ]);
    const j = await this._api('sendDocument', cuerpo, `multipart/form-data; boundary=${limite}`);
    const res = j.result || {};
    const fileId = (res.document && res.document.file_id) || '';
    if (!j.ok || !fileId) throw new Error('Telegram rechazó el archivo: ' + (j.description || 'sin detalle'));
    return { fileId, mensajeId: res.message_id || 0 };
  }

  /** Baja el archivo cifrado y lo descifra. */
  async bajar(fileId, ruta) {
    if (!this.configurado()) throw new Error('Telegram no está configurado en esta versión de la app');
    const j = await this._api('getFile', Buffer.from(JSON.stringify({ file_id: fileId })), 'application/json');
    const rutaTg = (j.result && j.result.file_path) || '';
    if (!j.ok || !rutaTg) throw new Error('Telegram no encontró el archivo: ' + (j.description || 'sin detalle'));
    const r = await this._http('GET', `${this.base}/file/bot${this.token}/${rutaTg}`);
    if (r.codigo !== 200) throw new Error(`No se pudo bajar de Telegram (${r.codigo})`);
    return this.descifrar(r.cuerpo, ruta);
  }

  /** Intenta borrar el mensaje; Telegram solo deja borrar mensajes recientes. */
  async borrar(mensajeId) {
    if (!this.configurado() || !(mensajeId > 0)) return;
    await this._api('deleteMessage', Buffer.from(JSON.stringify({ chat_id: this.chat, message_id: mensajeId })), 'application/json');
  }
}

module.exports = { Telegram };
