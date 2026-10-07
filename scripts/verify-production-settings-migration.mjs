import assert from 'node:assert/strict';
import { DatabaseSync, backup } from 'node:sqlite';
import { readFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';

config({ path: resolve('.env'), quiet: true });
const file = /^file:\.\/([^/?]+\.db)$/.exec(process.env.DATABASE_URL || 'file:./dev.db');
assert.ok(file, 'SQLite local necessário.');
const livePath = resolve('apps/api/prisma', file[1]), originalPath = resolve(process.argv[2] || '');
assert.equal(dirname(originalPath), dirname(livePath));
assert.ok(originalPath.includes('backup-round2b-before-') && originalPath.endsWith('.db'));
const copyPath = resolve(dirname(livePath), `test-round2b-migration-${randomUUID()}.db`);
const original = new DatabaseSync(originalPath, { readOnly: true }), live = new DatabaseSync(livePath, { readOnly: true });
let copy;
try {
  await backup(original, copyPath); copy = new DatabaseSync(copyPath);
  copy.exec(readFileSync(resolve('apps/api/prisma/migrations/20261007170000_production_settings/migration.sql'), 'utf8'));
  const tables = original.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations' ORDER BY name").all();
  const quote = name => `"${name.replaceAll('"', '""')}"`; let heartbeats = 0;
  for (const { name } of tables) {
    const columns = original.prepare(`PRAGMA table_info(${quote(name)})`).all().map(row => row.name);
    const query = `SELECT ${columns.map(quote).join(',')} FROM ${quote(name)} ORDER BY rowid`;
    const before = original.prepare(query).all(), migrated = copy.prepare(query).all(), current = live.prepare(query).all();
    assert.ok(JSON.stringify(before) === JSON.stringify(migrated), `Migration alterou dados da tabela ${name}`);
    assert.equal(current.length, before.length, `Quantidade alterada: ${name}`);
    for (let index = 0; index < before.length; index++) for (const column of columns) if (current[index][column] !== before[index][column]) {
      // Backup was captured while the old API was still running. Its final heartbeat
      // preceded shutdown/migration; no other operational delta is accepted here.
      assert.ok(name === 'OperatorSession' && column === 'lastSeenAt' && current[index][column] >= before[index][column], `Diferença inesperada em ${name}.${column}`);
      heartbeats++;
    }
  }
  for (const db of [copy, live]) {
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
    assert.equal(db.prepare("SELECT autoOvenEntry FROM ProductionStationSettings WHERE stationKey='PRODUCTION'").get().autoOvenEntry, 1);
  }
  console.info(`${tables.length} tabelas preservadas integralmente na cópia migrada; banco local íntegro, somente ${heartbeats} heartbeats posteriores ao backup; preferência inicial automática.`);
} finally {
  copy?.close(); original.close(); live.close();
  for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(copyPath + suffix, { force: true });
}
