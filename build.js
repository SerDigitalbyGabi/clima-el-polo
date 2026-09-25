// Arma dist/ para Pages: copia public/ y empaqueta src/ en un solo _worker.js
import { rmSync, mkdirSync, cpSync } from 'node:fs';
import { execSync } from 'node:child_process';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
cpSync('public', 'dist', { recursive: true });
execSync('npx esbuild src/index.js --bundle --format=esm --platform=browser --outfile=dist/_worker.js', { stdio: 'inherit' });
