import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { withIsolatedApi } from './helpers/isolated-api.mjs';
import { loginPin } from './helpers/operator-fixtures.mjs';

const executablePath = [process.env.BROWSER_PATH, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean).find(existsSync);
assert.ok(executablePath, 'Edge/Chrome necessário');
await withIsolatedApi(3348, async ({ prisma, apiOrigin }) => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const a = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const b = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const errors = [], posts = [];
    let dropStart = true, release;
    const gate = new Promise(done => { release = done; });
    for (const [context, device] of [[a, 'A'], [b, 'B']]) {
      // This regression intentionally keeps B stale to exercise HTTP 409. Real sockets are tested separately.
      await context.route('**:3333/socket.io/**', route => route.abort());
      context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
      await context.route('**:3333/operators/session', async route => {
        const request = route.request(), response = await context.request.fetch(`${apiOrigin}/operators/session`, { method: request.method(), headers: request.headers(), ...(request.postData() ? { data: request.postData() } : {}) });
        await route.fulfill({ response });
      });
      await context.route('**:3333/orders/v2**', async route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        const response = await context.request.fetch(`${apiOrigin}${path}`, { method: request.method(), headers: request.headers(), ...(request.postData() ? { data: request.postData() } : {}) });
        if (path.endsWith('/commands')) {
          const input = request.postDataJSON(); posts.push({ device, input, status: response.status() });
          if (device === 'A' && dropStart && input.command === 'START_ASSEMBLY') {
            dropStart = false; await gate; await route.abort('failed'); return;
          }
        }
        await route.fulfill({ response });
      });
    }
    const form = await a.newPage();
    await form.goto('http://127.0.0.1:5173/orders/new');
    await form.getByLabel('Cliente *').fill('Comandos reais isolados');
    await form.getByRole('button', { name: 'Criar pedido →', exact: true }).click();
    await form.getByRole('heading', { name: /aguardando montagem/ }).waitFor();
    const [created] = await (await a.request.get(`${apiOrigin}/orders/v2`)).json();
    const pizzaId = created.items[0].id;
    const pageA = await a.newPage(), pageB = await b.newPage();
    for (const page of [pageA, pageB]) {
      await page.goto('http://127.0.0.1:5173/kitchen/assembly');
      await loginPin(page);
      await page.getByRole('heading', { name: `Pedido #${created.number}`, exact: true }).waitFor();
    }
    await pageA.getByRole('button', { name: 'Iniciar montagem', exact: true }).click();
    assert.equal(await pageA.getByRole('button', { name: 'Iniciar montagem', exact: true }).isDisabled(), true);
    await pageA.getByRole('button', { name: 'Confirmando comando...', exact: true }).waitFor();
    release();
    await pageA.getByRole('button', { name: 'Confirmar comando novamente', exact: true }).waitFor();
    const first = await prisma.pizzaItem.findUniqueOrThrow({ where: { id: pizzaId } });
    assert.equal(first.state, 'ASSEMBLING'); assert.equal(first.version, 1);
    await pageA.reload();
    await pageA.getByRole('button', { name: 'Confirmar comando novamente', exact: true }).click();
    await pageA.getByText('Comando confirmado e salvo.', { exact: true }).waitFor();
    assert.equal(posts[0].input.clientCommandId, posts[1].input.clientCommandId);
    assert.equal((await prisma.pizzaItem.findUniqueOrThrow({ where: { id: pizzaId } })).assemblyStartedAt.toISOString(), first.assemblyStartedAt.toISOString());
    assert.equal(await prisma.pizzaProductionHistory.count(), 3);

    // Tablet B still holds version zero: its stale action must fail and reload.
    await pageB.getByRole('button', { name: 'Iniciar montagem', exact: true }).click();
    await pageB.getByText(/Os dados foram recarregados/).waitFor();
    await pageB.getByRole('button', { name: 'Pausar', exact: true }).waitFor();
    assert.equal(posts.find(post => post.device === 'B').status, 409);

    await pageA.getByRole('button', { name: 'Pausar', exact: true }).click();
    await pageA.getByRole('button', { name: 'Retomar', exact: true }).waitFor();
    const paused = await prisma.pizzaItem.findUniqueOrThrow({ where: { id: pizzaId } });
    assert.equal(paused.state, 'ASSEMBLY_PAUSED'); assert.ok(paused.pausedAt);
    await pageA.reload();
    await pageA.getByRole('button', { name: 'Retomar', exact: true }).click();
    await pageA.getByRole('button', { name: 'Pausar', exact: true }).waitFor();
    const resumed = await prisma.pizzaItem.findUniqueOrThrow({ where: { id: pizzaId } });
    assert.equal(resumed.state, 'ASSEMBLING'); assert.equal(resumed.pausedAt, null);
    await pageA.getByRole('button', { name: /Enviar pro forno/ }).click();
    await pageA.getByRole('heading', { name: 'Nenhum pedido aguardando montagem', exact: true }).waitFor();
    await pageA.reload();
    await pageA.getByRole('heading', { name: 'Nenhum pedido aguardando montagem', exact: true }).waitFor();
    const saved = await (await a.request.get(`${apiOrigin}/orders/v2/${created.id}`)).json();
    assert.equal(saved.status, 'OVEN'); assert.equal(saved.version, 4);
    assert.equal(saved.items[0].production.state, 'WAITING_OVEN'); assert.equal(saved.items[0].production.version, 4);
    assert.ok(saved.items[0].production.assemblyCompletedAt); assert.equal(saved.items[0].production.ovenStartedAt, null);
    const history = await prisma.pizzaProductionHistory.findMany({ where: { pizzaId }, orderBy: { itemVersion: 'asc' } });
    assert.deepEqual(history.map(event => event.eventType), ['CREATED', 'CLAIMED', 'START_ASSEMBLY', 'PAUSE_ASSEMBLY', 'RESUME_ASSEMBLY', 'SEND_TO_OVEN']);
    assert.equal(await prisma.pizzaCommandReceipt.count(), 4);
    assert.deepEqual(errors, []);
    console.info('Comandos Assembly aprovados: balcão → SQLite → iniciar/pausar/retomar/enviar; refresh preserva estado; timestamps/histórico/agregação; resposta perdida com refresh/replay sem duplicação; segundo tablet recebe 409 e recarrega. Banco descartável.');
  } finally { await browser.close(); }
}, { operatorFixtures: true });
