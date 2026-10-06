# Fase 5B.2 — Despacho, Retirada e fechamento operacional

## Fechamento da 5B.1 e entrega

5B.1 revisada, validada e fechada no commit **f5ea546** (`feat: add finishing correction workflow`). Lint/typecheck/build, 227 testes API, 34 montagem, 17 forno, 14 finalização e navegador com dois tablets passaram antes do commit. Bancos/backups/builds/segredos permaneceram fora do Git; package-lock sem alteração.

5B.2 entrega `/kitchen/dispatch`, separado da Finalização e operando por **pedido v2**. Comandos manuais: sem entregador externo, GPS, roteirização, iFood, WhatsApp automático, pagamentos, estoque ou administração. O fluxo v2 de criação até conclusão fica tecnicamente completo; aceite operacional depende de piloto físico.

## Domínio existente e lacunas

Preserva os enums já existentes. WAITING_DRIVER significa aguardando entregador; não cria WAITING_COURIER equivalente. `fulfillmentType` persistido tem somente DELIVERY e PICKUP. **COUNTER/Balcão é canal de entrada, não terceiro tipo de atendimento**: PICKUP/COUNTER usa retirada; DELIVERY/COUNTER usa delivery. O filtro Retirada / Balcão abrange PICKUP. Não inferimos atendimento pelo canal ou por notas.

Nome e telefone já existem no v2; nome aparece em todos e telefone, quando disponível, em Delivery. **Endereço não está estruturado no contrato atual** e não é inventado/extraído de observações. Não há nome/ID de entregador ou documento de identificação adicional. Antes de operar delivery real, a loja precisa estabelecer como consultar o endereço no processo atual; sua estruturação futura é tarefa própria.

v1 permanece leitura/criação/transições legadas, sem conversão automática, inferência de receitas ou acesso ao comando de despacho v2. O painel legado não foi redesenhado. Fechamento técnico desta fase se refere ao fluxo **v2**.

## Estados e comandos

Endpoint: `POST /orders/v2/:orderId/dispatch/commands`.

```json
{
  "command": "MARK_OUT_FOR_DELIVERY",
  "expectedVersion": 15,
  "clientCommandId": "c4314d68-a2f3-40fc-a055-11de3936a778"
}
```

Zod strict valida comando, versão inteira não negativa e UUID; orderId CUID na rota. Reutiliza Authorization e X-Workstation-Device-Key da identidade operacional. Sessão/presença ONLINE validada também dentro da transação.

| Atendimento | Comando | Origem | Destino | Timestamp servidor |
| --- | --- | --- | --- | --- |
| Delivery | MARK_WAITING_DRIVER | WAITING_DISPATCH | WAITING_DRIVER | waitingDriverAt |
| Delivery | MARK_OUT_FOR_DELIVERY | WAITING_DRIVER | OUT_FOR_DELIVERY | dispatchedAt |
| Delivery | MARK_DELIVERED | OUT_FOR_DELIVERY | DELIVERED | deliveredAt e completedAt |
| Retirada/Balcão (PICKUP) | MARK_READY_FOR_PICKUP | WAITING_DISPATCH | READY_FOR_PICKUP | pickupReadyAt |
| Retirada/Balcão (PICKUP) | MARK_PICKED_UP | READY_FOR_PICKUP | PICKED_UP | pickedUpAt e completedAt |

Transições compartilhadas em packages/shared são usadas por API e UI. Não permite saltos, repetir estado como comando novo ou misturar atendimento. DELIVERED/PICKED_UP e completedAt encerram o pedido; nenhuma nova transição normal ou reversão após conclusão. Correção futura deve ter contrato supervisionado próprio.

O servidor também exige embalagem confirmada, ao menos uma pizza ativa, todas as pizzas ativas FINISHED e extras ativos totalmente conferidos. Status agregado adulterado ou pedido não liberado não bastam para despachar. Despacho não altera estado individual das pizzas, snapshots, quantidades ou conferências.

## Timestamps e métricas

A Finalização grava **dispatchReadyAt** no RELEASE_TO_DISPATCH, na mesma transação que muda o pedido para WAITING_DISPATCH. Não usa packingFinishedAt como liberação: confirmar embalagem e liberar são ações distintas.

Reutiliza waitingDriverAt, dispatchedAt e deliveredAt já existentes. Adiciona dispatchReadyAt, pickupReadyAt, pickedUpAt e completedAt nullable. DTO v2 oferece o grupo `dispatch` com esses sete campos; opcional somente para compatibilidade com recibos/snapshots anteriores. GET atual sempre fornece o grupo. Timestamps nunca vêm do cliente.

Tela mostra criação, tempo total, liberação pela Finalização e espera para saída. Espera é dispatchReadyAt → dispatchedAt (Delivery) ou → pickedUpAt (Retirada); até o handoff usa agora, depois permanece fixa. Tempo de entrega pode futuramente usar dispatchedAt → deliveredAt. Produção, forno e conferência preservam seus marcos anteriores; não há dashboard.

Pedidos anteriormente liberados continuam com dispatchReadyAt=null: **nenhum backfill ou evento inventado**. São ordenados por createdAt como fallback declarado; UI informa horário de liberação não registrado e não calcula espera fictícia. Podem avançar normalmente se itens/embalagem estiverem válidos; novos marcos são reais, sem preencher retroativamente a data desconhecida.

## Transação, autoria e concorrência

Uma transação valida sessão, recibo, pedido v2, atendimento, estado, versão e barreira da Finalização; faz CAS com id/versão/status/tipo/completedAt=null; grava estado/timestamps/versão +1, OrderStatusHistory e DispatchCommandReceipt; lê/valida a resposta completa e confirma. Falha em qualquer passo causa rollback completo.

Cada histórico preserva fromStatus/toStatus/changedAt, actorType/actorId e metadata com comando, UUID, operatorId, workstationId, operatorSessionId, orderVersion e fulfillmentType. Não reescreve criação ou eventos de produção/conferência anteriores.

CAS impede dupla conclusão: comandos distintos sobre a mesma versão têm um vencedor e um 409. UI informa conflito e recarrega GET do pedido; falha de recarga bloqueia ações. Pedido inexistente ou v1 recebe 404, payload inválido 400, sessão inválida 401, estado/tipo/versão/presença incompatível 409. Status final não admite novas ações.

DispatchCommandReceipt guarda hash do conteúdo validado/pedido/identidade da sessão e resposta original. Mesmo UUID/conteúdo/identidade retorna recibo sem duplicar timestamp, histórico ou notificação; mesmo UUID com outro conteúdo/identidade retorna 409. Namespace de recibos é próprio do Despacho. Replay após conclusão continua somente leitura do resultado anterior; UI consulta GET atual em seguida e não reabre fila.

## Realtime, leitura e interface

Emite `kitchen.order.updated` versionado somente após commit. Replay/rollback não emitem sucesso. GET /orders/v2 foi ampliado para incluir WAITING_DRIVER/OUT_FOR_DELIVERY/READY_FOR_PICKUP ativos; módulos anteriores mantêm seus filtros. DELIVERED/PICKED_UP deixam a lista ativa, mas GET /orders/v2/:id preserva leitura histórica.

Hook usa a mesma reconciliação KitchenReconciliation, versões, deduplicação e proteção contra GET antigo. Connect/reconnect faz GET; fallback 30 segundos, atualização manual, timeout, confirmação incerta em sessionStorage e retry com UUID original. Sem atualização otimista cega; offline/reconexão/leitura inválida/presença inválida/envio bloqueiam ações. PIN/heartbeat/fim de turno são os mesmos do restante da cozinha. Quem atua só no Despacho pode suspender a disponibilidade para montagem.

Fila com filtros Todos/Delivery/Retirada-Balcão; WAITING_DISPATCH primeiro e mais antigo pela liberação, depois pedidos em andamento. Mostra número, cliente, tipo, canal, estado e espera; detalhe mostra criação, tempo total, liberação, telefone quando disponível, pizzas e extras pelo snapshot, observações e somente o próximo comando permitido. Sem dados técnicos de produção. Touch ≥52px, scroll natural/layout reaproveitado e filtros ativos destacados. Pedidos concluídos saem da fila, sem painel administrativo de histórico novo.

Sem outbox durável: eventos perdidos são recuperados por GET/reconexão/polling; emissão após commit pode falhar sem desfazer um comando já persistido.

## Migration local e preservação

`20261006190000_dispatch_commands`: quatro ADD COLUMN nullable em Order e CREATE TABLE/INDEX DispatchCommandReceipt, FK RESTRICT. Sem DROP/reconstrução/delete/backfill/seed. Prisma Client gerado e diff migrations/schema vazio.

Aplicada com API 3333 parada e backup consistente ignorado: `apps/api/prisma/backup-phase5b2-before-2026-10-06T181954409Z.db`. Comparação das **20 tabelas anteriores**, todas as colunas/valores, confirmou preservação integral; integrity_check=ok e foreign_key_check sem violações. 11 migrations aplicadas. Nenhum teste escreve no banco da loja.

Em outra máquina: parar API, backup consistente, gerar client, migrate deploy sem seed e verificar preservação/integridade antes de retomar. Ferramenta: `node scripts/verify-assignment-migration.mjs --phase phase5b2`, depois `--verify <backup>`. Não restaurar backup antigo sobre novas escritas sem reconciliação. Banco/backup/.env/builds continuam ignorados; lockfile inalterado.

## Validação

- API: **20 casos novos** de Despacho, total **247 testes**. Delivery/Pickup ponta a ponta por serviços reais; Balcão como canal; timestamps/histórico/autoria/itens preservados; comandos incompatíveis/saltos/versão/pedido errado/v1; sessão/presença; fechamento; idempotência/duplicado simultâneo; dupla conclusão Delivery e Pickup; rollback de pedido/histórico/recibo e da própria conclusão; data histórica desconhecida; 30 pedidos reais liberados.
- `test:dispatch`: **10 casos** de filtros, fila/prioridade/30 pedidos, comandos por atendimento/estado, fechamento, resposta antiga/refresh e espera fixa após handoff.
- Suites anteriores: montagem 34, forno 17, finalização 14; lint/typecheck/build aprovados. Build emite aviso não bloqueante de bundle web >500kB; divisão por rota é dívida técnica futura.
- `test:dispatch:browser`: Vite5185/API3354/SQLite descartáveis. Pedido A Delivery e B Retirada pelo formulário do balcão; montagem, forno, Finalização e Despacho pela UI; dois terminais, realtime, 200/409 dupla entrega, resposta perdida/replay após refresh, offline/reconexão, API reiniciada, histórico/timestamps e conclusão. Depois 30 pedidos atravessam serviços reais até WAITING_DISPATCH e aparecem nos dois terminais.
- Tablets 1024×768 e 1280×800, sem overflow horizontal e botões touch; screenshots inspecionados. Regressões em navegadores de Finalização/correções e Forno.

## Arquivos e próximo ciclo

Novos: migration/DispatchCommandReceipt, serviço e testes API `dispatch`, `features/dispatch/{DispatchPage,api,useDispatch,dispatch,dispatch.test,dispatch.css}`, script de navegador e este documento. Atualizados: schema/contrato v2/loader, app/server, lista ativa, RELEASE_TO_DISPATCH, duas fixtures de migrations/compatibilidade, Router/nav/PIN/link da Finalização, package.json, ferramenta de backup, README/roadmap/documento de fechamento 5B.1. Sem novas dependências.

5B.2 fechada no commit de mensagem `feat: add dispatch and pickup workflow`, incluindo implementação, testes e fechamento da Fase 5, sem push. O fluxo principal **v2** está tecnicamente fechado da criação até DELIVERED/PICKED_UP. Não equivale a aceite da operação real ou ao fechamento de todas as fases futuras.

Validação operacional pendente: executar piloto curto com tablets/operadores físicos (incluindo conexão instável, erro humano e entrega/retirada manuais). Confirmar processo de endereço/telefone e diferença entre canal Balcão e atendimento; priorizar estruturação dos dados necessários à entrega. Observar carga SQLite e latência, procedimento de backup/recuperação e bundle web. Correções após conclusão, cancelamento no despacho, endereço/entregador estruturados e painel de auditoria são contratos futuros próprios. Nenhuma integração externa iniciada.

## Fechamento oficial da Fase 5

```yaml
Fase: 5 — Finalização e Despacho
STATUS: CONCLUÍDA TECNICAMENTE
```

Finalização persistente; pizzas e extras conferidos; embalagem confirmada; correções auditáveis; liberação em WAITING_DISPATCH. Delivery termina em DELIVERED e Retirada/Balcão (PICKUP) em PICKED_UP, com completedAt e bloqueio de novas transições normais. Realtime, idempotência, concorrência/CAS, transações e histórico operacional implementados e validados.

Piloto físico continua validação operacional pendente; endereço estruturado de Delivery permanece lacuna conhecida. v1 preservado sem migração automática; fechamento do fluxo principal refere-se a v2. Não foram implementadas funcionalidades novas durante o fechamento. Fase 6 não iniciada; nenhuma integração externa ou push realizado.

Validações finais repetidas em 06/10/2026: `npm run lint`, `npm run typecheck` e `npm run build` aprovados; `npm test` com 247 testes API, `test:assembly` com 34, `test:oven` com 17, `test:finishing` com 14 e `test:dispatch` com 10 — **322 testes aprovados**. Testes de navegador `test:finishing:browser`, `test:dispatch:browser` e `test:assembly:realtime:browser` aprovados, incluindo correções, fluxos ponta a ponta, dois terminais, conflitos, idempotência, refresh, reconexão/reinício da API e filas de 30 pedidos. O aviso de bundle web >500kB permanece não bloqueante. Lockfile inalterado; bancos, backups, builds e segredos fora do Git.
