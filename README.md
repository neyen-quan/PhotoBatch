# PhotoBatch

Aplicación local para organizar tandas de fotos, proponer copies con Ollama y limpiar etiquetas editables de videos. Electron 44, Node 24, ExifTool y fflate.

## Desarrollo

- `npm ci`
- `npm test`
- `npm start`

En Windows: `node build/download.mjs`, `npm pack exiftool-vendored.exe@13.59.3 --pack-destination build`, `python build/package.py`. La carpeta `dist/` contiene el ZIP completo portátil. Las dependencias y el runtime no se versionan.

## Actualizaciones

La aplicación consulta `latest.json` de la release más reciente. Cada tag `vX.Y.Z` ejecuta las pruebas, empaqueta el programa Windows y genera un parche incremental contra el tag anterior, con hashes SHA-256. La primera release solo publica el ZIP completo. Se requiere un tag base `v1.2.9` para construir el parche de transición hacia `v1.2.10`.

El botón Actualizar permite buscar, cambiar el canal (HTTPS GitHub), descargar y verificar el parche o instalar un ZIP local. Historial, preferencias y configuración del canal se guardan en `%APPDATA%/PhotoBatch`, fuera del repositorio y de los archivos reemplazados. El worker conserva respaldos y revierte cambios si falla la aplicación. La actualización en Windows debe probarse en un equipo real antes de considerarse validada.

La limpieza de metadatos no garantiza borrar marcas integradas en imagen, audio o pistas de video. Los nombres de archivo no certifican procedencia.

## Versión 1.2.11

Actualización de prueba del canal GitHub desde 1.2.10. No cambia el procesamiento de fotos o videos.
