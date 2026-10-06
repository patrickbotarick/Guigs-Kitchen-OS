# Fase 5A — finalização e conferência por pedido

## Fechamento da Fase 4

4B revisada e validada antes de qualquer alteração da 5A, fechada no commit `a8534d1` — `feat: add oven capacity and operational timing`. Antes do commit: lint/typecheck/build, 189 testes API, 34 montagem e 17 forno verdes; banco/backups/builds/segredos ignorados, lockfile inalterado.

**Fase 4 — Forno: STATUS CONCLUÍDA TECNICAMENTE.** Piloto físico permanece validação operacional pendente: capacidade e tempo confirmados pela loja, tablets/rede reais e troca de turno. Não bloqueia tecnicamente o início da finalização. Não houve push.

## Unidade operacional e entrada na fila

Rota dedicada `/kitchen/finishing`, com identidade visual existente, PIN/terminal/sessão/heartbeat compartilhados. Fila compartilhada por **pedido**, sem distribuição ou claim de finalizador. Disponibilidade ainda controla recebimento de montagem; quem atuar somente na finalização pode suspendê-la explicitamente na tela. Não altera disponibilidade automaticamente.

Pedidos v2 aparecem assim que existir uma pizza BAKED, FINISHING ou FINISHED, mesmo se o agregado ainda estiver IN_PRODUCTION/OVEN. Ordenação pela primeira saída do forno (`bakedAt`) mais antiga, desempate por número. Mostra todas as pizzas e extras do pedido para conferência e sinaliza, por exemplo, `2 / 3 pizzas disponíveis`. WAITING_DISPATCH sai da fila após liberação. Sem ingredientes detalhados ou preços.

O contrato atual exige 1–30 pizzas e permite até 30 unidades de extras. **Pedido só com extras não é suportado**, permanece rejeitado explicitamente pela criação v2 e não é inferido/migrado nesta fase. V1 continua lendo/criando/operando pelas rotas legadas; não se converte texto antigo em fichas ou checklists.

## Comandos e payload

`POST /orders/v2/:orderId/finishing/commands`, com os mesmos headers operacionais:

```http
Authorization: Bearer <token operacional>
X-Workstation-Device-Key: <UUID persistente do perfil do tablet>
```

```json
{
  "command": "START_FINISHING",
  "pizzaId": "cm...",
  "expectedItemVersion": 5,
  "expectedVersion": 12,
  "clientCommandId": "45e5dfc9-d7a6-42b0-9bce-75e0cc9a7f2c"
}
```

`expectedVersion` é a versão do pedido; `expectedItemVersion` é a da pizza/extra. Identificadores do exemplo devem ser substituídos pelos IDs reais do GET. O schema compartilhado é uma união discriminada estrita:

| Comando | Campos além dos comuns | Efeito |
| --- | --- | --- |
| START_FINISHING | pizzaId, expectedItemVersion | BAKED → FINISHING; finishingStartedAt |
| CHECK_PIZZA | pizzaId, expectedItemVersion | FINISHING → FINISHED; finishedAt |
| CHECK_EXTRA | extraId, expectedItemVersion, checkedQuantity | Quantidade absoluta conferida, checkedAt/checkedBy e versão |
| CONFIRM_PACKAGING | nenhum | packingFinishedAt/packingFinishedBy, sem liberar |
| RELEASE_TO_DISPATCH | nenhum | Revalidação completa → WAITING_DISPATCH |

Campos comuns: command, expectedVersion e clientCommandId UUID. Estado/timestamp/autor não são fornecidos pelo cliente. Sessão válida, operador/terminal ativos e presença ONLINE são exigidos e revalidados dentro da transação. Falhas: 400 para payload, 401 para autenticação, 404 para pedido v2/item inexistente ou de outro pedido, 409 para estado/versão/presença/quantidade/precondição/ID incompatíveis.

Não há salto silencioso BAKED → FINISHED. A tela oferece **Iniciar conferência** e depois **Conferir pizza**. Não há reversão de conferência/correção/cancelamento nesta entrega; fluxo de correção operacional deve ser definido em fase própria.

## Extras, embalagem e liberação

Extras são ExtraItem reais com ID/revisão/nome histórico, quantidade, observação, estado, checkedQuantity/checkedAt/checkedBy e versão. A UI apresenta tipos e unidades, e confirma uma unidade por toque. Exemplo: duas unidades de molho exigem `checkedQuantity` chegar a 2. API aceita quantidade absoluta crescente até a quantidade pedida; parcial permanece WAITING_FINISHING, completa vira FINISHED. Não aceita reduzir, repetir por novo comando ou exceder quantidade. Recibo idempotente permite repetir o mesmo envio confirmado.

Progresso soma pizzas conferidas + unidades de extras conferidas; cancelados ficam fora dos requisitos. Pedido sem extras funciona com pizzas e embalagem, sem exigir extras inexistentes. Snapshot, canal, Delivery/Retirada/Balcão, cliente, observações e saída do forno ficam visíveis; nenhum cálculo financeiro foi acrescentado.

Embalagem exige todas as pizzas necessárias FINISHED e extras não cancelados FINISHED com todas as unidades. Confirmação grava data do servidor e operatorId, com autoria de terminal/sessão no histórico. **CONFIRM_PACKAGING mantém FINISHING**: não libera automaticamente pela agregação.

RELEASE_TO_DISPATCH revalida tudo dentro da transação: pizzas prontas/conferidas, extras/quantidades, embalagem/data/responsável e versão atual do pedido. Usa a agregação existente com embalagem confirmada e exige WAITING_DISPATCH. Registra evento de liberação. Timestamp da liberação está no OrderStatusHistory; não inventa dispatchedAt/deliveredAt ou finalização de entrega. Packing e states conferidos também permanecem no GET v2.

Enquanto houver montagem pendente, agregado permanece IN_PRODUCTION; enquanto houver WAITING_OVEN/IN_OVEN, permanece OVEN. Conferir itens que já chegaram não avança os restantes. Todas assadas/conferidas mantêm FINISHING até a liberação explícita. Não se altera o comportamento do endpoint legado de transição.

## Transação, histórico, idempotência e concorrência

Transação única valida ator e pedido, consulta recibo, valida item/precondições, atualiza com CAS, grava histórico, recalcula/CAS pedido, lê resposta e grava recibo. Qualquer falha desfaz item/quantidade/embalagem/status/versões e histórico/recibo. As mesmas estratégias de retry SQLite existentes são usadas para conflitos técnicos; conflito de domínio retorna 409, não overwrite.

Nova tabela aditiva `FinishingCommandReceipt` com PK clientCommandId, hash da intenção + pedido/operador/sessão/terminal, orderId/FK RESTRICT, responseSnapshot e createdAt. Chave pertence à família de comandos de finalização. Mesmo ID/conteúdo/ator retorna resultado anterior com replayed, sem outro timestamp/histórico/evento. Conteúdo ou identidade diferentes conflitam. Versão esperada antiga não impede replay válido. Após replay a UI busca GET atual, pois o pedido pode ter avançado desde o recibo.

Dois tablets no mesmo pedido podem conflitar mesmo em itens diferentes: versão agregada serializa a conferência. Um vence; outro recebe 409, recarrega e deve repetir a intenção com versão nova e novo UUID. Liberação simultânea confirma apenas uma; replay do mesmo ID também preserva uma única liberação. Não há distribuição automática ou trava de operador.

Pizzas geram eventos `FINISHING_STARTED` e `PIZZA_CHECKED` em PizzaProductionHistory com estados, horário, itemVersion, comando e operador/terminal/sessão. Todos os comandos também geram OrderStatusHistory, inclusive quando o status permanece igual, com `metadata.event`: FINISHING_STARTED, PIZZA_CHECKED, EXTRA_CHECKED, PACKAGING_CONFIRMED, RELEASED_TO_DISPATCH. Metadata registra IDs de item, quantidades anterior/nova quando pertinente, commandId e autoria completa. Histórico anterior não é reescrito; não foram inventados eventos antigos ou usuários.

## Realtime e comportamento da UI

Após commit, publica `kitchen.order.updated` versionado, suficiente para todos os tablets recarregarem pizzas/extras/embalagem/liberação. Replay ou rollback não emitem sucesso. Saída do forno usa os eventos existentes para mostrar pedido parcial. Reconciliação reutiliza KitchenReconciliation, deduplicação, tombstones/versões e proteção contra GET antigo sobrescrever confirmação.

Connect/reconnect consulta GET v2 explicitamente; fallback 30 segundos após leitura, timeout de 10 segundos, atualização manual e dados anteriores preservados em erro. Sessão/heartbeat são os mesmos do restante da cozinha. Comando bloqueia ações enquanto envia, usa resposta confirmada e mantém envio incerto na sessionStorage da aba, associado à sessão. Retry preserva UUID, inclusive após refresh. Fechar aba pode perder o recibo pendente do cliente; GET recupera o estado salvo no servidor.

409 exibe a mensagem de domínio e informa recarga; se a recarga falhar, mantém ações bloqueadas. Offline, reconexão, leitura inválida ou sessão/presença inválida bloqueiam novos comandos. GET em segundo plano não desabilita controles já validados entre pointer-down/click: reduz perda de toque durante refetch e preserva CAS no servidor. Ajuste aplicado também ao forno, validado pelo navegador de regressão. Não há atualização otimista cega.

Seleção e fila por pedido, detalhe com pizzas e extras em cards, progresso por unidades, embalagem e botão Liberar para despacho. Botões touch ≥52 px, scroll da página e layout responsivo. Ordem de conferência de itens disponíveis é livre. Não há tela de despacho/motorista/entrega.

## Migration e preservação do banco

Migration `20261006180000_finishing_commands`: apenas CREATE TABLE/INDEX para recibos, sem ALTER/DROP/backfill ou mudança de colunas anteriores. Prisma Client gerado; diff migrations/schema vazio. Testes aplicam todas as migrations em SQLite descartáveis.

Aplicação local com API da loja parada: backup consistente criado em `apps/api/prisma/backup-phase5a-before-2026-10-06T172324165Z.db` (ignorado); migrate deploy sem seed. Comparação das **19 tabelas anteriores** com backup confirmou todos os valores preservados; integrity_check=ok e foreign_key_check sem violações. Banco atualizado com 10 migrations. Backup/banco/.env/builds continuam fora do Git. package-lock.json não alterado.

Em outra máquina: parar serviços, criar backup consistente, gerar client/aplicar migrations e verificar dados/integridade antes de retomar. `node scripts/verify-assignment-migration.mjs --phase phase5a` e `--verify <backup>` oferecem a comparação. Não restaurar backup antigo após novas escritas sem reconciliação. Não há down destrutivo.

## Testes e arquivos

- API: 20 novos casos de finalização; 209 testes totais. Uma/várias pizzas, Broto/metades/snapshot, extras múltiplos e parciais, estado/versões/pedido/itens inválidos, sessão/presença, sem extras, extras-only rejeitado, embalagem/liberação incompleta e completa, concorrência, replay de liberação, timestamps/histórico/autoria, rollback de item/histórico/recibo/pedido e da própria liberação; v1/v2 preservados.
- `npm run test:finishing`: 12 testes de fila, pedido parcial, critérios/unidades/embalagem, cancelados, extras-only, 30 pedidos e resposta antiga/refresh. Montagem mantém 34 e forno 17.
- `npm run test:finishing:browser`: balcão UI cria três pizzas (Broto e meio a meio) e dois tipos/3 unidades de extras; montagem e forno pela UI; primeiras pizzas chegam e são conferidas parcialmente, extras por unidade, terceira chega, embalagem e release. Dois tablets, disputas 200/409 e uma única liberação, resposta perdida/replay após refresh, rede offline/reconexão, API reiniciada, histórico/autoria e WAITING_DISPATCH. Depois cria/percorre 30 pedidos reais via API e confirma fila nos dois tablets. Usa Vite 5184/API 3353 e banco descartável, sem escrever na loja.
- Tablets 1024×768 e 1280×800, cards/touch/scroll, sem overflow horizontal. `test:oven:browser` verifica regressão da operação/capacidade do forno. Lint/typecheck/build e suítes API/montagem/forno/finalização.

Novos: serviço/testes API de finishing, tabela/migration de recibos, `features/finishing/{FinishingPage,finishing,useFinishing,api,finishing.test,finishing.css}`, script de navegador e este documento. Atualizados: contratos compartilhados, app/server, Router/nav, PIN, link do forno/hook de background GET, scripts npm, ferramenta de backup e README/roadmap/documentos de fechamento. Sem nova dependência.

## Limites e Fase 5B

5A entrega conferência até WAITING_DISPATCH. Não implementa despacho completo, motorista, roteirização, entrega, pagamentos, estoque, dashboard ou métricas finais. Não existe reversão de conferência/embalagem, edição de pedido após entrar no fluxo ou integração real dos canais exibidos; iFood/WhatsApp são apenas origem já informada no pedido.

Pendências: piloto físico de montagem → forno → finalização, política de correção humana, lista inicial de extras confirmada pela operação e desempenho/rede reais. SQLite e realtime sem outbox mantêm limites existentes; GET recupera eventos perdidos. Não é benchmark definitivo ou aceite operacional da loja. O histórico de liberação tem identidade/data necessárias para futura etapa, sem inferir despacho/entrega.

Próximo ciclo: revisão/commit próprio da 5A e piloto curto. Antes da 5B, definir se o escopo é ajustes/correções da conferência ou despacho; para despacho, especificar Delivery/Retirada/Balcão, associação de entregador quando aplicável, retirada/entrega e autoria das transições, preservando WAITING_DISPATCH/CAS/idempotência/realtime. Não começar despacho sem esse contrato. 5A permanece local para revisão, sem commit adicional ou push nesta execução.
