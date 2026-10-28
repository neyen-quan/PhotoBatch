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
