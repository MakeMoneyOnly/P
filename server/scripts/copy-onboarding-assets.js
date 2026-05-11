import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const src = join(process.cwd(), 'src', 'onboarding-assets');
const dest = join(process.cwd(), 'dist', 'onboarding-assets');

if (!existsSync(dest)) {
  mkdirSync(dest, { recursive: true });
}

cpSync(src, dest, { recursive: true });
console.log('Onboarding assets copied to dist/onboarding-assets');