import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { seedOperatorFixtures } from './operator-fixtures.mjs';

export async function withIsolatedApi(port, run, { webOrigin, operatorFixtures = false, serverEnv = {} } = {}) {
  const root = resolve('.');
  const dbPath = resolve(root, `apps/api/prisma/test-assembly-read-${randomUUID()}.db`);
  const databaseUrl = `file:${dbPath.replaceAll('\\', '/')}`;
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  let server;
  async function stop() {
    if (server && server.exitCode === null) {
      const exited = new Promise(done => server.once('exit', done)); server.kill(); await exited;
    }
  }
  async function start() {
    server = spawn(process.execPath, ['apps/api/dist/server.js'], { cwd: root, env: { ...process.env, ...serverEnv, ...(webOrigin ? { WEB_ORIGIN: webOrigin } : {}), DATABASE_URL: databaseUrl, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    await new Promise((ready, reject) => {
      const timer = setTimeout(() => reject(new Error('API isolada não iniciou')), 10000);
      server.once('exit', code => { clearTimeout(timer); reject(new Error(`API isolada encerrou: ${code}`)); });
      server.stdout.on('data', chunk => { if (String(chunk).includes('API em')) { clearTimeout(timer); ready(); } });
      server.stderr.on('data', chunk => { clearTimeout(timer); reject(new Error(String(chunk))); });
    });
  }
  try {
    writeFileSync(dbPath, '');
    const migrations = resolve(root, 'apps/api/prisma/migrations');
    for (const directory of readdirSync(migrations).filter(name => /^\d/.test(name)).sort()) {
      for (const sql of readFileSync(resolve(migrations, directory, 'migration.sql'), 'utf8').split(';').map(part => part.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(sql);
    }
    if (operatorFixtures) await seedOperatorFixtures(prisma);
    await prisma.$disconnect();
    await start();
    await run({ prisma, apiOrigin: `http://127.0.0.1:${port}`, stop, start, restart: async () => { await stop(); await start(); } });
  } finally {
    await stop();
    await prisma.$disconnect();
    for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });
  }
}
