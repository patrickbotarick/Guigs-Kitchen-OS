import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { withIsolatedApi } from './helpers/isolated-api.mjs';
import { loginPin, operatorFixtures } from './helpers/operator-fixtures.mjs';

const executablePath = [process.env.BROWSER_PATH, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean).find(existsSync);
assert.ok(executablePath, 'Edge/Chrome necessário');
const webOrigin = 'http://127.0.0.1:5180';
await withIsolatedApi(3349, async ({ prisma, apiOrigin, stop, start }) => {
  const web = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5180', '--strictPort'], {
    cwd: resolve('apps/web'), env: { ...process.env, VITE_API_URL: apiOrigin }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    await new Promise((done, reject) => {
      const timeout = setTimeout(() => reject(new Error('Vite isolado não iniciou')), 10000);
      web.once('exit', code => { clearTimeout(timeout); reject(new Error(`Vite encerrou: ${code}`)); });
      web.stdout.on('data', data => { if (String(data).includes('5180')) { clearTimeout(timeout); done(); } });
      web.stderr.on('data', data => { clearTimeout(timeout); reject(new Error(String(data))); });
    });
    const a = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true }), b = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true });
    const pageA = await a.newPage(), pageB = await b.newPage(), form = await a.newPage();
    const errors = []; for (const page of [pageA, pageB, form]) page.on('pageerror', error => errors.push(error.message));
    let readsA = 0, readsB = 0;
    pageA.on('request', request => { if (request.method() === 'GET' && request.url() === `${apiOrigin}/orders/v2`) readsA++; });
    pageB.on('request', request => { if (request.method() === 'GET' && request.url() === `${apiOrigin}/orders/v2`) readsB++; });
    const online = page => page.getByLabel('Conexão Assembly', { exact: true }).getByText('Online', { exact: true });
    const screenshots = resolve(tmpdir(), 'guigs-operator-validation'); mkdirSync(screenshots, { recursive: true });
    for (const [index, page] of [pageA, pageB].entries()) {
      await page.goto(`${webOrigin}/kitchen/assembly`);
      if (index === 0) {
        await page.getByRole('heading', { name: 'Identifique-se', exact: true }).waitFor();
        for (const digit of '1111') await page.getByRole('button', { name: digit, exact: true }).click();
        assert.equal(await page.getByLabel('PIN do montador', { exact: true }).getAttribute('type'), 'password');
        await page.getByRole('button', { name: 'OK', exact: true }).click(); await page.getByText('PIN inválido ou terminal indisponível.', { exact: true }).waitFor();
        await page.screenshot({ path: resolve(screenshots, 'pin-tablet.png') });
      }
      await loginPin(page, operatorFixtures[index].pin); await online(page).waitFor(); await page.getByRole('heading', { name: 'Nenhum pedido aguardando montagem', exact: true }).waitFor();
    }
    const identities = await prisma.operatorSession.findMany({ where: { active: true }, include: { operator: true, workstation: true } });
    assert.equal(identities.length, 2); assert.notEqual(identities[0].workstationId, identities[1].workstationId);
    for (const [index, page] of [pageA, pageB].entries()) assert.match(await page.getByLabel('Identidade operacional', { exact: true }).innerText(), new RegExp(operatorFixtures[index].name));
    async function create(customer) {
      await form.goto(`${webOrigin}/orders/new`); await form.getByLabel('Cliente *').fill(customer);
      await form.getByRole('button', { name: 'Criar pedido →', exact: true }).click(); await form.getByRole('heading', { name: /aguardando montagem/ }).waitFor();
      const orders = await (await a.request.get(`${apiOrigin}/orders/v2`)).json(); return orders.find(order => order.customerName === customer);
    }
    const order = await create('Realtime balcão');
    for (const page of [pageA, pageB]) await page.getByRole('heading', { name: `Pedido #${order.number}`, exact: true }).waitFor({ timeout: 5000 });
    assert.ok(await pageA.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Identidade deve caber no tablet');
    await pageA.screenshot({ path: resolve(screenshots, 'assembly-identity-tablet.png') });
    async function action(source, target, name, expected) {
      await source.getByRole('button', { name, exact: name !== 'Enviar pro forno' }).click();
      await target.getByRole('button', { name: expected, exact: true }).waitFor({ timeout: 5000 });
    }
    await action(pageA, pageB, 'Iniciar montagem', 'Pausar');
    await action(pageB, pageA, 'Pausar', 'Retomar');
    await action(pageA, pageB, 'Retomar', 'Pausar');
    await pageB.getByRole('button', { name: /Enviar pro forno/ }).click();
    for (const page of [pageA, pageB]) await page.getByRole('heading', { name: 'Nenhum pedido aguardando montagem', exact: true }).waitFor({ timeout: 5000 });
    const saved = await (await a.request.get(`${apiOrigin}/orders/v2/${order.id}`)).json();
    assert.equal(saved.status, 'OVEN'); assert.equal(saved.items[0].production.state, 'WAITING_OVEN'); assert.equal(saved.version, 4);
    assert.equal(await prisma.pizzaCommandReceipt.count({ where: { orderId: order.id } }), 4);
    const history = await prisma.pizzaProductionHistory.findMany({ where: { pizzaId: order.items[0].id }, orderBy: { itemVersion: 'asc' } });
    const joao = identities.find(session => session.operator.name === operatorFixtures[0].name), carlos = identities.find(session => session.operator.name === operatorFixtures[1].name);
    assert.deepEqual(history.slice(1).map(event => [event.operatorId, event.workstationId, event.operatorSessionId]), [joao, carlos, joao, carlos].map(session => [session.operatorId, session.workstationId, session.id]));
    for (const [index, page] of [pageA, pageB].entries()) { await page.reload(); await page.getByLabel('Identidade operacional', { exact: true }).waitFor(); assert.match(await page.getByLabel('Identidade operacional', { exact: true }).innerText(), new RegExp(operatorFixtures[index].name)); }
    assert.equal(await prisma.operatorSession.count(), 2, 'Refresh valida a sessão existente; não cria outra');
    console.info('Balcão → fila imediato e A iniciar → B pausar → A retomar → B enviar aprovados, sem refresh manual.');

    const second = await create('Reconexão real');
    for (const page of [pageA, pageB]) await page.getByRole('heading', { name: `Pedido #${second.number}`, exact: true }).waitFor({ timeout: 5000 });
    await b.setOffline(true); await pageB.getByLabel('Conexão Assembly', { exact: true }).getByText('Offline', { exact: true }).waitFor();
    await pageA.getByRole('button', { name: 'Iniciar montagem', exact: true }).click(); await pageA.getByRole('button', { name: 'Pausar', exact: true }).waitFor();
    const beforeReconnect = readsB; await b.setOffline(false);
    await online(pageB).waitFor(); await pageB.getByRole('button', { name: 'Pausar', exact: true }).waitFor({ timeout: 5000 });
    assert.ok(readsB > beforeReconnect, 'Reconexão deve consultar o servidor após evento perdido');
    console.info('Cliente offline perde START; reconexão faz GET e recupera ASSEMBLING sem replay de eventos.');

    const beforeRestartA = readsA, beforeRestartB = readsB;
    await stop();
    for (const page of [pageA, pageB]) await page.getByLabel('Conexão Assembly', { exact: true }).filter({ hasNotText: /^Online$/ }).waitFor();
    await start();
    for (const page of [pageA, pageB]) { await online(page).waitFor({ timeout: 15000 }); await page.getByRole('button', { name: 'Pausar', exact: true }).waitFor(); }
    // Wait for the mandatory GETs, without manual refresh or 120-second fallback.
    await pageA.waitForFunction(() => !document.querySelector('.ka-queue-footer button')?.disabled);
    await pageB.waitForFunction(() => !document.querySelector('.ka-queue-footer button')?.disabled);
    assert.ok(readsA > beforeRestartA && readsB > beforeRestartB, 'Ambos devem ressincronizar após reinício');
    await action(pageB, pageA, 'Pausar', 'Retomar');
    console.info('API reiniciada no mesmo SQLite: ambos reconectam, consultam estado persistido e retomam realtime.');
    await action(pageA, pageB, 'Retomar', 'Pausar');
    await pageA.getByRole('button', { name: 'Trocar montador', exact: true }).click();
    await pageA.getByText('Há pizzas em montagem. A troca preserva o histórico e não reatribui pedidos.', { exact: true }).waitFor();
    await pageA.getByRole('button', { name: 'Confirmar troca', exact: true }).click();
    await loginPin(pageA, operatorFixtures[1].pin);
    assert.match(await pageA.getByLabel('Identidade operacional', { exact: true }).innerText(), /Carlos fixture/);
    await action(pageA, pageB, 'Pausar', 'Retomar');
    const changedHistory = await prisma.pizzaProductionHistory.findMany({ where: { pizzaId: second.items[0].id }, orderBy: { itemVersion: 'asc' } });
    assert.equal(changedHistory[1].operatorId, joao.operatorId);
    assert.equal(changedHistory.at(-1).operatorId, carlos.operatorId);
    assert.equal(changedHistory.at(-1).workstationId, joao.workstationId);
    assert.notEqual(changedHistory.at(-1).operatorSessionId, joao.id);
    assert.equal((await prisma.operatorSession.findUniqueOrThrow({ where: { id: joao.id } })).active, false);
    assert.deepEqual(await prisma.pizzaProductionHistory.findMany({ where: { pizzaId: order.items[0].id }, orderBy: { itemVersion: 'asc' } }), history, 'Histórico anterior permanece intacto após troca');
    await pageA.reload(); await pageA.getByLabel('Identidade operacional', { exact: true }).waitFor(); assert.match(await pageA.getByLabel('Identidade operacional', { exact: true }).innerText(), /Carlos fixture/);
    const deviceBefore = await pageA.evaluate(() => localStorage.getItem('guigs-workstation-device-key'));
    await pageA.evaluate(() => localStorage.setItem('guigs-operator-session-token', '0'.repeat(64))); await pageA.reload();
    await pageA.getByRole('heading', { name: 'Identifique-se', exact: true }).waitFor();
    assert.equal(await pageA.evaluate(() => localStorage.getItem('guigs-operator-session-token')), null, 'Identidade local forjada deve ser rejeitada pelo backend');
    await loginPin(pageA, operatorFixtures[1].pin);
    assert.equal(await pageA.evaluate(() => localStorage.getItem('guigs-workstation-device-key')), deviceBefore, 'Terminal não muda ao recuperar sessão inválida');
    console.info('João/Carlos em tablets distintos: PIN touch, refresh, operador/terminal/sessão no histórico, aviso em montagem e troca com autoria anterior preservada.');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close(); if (web.exitCode === null) { const exited = new Promise(done => web.once('exit', done)); web.kill(); await exited; }
  }
}, { webOrigin, operatorFixtures: true });
