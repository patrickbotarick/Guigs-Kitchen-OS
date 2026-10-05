import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';

const candidates = [process.env.BROWSER_PATH, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean);
const executablePath = candidates.find(path => existsSync(path));
if (!executablePath) throw new Error('Edge/Chrome não encontrado. Defina BROWSER_PATH.');
const origin = process.env.ASSEMBLY_ORIGIN || 'http://127.0.0.1:5173';
const screenshots = process.env.ASSEMBLY_SCREENSHOT_DIR || join(tmpdir(), 'guigs-assembly-validation');
mkdirSync(screenshots, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const errors = [];
const apiRequests = [];

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).port === '3333') apiRequests.push(request.url()); });
  await page.goto(`${origin}/kitchen/assembly?source=demo`);
  await page.getByRole('heading', { name: 'Pedido #1001', exact: true }).waitFor();
  assert.equal(await page.locator('.ka-queue-card').count(), 5);
  assert.equal(await page.locator('.ka-pizza-card').count(), 3, 'Sem slots vazios');
  assert.equal(await page.getByRole('button', { name: 'Concluir montagem', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: /Enviar pro forno/ }).isDisabled(), true);
  assert.match(await page.locator('.ka-detail').innerText(), /Removido:\s+cebola/);
  assert.match(await page.locator('.ka-detail').innerText(), /Adicional:\s+bacon/);
  assert.doesNotMatch(await page.locator('.ka-ingredients').innerText(), /mussarela/i, 'Calabresa não contém mussarela no PDF');
  assert.equal(await page.locator('.ka-extras').count(), 0);
  assert.doesNotMatch(await page.locator('.ka-current').innerText(), /Itens extras|Refrigerante|Bebidas|Molhos|Sobremesa/);
  assert.doesNotMatch(await page.locator('.ka-screen').innerText(), /R\$|subtotal|taxa|preço/i);
  assert.match(await page.locator('.ka-detail').innerText(), /Borda: Requeijão/);
  assert.equal(await page.locator('.ka-timeline [aria-current="step"]').innerText(), 'Na fila');
  const queueNumbers = () => page.locator('.ka-queue-card-top > strong').allTextContents();
  assert.deepEqual(await queueNumbers(), ['#1001', '#1002', '#1003', '#1004', '#1005']);
  await page.getByRole('button', { name: 'Ordenar fila: mais antigo primeiro', exact: true }).click();
  assert.deepEqual(await queueNumbers(), ['#1005', '#1004', '#1003', '#1002', '#1001']);
  assert.equal(await page.locator('.ka-queue-card[aria-pressed=true]').getAttribute('aria-label'), 'Pedido #1001, Mariana Costa');
  await page.getByRole('button', { name: 'Ordenar fila: mais recente primeiro', exact: true }).click();

  async function checkLayout(width, height, label) {
    await page.setViewportSize({ width, height });
    const geometry = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
      clipped: [...document.querySelectorAll('.ka-screen button, .ka-order-header, .ka-pizzas-heading, .ka-detail-meta')]
        .filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.className),
      brokenFlavorWords: [...document.querySelectorAll('.ka-pizza-card-top > strong')].flatMap(element => {
        const node = element.firstChild;
        if (!node || node.nodeType !== Node.TEXT_NODE) return [];
        return [...node.textContent.matchAll(/\S+/g)].filter(match => {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          return range.getClientRects().length > 1;
        }).map(match => match[0]);
      }),
    }));
    assert.ok(geometry.width <= width, `Overflow horizontal em ${width}: ${geometry.width}`);
    assert.ok(geometry.height <= height, `Overflow vertical externo em ${height}: ${geometry.height}`);
    assert.deepEqual(geometry.clipped, [], `Conteúdo cortado em ${width}`);
    assert.deepEqual(geometry.brokenFlavorWords, [], `Nome de sabor quebrado dentro da palavra em ${width}`);
    const footer = await page.locator('.ka-order-footer').boundingBox();
    const actions = await page.locator('.ka-pizza-actions, .ka-assembly-complete').boundingBox();
    assert.ok(footer.y + footer.height <= height && actions.y + actions.height <= height, 'Ações fora da tela');
    await page.screenshot({ path: join(screenshots, `${label}-${width}x${height}.png`), fullPage: true });
  }
  for (const [width, height] of [[1280, 800], [1024, 768], [1152, 645]]) await checkLayout(width, height, 'initial');

  assert.ok(await page.locator('.ka-icon-mask').count() > 0);
  assert.equal(await page.locator('.ka-icon-color').evaluateAll(images => images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)), true, 'SVGs oficiais devem carregar');
  await page.getByRole('button', { name: 'Pizza 2, Calabresa / Portuguesa, Aguardando', exact: true }).click();
  await page.locator('.ka-detail').getByRole('heading', { name: 'Calabresa / Portuguesa', exact: true }).waitFor();
  assert.doesNotMatch(await page.locator('.ka-ingredients').innerText(), /ervilha/);
  await page.getByRole('button', { name: '2ª metade — Portuguesa', exact: true }).click();
  assert.match(await page.locator('.ka-ingredients').innerText(), /ervilha/);
  assert.match(await page.locator('.ka-ingredients').innerText(), /mussarela/);
  assert.equal(await page.locator('.ka-pizza-card[aria-pressed=true]').getAttribute('aria-label'), 'Pizza 2, Calabresa / Portuguesa, Aguardando');
  await checkLayout(1024, 768, 'half-half');
  await page.getByRole('button', { name: '1ª metade — Calabresa', exact: true }).click();
  assert.match(await page.locator('.ka-observations').innerText(), /Nenhuma observação/);
  await page.getByRole('button', { name: 'Iniciar montagem', exact: true }).click();
  await page.getByRole('button', { name: 'Pausar', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: /Enviar pro forno/ }).isDisabled(), true);
  await page.getByRole('button', { name: 'Pedido #1002, Rafael Lima', exact: true }).click();
  await page.getByRole('heading', { name: 'Pedido #1002', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Pedido #1001, Mariana Costa', exact: true }).click();
  assert.match(await page.locator('.ka-detail').innerText(), /Portuguesa/);
  await page.getByRole('button', { name: 'Retomar', exact: true }).click();
  await page.getByRole('button', { name: /Enviar pro forno/ }).click();
  await page.getByText('Montagens concluídas (1 / 3)', { exact: true }).waitFor();
  assert.equal(await page.locator('.ka-timeline [aria-current="step"]').innerText(), 'Montagem');
  assert.equal(await page.getByRole('button', { name: 'Concluir montagem', exact: true }).isDisabled(), true);
  await checkLayout(1024, 768, 'mixed');
  for (const name of ['Pizza 1, Calabresa, Aguardando', 'Pizza 3, Mussarela, Aguardando']) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByRole('button', { name: 'Iniciar montagem', exact: true }).click();
    await page.getByRole('button', { name: /Enviar pro forno/ }).click();
  }
  await page.getByText('Montagens concluídas (3 / 3)', { exact: true }).waitFor();
  assert.equal(await page.locator('.ka-timeline [aria-current="step"]').innerText(), 'Fila do forno');
  assert.equal(await page.locator('.ka-pizza-status').getByText('Aguardando forno', { exact: true }).count(), 3);
  await checkLayout(1024, 768, 'assembly-complete');
  await page.getByRole('button', { name: 'Concluir montagem', exact: true }).click();
  await page.getByRole('heading', { name: 'Pedido #1002', exact: true }).waitFor();
  assert.equal(await page.locator('.ka-queue-card').count(), 4);
  assert.equal(await page.getByRole('button', { name: 'Pedido #1001, Mariana Costa', exact: true }).count(), 0);

  await page.getByRole('link', { name: 'Abrir simulador de desenvolvimento' }).click();
  await page.getByRole('heading', { name: 'Montagens concluídas (1)', exact: true }).waitFor();
  await page.getByLabel('Cliente', { exact: true }).fill('Pedido com seis pizzas');
  await page.getByLabel('Quantidade de pizzas', { exact: true }).fill('6');
  await page.getByLabel('Quantidade de extras').fill('5');
  await page.getByLabel('Canal', { exact: true }).selectOption('COUNTER');
  const builders = page.locator('.ka-builder');
  assert.equal(await builders.count(), 6);
  assert.equal(await builders.nth(0).getByLabel('Sabor — Sabor único', { exact: true }).locator('option').count(), 60);
  await builders.nth(0).getByLabel('Sabor — Sabor único', { exact: true }).selectOption('calabresa');
  await builders.nth(0).getByRole('checkbox', { name: 'cebola', exact: true }).uncheck();
  await builders.nth(0).getByLabel('Adicional — Sabor único', { exact: true }).selectOption('bacon');
  await builders.nth(0).getByRole('button', { name: 'Adicionar', exact: true }).click();
  await builders.nth(0).getByLabel('Borda da pizza 1', { exact: true }).selectOption('requeijao');
  await builders.nth(0).getByLabel('Observação da pizza 1', { exact: true }).fill('Bem assada');
  await builders.nth(1).getByLabel('Composição da pizza 2', { exact: true }).selectOption('HALF_HALF');
  await builders.nth(1).getByLabel('Sabor — 1ª metade', { exact: true }).selectOption('calabresa');
  await builders.nth(1).locator('.ka-builder-half').nth(0).getByRole('checkbox', { name: 'cebola', exact: true }).uncheck();
  await builders.nth(1).getByLabel('Sabor — 2ª metade', { exact: true }).selectOption('portuguesa');
  await builders.nth(1).getByLabel('Borda da pizza 2', { exact: true }).selectOption('cheddar');
  await builders.nth(2).getByLabel('Tamanho da pizza 3', { exact: true }).selectOption('BROTO');
  await builders.nth(2).getByLabel('Sabor — Sabor único', { exact: true }).selectOption('mussarela');
  assert.equal(await builders.nth(2).getByLabel('Composição da pizza 3', { exact: true }).isDisabled(), true);
  assert.equal(await builders.nth(2).locator('option[value="HALF_HALF"]').count(), 0);
  await page.getByRole('button', { name: 'Simular chegada de novo pedido', exact: true }).click();
  await page.getByText('Pedido #1006 chegou à fila.', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Abrir montagem', exact: true }).click();
  await page.getByRole('heading', { name: 'Pedido #1002', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Pedido #1006, Pedido com seis pizzas', exact: true }).click();
  assert.equal(await page.locator('.ka-pizza-card').count(), 6);
  assert.match(await page.locator('.ka-order-header').innerText(), /Balcão/);
  assert.match(await page.locator('.ka-order-header').innerText(), /05 Extras/);
  assert.match(await page.locator('.ka-detail').innerText(), /Borda: Requeijão/);
  assert.match(await page.locator('.ka-ingredients').innerText(), /Removido:\s+cebola/);
  assert.match(await page.locator('.ka-ingredients').innerText(), /Adicional:\s+bacon/);
  await page.getByRole('button', { name: 'Pizza 2, Calabresa / Portuguesa, Aguardando', exact: true }).click();
  assert.match(await page.locator('.ka-ingredients').innerText(), /Removido:\s+cebola/);
  await page.getByRole('button', { name: '2ª metade — Portuguesa', exact: true }).click();
  assert.doesNotMatch(await page.locator('.ka-ingredients').innerText(), /Removido:/);
  assert.match(await page.locator('.ka-detail').innerText(), /Borda: Cheddar/);
  await page.getByRole('button', { name: 'Pizza 3, Mussarela, Aguardando', exact: true }).click();
  assert.match(await page.locator('.ka-detail').innerText(), /Broto \(4 fatias\)/);
  assert.equal(await page.locator('.ka-half-selector').count(), 0);
  // Repeated switches must reset the displayed half and retain the correct recipe/notes.
  for (let index = 0; index < 5; index++) {
    await page.getByRole('button', { name: 'Pizza 2, Calabresa / Portuguesa, Aguardando', exact: true }).click();
    await page.getByRole('button', { name: '2ª metade — Portuguesa', exact: true }).click();
    await page.getByRole('button', { name: 'Pedido #1002, Rafael Lima', exact: true }).click();
    await page.getByRole('button', { name: 'Pedido #1006, Pedido com seis pizzas', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '1ª metade — Calabresa', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Pizza 1, Calabresa, Aguardando', exact: true }).click();
    assert.match(await page.locator('.ka-observations').innerText(), /Bem assada/);
    assert.match(await page.locator('.ka-ingredients').innerText(), /Removido:\s+cebola/);
  }
  await checkLayout(1280, 800, 'six-pizzas');

  await page.getByRole('link', { name: 'Abrir simulador de desenvolvimento' }).click();
  await page.getByLabel('Cliente', { exact: true }).fill('Pedido grande para scroll');
  await page.getByLabel('Quantidade de pizzas', { exact: true }).fill('30');
  await page.getByLabel('Quantidade de extras').fill('0');
  await page.getByRole('button', { name: 'Simular chegada de novo pedido', exact: true }).click();
  await page.getByLabel('Quantidade de pizzas', { exact: true }).fill('1');
  for (let index = 0; index < 10; index++) {
    await page.getByLabel('Cliente', { exact: true }).fill(`Chegada ${index + 1}`);
    await page.getByRole('button', { name: 'Simular chegada de novo pedido', exact: true }).click();
    await page.getByText(`Pedido #${1008 + index} chegou à fila.`, { exact: true }).waitFor();
  }
  await page.getByRole('link', { name: 'Abrir montagem', exact: true }).click();
  await page.getByRole('button', { name: 'Pedido #1007, Pedido grande para scroll', exact: true }).click();
  for (const [width, height] of [[1024, 768], [1280, 800]]) {
    await checkLayout(width, height, 'overflow');
    assert.equal(await page.locator('.ka-order-scroll').evaluate(element => element.scrollHeight > element.clientHeight), true);
    assert.equal(await page.locator('.ka-queue-scroll').evaluate(element => element.scrollHeight > element.clientHeight), true);
  }
  await page.getByRole('button', { name: 'Pizza 30, Calabresa, Aguardando', exact: true }).click();
  await page.getByRole('button', { name: 'Iniciar montagem', exact: true }).click();
  await page.getByRole('button', { name: /Enviar pro forno/ }).click();
  await page.getByText('Montagens concluídas (1 / 30)', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Pedido #1017, Chegada 10', exact: true }).click();
  await page.getByRole('heading', { name: 'Pedido #1017', exact: true }).waitFor();
  assert.equal(await page.locator('.ka-pizza-card').count(), 1);
  await page.getByRole('button', { name: 'Iniciar montagem', exact: true }).click();
  await page.getByRole('button', { name: 'Pausar', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: /Enviar pro forno/ }).isDisabled(), true);
  await page.getByRole('button', { name: 'Retomar', exact: true }).click();
  await page.getByRole('button', { name: /Enviar pro forno/ }).click();
  assert.equal(await page.getByRole('button', { name: 'Concluir montagem', exact: true }).isEnabled(), true);
  await page.getByRole('button', { name: 'Concluir montagem', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Pedido #1017, Chegada 10', exact: true }).count(), 0);

  // Reload intentionally resets only the mock session. Drain the initial queue to verify its empty state.
  await page.reload();
  await page.getByRole('heading', { name: 'Pedido #1001', exact: true }).waitFor();
  for (let order = 0; order < 5; order++) {
    const cards = page.locator('.ka-pizza-card');
    const count = await cards.count();
    for (let index = 0; index < count; index++) {
      await cards.nth(index).click();
      await page.getByRole('button', { name: 'Iniciar montagem', exact: true }).click();
      await page.getByRole('button', { name: /Enviar pro forno/ }).click();
    }
    await page.getByRole('button', { name: 'Concluir montagem', exact: true }).click();
  }
  await page.getByRole('heading', { name: 'Fila de montagem em dia', exact: true }).waitFor();
  assert.equal(await page.locator('.ka-queue-card').count(), 0);
  await page.getByRole('link', { name: 'Abrir simulador de desenvolvimento' }).click();
  await page.getByRole('button', { name: 'Simular chegada de novo pedido', exact: true }).click();
  await page.getByRole('link', { name: 'Abrir montagem', exact: true }).click();
  await page.getByRole('heading', { name: 'Pedido #1006', exact: true }).waitFor();
  assert.deepEqual(errors, [], 'Erros React no navegador');
  assert.deepEqual(apiRequests, [], 'A demonstração não deve acessar a API');

  // Existing routes still mount in their original shell. API calls are stubbed for this read-only UI check.
  const reception = await context.newPage();
  await reception.route('**:3333/orders', route => route.fulfill({ json: [] }));
  await reception.route('**:3333/orders/v2', route => route.fulfill({ json: [] }));
  await reception.route('**:3333/health', route => route.fulfill({ json: { status: 'ok' } }));
  await reception.goto(origin);
  await reception.getByRole('heading', { name: /Pedidos claros/ }).waitFor();
  await reception.getByRole('link', { name: 'Novo pedido', exact: true }).click();
  await reception.getByRole('heading', { name: 'Novo pedido de teste', exact: true }).waitFor();
  await reception.getByRole('link', { name: 'Cozinha', exact: true }).click();
  await reception.getByRole('heading', { name: 'Fila da cozinha', exact: true }).waitFor();
  await reception.getByRole('link', { name: 'Montagem', exact: true }).click();
  await reception.getByRole('heading', { name: 'Identifique-se', exact: true }).waitFor();
  await reception.goto(`${origin}/kitchen/assembly?source=demo`);
  await reception.getByRole('heading', { name: 'Pedido #1001', exact: true }).waitFor();
  console.info(`Montagem 2.0 validada: catálogo oficial, ordenação ASC/DESC, três cenários manuais, metades independentes com estado único, Broto, bordas, modificadores, extras apenas no contador, ausência de preços, fluxo completo, scroll e rotas existentes. Screenshots: ${screenshots}`);
} finally { await browser.close(); }
