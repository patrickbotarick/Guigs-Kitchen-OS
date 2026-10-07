# Rodada 2B — espaços de produção e despacho

Base: `6e9a9b5` (Rodada 2A). Esta rodada mantém Montagem como referência visual,
as quatro colunas de `/kitchen` e o domínio de produção/rotas/conferência já existente.
Não inicia Fase 6 nem investiga a workstation do Atendente.

## Visão geral e contexto físico

Os cards mostram número do pedido, cliente, Entrega/Retirada, canal com nome legível,
tempo total em minutos desde `receivedAt`, pizza/total e progresso de finalização.
Montagem mostra responsável/pausa; forno mostra tempo; acabamento e rota são
identificados nos estados correspondentes. `WAITING_OVEN` aparece como “Aguardando entrada”.
O relógio usa o offset do horário do servidor; não há timestamp inventado.

Forno e Acabamento reutilizam `PhysicalPizzaSummary`: sabores, tamanho, inteira/meio
a meio, borda, alterações independentes por metade e observação vêm do snapshot.
Ingredientes normais e preços continuam fora dessa ficha compacta. Ausência de
horário histórico de saída é explicitada, sem inferência a partir de `updatedAt`.
Nenhuma requisição é feita por card: filas, rotas e configurações são lidas em lote.

## Entrada automática compartilhada

Conforme decisão do usuário, a preferência pertence à estação lógica única
`PRODUCTION`, compartilhada pelos tablets. Não depende do dispositivo que montou
a pizza. É editada no menu de Forno e Finalização e persiste no servidor.

- Padrão `autoOvenEntry=true`: `SEND_TO_OVEN` leva diretamente a `IN_OVEN`, com
  início e previsão de forno no mesmo comando de conclusão da montagem.
- Desativada: o mesmo comando termina a montagem em `WAITING_OVEN`, sem início,
  previsão ou timer de forno. “Colocar no forno” executa `ENTER_OVEN` e inicia o timer.
- Ambos encerram a carga da montagem (`releasedAt`), preservando sua autoria histórica.
- A alteração não move pizzas já existentes nem altera seus tempos.
- Fluxo legado mantém as transições e a política de capacidade anteriores.

Endpoints: `GET /kitchen/production/settings` e
`POST /kitchen/production/settings/commands`. O POST exige sessão e terminal,
presença ONLINE, payload Zod estrito, `expectedVersion` e `clientCommandId`.
CAS, recibo idempotente e auditoria `PRODUCTION_SETTINGS_CHANGED` são atômicos.
O evento `kitchen.production.settings.updated` é publicado após commit e não é
duplicado em replay. Outros tablets refazem a leitura por versão. Erros 409,
reconexão, polling e confirmação de resposta perdida reutilizam o mecanismo existente.

## Espaços de trabalho e rolagem

Produção ocupa `100dvh`, com No forno e Acabamento lado a lado e rolagens próprias.
Rotas permanecem no dock inferior, com abas e organização recolhível. Sua expansão
mantém área de produção e alertas de tempo visíveis. Retirar do forno produz `BAKED`;
Finalizar pizza produz `FINISHED`, individualmente. Extras e embalagem ficam no Balcão.

No Balcão, a lista de rotas fica à esquerda e somente uma rota tem detalhes abertos.
A seleção é mantida durante comandos e refresh na mesma sessão. Resumo de pizzas,
unidades de extras, embalagens e pedidos pendentes fica junto do cabeçalho. A saída
e a reabertura ficam no rodapé, fora da rolagem dos pedidos. Rotas abertas continuam
permitindo adicionar/remover/mover/fechar; rotas despachadas exibem suas saídas.
Conferências, correções e impedimento de saída parcial continuam validados no servidor.

Fixture idêntica para medidas antes/depois: 2 pizzas na fila, 2 em montagem/espera,
10 no forno, 2 em acabamento e 3 rotas fechadas com 10 pizzas, mais extras.
Valores são alturas do documento em pixels, sem scroll horizontal:

| Viewport | Produção antes → depois | Balcão antes → depois | Visão geral |
|---|---:|---:|---:|
| 1280×648 | 2286 → 648 | 4062 → 648 | 648 |
| 1280×800 | 2286 → 800 | 4062 → 800 | 800 |
| 1024×768 | 3912 → 768 | 4062 → 768 | 768 |
| 1366×768 | 2286 → 768 | 4062 → 768 | 768 |

As listas continuam roláveis; a redução de altura não elimina itens.
Capturas/JSON locais ficam em `artifacts/ui-audit/round2b/`, ignorados pelo Git.
Há imagens de antes/depois de cada tela/resolução e do dock expandido.

## Migration e preservação de dados

`20261007170000_production_settings` é aditiva: cria `ProductionStationSettings`
e `ProductionSettingsReceipt`, inicializando `PRODUCTION` com entrada automática.
Foi aplicada no SQLite local após backup e encerramento da API autorizados anteriormente.
API/Vite da loja foram restaurados depois da verificação.

O backup foi capturado antes do encerramento da API; a comparação encontrou um
heartbeat posterior em `OperatorSession.lastSeenAt`. Todos os outros valores antigos
foram preservados. Aplicação independente da migration em uma cópia descartável
do backup preservou integralmente as 26 tabelas anteriores. `integrity_check=ok`
e nenhuma violação de chave estrangeira, na cópia e no banco local.
Verificação reproduzível: `node scripts/verify-production-settings-migration.mjs <backup>`.
Bancos, backups, builds, `.env`, artifacts e AVD descartável permanecem fora do Git.
`package-lock.json` não mudou.

## Validações

- Lint, typecheck e build aprovados. Permanece o aviso Vite de bundle acima de 500 kB.
- API: 280 testes; Assembly: 34; Forno: 17; Finalização: 14; Despacho: 12.
  Total: **357 testes aprovados**. Foram adicionados seis cenários API e dois de resumo de rota.
- Primeira execução API teve dois timeouts de 5 segundos sob carga simultânea de
  emulador/navegadores/compilação. A execução completa seguinte passou sem alterar
  timeouts ou regras dos testes.
- `test:dispatch:browser`: fluxo completo com 3 pizzas/extras, correções, rota parcial,
  reabertura/move/remove, Delivery/Pickup, concorrência, realtime/offline/restart,
  resposta perdida/replay, redirects e estresse de 30 pizzas/30 pedidos aprovado.
  Os seletores foram adaptados à rota única selecionada; cobertura preservada.
- `test:ux:round2a`: cinco estações, identidade, elegibilidade, abas, disponibilidade,
  snapshots inteira/meio a meio/Broto, recuperação/negação, touch e quatro resoluções aprovado.
- `test:assembly:realtime:browser`: dois tablets, disputa de reserva, autoria,
  ações bloqueadas para outro operador, refresh, offline/restart, troca protegida,
  duas abas e recuperação de sessão inválida aprovado. Seus seletores antigos
  foram atualizados para menu/filtro e label de conexão da Rodada 2A.
- `test:ux:round2b`: medições, contexto físico, preferência entre tablets, persistência
  após refresh/restart, entrada manual e automática, comandos individuais, alertas
  durante edição de rotas e rodapé de saída aprovado em banco descartável.

## Android e pendências

Validação Android **API 36 aprovada** no perfil descartável Round2BTablet, com
display 1280×800/densidade 160 e viewport web medido **1280×648**, nas três telas:
Visão geral, Forno e Finalização e Balcão. Documento e viewport têm a mesma altura,
sem overflow horizontal. PIN/menu/troca de estação e navegação foram exercitados
no Chrome Android real, com capturas `android-overview.png`, `android-production.png`
e `android-counter.png`, além de `android-metrics.json`.
O AVD pessoal Pixel_8 foi preservado; o perfil de telefone foi descartado para esta
medição devido ao recorte de tela. O AVD de teste foi criado nos artifacts ignorados,
encerrado e removido após a validação; capturas e métricas foram preservadas.
A user-agent string reduzida do Chrome informa
“Android 10”; `adb shell getprop ro.build.version.sdk` confirmou a API **36** real.

Mantidos: piloto físico com operadores; endereço estruturado de Delivery;
investigação separada da workstation Atendente; referência genérica de tempo de
forno (não promete tempo por receita); eventual divisão do bundle. A preferência
atual cobre uma estação lógica de produção: múltiplas produções independentes
exigiriam escopo explícito futuro. Nenhum push automático.
