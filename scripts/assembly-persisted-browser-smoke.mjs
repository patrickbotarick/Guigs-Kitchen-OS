import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
import { withIsolatedApi } from './helpers/isolated-api.mjs';
import { loginPin } from './helpers/operator-fixtures.mjs';

const executablePath = [process.env.BROWSER_PATH, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean).find(existsSync);
assert.ok(executablePath, 'Edge/Chrome necessário');
await withIsolatedApi(3347, async ({ prisma, apiOrigin }) => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    // HTTP-only snapshot/read regression; avoid connecting to the store's unrelated Socket.IO server.
    await context.route('**:3333/socket.io/**', route => route.abort());
    await context.route('**:3333/operators/session**', async route => {
      const request = route.request(), response = await context.request.fetch(`${apiOrigin}${new URL(request.url()).pathname}`, { method: request.method(), headers: request.headers(), ...(request.postData() ? { data: request.postData() } : {}) });
      await route.fulfill({ response });
    });
    let fail = false, slow = true, release;
    const gate = new Promise(done => { release = done; });
    const writes = [], errors = [];
    // Only transport is redirected; every successful response comes from the real isolated API/SQLite.
    await context.route('**:3333/orders/v2**', async route => {
      const request = route.request();
      if (request.method() !== 'GET') writes.push(request.url());
      if (request.method() === 'GET' && slow) await gate;
      if (request.method() === 'GET' && fail) return route.fulfill({ status: 503, json: { error: 'Indisponível para teste' } });
      const url = new URL(request.url());
      const response = await context.request.fetch(`${apiOrigin}${url.pathname}`, { method: request.method(), headers: { 'Content-Type': 'application/json' }, ...(request.postData() ? { data: request.postData() } : {}) });
      await route.fulfill({ response });
    });
    const assembly = await context.newPage();
    assembly.on('pageerror', error => errors.push(error.message));
    await assembly.goto('http://127.0.0.1:5173/kitchen/assembly');
    await loginPin(assembly);
    await assembly.getByRole('button', { name: 'Receber novas pizzas neste tablet', exact: true }).click();
    await assembly.getByRole('button', { name: 'Fila geral', exact: true }).click();
    await assembly.getByRole('heading', { name: 'Carregando pedidos...', exact: true }).waitFor();
    slow = false; release();
    await assembly.getByRole('heading', { name: 'Nenhum pedido aguardando montagem', exact: true }).waitFor();
    fail = true;
    await assembly.getByRole('button', { name: 'Atualizar', exact: true }).click();
    await assembly.getByRole('heading', { name: 'API indisponível', exact: true }).waitFor();
    assert.equal(await assembly.locator('.ka-queue-card').count(), 0);
    fail = false;
    await assembly.getByRole('button', { name: 'Atualizar', exact: true }).click();
    await assembly.getByRole('heading', { name: 'Nenhum pedido aguardando montagem', exact: true }).waitFor();

    const form = await context.newPage();
    form.on('pageerror', error => errors.push(error.message));
    await form.goto('http://127.0.0.1:5173/orders/new');
    await form.getByLabel('Cliente *').fill('Balcão banco Assembly real');
    await form.getByLabel('Observação do pedido', { exact: true }).fill('Observação geral persistida');
    const crust = form.getByLabel('Borda da pizza 1', { exact: true });
    await crust.selectOption(await crust.locator('option').nth(1).getAttribute('value'));
    await form.getByLabel('Observação da pizza 1', { exact: true }).fill('Observação persistida');
    await form.getByRole('button', { name: '+ Adicionar pizza', exact: true }).click();
    await form.getByLabel('Composição da pizza 2', { exact: true }).selectOption('HALF_HALF');
    await form.getByLabel('Sabor — 2ª metade', { exact: true }).selectOption('mussarela');
    await form.locator('.ka-builder-half').nth(1).getByRole('checkbox', { name: 'cebola', exact: true }).uncheck();
    await form.getByLabel('Adicional — 2ª metade', { exact: true }).selectOption('bacon');
    await form.locator('.ka-builder-half').nth(2).getByRole('button', { name: 'Adicionar', exact: true }).click();
    await form.getByRole('button', { name: '+ Adicionar pizza', exact: true }).click();
    await form.getByLabel('Tamanho da pizza 3', { exact: true }).selectOption('BROTO');
    await form.getByLabel('Quantidade — Coca-Cola 2L', { exact: true }).fill('2');
    await form.getByRole('button', { name: 'Criar pedido →', exact: true }).click();
    await form.getByRole('heading', { name: /aguardando montagem/ }).waitFor();
    const orders = await (await context.request.get(`${apiOrigin}/orders/v2`)).json();
    assert.equal(orders.length, 1);
    const saved = orders[0];
    assert.equal(saved.items.filter(item => item.kind === 'PIZZA').length, 3);
    assert.equal(await prisma.pizzaItem.count(), 3);
    await assembly.getByRole('button', { name: 'Atualizar', exact: true }).click();
    await assembly.getByRole('heading', { name: `Pedido #${saved.number}`, exact: true }).waitFor();
    assert.equal(await assembly.locator('.ka-pizza-card').count(), 3);
    assert.match(await assembly.getByLabel('Observação do pedido', { exact: true }).innerText(), /Observação geral persistida/);
    assert.match(await assembly.locator('.ka-counts').first().innerText(), /02 Extras/);
    assert.match(await assembly.locator('.ka-detail').innerText(), /Observação persistida/);
    assert.equal(await assembly.getByRole('button', { name: 'Iniciar montagem', exact: true }).isDisabled(), false);
    assert.equal(await assembly.getByRole('button', { name: 'Concluir montagem', exact: true }).count(), 0);
    await assembly.locator('.ka-pizza-card').nth(1).click();
    assert.match(await assembly.locator('.ka-detail').innerText(), /Removido:\s+cebola/);
    await assembly.getByRole('button', { name: /2ª metade — Mussarela/ }).click();
    assert.match(await assembly.locator('.ka-detail').innerText(), /Adicional:\s+bacon/);
    fail = true;
    await assembly.getByRole('button', { name: 'Atualizar', exact: true }).click();
    await assembly.getByRole('alert').waitFor();
    assert.equal(await assembly.locator('.ka-pizza-card').count(), 3, 'Falha preserva a fila carregada');
    fail = false;

    // Historical snapshot fixtures differ from the live catalog; no recipe reconstruction is allowed.
    const snapshot = structuredClone(saved.items[0].snapshot);
    snapshot.firstHalf.name = 'Calabresa histórica'; snapshot.firstHalf.ingredients[0].name = 'Ingrediente histórico'; snapshot.crust.name = 'Borda histórica';
    // Synthetic historical fixture update must advance the aggregate version used by reconciliation.
    await prisma.$transaction([
      prisma.pizzaItem.update({ where: { id: saved.items[0].id }, data: { recipeSnapshot: snapshot } }),
      prisma.order.update({ where: { id: saved.id }, data: { version: { increment: 1 } } }),
    ]);
    await assembly.getByRole('button', { name: 'Atualizar', exact: true }).click();
    await assembly.getByRole('button', { name: /Pizza 1, Calabresa histórica/ }).click();
    await assembly.getByRole('heading', { name: 'Calabresa histórica', exact: true }).waitFor();
    assert.match(await assembly.locator('.ka-detail').innerText(), /Ingrediente histórico/);
    assert.match(await assembly.locator('.ka-detail').innerText(), /Borda histórica/);

    const large = await context.request.post(`${apiOrigin}/orders/v2`, { data: { clientRequestId: randomUUID(), customerName: 'Lote de 30', fulfillmentType: 'PICKUP', channel: 'COUNTER', pizzas: Array.from({ length: 30 }, () => ({ size: 'GRANDE', composition: 'WHOLE', firstHalf: { flavorId: 'calabresa', modifiers: [] }, crustId: 'tradicional', notes: null })) } });
    assert.equal(large.status(), 201);
    const largeOrder = await large.json();
    await assembly.getByRole('button', { name: 'Atualizar', exact: true }).click();
    await assembly.getByRole('button', { name: `Pedido #${largeOrder.number}, Lote de 30`, exact: true }).click();
    assert.equal(await assembly.locator('.ka-pizza-card').count(), 30);
    await assembly.getByRole('button', { name: 'Ordenar fila: mais antigo primeiro' }).click();
    assert.match(await assembly.locator('.ka-queue-card').first().innerText(), /Lote de 30/);
    assert.equal(writes.length, 1, 'Somente criação pelo balcão; nenhuma ação POST pelo Assembly');
    assert.equal(await prisma.pizzaProductionHistory.count(), 33, 'Apenas históricos iniciais');
    assert.deepEqual(errors, []);
    console.info('Assembly persistido aprovado: balcão → SQLite → GET v2 → fila real; 3 pizzas/Broto/metades/borda/modificadores/extras, snapshots históricos, leitura sem ações neste teste, loading/vazio/erro com preservação, ordenação e 30 pizzas. Banco descartável, API da loja preservada.');
  } finally { await browser.close(); }
}, { operatorFixtures: true });
