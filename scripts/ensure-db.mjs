import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const configured = process.env.DATABASE_URL || 'file:./dev.db';
if (configured !== 'file:./dev.db') {
  console.info('Banco configurado externamente; confira se já existe antes de aplicar migrations.');
} else {
  const path = resolve('apps/api/prisma/dev.db');
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) {
    closeSync(openSync(path, 'a'));
    console.info('Arquivo SQLite local criado.');
  }
}
