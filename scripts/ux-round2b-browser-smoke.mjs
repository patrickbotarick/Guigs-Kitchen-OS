import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
import { withIsolatedApi } from './helpers/isolated-api.mjs';
import { loginPin } from './helpers/operator-fixtures.mjs';
import { openOperationalMenu, closeOperationalMenu } from './helpers/operational-navigation.mjs';

const baseline = process.env.ROUND2B_BASELINE === '1';
const origin = 'http://127.0.0.1:5192', shots = resolve('artifacts/ui-audit/round2b');
mkdirSync(shots, { recursive: true });
const executablePath = [process.env.BROWSER_PATH, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean).find(existsSync);
assert.ok(executablePath, 'Chrome/Edge necessário');
await withIsolatedApi(3362, async ({ apiOrigin, restart, prisma }) => {
  const web = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5192', '--strictPort'], { cwd: resolve('apps/web'), env: { ...process.env, VITE_API_URL: apiOrigin }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    await new Promise((done, reject) => { const timer = setTimeout(() => reject(Error('Vite não iniciou')), 15000); web.once('exit', code => { clearTimeout(timer); reject(Error(`Vite encerrou ${code}`)); }); web.stdout.on('data', data => { if (String(data).includes('5192')) { clearTimeout(timer); done(); } }); });
    const contexts = await Promise.all(Array.from({ length: 3 }, () => browser.newContext({ viewport: { width: 1280, height: 648 }, hasTouch: true })));
    const [assembly, station, counter] = await Promise.all(contexts.map(context => context.newPage()));
    const errors = []; for (const page of [assembly, station, counter]) page.on('pageerror', error => errors.push(error.message));
    for (const [page, path, pin] of [[assembly, '/kitchen/assembly', '4826'], [station, '/kitchen/finishing', '5937'], [counter, '/counter/dispatch', '6048']]) { await page.goto(origin + path); await loginPin(page, pin); }
    const auth = await assembly.evaluate(() => ({ Authorization: `Bearer ${localStorage.getItem('guigs-operator-session-token')}`, 'X-Workstation-Device-Key': localStorage.getItem('guigs-workstation-device-key') }));
    assert.equal((await assembly.request.patch(`${apiOrigin}/operators/session`, { headers: auth, data: { available: false } })).status(), 200);
    async function post(path, body) { const response = await assembly.request.post(apiOrigin + path, { headers: auth, data: { clientCommandId: randomUUID(), ...body } }); assert.equal(response.status(), 200, await response.text()); return response.json(); }
    async function read(id) { return (await assembly.request.get(`${apiOrigin}/orders/v2/${id}`)).json(); }
    async function create(count, customerName, fulfillmentType = 'DELIVERY', channel = 'IFOOD') {
      const response = await assembly.request.post(`${apiOrigin}/orders/v2`, { data: { clientRequestId: randomUUID(), customerName, fulfillmentType, channel, pizzas: Array.from({ length: count }, () => ({ size: 'GRANDE', composition: 'HALF_HALF', firstHalf: { flavorId: 'calabresa', modifiers: [{ type: 'REMOVE', ingredientId: 'cebola' }] }, secondHalf: { flavorId: 'portuguesa', modifiers: [] }, crustId: 'requeijao', notes: 'Cortar em 8' })), extras: [{ extraCatalogId: 'coca-cola-2l', quantity: 1, notes: null }] } });
      assert.equal(response.status(), 201, await response.text()); return response.json();
    }
    async function command(order, index, action) { const current = await read(order.id), pizza = current.items[index]; return post(`/orders/v2/${order.id}/pizzas/${pizza.id}/commands`, { command: action, expectedState: pizza.production.state, expectedVersion: pizza.production.version }); }
    const queued = await create(2, 'Cliente na fila', 'PICKUP', 'COUNTER'), assembling = await create(2, 'Cliente em montagem', 'DELIVERY', 'WHATSAPP'); await command(assembling, 0, 'START_ASSEMBLY');
    const oven = await create(10, 'Cliente no forno'); for (let i = 0; i < 10; i++) for (const action of ['START_ASSEMBLY', 'SEND_TO_OVEN']) await command(oven, i, action);
    const finishing = await create(2, 'Cliente em acabamento'); for (let i = 0; i < 2; i++) for (const action of ['START_ASSEMBLY', 'SEND_TO_OVEN', 'REMOVE_FROM_OVEN']) await command(finishing, i, action);
    const routeOrders = [];
    for (const [index, count] of [3, 3, 4].entries()) {
      const order = await create(count, `Cliente rota ${index + 1}`, index === 1 ? 'PICKUP' : 'DELIVERY', index === 2 ? 'WHATSAPP' : 'COUNTER'); routeOrders.push(order);
      for (let i = 0; i < count; i++) for (const action of ['START_ASSEMBLY', 'SEND_TO_OVEN', 'REMOVE_FROM_OVEN', 'FINISH_PIZZA']) await command(order, i, action);
      let route = (await post('/dispatch/routes/commands', { command: 'CREATE' })).routes[0];
      for (const pizza of order.items.filter(item => item.kind === 'PIZZA')) route = (await post(`/dispatch/routes/${route.id}/commands`, { command: 'ADD', expectedVersion: route.version, pizzaId: pizza.id })).routes[0];
      await post(`/dispatch/routes/${route.id}/commands`, { command: 'CLOSE', expectedVersion: route.version });
    }
    await station.locator('[data-pizza-id]').first().waitFor(); await counter.getByLabel('Rota fechada 1', { exact: true }).waitFor();
    const overview = await contexts[1].newPage(); await overview.goto(origin + '/kitchen'); await overview.locator('.kb-card').first().waitFor();
    const measurements = [];
    for (const [width, height] of [[1280, 648], [1280, 800], [1024, 768], [1366, 768]]) for (const [page, path, name] of [[overview, '/kitchen', 'overview'], [station, '/kitchen/finishing', 'production'], [counter, '/counter/dispatch', 'counter']]) {
      await page.setViewportSize({ width, height }); await page.goto(origin + path); await page.locator(name === 'overview' ? '.kb-card' : name === 'production' ? '.oven-card' : '.flow-counter-order').first().waitFor();
      const metric = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, documentHeight: document.documentElement.scrollHeight, documentWidth: document.documentElement.scrollWidth })); measurements.push({ name, ...metric });
      assert.equal(metric.documentWidth, width, `${name}: overflow horizontal`);
      if (!baseline) assert.equal(metric.documentHeight, height, `${name}: scroll de documento`);
      await page.screenshot({ path: resolve(shots, `${baseline ? 'before' : 'after'}-${name}-${width}x${height}.png`) });
    }
    if (!baseline) {
      const queuedCard = overview.locator(`[data-pizza-id="${queued.items[0].id}"]`);
      assert.ok((await queuedCard.innerText()).includes('Cliente na fila')); assert.ok((await queuedCard.innerText()).includes('Retirada')); assert.ok((await queuedCard.innerText()).includes('Balcão')); assert.ok((await queuedCard.innerText()).includes('Pizza 1 de 2'));
      assert.ok((await station.locator(`[data-pizza-id="${oven.items[0].id}"]`).innerText()).includes('Sem cebola · 1ª metade (Calabresa)'));
      // Only this disposable fixture has its complete timestamp chain shifted;
      // keep the persisted production contract chronological when testing alerts.
      await prisma.pizzaItem.update({ where: { id: oven.items[1].id }, data: { queuedAt: new Date(Date.now() - 12 * 60000), assemblyStartedAt: new Date(Date.now() - 11 * 60000), assemblyCompletedAt: new Date(Date.now() - 10 * 60000), ovenStartedAt: new Date(Date.now() - 10 * 60000), ovenExpectedEndAt: new Date(Date.now() - 3 * 60000) } });
      await station.reload(); await station.getByText('Há pizzas no tempo de saída', { exact: true }).waitFor();
      async function clickCommand(page, button, command) {
        const response = page.waitForResponse(response => response.request().method() === 'POST' && response.request().postDataJSON()?.command === command);
        await button.click(); const result = await response; assert.equal(result.status(), 200, await result.text()); return result.json();
      }
      const other = await contexts[1].newPage(); await other.goto(origin + '/kitchen/finishing'); await other.getByText('Entrada automática', { exact: true }).waitFor();
      await openOperationalMenu(station);
      await clickCommand(station, station.getByRole('button', { name: /Entrada automática no forno/ }), 'SET_AUTO_OVEN_ENTRY');
      await closeOperationalMenu(station); await other.getByText('Entrada manual', { exact: true }).waitFor({ timeout: 5000 });
      await station.reload(); await station.getByText('Entrada manual', { exact: true }).waitFor();
      const manual = await create(1, 'Entrada manual compartilhada'); await command(manual, 0, 'START_ASSEMBLY'); await command(manual, 0, 'SEND_TO_OVEN');
      const waiting = (await read(manual.id)).items[0]; assert.equal(waiting.production.state, 'WAITING_OVEN'); assert.equal(waiting.production.ovenStartedAt, null);
      await clickCommand(station, station.locator(`[data-pizza-id="${waiting.id}"]`).getByRole('button', { name: 'Colocar no forno' }), 'ENTER_OVEN');
      assert.equal((await read(manual.id)).items[0].production.state, 'IN_OVEN');
      await restart(); await other.reload(); await other.getByText('Entrada manual', { exact: true }).waitFor();
      await openOperationalMenu(station); await clickCommand(station, station.getByRole('button', { name: /Entrada automática no forno/ }), 'SET_AUTO_OVEN_ENTRY'); await closeOperationalMenu(station);
      await other.getByText('Entrada automática', { exact: true }).waitFor({ timeout: 5000 });
      const automatic = await create(1, 'Entrada automática compartilhada'); await command(automatic, 0, 'START_ASSEMBLY'); await command(automatic, 0, 'SEND_TO_OVEN');
      assert.equal((await read(automatic.id)).items[0].production.state, 'IN_OVEN'); await station.locator(`[data-pizza-id="${automatic.items[0].id}"]`).waitFor({ timeout: 5000 });
      const ovenCard = station.locator(`[data-pizza-id="${oven.items[0].id}"]`);
      await clickCommand(station, ovenCard.getByRole('button', { name: 'Retirar do forno' }), 'REMOVE_FROM_OVEN');
      await clickCommand(station, station.locator(`[data-pizza-id="${oven.items[0].id}"]`).getByRole('button', { name: 'Finalizar pizza' }), 'FINISH_PIZZA');
      await station.getByRole('button', { name: 'Organizar rotas', exact: true }).click();
      await station.getByLabel('Pizzas disponíveis para rota', { exact: true }).getByText('Cliente no forno', { exact: false }).waitFor();
      const dockGeometry = await station.evaluate(() => ({ documentHeight: document.documentElement.scrollHeight, height: innerHeight, ovenHeight: document.querySelector('.flow-production-columns').getBoundingClientRect().height }));
      assert.equal(dockGeometry.documentHeight, dockGeometry.height); assert.ok(dockGeometry.ovenHeight >= 180);
      assert.ok(await station.getByText('Há pizzas no tempo de saída', { exact: true }).isVisible());
      await station.screenshot({ path: resolve(shots, 'after-production-routes-open.png') });
      await counter.getByRole('button', { name: 'Selecionar rota 3', exact: true }).click();
      assert.equal(await counter.locator('.flow-conference').count(), 1); await counter.getByText('Cliente rota 3', { exact: true }).waitFor();
      const footer = await counter.getByRole('button', { name: 'Registrar saída da rota', exact: true }).boundingBox(); assert.ok(footer.y + footer.height <= (await counter.evaluate(() => innerHeight)));
      assert.equal(await counter.getByRole('button', { name: 'Registrar saída da rota', exact: true }).isDisabled(), true);
      await other.close();
      if (process.env.ROUND2B_ANDROID === '1') {
        const android = await chromium.connectOverCDP('http://127.0.0.1:9222');
        try {
          const page = android.contexts()[0].pages()[0] ?? await android.contexts()[0].newPage();
          const androidRecords = [];
          for (const [path, name, pin] of [['/kitchen', 'overview', null], ['/kitchen/finishing', 'production', '5937'], ['/counter/dispatch', 'counter', '6048']]) {
            await page.goto(origin + path); if (pin) await loginPin(page, pin);
            await page.locator(name === 'overview' ? '.kb-card' : name === 'production' ? '.oven-card' : '.flow-counter-order').first().waitFor();
            const metric = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, documentHeight: document.documentElement.scrollHeight, documentWidth: document.documentElement.scrollWidth, userAgent: navigator.userAgent }));
            assert.equal(metric.width, 1280); assert.ok(Math.abs(metric.height - 648) <= 16);
            assert.equal(metric.documentHeight, metric.height); assert.equal(metric.documentWidth, metric.width); assert.ok(metric.userAgent.includes('Android'));
            androidRecords.push({ name, ...metric }); await page.screenshot({ path: resolve(shots, `android-${name}.png`) });
            if (pin) { await openOperationalMenu(page); await page.getByRole('button', { name: 'Encerrar turno', exact: true }).click(); }
          }
          writeFileSync(resolve(shots, 'android-metrics.json'), JSON.stringify(androidRecords, null, 2));
        } finally { await android.close(); }
      }
    }
    assert.deepEqual(errors, []);
    writeFileSync(resolve(shots, `${baseline ? 'before' : 'after'}-metrics.json`), JSON.stringify({ measurements, fixture: { queue: queued.items.length, oven: 10, finishing: 2, routes: 3, routePizzas: 10 } }, null, 2));
    console.info(`${baseline ? 'BASELINE' : 'PASS'} Rodada 2B: ${JSON.stringify(measurements)}`);
  } finally { await browser.close(); if (web.exitCode === null) { const exited = new Promise(done => web.once('exit', done)); web.kill(); await exited; } }
}, { webOrigin: origin, operatorFixtures: true });
