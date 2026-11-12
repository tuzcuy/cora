// Copies the LiteSpeed .htaccess into the exported out/ folder after `next build`.
import { copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

if (!existsSync('out')) {
  console.error('out/ yok — next build (output: export) çalıştı mı?');
  process.exit(1);
}
await copyFile('scripts/htaccess', 'out/.htaccess');
console.log('✓ .htaccess -> out/.htaccess');
