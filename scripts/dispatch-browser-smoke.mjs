import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
import { withIsolatedApi } from './helpers/isolated-api.mjs';
import { loginPin, operatorFixtures } from './helpers/operator-fixtures.mjs';
const executablePath = [process.env.BROWSER_PATH, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean).find(existsSync);
assert.ok(executablePath, 'Edge/Chrome necessário'); const webOrigin = 'http://127.0.0.1:5185';
async function until(check, message, timeout = 15000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; await new Promise(done => setTimeout(done, 100)); } throw new Error(message); }
const headers = page => page.evaluate(() => ({ Authorization: `Bearer ${localStorage.getItem('guigs-operator-session-token')}`, 'X-Workstation-Device-Key': localStorage.getItem('guigs-workstation-device-key') }));
const pizzaCard = (page, id) => page.locator(`[data-pizza-id="${id}"]`);
async function clickReady(button) { await button.waitFor(); await until(() => button.isEnabled(), 'Ação não habilitada'); await button.click(); }
await withIsolatedApi(3354, async ({ prisma, apiOrigin, restart }) => {
  const web = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5185', '--strictPort'], { cwd: resolve('apps/web'), env: { ...process.env, VITE_API_URL: apiOrigin }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    await new Promise((done, reject) => { const timer = setTimeout(() => reject(new Error('Vite não iniciou')), 10000); web.once('exit', code => { clearTimeout(timer); reject(new Error(`Vite encerrou ${code}`)); }); web.stdout.on('data', value => { if (String(value).includes('5185')) { clearTimeout(timer); done(); } }); web.stderr.on('data', value => { clearTimeout(timer); reject(new Error(String(value))); }); });
    const contexts = [], pages = [], errors = [], responses = [];
    for (let index = 0; index < 3; index++) {
      const context = await browser.newContext({ viewport: { width: index === 2 ? 1280 : 1024, height: index === 2 ? 800 : 768 }, hasTouch: true }); contexts.push(context); const page = await context.newPage(); pages.push(page);
      page.on('pageerror', error => errors.push(error.message)); page.on('response', response => { if (response.url().endsWith('/dispatch/commands')) responses.push({ input: response.request().postDataJSON(), status: response.status() }); });
      await page.goto(`${webOrigin}/kitchen/${index ? 'dispatch' : 'assembly'}`); await loginPin(page, operatorFixtures[index].pin);
      if (index) { await clickReady(page.getByRole('button', { name: 'Receber novas pizzas de montagem', exact: true })); await until(async () => await page.getByRole('button', { name: 'Receber novas pizzas de montagem', exact: true }).getAttribute('aria-pressed') === 'false', 'Disponibilidade não suspensa'); await page.getByLabel('Conexão Despacho', { exact: true }).getByText('Online', { exact: true }).waitFor(); }
    }
    const [assembly, a, b] = pages, form = await contexts[0].newPage(), oven = await contexts[0].newPage(), finishing = await contexts[0].newPage();
    await oven.goto(`${webOrigin}/kitchen/oven`); await finishing.goto(`${webOrigin}/kitchen/finishing`);
    const read = async id => (await (await form.request.get(`${apiOrigin}/orders/v2/${id}`)).json());
    async function commandClick(page, id, label, module = 'dispatch') {
      const detail = page.locator(`.${module}-detail`), button = page.getByRole('button', { name: label, exact: true }); let before;
      await until(async () => { before = (await read(id)).version; return await detail.count() === 1 && Number(await detail.getAttribute('data-order-version')) === before && await button.isEnabled(); }, 'Terminal não reconciliou versão');
      await clickReady(button); await until(async () => (await read(id)).version > before, 'Comando não persistiu');
    }
    const created = [];
    for (const type of ['DELIVERY', 'PICKUP']) {
      await form.goto(`${webOrigin}/orders/new`); await form.getByLabel('Cliente *').fill(`Despacho integrado ${type}`); await form.getByLabel(/^Tipo de atendimento/).selectOption(type); await form.getByLabel('Telefone', { exact: false }).fill('11999999999'); await form.getByLabel('Quantidade — Coca-Cola 2L', { exact: true }).fill('1');
      await form.getByRole('button', { name: 'Criar pedido →', exact: true }).click(); await form.getByRole('heading', { name: /aguardando montagem/ }).waitFor();
      const order = (await (await form.request.get(`${apiOrigin}/orders/v2`)).json()).find(value => value.customerName === `Despacho integrado ${type}`); created.push(order);
      await assembly.getByRole('button', { name: new RegExp(`^Pedido #${order.number},`) }).click(); await assembly.getByRole('heading', { name: `Pedido #${order.number}`, exact: true }).waitFor();
      await clickReady(assembly.getByRole('button', { name: 'Iniciar montagem', exact: true })); await clickReady(assembly.getByRole('button', { name: /Enviar pro forno/ }));
      const pizza = order.items.find(item => item.kind === 'PIZZA'); await until(async () => (await read(order.id)).items[0].production.state === 'WAITING_OVEN', 'Montagem incompleta');
      await clickReady(pizzaCard(oven, pizza.id).getByRole('button', { name: 'Colocar no forno', exact: true })); await clickReady(pizzaCard(oven, pizza.id).getByRole('button', { name: 'Retirar do forno', exact: true }));
      await finishing.getByRole('heading', { name: `Pedido #${order.number}`, exact: true }).waitFor();
      for (const label of ['Iniciar conferência', 'Conferir pizza', 'Conferir 1 unidade', 'Confirmar embalagem', 'Liberar para despacho']) await commandClick(finishing, order.id, label, 'finishing');
      for (const page of [a, b]) await page.getByRole('button', { name: new RegExp(`^Pedido #${order.number},`) }).waitFor();
    }
    const [delivery, pickup] = created;
    for (const page of [a, b]) { await page.getByRole('group', { name: 'Tipo de atendimento' }).getByRole('button', { name: 'Delivery', exact: true }).click(); assert.equal(await page.locator('.dispatch-order').count(), 1); await page.getByRole('group', { name: 'Tipo de atendimento' }).getByRole('button', { name: 'Todos', exact: true }).click(); await page.getByRole('button', { name: new RegExp(`^Pedido #${delivery.number},`) }).click(); }
    await commandClick(a, delivery.id, 'Aguardando entregador'); await b.getByRole('button', { name: 'Saiu para entrega', exact: true }).waitFor();
    // Commit succeeds but response is lost. Refresh/retry must reuse the UUID.
    let drop = true; const uncertain = [];
    await a.route('**/dispatch/commands', async route => { const req = route.request(), input = req.postDataJSON(); if (input.command === 'MARK_OUT_FOR_DELIVERY') { uncertain.push(input); if (drop) { drop = false; const response = await a.request.fetch(req.url(), { method: req.method(), headers: req.headers(), data: req.postData() }); assert.equal(response.status(), 200); await route.abort('failed'); return; } } await route.continue(); });
    await commandClick(a, delivery.id, 'Saiu para entrega'); await a.getByRole('button', { name: 'Confirmar comando novamente', exact: true }).waitFor(); await a.reload(); await a.getByLabel('Conexão Despacho', { exact: true }).getByText('Online', { exact: true }).waitFor(); await clickReady(a.getByRole('button', { name: 'Confirmar comando novamente', exact: true })); await until(async () => await a.getByRole('button', { name: 'Confirmar comando novamente', exact: true }).count() === 0, 'Replay não confirmou'); assert.equal(uncertain[0].clientCommandId, uncertain[1].clientCommandId);
    await contexts[2].setOffline(true); await b.getByLabel('Conexão Despacho', { exact: true }).getByText('Offline', { exact: true }).waitFor(); await contexts[2].setOffline(false); await b.getByLabel('Conexão Despacho', { exact: true }).getByText('Online', { exact: true }).waitFor();
    for (const page of [a, b]) { await page.getByRole('button', { name: new RegExp(`^Pedido #${delivery.number},`) }).click(); await until(async () => Number(await page.locator('.dispatch-detail').getAttribute('data-order-version')) === (await read(delivery.id)).version && await page.getByRole('button', { name: 'Confirmar entregue', exact: true }).isEnabled(), 'Entrega não reconciliada'); }
    const shots = resolve(tmpdir(), 'guigs-dispatch-validation'); mkdirSync(shots, { recursive: true });
    for (const [page, label] of [[a, '1024x768'], [b, '1280x800']]) { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); assert.ok(await page.getByRole('button', { name: 'Confirmar entregue', exact: true }).evaluate(button => button.getBoundingClientRect().height >= 44)); await page.screenshot({ path: resolve(shots, `dispatch-${label}.png`), fullPage: true }); }
    const before = responses.length; await Promise.all([a, b].map(page => page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Confirmar entregue').click()))); await until(() => responses.slice(before).length >= 2, 'Dupla entrega não chegou'); assert.deepEqual(responses.slice(before, before + 2).map(r => r.status).sort(), [200, 409]);
    for (const page of [a, b]) await until(async () => await page.getByRole('button', { name: new RegExp(`^Pedido #${delivery.number},`) }).count() === 0, 'Entrega continuou na fila');
    await commandClick(b, pickup.id, 'Pronto para retirada'); await a.getByRole('button', { name: 'Confirmar retirado', exact: true }).waitFor(); await b.reload(); await b.getByLabel('Conexão Despacho', { exact: true }).getByText('Online', { exact: true }).waitFor(); await restart(); for (const page of [a, b]) await page.getByLabel('Conexão Despacho', { exact: true }).getByText('Online', { exact: true }).waitFor(); await commandClick(a, pickup.id, 'Confirmar retirado');
    for (const page of [a, b]) await page.getByText('Nenhum pedido neste filtro de despacho', { exact: true }).waitFor();
    for (const order of created) { const final = await read(order.id); assert.equal(final.status, order.fulfillmentType === 'DELIVERY' ? 'DELIVERED' : 'PICKED_UP'); assert.ok(final.dispatch.completedAt); for (const field of order.fulfillmentType === 'DELIVERY' ? ['dispatchReadyAt', 'waitingDriverAt', 'dispatchedAt', 'deliveredAt'] : ['dispatchReadyAt', 'pickupReadyAt', 'pickedUpAt']) assert.ok(final.dispatch[field]); const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id } }); assert.ok(history.some(row => row.fromStatus === null)); assert.equal(history.filter(row => row.toStatus === final.status).length, 1); assert.ok(history.filter(row => row.metadata?.includes('MARK_')).every(row => { const data = JSON.parse(row.metadata); return data.operatorId && data.operatorSessionId && data.workstationId; })); }
    console.info('PASS: Delivery e Retirada/Balcão ponta a ponta pela UI (balcão → montagem → forno → finalização → despacho), dois terminais, realtime, 200/409 dupla entrega, replay após resposta perdida/refresh, offline/reconexão/API restart, autoria/timestamps, 1024×768 e 1280×800 sem overflow.');
    const auth = await headers(assembly);
    for (let index = 0; index < 30; index++) {
      const response = await form.request.post(`${apiOrigin}/orders/v2`, { data: { clientRequestId: randomUUID(), customerName: `Fila despacho ${index + 1}`, fulfillmentType: index % 2 ? 'PICKUP' : 'DELIVERY', channel: 'COUNTER', pizzas: [{ size: 'GRANDE', composition: 'WHOLE', firstHalf: { flavorId: 'calabresa', modifiers: [] }, crustId: 'tradicional', notes: null }], extras: [] } }); assert.equal(response.status(), 201); let order = await response.json();
      for (const command of ['START_ASSEMBLY', 'SEND_TO_OVEN', 'ENTER_OVEN', 'REMOVE_FROM_OVEN']) { const pizza = order.items[0], result = await form.request.post(`${apiOrigin}/orders/v2/${order.id}/pizzas/${pizza.id}/commands`, { headers: auth, data: { command, expectedState: pizza.production.state, expectedVersion: pizza.production.version, clientCommandId: randomUUID() } }); assert.equal(result.status(), 200); order = (await result.json()).order; }
      for (const command of ['START_FINISHING', 'CHECK_PIZZA', 'CONFIRM_PACKAGING', 'RELEASE_TO_DISPATCH']) { const input = { command, expectedVersion: order.version, clientCommandId: randomUUID() }; if (command.includes('FINISHING') || command === 'CHECK_PIZZA') Object.assign(input, { pizzaId: order.items[0].id, expectedItemVersion: order.items[0].production.version }); const result = await form.request.post(`${apiOrigin}/orders/v2/${order.id}/finishing/commands`, { headers: auth, data: input }); assert.equal(result.status(), 200); order = (await result.json()).order; }
    }
    for (const page of [a, b]) { await until(async () => await page.locator('.dispatch-order').count() === 30, 'Fila de 30 pedidos incompleta'); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); }
    assert.deepEqual(errors, []); console.info('PASS: 30 pedidos WAITING_DISPATCH percorreram serviços reais e aparecem nos dois terminais.');
  } finally { await browser.close(); if (web.exitCode === null) { const exited = new Promise(done => web.once('exit', done)); web.kill(); await exited; } }
}, { webOrigin, operatorFixtures: true, serverEnv: { OVEN_CAPACITY: '', OVEN_DEFAULT_MINUTES: '0.1' } });
