import {downloadArtifact} from '@electron/get';
import {fileURLToPath} from 'node:url';
console.log(await downloadArtifact({version:'44.9.0',artifactName:'electron',platform:'win32',arch:'x64',cacheRoot:fileURLToPath(new URL('./cache/',import.meta.url))}));
