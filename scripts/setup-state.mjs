import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';

const root = resolve(import.meta.dirname, '..');
const marker = resolve(root, '.setup-state.json');
const schema = resolve(root, 'apps/api/prisma/schema.prisma');
const migrations = resolve(root, 'apps/api/prisma/migrations');
const files = [resolve(root, 'package-lock.json'), resolve(root, 'package.json'), resolve(root, 'apps/api/package.json'), resolve(root, 'apps/web/package.json'), resolve(root, 'packages/shared/package.json'), schema];
if (existsSync(resolve(root, '.env'))) files.push(resolve(root, '.env'));

function collect(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isDirectory()) collect(path);
    else files.push(path);
  }
}
collect(migrations);
files.sort();
const digest = createHash('sha256');
for (const file of files) { digest.update(file); digest.update(readFileSync(file)); }
const fingerprint = digest.digest('hex');
const configured = existsSync(resolve(root, '.env')) ? parse(readFileSync(resolve(root, '.env'))).DATABASE_URL : 'file:./dev.db';
const local = /^file:\.\/([^/?]+\.db)(?:\?.*)?$/.exec(configured || '');
const ready = Boolean(local && existsSync(resolve(root, 'apps/api/prisma', local[1])) && existsSync(resolve(root, 'node_modules/.prisma/client/default.js')));

if (process.argv[2] === 'mark') {
  if (!ready) throw new Error('Prisma Client ou banco local ausente após o setup.');
  writeFileSync(marker, JSON.stringify({ fingerprint }, null, 2));
  console.info('Setup registrado.');
} else if (process.argv[2] === 'check') {
  let current = null;
  try { current = existsSync(marker) ? JSON.parse(readFileSync(marker, 'utf8')) : null; } catch { /* Setup novamente se o marcador estiver corrompido. */ }
  if (!ready || current?.fingerprint !== fingerprint) {
    console.info('Setup necessário: dependências, schema ou migrations mudaram.');
    process.exitCode = 1;
  } else {
    console.info('Setup já aplicado; Prisma Client e banco preservados.');
  }
} else {
  console.error('Uso: node scripts/setup-state.mjs check|mark');
  process.exitCode = 2;
}
