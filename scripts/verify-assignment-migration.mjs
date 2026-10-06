import assert from 'node:assert/strict';
import { DatabaseSync, backup } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { config } from 'dotenv';

// Run with the store API stopped: first backup, then migrate deploy, then --verify <backup>.
config({ path: resolve('.env'), quiet: true });
const configured = process.env.DATABASE_URL || 'file:./dev.db';
const local = /^file:\.\/([^/?]+\.db)$/.exec(configured);
assert.ok(local, 'Esta ferramenta exige um SQLite local na pasta Prisma.');
const databasePath = resolve('apps/api/prisma', local[1]);
const current = new DatabaseSync(databasePath, { readOnly: true });
const args = process.argv.slice(2), phase = args.includes('--phase') ? args[args.indexOf('--phase') + 1] : 'phase3d2b';
assert.ok(['phase3d2b', 'phase3d2c'].includes(phase), 'Fase de backup inválida.');
try {
  assert.deepEqual(current.prepare('PRAGMA integrity_check').all().map(row => row.integrity_check), ['ok']);
  assert.equal(current.prepare('PRAGMA foreign_key_check').all().length, 0);
  if (!args.includes('--verify')) {
    const target = resolve(dirname(databasePath), `backup-${phase}-before-${new Date().toISOString().replace(/[:.]/g, '')}.db`);
    await backup(current, target);
    console.info(`Backup íntegro criado: ${target}`);
  } else {
    const target = resolve(args[args.indexOf('--verify') + 1] || '');
    assert.equal(dirname(target), dirname(databasePath), 'Backup deve estar na pasta Prisma local.');
    assert.ok(target.endsWith('.db') && target.includes(`backup-${phase}-before-`), 'Nome de backup incompatível com fase.');
    const previous = new DatabaseSync(target, { readOnly: true });
    try {
      const tables = previous.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations' ORDER BY name").all();
      const quote = name => `"${name.replaceAll('"', '""')}"`;
      for (const { name } of tables) {
        const columns = previous.prepare(`PRAGMA table_info(${quote(name)})`).all().map(row => quote(row.name)).join(',');
        const query = `SELECT ${columns} FROM ${quote(name)} ORDER BY rowid`;
        assert.deepEqual(current.prepare(query).all(), previous.prepare(query).all(), `Dados anteriores alterados: ${name}`);
      }
      console.info(`${tables.length} tabelas: todos os valores das colunas anteriores preservados; integrity_check=ok; foreign_key_check sem violações.`);
    } finally { previous.close(); }
  }
} finally { current.close(); }
