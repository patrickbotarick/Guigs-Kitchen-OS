# Fase 4A — módulo operacional de forno

Fechada após revisão/validações no commit `23a2637` — `feat: add persistent oven workflow`. A configuração e a organização operacional foram evoluídas na [Fase 4B](PHASE_4B_OVEN_OPERATIONS.md); as seções abaixo descrevem o escopo original da 4A.

## Entrega e fechamento da Fase 3

**Fase 3 — fluxo de montagem persistente, multioperador e realtime: STATUS CONCLUÍDA.** A 3D.2D foi revisada, validada e fechada no commit `5f76de4` (`feat: add operator presence and supervised recovery`) antes das alterações do forno. Bancos, backups, segredos e artefatos ficaram fora do commit; o package-lock.json não foi alterado.

O piloto físico continua como validação operacional pendente: tablets da loja, rede real, troca de turno, presença e recuperação supervisionada. Não é bloqueio técnico para iniciar o forno. A Fase 4A acrescenta operação por pizza em `/kitchen/oven`, preservando montagem, balcão e leitura v1/v2. Esta entrega fica local para revisão, sem commit adicional ou push.

## Estados e comandos

| Comando | Estado exigido | Estado resultante | Timestamps do servidor |
| --- | --- | --- | --- |
| ENTER_OVEN | WAITING_OVEN | IN_OVEN | ovenStartedAt, ovenExpectedEndAt |
| REMOVE_FROM_OVEN | IN_OVEN | BAKED | bakedAt |

`SEND_TO_OVEN` continua significando somente montagem concluída (`assemblyCompletedAt` / WAITING_OVEN). BAKED significa retirada/assada confirmada pelo operador, sem conferência, embalagem ou despacho. Nenhum comando permite saltos ou entrada/retirada repetida com um novo identificador após mudar de estado. Não há retorno ao forno nesta fase.

Os campos Prisma, estados e regras de agregação já existiam. **Não foi criada nem aplicada migration da Fase 4A**, nem modificado o schema Prisma. Não há gravação de contador por segundo ou conversão dos pedidos antigos.

## API e contrato

Reutiliza `POST /orders/v2/:orderId/pizzas/:pizzaId/commands`:

```json
{
  "command": "ENTER_OVEN",
  "expectedState": "WAITING_OVEN",
  "expectedVersion": 4,
  "clientCommandId": "43cbb10d-aab4-48d4-9f03-559ed7956ee1"
}
```

Autenticação permanece `Authorization: Bearer <token operacional>` e `X-Workstation-Device-Key: <UUID do perfil do tablet>`. A validação Zod compartilhada inclui os dois comandos. O servidor verifica sessão, expiração/revogação, operador/terminal ativos, presença ONLINE, pedido v2, pertencimento da pizza, estado e versão esperados. Presença também é revalidada dentro da transação. Falha de autenticação retorna 401; pedido/pizza incompatíveis, 404; conflito de estado/versão/presença ou reutilização incompatível do ID, 409. Não foi inventado novo papel de operador do forno.

Uma transação faz CAS da pizza, grava timestamps e histórico, recalcula/CAS o pedido, grava histórico agregado quando muda de status e salva o recibo. Falha em qualquer gravação causa rollback completo. Disputas entre pizzas do mesmo pedido reutilizam a estratégia de retry transacional existente; disputa na mesma pizza nunca sobrescreve silenciosamente.

`clientCommandId` global identifica intenção, pedido/pizza e ator/sessão/terminal pelo hash já existente. Mesmo ID/conteúdo retorna o resultado armazenado com `replayed: true`, sem outro histórico/timestamp/evento. Conteúdo diferente retorna 409. A UI preserva envios incertos na sessionStorage da aba, ligados à sessão; retry usa exatamente o mesmo ID. Após replay busca GET atual, pois o recibo pode ser anterior a comandos posteriores. Encerrar/invalidar a sessão não permite reutilizar o recibo com outra identidade. Fechar a aba pode perder o envio pendente, mas a próxima leitura recupera o estado persistido.

Leituras continuam em `GET /orders/v2` e `GET /orders/v2/:id`. Pedidos v1 não são convertidos nem apresentados como pizzas estruturadas do forno.

## Identidade, responsabilidade e presença

PIN, workstation persistente, token, heartbeat e encerramento de sessão usam a mesma infraestrutura do Assembly. Sem sessão válida, a rota mostra PIN. Heartbeat mantém os limites configurados de ONLINE/STALE/OFFLINE; comandos de forno exigem ONLINE. O histórico registra operador, terminal, sessão, timestamp, estados anterior/novo, comando/ID e versão.

A fila do forno é **compartilhada**, sem claim, atribuição automática ou lock de forno. Qualquer operador válido e online pode executar a transição; CAS decide a disputa. O responsável original da montagem permanece na pizza e no card. Quem entrou/retirou fica no histórico, sem sobrescrever o montador.

`available` ainda significa elegibilidade para receber novas pizzas **de montagem**. Abrir o forno não altera esse valor automaticamente. A tela permite suspender/retomar essa disponibilidade explicitamente: se trabalhar exclusivamente no forno, suspenda o recebimento de montagem nesta sessão. Disponibilidade false não impede operar forno com presença válida. Encerrar turno conserva a regra existente de bloquear pendências de montagem do operador; não foram inventadas reservas de forno.

## Filas e UI

WAITING_OVEN aparece automaticamente após montagem, inclusive quando outras pizzas do mesmo pedido ainda estão em produção. Ordenação por `assemblyCompletedAt` (fallback queuedAt), número do pedido e posição. IN_OVEN aparece em área separada, por horário de entrada mais antigo. Cada metade permanece parte da mesma pizza: `Calabresa / Portuguesa` é um card. Nomes/composição/tamanho/observações vêm dos snapshots históricos, sem substituir pela ficha atual do catálogo.

Cards mostram número/posição, Broto ou Grande, inteira/meio a meio, espera, montador quando disponível, observações e ação. Dentro do forno mostram entrada, tempo decorrido, previsão e indicador. Sem ingredientes detalhados ou preços. Estados vazios, carregamento, erro, atualização, conexão e resposta de comando são explícitos. Botões touch de pelo menos 52 px, layout responsivo e scroll da página; não há limite fictício de quantidade de pizzas no forno.

## Configuração e timer

`OVEN_DEFAULT_MINUTES` configura uma referência genérica temporária. Default **7 minutos**, maior que zero e até 240; aceita valores fracionários. Não é ficha técnica validada ou recomendação culinária. Não há diferença inventada por sabor, composição ou tamanho. Acrescentado apenas à `.env.example`, sem alterar `.env` da loja.

`GET /kitchen/oven/config` retorna `{ defaultOvenMinutes, serverTime }`, sem cache. A configuração é lida ao construir o serviço; mudar o ambiente exige reiniciar a API. Entrada grava `ovenExpectedEndAt = ovenStartedAt + tempo configurado`, mantendo a previsão histórica mesmo após futura alteração da configuração. A tela usa a diferença desses timestamps por pizza, e não o valor atual para reescrever previsões anteriores.

Timer deriva o timestamp persistido e atualiza a exibição a cada segundo. A UI estima o desvio do relógio do tablet pelo horário do servidor e ponto médio da consulta; refresh, nova aba e outro tablet reconstruem a contagem. É uma aproximação sujeita à latência e ao relógio do servidor; não controla equipamento. Falta de previsão é exibida como indisponível.

Indicadores apenas visuais: Normal abaixo de 80% da previsão; Próxima do tempo entre 80% e 100%; Tempo atingido até 60 segundos após previsão; Acima do tempo depois disso. **Nada altera IN_OVEN automaticamente**. Só REMOVE_FROM_OVEN grava BAKED, mesmo se a previsão expirar. Durante falha de conexão o contador pode continuar orientando, mas ações ficam bloqueadas.

Pontos de extensão futuros: resolver tempo por revisão/categoria/sabor/tamanho e gravar a previsão na entrada; identificar forno e capacidade configurada por equipamento, com validação transacional de vagas. Nenhuma capacidade real foi informada, então nenhum bloqueio de capacidade foi implementado. Não há sensores, controle físico ou tempo específico de receita.

## Realtime, reconciliação e agregação

Os comandos reutilizam `kitchen.pizza.updated` / `kitchen.order.updated`, versionados e emitidos somente após commit. SEND_TO_OVEN na montagem, entrada e retirada provocam GET na fila de outros tablets, com coalescência de 100 ms e deduplicação. A reconciliação compartilhada preserva confirmação nova contra GET antigo e entradas removidas. Reenvio idempotente não emite novos eventos.

Connect/reconnect faz GET explícito. Forno tem fallback de 30 segundos após terminar a leitura, timeout de 10 segundos e atualização manual. Dados anteriores permanecem em erro; leitura não validada, desconexão, sessão/presença inválida, comando ou confirmação pendente bloqueiam novas ações. Não há atualização otimista cega. Resposta do comando confirma estado; 409 busca o pedido e informa que os dados foram recarregados. Falha dessa busca mantém ações bloqueadas.

Agregação existente executada na mesma transação, considerando pizzas não canceladas e extras:

- Todas ainda aguardando montagem: WAITING_PRODUCTION.
- Havendo montagem iniciada/pausada, ou mistura de montagem pendente com pizzas mais avançadas: IN_PRODUCTION.
- Sem montagem restante e com alguma WAITING_OVEN/IN_OVEN: OVEN, inclusive com outras já BAKED.
- Todas BAKED ou posteriores: FINISHING enquanto existir finalização/conferência/embalagem pendente. WAITING_DISPATCH exige as regras posteriores já documentadas; retirar do forno não despacha.

Histórico/snapshots/extras e bakedAt permanecem disponíveis para o futuro módulo de finalização. Não existe tela ou comando de finalização nesta entrega.

## Validação e arquivos

Novos: `apps/api/src/oven-config.ts`, `oven.integration.test.ts`; `apps/web/src/features/oven/{OvenPage.tsx,useOven.ts,oven.ts,oven.css,oven.test.ts}`; `scripts/oven-browser-smoke.mjs`; este documento.

Atualizados: contrato compartilhado, serviço/rota API, teste antigo de comando não suportado, Router, links da fila/nav, PIN com identificação do módulo, reconciliação genérica reutilizada pela montagem, scripts npm, `.env.example`, README e documentos de fechamento/roadmap. O teste de realtime da montagem aguarda explicitamente o GET coalescido após reconnect antes de contar leituras: Online pode aparecer antes dos 100 ms da consulta. package-lock.json, Prisma schema e banco da loja preservados.

- API: 22 testes novos de forno; 182 testes totais. Entrada/retirada, sessão/presença, estados/versões/pedido/pizza inválidos, snapshots/Broto/metades, autoria e timestamps, idempotência/replay posterior, comandos simultâneos, agregação e rollback de histórico/pedido/recibo. Cenário com 30 pizzas e entradas em lotes concorrentes.
- Forno: 16 testes de fila, meio a meio, snapshot, tamanho, tempo/indicadores, ausência de previsão, refresh e reconciliação.
- Montagem: 34 testes mantidos. Regressão de navegador de realtime e presença/recuperação em ambientes isolados.
- Navegador do forno: balcão real cria três pizzas (incluindo Broto e meio a meio), distribuição, montagem pela UI, envio, dois operadores/tablets de forno, entrada 1/2, retirada 1, entrada 3, refresh, relógio cinco minutos adiantado, reabertura da aba, resposta perdida/replay, histórico e FINISHING após todas retiradas. Stress de 30 pizzas, disputa 200/409 na mesma pizza, 10 entradas em lotes, rede offline/reconexão, reinício da API e tablets 1024×768 / 768×1024 com scroll/touch verificados.
- Scripts: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:assembly`, `npm run test:oven`, `npm run build`, `npm run test:oven:browser` e navegadores de regressão. Testes API/browser usam SQLite descartável; não criam pedidos ou operadores na loja. Teste de navegador usa referência de 6 segundos só no servidor isolado para validar indicadores rapidamente.

Não é benchmark definitivo de SQLite. Piloto físico, latência/conectividade reais, tempo operacional confirmado e capacidade real continuam pendentes. Socket.IO não possui outbox durável; GET/fallback recuperam eventos perdidos. Autenticação operacional local não substitui controle de acesso remoto/produção. Os comandos continuam sujeitos aos limites da concorrência SQLite já existentes.

## Próximo ciclo / Fase 4B

Fechar a revisão/commit próprio da 4A, realizar piloto físico curto de montagem → forno e confirmar tempo de referência, identificação de forno e política de capacidade com a operação. Essas pendências operacionais não reabrem o fechamento técnico da Fase 3.

Para iniciar 4B, definir explicitamente o escopo: ajustes operacionais do forno ou módulo de finalização. Se for finalização, primeiro definir conferência por pizza, extras/bebidas/complementos, embalagem, retirada/despacho, autoria e agregação, preservando compatibilidade v1/v2 e a mesma transação/CAS/idempotência/realtime. Reutilizar BAKED e snapshots como handoff, sem inferir finalização a partir do timer. Nenhuma dessas funcionalidades foi iniciada aqui.
