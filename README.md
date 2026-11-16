# PhotoBatch

Aplicación local para organizar tandas de fotos y limpiar etiquetas editables de videos. Electron 44, Node 24, ExifTool y fflate.

## Cuenta y numeración compartida (1.4.0)

Actualizá desde **Actualizar programa → Buscar actualizaciones → Descargar e instalar**.
En **Iniciar sesión → Crear cuenta**, usá el correo con el que administrás el proyecto
Supabase PhotoBatch y una contraseña propia de PhotoBatch (mínimo 10 caracteres).
El servicio de correo predeterminado de Supabase solo envía a miembros del proyecto;
para otros usuarios hay que configurar SMTP. No hay credenciales de administrador en la app.

En el correo de confirmación, copiá el enlace del botón y pegalo en **Confirmar correo
o recuperar contraseña → Enlace del correo → Confirmar enlace** dentro de PhotoBatch.
Si ya abriste el enlace y confirmaste el correo, ingresá con tu contraseña. La misma
pantalla permite solicitar recuperación y verificar el enlace con una contraseña nueva.
La cuenta de la aplicación es independiente del acceso al panel de Supabase.

Al ingresar o volver a abrir, la app incorpora el mayor entre su historial de fotos,
su contador local de videos y los valores de la cuenta. En **Mi cuenta** podés indicar
el próximo inicio (por ejemplo, 1700) y sincronizar manualmente. Solo se admite avanzar.
En otro equipo, actualizá antes de trabajar e ingresá con **la misma cuenta**; se
incorpora automáticamente su numeración local si es mayor. Las versiones anteriores
a 1.4.0 siguen usando contadores locales y no deben usarse para exportar en paralelo.

Fotos consume el rango completo seleccionado (1700 + 100 reserva hasta 1799, aunque
solo exportes algunas fotos). Videos conserva su contador `clip_…` separado. Los
nombres de video mostrados antes de exportar son estimados y se confirman al guardar.
Se requiere Internet para reservar la numeración antes de publicar cada ZIP. Si otro
equipo ganó ese rango, la exportación se rechaza y se solicita sincronizar. Un corte
después de reservar puede dejar números sin usar: se conservan reservados para evitar
duplicados. Recuperar la PC después no puede detectar ni corregir duplicados creados
previamente por versiones locales sin conocer su historial.

Solo se suben contadores y reservas numéricas vinculados al usuario. Fotos, videos,
rutas, nombres y comprobaciones detalladas quedan en cada equipo. La sesión se cifra
con el almacenamiento seguro del sistema (Windows DPAPI); nunca se guarda la contraseña.
Si no hay almacenamiento seguro, la sesión dura hasta cerrar y la app lo informa.
Cerrar sesión solo desconecta ese equipo. El respaldo de Historial sigue conteniendo
los comprobantes locales de fotos; no incluye archivos ni credenciales.

Backend exclusivo: `rkuaogjbzuwxprkaxugd` (sin dependencias de Calendario Rina).
`supabase/schema.sql` corresponde a la migración aplicada `shared_counters_v1`.
Los clientes tienen SELECT bajo RLS; las escrituras se hacen por RPC, con propietario
obtenido de `auth.uid()`, límites, bloqueo de fila e idempotencia por solicitud.
El proceso principal hace las solicitudes HTTPS; el renderer no recibe tokens ni
tiene acceso de red. Se conserva el formato de historial existente.

Verificación: `npm test` incluye fallos de conexión, sesiones, dos equipos, reintentos,
y exportaciones reales que no publican ZIP si la nube rechaza la reserva.
`node tests/layout-ui.cjs` usa un transporte simulado instalado únicamente por
`tests/launch-ui.cjs` (no se distribuye); comprueba login, avance, logout, sincronización,
exportación y diseño. En Windows también comprueba restauración de la sesión cifrada.
`tests/cloud-database.sql` ejecuta los cuerpos desplegados sobre tablas temporales
sin tocar cuentas de Auth ni datos de trabajo, y revierte todo al terminar.
La entrega de correo y el primer inicio con una cuenta real requieren la confirmación
del titular; no se simula que ese paso personal ya esté realizado.

## Desarrollo

- `npm ci`
- `npm test`
- `npm start`

En Windows: `node build/download.mjs`, `npm pack exiftool-vendored.exe@13.59.3 --pack-destination build`, `python build/package.py`. La carpeta `dist/` contiene el ZIP completo portátil. Las dependencias y el runtime no se versionan.

## Actualizaciones

La aplicación consulta `latest.json` de la release más reciente. Para publicar una versión, incrementá `version` en `package.json` y `package-lock.json`, comprobá el código y subí el commit a `main`. GitHub Actions comprueba si existe `vX.Y.Z`, ejecuta las pruebas en Windows, empaqueta la aplicación, genera el parche contra el tag anterior y crea el tag y la release con el ZIP completo, el parche y `latest.json` con SHA-256. Los commits que mantienen la misma versión no vuelven a publicar. El disparo manual con `release_tag` queda para recuperar una publicación fallida de un tag existente.

El botón Actualizar permite buscar, cambiar el canal (HTTPS GitHub), descargar y verificar el parche o instalar un ZIP local. Historial, preferencias y configuración del canal se guardan en `%APPDATA%/PhotoBatch`, fuera del repositorio y de los archivos reemplazados. El worker conserva respaldos y revierte cambios si falla la aplicación. La actualización online 1.2.10 → 1.2.11 se probó en Windows: reinicio y nueva búsqueda con “Ya tenés la última versión”.

La limpieza de metadatos no garantiza borrar marcas integradas en imagen, audio o pistas de video. Los nombres de archivo no certifican procedencia.

## Versión 1.2.11

Actualización de prueba del canal GitHub desde 1.2.10. No cambia el procesamiento de fotos o videos.

## Versión 1.2.12

Verificación de publicación automática desde `main` y actualización online desde 1.2.11.

## Versión 1.2.13

Los videos se exportan con nombres ascendentes desde `clip_14099`. PhotoBatch guarda la numeración de videos localmente y la retoma al volver a abrir el programa.

### Videos: fecha y nombre automático (1.2.16)

En Videos, elegí la fecha, Desde/Hasta y la zona horaria. Cada video recibe un horario diferente dentro del intervalo, en el orden de las tarjetas. La numeración mantiene su contador existente. La limpieza escribe y verifica las fechas de QuickTime en UTC y CreationDate con el desfase de la zona elegida, sin recomprimir audio ni video. La fecha de modificación dentro del ZIP usa la fecha/hora elegida (el formato ZIP tiene precisión de dos segundos).

Sin nombre personalizado, se guarda `Reel (DD-MM-AAAA).zip`; con nombre, se respeta el texto escrito. Si existe, se agrega un sufijo para conservar ambos archivos. Los campos de Videos son independientes de Fotos durante la sesión; al abrir se inicializan con la última fecha y franja guardadas de Fotos.

La fixture `tests/fixtures/video.mp4.base64` es un video sintético de 16×16 con audio silencioso generado con FFmpeg; no contiene archivos de trabajo. Las pruebas leen los metadatos del video exportado real con ExifTool.

### Vista compacta (1.2.17)

Fotos y Videos adaptan las dos filas a la altura disponible. Fecha y zona horaria comparten una fila, con los botones de exportación visibles en la ventana de escritorio. Se retiraron la interfaz de ideas, sus canales IPC y la inicialización de Ollama. Los datos anteriores de preferencias de copy no se borran.

## Versión 1.3.0

Interfaz renovada con navegación superior de Fotos y Videos, tarjetas adaptables y exportación accesible en ventanas de escritorio. La edición de configuración conserva las miniaturas y el foco. Los controles se bloquean durante las operaciones y el pegado respeta el tipo de contenido seleccionado.

La importación de videos es atómica y la escritura de ZIP gestiona correctamente la contrapresión del disco. El cálculo de fechas reutiliza un formateador de zona horaria por tanda. Se conserva el formato existente del historial y del contador de videos.
