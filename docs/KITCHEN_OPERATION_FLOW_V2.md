# Fluxo operacional da cozinha — revisão v2

Implementado em 06/10/2026 como revisão do fluxo das Fases 3–5. Fase 6, piloto físico, analytics, integrações externas e logística geográfica não foram iniciados. Saipos continua como sistema principal de pedidos; `/orders/new` é o simulador persistente da futura entrada, sem webhook ou sincronização Saipos.

## Auditoria e plano aplicado

O fluxo anterior separava montagem, fila/entrada no forno e conferência da finalização, incluindo extras e embalagem na cozinha. O quadro de supervisão tinha indicadores e navegação excessivos. Foram revisados contratos compartilhados, serviços transacionais, atribuições/presença, reconciliação, migrations, UI e testes antes da implementação.

Plano: versionar o fluxo sem reinterpretar registros antigos; unir conclusão de montagem e início do forno; separar acabamento da conferência física; introduzir agrupamento relacional por pizza; mover extras/embalagem/despacho para o Balcão; simplificar o quadro; validar atomicidade, compatibilidade e navegador. Não houve refatoração do catálogo nem do layout aprovado da Montagem.

## Operação e telas

```text
Saipos (sem integração nesta versão)
  → /orders/new (simulador)
  → /kitchen/assembly
  → /kitchen/finishing (forno + acabamento + organização de rotas)
  → rota CLOSED
  → /counter/dispatch (conferência + extras + embalagem)
  → saída da rota / entrega ou retirada
```

`/kitchen` é somente leitura: **Fila**, **Em montagem**, **No forno**, **Finalizados**. Cada card representa uma pizza e informa número do pedido, posição/quantidade, progresso concluído, montador/pausa, tempo de forno ou rota. Um pedido misto aparece por unidades, sem repetir o card completo. Sem supervisão, presença administrativa, comandos por card ou extras. A área No forno também mostra acabamento e a fila histórica, com rótulos explícitos. Pedidos com saída iniciada deixam o quadro.

`/kitchen/oven` redireciona para `/kitchen/finishing`; `/kitchen/dispatch` redireciona para `/counter/dispatch`. Somente os novos componentes são montados pelas rotas. Fontes, ícones SVG, tokens `--kui-*`, superfícies e densidade seguem a Montagem. Navegação agrupa Cozinha e Balcão separadamente.

## Estados e compatibilidade

| Estado/comando | Significado vigente |
| --- | --- |
| WAITING_ASSEMBLY / ASSEMBLING / ASSEMBLY_PAUSED | Fila, montagem e pausa; presença/atribuição existentes preservadas. |
| SEND_TO_OVEN em fluxo 2 | ASSEMBLING → IN_OVEN; encerra montagem/responsabilidade ativa e inicia forno atomicamente. |
| WAITING_OVEN / ENTER_OVEN | Compatibilidade do fluxo 1 histórico; novos pedidos não passam por essa espera. |
| IN_OVEN | Produção no forno, timer por timestamps do servidor. |
| REMOVE_FROM_OVEN | IN_OVEN → BAKED; somente saída física, sem conferir ou despachar. |
| FINISH_PIZZA | BAKED → FINISHED; aceita FINISHING histórico para terminar um acabamento já iniciado. |
| FINISHED | Produção da pizza concluída; conferência no Balcão é independente. |
| CHECK_PIZZA no Balcão | Registra counterCheckedAt/By; não altera FINISHED ou finishedAt. |
| WAITING_DISPATCH | Pedido completo, pizzas/extras conferidos e embalagem confirmada. |
| OUT_FOR_DELIVERY / DELIVERED | Saída Delivery registrada na rota; confirmação manual da entrega. |
| READY_FOR_PICKUP / PICKED_UP | Rota prepara retirada; confirmação manual da retirada/Balcão. |

`Order.schemaVersion=2` descreve o contrato estruturado; o novo `operationalFlowVersion` descreve o comportamento operacional. São conceitos diferentes. A migration adiciona `operationalFlowVersion=1` a todos os registros existentes. Novas criações estruturadas usam 2. Pedidos v1 continuam legados; nenhum texto antigo é convertido em sabor ou pizza estruturada.

Pedidos estruturados do fluxo 1 mantêm SEND_TO_OVEN → WAITING_OVEN, ENTER_OVEN, capacidade bloqueante na entrada antiga e conferência histórica. A estação unificada permite escoar WAITING_OVEN/BAKED/FINISHING antigos; pedidos antigos já liberados podem seguir o despacho legado sem exigir inventar uma rota histórica. Pedidos antigos ainda em produção podem utilizar rotas. Timestamps, recibos e eventos antigos não são regravados. O simulador local DEV mantém seu fluxo histórico em memória, explicitamente separado da operação persistente.

Agregação permanece baseada nas pizzas: todas aguardando → WAITING_PRODUCTION; pizzas em montagem misturadas com outras etapas → IN_PRODUCTION; todas aguardando forno/no forno ou adiante, com forno pendente → OVEN; todas assadas/terminadas → FINISHING. FINISHING no pedido também representa espera da conferência do Balcão, mesmo com todas as pizzas FINISHED. A liberação explícita valida itens/rota/embalagem antes de WAITING_DISPATCH. Saiu da rota não modifica a produção das pizzas.

## Comandos, transações e autoria

Endpoint por pizza existente: `POST /orders/v2/:orderId/pizzas/:pizzaId/commands`. Mantém `command`, `expectedState`, `expectedVersion`, `clientCommandId` UUID. PIN, sessão, terminal, presença recente e atribuição de montagem continuam sendo validados.

SEND_TO_OVEN fluxo 2 salva no mesmo instante do servidor `assemblyCompletedAt`, `releasedAt`, `ovenStartedAt` e calcula `ovenExpectedEndAt` usando `OVEN_DEFAULT_MINUTES`. A atribuição permanece como snapshot histórico; não conta como carga ativa depois da montagem. O evento SEND_TO_OVEN registra conclusão e início com metadata, sem duas transições artificiais. OvenOperator é projetado também desse evento. REMOVE_FROM_OVEN salva bakedAt; FINISH_PIZZA salva finishingStartedAt quando ainda ausente e finishedAt. Histórico por pizza contém estados, versão, comando, operador, workstation e sessão.

`OVEN_CAPACITY` é indicador no fluxo 2, inclusive acima da capacidade configurada. Não bloqueia SEND_TO_OVEN nem exige segundo clique. A referência continua genérica: default 7 minutos, configuração no servidor, previsão persistida e nenhuma retirada automática.

Atualização da pizza, histórico, agregação, incremento de versões e recibo são atômicos. CAS rejeita versão/estado antigo com 409. Mesmo clientCommandId/conteúdo/sessão retorna o recibo sem repetir timestamps ou audit; mesmo ID com outro conteúdo conflita. Horário vem do servidor.

## Rotas relacionais

- `DispatchRoute`: ID, número sequencial, status OPEN/CLOSED/DISPATCHED, version, createdAt/closedAt/reopenedAt/dispatchedAt e autoria da criação.
- `DispatchRouteItem`: pizzaId como chave primária/FK, routeId FK e addedAt. Uma pizza possui no máximo um vínculo em todo o banco; composição não é apenas JSON.
- `DispatchRouteHistory`: evento, versão, horário, operador, workstation, sessão, commandId e metadata com composição/IDs.
- `DispatchRouteReceipt`: chave de idempotência global, hash da intenção/sessão e resposta confirmada.
- `DispatchRouteCounter`: sequência independente do número do pedido, transacional.

Leituras: `GET /dispatch/routes`; histórico autenticado `GET /dispatch/routes/:id/history`. Comandos autenticados:

```json
{ "command": "CREATE", "clientCommandId": "UUID" }
```

`POST /dispatch/routes/commands` cria a rota. Demais comandos em `POST /dispatch/routes/:id/commands`:

```json
{
  "command": "MOVE",
  "expectedVersion": 4,
  "pizzaId": "ID da pizza",
  "targetRouteId": "ID da outra rota aberta",
  "targetExpectedVersion": 2,
  "clientCommandId": "UUID"
}
```

| Comando | Regra |
| --- | --- |
| ADD / REMOVE | Apenas OPEN, pizza FINISHED e sem saída. ADD exige sem vínculo; REMOVE exige pertencer à rota. |
| MOVE | Duas rotas OPEN diferentes, CAS nos dois lados; move o vínculo existente e audita ambos. |
| CLOSE | OPEN não vazia → CLOSED; permite pedido parcial e mostra contagem incluída/total. |
| REOPEN | CLOSED → OPEN, sem saída iniciada; preserva composição e histórico. |
| DISPATCH | CLOSED → DISPATCHED; todos os pedidos completos/conferidos/embalados na mesma rota; congela composição. |

Adicionar/remover/mover/reabrir invalida conferência das pizzas do pedido afetado e embalagem. FINISHED/finishedAt e extras já conferidos permanecem; cada conferência invalidada é auditada e incrementa versão da pizza. WAITING_DISPATCH retorna FINISHING. É necessário fechar novamente e reconferir antes da saída. Movimento atualiza as duas versões; histórico da rota registra composição e autoria.

Saída parcial é bloqueada, mesmo se todos os itens presentes na rota estiverem conferidos. Todas as pizzas ativas de cada pedido devem estar FINALIZADAS e vinculadas à mesma rota CLOSED; extras obrigatórios precisam de quantidade integral e embalagem de confirmação/autoria. O comando DISPATCH valida e muda todos os pedidos e a rota na mesma transação: Delivery → OUT_FOR_DELIVERY; PICKUP → READY_FOR_PICKUP. Depois somente confirmação de entrega/retirada nos endpoints existentes. Não há WAITING_DRIVER obrigatório no fluxo novo. Não há GPS, endereço/geografia ou entregador novo.

## Conferência no Balcão

`POST /counter/orders/:orderId/conference/commands` reutiliza contrato, recibos, CAS e auditoria da conferência existente com contexto COUNTER. Pizzas em rota fechada recebem conferência independente; extras são conferidos por quantidade; embalagem depende de todas as pizzas do pedido na mesma rota fechada e extras completos. RELEASE_TO_DISPATCH exige embalagem confirmada. Correções UNCHECK_PIZZA/UNCHECK_EXTRA/UNCONFIRM_PACKAGING invalidam embalagem/liberação quando aplicável, sem apagar produção e com histórico. A cozinha rejeita os antigos comandos de conferência para pedidos de fluxo 2.

## Realtime e recuperação

Os eventos existentes order.created/order.updated e kitchen.order.updated/kitchen.pizza.updated continuam após commit; rotas acrescentam dispatch.route.updated com UUID, routeId, version e timestamp. Replay não emite evento novo. Nenhuma publicação ocorre antes da transação ou em rollback. Uma falha na publicação não reverte o commit confirmado.

Quadro/estação/Balcão leem API ao abrir, reconectar e a cada 30 segundos. IDs de evento/versões são reconciliados e respostas antigas não substituem versões recentes. Comandos são bloqueados durante envio, offline ou com confirmação pendente; nenhuma atualização otimista cega. Resposta confirmada atualiza pedidos e nova leitura traz rotas/configuração. 409 informa conflito e recarrega dados. Resposta perdida mantém path/payload/clientCommandId em sessionStorage por sessão e oferece **Confirmar envio**, inclusive após refresh. Troca de sessão não reutiliza comandos de outro operador.

## Migration e segurança dos dados

`20261006210000_operational_routes` somente adiciona três colunas e cinco tabelas com FKs/índices. Não há reset, clean, remoção de tabelas ou alteração destrutiva de estados. Backup local via `verify-assignment-migration.mjs --phase flowv2 --backup`; aplicação via migrate deploy; comparação pós-migration confirmou preservação das 21 tabelas existentes, todas as colunas históricas, integridade SQLite e FKs. Backup/banco/build/.env permanecem ignorados e não entram no commit; package-lock permanece intacto.

## Validação e limites

Suítes obrigatórias: lint, typecheck, API, Assembly, Forno, Finalização, Despacho e build. Testes de compatibilidade criam explicitamente fluxo 1; novos testes criam fluxo 2 pelo default de produção. `operational-flow.integration.test.ts` verifica entrada direta, capacidade indicativa, acabamento parcial, autoria/timestamps, conferência independente, idempotência, concorrência, pertencimento único, fechamento/reabertura/movimento, bloqueio de despacho incompleto e rollback de composição/recibo.

`npm run test:ui:browser` executa a revisão do smoke visual com API/Vite/SQLite descartáveis: três pizzas + extras, envio direto pela Montagem, forno/acabamento individual, rota parcial com saída bloqueada, reabertura/complementação, conferência e Delivery/Pickup, unique/CAS, realtime, offline/reconexão/restart, resposta perdida com refresh/replay e redirects. Capturas em 1024×768, 1280×800 e 1366×768, sem overflow horizontal e com alvos touch/cabeçalho durante scroll. Diretório temporário `guigs-flow-v2-validation`, fora do Git. Testes geométricos não substituem observação em tablets físicos.

Resultados finais: **272 testes de API + 34 Assembly + 17 Forno + 14 Finalização + 10 Despacho = 347 aprovados**, incluindo 25 cenários na nova integração operacional. Lint, typecheck e build aprovados. Logs de falhas injetadas nos testes de rollback são esperados; nenhum teste falhou no fechamento.

Smokes de Forno/Finalização/Despacho/visual foram consolidados no mesmo runner operacional, mantendo seus comandos npm como entradas compatíveis. As antigas sequências que exigiam duas ações para entrar no forno e tratavam conferência como conclusão da produção foram substituídas pelas novas regras. A regressão consolidada cobre criação pela UI (Broto, meio a meio, extras), correções de pizza/extra/embalagem, conflito real 409 com reload, remove/move entre rotas, capacidade indicativa 1 com 30 pizzas simultâneas, 30 pedidos distintos em rota/conferência/saída, além dos casos acima. A compatibilidade histórica e a capacidade bloqueante antiga continuam nas suítes de API/domínio, sem apagar seus testes. Runner executado via `test:ui:browser` e, com a cobertura ampliada final, `test:oven:browser`. `test:assembly:browser`, `test:assembly:commands:browser` e `test:assembly:realtime:browser` também aprovados; expectativas atualizadas apenas para IN_OVEN/rótulos/navegação vigentes. Capturas foram inspecionadas, e o contraste dos ícones do quadro foi corrigido.

Pendências mantidas: piloto físico/iluminação/rede real, referência genérica de forno, endereço estruturado de Delivery, controle de papéis específico por estação (PIN/presença existentes identificam, sem nova segregação de funções), retenção/paginação futura das rotas históricas. Extras são conferidos como itens já existentes no pedido, sem edição comercial pós-criação. Rotas agrupam produção; todos os itens de um pedido devem sair juntos. Nenhuma conversão automática de pedidos antigos nem integração externa nesta entrega.
