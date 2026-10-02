// Arma dist/ para Pages: copia public/ y empaqueta src/ en un solo _worker.js
import { rmSync, mkdirSync, cpSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

// Se vacía dist/ en vez de borrarla: si se borra la carpeta, `wrangler pages dev`
// deja de vigilarla y el servidor local sigue corriendo el código viejo.
mkdirSync('dist', { recursive: true });
for (const f of readdirSync('dist')) rmSync(`dist/${f}`, { recursive: true, force: true });
cpSync('public', 'dist', { recursive: true });
execSync('npx esbuild src/index.js --bundle --format=esm --platform=browser --outfile=dist/_worker.js', { stdio: 'inherit' });
