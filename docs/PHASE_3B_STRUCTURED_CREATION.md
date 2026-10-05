# Fase 3B — criação persistente de pedidos estruturados

## Entrega e limites

Fase 3A fechada no commit local `5b472b4` (`feat: add structured kitchen domain and persistence`), com lint, typecheck, 34 testes da API, 16 testes da montagem, build e navegador da montagem aprovados antes do commit. `package-lock.json` ficou fora: seu diff preexistente contém apenas metadados ambientais `peer`/`libc`, sem mudança de pacotes ou versões. Bancos, backups, `.env` e segredos não foram incluídos.

Fase 3B implementa criação e leitura HTTP v2, editor estruturado no balcão, idempotência, snapshot e históricos iniciais. A montagem continua com mocks. Não há comandos persistentes de montagem, claims/locks, Socket.IO por pizza, forno, finalização, estoque ou integrações externas. Selecionar WhatsApp/iFood informa a origem de uma entrada **manual**; não conecta esses canais.

## Rotas e compatibilidade

| Rota | Contrato e comportamento |
| --- | --- |
| `POST /orders/v2` | Criação v2: 201 para criação, 200 para replay, header `Idempotency-Replayed` |
| `GET /orders/v2` | Pedidos v2 ativos, ordenados por recebimento |
| `GET /orders/v2/:id` | Leitura v2 pelo ID, sem reconstruir snapshot pelo catálogo atual |
| `POST /orders` | Criação v1 preservada |
| `GET /orders`, `GET /orders/:id`, histórico/transição legacy | Somente v1, preservados |
| `/orders/new` | Formulário estruturado v2 |
| `/orders/new/legacy` | Formulário original v1, acessível por link no novo formulário |

Os dois contratos compartilham o contador sequencial. Pedidos antigos não são migrados, nem têm sabores/metades inferidos de texto livre. O painel/fila legacy ainda mostra somente v1. Um pedido v2 salvo não aparece no Assembly de demonstração nem pode ser avançado pela transição legacy de pedido inteiro. A confirmação do novo formulário explica esse limite.

## Payload esperado

```json
{
  "clientRequestId": "11c32c90-2a64-47a7-bca8-7660ac0f4f94",
  "customerName": "Cliente",
  "customerPhone": "",
  "fulfillmentType": "DELIVERY",
  "channel": "COUNTER",
  "notes": "Portão lateral",
  "pizzas": [
    {
      "size": "GRANDE",
      "composition": "HALF_HALF",
      "firstHalf": {
        "flavorId": "calabresa",
        "modifiers": [{ "type": "REMOVE", "ingredientId": "cebola" }]
      },
      "secondHalf": {
        "flavorId": "mussarela",
        "modifiers": [{ "type": "ADD", "ingredientId": "bacon" }]
      },
      "crustId": "tradicional",
      "notes": "Cortar em 8"
    },
    {
      "size": "BROTO",
      "composition": "WHOLE",
      "firstHalf": { "flavorId": "calabresa", "modifiers": [] },
      "crustId": "tradicional",
      "notes": null
    }
  ],
  "extras": [
    { "extraCatalogId": "coca-cola-2l", "quantity": 2, "notes": "Gelado" }
  ]
}
```

`fulfillmentType`: DELIVERY/PICKUP. `channel`: COUNTER/WHATSAPP/IFOOD/OTHER. Grande inteira usa WHOLE, sem `secondHalf`. Notas por pizza/extra aceitam string de até 1000 caracteres ou null. Telefone, observação geral e extras têm defaults no schema. A resposta é `Order` v2, incluindo IDs gerados, receitas, snapshots, estados e timestamps; não é um envelope de pedido legacy.

## Validação, catálogo e transação

`createStructuredOrderSchema` é estrito: rejeita campos extras como IDs persistidos, posições, status, timestamps e snapshots enviados pelo cliente. Limites: 1–30 pizzas, até 30 unidades de extras, até 30 modificadores por metade, sem extras repetidos (usar quantidade). Broto só aceita WHOLE; WHOLE tem exatamente uma metade e HALF_HALF exatamente duas, exclusivamente Grande. Modificadores duplicados na mesma metade são rejeitados.

O parser JSON v2 aceita até 1 MB: 30 pizzas com modificadores e notas Unicode podem superar 100 KB. O parser legacy conserva o limite anterior de 100 KB.

O catálogo oficial foi movido, sem reescrever suas receitas, para `packages/shared/src/catalog.ts`, exportado por `@guigs/shared/catalog`. `apps/web/src/features/kitchen/catalog.ts` só reexporta essa fonte. API, balcão e Assembly compartilham sabores, ingredientes, bordas, adicionais e regras/tipos de tamanho/composição. A revisão operacional inicial é `guigs-menu-2026-r1`; mudanças de receita/borda exigem nova revisão.

No servidor, `createRecipeSnapshot` verifica IDs de sabores/bordas/ingredientes, remoções pertencentes à ficha de cada metade e adicionais pertencentes à lista permitida. Extras são validados contra `extraCatalog`. Nenhum nome operacional recebido do navegador é usado como verdade histórica.

Após validação, uma única transação cria/incrementa `OrderCounter`, cria `Order`, pizzas, metades, modificadores, extras, históricos e registro de idempotência. Posições são geradas pelo servidor: pizzas `0..N-1`, extras `N..N+M-1`. A leitura validada do contrato acontece **dentro** da transação, verificando cardinalidade das metades, posições globais únicas e coerência entre receita/snapshot. Falha em qualquer escrita/leitura desfaz tudo, inclusive contador e chave de idempotência.

Os estados iniciais são `PizzaItem.state=WAITING_ASSEMBLY`, `Order.status=WAITING_PRODUCTION` pela agregação compartilhada, e `ExtraItem.state=WAITING_FINISHING`, sem conferências. O mesmo instante do servidor marca recebimento, entrada na fila e histórico inicial. Timestamps de início/pausa/forno/finalização ficam null; versões começam em zero.

## Snapshot e histórico

Cada snapshot é construído pelo servidor a partir da receita validada e catálogo confiável. Preserva revisão, tamanho, composição, IDs/nomes dos sabores, ingredientes e suas marcações NORMAL/REMOVED/ADDED, modificadores por metade, ID/nome/revisão/preço cadastrado da borda e observação da pizza. Extras preservam ID, revisão e nome; quantidade/observação ficam no próprio ExtraItem. Dados gerais ficam no Order. Não há cálculo de preço/cobrança nesta fase.

`snapshot.notes` foi acrescentado como campo opcional para leitura de snapshots anteriores à 3B; os novos sempre o preenchem. Não é inventada observação histórica para snapshots antigos.

Cada pizza ganha exatamente um `PizzaProductionHistory`: evento CREATED, de null para WAITING_ASSEMBLY, `changedAt` do servidor, `actorType=SYSTEM`, versão zero e `commandId=<clientRequestId>:pizza:<posição>`. Não há operador autenticado disponível, portanto nenhum `actorId` é inventado. O histórico geral registra WAITING_PRODUCTION, com origem COUNTER_V2 e clientRequestId nos metadados.

## Idempotência e Socket.IO

`StructuredOrderCreation.clientRequestId` é uma UUID única no banco; associa hash SHA-256 do payload normalizado pelo Zod, ID do pedido e resposta original. A chave não faz parte do hash. Mesma chave/conteúdo retorna a resposta original, inclusive após alterações posteriores no pedido ou catálogo. Mesma chave com outro conteúdo retorna 409. A resposta histórica evita a dependência do catálogo atual durante replay. Não há expiração automática desses registros.

A unicidade e a gravação na transação protegem requisições simultâneas. Conflitos Prisma P2002/P2034/P2028 são relidos e têm até quatro tentativas com pequeno intervalo. Erros restantes não autorizam duplicar a chave: o cliente deve reenviar a mesma intenção. Não é um lock de produção por pizza.

O formulário bloqueia duplo clique e congela o payload enquanto não recebe confirmação. Uma falha de rede oferece reenvio com a mesma UUID. O payload pendente fica em `sessionStorage`, permitindo recuperar a confirmação após refresh/retorno à rota na mesma aba. HTTP 400 libera correção e nova chave porque a validação não persistiu o pedido. UUID usa `getRandomValues`, disponível também em HTTP de LAN. Se storage estiver indisponível, o reenvio ainda funciona em memória; fechar a aba/perder sua sessão exige conferir o pedido no backend antes de recriá-lo. Uma chave nova identifica uma nova criação, mesmo com conteúdo idêntico.

`order.created` é emitido somente após a transação e somente na primeira criação. Replay não cria evento/histórico adicionais. A emissão não possui outbox durável; reconexão/carga inicial deve consultar os dados persistidos. Não há realtime por pizza.

## Extras e interface

O novo formulário reutiliza `PizzaBuilder` e `createPizzaDraft`: Broto/Grande, inteira/meio a meio, sabores por ID, remoções/adicionais independentes por metade, borda e observação. Mantém o shell e os estilos existentes. Extras são itens reais com quantidade/observação, não o contador do simulador. `extraCount` do legado/protótipo não foi removido.

Catálogo inicial interno de extras, revisão `counter-extras-r1`: `coca-cola-2l` (Coca-Cola 2L), `molho-extra` (Molho extra), `sobremesa` (Sobremesa). Esses três registros são a lista inicial simples desta entrega, **não** uma transcrição validada do PDF. Antes de uso operacional, confirmar disponibilidade e especificar os SKUs de molho/sobremesa. Não há preço, estoque ou ficha técnica inferidos para eles.

## Migration e banco local

`20261005190000_structured_order_creation` cria apenas `StructuredOrderCreation`, FK Restrict para Order e índice único por orderId. Sem reconstrução/remoção de tabelas e sem alterações em pedidos existentes.

API parada durante geração/aplicação. Backup SQLite consistente: `apps/api/prisma/backup-phase3b-before-20261005T180951Z.db`, ignorado pelo Git. Migration aplicada ao `dev.db`. Comparação após aplicação: as 13 tabelas de domínio existentes permanecem idênticas ao backup, integrity_check aprovado, nenhuma violação FK e tabela nova vazia. Os testes e navegador criam pedidos exclusivamente em bancos temporários; não foram inseridos pedidos de teste no banco da loja.

Rollback deve manter o schema aditivo e preservar dados v2. Restaurar backup só com serviços parados e reconciliação de escritas posteriores, conforme KITCHEN_DATA_MIGRATION.md. Não apagar tabelas nem editar migrations já aplicadas.

## Arquivos da Fase 3B

- Contrato/catálogo: `packages/shared/src/kitchen.ts`, `packages/shared/src/catalog.ts`, `packages/shared/package.json`, reexport frontend `apps/web/src/features/kitchen/catalog.ts`.
- API: `structured-orders.ts`, `app.ts`, `server.ts`, `kitchen-data.ts`, `apps/api/tsup.config.ts`. O build inclui shared no bundle para execução Node sem loader TS.
- Prisma: `schema.prisma`, migration `20261005190000_structured_order_creation/migration.sql`.
- Balcão: `NewOrder.tsx`, `LegacyNewOrder.tsx`, `api.ts`, `main.tsx`.
- Testes: `structured-orders.integration.test.ts`, aplicação da migration em `orders.integration.test.ts` e `kitchen-data.integration.test.ts`, `scripts/structured-browser-smoke.mjs`, rota legacy em `scripts/browser-smoke.mjs`, script npm em `package.json`.
- Documentação: este documento, `README.md`, `docs/KITCHEN_DATA_MIGRATION.md`.
- `package-lock.json` continua sendo alteração ambiental preexistente, preservada e não necessária para esta implementação. Nenhuma dependência foi adicionada.

## Validação e próximo ciclo

21 testes novos de API/persistência: inteira, meio a meio, Broto válido/inválido, metades ausentes/excedentes, borda, modificadores independentes, IDs inválidos, remoção fora da ficha, adicionais permitidos, duplicatas, extras/limites, snapshot, histórico inicial, 30 pizzas/posições, payload acima de 100 KB, idempotência/replay/conflito/concorrência, rollback e leitura v1/v2 com contador compartilhado. A suíte total passa com 55 testes; montagem, 16 testes. Lint, typecheck e build passam.

`npm run test:structured:browser` exige Vite ativo e porta 3333 livre. Inicia o **servidor compilado** com SQLite descartável e verifica criação v2, per-half modifiers, borda, Broto, extras, responsividade 768/390, perda de resposta após commit, refresh e replay. Também executa o navegador legacy nesse banco isolado (duas abas Socket.IO, histórico e transições). `npm run test:assembly:browser` cobre o protótipo sem dados reais.

Riscos restantes: catálogo de extras a confirmar; SQLite ainda requer validação sob carga real; snapshots/registro de replay aumentam armazenamento; emissão Socket.IO sem outbox; não há identidade autenticada/claims; pedidos v2 ainda ficam fora do painel/fila legacy e Assembly; schema SQLite tem algumas invariantes garantidas pelo serviço e leitura validada, não todas por CHECK. Escritas futuras precisam reutilizar essas garantias. Sessões perdidas não fornecem automaticamente a chave anterior.

Para iniciar 3C: validar a entrada v2 com a operação, revisar/commitar a entrega, e implementar o adaptador de leitura do Assembly a partir de `GET /orders/v2`, renderizando **snapshots**, com convivência explícita com a demonstração/v1. Em seguida, em escopo próprio, implementar comandos individuais com versão esperada, timestamps, histórico, agregação atômica e testes de concorrência/reconexão. Claims e realtime por pizza devem ser definidos antes de liberar vários tablets. Nenhuma dessas ações foi implementada aqui.
