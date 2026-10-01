import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const executablePath = existsSync(edge) ? edge : chrome;
if (!existsSync(executablePath)) throw new Error('Edge ou Chrome não encontrado neste Windows.');
const browser = await chromium.launch({ executablePath, headless: true });
const origin = 'http://127.0.0.1:5173';
const customer = `Validação UI ${Date.now()}`;

try {
  const context = await browser.newContext({ viewport: { width: 1100, height: 850 } });
  const kitchenA = await context.newPage();
  await kitchenA.goto(`${origin}/kitchen`);
  await kitchenA.getByRole('heading', { name: 'Fila da cozinha' }).waitFor();
  await kitchenA.getByText('Realtime conectado').waitFor();

  const form = await context.newPage();
  await form.goto(`${origin}/orders/new`);
  await form.getByLabel('Cliente *').fill(customer);
  await form.getByLabel('Sabor / nome *').fill('Portuguesa');
  await form.getByLabel('Remover ingredientes opcional').fill('cebola');
  await form.getByRole('button', { name: 'Criar pedido' }).click();
  await form.getByText(/enviado à cozinha/).waitFor();

  const cardA = kitchenA.locator('.order-card').filter({ hasText: customer });
  await cardA.waitFor({ state: 'visible' });
  await cardA.getByRole('button', { name: 'Iniciar produção' }).click();
  await cardA.locator('.pill').getByText('Em produção').waitFor();

  const kitchenB = await context.newPage();
  await kitchenB.goto(`${origin}/kitchen`);
  const cardB = kitchenB.locator('.order-card').filter({ hasText: customer });
  await cardB.locator('.pill').getByText('Em produção').waitFor();
  await cardB.getByRole('button', { name: 'Enviar ao forno' }).click();
  await cardA.locator('.pill').getByText('Forno').waitFor();

  await cardA.getByRole('button', { name: 'Ver histórico' }).click();
  const entries = cardA.locator('.history li');
  await entries.nth(2).waitFor();
  assert.equal(await entries.count(), 3);
  assert.ok((await cardA.innerText()).includes('Pedido criado'));
  const imageLoaded = await kitchenA.locator('.brand-logo img').evaluate(image => image instanceof HTMLImageElement && image.naturalWidth > 0);
  assert.equal(imageLoaded, true, 'Logo oficial não carregou');

  const orders = await (await fetch('http://127.0.0.1:3333/orders')).json();
  const order = orders.find(value => value.customerName === customer);
  assert.ok(order);
  const invalid = await fetch(`http://127.0.0.1:3333/orders/${order.id}/transition`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedStatus: 'OVEN', toStatus: 'DELIVERED' }),
  });
  assert.equal(invalid.status, 409);

  for (const width of [768, 390]) {
    await kitchenA.setViewportSize({ width, height: 1024 });
    const overflows = await kitchenA.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflows, false, `Layout excede a largura de ${width}px`);
  }
  await kitchenA.setViewportSize({ width: 768, height: 1024 });
  if (process.env.SCREENSHOT_PATH) await kitchenA.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true });
  console.info(`Browser smoke passou: ${customer}; criação, duas abas realtime, histórico, logo, layout tablet/mobile e rejeição HTTP 409.`);
} finally {
  await browser.close();
}
