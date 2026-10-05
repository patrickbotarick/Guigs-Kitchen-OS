# Fase 3D.1 — realtime da montagem

Fase fechada no commit `10b1cf6`. A evolução de identidade operacional e comandos autenticados está em [PHASE_3D2A_OPERATOR_IDENTITY.md](PHASE_3D2A_OPERATOR_IDENTITY.md); a ausência de operador descrita abaixo corresponde ao escopo original 3D.1.

## Git e escopo

Fase 3C.2 fechada no commit local `b1892a4` — `feat: persist pizza assembly commands`, após revisão e lint/typecheck/build, 71 testes API e 28 montagem aprovados. Nenhum banco, backup, `.env` ou segredo incluído. `package-lock.json` preservado fora do commit: apenas metadados ambientais peer/libc, sem alteração de dependências/versões. Sem push.

3D.1 adiciona notificações após commit e reconciliação entre dispositivos. Não altera Prisma/banco, estados, comandos, optimistic concurrency, idempotência ou snapshots. Não implementa login/operador, assignedTo/claim/lock/workstation ownership, forno operacional, finalização, despacho ou estoque. Alterações 3D.1 disponíveis para revisão local, sem commit nesta execução.

## Eventos versionados

Reutiliza servidor Socket.IO/CORS existentes. Schemas Zod em shared/realtime.ts. schemaVersion=1 versiona o evento, independentemente do pedido v2.

`kitchen.pizza.updated`:

```json
{
  "schemaVersion": 1,
  "eventId": "d4b65488-8b8e-4b54-becb-2f57e11bfe1b",
  "orderId": "cmorderid",
  "pizzaId": "cmpizzaid",
  "state": "ASSEMBLING",
  "version": 1,
  "orderVersion": 1,
  "timestamp": "2026-10-05T19:00:00.000Z",
  "commandId": "f1451e1a-b5dc-4d1c-9a1f-c0ce1b051bb6"
}
```

`kitchen.order.updated`:

```json
{
  "schemaVersion": 1,
  "eventId": "927b0981-ea78-4655-bc3f-d4227e56d0c9",
  "orderId": "cmorderid",
  "status": "IN_PRODUCTION",
  "version": 1,
  "timestamp": "2026-10-05T19:00:00.000Z",
  "commandId": "f1451e1a-b5dc-4d1c-9a1f-c0ce1b051bb6"
}
```

eventId: UUID distinto por aviso; commandId: comando persistido. timestamp: geração da notificação no servidor após commit, não substitui changedAt do histórico. Versões são as confirmadas na transação. O pedido aumenta sua versão em cada comando, mesmo sem mudar de estágio; orderVersion permite reconciliar suas pizzas conjuntamente.

Novos pedidos reutilizam order.created existente, após criação v2 confirmada. Replay de criação não publica novamente. Seu payload completo anterior foi preservado por compatibilidade; Assembly ignora v1. Eventos novos não transportam receitas/snapshots: cliente consulta API.

## Publicação e atomicidade

Adaptador HTTP aguarda PizzaCommandService.execute(), que só resolve após commit de pizza, histórico, agregado e recibo. Então commandNotifications gera os avisos. Replay retorna lista vazia; 400/404/409/rollback não publicam. Ordem publicada pizza → pedido; cliente não depende dela.

Falha na publicação após commit é registrada e não transforma comando persistido em falha HTTP. Não há outbox, confirmação individual ou replay durável de eventos. Queda entre commit/publicação pode perder aviso; reconnect e fallback consultam o banco para reparar. Idempotência HTTP continua independente.

## Reconciliação e conexão

- Connect/reconnect sempre agenda GET /orders/v2 explícito.
- Evento válido com versão agregada maior que a conhecida/anunciada agenda consulta. Mesmo eventId, versão menor/igual, ordem invertida ou schema inválido são ignorados. Cache dos últimos 512 IDs; versões também protegem duplicatas anteriores.
- Par pizza/pedido e rajadas agrupados por 100 ms. Consulta lista v2 completa para reconciliar fila, extras e pizzas; nenhuma atualização especulativa por evento.
- GET só substitui pedido por versão maior. Confirmações HTTP usam o mesmo reconciliador. Versões permanecem para projeções removidas, impedindo resposta antiga de ressuscitar pedido que saiu da montagem.
- Revisão da leitura protege confirmações posteriores ao início do GET. Ausência na lista só remove pedido sem confirmação posterior. Leituras obsoletas canceladas/ignoradas; ações locais suspendem consultas até confirmação.
- Filtros anteriores preservados: pedido WAITING_PRODUCTION/IN_PRODUCTION com pizza esperando/montando/pausada. Todas WAITING_OVEN → agregado OVEN → saída da fila nos dispositivos. OVEN aqui ainda é fila, não entrada física no forno.
- Comandos seguem expectedState/expectedVersion e 409, que informa/recarrega GET individual sem reaplicar intenção. Comando incerto mantém UUID na sessão para retry seguro. DEMO não abre socket nem usa API.

Indicador discreto: Online = socket conectado; Reconectando = tentativa; Offline = falha ou navegador sem rede. Online não certifica sucesso da última consulta HTTP: erros continuam visíveis e dados anteriores são preservados.

Fallback de **120 segundos após cada leitura**, substituindo 30 s; sem sobreposição periódica. Notificações, connect/reconnect e Atualizar disparam consultas imediatas. Eventos durante comando são reconciliados após confirmação. GET timeout 10 s; comando permanece 15 s. Balcão legado não mudou.

## Testes

API: dois clientes Socket.IO reais recebem criação, pizza/agregado; recibo já está persistido ao receber. Replay não emite. Novo teste HTTP verifica sucesso, replay e 409. Quatro rollbacks agora passam pelo endpoint e garantem nenhuma notificação/escrita parcial.

Frontend: seis testes cobrem IDs duplicados, versões antigas, ordem invertida, deduplicação do par, respostas atrasadas, saída da fila, leitura anterior a confirmação, reconexão sem replay, v1 e schema inválido.

`npm run test:assembly:realtime:browser`: API compilada 3349 + Vite 5180 com VITE_API_URL isolada e SQLite descartável. Dois contextos Edge reais, sem mocks de sockets/persistência. Filas vazias recebem pedido criado pelo balcão em até 5 s. A iniciar → B pausar → A retomar → B enviar, atualização em até 5 s sem refresh, versão 4/WAITING_OVEN/OVEN/quatro recibos. B fica offline, perde START de A e reconecta com novo GET/estado correto. API é parada e iniciada no mesmo SQLite: ambos reconectam, fazem GET e continuam sincronizando.

Regressões DEV, leitura persistida e comandos/retry/409. Testes HTTP redirecionados bloqueiam sockets da API da loja. Fixture histórica sintética incrementa versão ao alterar snapshot; não foi criado fluxo de edição histórica.

Validações finais aprovadas: lint, typecheck, build, 73 testes API, 34 montagem e navegadores DEV, persistido, comandos/409 e realtime multi-cliente. O primeiro npm test encontrou EACCES nas conexões localhost do sandbox; execução com permissão de rede local passou. Logs de falhas Prisma nos quatro testes de rollback são esperados e os testes confirmaram rollback/silêncio de eventos. Nenhuma migration ou escrita de teste no banco da loja nesta fase.

## Arquivos alterados

- Shared: realtime.ts e export em index.ts.
- API: kitchen-events.ts, app.ts, server.ts, kitchen-realtime.integration.test.ts, pizza-commands.integration.test.ts.
- Assembly: api.ts, realtime.ts, realtime.test.ts, usePersistentAssembly.ts, useAssembly.tsx, components/OrderQueue.tsx, assembly.css.
- Scripts: assembly-realtime-browser-smoke.mjs, helpers/isolated-api.mjs (start/stop/restart somente API descartável), assembly-persisted-browser-smoke.mjs, assembly-commands-browser-smoke.mjs, package.json.
- Docs: README, referência histórica em PHASE_3C2_ASSEMBLY_COMMANDS e este documento.

## Riscos e 3D.2

Broadcast sem autenticação operacional/salas por loja mantém a infraestrutura do servidor local único; exposição externa/multi-loja exige controle de acesso. Nenhuma identidade fictícia adicionada; CAS permanece.

GET completo e leituras por pedido exigem teste de carga antes de ampliar muito tablets/pedidos. Avaliar consultas individuais/batching. Cache de versões/anúncios dura a rota e é reconstruído pela API ao navegar novamente.

Sem outbox, avisos são transitórios; recuperação depende do próximo reconnect/GET ou fallback de 120 s mais duração da consulta. Não há garantia de entrega exatamente uma vez. SQLite/retries também precisam de carga real.

3D.2: revisar/commitar 3D.1; definir autenticação/identidade antes de claim/atribuição/lock com expiração, liberação e auditoria. Desenhar disputas/falhas preservando concorrência/idempotência. Decidir outbox e rooms/leituras direcionadas separadamente. Nenhum desses recursos foi iniciado aqui.
