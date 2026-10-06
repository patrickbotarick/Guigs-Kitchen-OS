# Fase 3D.2B — responsabilidade operacional por pizza

Implementação local em 06/10/2026, sobre a Fase 3D.2A (`fb11075`), posteriormente fechada no commit `90f517f`. Este documento registra o escopo da 3D.2B, sem distribuição automática, supervisor, forno ou finalização. A evolução de distribuição e fila padrão está em [PHASE_3D2C_AUTO_ASSIGNMENT.md](PHASE_3D2C_AUTO_ASSIGNMENT.md).

## Assignment persistente

`PizzaItem` ganhou cinco colunas nullable: `assignedOperatorId`, `assignedWorkstationId`, `assignedSessionId`, `assignedAt`, `releasedAt`. As três referências têm FKs com exclusão Restrict. Índice `(assignedOperatorId, state)` prepara consultas por carga/operador, sem limite fixo de operadores.

A responsabilidade pertence ao **operador**, não exclusivamente à sessão/tablet que assumiu. Workstation/session/assignedAt representam a origem da reserva atual. Ações posteriores podem ocorrer em outra sessão válida do mesmo operador; o histórico registra quem/onde realmente executou cada ação. Não sobrescrevemos a origem ao pausar/retomar ou confirmar a mesma reserva.

Na resposta v2, a pizza contém `assignment: null | { operatorId, operatorName, workstationId, sessionId, assignedAt }` e `releasedAt`. O nome vem do cadastro atual; autoria histórica permanece identificada pelas FKs e eventos. `releasedAt` é a última liberação explícita; fica preservado mesmo após nova reserva. Liberação limpa os quatro campos da reserva atual. Receipts anteriores, que não continham assignment, continuam legíveis: o contrato aplica defaults null. v1 não recebe conversão ou inferência de responsável.

`SEND_TO_OVEN` mantém os dados da reserva para consulta, mas a pizza deixa de compor a carga de montagem. Não representa trabalho no forno nem exclusividade sobre etapas futuras.

## Endpoint e regras

Usamos o endpoint de comandos existente:

```http
POST /orders/v2/:orderId/pizzas/:pizzaId/commands
Authorization: Bearer <token>
X-Workstation-Device-Key: <uuid>
```

```json
{
  "command": "CLAIM_PIZZA",
  "expectedState": "WAITING_ASSEMBLY",
  "expectedVersion": 0,
  "clientCommandId": "b518f064-a3b8-4b41-a283-2e3013e55991"
}
```

Nenhum operatorId, terminal, timestamp ou assignment enviado pelo frontend é aceito. A identidade vem da sessão validada fora e dentro da transação.

| Comando | Regra |
| --- | --- |
| CLAIM_PIZZA | Livre em WAITING_ASSEMBLY, ASSEMBLING ou ASSEMBLY_PAUSED. A elegibilidade em ASSEMBLING permite assumir registros anteriores à migration sem inventar atribuição retroativa. Outro responsável: 409. |
| RELEASE_PIZZA | Somente responsável em WAITING_ASSEMBLY ou ASSEMBLY_PAUSED. Em ASSEMBLING, deve pausar primeiro. Sem responsável, outro responsável ou fora da montagem: 409. |
| START_ASSEMBLY | WAITING_ASSEMBLY livre: claim + start na mesma transação e uma única versão. Já atribuída ao próprio operador: inicia sem novo claim. Atribuída a outro: 409. |
| PAUSE_ASSEMBLY | ASSEMBLING e sessão do responsável. |
| RESUME_ASSEMBLY | ASSEMBLY_PAUSED e sessão do responsável. Após release, é preciso assumir antes. |
| SEND_TO_OVEN | ASSEMBLING e sessão do responsável. Encerra montagem, mantendo a autoria/origem da reserva. |

Todos exigem versão/estado esperados e pertencimento da pizza ao pedido. Pedido cancelado ou já em logística não pode receber esses comandos. Assignment não muda o estado produtivo. Claim em espera mantém pedido WAITING_PRODUCTION e não preenche productionStartedAt. Release em pausa mantém IN_PRODUCTION. Agregação segue as regras já existentes.

## Atomicidade, concorrência e idempotência

CAS por id/pedido/estado/versão/assignedOperatorId, dentro da mesma transação de validação de sessão, reserva, mudança de estado, histórico, agregação/versão do pedido e receipt. Qualquer falha desfaz tudo. As tentativas existentes para conflitos SQLite/versão da agregação continuam ativas.

Dois tablets disputando a mesma versão: um vence; o outro recebe 409, sem receipt/histórico parcial. Duas abas ou terminais do mesmo operador podem operar a pizza, mas continuam sujeitos ao CAS; não podem sobrescrever uma ação concorrente silenciosamente.

Mesmo clientCommandId/conteúdo/sessão: retorna resposta original sem nova escrita. Mesmo ID com conteúdo ou autoria diferente: 409. Novo CLAIM_PIZZA do próprio responsável com versão atual é no-op: grava apenas receipt, sem mudar versão/timestamp/histórico nem publicar eventos; resposta `replayed=true`. Nova tentativa com versão antiga continua 409. O frontend faz GET após replay para obter dados atuais.

Histórico CLAIMED/RELEASED registra estado anterior/atual, operador, terminal, sessão, data do servidor, comando e versão. Claim automático gera dois eventos na mesma versão/data: CLAIMED com `commandId=<uuid>:claim`, e START_ASSEMBLY com UUID original. A dupla faz parte de uma única transação e receipt. Eventos antigos permanecem intactos; não há backfill de SYSTEM ou Worker.

## Realtime e UI

Após commit, claim/release publicam os eventos existentes `kitchen.pizza.updated` e `kitchen.order.updated` com novas versões. Outros tablets fazem GET e exibem a reserva confirmada. Replay/no-op/erro/rollback não publicam. Reconexão continua consultando estado persistido; não reexecuta eventos. Não adicionamos um novo protocolo de eventos ou emissão anterior ao commit.

No detalhe: Montador: nome, Sua pizza quando própria, Pizza disponível quando livre, botões Assumir pizza e Liberar pizza. Ações de terceiros desabilitadas, visualização preservada. Iniciar faz reserva automática para evitar duas chamadas. Pizza liberada já em montagem/pausa exige Assumir antes de outras ações. Liberar em montagem fica desabilitado com instrução para pausar.

Filtros Fila geral, Minhas pizzas e Disponíveis: últimas duas vistas incluem apenas pizzas ainda na montagem. O painel central mantém contagem/timeline do pedido completo e apresenta os cards filtrados com números originais, evitando interpretar uma parte do pedido como conclusão global. O modo DEV mantém ações locais e não executa claims reais.

## Sessão encerrada ou expirada

Logout retorna 409 enquanto o operador possuir qualquer pizza atribuída em WAITING_ASSEMBLY, ASSEMBLING ou ASSEMBLY_PAUSED, inclusive em outro terminal. UI orienta pausar/liberar explicitamente. O backend repete a verificação na transação: filtros ou estado local desatualizado não permitem contornar a regra.

Novo PIN de outro operador no terminal de origem de uma reserva ativa também retorna 409 antes de revogar a sessão anterior. Mesmo operador pode autenticar novamente para recuperar uma sessão expirada. Expiração, desconexão, fechamento da aba ou rotação administrativa de PIN **não liberam a pizza**. As referências de origem permanecem; a nova sessão válida do responsável pode pausar/liberar/concluir. Não há supervisor ou liberação por terceiros nesta entrega.

Após SEND_TO_OVEN, a montagem não bloqueia logout. Os eventos e sessões históricas não são apagados. Se o responsável ficar indisponível/desativado, será necessária recuperação administrativa de acesso ao mesmo operador; não há redistribuição silenciosa. Essa limitação precisa ser tratada antes de uma operação ampla.

## Migration e proteção dos dados

`20261006120000_pizza_assignment`: somente cinco ALTER TABLE ADD COLUMN e um CREATE INDEX. Não remove/recria tabela, não modifica valores antigos, não atribui operadores a pizzas antigas. As novas referências são nullable e têm FK. A API da loja não estava ativa na porta 3333 durante a operação; não foi necessário encerrar outro processo.

Prisma Client regenerado e migrate deploy aplicado. Backup consistente via SQLite backup API antes da migration: `apps/api/prisma/backup-phase3d2b-before-2026-10-06T135220200Z.db`, ignorado pelo Git. Comparação de todas as colunas anteriores: **18 tabelas preservadas integralmente**; integrity_check=ok, foreign_key_check sem violações.

Ferramenta `scripts/verify-assignment-migration.mjs`: executar com serviços parados, primeiro sem argumentos para backup, depois migrate deploy, depois `--verify <backup>` para comparação. Requer Node com node:sqlite/backup (ambiente validado: Node 24.11.1). Não faz restauração ou alteração destrutiva. Não restaurar backup antigo após escritas posteriores sem reconciliação dessas escritas.

## Testes e aceite

API: claim/repetição/concorrência, operador errado para claim/release/start/pause/resume/send, pausa obrigatória antes de release, liberação/reassunção, start atômico, identidade e datas no histórico, sessão inválida/expirada e recuperação, logout e troca por outro PIN bloqueados, duas sessões do mesmo operador, rollback de claim/release e regressões anteriores de CAS/idempotência/agregação/publicação.

Navegador com duas sessões/terminais e banco descartável: criar pelo balcão, start com reserva, terceiro visualiza sem operar, disputa com 200/409, release/reassunção via realtime, refresh, offline/evento perdido, reinício da API, logout bloqueado, pausa/release/troca, duas abas e dois terminais do mesmo operador, filtros e preservação de histórico. Regressões DEV, leitura persistida e recuperação de resposta perdida também são executadas.

Aceite final: lint, typecheck, build; **106 testes API (17 novos) e 34 testes Assembly aprovados**. Quatro testes de navegador aprovados: DEV, leitura persistida, comandos com replay/409 e realtime com dois tablets/claims. Conferência visual em 1024×768: identidade, filtros e responsável cabem na tela; painel de montagem preservado. `prisma migrate diff` não detectou diferença entre banco e schema. Mensagens esperadas dos testes de rollback simulam falhas e não são falhas da suíte. Alterações 3D.2B registradas no commit `90f517f`, após repetir as cinco validações; sem push. package-lock.json não foi alterado nesta fase.

## Riscos e próxima Fase 3D.2C

- Identidade é operacional por PIN; quem compartilha PIN compartilha a permissão do operador. Não é autenticação administrativa completa.
- Reserva não expira automaticamente. Operador indisponível requer procedimento administrativo futuro, com auditoria; desativar operador com pizzas pendentes pode impedir continuidade.
- Sessão/terminal de origem não restringem o operador a um único tablet. Versionamento protege alterações simultâneas; não há lease por dispositivo.
- Realtime sem outbox pode perder publicação após commit; reconexão/GET/fallback recuperam dados. Não há garantia de entrega de evento para cada ação.
- SQLite, consulta por lote e quantidade crescente de tablets precisam de validação de carga na loja. Histórico recebido em replay é antigo; leitura posterior mantém a tela atualizada.
- Código anterior à 3D.2B não aplica a regra de responsável. Evitar rodar API antiga em paralelo com a API nova sobre o mesmo banco.

Carga inicial futura = COUNT(PizzaItem WHERE assignedOperatorId = operador AND state IN (WAITING_ASSEMBLY, ASSEMBLING, ASSEMBLY_PAUSED)). Não conta WAITING_OVEN nem etapas seguintes; inclui reservadas em espera e pausadas. Não confundir carga com produtividade, duração ou quantidade de pedidos. Agrupar por operador sem lista fixa/número fixo; excluir operadores inativos, mas manter suas reservas para tratamento explícito.

Antes de distribuição automática: definir disponibilidade operacional, recuperação/supervisão auditada e regras de empate; calcular carga no servidor; seleção + claim na mesma transação com CAS; idempotência; registrar motivo/critério da atribuição; validar concorrência e quedas com tablets reais. Eventual ponderação por tamanho/composição deve ser uma regra explícita validada operacionalmente, sem inferir complexidade arbitrária. Nada disso está implementado nesta fase.
