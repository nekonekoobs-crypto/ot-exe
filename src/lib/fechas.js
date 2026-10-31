// Fechas de las OT. Port de Fechas.kt. Funciona en Node y en el navegador.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Fechas = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  const FECHA_RX = /(\d{1,2})\s*[\/\-.]\s*(\d{1,2}|[A-ZÁÉÍÓÚ]{3,10})\s*[\/\-.]\s*(\d{2,4})/;

  /** Devuelve [día, mes, año] o null si el texto no es una fecha. Entiende "20/10/2026" y "13/ENERO/2027". */
  function fechaAPartes(s) {
    const m = FECHA_RX.exec(String(s).toUpperCase());
    if (!m) return null;
    const dia = parseInt(m[1], 10);
    const mesTxt = m[2];
    let mes = /^\d+$/.test(mesTxt) ? parseInt(mesTxt, 10) : MESES.indexOf(mesTxt.slice(0, 3)) + 1;
    let anio = parseInt(m[3], 10);
    if (isNaN(dia) || isNaN(anio)) return null;
    if (anio < 100) anio += 2000;
    if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
    return [dia, mes, anio];
  }

  const p2 = (n) => String(n).padStart(2, '0');

  /** Deja la fecha siempre como dd/MM/aaaa. Si no es una fecha reconocible, regresa el texto igual. */
  function normalizarFecha(s) {
    const p = fechaAPartes(s);
    if (!p) return String(s).trim();
    return p2(p[0]) + '/' + p2(p[1]) + '/' + String(p[2]).padStart(4, '0');
  }

  return { fechaAPartes, normalizarFecha };
});
