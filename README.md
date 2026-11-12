# PhotoBatch

Aplicación local para organizar tandas de fotos, proponer copies con Ollama y limpiar etiquetas editables de videos. Electron 44, Node 24, ExifTool y fflate.

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
