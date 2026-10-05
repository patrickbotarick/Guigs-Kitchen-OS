# Fase 3C.2 — comandos persistentes de montagem

Esta fase foi fechada no commit `b1892a4`. O polling de 30 segundos e a ausência de realtime abaixo descrevem a entrega 3C.2; a evolução atual está em [PHASE_3D1_REALTIME.md](PHASE_3D1_REALTIME.md).

## Git e escopo

Fase 3C.1 fechada no commit local `eab3060` — `feat: load persistent v2 orders in assembly`. Antes do commit foram revisados arquivos e passaram lint, typecheck, 55 testes da API, 27 da montagem e build. Nenhum banco, backup ou segredo foi incluído. `package-lock.json` permanece fora do commit, com as mesmas diferenças ambientais peer/libc (15 linhas adicionadas e 42 removidas), sem dependências/versões novas. Sem push. A 3C.2 fica como alterações locais para revisão.

Escopo: quatro comandos por pizza, optimistic concurrency, idempotência, timestamps, histórico, agregação e confirmação na UI. Não há lock, atribuição/identidade de montador, realtime por pizza, entrada/saída/timer de forno, finalização, despacho ou estoque. Fase 3D não iniciada.

## Endpoint, contrato e transições

`POST /orders/v2/:orderId/pizzas/:pizzaId/commands`

```json
{
  "command": "START_ASSEMBLY",
  "expectedState": "WAITING_ASSEMBLY",
  "expectedVersion": 0,
  "clientCommandId": "f1451e1a-b5dc-4d1c-9a1f-c0ce1b051bb6"
}
```

| Comando | De | Para |
| --- | --- | --- |
| START_ASSEMBLY | WAITING_ASSEMBLY | ASSEMBLING |
| PAUSE_ASSEMBLY | ASSEMBLING | ASSEMBLY_PAUSED |
| RESUME_ASSEMBLY | ASSEMBLY_PAUSED | ASSEMBLING |
| SEND_TO_OVEN | ASSEMBLING | WAITING_OVEN |

Schema Zod estrito em shared: somente esses comandos, estado reconhecido, versão inteira não negativa e UUID. IDs das rotas são CUIDs. Campos extras, timestamps/identidade fornecidos pelo cliente e comandos de forno são rejeitados com 400. Pedido/pizza inexistentes, v1 ou pizza que não pertence ao pedido: 404. Estado/versão/transição inválidos: 409. Pedido cancelado ou em logística não aceita montagem.

Resposta 200: `{ order: OrderV2, pizzaId, clientCommandId, replayed }`, com todo o estado confirmado da transação. Header `Idempotency-Replayed` indica replay. Contratos e mapeamento dos comandos são compartilhados; o serviço também verifica a máquina de estados `canTransitionPizza`.

## Concorrência e atomicidade

O serviço `PizzaCommandService` valida existência/pertencimento, versão e estado esperado. Atualiza por CAS (`updateMany` filtrado por id/orderId/state/version); exige exatamente uma linha e incrementa a versão da pizza. Não sobrescreve uma alteração concorrente.

Uma única transação contém: verificação de recibo, leitura/validação, CAS da pizza, timestamps, histórico individual, leitura dos estados de todas as pizzas/extras, agregação compartilhada, CAS/versionamento do pedido, histórico geral se o estágio mudar, leitura validada do Order e gravação do recibo. Erro em qualquer passo desfaz tudo.

A versão do pedido aumenta em cada comando, mesmo que seu estágio permaneça igual. O CAS do pedido evita perda da agregação quando tablets alteram pizzas diferentes. Conflitos transacionais/ocupação Prisma P2002/P2034/P2028/P1008 e disputa na agregação têm até quatro tentativas; o retry relê estado e recibo. Se a pizza já mudou, retorna 409. Esgotamento/erros de infraestrutura podem retornar erro interno; o cliente mantém o mesmo comando para confirmar/repetir, nunca assume uma gravação parcial.

## Idempotência

A tabela aditiva `PizzaCommandReceipt` tem clientCommandId como PK, hash SHA-256 da intenção normalizada (inclui orderId/pizzaId/comando/estado/versão), referências com FK Restrict e resposta original em JSON.

Mesmo ID e conteúdo retorna a resposta original com replayed=true, sem novos timestamps, versões ou histórico — mesmo após comandos posteriores. Mesmo ID com conteúdo ou destino diferente retorna 409. Duas requisições simultâneas com o mesmo ID resultam em uma escrita e um replay. Recibo e comando são gravados na mesma transação, sem janela de escrita parcial.

Como a resposta original pode estar desatualizada depois de outros comandos, a UI faz GET individual antes de aplicar um replay. Resultados com versão menor que a já exibida não regridem o estado local. Não há expiração automática dos recibos nesta entrega.

## Timestamps e histórico

Horário do servidor, sem timestamps aceitos do navegador:

- START_ASSEMBLY: grava assemblyStartedAt; preservado nos comandos seguintes.
- PAUSE_ASSEMBLY: grava pausedAt. Cada pausa também fica no histórico.
- RESUME_ASSEMBLY: limpa pausedAt, preserva o início e registra o instante da retomada no histórico RESUME_ASSEMBLY. Esse histórico é o equivalente persistente de assemblyResumedAt; não foi criada outra coluna.
- SEND_TO_OVEN: grava assemblyCompletedAt. Não grava ovenStartedAt/bakedAt/produção concluída.

Cada comando aceito cria um PizzaProductionHistory com comando em eventType, fromState, toState, changedAt, commandId e nova itemVersion. actorType=SYSTEM, actorId/workstationId=null: não existe autenticação/identidade operacional nesta fase e nenhum operador foi inventado. A estrutura existente suporta esses campos para evolução futura.

O pedido recebe productionStartedAt na primeira ação, mantém os campos reais de forno/finalização intocados e registra OrderStatusHistory somente quando seu estágio agregado muda, com comando/UUID/pizza nos metadados.

## Agregação

Usa exatamente `deriveOrderProductionState` de shared, dentro da transação:

- Todas as pizzas ativas aguardando montagem: WAITING_PRODUCTION.
- Qualquer pizza aguardando/em montagem/pausada, com alguma produção já iniciada: IN_PRODUCTION.
- Nenhuma montagem pendente e alguma pizza WAITING_OVEN/IN_OVEN: OVEN.
- Demais fases seguem as regras anteriores de finalização, extras e embalagem; não há comandos novos para alcançá-las.

Exemplo: pizza 1 WAITING_OVEN e pizza 2 WAITING_ASSEMBLY → IN_PRODUCTION. Ambas WAITING_OVEN → OVEN. OVEN nesse caso representa fila do forno; não comprova entrada física nem pizza assada.

Quando todas as montagens acabam, o pedido sai da fila do Assembly pelo filtro existente. A UI confirma que a pizza aguarda forno. Não depende de clicar Concluir montagem; esse botão continua exclusivo da simulação local e desabilitado para pedidos reais.

## Assembly e conflitos

A UI envia comando com estado/versão que leu da API. Não faz avanço otimista. Bloqueia as ações enquanto espera a resposta; só aplica dados confirmados. Seleção continua por IDs, snapshots históricos continuam sendo a fonte das fichas e o polling de 30 segundos continua para outros tablets.

Consultas em andamento são canceladas/suprimidas durante o comando; uma marca de geração impede que uma resposta de leitura anterior sobrescreva a confirmação. Depois do comando, a resposta é aplicada imediatamente e a leitura é retomada. O servidor não emite eventos Socket.IO por pizza nem novos eventos de realtime nesta entrega.

Em 409, a UI mostra o conflito, recarrega GET /orders/v2/:id e aplica a versão atual. Só informa dados recarregados se essa leitura tiver sucesso; em falha pede Atualizar. Não reaplica automaticamente a intenção sobre a nova versão.

Falha de rede, timeout ou confirmação incerta preservam o comando completo/UUID e oferecem Confirmar comando novamente. `sessionStorage` permite recuperar após refresh/retorno à rota na mesma aba. As outras ações ficam bloqueadas até confirmar/resolver. Se storage estiver indisponível, o retry funciona em memória; perder a sessão requer conferir estado/histórico antes de operar. UUID usa o helper comum `utils/clientId.ts`, também usado pelo balcão, compatível com HTTP na LAN.

DEV `?source=demo` mantém o reducer/ações locais. Não envia comandos ao backend nem mistura mocks com dados persistidos.

## Migration e banco da loja

`20261005200000_pizza_commands` cria somente PizzaCommandReceipt, sem alterar dados/tabelas anteriores. Cliente Prisma regenerado com API parada. Backup consistente antes de aplicar: `apps/api/prisma/backup-phase3c2-before-20261005T190952Z.db`, ignorado pelo Git.

Migration aplicada ao dev.db; schema sem diferenças, migrate status atualizado. Comparação com backup: 14 tabelas de domínio existentes idênticas; integrity_check/FKs aprovados; nova tabela de recibos vazia. Nenhum pedido/comando de teste foi escrito no banco da loja. A API é retomada após validação.

Rollback: preservar o schema aditivo e dados de comandos; nunca apagar recibos/históricos para resolver conflito. Restaurar backup somente com serviços parados e reconciliação de escritas posteriores, conforme plano de migração existente.

## Testes e arquivos

16 testes novos de API: fluxo completo, estados/versões inválidos, pertencimento, payload estrito, idempotência após ações posteriores, mesmo ID com destino/conteúdo diferente, dois comandos concorrentes na mesma pizza, mesmo comando simultâneo, pizzas diferentes concorrentes, timestamps/histórico, agregação mista e rollback em PizzaProductionHistory, OrderStatusHistory, Order e PizzaCommandReceipt. Mais um teste frontend evita regressão por resposta antiga e remove pedido que saiu da montagem.

Totais: 71 testes API e 28 montagem. Lint, typecheck e build aprovados. Navegadores relevantes: demonstração DEV, leitura persistida, criação estruturada/legacy e comandos.

`npm run test:assembly:commands:browser` inicia API compilada em 3348/SQLite descartável e cria pedido **pelo balcão**. Verifica Iniciar → Pausar → Retomar → Enviar ao forno, refresh durante pausa e após conclusão, GET com estado final WAITING_OVEN/pedido OVEN, início preservado, histórico dos quatro comandos e quatro recibos. Simula perda de resposta após commit, refresh e retry com mesma UUID, sem duplicação. Segundo contexto/tablet com versão antiga recebe 409 e recarrega. Não usa mock para esses pedidos e não escreve no banco da loja. Requer Vite 5173 e porta 3348 livre.

Arquivos da 3C.2:

- shared: `packages/shared/src/kitchen.ts`.
- Prisma: `apps/api/prisma/schema.prisma`, nova migration.
- API: `pizza-commands.ts`, `pizza-commands.integration.test.ts`, `app.ts`, `server.ts`, aplicação da migration nos testes `orders.integration.test.ts` e `kitchen-data.integration.test.ts`.
- Frontend: `features/kitchen/api.ts`, `types.ts`, `assembly.ts`, `assembly-read.test.ts`, `usePersistentAssembly.ts`, `useAssembly.tsx`, `components/PizzaDetail.tsx`, `components/OrderQueue.tsx`, texto do avanço automático em `components/CurrentOrder.tsx`, `pages/KitchenAssemblyPage.tsx`, `utils/clientId.ts` e reuso do helper em `pages/NewOrder.tsx`.
- Scripts/docs: `scripts/assembly-commands-browser-smoke.mjs`, ajuste do teste de leitura `assembly-persisted-browser-smoke.mjs`, `package.json`, `README.md`, este documento e referência no documento 3C.1.

## Riscos e Fase 3D

SQLite exige teste de carga real com vários tablets; retries são limitados e não substituem capacidade/observabilidade. Recibos preservam a resposta inteira e aumentam armazenamento: definir retenção/compactação sem perder idempotência. Outros tablets podem ficar até cerca de 30 segundos mais tempo da consulta desatualizados; conflitos são protegidos pelo CAS. Ainda não há identificação operacional, atribuição ou lock de montador. Histórico de pausas/retomadas é persistido, mas não existe nova tela de histórico operacional individual. Falhas de sessão/local storage exigem conferência do estado antes de nova ação.

Para 3D: revisar/commitar esta entrega; definir eventos por pizza/pedido emitidos somente após commit, reconexão/carga inicial, deduplicação e ordenação por versão, e estratégia de entrega confiável/outbox. Testar múltiplos tablets, quedas e carga. Identidade/claims precisam de escopo próprio se forem exigidos pela operação; optimistic concurrency já impede sobrescrita silenciosa e não deve ser removida. Não implementar forno/finalização junto ao realtime sem uma etapa de domínio específica.
