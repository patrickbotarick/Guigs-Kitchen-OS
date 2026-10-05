import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright-core';

// Own API process and disposable database: never writes test orders into the store database.
const root = resolve('.');
const dbPath = resolve(root, `apps/api/prisma/test-browser-${randomUUID()}.db`);
const databaseUrl = `file:${dbPath.replaceAll('\\', '/')}`;
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
let server;
let browser;
try {
  writeFileSync(dbPath, '');
  const migrations = resolve(root, 'apps/api/prisma/migrations');
  for (const name of readdirSync(migrations).filter(name => /^\d/.test(name)).sort()) {
    for (const sql of readFileSync(resolve(migrations, name, 'migration.sql'), 'utf8').split(';').map(part => part.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(sql);
  }
  await prisma.$disconnect();
  // Startup must belong to this child; EADDRINUSE fails rather than using another API.
  server = spawn(process.execPath, ['apps/api/dist/server.js'], { cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl, PORT: '3333' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('API temporária não iniciou')), 10000);
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`API temporária encerrou: ${code}`)); });
    server.stdout.on('data', chunk => { if (String(chunk).includes('API em')) { clearTimeout(timer); resolveReady(); } });
    server.stderr.on('data', chunk => { clearTimeout(timer); reject(new Error(String(chunk))); });
  });
  const executablePath = [process.env.BROWSER_PATH, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean).find(existsSync);
  assert.ok(executablePath, 'Edge/Chrome necessário');
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [], sent = [];
  let firstResponse;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**:3333/orders/v2', async route => {
    sent.push(route.request().postDataJSON());
    const response = await context.request.fetch(route.request());
    if (sent.length === 1) {
      assert.equal(response.status(), 201); firstResponse = await response.json();
      await route.abort('failed'); // Commit happened, but the tablet lost the response.
    } else {
      assert.equal(response.status(), 200);
      assert.deepEqual(await response.json(), firstResponse);
      await route.fulfill({ response });
    }
  });
  await page.goto('http://127.0.0.1:5173/orders/new');
  await page.getByLabel('Cliente *').fill('Validação v2 isolada');
  await page.getByLabel('Composição da pizza 1', { exact: true }).selectOption('HALF_HALF');
  await page.getByLabel('Sabor — 2ª metade', { exact: true }).selectOption('mussarela');
  await page.locator('.ka-builder-half').first().getByRole('checkbox', { name: 'cebola', exact: true }).uncheck();
  await page.getByLabel('Adicional — 2ª metade', { exact: true }).selectOption('bacon');
  await page.locator('.ka-builder-half').nth(1).getByRole('button', { name: 'Adicionar', exact: true }).click();
  const crust = page.getByLabel('Borda da pizza 1', { exact: true });
  const crustId = await crust.locator('option').nth(1).getAttribute('value');
  await crust.selectOption(crustId);
  await page.getByLabel('Observação da pizza 1', { exact: true }).fill('Cortar em 8');
  await page.getByRole('button', { name: '+ Adicionar pizza', exact: true }).click();
  await page.getByLabel('Tamanho da pizza 2', { exact: true }).selectOption('BROTO');
  assert.equal(await page.getByLabel('Composição da pizza 2', { exact: true }).isDisabled(), true);
  await page.getByLabel('Quantidade — Coca-Cola 2L', { exact: true }).fill('2');
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 1024 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow em ${width}px`);
  }
  await page.getByRole('button', { name: 'Criar pedido →', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar envio novamente', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Confirmar envio novamente', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Cliente *').inputValue(), 'Validação v2 isolada');
  assert.equal(await page.getByLabel('Cliente *').isDisabled(), true, 'Payload incerto deve ficar preservado');
  await page.getByRole('button', { name: 'Confirmar envio novamente', exact: true }).click();
  await page.getByRole('heading', { name: /aguardando montagem/ }).waitFor();
  assert.equal(sent.length, 2); assert.deepEqual(sent[0], sent[1]);
  const [pizza, broto, extra] = firstResponse.items;
  assert.equal(pizza.recipe.composition, 'HALF_HALF'); assert.equal(pizza.snapshot.notes, 'Cortar em 8');
  assert.equal(pizza.snapshot.firstHalf.ingredients.find(item => item.ingredientId === 'cebola').kind, 'REMOVED');
  assert.equal(pizza.recipe.secondHalf.modifiers[0].ingredientId, 'bacon');
  assert.equal(pizza.recipe.crustId, crustId); assert.equal(broto.recipe.size, 'BROTO');
  assert.equal(extra.quantity, 2); assert.equal(extra.snapshot.name, 'Coca-Cola 2L');
  assert.deepEqual(errors, []);
  await prisma.$connect();
  assert.equal(await prisma.order.count({ where: { schemaVersion: 2 } }), 1);
  assert.equal(await prisma.pizzaProductionHistory.count(), 2);
  await browser.close(); browser = null;
  const legacy = await promisify(execFile)(process.execPath, ['scripts/browser-smoke.mjs'], { cwd: root, windowsHide: true });
  console.info(legacy.stdout.trim());
  console.info('Balcão v2 validado: meio a meio, modificadores, borda, Broto, extras, tablet/mobile e resposta perdida seguida de refresh e replay sem duplicação; banco temporário isolado.');
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) {
    const exited = new Promise(resolveExit => server.once('exit', resolveExit));
    server.kill(); await exited;
  }
  await prisma.$disconnect();
  for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });
}
