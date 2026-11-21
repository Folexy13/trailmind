import { createWriteStream, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import JSZip from 'jszip';

const distDir = resolve(process.cwd(), 'dist');
const releaseDir = resolve(process.cwd(), 'release');
mkdirSync(releaseDir, { recursive: true });

const zip = new JSZip();

function addDirToZip(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      addDirToZip(fullPath);
    } else {
      const rel = relative(distDir, fullPath).replace(/\\/g, '/');
      zip.file(rel, readFileSync(fullPath));
    }
  }
}

addDirToZip(distDir);

const outFile = resolve(releaseDir, 'trailmind-chrome-mv3.zip');
await new Promise((resolvePromise, rejectPromise) => {
  zip
    .generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE' })
    .pipe(createWriteStream(outFile))
    .on('finish', resolvePromise)
    .on('error', rejectPromise);
});

console.log(`Packaged extension archive at ${outFile}`);
