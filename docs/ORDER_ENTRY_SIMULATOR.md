# Simulador de entrada de pedidos

`/orders/new` é o simulador oficial da entrada manual que antecede a futura integração Saipos. Ele não é um segundo fluxo de pedidos: monta um payload compatível com o contrato estruturado v2 e chama `POST /orders/v2`.

## Papel atual

A tela serve para desenvolvimento, testes, demonstrações, homologação, simulação de cenários (incluindo pedidos grandes) e eventual contingência manual. Cada envio real passa pela API, transação, snapshot de catálogo, histórico inicial, idempotência, distribuição automática e realtime já existentes. O simulador nunca cria pedidos somente em memória.

O título e a mensagem da tela deixam explícito que ela simula a entrada que futuramente será recebida da Saipos. `Criar pedido` foi substituído por **Enviar ao fluxo do Kitchen OS**; o sucesso oferece abertura direta da Montagem persistida em `/kitchen/assembly`.

## Payload e catálogo

O payload é validado no cliente para feedback imediato com `createStructuredOrderSchema` e validado novamente no servidor. O formato inclui `clientRequestId`, cliente/telefone, `fulfillmentType`, canal, observação, `pizzas[]` e `extras[]`.

Cada pizza referencia IDs do catálogo e suporta Broto ou Grande, inteira ou meio a meio, borda, modificadores `REMOVE`/`ADD` por metade e observação. Extras são `extraCatalogId`, quantidade e observação. A tela não mantém listas paralelas: sabores, ingredientes, bordas e extras vêm de `packages/shared/src/catalog.ts` através do `PizzaBuilder` e helpers existentes.

O servidor continua construindo o snapshot confiável, criando estado `WAITING_ASSEMBLY`, histórico e distribuição. O frontend preserva `clientRequestId` e o payload em `sessionStorage` quando há resposta perdida; retry usa a mesma chave e não duplica pedidos.

## Experiência de simulação

As pizzas aparecem em cards compactos, com tamanho/composição, sabores, borda e contagem de remoções/adicionais. `Editar` abre o builder baseado na Montagem; `Duplicar` cria uma chave local independente e `Remover` retira apenas aquela pizza. Os limites permanecem 1–30 pizzas e até 30 unidades de extras.

O resumo fixo antes do envio mostra pizzas, extras, atendimento e canal. Extras são itens estruturados com quantidade e observação. O estado de sucesso mostra o número do pedido e permite criar outro ou abrir a fila persistida da Montagem.

## Diferença para outros simuladores

`/orders/new` simula a **origem de um pedido real** e sempre passa pelo backend v2. `/kitchen/assembly/dev` continua existindo separado para simular dados internos da estação de Montagem; ele usa o modelo local/mock específico da montagem e não deve ser usado para representar uma entrada Saipos.

`/orders/new/legacy` permanece disponível para compatibilidade e testes do fluxo legado. Nenhuma dessas rotas foi removida ou convertida automaticamente.

## Saipos futuro

O fluxo futuro será:

```text
Saipos → integração/API ou webhook → pedido v2 estruturado → distribuição → operação Kitchen OS
```

Esta rodada não implementa webhook, autenticação Saipos, polling, sincronização de cardápio, cancelamentos externos ou pagamentos. O simulador pode ser usado para homologar o contrato enquanto a integração não existe.

Pendências conhecidas para o contrato futuro: endereço estruturado de Delivery, identificador externo/idempotência de origem Saipos, mapeamento oficial dos canais e atendimento, cancelamento externo, pagamentos e sincronização de catálogo/preços. O endereço não é inferido de observações.

## Validação

O smoke de entrada deve cobrir uma pizza, várias pizzas, 30 pizzas, Broto, Grande, meio a meio, bordas, remoções, adicionais, extras, duplicação/remoção, resposta perdida/retry, refresh, distribuição automática e chegada em `/kitchen/assembly`. A UI usa o design system documentado em [UI_VISUAL_STANDARDIZATION.md](UI_VISUAL_STANDARDIZATION.md), sem alterar API, banco, estados ou operação.
