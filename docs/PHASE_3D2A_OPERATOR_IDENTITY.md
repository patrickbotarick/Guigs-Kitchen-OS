# Fase 3D.2A — identidade operacional e terminal

## Git e escopo

Fase 3D.1 fechada no commit local `10b1cf6` — `feat: add realtime kitchen synchronization`, após revisão, lint/typecheck/build, 73 testes API e 34 montagem aprovados. `package-lock.json` preservado fora do commit: apenas metadados ambientais peer/libc. Nenhum banco, backup, segredo ou `.env` incluído; sem push.

Esta fase cria identidade, sessão e autoria auditável. Não implementa distribuição automática, fila privada, assignment, claim, lock, reatribuição, supervisor, forno operacional, finalização, despacho, dashboard ou estoque. Alterações 3D.2A ficam para revisão local, sem commit nesta execução.

## Entidades

**Operator**: id, name único, pinHash, active, createdAt/updatedAt. Não há quantidade fixa nem nomes cadastrados automaticamente. Worker é a entidade legada e não foi convertida em Operator, nem recebeu PIN inferido.

**Workstation**: id, name, deviceKey UUID único, active, createdAt/updatedAt. O navegador gera UUID no primeiro acesso e mantém em localStorage (`guigs-workstation-device-key`). Refresh e reabertura do mesmo perfil preservam o terminal. IP nunca identifica o terminal. Limpar armazenamento, usar perfil privado ou outro navegador cria outra identidade; o UUID não é uma identidade física inviolável.

O backend registra um terminal somente depois de PIN válido. Nome inicial `Tablet Cozinha <8 primeiros caracteres do UUID>`, editável pelo comando administrativo. Terminal inativo não admite login nem valida sessões existentes.

**OperatorSession**: id, operatorId/workstationId com FK Restrict, tokenHash único, startedAt, endedAt, expiresAt, active. Login encerra sessões ativas anteriores do mesmo terminal e cria a nova na mesma transação. Logins concorrentes são serializados/repetidos em conflitos SQLite; uma sessão ativa por terminal é mantida pelo serviço. Um operador pode usar terminais diferentes nesta fase: não existe ownership ou lock.

Token opaco aleatório de 256 bits; somente SHA-256 do token é gravado no banco. Token retorna apenas no login e fica no localStorage (`guigs-operator-session-token`); nomes/IDs exibidos vêm da validação do backend. Duração padrão 12 horas, configurável por `OPERATOR_SESSION_HOURS`. Validade exige active, endedAt nulo, expiresAt futuro e operador/terminal ativos. A flag ativa de sessão expirada pode permanecer até próximo login/configuração; consultas devem considerar também expiresAt. Fim efetivo de turno: endedAt ou expiresAt quando expirou.

## PIN e segurança básica

PIN numérico de 4 a 8 dígitos. Hash scrypt com salt aleatório de 16 bytes, N=16384/r=8/p=1 e saída de 64 bytes. Formato versionável `scrypt$16384$8$1$salt$hash`; nenhum PIN puro é persistido. Compare com timingSafeEqual. Sem endpoint público de listagem/cadastro/consulta por PIN. Login compara todos os hashes ativos, sem retornar nome ou posição de correspondência antes de sucesso. PIN ambíguo é rejeitado; configuração administrativa impede duplicidade, inclusive com operadores inativos.

Erros de PIN inexistente/inativo e terminal indisponível são genéricos. Limite básico em memória: cinco tentativas por UUID em cinco minutos; trinta por IP de conexão em um minuto; no máximo dois logins sendo verificados ao mesmo tempo. HTTP 429 com Retry-After. IP serve exclusivamente ao limite auxiliar, evitando contorno simples por rotação de UUID; não usa X-Forwarded-For como identidade. Cache tem limite de entradas e limpeza de expirados; reinício da API limpa limites. Login válido limpa contador do terminal. Não é IAM corporativo nem proteção distribuída.

Bearer token + `X-Workstation-Device-Key` são obrigatórios nos comandos e nas consultas/encerramento de sessão. Sessão validada antes do comando e novamente dentro da transação. IDs de operador/terminal enviados no payload do comando são rejeitados por schema estrito; autoria é resolvida pelo servidor.

## Endpoints

`POST /operators/session`:

```json
{ "pin": "<4 a 8 dígitos>", "workstationDeviceKey": "<uuid do navegador>" }
```

201 retorna `{ token, session }`. session contém somente sessionId, operatorId/operatorName, workstationId/workstationName, startedAt/expiresAt. Nunca retorna pinHash/tokenHash. 401 para falha genérica; 400 para payload inválido; 429 para limite.

`GET /operators/session`: valida credenciais e retorna session, sem token ou hashes. `DELETE /operators/session`: revoga a sessão com endedAt do servidor e responde 204. Credencial inválida/expirada/encerrada ou de outro terminal: 401. Respostas desses endpoints têm Cache-Control: no-store.

## Tablet e troca de montador

Sem sessão validada, `/kitchen/assembly` mostra Identifique-se, PIN mascarado, números grandes, apagar e OK/Enter. PIN não fica no armazenamento; campo é limpo no envio. Cadastro/configuração não usa PIN digitado em argumento de shell nem arquivo de texto.

Token existente é validado via GET antes de montar a fila/socket. Checagem adicional a cada 60 segundos e ao focar a janela. 401 de comando volta ao PIN imediatamente. Erro de rede no bootstrap não libera identidade sem validação; sessões já validadas preservam tela/dados, mas API continua verificando todos os comandos. Tokens substituídos/encerrados sincronizam por storage entre abas do mesmo perfil.

Cabeçalho discreto mostra `nome • terminal` e Trocar montador. Logout precisa de confirmação HTTP; falha de rede não finge encerramento. Enquanto comando está em andamento/pendente, troca fica desabilitada. Se a fila contém pizza ASSEMBLING, mostra aviso e Confirmar troca/Continuar montando. Isso é aviso de trabalho na fila, não assignment. Sessão é encerrada, volta ao PIN e ações seguintes usam a nova sessão. Nenhum pedido é reatribuído.

Comandos incertos ficam na sessionStorage da aba vinculados a operatorSessionId. Retry só ocorre na sessão original; uma sessão diferente descarta a intenção local com aviso para conferir o estado carregado, sem repetir automaticamente nem alterar autoria passada. Dados persistidos são relidos. Idempotência inclui sessão/operador/terminal no hash; tentar o mesmo clientCommandId sob outra sessão retorna 409. Recibos antigos sem sessão permanecem históricos; não são convertidos/reinterpretados.

DEMO permanece independente de login/API/socket. Fluxo v1/balcão e criação v2 preservados. GET de pedidos e broadcast Socket.IO continuam na infraestrutura pública da LAN; esta fase protege ações humanas, não implementa autorização de leitura multi-loja.

## Histórico e métricas

Novos comandos START_ASSEMBLY/PAUSE_ASSEMBLY/RESUME_ASSEMBLY/SEND_TO_OVEN registram actorType=OPERATOR, actorId=operatorId, operatorId, workstationId e operatorSessionId. Operador/sessão possuem FKs; workstationId histórico existente permanece scalar para não reinterpretar valores anteriores. Novos valores são resolvidos da sessão validada, cujo terminal tem FK. Histórico agregado também usa OPERATOR e inclui sessão/terminal nos metadados.

Históricos anteriores permanecem intactos, inclusive SYSTEM sem identidade conhecida. Criação automática mantém SYSTEM. Receita/snapshot, tamanho/composição/sabores, timestamps e estados continuam persistidos. Sessões e históricos não são apagados ao trocar operador ou rotacionar PIN.

Base de métricas:

- conclusão de montagem por operador/terminal: SEND_TO_OVEN + IDs auditados;
- duração total: assemblyStartedAt → assemblyCompletedAt/WAITING_OVEN;
- pausas/retomadas: eventos e changedAt, permitindo contar e somar intervalos;
- sabor/tamanho/inteira/meio a meio: receita/snapshot da pizza;
- volume por turno: operatorSessionId + janela startedAt/fim efetivo;
- autoria por etapa: operador em cada transição.

Definir política de atribuição antes do dashboard: operador que envia ao forno não necessariamente fez todo o trabalho. Pizza com vários operadores ou troca durante ASSEMBLING não permite afirmar tempo efetivo exclusivo de cada montador só pela autoria dos botões. Duração total inclui pausas; tempo ativo exige descontá-las. Não inventar autoria dos registros anteriores. Dashboard/assignment não implementados.

## Cadastro e configuração

Na máquina da loja, em terminal interativo na raiz:

```powershell
npm run operator:configure
npm run workstation:configure
```

Primeiro comando pede nome e PIN mascarado. Nome existente atualiza PIN/reativa; revoga sessões anteriores. Para inativar com confirmação de PIN pelo administrador: `npm run operator:configure -w @guigs/api -- --inactive`. Não informar PIN como argumento. Nomes/PINs não vêm do frontend; não existe número fixo de montadores. Nenhum operador fictício foi criado no banco da loja: cadastro real é necessário para o primeiro uso.

Segundo comando pede UUID mostrado na tela de PIN e novo nome; terminal deve ter sido registrado por um login válido. Sessões validadas passam a mostrar o novo nome. Configure antes de nomes operacionais definitivos, se desejado.

Fixtures João/Carlos existem somente nos testes/bancos descartáveis em scripts/helpers/operator-fixtures.mjs. Nunca executadas pelo seed da loja. O seed legado de Worker/catalog continua independente.

## Migration e integridade

`20261005220000_operator_identity`: cria Operator, Workstation e OperatorSession; adiciona colunas nullable operatorId/operatorSessionId em PizzaProductionHistory e operatorSessionId em PizzaCommandReceipt, com FKs/índice de operador por horário. Não remove/redefine tabelas, não preenche autoria retroativa, não modifica histórico antigo.

API Kitchen identificada na porta 3333 e interrompida sob autorização anterior para liberar engine Prisma. Cliente regenerado. Backup anterior: `apps/api/prisma/backup-phase3d2a-before-20261005T201236277Z.db`, ignorado pelo Git. Migration aplicada ao dev.db; comparação de todas as colunas originais confirmou 15 tabelas preservadas. integrity_check=ok, foreign_key_check vazio, schema sem diferenças/migrate status atualizado. Operator/OperatorSession vazios na loja. API retomada. Testes operacionais usam somente SQLite descartável.

## Validação e próximos passos

Testes de API cobrem hash/salt, PIN válido/inválido/inativo, terminal novo/existente/inativo, validade/binding/revogação/expiração, ausência de sessão, identidade forjada, histórico completo, idempotência entre sessões, rate limit, configuração, rotação e logins concorrentes.

Teste de dois contextos Edge touch: PIN inválido e válido, João/Carlos em terminais distintos, realtime, refresh, transições alternadas com autoria, evento perdido/reconexão e reinício da API. Troca com aviso muda futuras ações, mantém histórico antigo e UUID; token local inválido é rejeitado. Capturas de PIN e Assembly verificadas em tablet 1024×768. Regressões DEV, leitura persistida e comandos/retry/409 preservadas.

Para 3D.2B: revisar/commitar esta fase; definir a unidade de trabalho e uma regra de responsabilidade; depois claim/atribuição com expiração, renovação/liberação e auditoria, preservando CAS/idempotência/realtime. Campos possíveis apenas documentados: assignedOperatorId, assignedWorkstationId, assignedAt, claimExpiresAt, assignmentVersion. Não adicionar implicitamente ao status ou aos históricos atuais.

Distribuição automática futura: somente após responsabilidade explícita e disponibilidade confiável. Comparar carga por pizzas/complexidade e trabalho ativo, não só número de pedidos; desempate determinístico/fairness e operação auditada. Evitar sorteio sem visibilidade ou redistribuição silenciosa. Nenhuma distribuição implementada aqui.

Riscos: PIN curto/compartilhado e HTTP da LAN não equivalem a identidade pessoal forte; produção exposta requer HTTPS e controle de acesso. Token em localStorage depende da integridade do navegador/XSS; limites em memória reiniciam com API. Verificação por PIN percorre operadores ativos e exige teste de carga antes de muitos operadores. Identidade do terminal é por perfil, sem attestation física. Realtime continua sem outbox; SQLite mantém seus limites. Métricas precisam da política de atribuição descrita acima.
