# Fase 5B.1 — correções operacionais da Finalização

## Fechamento e escopo

5A revisada e fechada no commit `e05d45e` (`feat: add persistent order finishing workflow`), após lint/typecheck/build, 209 testes API, 34 montagem, 17 forno, 12 finalização e navegador com dois tablets. Bancos, backups, builds e segredos ignorados; package-lock sem alterações. 5B.1 acrescenta correções antes da liberação. Sem nova migration, dependência ou escrita de teste no banco da loja.

**WAITING_DISPATCH é o fechamento operacional da Finalização.** Comandos novos de correção nesse estado (ou posterior/cancelado) são rejeitados com 409. Não há fluxo supervisionado após despacho nesta entrega. Um replay de um comando já confirmado devolve somente o recibo histórico original, sem executar correção nem reabrir o pedido.

## Contrato

Mesmo endpoint `POST /orders/v2/:orderId/finishing/commands`, mesmas credenciais operacionais e validação de presença ONLINE dentro da transação. Campos comuns: `expectedVersion` (versão do pedido), `clientCommandId` (UUID único), `reason` opcional com trim e máximo 500 caracteres. Pizza/extra exigem também sua `expectedItemVersion`. Zod strict rejeita campos desconhecidos/quantidades inválidas.

| Comando | Campos específicos | Pré-condição | Resultado |
| --- | --- | --- | --- |
| UNCHECK_PIZZA | pizzaId, expectedItemVersion | Pizza FINISHED pertencente ao pedido | FINISHING, finishedAt=null, versão +1 |
| UNCHECK_EXTRA | extraId, expectedItemVersion, checkedQuantity | Extra não cancelado; quantidade nova inteira ≥0 e estritamente menor que a conferida | WAITING_FINISHING, quantidade reduzida, versão +1 |
| UNCONFIRM_PACKAGING | nenhum | Embalagem confirmada | packingFinishedAt/packingFinishedBy=null |

A correção da pizza é uma exceção explícita no serviço de Finalização, não uma reversão genérica da máquina de produção. Não volta a BAKED/forno. Mantém o início original da conferência e os timestamps anteriores de produção; a reconferência grava um novo finishedAt com relógio do servidor. O histórico preserva a conclusão anterior.

Para extras, redução parcial atualiza checkedAt/checkedBy para o horário/operador da correção. Ao zerar, limpa os campos atuais de conferência; o evento guarda quantidade, data e autor anteriores. Quantidade do pedido, snapshot, receita e observações não são editados.

Motivo é **opcional** para correções comuns antes de despacho, como solicitado. Vazio é auditado como null. Uma futura correção supervisionada após fechamento deverá exigir motivo, autorização própria e contrato separado.

Exemplo:

```json
{
  "command": "UNCHECK_EXTRA",
  "extraId": "id-do-extra",
  "checkedQuantity": 1,
  "expectedItemVersion": 2,
  "expectedVersion": 12,
  "clientCommandId": "9499b52c-f850-48f1-8754-8d50baea84ae",
  "reason": "Marcado por engano"
}
```

## Embalagem, prontidão e atomicidade

Corrigir qualquer item obrigatório invalida automaticamente a embalagem, se confirmada. É necessário reconferir o item e confirmar novamente a embalagem antes de liberar. Desfazer somente a embalagem mantém itens conferidos. Correção de item sem embalagem não inventa evento de invalidação.

Tudo em uma transação: validar estado/pedido/item/versões → CAS do item → histórico da pizza quando aplicável → recalcular agregado → CAS/versão do pedido → evento de correção → eventual limpeza de embalagem + evento próprio → leitura completa → recibo idempotente. Falha em qualquer passo desfaz tudo. A versão do pedido sobe uma única vez, mesmo com dois eventos. FINISHING permanece enquanto conferências ou embalagem/liberação estiverem pendentes; upstream em montagem/forno mantém IN_PRODUCTION/OVEN pelas regras existentes. Apenas RELEASE_TO_DISPATCH considera embalagem na agregação e fecha a estação.

## Auditoria

Append-only, sem apagar/editar eventos antigos:

- PIZZA_UNCHECKED em PizzaProductionHistory: FINISHED → FINISHING, versão, comando UUID, operador/terminal/sessão, data do servidor, motivo e finishedAt anterior em metadata. Também aparece no histórico do pedido.
- EXTRA_UNCHECKED em OrderStatusHistory: extraId, versão do item, quantidades anterior/nova, checkedAt/checkedBy anteriores, comando, autoria completa, motivo e data.
- PACKAGING_UNCONFIRMED em OrderStatusHistory: autoria, versão, comando, horário e confirmação anterior. `automatic:false` para comando explícito; `automatic:true` e `triggerEvent` para invalidação por item, com o mesmo UUID da correção.

Sequência real é mantida: conferiu → corrigiu → conferiu novamente. Cada registro de pedido inclui fromStatus/toStatus, mesmo quando iguais. A consulta de auditoria permanece no banco; esta etapa não cria painel de histórico administrativo.

## Concorrência, idempotência e realtime

CAS do pedido e do item impede sobrescrever silenciosamente; pedido/item errado retorna 404, estado/versão/quantidade sem redução retorna 409. Correção e release disputando a mesma versão têm apenas um vencedor. Se a correção vencer, o release antigo recebe 409; se release vencer, correção nova é proibida pelo fechamento.

Recibo global FinishingCommandReceipt reutiliza hash do conteúdo validado, pedido e identidade operacional. Mesmo UUID/conteúdo/sessão retorna resultado original; conteúdo/identidade diferente conflita. Reenvio não duplica auditoria, timestamps ou notificação. Replays antigos são seguidos por GET atual na UI.

Somente após commit emite kitchen.order.updated versionado. Outros tablets recarregam o pedido, com deduplicação/proteção contra GET antigo já existentes. Replay e rollback não emitem sucesso. Sem outbox durável: reconexão, atualização manual e polling de 30 segundos recuperam eventos perdidos.

## UI

Ação discreta Corrigir em pizza conferida e extra com quantidade conferida >0; Corrigir embalagem quando confirmada. Dialog nativo modal exige confirmação simples, oferece Cancelar e motivo opcional. Extra permite escolher quantidade restante de zero até a atual menos um; padrão desfaz uma unidade. Cancelar/Escape não enviam comando. Modal impede toque nos controles de fundo e mantém a versão capturada ao abrir: atualização de outro tablet exige 409/recarga, sem mudar silenciosamente a intenção.

Ações bloqueadas durante comando/incerteza/offline/sessão inválida. Somente resposta confirmada atualiza estado; 409 informa motivo e recarrega. Sem atualização otimista cega. Pedido liberado sai da fila e não oferece correção. Botões/modal touch e scroll limitados ao viewport; seleção continua por pedido.

## Verificação e limites

API: casos novos cobrem pizza, extra parcial/zero, embalagem explícita/automática, reconferência, histórico/autoria/timestamps/snapshot, pedido parcial OVEN, estado/quantidade/versão/item inválidos, sessão/presença, fechamento, concorrência, duplicados/replay e rollback incluindo falha no segundo evento de embalagem. Testes puros validam progresso/reconciliação e refresh após correção.

Navegador de Finalização mantém todos os cenários da 5A e acrescenta pedido criado pelo balcão com **2 pizzas e 2 tipos de extras (3 unidades)**: conferir, embalar, corrigir embalagem/pizza/extra, 2→1→0, cancelamento, motivo opcional, invalidação automática, realtime em dois tablets, refresh, versão antiga/409 com recarga, reconferir, reembalar, liberar e rejeitar três correções depois de WAITING_DISPATCH. API/montagem/forno anteriores continuam cobertos. Testes usam SQLite descartável e portas próprias.

Limites: piloto físico da loja ainda necessário; rede/concorrência SQLite em carga real e recuperação operacional devem ser observadas. Não há correção supervisionada pós-despacho, edição de pedido/quantidade/snapshot, despacho, entregador, retirada final, roteirização, pagamento, estoque ou dashboard. A entrega técnica fecha o fluxo de Finalização até WAITING_DISPATCH; aceite operacional depende do piloto real.

## Próxima etapa — Fase 5B.2 (não implementada)

1. Fechar revisão/commit da 5B.1 e validar rapidamente correções em tablets físicos.
2. Definir contrato de Despacho para Delivery/Retirada/Balcão: autorização, responsável, timestamps, transições e vínculo com entregador quando aplicável.
3. Implementar fila WAITING_DISPATCH e comandos próprios transacionais/CAS/idempotentes/auditados; preservar a barreira de correção da Finalização.
4. Validar ponta a ponta com múltiplos tablets, reconexão, fechamento e autoria. Não inferir que WAITING_DISPATCH significa entregue/retirado.

## Resultado final desta execução

- lint, typecheck e build: aprovados.
- npm test: **227 testes API**, incluindo **38 da Finalização** (18 novos nesta fase).
- test:assembly: **34**; test:oven: **17**; test:finishing: **14** (2 novos).
- test:finishing:browser: todos os cenários 5A/5B.1 e fila de 30 pedidos aprovados; rejeição de todas as três correções após liberação confirmada.
- test:oven:browser: aprovado, incluindo capacidade, concorrência, rede, reinício e handoff.
- Modal em tablet 1024×768 inspecionado visualmente, botões/legibilidade preservados. Navegadores usam também 1280×800.
- git diff --check: aprovado; package-lock inalterado, nenhum banco/backup/build/segredo rastreado. A 5B.1 permanece sem commit próprio para revisão; nenhum push realizado.

Arquivos desta fase: `packages/shared/src/kitchen.ts`; `apps/api/src/finishing.ts` e `finishing.integration.test.ts`; `apps/web/src/features/finishing/{FinishingPage.tsx,CorrectionDialog.tsx,useFinishing.ts,finishing.css,finishing.test.ts}`; `scripts/finishing-browser-smoke.mjs` e `scripts/helpers/finishing-corrections-browser.mjs`; README; `docs/KITCHEN_DATA_MIGRATION.md`; documento de fechamento `docs/PHASE_5A_FINISHING.md`; este documento. Prisma/schema/migrations e endpoints anteriores preservados.
