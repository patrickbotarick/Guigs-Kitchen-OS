import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { chromium } from 'playwright-core';
import { withIsolatedApi } from './helpers/isolated-api.mjs';
import { loginPin } from './helpers/operator-fixtures.mjs';

const executablePath = [process.env.BROWSER_PATH, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean).find(existsSync);
assert.ok(executablePath, 'Edge/Chrome necessário');
const origin = 'http://127.0.0.1:5190', shots = resolve('artifacts/ui-audit/round1');
mkdirSync(shots, { recursive: true });
await withIsolatedApi(3360, async ({ apiOrigin, prisma }) => {
  for (const [name, pin, role] of [['Atendente fixture', '7159', 'ASSEMBLER'], ['Supervisor fixture', '8260', 'SUPERVISOR']]) {
    const salt = randomBytes(16), hash = scryptSync(pin, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    await prisma.operator.create({ data: { name, role, pinHash: `scrypt$16384$8$1$${salt.toString('hex')}$${hash.toString('hex')}` } });
  }
  const web = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5190', '--strictPort'], { cwd: resolve('apps/web'), env: { ...process.env, VITE_API_URL: apiOrigin }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    await new Promise((done, reject) => { const timer = setTimeout(() => reject(Error('Vite não iniciou')), 15000); web.once('exit', code => { clearTimeout(timer); reject(Error(`Vite encerrou ${code}`)); }); web.stdout.on('data', data => { if (String(data).includes('5190')) { clearTimeout(timer); done(); } }); });
    const contexts = await Promise.all(Array.from({ length: 5 }, () => browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true })));
    const pages = await Promise.all(contexts.map(c => c.newPage()));
    contexts.forEach(context => context.setDefaultTimeout(15000));
    const errors = [], records = [], geometry = [];
    pages.forEach(p => p.on('pageerror', e => errors.push(e.message)));
    const stations = [['/kitchen/assembly', '4826'], ['/kitchen/assembly', '5937'], ['/kitchen/finishing', '6048'], ['/counter/dispatch', '7159'], ['/kitchen', '8260']];
    for (let i = 0; i < pages.length; i++) {
      await pages[i].goto(origin + stations[i][0]);
      if (i === 4) await pages[i].getByRole('button', { name: 'Identificar operador', exact: true }).click();
      await loginPin(pages[i], stations[i][1]);
      const key = await pages[i].evaluate(() => localStorage.getItem('guigs-workstation-device-key'));
      const s = await prisma.operatorSession.findFirstOrThrow({ where: { active: true, workstation: { deviceKey: key } }, include: { workstation: true } });
      records.push({ index: i, available: s.available, station: s.workstation.stationKind, operatorId: s.operatorId, workstationId: s.workstationId });
    }
    assert.deepEqual(records.map(r => r.available), [true, true, false, false, false]);
    assert.equal(new Set(records.map(r => r.workstationId)).size, 5);
    // Headless Chromium reports all tabs as visible/focused. Control those
    // browser events for this regression; API/session behavior remains real.
    const companion = await contexts[0].newPage(); await pages[0].bringToFront();
    await companion.addInitScript(() => Object.defineProperty(document, 'visibilityState', { get: () => window.round1FocusedTab ? 'visible' : 'hidden' }));
    await companion.goto(origin + '/kitchen'); await companion.getByLabel('Identidade operacional', { exact: true }).waitFor();
    assert.equal((await prisma.workstation.findUniqueOrThrow({ where: { id: records[0].workstationId } })).stationKind, 'ASSEMBLY');
    async function stationIs(kind) {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) { if ((await prisma.workstation.findUniqueOrThrow({ where: { id: records[0].workstationId } })).stationKind === kind) return; await new Promise(done => setTimeout(done, 100)); }
      assert.fail(`Contexto ativo não mudou para ${kind}`);
    }
    await companion.evaluate(() => { window.round1FocusedTab = true; document.dispatchEvent(new Event('visibilitychange')); }); await stationIs('SUPERVISION');
    await companion.evaluate(() => { window.round1FocusedTab = false; document.dispatchEvent(new Event('visibilitychange')); });
    await pages[0].evaluate(() => window.dispatchEvent(new Event('focus'))); await stationIs('ASSEMBLY'); await companion.close();
    const receiving = pages[0].getByRole('button', { name: 'Receber novas pizzas neste tablet', exact: true });
    await pages[0].waitForFunction(() => { const button = document.querySelector('button[aria-label="Receber novas pizzas neste tablet"]'); return !button.disabled && button.getAttribute('aria-pressed') === 'true'; });
    await receiving.click(); await pages[0].waitForFunction(() => { const button = document.querySelector('button[aria-label="Receber novas pizzas neste tablet"]'); return !button.disabled && button.getAttribute('aria-pressed') === 'false'; });
    assert.equal((await prisma.workstation.findUniqueOrThrow({ where: { id: records[0].workstationId } })).receivingEnabled, false);
    await pages[0].reload(); await pages[0].getByLabel('Identidade operacional', { exact: true }).waitFor();
    assert.equal(await receiving.getAttribute('aria-pressed'), 'false');
    await receiving.click(); await pages[0].waitForFunction(() => { const button = document.querySelector('button[aria-label="Receber novas pizzas neste tablet"]'); return !button.disabled && button.getAttribute('aria-pressed') === 'true'; });
    const form = await contexts[3].newPage(); await form.goto(origin + '/orders/new');
    await form.getByLabel('Cliente *').fill('Rodada 1 conferência física');
    await form.getByLabel('Borda da pizza 1', { exact: true }).selectOption('requeijao');
    const editor = form.locator('.pizza-form.is-active-editor');
    await editor.getByLabel('cebola', { exact: true }).uncheck();
    await editor.getByLabel('Adicional — Sabor único', { exact: true }).selectOption('bacon');
    await editor.locator('.ka-builder-add').getByRole('button', { name: 'Adicionar', exact: true }).click();
    await form.getByRole('button', { name: '+ Adicionar pizza', exact: true }).click();
    await form.getByLabel('Composição da pizza 2', { exact: true }).selectOption('HALF_HALF');
    await editor.getByLabel('Sabor — 2ª metade', { exact: true }).selectOption('portuguesa');
    await editor.getByLabel('Adicional — 2ª metade', { exact: true }).selectOption('bacon');
    await editor.locator('.ka-builder-add').filter({ has: form.getByLabel('Adicional — 2ª metade', { exact: true }) }).getByRole('button', { name: 'Adicionar', exact: true }).click();
    await form.getByRole('button', { name: '+ Adicionar pizza', exact: true }).click();
    await form.getByLabel('Tamanho da pizza 3', { exact: true }).selectOption('BROTO');
    await editor.getByLabel('Sabor — Sabor único', { exact: true }).selectOption('mussarela');
    await form.getByRole('button', { name: 'Criar pedido →', exact: true }).click();
    await form.getByRole('heading', { name: /aguardando montagem/ }).waitFor();
    const [created] = await (await pages[0].request.get(apiOrigin + '/orders/v2')).json();
    assert.ok(created.items.every(p => records.slice(0, 2).some(r => r.operatorId === p.assignment.operatorId)));
    await pages[0].locator('.ka-order-subtitle').filter({ hasText: 'Rodada 1 conferência física' }).waitFor({ timeout: 15000 });
    await pages[0].screenshot({ path: resolve(shots, 'montagem-com-pedido.png') });
    async function read() { return (await pages[0].request.get(apiOrigin + '/orders/v2/' + created.id)).json(); }
    async function post(page, path, input) { const headers = await page.evaluate(() => ({ Authorization: `Bearer ${localStorage.getItem('guigs-operator-session-token')}`, 'X-Workstation-Device-Key': localStorage.getItem('guigs-workstation-device-key') })); const r = await page.request.post(apiOrigin + path, { headers, data: { ...input, clientCommandId: randomUUID() } }); assert.ok(r.ok(), await r.text()); return r.json(); }
    for (const initial of created.items) for (const command of ['START_ASSEMBLY', 'SEND_TO_OVEN', 'REMOVE_FROM_OVEN', 'FINISH_PIZZA']) {
      const pizza = (await read()).items.find(p => p.id === initial.id);
      const owner = pages[records.find(r => r.operatorId === pizza.assignment.operatorId).index];
      await post(command === 'START_ASSEMBLY' || command === 'SEND_TO_OVEN' ? owner : pages[2], `/orders/v2/${created.id}/pizzas/${pizza.id}/commands`, { command, expectedState: pizza.production.state, expectedVersion: pizza.production.version });
    }
    let route = (await post(pages[2], '/dispatch/routes/commands', { command: 'CREATE' })).routes[0];
    for (const pizza of created.items) route = (await post(pages[2], `/dispatch/routes/${route.id}/commands`, { command: 'ADD', pizzaId: pizza.id, expectedVersion: route.version })).routes[0];
    await post(pages[2], `/dispatch/routes/${route.id}/commands`, { command: 'CLOSE', expectedVersion: route.version });
    const physical = pages[3].locator('.physical-pizza'); await physical.nth(2).waitFor();
    for (const text of ['Grande', 'Calabresa', 'Requeijão', 'Sem cebola', '+ bacon']) assert.ok((await physical.nth(0).innerText()).includes(text));
    assert.ok((await physical.nth(1).innerText()).includes('Meio a meio')); assert.ok((await physical.nth(1).innerText()).includes('2ª metade (Portuguesa)'));
    assert.ok((await physical.nth(2).innerText()).includes('Broto')); assert.ok((await physical.nth(2).innerText()).includes('Mussarela'));
    const colors = await physical.nth(0).evaluate(e => ({ removed: getComputedStyle(e.querySelector('.ka-ingredient-removed')).color, added: getComputedStyle(e.querySelector('.ka-ingredient-added')).color }));
    assert.notEqual(colors.removed, colors.added);
    await pages[4].getByRole('link', { name: 'Recuperação', exact: true }).click(); await pages[4].getByRole('heading', { name: 'Recuperação supervisionada' }).waitFor();
    await pages[0].goto(origin + '/kitchen/assembly/recovery'); await pages[0].getByRole('alert').filter({ hasText: 'Acesso restrito a supervisor.' }).waitFor();
    await pages[0].goto(origin + '/kitchen/assembly');
    assert.equal(await pages[0].getByRole('button', { name: 'Concluir montagem', exact: true }).count(), 0);
    const map = [['Visão geral', '/kitchen'], ['Montagem', '/kitchen/assembly'], ['Forno e Finalização', '/kitchen/finishing'], ['Despacho', '/counter/dispatch'], ['Simulador de Pedido', '/orders/new'], ['Recuperação', '/kitchen/assembly/recovery']];
    for (const [label, path] of map) {
      await pages[4].locator('.op-navigation > summary').click();
      await pages[4].getByRole('navigation', { name: 'Navegação operacional' }).getByRole('link', { name: label, exact: true }).click();
      await pages[4].waitForURL(origin + path); await pages[4].locator('.op-navigation > summary').waitFor();
      await pages[4].locator('.op-navigation > summary').click();
      assert.equal(await pages[4].getByRole('navigation', { name: 'Navegação operacional' }).getByRole('link', { name: label, exact: true }).getAttribute('aria-current'), 'page');
      await pages[4].locator('.op-navigation > summary').click();
    }
    await pages[0].goto(origin + '/'); await pages[0].waitForURL(origin + '/kitchen');
    await pages[0].goto(origin + '/kitchen/assembly');
    for (const [width, height] of [[1024, 768], [1280, 800], [1366, 768]]) for (const [index, path, selector, label] of [[0, '/kitchen/assembly', '.ka-screen', 'montagem'], [4, '/kitchen', '.kb-columns', 'visao-geral'], [4, '/kitchen/assembly/recovery', '.recovery-page form', 'recuperacao'], [2, '/kitchen/finishing', '.flow-routes', 'forno'], [3, '/counter/dispatch', '.physical-pizza', 'balcao'], [4, '/orders/new', '.pizza-form', 'simulador']]) {
      const page = pages[index]; await page.setViewportSize({ width, height }); await page.goto(origin + path); await page.locator(selector).first().waitFor();
      await page.waitForFunction(() => ![...document.querySelectorAll('[role="status"]')].some(e => /Carregando/.test(e.textContent)));
      if (path !== '/orders/new') await page.getByLabel('Identidade operacional', { exact: true }).waitFor();
      const measurement = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, small: [...document.querySelectorAll('button,a,summary')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44); }).map(e => ({ text: e.textContent.trim(), width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height })) }));
      assert.ok(measurement.documentWidth <= width, `${path}: overflow ${width}`); assert.deepEqual(measurement.small, [], `${path}: touch targets`);
      geometry.push({ path, ...measurement });
      await page.screenshot({ path: resolve(shots, `${label}-${width}x${height}.png`) });
    }
    assert.deepEqual(errors, []);
    writeFileSync(resolve(shots, 'validation.json'), JSON.stringify({ records, tabs: 'visibilidade/foco controlados no Chromium headless', availabilityAfterRefresh: 'suspensão preservada e retomada confirmada', navigation: map, colors, geometry, errors, orderId: created.id }, null, 2));
    console.info(`PASS rodada 1: cinco estações, elegibilidade, contexto entre abas, disponibilidade após refresh, receita física inteira/metades/Broto, navegação, supervisor/negação, touch e três resoluções. ${shots}`);
    // Optional real Android inspection against the same disposable fixtures.
    if (process.env.ROUND1_ANDROID === '1') {
      const finish = resolve(shots, 'android-finish'); rmSync(finish, { force: true });
      console.info('ANDROID_READY: adb reverse tcp:5190 tcp:5190 e tcp:3360 tcp:3360; abrir http://127.0.0.1:5190; criar android-finish para encerrar.');
      const deadline = Date.now() + 30 * 60_000;
      while (!existsSync(finish) && Date.now() < deadline) await new Promise(done => setTimeout(done, 1000));
      rmSync(finish, { force: true });
    }
  } finally { await browser.close(); if (web.exitCode === null) { const exited = new Promise(done => web.once('exit', done)); web.kill(); await exited; } }
}, { webOrigin: origin, operatorFixtures: true });
