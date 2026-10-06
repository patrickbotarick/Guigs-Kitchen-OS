# Fase 3D.2D — presença, turno e recuperação supervisionada

Implementação local de 06/10/2026. A Fase 3D.2C foi fechada no commit `e894040`, `feat: add automatic pizza workload distribution`, após revisão e lint/typecheck/129 testes API/34 testes de montagem/build. Esta fase preserva criação v1/v2, comandos, snapshots, responsabilidade, distribuição por carga e realtime. Não acrescenta forno operacional, finalização, pesos, dashboard, estoque ou ERP.

## Presença e heartbeat

`POST /operators/session/heartbeat`, corpo `{}`, exige o mesmo Bearer e `X-Workstation-Device-Key` da sessão. O servidor valida sessão, validade, operador e terminal dentro da transação e grava seu próprio horário em `lastSeenAt`. Não aceita timestamp, identidade ou disponibilidade enviados no corpo. Login sozinho inicia uma sessão OFFLINE, sem lastSeenAt; abrir Assembly confirma a presença com heartbeat imediato.

Enquanto o layout real da montagem estiver aberto, o frontend envia heartbeat sequencial a cada **20 segundos**, também ao recuperar foco/conexão. O modo DEMO não abre sessão nem envia heartbeat. Requests têm timeout de 15 segundos; falha de rede mantém dados existentes, informa erro e tenta novamente. Sessão revogada/expirada retorna 401 e volta ao PIN. Não depende de beforeunload. Duas abas no mesmo perfil compartilham a sessão: fechar uma não torna offline a outra que ainda opera. Fechar todas, travar JavaScript, sair da montagem ou perder rede interrompe a presença após o prazo.

| Configuração | Padrão | Regra |
| --- | --- | --- |
| `OPERATOR_HEARTBEAT_MS` | 20000 | intervalo enviado pelo backend na sessão |
| `OPERATOR_STALE_MS` | 60000 | idade >= 60 s: STALE e inelegível |
| `OPERATOR_OFFLINE_MS` | 120000 | idade >= 120 s: OFFLINE |

Valores inteiros >= 1000 ms; STALE deve ser pelo menos duas vezes o heartbeat e OFFLINE maior que STALE. Configuração inválida impede iniciar a API. Os testes multi-tablet usam 1/4/7 segundos apenas no processo isolado, sem modificar `.env` da loja. A duração da credencial continua 12 horas, configurável por `OPERATOR_SESSION_HOURS`; presença não prolonga essa duração.

A presença efetiva é calculada no servidor a partir do último horário persistido e da validade operacional. Sessão encerrada/expirada, operador/terminal inativos, ausência de heartbeat ou timestamp futuro são OFFLINE. GET da sessão e conexão Socket.IO não contam como heartbeat. Reiniciar a API não transforma sessões antigas em ONLINE.

A API executa uma varredura a cada até 10 segundos para persistir mudanças e emitir notificações. Atualização condicional de lastSeenAt/status/validade impede que uma varredura atrasada sobrescreva heartbeat novo. **A distribuição usa diretamente o cutoff de lastSeenAt**, portanto exclui STALE no limite de 60 segundos mesmo antes da varredura. Uma queda detectada por timeout tem latência deliberada; não existe detecção instantânea confiável de fechamento abrupto.

## Elegibilidade para distribuição e destino

Nova pizza só considera operador ativo com sessão ativa, não encerrada e não expirada, terminal ativo, `available=true` e `lastSeenAt` recente dentro do limite ONLINE. Uma única sessão representativa por operador mantém o balanceamento da 3D.2C; múltiplos tablets não aumentam a chance. A carga continua contando WAITING_ASSEMBLY/ASSEMBLING/ASSEMBLY_PAUSED atribuídas ao operador, inclusive em sessões antigas.

Nenhum timeout, desligamento ou reinício libera pizzas. Login/heartbeat/reconexão não redistribuem pedidos antigos. Reservas permanecem com seu responsável até comando explícito. Suspender recebimento impede novas atribuições, mas permite terminar o trabalho existente. Supervisor que também recebe pizzas segue essas regras; deve suspender recebimento se atuar somente em supervisão.

## Encerrar turno

O botão **Encerrar turno**, junto à identidade existente, usa `DELETE /operators/session`. Sem pendências, grava active=false, endedAt pelo servidor, presença OFFLINE e evento SHIFT_ENDED na mesma transação; emite atualização operacional e o cliente volta ao PIN.

Se houver pizzas WAITING_ASSEMBLY/ASSEMBLING/ASSEMBLY_PAUSED atribuídas ao operador, inclusive em outro terminal ou sessão antiga, retorna **409** e mantém sessão e reservas. É preciso terminar, pausar/liberar ou solicitar recuperação. Trocar montador preserva o mesmo bloqueio. O encerramento termina a sessão atual; outras sessões válidas do mesmo operador continuam independentes e precisam ser encerradas em seus respectivos terminais.

## Autorização mínima de supervisor

`Operator.role` é ASSEMBLER por padrão; SUPERVISOR permite apenas as operações desta recuperação. O backend consulta o papel atual e exige presença ONLINE do supervisor em cada request e novamente dentro da transação. Um montador recebe 403 mesmo ao chamar o endpoint diretamente; ocultar o link na UI não é a proteção.

Cadastro/alteração é administrativo, pelo terminal da máquina:

```powershell
npm run operator:configure -- --supervisor
npm run operator:configure -- --assembler
```

O utilitário pede nome e PIN mascarado; nunca passa PIN pela linha de comando. Para um operador existente, omitir os flags preserva seu papel; novo operador sem flag é ASSEMBLER. Mudança de PIN/papel revoga sessões anteriores, preservando histórico. Não há promoção pública por HTTP, supervisor padrão, PIN padrão ou bypass DEV. Nenhum supervisor de teste foi criado no banco da loja. Antes do piloto, o administrador deve configurar o supervisor real.

Essa solução pressupõe acesso administrativo ao sistema operacional/CLI e PIN individual. Não representa autenticação corporativa, autorização geral de ERP ou identificação biométrica.

## Recuperação e reassign

Interface mínima: **`/kitchen/assembly/recovery`**, link Recuperar pizzas disponível para supervisor. Exibe pizzas atribuídas em montagem, motivo obrigatório e destinos online. Reutiliza sessão, layout, dados reais e estilo de formulário existente. A leitura dos destinos é `GET /operators/recovery-targets`, protegida; retorna IDs/nomes operacionais, nunca PIN/hash/token.

Endpoint:

```text
POST /orders/v2/:orderId/pizzas/:pizzaId/recovery
```

Payload exemplo:

```json
{
  "command": "SUPERVISOR_REASSIGN",
  "expectedState": "ASSEMBLY_PAUSED",
  "expectedVersion": 3,
  "clientCommandId": "4642460f-a843-4aab-8d48-fb5ce391172b",
  "reason": "Tablet indisponível; bancada e pizza conferidas",
  "targetSessionId": "cmexemplosessao00000000000"
}
```

IDs reais são obtidos das leituras, não do exemplo. Zod exige motivo aparado com 3–500 caracteres e UUID de comando. Destino é obrigatório somente no reassign. Valida pizza pertencente ao pedido v2, estado/versão esperados, atribuição existente e pedido fora de logística/cancelamento.

| Comando | Estado permitido | Resultado |
| --- | --- | --- |
| SUPERVISOR_PAUSE | ASSEMBLING | ASSEMBLY_PAUSED, pausedAt do servidor; mantém responsável |
| SUPERVISOR_RELEASE | WAITING_ASSEMBLY ou ASSEMBLY_PAUSED | limpa reserva, registra releasedAt; pizza disponível |
| SUPERVISOR_REASSIGN | WAITING_ASSEMBLY ou ASSEMBLY_PAUSED | troca responsável e origem; mantém estado e progresso |

Montagem ativa não pode ser liberada ou reatribuída: retorna 409. Supervisor deve **conferir a situação física e executar pausa explícita** antes de recuperar quando o responsável está indisponível. A pausa tem evento próprio e motivo; não retoma ou reinicia a pizza automaticamente. O backend não consegue comprovar a condição física da bancada.

Reassign exige outro operador com sessão válida, terminal ativo, recebimento habilitado e presença ONLINE, revalidando no momento da transação. Destino stale, offline, expirado, encerrado, inativo ou igual ao responsável atual retorna 409. O supervisor pode recuperar também uma reserva de operador online, desde que informe motivo e respeite a pausa; isso é ação explícita e auditada, nunca redistribuição silenciosa.

## Atomicidade, concorrência e idempotência

Cada recuperação valida autorização, versão/estado/reserva/destino, atualiza pizza com CAS e version+1, insere histórico, recalcula agregação/version do pedido e grava `PizzaCommandReceipt` em **uma transação SQLite**. Nenhuma alteração parcial ou evento é publicado se falhar. Concorrência com montador ou outro supervisor dá um único vencedor e conflito 409. Retries limitados tratam contenção transacional.

O hash do comando inclui pedido/pizza, intenção normalizada, motivo/destino e sessão do supervisor. Mesmo clientCommandId+conteúdo+sessão retorna resposta anterior com replayed=true, sem duplicar histórico/timestamps/eventos. Mesmo ID com outro conteúdo/sessão conflita. UUID compartilha a unicidade dos comandos de montagem.

A interface bloqueia ações durante envio, aplica dados confirmados através de refetch e recarrega em conflito. Envio sem confirmação mantém o mesmo UUID para **Confirmar recuperação novamente** enquanto a tela está montada. Esse pending é em memória: após refresh/navegação, conferir estado e histórico antes de nova ação. CAS e regras de estado impedem repetir silenciosamente a alteração anterior; não há fila offline de supervisão.

## Auditoria e base de métricas

`PizzaProductionHistory` recebe SUPERVISOR_PAUSED/SUPERVISOR_RELEASED/SUPERVISOR_REASSIGNED, estado anterior/novo, timestamp do servidor, versão, commandId, motivo e autor ADMIN com operatorId/operatorSessionId/workstationId do supervisor. Metadata preserva operador, workstation e sessão anteriores e novos. Os eventos anteriores nunca são reescritos. AUTO_ASSIGNED continua sendo autoria SYSTEM com destino registrado; comandos de montagem preservam seu operador original.

Nova tabela `OperatorSessionEvent`, com FK Restrict à sessão, registra SESSION_STARTED, SESSION_REPLACED, SESSION_REVOKED, PRESENCE_CHANGED, AVAILABILITY_CHANGED e SHIFT_ENDED. Há eventos apenas em mudanças relevantes, não um registro por heartbeat. startedAt/endedAt/expiresAt/lastSeenAt, status, disponibilidade e timestamp permitem reconstruir intervalos. Se a API ficou parada, o próximo heartbeat ou sweep registra limites de timeout dedutíveis do último lastSeenAt, sem afirmar atividade física durante a interrupção. Suspensões de recebimento guardam limites de entrada/saída.

Essa base permite futuros cálculos de turno, tempo com presença válida, períodos sem recebimento, assignments, montagens concluídas (`assemblyCompletedAt`/SEND_TO_OVEN), recoveries e reassigns. Tempo ONLINE é estimativa de sessão responsiva, não produtividade humana. Sessões sobrepostas precisam ser unidas por operador para não duplicar duração; turno sem logout usa expiração como limite. Não há dashboard nesta fase.

## Realtime

Mudanças operacionais emitem `operators.changed` após commit, com somente sessionId. O Assembly revalida por heartbeat/refetch; sessão encerrada em outra aba volta ao PIN. Heartbeat ONLINE continuado não publica por pulso, evitando refetch em massa a cada 20 segundos. Mudanças por timeout, retorno, login, disponibilidade e fim de turno notificam os tablets conectados.

Recuperação publica `kitchen.pizza.updated` e `kitchen.order.updated` já existentes, após commit; Minhas/Disponíveis são recalculadas nos tablets envolvidos. Replay não emite. Reconexão continua fazendo GET completo, com fallback de leitura. Não há outbox/replay durável de notificações; se um evento for perdido, GET recupera o estado do banco. Configuração administrativa via CLI não usa Socket.IO; revogação é detectada no heartbeat seguinte.

## Migration e preservação

`20261006160000_presence_recovery` é exclusivamente aditiva: papel em Operator, lastSeenAt/presenceStatus em OperatorSession, nova tabela/index OperatorSessionEvent. Sessões anteriores começam com presença desconhecida/OFFLINE até heartbeat válido; não são automaticamente distribuídas ou convertidas. Histórico anterior não recebe eventos inventados.

A API da loja não estava ouvindo em 3333 ao preparar o banco. Cliente Prisma regenerado e migration aplicada após backup SQLite consistente:

`apps/api/prisma/backup-phase3d2d-before-2026-10-06T152056922Z.db`

Verificação comparou todas as colunas/linhas anteriores das **18 tabelas**: preservadas. integrity_check=ok, foreign_key_check sem violações; migrate diff sem diferença entre schema e banco. Banco/backup/.env/builds permanecem ignorados; package-lock.json não mudou.

```powershell
# Com API parada, antes de migration em outro banco da loja:
node scripts/verify-assignment-migration.mjs --phase phase3d2d
npm run db:generate
npm run db:migrate
node scripts/verify-assignment-migration.mjs --phase phase3d2d --verify apps/api/prisma/backup-phase3d2d-before-<timestamp>.db
```

Não remover colunas/tabelas para rollback. Versão anterior ignora presença e volta à regra menos restrita de elegibilidade: interromper distribuição antes de reverter aplicação. Preservar backup e histórico; não fazer reset/clean/restore destrutivo.

## Validação e cenário integrado

`presence-recovery.integration.test.ts` acrescenta **31 testes**: autenticação/horário do heartbeat, ausência inicial de presença, STALE/OFFLINE, exclusão antes do sweep, reconexão, reinício de serviço, três operadores, fim livre/bloqueado, períodos de recebimento, desativação/timestamp futuro, autorização, motivos inválidos, release/reassign/pausa, destinos inválidos, identidade histórica, idempotência, disputa simultânea, rollback, pertencimento/versão, dois sockets e configuração inválida.

`npm run test:assembly:presence:browser` cria três perfis touch 1024×768 (João/Carlos/Pedro), API/Vite/SQLite descartáveis. Carlos é supervisor somente na fixture. Cria nove pizzas pelo balcão (3/3/3), inicia uma de Pedro, desliga sua rede e aguarda STALE/OFFLINE; pedido seguinte não atribui a Pedro e as antigas continuam dele. Pela UI, Carlos pausa explicitamente a montagem, reatribui uma para si e libera outra para fila Disponíveis. Banco comprova histórico completo e autoria anterior. Confere filas atualizadas por realtime, bloqueio de saída com pendências, reconexão de Pedro voltando à elegibilidade, API reiniciada, fechamento real da aba sem liberação e recuperação da sessão ao reabrir. Carlos conclui suas montagens via comandos reais e encerra turno pela UI, voltando ao PIN com SHIFT_ENDED persistido.

Validações finais: lint/typecheck/build, **160 testes API**, **34 testes montagem**, navegadores DEMO, persistido, comandos, realtime, auto-assignment e presença/recuperação. Screenshots fora do repositório, em Temp (`guigs-presence-validation`). Nenhum teste usa pedidos ou operadores de produção. Esses resultados são validação em browser emulado, não piloto físico.

## Pendências e próximo ciclo

- Validar heartbeat/prazos em Wi-Fi real, tablets em primeiro plano, suspensão de tela, economia de bateria e navegadores reais. Aba em background pode ter timers suspensos e tornar-se inelegível legitimamente.
- Configurar supervisor real/PIN individual e nomes dos terminais; ensaiar recuperação conferindo bancada. PIN compartilhado perde autoria individual; restringir acesso administrativo à máquina. Tokens ainda ficam no perfil do browser e transporte HTTP é destinado à rede local atual.
- Encerramento e recebimento são por sessão; múltiplos terminais do mesmo operador exigem disciplina. Timeout não equivale a liberação. Reinício do servidor/relógio e varredura não são medição precisa de presença humana.
- SQLite serializa writers; repetir carga real e ajustar prazos conforme operação. Migração para outro banco exige revisar isolamento da distribuição/CAS.
- Realtime sem outbox depende de GET para eventos perdidos. Recuperação com resposta incerta após sair da tela exige conferir estado/histórico.

**Pronto tecnicamente para planejar/iniciar a Fase 4 — Forno após piloto assistido e fechamento da 3D.2D no Git.** Primeiro executar piloto físico com três tablets, interrupção de rede/aba, carga e recuperação por supervisor. Não há forno operacional, timer, entrada/saída de forno ou finalização implementados nesta entrega. A 3D.2D fica local para revisão, sem commit/push solicitado nesta fase.
