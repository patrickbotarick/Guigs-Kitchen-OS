import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

async function until(check, message) { const end = Date.now() + 15000; while (Date.now() < end) { if (await check()) return; await new Promise(done => setTimeout(done, 100)); } throw new Error(message); }
const card = (page, kind, id) => page.locator(`[data-${kind}-id="${id}"]`);
const headers = page => page.evaluate(() => ({ Authorization: `Bearer ${localStorage.getItem('guigs-operator-session-token')}`, 'X-Workstation-Device-Key': localStorage.getItem('guigs-workstation-device-key') }));

export async function finishingCorrectionsBrowser({ form, a, b, oven, prisma, apiOrigin, webOrigin }) {
  await form.goto(`${webOrigin}/orders/new`);
  await form.getByLabel('Cliente *').fill('Correções integradas 5B.1');
  await form.getByRole('button', { name: '+ Adicionar pizza', exact: true }).click();
  await form.getByLabel('Quantidade — Coca-Cola 2L', { exact: true }).fill('1');
  await form.getByLabel('Quantidade — Molho extra', { exact: true }).fill('2');
  await form.getByRole('button', { name: 'Criar pedido →', exact: true }).click();
  await form.getByRole('heading', { name: /aguardando montagem/ }).waitFor();
  let order = (await (await form.request.get(`${apiOrigin}/orders/v2`)).json()).find(value => value.customerName === 'Correções integradas 5B.1');
  const operationHeaders = await headers(oven);
  for (let index = 0; index < 2; index++) for (const command of ['START_ASSEMBLY', 'SEND_TO_OVEN', 'ENTER_OVEN', 'REMOVE_FROM_OVEN']) {
    const pizza = order.items.filter(item => item.kind === 'PIZZA')[index];
    const response = await form.request.post(`${apiOrigin}/orders/v2/${order.id}/pizzas/${pizza.id}/commands`, { headers: operationHeaders, data: { command, expectedState: pizza.production.state, expectedVersion: pizza.production.version, clientCommandId: randomUUID() } }); assert.equal(response.status(), 200); order = (await response.json()).order;
  }
  const endpoint = `${apiOrigin}/orders/v2/${order.id}/finishing/commands`, pizzas = order.items.filter(item => item.kind === 'PIZZA'), extras = order.items.filter(item => item.kind === 'EXTRA');
  const read = async () => (await (await form.request.get(`${apiOrigin}/orders/v2/${order.id}`)).json());
  async function synced(page) { await until(async () => Number(await page.locator('.finishing-detail').getAttribute('data-order-version')) === (await read()).version, 'Correção não reconciliou tablet'); }
  async function click(page, button) { await synced(page); await until(() => button.isEnabled(), 'Ação bloqueada'); const before = (await read()).version; await button.click(); await until(async () => (await read()).version > before, 'Comando não persistiu'); if ((await read()).status !== 'WAITING_DISPATCH') await synced(page); }
  async function open(page, button) { await synced(page); await until(() => button.isEnabled(), 'Correção bloqueada'); await button.click(); await page.getByRole('dialog').waitFor(); }
  async function confirm(page) { await click(page, page.getByRole('dialog').getByRole('button', { name: 'Confirmar correção', exact: true })); }
  for (const page of [a, b]) await page.getByRole('heading', { name: `Pedido #${order.number}`, exact: true }).waitFor();
  for (const pizza of pizzas) { await click(a, card(a, 'pizza', pizza.id).getByRole('button', { name: 'Iniciar conferência', exact: true })); await click(a, card(a, 'pizza', pizza.id).getByRole('button', { name: 'Conferir pizza', exact: true })); }
  for (const extra of extras) for (let unit = 0; unit < extra.quantity; unit++) await click(a, card(a, 'extra', extra.id).getByRole('button', { name: 'Conferir 1 unidade', exact: true }));
  await click(a, a.getByRole('button', { name: 'Confirmar embalagem', exact: true }));
  await open(a, a.getByRole('button', { name: 'Corrigir embalagem', exact: true })); await confirm(a);
  for (const page of [a, b]) { await synced(page); assert.equal(await page.getByRole('button', { name: 'Liberar para despacho', exact: true }).isDisabled(), true); }
  await click(a, a.getByRole('button', { name: 'Confirmar embalagem', exact: true }));
  await open(a, card(a, 'pizza', pizzas[0].id).getByRole('button', { name: 'Corrigir', exact: true })); const cancelledVersion = (await read()).version;
  await a.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click(); assert.equal((await read()).version, cancelledVersion);
  await open(a, card(a, 'pizza', pizzas[0].id).getByRole('button', { name: 'Corrigir', exact: true })); await a.getByLabel('Motivo (opcional)', { exact: true }).fill('Etiqueta conferida incorretamente');
  const shots = resolve(tmpdir(), 'guigs-finishing-validation'); mkdirSync(shots, { recursive: true });
  await a.screenshot({ path: resolve(shots, 'correction-1024x768.png'), fullPage: true });
  await confirm(a); await synced(b); assert.equal((await read()).packingFinishedAt, null); await card(b, 'pizza', pizzas[0].id).getByRole('button', { name: 'Conferir pizza', exact: true }).waitFor();
  await click(a, card(a, 'pizza', pizzas[0].id).getByRole('button', { name: 'Conferir pizza', exact: true })); await click(a, a.getByRole('button', { name: 'Confirmar embalagem', exact: true }));
  // B holds an old confirmed-item intent while A corrects an extra.
  await open(b, card(b, 'pizza', pizzas[1].id).getByRole('button', { name: 'Corrigir', exact: true })); const packed = await read();
  await open(a, card(a, 'extra', extras[1].id).getByRole('button', { name: 'Corrigir', exact: true }));
  assert.equal(await a.getByLabel('Quantidade que permanece conferida', { exact: true }).inputValue(), '1'); await confirm(a);
  await b.getByRole('dialog').getByRole('button', { name: 'Confirmar correção', exact: true }).click();
  await b.getByText(/Os dados foram recarregados/).waitFor(); await synced(b);
  const staleRelease = await form.request.post(endpoint, { headers: await headers(b), data: { command: 'RELEASE_TO_DISPATCH', expectedVersion: packed.version, clientCommandId: randomUUID() } }); assert.equal(staleRelease.status(), 409);
  for (const page of [a, b]) { await synced(page); assert.match(await card(page, 'extra', extras[1].id).innerText(), /1 \/ 2 unidades/); assert.equal(await page.getByRole('button', { name: 'Liberar para despacho', exact: true }).isDisabled(), true); }
  await b.reload(); await b.getByLabel('Conexão Finalização', { exact: true }).getByText('Online', { exact: true }).waitFor(); await synced(b); assert.match(await card(b, 'extra', extras[1].id).innerText(), /1 \/ 2 unidades/);
  // Partial count may be cleared to zero without removing its audit trail.
  await open(b, card(b, 'extra', extras[1].id).getByRole('button', { name: 'Corrigir', exact: true })); await confirm(b);
  await synced(a); assert.match(await card(a, 'extra', extras[1].id).innerText(), /0 \/ 2 unidades/);
  for (let unit = 0; unit < 2; unit++) await click(a, card(a, 'extra', extras[1].id).getByRole('button', { name: 'Conferir 1 unidade', exact: true }));
  await click(a, a.getByRole('button', { name: 'Confirmar embalagem', exact: true })); await click(a, a.getByRole('button', { name: 'Liberar para despacho', exact: true }));
  for (const page of [a, b]) await page.getByText('Nenhum pedido aguardando finalização', { exact: true }).waitFor();
  const final = await read(); assert.equal(final.status, 'WAITING_DISPATCH');
  for (const command of ['UNCHECK_PIZZA', 'UNCHECK_EXTRA', 'UNCONFIRM_PACKAGING']) {
    const payload = { command, expectedVersion: final.version, clientCommandId: randomUUID() }, pizza = final.items.find(item => item.kind === 'PIZZA'), extra = final.items.find(item => item.kind === 'EXTRA');
    if (command === 'UNCHECK_PIZZA') Object.assign(payload, { pizzaId: pizza.id, expectedItemVersion: pizza.production.version });
    if (command === 'UNCHECK_EXTRA') Object.assign(payload, { extraId: extra.id, expectedItemVersion: extra.version, checkedQuantity: 0 });
    assert.equal((await form.request.post(endpoint, { headers: await headers(a), data: payload })).status(), 409);
  }
  const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id } }), events = history.filter(row => row.metadata).map(row => JSON.parse(row.metadata));
  assert.equal(events.filter(e => e.event === 'PIZZA_UNCHECKED').length, 1); assert.equal(events.filter(e => e.event === 'EXTRA_UNCHECKED').length, 2); assert.equal(events.filter(e => e.event === 'PACKAGING_UNCONFIRMED').length, 3);
  assert.ok(events.filter(e => e.event?.includes('UNCHECKED') || e.event === 'PACKAGING_UNCONFIRMED').every(e => e.operatorId && e.operatorSessionId && e.workstationId));
  console.info('PASS 5B.1: balcão UI 2 pizzas/2 extras → conferência → embalagem → correções confirmadas de pizza/extra/embalagem, cancelamento, motivo opcional, 2→1→0, invalidação automática, dois tablets/realtime, refresh, 409 com recarga, reconferência/reembalagem → WAITING_DISPATCH; três reversões posteriores rejeitadas, histórico preservado.');
}

