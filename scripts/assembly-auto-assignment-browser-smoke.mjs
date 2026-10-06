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
const webOrigin = 'http://127.0.0.1:5181';
await withIsolatedApi(3350, async ({ prisma, apiOrigin }) => {
  const web = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5181', '--strictPort'], {
    cwd: resolve('apps/web'), env: { ...process.env, VITE_API_URL: apiOrigin }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    await new Promise((done, reject) => {
      const timeout = setTimeout(() => reject(new Error('Vite isolado não iniciou')), 10000);
      web.once('exit', code => { clearTimeout(timeout); reject(new Error(`Vite encerrou: ${code}`)); });
      web.stdout.on('data', data => { if (String(data).includes('5181')) { clearTimeout(timeout); done(); } });
      web.stderr.on('data', data => { clearTimeout(timeout); reject(new Error(String(data))); });
    });
    const pages = [], contexts = [], errors = [];
    for (let index = 0; index < 3; index++) {
      const context = await browser.newContext({ viewport: { width: index === 0 ? 1024 : 1280, height: index === 0 ? 768 : 900 }, hasTouch: true });
      contexts.push(context); const page = await context.newPage(); pages.push(page); page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${webOrigin}/kitchen/assembly`); await loginPin(page, operatorFixtures[index].pin);
      assert.equal(await page.getByRole('button', { name: 'Minhas pizzas', exact: true }).getAttribute('aria-pressed'), 'true');
      await page.getByRole('heading', { name: 'Nenhuma pizza neste filtro', exact: true }).waitFor();
      await page.getByLabel('Conexão Assembly', { exact: true }).getByText('Online', { exact: true }).waitFor();
    }
    const sessions = await prisma.operatorSession.findMany({ where: { active: true }, include: { operator: true } });
    const actors = operatorFixtures.map(operator => sessions.find(session => session.operator.name === operator.name));
    const form = await contexts[0].newPage(); form.on('pageerror', error => errors.push(error.message));
    async function create(customer, count) {
      await form.goto(`${webOrigin}/orders/new`); await form.getByLabel('Cliente *').fill(customer);
      for (let index = 1; index < count; index++) await form.getByRole('button', { name: '+ Adicionar pizza', exact: true }).click();
      await form.getByRole('button', { name: 'Criar pedido →', exact: true }).click(); await form.getByRole('heading', { name: /aguardando montagem/ }).waitFor();
      return (await (await form.request.get(`${apiOrigin}/orders/v2`)).json()).find(order => order.customerName === customer);
    }
    async function loads() {
      const groups = await prisma.pizzaItem.groupBy({ by: ['assignedOperatorId'], where: { assignedOperatorId: { not: null }, state: { in: ['WAITING_ASSEMBLY', 'ASSEMBLING', 'ASSEMBLY_PAUSED'] } }, _count: { _all: true } });
      return actors.map(actor => groups.find(group => group.assignedOperatorId === actor.operatorId)?._count._all ?? 0);
    }
    const first = await create('Distribuição três tablets', 9);
    assert.deepEqual(await loads(), [3, 3, 3]); assert.equal(new Set(first.items.map(pizza => pizza.id)).size, 9);
    const screenshots = resolve(tmpdir(), 'guigs-auto-assignment-validation'); mkdirSync(screenshots, { recursive: true });
    for (const [index, page] of pages.entries()) {
      await page.getByRole('heading', { name: `Pedido #${first.number}`, exact: true }).waitFor({ timeout: 5000 });
      await page.waitForFunction(() => document.querySelectorAll('.ka-pizza-card').length === 3);
      const shown = first.items.filter(pizza => pizza.assignment.operatorId === actors[index].operatorId);
      for (const pizza of shown) await page.getByRole('button', { name: new RegExp(`^Pizza ${pizza.position + 1},`) }).waitFor();
      assert.match(await page.locator('.ka-responsibility').innerText(), new RegExp(`${operatorFixtures[index].name}.*Sua pizza`));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: resolve(screenshots, `tablet-${index + 1}.png`) });
    }
    console.info('João/Carlos/Pedro: nove pizzas distribuídas 3/3/3; cada tablet mostra apenas suas três pizzas via realtime.');
    const a = pages[0];
    await a.getByRole('button', { name: 'Iniciar montagem', exact: true }).click();
    await a.getByText('Comando confirmado e salvo.', { exact: true }).waitFor();
    await a.getByRole('button', { name: /Enviar pro forno/ }).click();
    await a.getByText('Montagem confirmada. Pizza aguardando forno.', { exact: true }).waitFor();
    assert.deepEqual(await loads(), [2, 3, 3]);
    const next = await create('Balanceamento progressivo', 4);
    assert.equal(next.items[0].assignment.operatorId, actors[0].operatorId); assert.deepEqual(await loads(), [4, 4, 4]);
    for (const page of pages) await page.waitForFunction(() => document.querySelectorAll('.ka-queue-card').length === 2, null, { timeout: 5000 });
    const events = await prisma.pizzaProductionHistory.findMany({ where: { eventType: 'AUTO_ASSIGNED' } });
    assert.equal(events.length, 13); assert.equal(new Set(events.map(event => event.pizzaId)).size, 13);
    assert.ok(events.every(event => event.actorType === 'SYSTEM' && event.operatorId && event.workstationId && event.operatorSessionId && event.metadata.policy === 'LEAST_PENDING_RANDOM_TIE_V1'));
    console.info('Conclusão da montagem sai da carga; mais quatro pizzas rebalanceiam para 4/4/4, sem duplicação e com AUTO_ASSIGNED.');

    const b = pages[1], availability = page => page.getByRole('button', { name: 'Receber novas pizzas neste tablet', exact: true });
    await availability(b).click(); await b.getByText('Suspenso neste tablet', { exact: true }).waitFor();
    const suspended = await create('Operador suspenso', 3); assert.ok(suspended.items.every(pizza => pizza.assignment.operatorId !== actors[1].operatorId));
    await b.reload(); await b.getByLabel('Identidade operacional', { exact: true }).waitFor(); assert.equal(await availability(b).getAttribute('aria-pressed'), 'false');
    await b.getByRole('button', { name: 'Iniciar montagem', exact: true }).click(); await b.getByText('Comando confirmado e salvo.', { exact: true }).waitFor();
    const selectedId = (await prisma.pizzaItem.findMany({ where: { assignedOperatorId: actors[1].operatorId, state: 'ASSEMBLING' } }))[0].id;
    await b.getByRole('button', { name: 'Pausar', exact: true }).click(); await b.getByRole('button', { name: 'Retomar', exact: true }).waitFor();
    await b.getByRole('button', { name: 'Liberar pizza', exact: true }).click();
    await b.getByRole('button', { name: 'Disponíveis', exact: true }).click(); await b.getByRole('button', { name: 'Assumir pizza', exact: true }).waitFor();
    assert.equal((await prisma.pizzaItem.findUniqueOrThrow({ where: { id: selectedId } })).assignedOperatorId, null);
    await b.getByRole('button', { name: 'Assumir pizza', exact: true }).click(); await b.getByRole('button', { name: 'Minhas pizzas', exact: true }).click();
    await b.getByText('Comando confirmado e salvo.', { exact: true }).waitFor();
    await b.getByRole('heading', { name: `Pedido #${first.number}`, exact: true }).waitFor();
    assert.equal((await prisma.pizzaItem.findUniqueOrThrow({ where: { id: selectedId } })).assignedOperatorId, actors[1].operatorId);
    console.info('Suspender recebimento persiste após refresh e exclui novas atribuições; montagem existente, release e claim manual continuam funcionando.');
    for (const page of [pages[0], pages[2]]) { await availability(page).click(); await page.getByText('Suspenso neste tablet', { exact: true }).waitFor(); }
    const free = await create('Sem operador disponível', 2); assert.ok(free.items.every(pizza => pizza.assignment === null && pizza.production.state === 'WAITING_ASSEMBLY'));
    await availability(a).click(); await a.getByText('Recebendo neste tablet', { exact: true }).waitFor();
    const unchanged = await (await a.request.get(`${apiOrigin}/orders/v2/${free.id}`)).json(); assert.ok(unchanged.items.every(pizza => pizza.assignment === null));
    await a.getByRole('button', { name: 'Disponíveis', exact: true }).click(); await a.getByRole('heading', { name: `Pedido #${free.number}`, exact: true }).waitFor({ timeout: 5000 });
    console.info('Sem elegíveis: pedido criado disponível. Retomar disponibilidade não redistribui pedidos antigos.');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close(); if (web.exitCode === null) { const exited = new Promise(done => web.once('exit', done)); web.kill(); await exited; }
  }
}, { webOrigin, operatorFixtures: true });
