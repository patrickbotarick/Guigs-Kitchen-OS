import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
import { withIsolatedApi } from './helpers/isolated-api.mjs';
import { loginPin } from './helpers/operator-fixtures.mjs';

// Real UI and commands in a disposable database; no production fixtures.
const executablePath = [process.env.BROWSER_PATH, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean).find(existsSync);
assert.ok(executablePath, 'Edge/Chrome necessário');
const webOrigin = 'http://127.0.0.1:5188', shots = resolve(tmpdir(), 'guigs-flow-v2-validation');
mkdirSync(shots, { recursive: true });
await withIsolatedApi(3358, async ({ apiOrigin, prisma, restart }) => {
  const web = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5188', '--strictPort'], { cwd: resolve('apps/web'), env: { ...process.env, VITE_API_URL: apiOrigin }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Vite não iniciou')), 10000);
      web.once('exit', code => { clearTimeout(timer); reject(new Error(`Vite encerrou ${code}`)); });
      web.stdout.on('data', data => { if (String(data).includes('5188')) { clearTimeout(timer); done(); } });
      web.stderr.on('data', data => { clearTimeout(timer); reject(new Error(String(data))); });
    });
    const errors = [], contexts = await Promise.all(Array.from({ length: 3 }, () => browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true })));
    const [assembly, station, counter] = await Promise.all(contexts.map(context => context.newPage()));
    for (const context of contexts) context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    for (const [page, path, pin] of [[assembly, '/kitchen/assembly', '4826'], [station, '/kitchen/finishing', '5937'], [counter, '/counter/dispatch', '6048']]) {
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${webOrigin}${path}`); await loginPin(page, pin);
      if (path.endsWith('/assembly')) {
        await page.getByRole('button', { name: 'Receber novas pizzas neste tablet', exact: true }).click();
        await page.getByText('Suspenso neste tablet', { exact: true }).waitFor();
      } else {
        await page.getByRole('button', { name: /Suspender recebimento/ }).click();
        await page.getByRole('button', { name: /Retomar recebimento/ }).waitFor();
      }
    }
    const board = await contexts[1].newPage(); await board.goto(`${webOrigin}/kitchen`);
    async function post(path, input, status = 200, page = counter) {
      const headers = await page.evaluate(() => ({ Authorization: `Bearer ${localStorage.getItem('guigs-operator-session-token')}`, 'X-Workstation-Device-Key': localStorage.getItem('guigs-workstation-device-key') }));
      const response = await page.request.post(`${apiOrigin}${path}`, { headers, data: { clientCommandId: randomUUID(), ...input } });
      assert.equal(response.status(), status, await response.text()); return response.json();
    }
    async function read(id) { return (await assembly.request.get(`${apiOrigin}/orders/v2/${id}`)).json(); }
    async function routeRead(id) { return (await (await station.request.get(`${apiOrigin}/dispatch/routes`)).json()).find(route => route.id === id); }
    async function pizzaCommand(id, index, command) {
      const order = await read(id), pizza = order.items[index];
      return post(`/orders/v2/${id}/pizzas/${pizza.id}/commands`, { command, expectedState: pizza.production.state, expectedVersion: pizza.production.version }, 200, assembly);
    }
    async function clickCommand(page, button, command) {
      const pending = page.waitForResponse(response => response.request().method() === 'POST' && response.request().postDataJSON()?.command === command);
      await button.click(); const response = await pending; assert.equal(response.status(), 200, await response.text());
      await page.waitForFunction(() => !document.querySelector('.oven-toolbar button')?.disabled);
      return response.json();
    }
    async function create(count = 1, extras = false, fulfillmentType = 'DELIVERY') {
      const response = await assembly.request.post(`${apiOrigin}/orders/v2`, { data: { clientRequestId: randomUUID(), customerName: 'Smoke operacional', fulfillmentType, channel: 'COUNTER', notes: 'Conferir identificação', pizzas: Array.from({ length: count }, () => ({ size: 'GRANDE', composition: 'HALF_HALF', firstHalf: { flavorId: 'calabresa', modifiers: [] }, secondHalf: { flavorId: 'portuguesa', modifiers: [] }, crustId: 'tradicional', notes: 'Acabamento físico' })), extras: extras ? [{ extraCatalogId: 'coca-cola-2l', quantity: 2, notes: null }] : [] } });
      assert.equal(response.status(), 201, await response.text()); return response.json();
    }
    // Keep order-entry UI coverage, including Broto, half-half and structured extras.
    const form = await contexts[0].newPage(); await form.goto(`${webOrigin}/orders/new`);
    await form.getByLabel('Cliente *').fill('Smoke operacional');
    for (let i = 0; i < 2; i++) await form.getByRole('button', { name: '+ Adicionar pizza', exact: true }).click();
    await form.getByLabel('Tamanho da pizza 1', { exact: true }).selectOption('BROTO');
    await form.getByLabel('Composição da pizza 2', { exact: true }).selectOption('HALF_HALF');
    await form.getByLabel('Sabor — 2ª metade', { exact: true }).selectOption('portuguesa');
    await form.getByLabel('Quantidade — Coca-Cola 2L', { exact: true }).fill('2');
    await form.getByRole('button', { name: 'Criar pedido →', exact: true }).click();
    await form.getByRole('heading', { name: /aguardando montagem/ }).waitFor();
    const [created] = await (await assembly.request.get(`${apiOrigin}/orders/v2`)).json();
    await assembly.getByRole('button', { name: 'Fila geral', exact: true }).click();
    await assembly.getByRole('heading', { name: `Pedido #${created.number}`, exact: true }).waitFor();
    await assembly.getByRole('button', { name: 'Assumir pizza', exact: true }).click();
    await assembly.getByRole('button', { name: 'Iniciar montagem', exact: true }).click();
    await assembly.getByRole('button', { name: 'Pausar', exact: true }).waitFor();
    await assembly.getByRole('button', { name: /Enviar pro forno/ }).click();
    const card = index => station.locator(`[data-pizza-id="${created.items[index].id}"]`);
    await card(0).getByRole('button', { name: 'Retirar do forno' }).waitFor();
    const sent = (await read(created.id)).items[0]; assert.equal(sent.production.state, 'IN_OVEN'); assert.ok(sent.production.ovenStartedAt); assert.equal(sent.production.assemblyCompletedAt, sent.production.ovenStartedAt);
    await pizzaCommand(created.id, 1, 'START_ASSEMBLY'); await pizzaCommand(created.id, 1, 'SEND_TO_OVEN'); await pizzaCommand(created.id, 2, 'START_ASSEMBLY');
    await board.locator('[aria-label="No forno"] .kb-card').nth(1).waitFor(); await board.locator('[aria-label="Em montagem"] .kb-card').waitFor();
    await clickCommand(station, card(0).getByRole('button', { name: 'Retirar do forno' }), 'REMOVE_FROM_OVEN');
    await clickCommand(station, card(0).getByRole('button', { name: 'Finalizar pizza' }), 'FINISH_PIZZA');
    await board.locator('[aria-label="Finalizados"] [data-pizza-id]').waitFor();
    const newRoute = await clickCommand(station, station.getByRole('button', { name: 'Criar rota', exact: true }), 'CREATE'), routeId = newRoute.routes[0].id;
    const add = index => station.locator('.flow-route-item').filter({ hasText: `Pizza ${index + 1}` }).getByRole('button', { name: 'Adicionar', exact: true });
    await clickCommand(station, add(0), 'ADD');
    await clickCommand(station, card(1).getByRole('button', { name: 'Retirar do forno' }), 'REMOVE_FROM_OVEN');
    await clickCommand(station, card(1).getByRole('button', { name: 'Finalizar pizza' }), 'FINISH_PIZZA'); await clickCommand(station, add(1), 'ADD');
    await clickCommand(station, station.getByRole('button', { name: 'Fechar rota', exact: true }), 'CLOSE');
    const closed = counter.getByLabel('Rota fechada 1', { exact: true }); await closed.waitFor();
    assert.equal(await closed.getByRole('button', { name: 'Registrar saída da rota' }).isDisabled(), true); await counter.getByText(/Pedido incompleto/).waitFor();
    const stale = await routeRead(routeId); await clickCommand(counter, closed.getByRole('button', { name: 'Reabrir rota' }), 'REOPEN');
    await post(`/dispatch/routes/${routeId}/commands`, { command: 'CLOSE', expectedVersion: stale.version }, 409);
    // Moving/removing remains editable only on open routes; CAS applies to both ends.
    const second = await post('/dispatch/routes/commands', { command: 'CREATE' });
    let origin = await routeRead(routeId), destination = second.routes[0];
    await post(`/dispatch/routes/${origin.id}/commands`, { command: 'MOVE', expectedVersion: origin.version, pizzaId: created.items[1].id, targetRouteId: destination.id, targetExpectedVersion: destination.version });
    destination = await routeRead(destination.id);
    await post(`/dispatch/routes/${destination.id}/commands`, { command: 'REMOVE', expectedVersion: destination.version, pizzaId: created.items[1].id });
    origin = await routeRead(routeId);
    await post(`/dispatch/routes/${origin.id}/commands`, { command: 'ADD', expectedVersion: origin.version, pizzaId: created.items[1].id });
    await pizzaCommand(created.id, 2, 'SEND_TO_OVEN');
    await clickCommand(station, card(2).getByRole('button', { name: 'Retirar do forno' }), 'REMOVE_FROM_OVEN');
    await clickCommand(station, card(2).getByRole('button', { name: 'Finalizar pizza' }), 'FINISH_PIZZA'); await clickCommand(station, add(2), 'ADD');
    destination = await routeRead(second.routes[0].id);
    await post(`/dispatch/routes/${destination.id}/commands`, { command: 'ADD', expectedVersion: destination.version, pizzaId: created.items[0].id }, 409);
    await clickCommand(station, station.getByRole('button', { name: 'Fechar rota', exact: true }), 'CLOSE'); await closed.waitFor();
    for (let i = 0; i < 3; i++) await clickCommand(counter, closed.getByRole('button', { name: 'Conferir pizza', exact: true }).first(), 'CHECK_PIZZA');
    // A competing terminal commits first. The real UI receives 409 and reconciles.
    let compete = true;
    await contexts[2].route('**/conference/commands', async route => {
      const input = route.request().postDataJSON();
      if (compete && input.command === 'CHECK_EXTRA') {
        compete = false;
        const response = await route.fetch({ postData: JSON.stringify({ ...input, clientCommandId: randomUUID() }) });
        assert.equal(response.status(), 200); await route.continue();
      } else await route.continue();
    });
    await closed.getByRole('button', { name: 'Conferir 1 unidade', exact: true }).click();
    await counter.getByText(/Os dados foram recarregados/).waitFor();
    await closed.getByText(/Coca-Cola 2L · 1\/2/).waitFor();
    await clickCommand(counter, closed.getByRole('button', { name: 'Conferir 1 unidade', exact: true }), 'CHECK_EXTRA');
    await clickCommand(counter, closed.getByRole('button', { name: 'Conferir embalagem', exact: true }), 'CONFIRM_PACKAGING');
    await clickCommand(counter, closed.getByRole('button', { name: 'Pedido pronto para saída', exact: true }), 'RELEASE_TO_DISPATCH');
    assert.equal((await read(created.id)).status, 'WAITING_DISPATCH');
    counter.on('dialog', dialog => dialog.accept());
    // Corrections audit and invalidate packing/release, never production completion.
    const finishedAt = (await read(created.id)).items[0].production.finishedAt;
    for (const [label, command] of [['Corrigir extra', 'UNCHECK_EXTRA'], ['Corrigir conferência', 'UNCHECK_PIZZA'], ['Corrigir embalagem', 'UNCONFIRM_PACKAGING']]) {
      await clickCommand(counter, closed.getByRole('button', { name: label, exact: true }).first(), command);
      const corrected = await read(created.id); assert.equal(corrected.status, 'FINISHING'); assert.equal(corrected.packingFinishedAt, null); assert.equal(corrected.items[0].production.finishedAt, finishedAt);
      if (command === 'UNCHECK_EXTRA') await clickCommand(counter, closed.getByRole('button', { name: 'Conferir 1 unidade', exact: true }), 'CHECK_EXTRA');
      if (command === 'UNCHECK_PIZZA') await clickCommand(counter, closed.getByRole('button', { name: 'Conferir pizza', exact: true }), 'CHECK_PIZZA');
      await clickCommand(counter, closed.getByRole('button', { name: 'Conferir embalagem', exact: true }), 'CONFIRM_PACKAGING');
      await clickCommand(counter, closed.getByRole('button', { name: 'Pedido pronto para saída', exact: true }), 'RELEASE_TO_DISPATCH');
    }
    const pickup = await create(1, false, 'PICKUP'); await pizzaCommand(pickup.id, 0, 'START_ASSEMBLY'); await pizzaCommand(pickup.id, 0, 'SEND_TO_OVEN'); await create();
    for (const [width, height] of [[1024, 768], [1280, 800], [1366, 768]]) for (const [page, path, selector, label] of [[board, '/kitchen', '.kb-columns', 'kitchen'], [assembly, '/kitchen/assembly', '.ka-pizza-card', 'assembly'], [station, '/kitchen/finishing', '.oven-card', 'finishing'], [counter, '/counter/dispatch', '.flow-counter-order', 'counter'], [board, '/orders/new', '.pizza-form', 'form']]) {
      await page.setViewportSize({ width, height }); await page.goto(`${webOrigin}${path}`);
      if (path === '/kitchen/assembly') await page.getByRole('button', { name: 'Fila geral', exact: true }).click();
      await page.locator(selector).first().waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${path} ${width}: overflow`);
      assert.ok(await page.evaluate(() => ![...document.querySelectorAll('.button')].some(button => button.getBoundingClientRect().height < 44)), `${path}: alvo touch insuficiente`);
      if (path === '/kitchen') { assert.equal(await page.locator('.kb-column').count(), 4); assert.equal(await page.locator('.kb-card button').count(), 0); }
      await page.screenshot({ path: resolve(shots, `${label}-${width}x${height}.png`) });
      if (['finishing', 'counter'].includes(label)) { await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); assert.ok(await page.locator('.oven-header').evaluate(header => header.getBoundingClientRect().top >= -1), `${path}: cabeçalho durante scroll`); }
    }
    await station.goto(`${webOrigin}/kitchen/oven`); await station.waitForURL(`${webOrigin}/kitchen/finishing`);
    await counter.goto(`${webOrigin}/kitchen/dispatch`); await counter.waitForURL(`${webOrigin}/counter/dispatch`);
    await contexts[1].setOffline(true); await station.getByText('Offline', { exact: true }).waitFor(); assert.equal(await station.getByRole('button', { name: 'Retirar do forno' }).isDisabled(), true);
    await contexts[1].setOffline(false); await station.getByText('Online', { exact: true }).waitFor(); await restart(); await station.reload(); await station.locator(`[data-pizza-id="${pickup.items[0].id}"]`).waitFor();
    // Lose the HTTP response after commit: sessionStorage + same ID recover after refresh.
    let lostId, drop = true;
    await contexts[2].route(`**/dispatch/routes/${routeId}/commands`, async route => { if (!drop) return route.continue(); drop = false; lostId = route.request().postDataJSON().clientCommandId; await route.fetch(); await route.abort('failed'); });
    await counter.getByLabel('Rota fechada 1', { exact: true }).getByRole('button', { name: 'Registrar saída da rota' }).click();
    await counter.getByRole('button', { name: 'Confirmar envio', exact: true }).waitFor(); await counter.reload();
    await clickCommand(counter, counter.getByRole('button', { name: 'Confirmar envio', exact: true }), 'DISPATCH');
    assert.equal(await prisma.dispatchRouteHistory.count({ where: { commandId: lostId, eventType: 'ROUTE_DISPATCHED' } }), 1);
    await post(`/dispatch/routes/${routeId}/commands`, { command: 'REOPEN', expectedVersion: (await routeRead(routeId)).version }, 409);
    await clickCommand(counter, counter.getByRole('button', { name: 'Confirmar entrega', exact: true }), 'MARK_DELIVERED'); assert.equal((await read(created.id)).status, 'DELIVERED');
    for (const command of ['REMOVE_FROM_OVEN', 'FINISH_PIZZA']) await pizzaCommand(pickup.id, 0, command);
    let target = await routeRead(second.routes[0].id);
    await post(`/dispatch/routes/${target.id}/commands`, { command: 'ADD', expectedVersion: target.version, pizzaId: pickup.items[0].id }); target = await routeRead(target.id);
    await post(`/dispatch/routes/${target.id}/commands`, { command: 'CLOSE', expectedVersion: target.version });
    for (const command of ['CHECK_PIZZA', 'CONFIRM_PACKAGING', 'RELEASE_TO_DISPATCH']) { const order = await read(pickup.id), pizza = order.items[0]; await post(`/counter/orders/${order.id}/conference/commands`, { command, expectedVersion: order.version, ...(command === 'CHECK_PIZZA' ? { pizzaId: pizza.id, expectedItemVersion: pizza.production.version } : {}) }); }
    target = await routeRead(target.id); await post(`/dispatch/routes/${target.id}/commands`, { command: 'DISPATCH', expectedVersion: target.version });
    await clickCommand(counter, counter.getByRole('button', { name: 'Confirmar retirada', exact: true }), 'MARK_PICKED_UP'); assert.equal((await read(pickup.id)).status, 'PICKED_UP');
    // Former station smokes stressed queues of 30; keep that coverage in the unified UI.
    const stress = await create(30); // All production transitions use real commands.
    for (let i = 0; i < 30; i++) for (const action of ['START_ASSEMBLY', 'SEND_TO_OVEN']) await pizzaCommand(stress.id, i, action);
    await station.locator('.oven-card').nth(29).waitFor(); assert.equal((await read(stress.id)).items.filter(item => item.production.state === 'IN_OVEN').length, 30);
    for (let i = 0; i < 30; i++) for (const action of ['REMOVE_FROM_OVEN', 'FINISH_PIZZA']) await pizzaCommand(stress.id, i, action);
    let stressRoute = (await post('/dispatch/routes/commands', { command: 'CREATE' })).routes[0];
    for (const item of stress.items) { await post(`/dispatch/routes/${stressRoute.id}/commands`, { command: 'ADD', expectedVersion: stressRoute.version, pizzaId: item.id }); stressRoute = await routeRead(stressRoute.id); }
    await post(`/dispatch/routes/${stressRoute.id}/commands`, { command: 'CLOSE', expectedVersion: stressRoute.version });
    const stressConference = counter.getByLabel(`Rota fechada ${stressRoute.routeNumber}`, { exact: true });
    await stressConference.getByRole('button', { name: 'Conferir pizza', exact: true }).nth(29).waitFor();
    assert.equal(await stressConference.getByRole('button', { name: 'Registrar saída da rota' }).isDisabled(), true);
    assert.ok(await counter.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    // Preserve the old finishing/dispatch queue stress as 30 separate orders.
    let batch = (await post('/dispatch/routes/commands', { command: 'CREATE' })).routes[0];
    const batchOrders = [];
    for (let i = 0; i < 30; i++) {
      const order = await create(); batchOrders.push(order);
      for (const action of ['START_ASSEMBLY', 'SEND_TO_OVEN', 'REMOVE_FROM_OVEN', 'FINISH_PIZZA']) await pizzaCommand(order.id, 0, action);
      await post(`/dispatch/routes/${batch.id}/commands`, { command: 'ADD', expectedVersion: batch.version, pizzaId: order.items[0].id }); batch = await routeRead(batch.id);
    }
    await post(`/dispatch/routes/${batch.id}/commands`, { command: 'CLOSE', expectedVersion: batch.version });
    const batchConference = counter.getByLabel(`Rota fechada ${batch.routeNumber}`, { exact: true });
    await batchConference.locator('.flow-counter-order').nth(29).waitFor();
    assert.equal(await batchConference.locator('.flow-counter-order').count(), 30);
    for (const initial of batchOrders) {
      for (const command of ['CHECK_PIZZA', 'CONFIRM_PACKAGING', 'RELEASE_TO_DISPATCH']) { const order = await read(initial.id), pizza = order.items[0]; await post(`/counter/orders/${order.id}/conference/commands`, { command, expectedVersion: order.version, ...(command === 'CHECK_PIZZA' ? { pizzaId: pizza.id, expectedItemVersion: pizza.production.version } : {}) }); }
    }
    await batchConference.getByRole('button', { name: 'Registrar saída da rota' }).waitFor();
    await clickCommand(counter, batchConference.getByRole('button', { name: 'Registrar saída da rota' }), 'DISPATCH');
    await counter.getByRole('button', { name: 'Confirmar entrega', exact: true }).nth(29).waitFor();
    assert.equal(await counter.getByRole('button', { name: 'Confirmar entrega', exact: true }).count(), 30);
    assert.deepEqual(errors, []);
    console.info(`PASS: 3 pizzas + extras; entrada automática; acabamento individual; rota parcial/reabertura/move/remove; correções; Delivery/Pickup; conflitos/unique; realtime/offline/restart; resposta perdida/replay; redirects; 30 pizzas e 30 pedidos; quatro colunas; 1024×768/1280×800/1366×768; overflow/touch/scroll. Capturas: ${shots}`);
  } finally { await browser.close(); if (web.exitCode === null) { const exited = new Promise(done => web.once('exit', done)); web.kill(); await exited; } }
}, { webOrigin, operatorFixtures: true, serverEnv: { OVEN_CAPACITY: '1' } });
