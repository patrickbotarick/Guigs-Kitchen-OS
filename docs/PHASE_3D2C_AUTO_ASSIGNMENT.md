# Fase 3D.2C — distribuição automática por carga

Implementação local em 06/10/2026, após fechamento da 3D.2B no commit `90f517f` (`feat: add pizza assignment and operator responsibility`). Sem pesos por sabor/dificuldade, dashboard, supervisor, redistribuição automática ou forno.

## Elegibilidade e disponibilidade

Um operador participa quando seu cadastro está ativo e possui pelo menos uma sessão:

- `active=true`, `endedAt=null`, `expiresAt` posterior ao horário do servidor;
- associada por FK a um workstation ativo;
- com `available=true`.

Não há quantidade fixa de montadores. Operador sem sessão válida não participa. Se houver várias sessões elegíveis do mesmo operador, ele aparece uma única vez no sorteio; usamos a sessão disponível mais recente (`startedAt DESC`, desempate por `id`) como origem do assignment. A presença em vários tablets não multiplica a probabilidade de receber pizzas.

`OperatorSession.available` é persistente, default true. Login inicia recebimento disponível. A UI oferece **Recebendo neste tablet / Suspenso neste tablet**; `PATCH /operators/session` com `{ "available": false }`, Bearer e X-Workstation-Device-Key altera somente a sessão autenticada, com payload Zod estrito. GET/refresh devolvem a disponibilidade confirmada. Não aceita operatorId ou timestamps do frontend.

Disponibilidade é por sessão: suspender um tablet não suspende outras sessões disponíveis do mesmo operador. Enquanto pelo menos uma delas estiver elegível, o operador pode receber novas pizzas. Suspender recebimento não libera, pausa ou transfere pizzas existentes e não impede montagem/claim manual. Uma nova sessão inicia disponível novamente.

Sessão ativa significa validade operacional no backend, não presença física comprovada ou conexão Socket.IO. Fechar uma aba não encerra automaticamente a sessão; ela pode continuar elegível até logout/expiração. Antes de sair, suspender recebimento e resolver as reservas. Detecção de presença/heartbeat e recuperação supervisionada são evoluções posteriores.

## Carga e desempate

Carga = quantidade de pizzas atribuídas ao operador em `WAITING_ASSEMBLY`, `ASSEMBLING` ou `ASSEMBLY_PAUSED`. Inclui reservas manuais e automáticas, em qualquer sessão. Não inclui `WAITING_OVEN`, `IN_OVEN`, `BAKED`, `FINISHING`, `FINISHED` ou `CANCELLED`. Extras e quantidade de pedidos não entram no cálculo.

Para cada pizza nova, em ordem de posição:

1. Calcular menor carga dos operadores elegíveis.
2. Formar o conjunto de todos os empatados nessa carga.
3. Escolher com `crypto.randomInt(tied.length)`, sorteio uniforme no servidor. Se houver um só, escolhê-lo diretamente.
4. Persistir assignment e incrementar carga considerada antes da próxima pizza do mesmo pedido.

Pedidos podem ser repartidos entre montadores. Com cargas inicialmente iguais, a diferença durante distribuição sequencial fica no máximo uma pizza. Quando existem cargas anteriores desiguais, operadores menos carregados recebem primeiro; a regra não retira pizzas dos mais carregados. Sorteio evita favorecer sempre o primeiro registro do banco, mas não implementa rodízio/fairness por tempo.

## Momento, transação e versão

Fluxo exclusivo do `POST /orders/v2` / `StructuredOrderService.create`:

```text
validar intenção/catálogo/snapshot
→ iniciar transação
→ verificar idempotência
→ atualizar contador sequencial
→ criar pedido/pizzas/metades/modificadores/extras/CREATED
→ consultar elegibilidade e carga
→ AUTO_ASSIGNED por pizza
→ ler resposta final e salvar receipt de criação
→ commit
→ order.created e notificações Kitchen
```

Não há tarefa assíncrona separada que possa deixar assignment parcial. Falha em qualquer assignment/histórico/receipt faz rollback do pedido completo, inclusive número sequencial. O snapshot de receita continua criado no servidor, independente do assignment.

Pizzas atribuídas continuam `WAITING_ASSEMBLY`, com `version=1` e assignedAt do servidor. O histórico CREATED permanece na versão 0. O pedido continua `WAITING_PRODUCTION`, sem productionStartedAt; sua versão sobe uma vez para 1 quando existe assignment automático. Os comandos seguintes usam a versão recebida, preservando CAS/autorização da 3D.2B. START de pizza já própria não gera novo CLAIMED.

Idempotência de criação permanece por clientRequestId e hash de intenção. Reenvio retorna a resposta original, mesmo se disponibilidade/carga/catálogo mudarem, sem novo sorteio, assignment, histórico ou publicação. Conteúdo diferente com mesma chave continua 409. Receipts antigos continuam legíveis sem inferir atribuição histórica.

## Sem elegíveis e liberação

Se não existe elegível, o pedido é criado normalmente: assignment null, pizza WAITING_ASSEMBLY versão 0, pedido WAITING_PRODUCTION versão 0, histórico CREATED. Sem AUTO_ASSIGNED fictício.

Pizzas livres aparecem em **Disponíveis**. Login ou alteração de disponibilidade não busca/distribui pedidos antigos. Claim/START manual continuam permitindo assumir explicitamente pizzas livres, com as regras da 3D.2B.

Release mantém a pizza disponível; não dispara distribuição automática. Pausar antes de liberar uma pizza em montagem continua obrigatório. Sem reatribuição automática por expiração ou saída do operador. Reservas existentes continuam pertencendo ao operador; não mudam porque sua sessão/terminal ficou inelegível para novas atribuições.

## Concorrência

O banco atual é SQLite. A escrita no contador do pedido ocorre antes de ler elegibilidade/carga e adquire a transação de escrita; o SQLite serializa os escritores do mesmo arquivo, inclusive conexões de clientes/processos distintos. A distribuição completa usa esse mesmo transaction client. Criações concorrentes recalculam carga após a criação anterior commitada, com retry para erros transacionais conhecidos, incluindo P1008. Nunca usamos um cache de carga fora da transação.

Cada update de pizza exige id/pedido/WAITING_ASSEMBLY/versão/assignedOperatorId null. Uma falha de CAS aborta a criação, em vez de sobrescrever uma reserva. Comandos e disponibilidade também usam transações, portanto não fazem escrita paralela parcial dentro da distribuição SQLite. O contador permanece sequencial e todos os receipts/históricos são consistentes.

Validação: seis pedidos simultâneos (2 pizzas cada) com 3 operadores terminaram 4/4/4; seis pedidos (3 pizzas cada) usando **dois clientes Prisma independentes** terminaram 6/6/6. Reenvio simultâneo do mesmo pedido distribuiu uma vez. Isso valida concorrência de conexões no arquivo SQLite; não é um benchmark de capacidade máxima da loja.

Em futura mudança para outro banco, não presumir que a serialização global do SQLite continua: definir isolamento/lock transacional da distribuição e dos comandos que alteram carga, além de conservar CAS/idempotência. Limites de timeout/retry continuam finitos; sob sobrecarga a criação pode falhar integralmente, sem dados parciais.

## Realtime e fila individual

Depois do commit, `order.created` inclui o pedido com assignment confirmado. Para pedidos autoatribuídos também emitimos `kitchen.pizza.updated` por pizza e uma notificação `kitchen.order.updated`, usando a infraestrutura versionada existente. clientRequestId é a correlação da criação nessas notificações. Elas sinalizam refetch; a verdade é o GET persistido. Replay e rollback não publicam.

Assembly autenticado abre por padrão em **Minhas pizzas**. Outros responsáveis não competem visualmente nessa vista. Fila geral e Disponíveis continuam acessíveis. Atualizações realtime e reconexão recalculam os filtros sem refresh manual; a consulta periódica permanece como fallback. Modos DEV mantêm a fila local geral.

O pedido mantém cliente, número, extras, timeline e contagem global. Cards exibidos são somente os do filtro, mantendo números/posições originais; o cabeçalho informa quantas pizzas estão exibidas quando existe recorte. Conclusão/agregação consideram todas as pizzas, mesmo as ocultas pelo filtro.

## Histórico e métricas futuras

`PizzaProductionHistory` ganhou `metadata Json?`, nullable para preservar registros anteriores. AUTO_ASSIGNED contém:

- pizzaId, estado anterior/atual WAITING_ASSEMBLY, changedAt e itemVersion;
- actorType SYSTEM, sem inventar operador como autor do algoritmo;
- operatorId do destinatário, workstationId/sessionId da origem selecionada;
- commandId determinístico `<clientRequestId>:auto:<posição>`;
- metadata: policy `LEAST_PENDING_RANDOM_TIE_V1`, loadBefore, loadAfter, eligibleOperatorIds e tiedOperatorIds.

Não alteramos eventos antigos. A atribuição é realizada pelo sistema; as ações de montagem seguintes mantêm autoria OPERATOR real. Liberação/reassunção não apagam AUTO_ASSIGNED nem a origem histórica.

Dados permitem medir recebidas por AUTO_ASSIGNED (distinguir CLAIMED manual), concluídas pelo autor de SEND_TO_OVEN, assignment→START, START→WAITING_OVEN e cargas registradas antes/depois de atribuições automáticas. Metadados não substituem a reconstrução por CLAIMED/RELEASED/transições para calcular o pico completo, incluindo reservas manuais. RecipeSnapshot conserva sabores/composição/tamanho para análises futuras; definir regra de meio a meio e atribuição de produtividade antes de criar métricas. Se houve troca de responsável, não atribuir automaticamente todo tempo de montagem ao destinatário original. Histórico anterior incompleto não deve ser inventado.

## Migration e proteção dos dados

`20261006150000_auto_assignment`: somente ADD COLUMN `OperatorSession.available` BOOLEAN NOT NULL DEFAULT true e ADD COLUMN `PizzaProductionHistory.metadata` JSONB nullable. Sem remoção, reconstrução, backfill de histórico ou distribuição retroativa.

API da loja parada antes da operação. Prisma Client regenerado; backup consistente SQLite em `apps/api/prisma/backup-phase3d2c-before-2026-10-06T144953659Z.db`; migrate deploy aplicado. Todas as colunas anteriores de **18 tabelas preservadas integralmente**. integrity_check=ok, foreign_key_check sem violações; migrate diff sem diferenças. Backup, bancos e .env continuam ignorados pelo Git. Nenhum operador fixture foi criado na loja.

Ferramenta de backup/validação: `node scripts/verify-assignment-migration.mjs --phase phase3d2c`, depois migrate deploy, depois `--phase phase3d2c --verify <backup>`, sempre com serviços da loja parados. Requer runtime com node:sqlite/backup (validado em Node 24.11.1). Não restaura automaticamente dados antigos sobre escritas novas.

## Validações e limites

Aceite final: lint/typecheck/build aprovados; **129 testes API e 34 testes Assembly aprovados**, além dos cinco testes de navegador descritos abaixo. Diff sem erros de whitespace; package-lock.json não mudou. Falhas de trigger vistas no stderr são simulações esperadas dos testes de rollback.

23 novos testes de API: 1/2/5 operadores, ausência/inatividade/expiração/suspensão, múltiplas sessões deduplicadas, cargas distintas, desempate controlado, estados que contam/não contam, AUTO_ASSIGNED, realtime após commit, idempotência, concorrência em clientes independentes, montagem de pizza automática, release/claim manual, disponibilidade autenticada e rollback.

Teste `npm run test:assembly:auto-assignment:browser`: João/Carlos/Pedro, 9 pizzas em 3/3/3; conclusão sai da carga; mais 4 pizzas em 4/4/4; atualização nos três tablets e nenhuma pizza duplicada; suspensão persistida após refresh; release/claim manual; nenhum elegível e retomada sem redistribuição antiga. Banco/API descartáveis e Edge headless touch em 1024×768/1280×900. Não é teste em hardware físico da loja.

Regressões preservadas: DEV/catalog/30 pizzas, leitura persistida/snapshot/loading/erro/refetch, comandos com resposta perdida e 409, claim/release/reconexão/troca com dois tablets. As regressões de claim manual suspendem explicitamente o recebimento dos fixtures e acessam Fila geral; o teste novo confirma a distribuição real e o padrão Minhas pizzas.

Riscos restantes: sessão abandonada elegível até expiração; disponibilidade de múltiplos tablets; operador indisponível sem supervisor para recuperar reservas; publicação realtime sem outbox recuperada por GET; limites SQLite/timeouts e necessidade de carga real; PIN compartilhado concede a mesma identidade. Sem pesos, SLA, redistribuição silenciosa, dashboard, forno ou finalização.

Próximo ciclo recomendado: validação manual em tablets reais e operação assistida, especialmente disponibilidade/saída de turno e carga concorrente. Depois, recuperação supervisionada de reservas com auditoria e eventual presença/heartbeat. Validar esses aspectos antes de ampliar operação ou introduzir pesos/forno. A Fase 3D.2C permanece local para revisão; não foi commitada ou publicada nesta execução.
