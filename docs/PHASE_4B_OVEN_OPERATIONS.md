# Fase 4B — organização operacional do forno

Fechada no commit `a8534d1` — `feat: add oven capacity and operational timing`. **Fase 4 — Forno: STATUS CONCLUÍDA TECNICAMENTE.** Piloto físico permanece validação operacional pendente. Finalização passa à [Fase 5A](PHASE_5A_FINISHING.md); as seções abaixo descrevem o escopo original de 4B.

## Entrega

Fase 4A revisada e validada antes de alterações, fechada no commit `23a2637` — `feat: add persistent oven workflow`. Lint/typecheck/build, 182 testes da API, 34 da montagem e 16 do forno passaram antes do commit. Bancos, backups, builds e segredos ficaram fora do Git; package-lock.json permaneceu inalterado. Sem push.

4B refina o único forno operacional em `/kitchen/oven`: capacidade opcional, ocupação/vagas, proteção transacional da última vaga, saída prevista como prioridade e identificação de quem colocou a pizza. Não implementa finalização nem múltiplos fornos. A entrega 4B fica local para revisão/commit próprio.

## Configuração mínima

Configuração central por ambiente da API, sem painel administrativo, endpoint de escrita ou migration:

```dotenv
OVEN_DEFAULT_MINUTES=7
OVEN_CAPACITY=
```

Para capacidade conhecida, preencher `OVEN_CAPACITY=6` **somente se 6 for a capacidade confirmada da loja**. É um exemplo de configuração, não capacidade adotada. Vazio/ausente significa sem limite configurado e mantém 4A. Zero, negativos, frações e valores inválidos são rejeitados; a capacidade deve ser inteiro positivo seguro. O tempo deve ser maior que zero e até 240 minutos; aceita frações. Sem tempo específico, usa o padrão configurado (fallback 7 minutos).

Alterar `.env` da API e reiniciar o Kitchen pelos scripts existentes, preservando o banco. Não executar setup/migration apenas para mudar capacidade ou tempo. As variáveis são carregadas no processo: editar arquivo não altera uma API já em execução. O serviço resolve a referência atual em cada comando de entrada, sem alterar histórico. O `.env` da loja não foi modificado nesta execução; só `.env.example` foi atualizado.

`GET /kitchen/oven/config` sem cache retorna:

```json
{
  "defaultOvenMinutes": 7,
  "ovenCapacity": 3,
  "ovenOccupancy": 2,
  "serverTime": "2026-10-06T16:00:00.000Z"
}
```

Ocupação considera **todas as pizzas IN_OVEN no banco**, independentemente do número de pedidos. Meio a meio é uma pizza. Não conta WAITING_OVEN, BAKED ou extras. A leitura de ocupação é indicativa; a decisão de entrada é sempre transacional no servidor.

## Capacidade, concorrência e idempotência

ENTER_OVEN mantém autenticação/presença, estado/versão esperados e UUID do comando. Depois de consultar o recibo idempotente, a mesma transação conta IN_OVEN, verifica capacidade, faz CAS da pizza, grava horário/previsão, histórico, agregação/CAS do pedido e recibo. Se `ocupação >= capacidade`, retorna **409 — Forno cheio. Aguarde uma retirada antes de colocar outra pizza.** Não persiste parcialmente nem emite evento de sucesso.

SQLite garante um único writer e não permite uma escrita concorrente contra snapshot desatualizado. A estratégia de retry existente reinicia a transação inteira e reconta ocupação. Assim, duas pizzas de pedidos distintos disputando a última vaga não podem ambas confirmar entrada. Teste com **dois PrismaClients/conexões** no mesmo SQLite demonstra um commit e um conflito, sem depender exclusivamente de fila de requisições de um único cliente. Não foi usado contador em memória, mutex no frontend ou proteção apenas por pedido.

Receipt é verificado antes de capacidade: repetir um comando confirmado quando cheio retorna replay sem consumir vaga ou duplicar histórico. Conteúdo diferente com o mesmo UUID continua conflitando. Falha em histórico, recibo ou agregação desfaz a entrada e a ocupação; retry do mesmo UUID após rollback pode entrar. REMOVE_FROM_OVEN continua permitido quando cheio e abre vaga ao gravar BAKED.

Reduzir capacidade abaixo da ocupação atual não remove pizzas: exibe, por exemplo, `Forno 3 / 2`, zero vagas e bloqueia novas entradas até liberar espaço. Tempo/configuração não integram o hash da intenção: o replay representa a entrada original, não uma nova entrada com nova previsão.

Essa garantia depende do isolamento SQLite usado atualmente. Se mudar o banco, acrescentar múltiplas instâncias/fornos ou outros caminhos de escrita do estado IN_OVEN, revisar a coordenação transacional e ensaiar concorrência novamente. Futuro banco com isolamento read-committed precisa de lock/serialização por recurso ou equivalente; só count + updates em pizzas distintas não é suficiente nesse isolamento.

## Tempo e prioridade visual

Entrada grava `ovenStartedAt` pelo servidor e `ovenExpectedEndAt = entrada + referência vigente`. Mudar referência não reescreve pizzas já no forno. Não há regra por sabor/categoria/tamanho inventada; ponto de extensão futuro é um resolvedor de tempo explicitamente configurado, com fallback padrão e previsão persistida na entrada.

- WAITING_OVEN: montagem mais antiga primeiro, com tempo `Aguardando MM:SS`.
- IN_OVEN: `ovenExpectedEndAt ASC`, independente da ordem dos pedidos; desempate por entrada, número e posição. Para registro histórico sem previsão, usa entrada como fallback.
- Indicadores: **Assando** até 80% da previsão; **Próxima do tempo** de 80% até previsão; **Tempo atingido** até 60 segundos depois; **Acima do tempo** após isso. Faixas são apenas visuais, sem regra culinária ou retirada automática.

Card destaca pedido/posição, sabor histórico, tamanho, inteira/meio a meio, tempo decorrido, duração e horário previsto, indicador e operador de entrada quando disponível. O operador é lido do evento ENTER_OVEN já persistido, sem sobrescrever o responsável da montagem ou criar história antiga. `production.ovenOperator` é opcional para preservar leituras/recibos anteriores. Exibe o nome cadastral atual; IDs/autoria do evento permanecem auditáveis mesmo se um nome for alterado administrativamente.

Ocupação aparece como `Forno 2 / 3 · 1 vaga` e `Forno cheio` quando aplicável; sem capacidade, informa explicitamente ausência de limite configurado. A UI bloqueia entrada ao observar forno cheio e mantém retirada. Caso outro tablet tome a vaga entre leitura e clique, o servidor retorna 409 e a tela recarrega com a mensagem de capacidade. Configuração/ocupação anteriores são preservadas em falha de conexão; nenhuma ação é liberada sem leitura validada.

## Realtime e reconexão

Entrada/retirada reutilizam eventos pós-commit, deduplicação, versões, GET de reconciliação e fallback de 30 segundos. A consulta de configuração/ocupação acompanha GET de fila, Atualizar e reconexão. Alteração de `.env` requer reinício da API; reconnect recupera configuração nova nos tablets, sem inventar evento administrativo de escrita. Outros tablets veem retirada liberar vaga e entrada preencher ocupação.

Não há atualização otimista cega. Retry após resposta perdida preserva UUID na aba. Presença, PIN, sessão/terminal e autorização continuam os da 4A/Fase 3. Offline ou erro de leitura bloqueia ações; timer continua orientativo pelos timestamps e desvio aproximado do relógio do tablet. Fila do forno permanece compartilhada, sem distribuição ou claim de forno.

## Preparação para múltiplos fornos e finalização

Hoje há um recurso global, com capacidade por configuração e contagem global. Não há ovenId, slots físicos ou dimensão atribuída a Broto/Grande. Para múltiplos fornos: criar entidade Oven/configuração, registrar ovenId na entrada/histórico e eventual snapshot de configuração, migrar dados atuais por regra explícita e escopar contagem/coordenação por ovenId. Não criar um contador global que precise ser repartido nem derivar forno pelo operador/terminal.

BAKED continua sendo o handoff para futura **Fase 5 — Finalização**. GET v2 mantém pedido, snapshots, metades/modificadores/borda, observações e extras estruturados. ovenStartedAt/ovenExpectedEndAt/bakedAt e histórico com autor/terminal/sessão/versão permanecem disponíveis. Pedido só chega FINISHING quando regras agregadas permitirem; retirar do forno não confirma extras, embalagem ou despacho.

## Testes e validação

7 testes novos na API (29 do forno, 189 totais): capacidade ausente, vazio, cheio, fluxo 3/3 com cinco pizzas, último slot global em conexões/pedidos distintos, idempotência, tempo/capacidade alterados preservando previsão, rollback/liberação de vaga e configuração inválida. Teste anterior de entrada também verifica autoria legível. Montagem mantém 34 testes. Forno tem 17 testes, incluindo saída prevista antes da ordem de entrada.

`npm run test:oven:browser` conserva os cenários 4A (três pizzas via balcão/montagem UI, dois tablets, relógio deslocado, refresh/reabertura, resposta perdida, 30 pizzas, rede e API restart) e acrescenta cenário 4B em SQLite/API descartáveis:

1. Limpar ocupação por retiradas confirmadas, configurar capacidade 3 no servidor isolado e reiniciar.
2. Criar pedido com cinco pizzas e finalizar montagem; entrar duas.
3. Dois tablets disputam última vaga com pizzas diferentes: 200/409, três dentro e duas aguardando.
4. Ambos mostram cheio e bloqueiam entrada; retirar uma → 2/3; colocar outra → 3/3; refresh preserva estado/timer.
5. Testar 1024×768 e 1280×800, cards/touch/scroll/ocupação e capturas.
6. Reduzir capacidade 3→2 sem expulsão, alterar referência e manter previsão existente; aumentar para 4 e nova entrada usar novo tempo.

Referências rápidas (6/12/18 segundos) só no servidor de teste, sem mudar configuração ou dados da loja. Não é benchmark definitivo do SQLite. Validações: lint, typecheck, build, suíte API/montagem/forno e navegador. Nenhuma nova migration, alteração de package-lock.json ou dependência.

Arquivos: `.env.example`, contrato compartilhado, oven-config/commands/app/kitchen-data API e oven.integration.test; OvenPage/useOven/oven/oven.css/oven.test no frontend; oven-browser-smoke; README/roadmap e documentos 4A/4B.

## Fechamento operacional e próximo ciclo

Escopo técnico 4B pronto após validações. Fechamento **na operação da loja** depende de piloto físico, capacidade confirmada, tempo padrão escolhido pela operação e rede/tablets reais. Os testes emulados não substituem esse aceite. A Fase 3 permanece concluída; piloto não é bloqueio técnico para planejar Fase 5.

Próximo: revisar/commitar 4B e realizar piloto montagem → forno com capacidade/tempo confirmados. Antes de implementar Fase 5, definir conferência por pizza, extras/bebidas/complementos, embalagem, retirada/despacho, autoria e regras de agregação; reutilizar BAKED, snapshots, transações/CAS/idempotência/realtime. Não foram iniciadas Finalização, múltiplos fornos, sensores, controle físico, dashboard, impressão ou estoque.
