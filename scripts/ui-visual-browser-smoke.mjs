import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
import { withIsolatedApi } from './helpers/isolated-api.mjs';
import { loginPin } from './helpers/operator-fixtures.mjs';

// Disposable fixtures reach each station through real commands; no store database.
const executablePath = [process.env.BROWSER_PATH, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean).find(existsSync);
assert.ok(executablePath, 'Edge/Chrome necessário');
const webOrigin = 'http://127.0.0.1:5188';
const shots = resolve(tmpdir(), 'guigs-ui-visual-validation');
mkdirSync(shots, { recursive: true });
await withIsolatedApi(3358, async ({ apiOrigin }) => {
  const web = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5188', '--strictPort'], { cwd: resolve('apps/web'), env: { ...process.env, VITE_API_URL: apiOrigin }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Vite não iniciou')), 10000);
      web.once('exit', code => { clearTimeout(timer); reject(new Error(`Vite encerrou ${code}`)); });
      web.stdout.on('data', data => { if (String(data).includes('5188')) { clearTimeout(timer); done(); } });
      web.stderr.on('data', data => { clearTimeout(timer); reject(new Error(String(data))); });
    });
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${webOrigin}/kitchen/assembly`); await loginPin(page);
    const auth = await page.evaluate(() => ({ Authorization: `Bearer ${localStorage.getItem('guigs-operator-session-token')}`, 'X-Workstation-Device-Key': localStorage.getItem('guigs-workstation-device-key') }));
    const pizza = { size: 'GRANDE', composition: 'HALF_HALF', firstHalf: { flavorId: 'calabresa', modifiers: [] }, secondHalf: { flavorId: 'portuguesa', modifiers: [] }, crustId: 'tradicional', notes: 'Identificar embalagem' };
    async function create(name, commands, fulfillmentType = 'DELIVERY') {
      const response = await page.request.post(`${apiOrigin}/orders/v2`, { data: { clientRequestId: randomUUID(), customerName: name, fulfillmentType, channel: 'COUNTER', notes: 'Conferir antes de liberar', pizzas: [pizza], extras: [] } });
      assert.equal(response.status(), 201); let order = await response.json();
      for (const command of commands) {
        const item = order.items[0], finishing = ['START_FINISHING', 'CHECK_PIZZA', 'CONFIRM_PACKAGING', 'RELEASE_TO_DISPATCH'].includes(command);
        const input = { command, clientCommandId: randomUUID(), expectedVersion: finishing ? order.version : item.production.version };
        if (finishing) { if (['START_FINISHING', 'CHECK_PIZZA'].includes(command)) Object.assign(input, { pizzaId: item.id, expectedItemVersion: item.production.version }); }
        else input.expectedState = item.production.state;
        const result = await page.request.post(`${apiOrigin}/orders/v2/${order.id}/${finishing ? 'finishing' : `pizzas/${item.id}`}/commands`, { headers: auth, data: input });
        assert.equal(result.status(), 200, await result.text()); order = (await result.json()).order;
      }
    }
    const assembly = ['START_ASSEMBLY', 'SEND_TO_OVEN'], baked = [...assembly, 'ENTER_OVEN', 'REMOVE_FROM_OVEN'];
    await create('Montagem visual', []);
    await create('Aguardando forno', assembly);
    await create('No forno', [...assembly, 'ENTER_OVEN']);
    await create('Em conferência', [...baked, 'START_FINISHING']);
    await create('Pizza conferida', [...baked, 'START_FINISHING', 'CHECK_PIZZA']);
    await create('Delivery liberado', [...baked, 'START_FINISHING', 'CHECK_PIZZA', 'CONFIRM_PACKAGING', 'RELEASE_TO_DISPATCH']);
    await create('Retirada liberada', [...baked, 'START_FINISHING', 'CHECK_PIZZA', 'CONFIRM_PACKAGING', 'RELEASE_TO_DISPATCH'], 'PICKUP');
    const legacy = await page.request.post(`${apiOrigin}/orders`, { data: { customerName: 'Fila visual', type: 'DELIVERY', items: [{ name: 'Calabresa', size: 'Grande', ingredients: 'Calabresa, cebola', modifiers: [{ kind: 'REMOVED', name: 'cebola' }], notes: 'Conferir identificação' }] } });
    assert.equal(legacy.status(), 201);
    for (const [width, height] of [[1024, 768], [1280, 800], [1366, 768]]) {
      await page.setViewportSize({ width, height });
      for (const [route, ready] of [['assembly', '.ka-pizza-card'], ['oven', '.oven-card'], ['finishing', '.finishing-item'], ['dispatch', '.dispatch-order'], ['queue', '.ko-orders'], ['form', '.pizza-form']]) {
        await page.goto(`${webOrigin}/${route === 'queue' ? 'kitchen' : route === 'form' ? 'orders/new' : `kitchen/${route}`}`);
        await page.locator(ready).first().waitFor(); await page.evaluate(() => scrollTo(0, 0));
        if (route === 'queue') assert.equal(await page.locator('.ko-order button').count(), 0, 'Central: não deve oferecer comandos de produção');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route} ${width}: overflow horizontal`);
        assert.ok(await page.evaluate(() => ![...document.querySelectorAll('.button')].some(button => button.getBoundingClientRect().height < 44)), `${route}: alvo touch insuficiente`);
        await page.screenshot({ path: resolve(shots, `${route}-${width}x${height}.png`) });
        if (['oven', 'finishing', 'dispatch'].includes(route)) {
          await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
          assert.ok(await page.locator('.oven-header').evaluate(header => { const rect = header.getBoundingClientRect(); return rect.top >= -1 && rect.top <= 8 && rect.bottom <= innerHeight; }), `${route}: cabeçalho não permanece visível`);
          await page.screenshot({ path: resolve(shots, `${route}-scroll-${width}x${height}.png`) });
        }
      }
    }
    assert.deepEqual(errors, []);
    console.info(`PASS visual: Montagem, Forno, Finalização, Despacho, Fila e formulário v2, 1024×768/1280×800/1366×768, overflow, touch e cabeçalho durante scroll. Capturas: ${shots}`);
  } finally {
    await browser.close();
    if (web.exitCode === null) { const exited = new Promise(done => web.once('exit', done)); web.kill(); await exited; }
  }
}, { webOrigin, operatorFixtures: true });
