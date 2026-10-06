import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { withIsolatedApi } from './helpers/isolated-api.mjs';

const executablePath = [process.env.BROWSER_PATH, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean).find(existsSync);
assert.ok(executablePath, 'Edge/Chrome necessário');
const webOrigin = 'http://127.0.0.1:5190';
await withIsolatedApi(3360, async ({ apiOrigin }) => {
  const web = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5190', '--strictPort'], { cwd: resolve('apps/web'), env: { ...process.env, VITE_API_URL: apiOrigin }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    await new Promise((done, reject) => { const timer = setTimeout(() => reject(new Error('Vite não iniciou')), 10000); web.once('exit', code => { clearTimeout(timer); reject(new Error(`Vite encerrou: ${code}`)); }); web.stdout.on('data', data => { if (String(data).includes('5190')) { clearTimeout(timer); done(); } }); web.stderr.on('data', data => { clearTimeout(timer); reject(new Error(String(data))); }); });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${webOrigin}/orders/new`);
    await page.getByLabel('Cliente *').fill('Smoke duplicação 30 pizzas');
    const first = page.locator('.simulator-pizza-card').first();
    for (let count = 1; count < 30; count++) { await first.getByRole('button', { name: 'Duplicar', exact: true }).click(); }
    assert.equal(await page.locator('.simulator-pizza-card').count(), 30);
    await page.locator('.simulator-pizza-card').nth(1).getByRole('button', { name: 'Remover', exact: true }).click();
    assert.equal(await page.locator('.simulator-pizza-card').count(), 29);
    await first.getByRole('button', { name: 'Duplicar', exact: true }).click();
    assert.equal(await page.locator('.simulator-pizza-card').count(), 30);
    await page.getByLabel('Quantidade — Coca-Cola 2L', { exact: true }).fill('2');
    await page.getByRole('button', { name: 'Criar pedido →', exact: true }).click();
    await page.getByRole('heading', { name: /aguardando montagem/i }).waitFor({ timeout: 15000 });
    const orders = await (await page.request.get(`${apiOrigin}/orders/v2`)).json();
    const created = orders.find(order => order.customerName === 'Smoke duplicação 30 pizzas');
    assert.ok(created); assert.equal(created.items.filter(item => item.kind === 'PIZZA').length, 30); assert.equal(created.items.filter(item => item.kind === 'EXTRA')[0].quantity, 2);
    assert.ok(created.items.every(item => item.kind !== 'PIZZA' || item.production.state === 'WAITING_ASSEMBLY'));
    console.info('PASS entrada: cards independentes, duplicar/remover, 30 pizzas, extra estruturado e distribuição inicial persistida.');
  } finally { await browser.close(); if (web.exitCode === null) { const exited = new Promise(done => web.once('exit', done)); web.kill(); await exited; } }
}, { webOrigin });
