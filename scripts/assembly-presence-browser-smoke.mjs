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
const webOrigin = 'http://127.0.0.1:5182';
async function until(check, message, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await new Promise(done => setTimeout(done, 150)); }
  throw new Error(message);
}
await withIsolatedApi(3351, async ({ prisma, apiOrigin, restart }) => {
  // Supervisor exists only in this disposable database; the store requires administrative configuration.
  await prisma.operator.update({ where: { name: operatorFixtures[1].name }, data: { role: 'SUPERVISOR' } });
  const web = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5182', '--strictPort'], {
    cwd: resolve('apps/web'), env: { ...process.env, VITE_API_URL: apiOrigin }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    await new Promise((done, reject) => {
      const timeout = setTimeout(() => reject(new Error('Vite isolado não iniciou')), 10000);
      web.once('exit', code => { clearTimeout(timeout); reject(new Error(`Vite encerrou: ${code}`)); });
      web.stdout.on('data', data => { if (String(data).includes('5182')) { clearTimeout(timeout); done(); } });
      web.stderr.on('data', data => { clearTimeout(timeout); reject(new Error(String(data))); });
    });
    const contexts = [], pages = [], errors = [];
    for (let index = 0; index < 3; index++) {
      const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true }); contexts.push(context);
      const page = await context.newPage(); pages.push(page); page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${webOrigin}/kitchen/assembly`); await loginPin(page, operatorFixtures[index].pin);
      await page.getByLabel('Conexão Assembly', { exact: true }).getByText('Online', { exact: true }).waitFor();
    }
    const active = await prisma.operatorSession.findMany({ where: { active: true }, include: { operator: true } });
    const actors = operatorFixtures.map(fixture => active.find(session => session.operator.name === fixture.name));
    const form = await contexts[0].newPage();
    async function create(customer, count) {
      await form.goto(`${webOrigin}/orders/new`); await form.getByLabel('Cliente *').fill(customer);
      for (let index = 1; index < count; index++) await form.getByRole('button', { name: '+ Adicionar pizza', exact: true }).click();
      await form.getByRole('button', { name: 'Criar pedido →', exact: true }).click(); await form.getByRole('heading', { name: /aguardando montagem/ }).waitFor();
      return (await (await form.request.get(`${apiOrigin}/orders/v2`)).json()).find(order => order.customerName === customer);
    }
    const first = await create('Presença três tablets', 9);
    for (let index = 0; index < 3; index++) {
      assert.equal(first.items.filter(item => item.assignment?.operatorId === actors[index].operatorId).length, 3);
      await pages[index].getByRole('heading', { name: `Pedido #${first.number}`, exact: true }).waitFor();
    }
    await pages[2].getByRole('button', { name: 'Iniciar montagem', exact: true }).click();
    const pedroPizzas = first.items.filter(item => item.assignment?.operatorId === actors[2].operatorId);
    await until(async () => Boolean(await prisma.pizzaItem.findFirst({ where: { orderId: first.id, assignedOperatorId: actors[2].operatorId, state: 'ASSEMBLING' } })), 'Pedro não iniciou');
    const assembling = await prisma.pizzaItem.findFirstOrThrow({ where: { orderId: first.id, assignedOperatorId: actors[2].operatorId, state: 'ASSEMBLING' } });
    await contexts[2].setOffline(true);
    await until(async () => (await prisma.operatorSession.findUniqueOrThrow({ where: { id: actors[2].id } })).presenceStatus === 'STALE', 'Pedro não ficou stale');
    await until(async () => (await prisma.operatorSession.findUniqueOrThrow({ where: { id: actors[2].id } })).presenceStatus === 'OFFLINE', 'Pedro não ficou offline');
    const second = await create('Pedido sem Pedro', 6);
    assert.equal(second.items.some(item => item.assignment?.operatorId === actors[2].operatorId), false);
    assert.equal(await prisma.pizzaItem.count({ where: { orderId: first.id, assignedOperatorId: actors[2].operatorId } }), 3);
    for (const page of pages.slice(0, 2)) await page.getByRole('button', { name: new RegExp(`Pedido #${second.number},`) }).waitFor();
    const supervisor = pages[1]; await supervisor.getByRole('link', { name: 'Recuperar pizzas', exact: true }).click();
    await supervisor.getByRole('heading', { name: 'Recuperação supervisionada', exact: true }).waitFor();
    await supervisor.getByLabel('Pizza para recuperação').selectOption(assembling.id);
    await supervisor.getByLabel('Motivo da recuperação').fill('Tablet Pedro offline; bancada conferida');
    await until(async () => (await supervisor.getByLabel('Destino da recuperação').locator('option').allTextContents()).some(value => value.includes('Carlos')), 'Carlos ausente dos destinos');
    await supervisor.getByLabel('Destino da recuperação').selectOption(actors[1].id);
    const recoveryShots = resolve(tmpdir(), 'guigs-presence-validation'); mkdirSync(recoveryShots, { recursive: true });
    await supervisor.screenshot({ path: resolve(recoveryShots, 'recovery-tablet.png'), fullPage: true });
    assert.ok(await supervisor.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Recuperação não deve exigir scroll horizontal');
    assert.equal(await supervisor.getByRole('button', { name: 'Reatribuir sob supervisão', exact: true }).isDisabled(), true);
    await supervisor.getByRole('button', { name: 'Pausar sob supervisão', exact: true }).click();
    await until(async () => (await prisma.pizzaItem.findUniqueOrThrow({ where: { id: assembling.id } })).state === 'ASSEMBLY_PAUSED', 'Pausa supervisionada não persistiu');
    await until(async () => await supervisor.getByRole('button', { name: 'Reatribuir sob supervisão', exact: true }).isEnabled(), 'Reassign permaneceu bloqueado');
    await supervisor.getByRole('button', { name: 'Reatribuir sob supervisão', exact: true }).click();
    await until(async () => (await prisma.pizzaItem.findUniqueOrThrow({ where: { id: assembling.id } })).assignedOperatorId === actors[1].operatorId, 'Reassign não persistiu');
    const released = pedroPizzas.find(pizza => pizza.id !== assembling.id);
    await supervisor.getByLabel('Pizza para recuperação').selectOption(released.id);
    await supervisor.getByLabel('Motivo da recuperação').fill('Liberar para escolha manual após indisponibilidade');
    await supervisor.getByRole('button', { name: 'Liberar sob supervisão', exact: true }).click();
    await until(async () => !(await prisma.pizzaItem.findUniqueOrThrow({ where: { id: released.id } })).assignedOperatorId, 'Liberação não persistiu');
    await pages[0].getByRole('button', { name: 'Disponíveis', exact: true }).click();
    await pages[0].getByRole('button', { name: new RegExp(`^Pizza ${released.position + 1},`) }).waitFor();
    const history = await prisma.pizzaProductionHistory.findMany({ where: { pizzaId: assembling.id }, orderBy: { changedAt: 'asc' } });
    assert.deepEqual(history.map(event => event.eventType), ['CREATED', 'AUTO_ASSIGNED', 'START_ASSEMBLY', 'SUPERVISOR_PAUSED', 'SUPERVISOR_REASSIGNED']);
    assert.equal(history[2].operatorId, actors[2].operatorId); assert.equal(history[4].operatorId, actors[1].operatorId);
    assert.equal(history[4].metadata.previousOperatorId, actors[2].operatorId); assert.equal(history[4].metadata.newOperatorId, actors[1].operatorId);
    await supervisor.getByRole('link', { name: 'Voltar à montagem', exact: true }).click();
    await supervisor.getByRole('button', { name: new RegExp(`Pedido #${first.number},`) }).click();
    await supervisor.getByRole('button', { name: new RegExp(`^Pizza ${assembling.position + 1},`) }).waitFor();
    await supervisor.getByRole('button', { name: 'Encerrar turno', exact: true }).click(); await supervisor.getByText(/Há pizzas sob sua responsabilidade/).waitFor();
    await supervisor.getByRole('button', { name: 'Continuar montando', exact: true }).click();
    await contexts[2].setOffline(false);
    await until(async () => (await prisma.operatorSession.findUniqueOrThrow({ where: { id: actors[2].id } })).presenceStatus === 'ONLINE', 'Pedro não recuperou presença');
    const third = await create('Pedro voltou', 1); assert.equal(third.items[0].assignment.operatorId, actors[2].operatorId);
    await pages[2].getByRole('button', { name: new RegExp(`Pedido #${third.number},`) }).waitFor();
    await restart();
    const restartedAt = Date.now();
    for (const actor of actors) await until(async () => { const current = await prisma.operatorSession.findUniqueOrThrow({ where: { id: actor.id } }); return current.presenceStatus === 'ONLINE' && current.lastSeenAt?.getTime() >= restartedAt; }, 'Heartbeat novo não confirmou presença após API restart');
    for (const page of pages) await page.getByLabel('Conexão Assembly', { exact: true }).getByText('Online', { exact: true }).waitFor();
    const priorPedro = await prisma.pizzaItem.findMany({ where: { assignedOperatorId: actors[2].operatorId, state: { in: ['WAITING_ASSEMBLY', 'ASSEMBLY_PAUSED'] } } });
    // Closing the actual tab also stops heartbeats, without beforeunload or explicit logout.
    await pages[2].close(); await until(async () => (await prisma.operatorSession.findUniqueOrThrow({ where: { id: actors[2].id } })).presenceStatus === 'OFFLINE', 'Aba fechada permaneceu online');
    const fourth = await create('Pedro fechou aba', 2); assert.equal(fourth.items.some(item => item.assignment?.operatorId === actors[2].operatorId), false);
    for (const pizza of priorPedro) assert.equal((await prisma.pizzaItem.findUniqueOrThrow({ where: { id: pizza.id } })).assignedOperatorId, actors[2].operatorId);
    const shots = resolve(tmpdir(), 'guigs-presence-validation'); mkdirSync(shots, { recursive: true }); await supervisor.screenshot({ path: resolve(shots, 'tablet-supervisor.png'), fullPage: true });
    const recoveredPedro = await contexts[2].newPage(); await recoveredPedro.goto(`${webOrigin}/kitchen/assembly`);
    await recoveredPedro.getByLabel('Identidade operacional', { exact: true }).waitFor();
    await until(async () => (await prisma.operatorSession.findUniqueOrThrow({ where: { id: actors[2].id } })).presenceStatus === 'ONLINE', 'Reabrir Assembly não recuperou sessão');
    // Responsibility must still block ending the supervisor's own session while assigned work is pending.
    const headers = await supervisor.evaluate(() => ({ Authorization: `Bearer ${localStorage.getItem('guigs-operator-session-token')}`, 'X-Workstation-Device-Key': localStorage.getItem('guigs-workstation-device-key') }));
    const endBlocked = await supervisor.request.delete(`${apiOrigin}/operators/session`, { headers }); assert.equal(endBlocked.status(), 409);
    // Complete pending assembly work through real commands, then verify the UI ends a free session and returns to PIN.
    const pending = await prisma.pizzaItem.findMany({ where: { assignedOperatorId: actors[1].operatorId, state: { in: ['WAITING_ASSEMBLY', 'ASSEMBLY_PAUSED'] } } });
    for (const pizza of pending) {
      let expectedVersion = pizza.version;
      const start = await supervisor.request.post(`${apiOrigin}/orders/v2/${pizza.orderId}/pizzas/${pizza.id}/commands`, { headers, data: { command: pizza.state === 'ASSEMBLY_PAUSED' ? 'RESUME_ASSEMBLY' : 'START_ASSEMBLY', expectedState: pizza.state, expectedVersion, clientCommandId: crypto.randomUUID() } }); assert.equal(start.status(), 200);
      expectedVersion++;
      const oven = await supervisor.request.post(`${apiOrigin}/orders/v2/${pizza.orderId}/pizzas/${pizza.id}/commands`, { headers, data: { command: 'SEND_TO_OVEN', expectedState: 'ASSEMBLING', expectedVersion, clientCommandId: crypto.randomUUID() } }); assert.equal(oven.status(), 200);
    }
    await until(async () => await supervisor.getByRole('heading', { name: 'Nenhuma pizza neste filtro', exact: true }).isVisible(), 'Fila Carlos não encerrou montagens');
    await supervisor.getByRole('button', { name: 'Encerrar turno', exact: true }).click();
    await supervisor.getByRole('heading', { name: 'Identifique-se', exact: true }).waitFor();
    assert.equal((await prisma.operatorSession.findUniqueOrThrow({ where: { id: actors[1].id } })).active, false);
    assert.equal(await prisma.operatorSessionEvent.count({ where: { sessionId: actors[1].id, eventType: 'SHIFT_ENDED' } }), 1);
    assert.deepEqual(errors, []); console.info('PASS: 3 tablets, heartbeat, stale/offline, rede/aba, não abandono, pausa/reassign/release supervisor, auditoria, filas realtime, reconexão e API restart.');
  } finally {
    await browser.close(); if (web.exitCode === null) { const exited = new Promise(done => web.once('exit', done)); web.kill(); await exited; }
  }
}, { webOrigin, operatorFixtures: true, serverEnv: { OPERATOR_HEARTBEAT_MS: '1000', OPERATOR_STALE_MS: '4000', OPERATOR_OFFLINE_MS: '7000' } });
