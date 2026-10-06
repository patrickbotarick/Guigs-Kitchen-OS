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
assert.ok(executablePath, 'Edge/Chrome necessário');
const webOrigin = 'http://127.0.0.1:5183';
const serverEnv = { OVEN_DEFAULT_MINUTES: '0.1', OVEN_CAPACITY: '' };
async function until(check, message, timeout = 15000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; await new Promise(done => setTimeout(done, 100)); } throw new Error(message); }
const card = (page, id) => page.locator(`[data-pizza-id="${id}"]`);
const headers = page => page.evaluate(() => ({ Authorization: `Bearer ${localStorage.getItem('guigs-operator-session-token')}`, 'X-Workstation-Device-Key': localStorage.getItem('guigs-workstation-device-key') }));
await withIsolatedApi(3352, async ({ prisma, apiOrigin, restart }) => {
  const web = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5183', '--strictPort'], { cwd: resolve('apps/web'), env: { ...process.env, VITE_API_URL: apiOrigin }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    await new Promise((done, reject) => { const timer = setTimeout(() => reject(new Error('Vite não iniciou')), 10000); web.once('exit', code => { clearTimeout(timer); reject(new Error(`Vite encerrou: ${code}`)); }); web.stdout.on('data', value => { if (String(value).includes('5183')) { clearTimeout(timer); done(); } }); web.stderr.on('data', value => { clearTimeout(timer); reject(new Error(String(value))); }); });
    const contexts = [], pages = [], errors = [], ovenPosts = [];
    for (let index = 0; index < 3; index++) {
      const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true }); contexts.push(context);
      if (index === 2) await context.addInitScript(() => { const realNow = Date.now; Date.now = () => realNow() + 300000; }); // Timer must tolerate a tablet clock five minutes ahead.
      const page = await context.newPage(); pages.push(page); page.on('pageerror', error => errors.push(error.message));
      page.on('response', async response => { if (response.url().endsWith('/commands')) { const input = response.request().postDataJSON(); if (['ENTER_OVEN', 'REMOVE_FROM_OVEN'].includes(input.command)) ovenPosts.push({ index, input, status: response.status() }); } });
      await page.goto(`${webOrigin}/kitchen/${index === 0 ? 'assembly' : 'oven'}`); await loginPin(page, operatorFixtures[index].pin);
      if (index) { await page.getByRole('button', { name: 'Receber novas pizzas de montagem', exact: true }).click(); await until(async () => await page.getByRole('button', { name: 'Receber novas pizzas de montagem', exact: true }).getAttribute('aria-pressed') === 'false', 'Recebimento não suspendeu'); await page.getByLabel('Conexão Forno', { exact: true }).getByText('Online', { exact: true }).waitFor(); await page.getByText('Nenhuma pizza aguardando forno', { exact: true }).waitFor(); await page.getByText('Nenhuma pizza no forno', { exact: true }).waitFor(); }
    }
    const [assembly, a] = pages, form = await contexts[0].newPage(); let b = pages[2];
    await form.goto(`${webOrigin}/orders/new`); await form.getByLabel('Cliente *').fill('Montagem para forno integrado');
    await form.getByLabel('Observação do pedido', { exact: true }).fill('Conferir identificação');
    await form.getByRole('button', { name: '+ Adicionar pizza', exact: true }).click(); await form.getByRole('button', { name: '+ Adicionar pizza', exact: true }).click();
    const builders = form.locator('.pizza-form'); await builders.nth(0).getByLabel('Tamanho da pizza 1', { exact: true }).selectOption('BROTO');
    await builders.nth(1).getByLabel('Composição da pizza 2', { exact: true }).selectOption('HALF_HALF');
    await builders.nth(1).getByLabel('Sabor — 2ª metade', { exact: true }).selectOption('portuguesa');
    await form.getByRole('button', { name: 'Criar pedido →', exact: true }).click(); await form.getByRole('heading', { name: /aguardando montagem/ }).waitFor();
    const first = (await (await form.request.get(`${apiOrigin}/orders/v2`)).json()).find(order => order.customerName === 'Montagem para forno integrado');
    const joao = await prisma.operator.findUniqueOrThrow({ where: { name: operatorFixtures[0].name } }); assert.ok(first.items.every(pizza => pizza.assignment.operatorId === joao.id));
    await assembly.getByRole('heading', { name: `Pedido #${first.number}`, exact: true }).waitFor();
    for (const pizza of first.items) {
      await assembly.getByRole('button', { name: new RegExp(`^Pizza ${pizza.position + 1},`) }).click(); await assembly.getByRole('button', { name: 'Iniciar montagem', exact: true }).click(); await assembly.getByRole('button', { name: /Enviar pro forno/ }).waitFor();
      await until(async () => await assembly.getByRole('button', { name: /Enviar pro forno/ }).isEnabled(), 'Enviar não habilitou'); await assembly.getByRole('button', { name: /Enviar pro forno/ }).click();
      await until(async () => (await prisma.pizzaItem.findUniqueOrThrow({ where: { id: pizza.id } })).state === 'WAITING_OVEN', 'Montagem não enviou');
      for (const page of [a, b]) await card(page, pizza.id).getByRole('button', { name: 'Colocar no forno', exact: true }).waitFor();
    }
    assert.match(await card(a, first.items[0].id).innerText(), /Broto/); assert.match(await card(a, first.items[1].id).innerText(), /Calabresa \/ Portuguesa/); assert.match(await card(a, first.items[1].id).innerText(), /Meio a meio/);
    assert.match(await card(a, first.items[0].id).innerText(), /João fixture/); assert.doesNotMatch(await a.locator('.oven-columns').innerText(), /Ingredientes|R\$/);
    async function act(page, pizzaId, label) { const action = card(page, pizzaId).getByRole('button', { name: label, exact: true }); await action.waitFor(); await until(() => action.isEnabled(), `${label} bloqueado`); await action.click(); }
    async function insideBoth(id) { for (const page of [a, b]) await card(page, id).getByRole('button', { name: 'Retirar do forno', exact: true }).waitFor(); }
    await act(a, first.items[0].id, 'Colocar no forno'); await insideBoth(first.items[0].id);
    await act(b, first.items[1].id, 'Colocar no forno'); await insideBoth(first.items[1].id);
    const stored = await prisma.pizzaItem.findUniqueOrThrow({ where: { id: first.items[1].id } }); assert.equal(stored.ovenExpectedEndAt - stored.ovenStartedAt, 6000);
    await b.reload(); await b.getByLabel('Conexão Forno', { exact: true }).getByText('Online', { exact: true }).waitFor();
    const elapsedText = await card(b, first.items[1].id).getByLabel('Tempo no forno', { exact: true }).innerText(); const [minutes, seconds] = elapsedText.split(':').map(Number); assert.ok(Math.abs(minutes * 60 + seconds - Math.floor((Date.now() - stored.ovenStartedAt.getTime()) / 1000)) <= 3, 'Refresh/relógio do tablet reiniciou ou deslocou timer');
    await b.close(); b = await contexts[2].newPage();
    b.on('pageerror', error => errors.push(error.message));
    b.on('response', response => { if (response.url().endsWith('/commands')) { const input = response.request().postDataJSON(); if (['ENTER_OVEN', 'REMOVE_FROM_OVEN'].includes(input.command)) ovenPosts.push({ index: 2, input, status: response.status() }); } });
    await b.goto(`${webOrigin}/kitchen/oven`); await b.getByLabel('Conexão Forno', { exact: true }).getByText('Online', { exact: true }).waitFor();
    const reopenedTime = (await card(b, first.items[1].id).getByLabel('Tempo no forno', { exact: true }).innerText()).split(':').map(Number);
    assert.ok(Math.abs(reopenedTime[0] * 60 + reopenedTime[1] - Math.floor((Date.now() - stored.ovenStartedAt.getTime()) / 1000)) <= 3, 'Reabrir aba reiniciou timer');
    await act(a, first.items[0].id, 'Retirar do forno'); await until(async () => await card(b, first.items[0].id).count() === 0, 'Retirada não propagou');
    let drop = true; const dropped = [];
    await a.route('**/orders/v2/*/pizzas/*/commands', async route => {
      const request = route.request(), input = request.postDataJSON();
      if (request.url().includes(first.items[2].id) && input.command === 'ENTER_OVEN') {
        dropped.push(input); if (drop) { drop = false; const response = await a.request.fetch(request.url(), { method: request.method(), headers: request.headers(), data: request.postData() }); assert.equal(response.status(), 200); await route.abort('failed'); return; }
      }
      await route.continue();
    });
    await act(a, first.items[2].id, 'Colocar no forno'); await a.getByRole('button', { name: 'Confirmar comando novamente', exact: true }).waitFor();
    await a.reload(); await a.getByLabel('Conexão Forno', { exact: true }).getByText('Online', { exact: true }).waitFor(); await a.getByRole('button', { name: 'Confirmar comando novamente', exact: true }).click();
    await until(async () => await a.getByRole('button', { name: 'Confirmar comando novamente', exact: true }).count() === 0, 'Replay não confirmou'); assert.equal(dropped[0].clientCommandId, dropped[1].clientCommandId); await insideBoth(first.items[2].id);
    assert.equal(await prisma.pizzaProductionHistory.count({ where: { pizzaId: first.items[2].id, eventType: 'ENTER_OVEN' } }), 1);
    const status = await prisma.order.findUniqueOrThrow({ where: { id: first.id } }); assert.equal(status.status, 'OVEN');
    const shots = resolve(tmpdir(), 'guigs-oven-validation'); mkdirSync(shots, { recursive: true });
    await until(async () => /Tempo atingido|Acima do tempo/.test(await card(a, first.items[1].id).innerText()), 'Indicador não atingiu previsão'); assert.equal((await prisma.pizzaItem.findUniqueOrThrow({ where: { id: first.items[1].id } })).state, 'IN_OVEN');
    await a.screenshot({ path: resolve(shots, 'oven-tablet.png'), fullPage: true }); assert.ok(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Forno com scroll horizontal');
    for (const id of [first.items[1].id, first.items[2].id]) {
      await act(a, id, 'Retirar do forno');
      try { await until(async () => !(await card(a, id).count()), 'Retirada não concluiu'); }
      catch (error) { console.info({ state: await prisma.pizzaItem.findUnique({ where: { id }, select: { state: true, version: true } }), posts: ovenPosts.map(post => ({ index: post.index, command: post.input.command, status: post.status })), ui: await a.locator('.oven-page').innerText() }); throw error; }
    }
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: first.id } })).status, 'FINISHING'); for (const page of [a, b]) await page.getByText('Nenhuma pizza no forno', { exact: true }).waitFor();
    const history = await prisma.pizzaProductionHistory.findMany({ where: { pizzaId: first.items[0].id }, orderBy: { itemVersion: 'asc' } }); assert.deepEqual(history.map(event => event.eventType), ['CREATED', 'AUTO_ASSIGNED', 'START_ASSEMBLY', 'SEND_TO_OVEN', 'ENTER_OVEN', 'REMOVE_FROM_OVEN']); assert.equal(history[2].operatorId, joao.id); assert.notEqual(history[4].operatorId, joao.id);
    console.info('Balcão → distribuição → montagem UI → forno UI: 3 pizzas/Broto/meio a meio, 2 tablets realtime, timer após refresh/relógio deslocado, replay após resposta perdida e FINISHING aprovados.');

    const created = await form.request.post(`${apiOrigin}/orders/v2`, { data: { clientRequestId: randomUUID(), customerName: 'Stress forno 30 pizzas', customerPhone: '', notes: '', channel: 'COUNTER', fulfillmentType: 'PICKUP', extras: [], pizzas: Array.from({ length: 30 }, () => ({ size: 'GRANDE', composition: 'WHOLE', firstHalf: { flavorId: 'calabresa', modifiers: [] }, crustId: 'tradicional', notes: null })) } }); assert.equal(created.status(), 201); let stress = await created.json();
    const assemblyHeaders = await headers(assembly);
    for (const pizza of stress.items) for (const command of ['START_ASSEMBLY', 'SEND_TO_OVEN']) { const current = await prisma.pizzaItem.findUniqueOrThrow({ where: { id: pizza.id } }); const response = await form.request.post(`${apiOrigin}/orders/v2/${stress.id}/pizzas/${pizza.id}/commands`, { headers: assemblyHeaders, data: { command, expectedState: current.state, expectedVersion: current.version, clientCommandId: randomUUID() } }); assert.equal(response.status(), 200); }
    for (const page of [a, b]) await until(async () => await page.locator('.oven-card').count() === 30, '30 pizzas não apareceram');
    const firstStress = stress.items[0].id; await until(async () => await card(a, firstStress).getByRole('button', { name: 'Colocar no forno', exact: true }).isEnabled() && await card(b, firstStress).getByRole('button', { name: 'Colocar no forno', exact: true }).isEnabled(), 'Disputa não disponível');
    const oldPosts = ovenPosts.length;
    await Promise.all([a, b].map(page => page.evaluate(id => document.querySelector(`[data-pizza-id="${id}"] button`).click(), firstStress)));
    await until(async () => ovenPosts.slice(oldPosts).length >= 2, 'Dois comandos concorrentes não chegaram'); assert.deepEqual(ovenPosts.slice(oldPosts, oldPosts + 2).map(post => post.status).sort(), [200, 409]);
    await insideBoth(firstStress); await until(async () => /Os dados foram recarregados/.test(await a.locator('.oven-page').innerText()) || /Os dados foram recarregados/.test(await b.locator('.oven-page').innerText()), '409 não recarregou UI');
    const aHeaders = await headers(a), bHeaders = await headers(b);
    for (let start = 1; start < 10; start += 3) await Promise.all(stress.items.slice(start, start + 3).map(async (pizza, index) => { const current = await prisma.pizzaItem.findUniqueOrThrow({ where: { id: pizza.id } }); const response = await a.request.post(`${apiOrigin}/orders/v2/${stress.id}/pizzas/${pizza.id}/commands`, { headers: index % 2 ? aHeaders : bHeaders, data: { command: 'ENTER_OVEN', expectedState: current.state, expectedVersion: current.version, clientCommandId: randomUUID() } }); assert.equal(response.status(), 200); }));
    await until(async () => await a.locator('#oven-inside').innerText() === 'No forno 10', 'Entradas simultâneas não propagaram');
    await contexts[2].setOffline(true); await b.getByLabel('Conexão Forno', { exact: true }).getByText('Offline', { exact: true }).waitFor(); assert.equal(await card(b, firstStress).getByRole('button', { name: 'Retirar do forno', exact: true }).isDisabled(), true);
    await act(a, firstStress, 'Retirar do forno'); await contexts[2].setOffline(false); await b.getByLabel('Conexão Forno', { exact: true }).getByText('Online', { exact: true }).waitFor(); await until(async () => !(await card(b, firstStress).count()), 'Reconexão não recuperou retirada perdida');
    await restart(); for (const page of [a, b]) await page.getByLabel('Conexão Forno', { exact: true }).getByText('Online', { exact: true }).waitFor();
    stress = await (await form.request.get(`${apiOrigin}/orders/v2/${stress.id}`)).json(); assert.equal(stress.items.filter(item => item.production.state === 'IN_OVEN').length, 9); assert.equal(stress.items.filter(item => item.production.state === 'WAITING_OVEN').length, 20); assert.equal(stress.items.filter(item => item.production.state === 'BAKED').length, 1);
    await a.screenshot({ path: resolve(shots, 'oven-stress-tablet.png'), fullPage: true });
    await a.setViewportSize({ width: 768, height: 1024 }); assert.ok(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Tablet retrato com scroll horizontal'); assert.ok(await a.locator('.oven-card > button').first().evaluate(button => button.getBoundingClientRect().height >= 44), 'Alvo touch insuficiente'); await a.screenshot({ path: resolve(shots, 'oven-portrait-tablet.png'), fullPage: true });
    // Phase 4B: same two operational tablets, capacity changed only in this isolated API.
    for (const pizza of stress.items.filter(item => item.production.state === 'IN_OVEN')) {
      const current = await prisma.pizzaItem.findUniqueOrThrow({ where: { id: pizza.id } });
      const response = await a.request.post(`${apiOrigin}/orders/v2/${stress.id}/pizzas/${pizza.id}/commands`, { headers: aHeaders, data: { command: 'REMOVE_FROM_OVEN', expectedState: current.state, expectedVersion: current.version, clientCommandId: randomUUID() } }); assert.equal(response.status(), 200);
    }
    serverEnv.OVEN_CAPACITY = '3'; serverEnv.OVEN_DEFAULT_MINUTES = '0.2'; await restart();
    const fiveResponse = await form.request.post(`${apiOrigin}/orders/v2`, { data: { clientRequestId: randomUUID(), customerName: 'Capacidade 3 de 5', customerPhone: '', notes: '', channel: 'COUNTER', fulfillmentType: 'PICKUP', extras: [], pizzas: Array.from({ length: 5 }, () => ({ size: 'GRANDE', composition: 'WHOLE', firstHalf: { flavorId: 'calabresa', modifiers: [] }, crustId: 'tradicional', notes: null })) } }); assert.equal(fiveResponse.status(), 201); const five = await fiveResponse.json();
    for (const pizza of five.items) for (const command of ['START_ASSEMBLY', 'SEND_TO_OVEN']) {
      const current = await prisma.pizzaItem.findUniqueOrThrow({ where: { id: pizza.id } });
      const response = await form.request.post(`${apiOrigin}/orders/v2/${five.id}/pizzas/${pizza.id}/commands`, { headers: assemblyHeaders, data: { command, expectedState: current.state, expectedVersion: current.version, clientCommandId: randomUUID() } }); assert.equal(response.status(), 200);
    }
    await a.setViewportSize({ width: 1024, height: 768 }); await b.setViewportSize({ width: 1280, height: 800 });
    for (const page of [a, b]) await until(async () => /Forno 0 \/ 3/.test(await page.getByLabel('Ocupação do forno', { exact: true }).innerText()), 'Capacidade após restart não refletiu');
    await act(a, five.items[0].id, 'Colocar no forno'); await insideBoth(five.items[0].id);
    await act(b, five.items[1].id, 'Colocar no forno'); await insideBoth(five.items[1].id);
    for (const page of [a, b]) await until(async () => /Forno 2 \/ 3/.test(await page.getByLabel('Ocupação do forno', { exact: true }).innerText()), 'Ocupação 2/3 ausente');
    for (const [page, pizza] of [[a, five.items[2]], [b, five.items[3]]]) await until(() => card(page, pizza.id).getByRole('button', { name: 'Colocar no forno', exact: true }).isEnabled(), 'Última vaga não liberada');
    const capacityPosts = ovenPosts.length;
    await Promise.all([[a, five.items[2]], [b, five.items[3]]].map(([page, pizza]) => page.evaluate(id => document.querySelector(`[data-pizza-id="${id}"] button`).click(), pizza.id)));
    await until(() => ovenPosts.slice(capacityPosts).length >= 2, 'Disputa da última vaga não chegou'); assert.deepEqual(ovenPosts.slice(capacityPosts, capacityPosts + 2).map(post => post.status).sort(), [200, 409]);
    let fiveStored = await prisma.pizzaItem.findMany({ where: { orderId: five.id } }); assert.equal(fiveStored.filter(pizza => pizza.state === 'IN_OVEN').length, 3); assert.equal(fiveStored.filter(pizza => pizza.state === 'WAITING_OVEN').length, 2);
    for (const page of [a, b]) { await until(async () => /Forno 3 \/ 3/.test(await page.getByLabel('Ocupação do forno', { exact: true }).innerText()), 'Forno 3/3 não propagou'); await page.getByText('Forno cheio', { exact: true }).waitFor(); for (const pizza of fiveStored.filter(pizza => pizza.state === 'WAITING_OVEN')) assert.equal(await card(page, pizza.id).getByRole('button', { name: 'Colocar no forno', exact: true }).isDisabled(), true); }
    const waitingId = fiveStored.find(pizza => pizza.state === 'WAITING_OVEN').id;
    await act(a, five.items[0].id, 'Retirar do forno');
    for (const page of [a, b]) await until(async () => /Forno 2 \/ 3/.test(await page.getByLabel('Ocupação do forno', { exact: true }).innerText()), 'Retirada não abriu vaga');
    await act(b, waitingId, 'Colocar no forno'); await insideBoth(waitingId);
    await b.reload(); await b.getByLabel('Conexão Forno', { exact: true }).getByText('Online', { exact: true }).waitFor(); await insideBoth(waitingId);
    fiveStored = await prisma.pizzaItem.findMany({ where: { orderId: five.id } }); assert.equal(fiveStored.filter(pizza => pizza.state === 'IN_OVEN').length, 3);
    for (const [page, label] of [[a, '1024x768'], [b, '1280x800']]) { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: scroll horizontal`); assert.ok(await card(page, waitingId).getByRole('button', { name: 'Retirar do forno', exact: true }).evaluate(button => button.getBoundingClientRect().height >= 44)); await page.screenshot({ path: resolve(shots, `oven-capacity-${label}.png`), fullPage: true }); }
    const historical = fiveStored.find(pizza => pizza.id === waitingId).ovenExpectedEndAt.getTime();
    serverEnv.OVEN_CAPACITY = '2'; serverEnv.OVEN_DEFAULT_MINUTES = '0.3'; await restart();
    for (const page of [a, b]) await until(async () => /Forno 3 \/ 2/.test(await page.getByLabel('Ocupação do forno', { exact: true }).innerText()), 'Redução de capacidade não refletiu');
    assert.equal((await prisma.pizzaItem.findUniqueOrThrow({ where: { id: waitingId } })).ovenExpectedEndAt.getTime(), historical);
    serverEnv.OVEN_CAPACITY = '4'; await restart(); const lastWaiting = fiveStored.find(pizza => pizza.state === 'WAITING_OVEN').id;
    await act(a, lastWaiting, 'Colocar no forno'); await insideBoth(lastWaiting);
    const newTime = await prisma.pizzaItem.findUniqueOrThrow({ where: { id: lastWaiting } }); assert.equal(newTime.ovenExpectedEndAt - newTime.ovenStartedAt, 18000);
    console.info('Fase 4B PASS: capacidade 3/3 em cinco pizzas, última vaga disputada por pizzas diferentes (200/409), retirada abre vaga, refresh, configuração 3→2→4 sem reescrever previsão, tablets 1024×768 e 1280×800.');
    assert.deepEqual(errors, []); console.info('Stress básico: 30 pizzas, duas entradas disputadas (200/409), 10 entradas em lotes, várias no forno, perda de rede/GET, API reiniciada, tablets paisagem/retrato e timestamps persistidos aprovados.');
  } finally { await browser.close(); if (web.exitCode === null) { const exited = new Promise(done => web.once('exit', done)); web.kill(); await exited; } }
}, { webOrigin, operatorFixtures: true, serverEnv });
