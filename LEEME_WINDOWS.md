# OT TRACSA para Windows (.exe)

Misma app que la de Android, con la plantilla **Gentelella en modo oscuro** (hay botón para pasar a claro).
Usa **la misma base de datos de Supabase y el mismo chat de Telegram**, así que lo que captura un almacenista en el teléfono lo ve el de la computadora y al revés.

## Qué incluye (igual que Android)
- Piezas con estados Alta (verde), Baja (rojo), Préstamo (amarillo), Devolución (azul), Sobrante (café); un solo estado a la vez.
- Descripción y foto en Préstamo, foto de salida en Baja, descripción en Devolución. Fotos comprimidas (1280 px, ~250 KB). Visor con botón Eliminar y confirmación.
- Lista de OT con totales (altas, bajas, préstamos, devoluciones, sobrantes), casilla **Baja de OT** (OT en rojo, con confirmación) y borrar OT.
- Encabezado plegable, campo **Razón social**, búsqueda de OT y de piezas, agregar/borrar piezas.
- Captura por **foto (cámara web o archivo)**, **Excel, Word y PDF** con OCR, pantalla de revisión (dividir, unir, enumerar).
- Exportar a **Excel** con los mismos colores y columna OBSERVACIONES.
- Usuarios: aprobar, rechazar y quitar acceso. Almacenista restringido (ixtac.remolques@tracsatlax.com.mx) solo modifica sus OT.
- Fotos **cifradas en Telegram** (AES-256-GCM, compatibles con la app de Android). Sincronización automática cada minuto.
- Copia de seguridad cada 15 días y a pedido (carpeta *Documentos\OT TRACSA*), con restauración. **Las copias son intercambiables con Android** (mismo .zip).
- Inicio de sesión con **correo y contraseña** y con **Google** (se abre el navegador).

## Cómo obtener el .exe (sin instalar nada en tu PC)
1. En GitHub crea un repositorio nuevo (por ejemplo `ot-tracsa-windows`) y sube **todo el contenido de esta carpeta** (incluida la carpeta oculta `.github`). Si el repositorio es el mismo del Android, súbelo en una carpeta aparte; entonces mueve `.github/workflows/build-windows.yml` al `.github/workflows` de la raíz y agrega a cada paso `working-directory: <carpeta>`; lo más sencillo es usar un repositorio nuevo.
2. En el repositorio: **Settings → Secrets and variables → Actions → New repository secret** y crea los mismos tres que ya usas en Android:
   - `TG_BOT_TOKEN`
   - `TG_CHAT_ID`
   - `TG_FOTOS_KEY`  (**debe ser exactamente la misma llave** que usa la app de Android; si no, cada app no podrá abrir las fotos de la otra)
3. Pestaña **Actions → Build OT TRACSA (Windows) → Run workflow**. Tarda unos 5 a 10 minutos.
4. Al terminar, abre la ejecución y baja el artefacto **OT_TRACSA_Windows** (es un zip; dentro está `OT_TRACSA_Setup.exe`).
5. Ejecuta el instalador. Windows puede mostrar "Windows protegió su PC" porque el instalador no está firmado: **Más información → Ejecutar de todas formas**.

## Para que funcione "Continuar con Google"
En Supabase → **Authentication → URL Configuration → Redirect URLs** agrega:
`http://127.0.0.1:*/callback`  (si Supabase no lo acepta, usa `http://127.0.0.1:**`)

Además comprueba que en **Authentication → Providers → Google** esté activado y con el *Client ID* y el *Client secret* del cliente tipo **Web** de Google Cloud, y que en Google Cloud ese cliente tenga como URI de redireccionamiento autorizado:
`https://rrxwhelqvbxiwqfcpwus.supabase.co/auth/v1/callback`
(La app de Android entra con otro método y solo ocupaba el Client ID; el navegador sí necesita el secret.)
Quien entre por primera vez queda "Por aprobar" hasta que un almacenista lo apruebe en **Dar de alta usuarios**.

## Uso en una PC de pruebas (opcional)
Si quieres probar sin compilar, crea `%APPDATA%\OT TRACSA\config.json` con:
```json
{ "TG_BOT_TOKEN": "...", "TG_CHAT_ID": "...", "TG_FOTOS_KEY": "..." }
```
y ejecuta `npm install` y `npm start` (requiere Node 20).

## Qué se probó y qué no (para ser claros)
Probado aquí de forma automática: la lógica completa (modelos, fusión de piezas repetidas, zip, Excel, importación de Excel/Word, cifrado y envío a Telegram, sincronización con Supabase incluyendo almacenista restringido, lector, borrados, sin conexión, respaldos, PKCE de Google) con servidores falsos, y la interfaz completa en Chromium (login, importar, revisión, estados y colores, fotos, baja de OT, usuarios, copias, tema claro, PDF con pdf.js).
**No pude probar en Windows**: el empaquetado con electron-builder, el instalador, la cámara web real, el OCR real de tesseract.js dentro de la app instalada (aquí lo simulé con líneas de texto) ni el inicio de sesión real con Google. Si algo falla en tu PC, mándame el mensaje y lo corrijo.
Nota de OCR: lee con idioma español de Tesseract, que no es el mismo motor que ML Kit del teléfono; en fotos difíciles puede equivocarse más, por eso existe la pantalla de revisión.
