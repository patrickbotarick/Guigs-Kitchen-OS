import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
import { withIsolatedApi } from './helpers/isolated-api.mjs';
import { loginPin, operatorFixtures } from './helpers/operator-fixtures.mjs';
import { finishingCorrectionsBrowser } from './helpers/finishing-corrections-browser.mjs';

const executablePath = [process.env.BROWSER_PATH, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean).find(existsSync);
assert.ok(executablePath, 'Edge/Chrome necessário');
const webOrigin = 'http://127.0.0.1:5184';
async function until(check, message, timeout = 15000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; await new Promise(done => setTimeout(done, 100)); } throw new Error(message); }
const pizzaCard = (page, id) => page.locator(`[data-pizza-id="${id}"]`), extraCard = (page, id) => page.locator(`[data-extra-id="${id}"]`);
const headers = page => page.evaluate(() => ({ Authorization: `Bearer ${localStorage.getItem('guigs-operator-session-token')}`, 'X-Workstation-Device-Key': localStorage.getItem('guigs-workstation-device-key') }));
async function clickReady(button) { await button.waitFor(); await until(() => button.isEnabled(), 'Ação não habilitou'); await button.click(); }
await withIsolatedApi(3353, async ({ prisma, apiOrigin, restart }) => {
  const web = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5184', '--strictPort'], { cwd: resolve('apps/web'), env: { ...process.env, VITE_API_URL: apiOrigin }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    await new Promise((done, reject) => { const timer = setTimeout(() => reject(new Error('Vite não iniciou')), 10000); web.once('exit', code => { clearTimeout(timer); reject(new Error(`Vite encerrou ${code}`)); }); web.stdout.on('data', value => { if (String(value).includes('5184')) { clearTimeout(timer); done(); } }); web.stderr.on('data', value => { clearTimeout(timer); reject(new Error(String(value))); }); });
    const contexts = [], pages = [], errors = [], responses = [];
    for (let index = 0; index < 3; index++) {
      const context = await browser.newContext({ viewport: { width: index === 2 ? 1280 : 1024, height: index === 2 ? 800 : 768 }, hasTouch: true }); contexts.push(context); const page = await context.newPage(); pages.push(page);
      page.on('pageerror', error => errors.push(error.message)); page.on('response', response => { if (response.url().endsWith('/finishing/commands')) responses.push({ input: response.request().postDataJSON(), status: response.status() }); });
      await page.goto(`${webOrigin}/kitchen/${index ? 'finishing' : 'assembly'}`); await loginPin(page, operatorFixtures[index].pin);
      if (index) { await page.getByRole('button', { name: 'Receber novas pizzas de montagem', exact: true }).click(); await until(async () => await page.getByRole('button', { name: 'Receber novas pizzas de montagem', exact: true }).getAttribute('aria-pressed') === 'false', 'Não suspendeu montagem'); await page.getByLabel('Conexão Finalização', { exact: true }).getByText('Online', { exact: true }).waitFor(); }
    }
    const [assembly, a, b] = pages, form = await contexts[0].newPage(); await form.goto(`${webOrigin}/orders/new`);
    await form.getByLabel('Cliente *').fill('Finalização integrada'); await form.getByLabel('Observação do pedido', { exact: true }).fill('Conferir identificação');
    for (let count = 0; count < 2; count++) await form.getByRole('button', { name: '+ Adicionar pizza', exact: true }).click();
    await form.getByLabel('Tamanho da pizza 1', { exact: true }).selectOption('BROTO'); await form.getByLabel('Composição da pizza 2', { exact: true }).selectOption('HALF_HALF'); await form.getByLabel('Sabor — 2ª metade', { exact: true }).selectOption('portuguesa');
    await form.getByLabel('Quantidade — Coca-Cola 2L', { exact: true }).fill('1'); await form.getByLabel('Quantidade — Molho extra', { exact: true }).fill('2');
    await form.getByRole('button', { name: 'Criar pedido →', exact: true }).click(); await form.getByRole('heading', { name: /aguardando montagem/ }).waitFor();
    const order = (await (await form.request.get(`${apiOrigin}/orders/v2`)).json()).find(order => order.customerName === 'Finalização integrada'); const pizzas = order.items.filter(item => item.kind === 'PIZZA'), extras = order.items.filter(item => item.kind === 'EXTRA');
    async function finishingClick(page, action) {
      let before;
      await until(async () => { before = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).version; return Number(await page.locator('.finishing-detail').getAttribute('data-order-version')) === before && await action.isEnabled(); }, 'Tablet ainda não reconciliou a conferência anterior');
      await clickReady(action);
      try { await until(async () => (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).version > before, 'Conferência não foi persistida'); }
      catch (error) { console.info({ before, current: (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).version, responses, ui: await page.locator('.finishing-page').innerText() }); throw error; }
    }
    await assembly.getByRole('heading', { name: `Pedido #${order.number}`, exact: true }).waitFor();
    for (const pizza of pizzas) { await assembly.getByRole('button', { name: new RegExp(`^Pizza ${pizza.position + 1},`) }).click(); await clickReady(assembly.getByRole('button', { name: 'Iniciar montagem', exact: true })); await clickReady(assembly.getByRole('button', { name: /Enviar pro forno/ })); await until(async () => (await prisma.pizzaItem.findUniqueOrThrow({ where: { id: pizza.id } })).state === 'WAITING_OVEN', 'Montagem não concluiu'); }
    const oven = await contexts[0].newPage(); await oven.goto(`${webOrigin}/kitchen/oven`); await oven.getByLabel('Conexão Forno', { exact: true }).getByText('Online', { exact: true }).waitFor();
    for (const pizza of pizzas) await clickReady(pizzaCard(oven, pizza.id).getByRole('button', { name: 'Colocar no forno', exact: true }));
    async function remove(index) {
      await clickReady(pizzaCard(oven, pizzas[index].id).getByRole('button', { name: 'Retirar do forno', exact: true }));
      try { for (const page of [a, b]) await until(async () => /Disponível/.test(await pizzaCard(page, pizzas[index].id).innerText()), 'Forno → finalização não propagou'); }
      catch (error) { console.info({ pizza: await prisma.pizzaItem.findUnique({ where: { id: pizzas[index].id }, select: { state: true, version: true } }), oven: await oven.locator('.oven-page').innerText(), finishing: await a.locator('.finishing-page').innerText() }); throw error; }
    }
    await remove(0); for (const page of [a, b]) { await page.getByText('0 / 6 itens conferidos · 1 / 3 pizzas disponíveis', { exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: 'Liberar para despacho', exact: true }).isDisabled(), true); }
    assert.match(await pizzaCard(a, pizzas[0].id).innerText(), /Broto/); assert.match(await pizzaCard(a, pizzas[1].id).innerText(), /Calabresa \/ Portuguesa/);
    await finishingClick(a, pizzaCard(a, pizzas[0].id).getByRole('button', { name: 'Iniciar conferência', exact: true })); await finishingClick(a, pizzaCard(a, pizzas[0].id).getByRole('button', { name: 'Conferir pizza', exact: true })); await remove(1);
    for (const page of [a, b]) await until(() => pizzaCard(page, pizzas[1].id).getByRole('button', { name: 'Iniciar conferência', exact: true }).isEnabled(), 'Conferência concorrente não disponível');
    const before = responses.length; await Promise.all([a, b].map(page => page.evaluate(id => document.querySelector(`[data-pizza-id="${id}"] button`).click(), pizzas[1].id)));
    await until(() => responses.slice(before).length >= 2, 'Dois comandos não chegaram'); assert.deepEqual(responses.slice(before, before + 2).map(response => response.status).sort(), [200, 409]);
    for (const page of [a, b]) await pizzaCard(page, pizzas[1].id).getByRole('button', { name: 'Conferir pizza', exact: true }).waitFor();
    let drop = true; const uncertain = [];
    await a.route('**/finishing/commands', async route => { const request = route.request(), input = request.postDataJSON(); if (input.command === 'CHECK_EXTRA' && input.extraId === extras[0].id) { uncertain.push(input); if (drop) { drop = false; const response = await a.request.fetch(request.url(), { method: request.method(), headers: request.headers(), data: request.postData() }); assert.equal(response.status(), 200); await route.abort('failed'); return; } } await route.continue(); });
    await finishingClick(a, extraCard(a, extras[0].id).getByRole('button', { name: 'Conferir 1 unidade', exact: true })); await a.getByRole('button', { name: 'Confirmar comando novamente', exact: true }).waitFor(); await a.reload(); await a.getByLabel('Conexão Finalização', { exact: true }).getByText('Online', { exact: true }).waitFor(); await clickReady(a.getByRole('button', { name: 'Confirmar comando novamente', exact: true }));
    await until(async () => await a.getByRole('button', { name: 'Confirmar comando novamente', exact: true }).count() === 0, 'Replay não confirmou'); assert.equal(uncertain[0].clientCommandId, uncertain[1].clientCommandId);
    await finishingClick(a, extraCard(a, extras[1].id).getByRole('button', { name: 'Conferir 1 unidade', exact: true })); await until(async () => /1 \/ 2 unidades/.test(await extraCard(b, extras[1].id).innerText()), 'Quantidade parcial não propagou');
    await contexts[2].setOffline(true); await b.getByLabel('Conexão Finalização', { exact: true }).getByText('Offline', { exact: true }).waitFor(); assert.equal(await extraCard(b, extras[1].id).getByRole('button', { name: 'Conferir 1 unidade', exact: true }).isDisabled(), true);
    await finishingClick(a, extraCard(a, extras[1].id).getByRole('button', { name: 'Conferir 1 unidade', exact: true })); await contexts[2].setOffline(false); await b.getByLabel('Conexão Finalização', { exact: true }).getByText('Online', { exact: true }).waitFor(); await until(async () => /2 \/ 2 unidades/.test(await extraCard(b, extras[1].id).innerText()), 'Reconexão não reconciliou extra');
    await remove(2); await finishingClick(b, pizzaCard(b, pizzas[2].id).getByRole('button', { name: 'Iniciar conferência', exact: true })); await finishingClick(a, pizzaCard(a, pizzas[1].id).getByRole('button', { name: 'Conferir pizza', exact: true })); await finishingClick(b, pizzaCard(b, pizzas[2].id).getByRole('button', { name: 'Conferir pizza', exact: true }));
    for (const page of [a, b]) await page.getByText('6 / 6 itens conferidos · 3 / 3 pizzas disponíveis', { exact: true }).waitFor();
    await finishingClick(a, a.getByRole('button', { name: 'Confirmar embalagem', exact: true })); for (const page of [a, b]) await page.getByRole('button', { name: '✓ Embalagem conferida', exact: true }).waitFor();
    await b.reload(); await b.getByRole('button', { name: '✓ Embalagem conferida', exact: true }).waitFor(); await restart(); for (const page of [a, b]) await page.getByLabel('Conexão Finalização', { exact: true }).getByText('Online', { exact: true }).waitFor();
    const shots = resolve(tmpdir(), 'guigs-finishing-validation'); mkdirSync(shots, { recursive: true });
    for (const [page, label] of [[a, '1024x768'], [b, '1280x800']]) { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow ${label}`); assert.ok(await page.getByRole('button', { name: 'Liberar para despacho', exact: true }).evaluate(button => button.getBoundingClientRect().height >= 44)); await page.screenshot({ path: resolve(shots, `finishing-${label}.png`), fullPage: true }); }
    for (const page of [a, b]) await until(() => page.getByRole('button', { name: 'Liberar para despacho', exact: true }).isEnabled(), 'Liberação não habilitou');
    await until(async () => await a.locator('.finishing-detail').getAttribute('data-order-version') === await b.locator('.finishing-detail').getAttribute('data-order-version'), 'Versões não sincronizadas');
    const releaseBefore = responses.length; await Promise.all([a, b].map(page => page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Liberar para despacho').click()))); await until(() => responses.slice(releaseBefore).length >= 2, 'Liberações não chegaram'); assert.deepEqual(responses.slice(releaseBefore, releaseBefore + 2).map(response => response.status).sort(), [200, 409]);
    for (const page of [a, b]) await page.getByText('Nenhum pedido aguardando finalização', { exact: true }).waitFor(); const final = await (await form.request.get(`${apiOrigin}/orders/v2/${order.id}`)).json(); assert.equal(final.status, 'WAITING_DISPATCH'); assert.equal(final.items.filter(item => item.kind === 'PIZZA' && item.production.state === 'FINISHED').length, 3);
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id } }), events = history.filter(event => event.metadata && JSON.parse(event.metadata).event).map(event => JSON.parse(event.metadata)); assert.equal(events.filter(event => event.event === 'RELEASED_TO_DISPATCH').length, 1); assert.equal(events.filter(event => event.event === 'EXTRA_CHECKED').length, 3); assert.ok(events.every(event => event.operatorId && event.operatorSessionId && event.workstationId));
    console.info('PASS: Balcão UI → montagem UI → forno UI → finalização UI, 3 pizzas/Broto/metades + 2 tipos/3 unidades de extras, parcial, autoria, 200/409, replay após resposta perdida, embalagem/release explícitos, refresh/rede/API restart, dois tablets 1024×768 e 1280×800.');
    await finishingCorrectionsBrowser({ form, a, b, oven, prisma, apiOrigin, webOrigin });
    const operationHeaders = await headers(oven);
    for (let index = 0; index < 30; index++) {
      const created = await form.request.post(`${apiOrigin}/orders/v2`, { data: { clientRequestId: randomUUID(), customerName: `Fila finalização ${index + 1}`, fulfillmentType: 'PICKUP', channel: 'COUNTER', pizzas: [{ size: 'GRANDE', composition: 'WHOLE', firstHalf: { flavorId: 'calabresa', modifiers: [] }, crustId: 'tradicional', notes: null }], extras: [] } }); assert.equal(created.status(), 201); let value = await created.json();
      for (const command of ['START_ASSEMBLY', 'SEND_TO_OVEN', 'ENTER_OVEN', 'REMOVE_FROM_OVEN']) { const pizza = value.items[0]; const response = await form.request.post(`${apiOrigin}/orders/v2/${value.id}/pizzas/${pizza.id}/commands`, { headers: operationHeaders, data: { command, expectedState: pizza.production.state, expectedVersion: pizza.production.version, clientCommandId: randomUUID() } }); assert.equal(response.status(), 200); value = (await response.json()).order; }
    }
    for (const page of [a, b]) { await until(async () => await page.locator('.finishing-order').count() === 30, 'Fila de 30 pedidos incompleta'); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); }
    assert.deepEqual(errors, []); console.info('PASS: 30 pedidos reais persistidos na fila de finalização dos dois tablets.');
  } finally { await browser.close(); if (web.exitCode === null) { const exited = new Promise(done => web.once('exit', done)); web.kill(); await exited; } }
}, { webOrigin, operatorFixtures: true, serverEnv: { OVEN_CAPACITY: '', OVEN_DEFAULT_MINUTES: '0.1' } });
