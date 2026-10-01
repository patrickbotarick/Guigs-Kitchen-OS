import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from 'dotenv';

config({ path: resolve('.env') });
const configured = process.env.DATABASE_URL || 'file:./dev.db';
const local = /^file:\.\/([^/?]+\.db)(?:\?.*)?$/.exec(configured);
if (!local) {
  console.info('Banco fora da pasta Prisma; crie-o antes de aplicar migrations.');
} else {
  const path = resolve('apps/api/prisma', local[1]);
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) {
    closeSync(openSync(path, 'a'));
    console.info('Arquivo SQLite local criado.');
  }
}
