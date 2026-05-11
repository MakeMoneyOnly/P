import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const src = join(process.cwd(), 'src', 'migrations');
const dest = join(process.cwd(), 'dist', 'migrations');

if (!existsSync(dest)) {
  mkdirSync(dest, { recursive: true });
}

cpSync(src, dest, { recursive: true });
console.log('Migrations copied to dist/migrations');