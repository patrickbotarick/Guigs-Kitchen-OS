# Guig's Kitchen — Balcão, montagem, forno, finalização e despacho

Referência visual oficial: `/kitchen/assembly`. Forno, Finalização, Despacho e Balcão seguem os [padrões de UI](docs/UI_VISUAL_STANDARDIZATION.md); `npm run test:ui:browser` valida as telas em tablets com dados isolados. Esta padronização visual não inicia a Fase 6 funcional.

**Fase 5 — Finalização e Despacho: STATUS CONCLUÍDA TECNICAMENTE.** Finalização persistente, conferência de pizzas/extras, embalagem e correções auditáveis até WAITING_DISPATCH; Despacho manual de Delivery até DELIVERED e Retirada/Balcão (PICKUP) até PICKED_UP. Realtime, idempotência, concorrência, timestamps e histórico implementados. Fluxo principal v2 tecnicamente completo, com v1 preservado. Piloto físico é validação operacional pendente; endereço estruturado de Delivery permanece pendência conhecida. Balcão é canal de entrada. [Fechamento, contrato e validações](docs/PHASE_5B2_DISPATCH.md). Fase 6 não iniciada.

**Fase 4 — Forno: STATUS CONCLUÍDA TECNICAMENTE.** 4B fechada no commit `a8534d1`; piloto físico permanece validação operacional pendente.

**Fase 5A — Finalização:** `/kitchen/finishing` organiza pedidos parciais/completos, pizzas BAKED → FINISHING → FINISHED, extras por unidade, embalagem e liberação explícita para WAITING_DISPATCH. Usa PIN, heartbeat, CAS, idempotência e realtime existentes, sem despacho/entrega. [Contrato, migration, testes e limites](docs/PHASE_5A_FINISHING.md).

**Fase 3 — fluxo de montagem persistente, multioperador e realtime: STATUS CONCLUÍDA.** Fechamento da 3D.2D no commit `5f76de4`. Piloto físico permanece como validação operacional pendente e não bloqueia tecnicamente o início da Fase 4A — forno.

**Fase 4A — forno operacional:** `/kitchen/oven` exibe a fila compartilhada WAITING_OVEN e pizzas IN_OVEN, com comandos persistentes ENTER_OVEN/REMOVE_FROM_OVEN, autoria, CAS, idempotência e realtime. Usa o mesmo PIN/terminal/heartbeat da montagem. Timer por timestamps do servidor, referência temporária configurável por `OVEN_DEFAULT_MINUTES` (default 7 minutos), sem retirada automática. BAKED prepara o handoff para a Finalização, implementada na Fase 5. [Contrato, configuração, testes e limites](docs/PHASE_4A_OVEN.md).

**Fase 4B — operação do forno:** 4A fechada em `23a2637`. `OVEN_CAPACITY` opcional controla quantidade de pizzas IN_OVEN, com validação transacional da última vaga, ocupação/vagas na tela e mensagem Forno cheio. Vazio mantém entradas sem limite configurado. Referência de tempo permanece genérica; pizzas no forno são ordenadas pela previsão de saída e mostram operador de entrada. Alterar `.env` e reiniciar API reflete configuração nos tablets; não modifica previsões já salvas. Sem migration. [Configuração, concorrência e testes](docs/PHASE_4B_OVEN_OPERATIONS.md). Finalização e Despacho foram implementados na Fase 5.

Protótipo local da operação da cozinha: criar pedidos fictícios, persistir em SQLite, avançar por estados validados e acompanhar o histórico em tempo real. O escopo e as fases futuras estão em [BASE_DO_PROJETO.md](BASE_DO_PROJETO.md).

A **Fila de Montagem** é um módulo para tablets dentro deste frontend: lê pedidos v2 persistidos, executa comandos autenticados por PIN e sincroniza por realtime. Inclui responsabilidade por pizza e distribui novas pizzas pela menor carga dos operadores disponíveis, com sorteio em empate. A Fase 3D.2D exige presença recente por heartbeat e acrescenta encerramento de turno e recuperação auditada por supervisor. Abre em Minhas pizzas; Fila geral e Disponíveis continuam acessíveis. O simulador local permanece separado em modo DEV. [Responsabilidade](docs/PHASE_3D2B_PIZZA_RESPONSIBILITY.md), [distribuição](docs/PHASE_3D2C_AUTO_ASSIGNMENT.md) e [presença/recuperação](docs/PHASE_3D2D_PRESENCE_RECOVERY.md).

## Requisitos

- Windows com Node.js 20.19+ e npm instalados.
- Portas 5173 (painel) e 3333 (API) livres.

## Iniciar

No Windows, execute `start.bat` por duplo clique ou `./start.ps1` no PowerShell. O inicializador verifica as portas antes de alterar o banco. Se o Kitchen já estiver rodando, informa os endereços e pede para encerrar a instância anterior antes de atualizar; se outra aplicação ocupar uma porta, informa o processo sem encerrá-lo. Na primeira execução ou após mudanças nas dependências/schema/migrations, cria `.env`, instala dependências se necessário e executa `npm run setup` (Prisma Client, migrations e seed). Nas aberturas seguintes, inicia API e frontend sem executar `prisma generate` novamente. `Ctrl+C` encerra os serviços; os logs ficam no terminal.

Com ambiente preparado, também é possível executar `npm run dev`. Na primeira instalação manual, rode `npm install` e `npm run setup` antes. Execute `npm run setup` novamente após alterações no schema ou migrations, com API e frontend parados.

## URLs

| Página / serviço | Endereço |
| --- | --- |
| Painel | http://localhost:5173/ |
| Novo pedido | http://localhost:5173/orders/new |
| Cozinha | http://localhost:5173/kitchen |
| Fila de Montagem (persistida, identificação por PIN) | http://localhost:5173/kitchen/assembly |
| Forno (fila compartilhada, identificação por PIN) | http://localhost:5173/kitchen/oven |
| Finalização (por pedido, identificação por PIN) | http://localhost:5173/kitchen/finishing |
| Simulador da montagem (somente desenvolvimento) | http://localhost:5173/kitchen/assembly/dev |
| Saúde da API | http://localhost:3333/health |
| Pedidos ativos | `GET http://localhost:3333/orders` |
| Criar pedido | `POST http://localhost:3333/orders` |
| Pedido por ID | `GET http://localhost:3333/orders/:id` |
| Avançar estado | `POST http://localhost:3333/orders/:id/transition` |
| Histórico | `GET http://localhost:3333/orders/:id/history` |

`GET /orders` retorna os pedidos ativos da Fase 2A em ordem de chegada. `POST /orders/:id/transition` recebe, por exemplo, `{ "expectedStatus": "WAITING_PRODUCTION", "toStatus": "IN_PRODUCTION" }`. O servidor só permite `WAITING_PRODUCTION → IN_PRODUCTION → OVEN → FINISHING → WAITING_DISPATCH`; salto, repetição ou estado esperado desatualizado retorna HTTP 409. Criação e transições emitem `order.created` e `order.updated` via Socket.IO, respectivamente. A interface também lê a API ao abrir/reconectar e periodicamente.

## Teste rápido

1. Inicie com `start.bat` e abra `/kitchen`.
2. Em outra aba, abra `/orders/new`, informe cliente e tipo, e adicione uma ou mais pizzas com modificadores.
3. Crie o pedido e observe o número de confirmação.
4. Confira se apareceu em `/kitchen` sem atualizar a página.
5. Use o botão do card para iniciar produção e confira o novo estado sem F5.
6. Abra `/kitchen` em outra aba, avance para o forno e confirme que ambas atualizam.
7. Abra **Ver histórico** e confira criação e transições.
8. Tente `WAITING_PRODUCTION → DELIVERED` pela API; a resposta deve ser HTTP 409.
9. Pare e reinicie o sistema; status e histórico devem permanecer.

## Banco e seed

O arquivo SQLite fica em `apps/api/prisma/dev.db` e é ignorado pelo Git. As migrations reais ficam em `apps/api/prisma/migrations`. A migration da Fase 2A cria `OrderStatusHistory`, adiciona `productionFinishedAt` e registra o evento inicial dos pedidos existentes. Cada nova criação e transição grava histórico na mesma transação do pedido. O seed registra os montadores Rafael, Lucas e João; os sabores Calabresa, Portuguesa, Mussarela e Frango com Catupiry; e os tamanhos Pequena, Média e Grande. O seed usa `upsert`, portanto pode ser repetido sem duplicar dados. Não cria pedidos por padrão.

Para recriar o ambiente de desenvolvimento do zero, pare o servidor, apague manualmente `apps/api/prisma/dev.db` e execute `npm run setup`. Isso remove todos os pedidos locais; o inicializador normal jamais apaga o banco.

## Estrutura

- `apps/web`: React, Vite, páginas existentes de acompanhamento/cadastro e módulo de montagem.
- `apps/web/src/features/kitchen`: módulo isolado da montagem, com componentes, regras, estado e mocks locais.
- `apps/api`: Express, Socket.IO, serviço de pedidos, Prisma e seed.
- `packages/shared`: contrato dos pedidos e validação Zod compartilhados.
- `apps/api/prisma`: schema, migrations e banco local.
- `Logo_Guigs.png`: asset oficial fornecido; a cópia servida pelo frontend está em `apps/web/public/logo-guigs.png`.

## Tablet, celular e Android Emulator

Na mesma rede, acesse `http://IP-DO-WINDOWS:5173` no tablet ou celular. No Android Emulator, use `http://10.0.2.2:5173` para alcançar o host Windows. A interface usa automaticamente o mesmo host na porta 3333 para a API. Permita as portas 5173 e 3333 no firewall do Windows quando necessário. Em outros emuladores, o endereço do host pode variar. Para API em outro host, defina `VITE_API_URL` em `.env` e reinicie o Vite.

O projeto inclui um manifest web básico e layout responsivo, mas instalação offline/PWA completa será tratada em etapa posterior.

## Qualidade e problemas comuns

Execute `npm run lint`, `npm run typecheck`, `npm test`, `npm run smoke` (com o servidor ativo), `npm run test:browser` (com Edge ou Chrome instalado e servidor ativo) e `npm run build` para validar o projeto. Se o painel indicar API indisponível, confira logs, porta 3333 e firewall. Se o realtime estiver reconectando, confira a conexão Socket.IO. Se `prisma generate` apresentar EPERM no Windows, encerre a instância anterior do Kitchen com `Ctrl+C`, confirme que as portas 3333/5173 estão livres e execute `npm run setup`; o inicializador não encerra outros processos Node automaticamente.

## Fila de Montagem — protótipo do tablet

Abra `/kitchen/assembly`, também acessível pelo link **Montagem** na navegação existente. Para validar apenas este módulo, sem iniciar a API ou preparar o banco:

```powershell
npm run dev -w @guigs/web
```

Para iniciar o projeto completo, continue usando `npm run dev` (ambiente preparado) ou `./start.ps1`. O módulo não precisa de migrations, seed nem novas dependências.

### Roteiro de validação

1. Abra `http://localhost:5173/kitchen/assembly`. A fila começa com os pedidos #1001–#1005. O #1001 já demonstra: Calabresa grande com borda de requeijão, sem cebola e com bacon; Calabresa/Portuguesa grande meio a meio com borda de cheddar; Broto de Mussarela. Há três extras apenas no contador.
2. Selecione um pedido e uma pizza. Confira os ingredientes normais (check verde), removidos (X vermelho), adicionais (+ roxo) e observações. Na pizza meio a meio, use os botões de 1ª/2ª metade para alternar a ficha técnica. Essa seleção não altera o estado de montagem.
3. Clique em **Iniciar montagem**, **Pausar** e **Retomar**. Durante a pausa, o envio ao forno fica bloqueado. Alternar pedidos preserva o progresso e a pizza selecionada de cada um.
4. Clique em **Enviar pro forno**. Isso conclui **a montagem** daquela pizza: o card fica verde e o contador aumenta. Não significa que ela já assou.
5. Repita nas demais pizzas. A timeline continua em **Montagem** enquanto qualquer pizza não tiver sido enviada. Todas aguardando forno: timeline em **Fila do forno** e botão **Concluir montagem** habilitado.
6. Clique em **Concluir montagem**. O pedido sai da fila, o próximo na ordenação atual é selecionado e um evento local `assembly.completed` guarda o pedido com o contador de extras e suas pizzas em `WAITING_OVEN` e estágio agregado `OVEN` (fila do forno), com destino ao forno; não registra cozimento nem finalização.
7. No servidor de desenvolvimento, use o pequeno link **Dev** no rodapé da fila para acessar o Simulator 2.0 na mesma aba. Escolha cliente, canal (iFood, WhatsApp, Retirada ou Balcão), 1–30 pizzas e 0–30 extras. Cada pizza tem tamanho, composição, sabores, borda e observação; em cada sabor, desmarque ingredientes para remover e selecione adicionais do catálogo. Broto permite apenas inteira; Grande permite inteira ou meio a meio, com alterações independentes por metade. Clique em **Simular chegada de novo pedido** e depois **Abrir montagem**. A chegada respeita a ordenação por horário sem trocar o pedido em trabalho.
8. Teste 6 ou 30 pizzas e vários pedidos para verificar os scrolls independentes. As ações inferiores continuam acessíveis em 1024×768 e 1280×800. Ao concluir toda a fila, aparece o estado vazio; uma nova chegada volta a selecionar um pedido.

O botão com o SVG **sort**, junto ao título da fila, alterna **Mais antigo primeiro / Mais recente primeiro** usando `receivedAt`. O padrão é mais antigo primeiro e a seleção é preservada ao ordenar.

Os extras aparecem somente como contagem na fila e no cabeçalho, sem lista na área central. A liberação do pedido depende apenas das pizzas. Nenhuma interface simula forno/finalização como já realizados: essas etapas posteriores não foram implementadas.

### Catálogo oficial

O catálogo contém **60 sabores** (21 tradicionais, 20 especiais, 9 premium, 10 doces), **50 ingredientes normalizados**, **12 adicionais** e **5 bordas recheadas**, mais a opção tradicional/sem recheio solicitada. Favoritas referencia cinco sabores existentes. Receitas, tamanhos e preços foram conferidos nas quatro páginas do PDF; nenhum ingrediente é acrescentado por convenção culinária. Calabresa não contém mussarela. Preços ficam somente no catálogo, sem exibição na cozinha ou no simulador.

Veja [CATALOG.md](apps/web/src/features/kitchen/CATALOG.md) para origem, estrutura, exceções explicitamente solicitadas e os pontos `needs_review`. A pizza guarda IDs de sabores/ingredientes, tamanho, borda, modificadores e observação; a UI resolve a ficha técnica a partir do catálogo. Meio a meio é uma pizza única, com duas referências de sabor e um único estado.

### Limites dos mocks

- Pedidos, modificadores, ações e transferências são demonstrativos e vivem no estado React da aba. As receitas são as do PDF oficial, em catálogo estático separado. Não há chamada à API nem escrita em SQLite, localStorage ou banco de produção.
- O estado é mantido ao navegar entre montagem e simulador pelos links da aplicação. Recarregar, digitar outra URL diretamente ou sair do módulo reinicia a demonstração. Abas distintas possuem simulações independentes.
- A página e o link **Dev** só existem no servidor de desenvolvimento (`import.meta.env.DEV`). O build mantém a tela de montagem como demonstração, identificada no rodapé, sem o simulador.
- Todas as pizzas começam aguardando; seleção e início de montagem são ações distintas. A fonte segue a pilha existente `Inter, system-ui, Segoe UI`, sem dependência de download externo.

### Arquivos e arquitetura do módulo

| Arquivo novo em `apps/web/src/features/kitchen/` | Responsabilidade |
| --- | --- |
| `types.ts` | Projeções de produção derivadas dos contratos existentes; pizza inteira/meio a meio, metades, modificadores, canal, contador de extras e transferência |
| `catalog.ts` | Catálogo oficial, ingredientes, bordas, adicionais, Favoritas, preços, origem e pontos de revisão |
| `pizzaRecipe.ts` | Resolução de ingredientes e validação de tamanho/composição/borda/modificadores |
| `CATALOG.md` | Proveniência, regras de fonte de verdade e revisão manual |
| `mockOrders.ts` | Pedidos de demonstração por referência ao catálogo e validação do simulador |
| `assembly.ts` | Transições por pizza, progresso agregado, ordenação, bloqueios e reducer puro |
| `useAssembly.tsx` | Contexto React restrito às duas rotas, sem biblioteca de estado global |
| `assembly.css` | CSS com prefixo `ka-`, cores da marca e layout de tablet sem alterar estilos do balcão |
| `pages/KitchenAssemblyPage.tsx` | Composição da tela e seleção |
| `pages/KitchenSimulatorPage.tsx` | Formulário de chegada e registro das transferências locais |
| `components/OrderQueue.tsx` | Fila compacta/expandida, canais, quantidades e tempo de espera |
| `components/CurrentOrder.tsx` | Cabeçalho, cards de pizza, timeline e conclusão; sem lista de extras |
| `components/PizzaDetail.tsx` | Seletor de metade, ingredientes, modificadores, observações e ações por pizza |
| `components/PizzaBuilder.tsx` | Configuração individual de tamanho, composição, borda, sabores e modificadores no simulador |
| `components/AssemblyIcons.tsx` | Reutilização dos SVGs oficiais de `src/assets/kitchen/icons`, sem nova dependência |
| `assembly.test.ts` | 16 testes de catálogo, composição, modificadores, ordenação e montagem, incluindo limites de 1/30 pizzas e trocas repetidas |

Também foi criado `scripts/assembly-browser-smoke.mjs`. Arquivos existentes alterados: `apps/web/src/main.tsx` (rotas e link de acesso), `package.json` (comandos de teste) e este `README.md`. Nenhuma alteração em `Dashboard.tsx`, `NewOrder.tsx`, `Kitchen.tsx`, API, tipos compartilhados ou schema Prisma.

### Testes da montagem

```powershell
npm run test:assembly
# Com o Vite ativo e Edge ou Chrome instalado:
npm run test:assembly:browser
```

O primeiro comando cobre catálogo e regras do fluxo. O segundo cria os três cenários manualmente no Simulator 2.0, verifica seleção de metades, modificadores, bordas, bloqueio de Broto meio a meio, ordenação ASC/DESC, SVGs oficiais, ausência de preços/lista de extras, fila vazia, ausência de requisições à API, rotas existentes e overflow em 1024×768, 1280×800 e 1152×645. Salva capturas em `%TEMP%/guigs-assembly-validation`; `ASSEMBLY_SCREENSHOT_DIR` permite mudar o destino. `BROWSER_PATH` e `ASSEMBLY_ORIGIN` permitem configurar navegador e origem. As páginas antigas são verificadas com leituras de API simuladas; os testes existentes da API continuam em `npm test`.

### Próxima integração

1. Evoluir os contratos compartilhados e Prisma para canal de origem, extras, receitas estruturadas e pausa por item. Hoje o contrato existente tem ingredientes em texto e não representa esses dados integralmente.
2. Implementar transições individuais na API com estado esperado, timestamps, histórico e controle de concorrência. A API atual avança o pedido inteiro; não deve ser reutilizada como se já controlasse cada pizza.
3. Calcular o estágio agregado no servidor e publicar alterações de itens/pedidos por Socket.IO. Substituir o estado mock por um adaptador de leitura/comandos da API, mantendo os componentes de apresentação.
4. Receber os pedidos reais do balcão e persistir a transferência `assembly.completed` de forma atômica e idempotente. Após o forno, encaminhar para a futura finalização, que separará extras e devolverá o progresso ao balcão.

## Fase 2C — preparação da integração

O protótipo distingue `WAITING_ASSEMBLY`, `ASSEMBLING` e `WAITING_OVEN`, com pausa local durante montagem. **Concluir montagem** encerra apenas o trabalho do montador. O contrato alvo, a máquina persistente proposta, a agregação, a concorrência e o plano de migração aditiva estão em [docs/KITCHEN_DATA_MIGRATION.md](docs/KITCHEN_DATA_MIGRATION.md). API, Prisma e balcão permanecem no contrato legado nesta fase.

## Fase 3A — domínio compartilhado e persistência aditiva

`packages/shared` agora contém contratos v1 preservados e contratos estruturados v2 com validação de Broto/Grande, metades, modificadores, borda, extras, snapshot histórico, estado/timestamps por pizza, transições e agregação. O módulo de montagem reutiliza tipos/regras compartilhados, mas continua em memória.

O Prisma acrescenta `Order.schemaVersion` (default 1) e tabelas `PizzaItem`, `PizzaHalf`, `PizzaIngredientModifier`, `ExtraItem` e `PizzaProductionHistory`. A migration `20261005180000_structured_kitchen` é aditiva, sem conversão de pedidos antigos. Preparar com API parada: `npm run setup` (gera client/aplica migrations/seed idempotente). Faça backup SQLite consistente antes de atualizar um banco que contém dados da loja; o backup local da execução está em `apps/api/prisma/backup-phase3a-before-20261005T174023Z.db`, ignorado pelo Git.

Os endpoints existentes continuam usando v1. Na entrega 3A, a leitura compatível foi preparada em `apps/api/src/kitchen-data.ts`; a criação HTTP v2 foi acrescentada na Fase 3B abaixo. Pedidos v2 não são expostos pelas rotas legacy nem avançados pela transição do pedido inteiro. O contrato e as tabelas novos não significam forno, finalização, locks ou realtime por pizza implementados.

`npm test` inclui testes novos de domínio, snapshot, agregação, migração preservando legado e round-trip Prisma. Estratégia de snapshot, constraints, convivência/rollback e limites estão na seção 10 de [KITCHEN_DATA_MIGRATION.md](docs/KITCHEN_DATA_MIGRATION.md).

## Fase 3B — entrada estruturada persistente

`/orders/new` cria pedidos v2 por `POST /orders/v2`, com pizzas/metades/modificadores/borda por ID do catálogo compartilhado, extras estruturados, snapshots gerados no servidor, estados e históricos iniciais. Contador e gravações são transacionais; `clientRequestId` protege reenvios/duplo clique. O formulário preserva envios incertos na sessão da aba, inclusive após refresh. O formulário v1 continua em `/orders/new/legacy`.

Leitura v2 explícita: `GET /orders/v2` e `GET /orders/v2/:id`. A montagem continua em demonstração e a fila/painel legacy mostra apenas v1. Extras possuem lista inicial interna a confirmar com a operação. API parada + backup antes de `npm run db:generate` e `npm run db:migrate`; nova migration adiciona somente idempotência. Detalhes, payload, arquivos, limites e sequência da Fase 3C: [PHASE_3B_STRUCTURED_CREATION.md](docs/PHASE_3B_STRUCTURED_CREATION.md).

Validação: lint, typecheck, 55 testes da API, 16 da montagem, build e navegador da montagem. `npm run test:structured:browser` verifica v2/replay após perda de resposta/refresh e o fluxo v1 com duas abas, usando API compilada e banco descartável. Requer Vite em 5173 e porta 3333 livre; não roda contra o banco da loja.

## Fase 3C.1 — Assembly lê pedidos persistidos

`/kitchen/assembly` carrega `GET /orders/v2`, filtrando pedidos WAITING_PRODUCTION/IN_PRODUCTION com montagem pendente. Exibe receitas históricas pelos snapshots, estados por pizza, observações e contador de extras. Polling a cada 30 segundos após terminar a consulta, timeout de 10 segundos, atualização manual e preservação dos dados em erro. Pedidos v1 são ignorados explicitamente, sem conversão.

A fila real é somente leitura: ações de montagem/conclusão desabilitadas. Demonstração separada em DEV por `/kitchen/assembly?source=demo`; simulador em `/kitchen/assembly/dev`, sem mistura automática com dados reais. Formulário v2 oferece Abrir montagem após salvar.

`npm run test:assembly`: 27 testes. `npm run test:assembly:persisted:browser`: balcão → SQLite → API → Assembly usando API compilada/banco descartável na porta 3347, sem alterar o banco da loja. Detalhes, arquivos e limites: [PHASE_3C1_ASSEMBLY_READ.md](docs/PHASE_3C1_ASSEMBLY_READ.md). Fase 3B fechada no commit local `c5ffbc8`; comandos persistentes ficam para a 3C.2.

## Fase 3C.2 — comandos persistentes de montagem

Fase 3C.1 fechada no commit local `eab3060`. Pedidos reais agora permitem Iniciar, Pausar, Retomar e Enviar pro forno por `POST /orders/v2/:orderId/pizzas/:pizzaId/commands`, com estado/versão esperados e clientCommandId. A transação inclui pizza, timestamps, histórico, agregação/versionamento do pedido e recibo idempotente. Não há atualização otimista cega; conflito 409 recarrega o pedido e envio incerto permite repetir o mesmo comando, inclusive após refresh na mesma aba.

Enviar ao forno grava WAITING_OVEN e conclusão da montagem; não inicia forno nem timer. O pedido sai da fila quando todas as montagens terminam. DEV continua local e separado. Migration aditiva de recibos, backup antes de aplicar e nenhuma escrita de teste no banco da loja.

Validação: 71 testes API, 28 montagem, lint/typecheck/build e navegadores. `npm run test:assembly:commands:browser` valida balcão → comandos → SQLite, refresh, resposta perdida/replay e conflito entre dois tablets com API compilada/banco descartável em 3348. Detalhes/arquivos/limites: [PHASE_3C2_ASSEMBLY_COMMANDS.md](docs/PHASE_3C2_ASSEMBLY_COMMANDS.md). Socket.IO por pizza, locks, identidade de montador, forno e finalização ficaram fora do escopo original da 3C.2.

## Fase 3D.1 — realtime entre dispositivos

Fase 3C.2 fechada no commit local `b1892a4`. Assembly recebe `kitchen.pizza.updated` e `kitchen.order.updated` versionados, emitidos somente após commit; novos pedidos reutilizam `order.created`. Notificações levam a GET v2 com reconciliação por versão, deduplicação e proteção contra respostas antigas. Connect/reconnect ressincroniza explicitamente; fallback passa a 120 segundos e indicador discreto mostra Online/Reconectando/Offline. Concorrência, idempotência, 409 e DEV separado permanecem.

`npm run test:assembly:realtime:browser` usa API 3349/Vite 5180/SQLite descartáveis e dois clientes reais para balcão → fila, comandos alternados, evento perdido/reconexão e reinício da API. 73 testes API e 34 montagem no fechamento da fase. Operador/claim/lock e forno/finalização ficaram fora do escopo original. Contratos, arquivos, testes e limites em [PHASE_3D1_REALTIME.md](docs/PHASE_3D1_REALTIME.md).

## Fase 3D.2A — identidade operacional

Fase 3D.1 fechada no commit local `10b1cf6`. Assembly real exige PIN numérico (hash salted scrypt) e sessão operacional validada pelo servidor. UUID persistente identifica o perfil do tablet; operador e terminal aparecem discretamente na fila. Trocar montador encerra a sessão e volta ao PIN, com aviso se houver pizzas em montagem. Comandos auditam operador/terminal/sessão e preservam concorrência, idempotência e realtime. DEMO continua separado.

Migration aditiva cria Operator/Workstation/OperatorSession e vínculos históricos, sem reescrever autoria anterior. **Antes do primeiro uso real, cadastre os montadores com `npm run operator:configure`**, que pede PIN mascarado. Não existem operadores/PINs padrão na loja. `npm run workstation:configure` permite nomear terminal após primeiro login válido. Sessão padrão 12 horas (`OPERATOR_SESSION_HOURS`).

O teste realtime também valida dois montadores, PIN touch, refresh, troca e autoria preservada. Modelo, configuração, segurança, base de métricas e roadmap sem distribuição automática em [PHASE_3D2A_OPERATOR_IDENTITY.md](docs/PHASE_3D2A_OPERATOR_IDENTITY.md).

## Fase 3D.2D — presença e recuperação supervisionada

3D.2C fechada no commit `e894040`. Assembly real envia heartbeat autenticado a cada 20 segundos; STALE após 60 segundos já impede novas atribuições e OFFLINE após 120 segundos. Limites configuráveis no backend. Fechar aba/perder rede não libera pizzas existentes. Encerrar turno bloqueia com pendências e, sem elas, registra fim da sessão e volta ao PIN.

Supervisor configurado administrativamente com `npm run operator:configure -- --supervisor` acessa `/kitchen/assembly/recovery`: pausa explícita, liberação ou reassign com motivo, CAS, idempotência e auditoria. Novo responsável deve estar disponível e online; montagem ativa exige pausa antes de recuperar. Não existe supervisor/PIN padrão na loja. Os comandos `--assembler` removem o papel; sem flag, papel existente é preservado. Banco recebeu migration aditiva com backup e verificação de preservação/integridade.

`npm run test:assembly:presence:browser` valida três tablets com perda de rede/aba, exclusão da distribuição, reservas preservadas, recuperação pela UI, histórico/realtime, retorno e API reiniciada, além de encerramento livre/bloqueado. Detalhes, limites, testes e piloto físico em [PHASE_3D2D_PRESENCE_RECOVERY.md](docs/PHASE_3D2D_PRESENCE_RECOVERY.md). Forno operacional foi acrescentado na Fase 4A abaixo; finalização permanece futura.

## Fase 4A — módulo operacional de forno

Rota `/kitchen/oven`, fila compartilhada por pizza, ordenação pela montagem mais antiga, área IN_OVEN e indicadores orientativos de tempo. ENTER_OVEN grava entrada/previsão, REMOVE_FROM_OVEN grava BAKED, mantendo histórico, agregação e recibo na mesma transação. Operador do forno exige presença válida; a autoria original da montagem é preservada. Quem atuar exclusivamente no forno pode suspender o recebimento de novas pizzas de montagem pela própria tela.

`npm run test:oven` valida fila/timer/reconciliação. `npm run test:oven:browser` inicia Vite 5183/API 3352/SQLite descartáveis, sem usar banco da loja: balcão → montagem → forno, dois tablets, Broto/meio a meio, refresh/reabertura, relógio deslocado, resposta perdida/replay, 30 pizzas, disputa 200/409, rede e reinício da API. Lint/typecheck/build, 182 testes API, 34 montagem e 16 forno. Não há nova migration ou alteração do lockfile. [Documentação da 4A](docs/PHASE_4A_OVEN.md).

## Fase 5B.1 — correções da Finalização

5A fechada em `e05d45e` e 5B.1 em `f5ea546`. Corrigir pizza, reduzir extras conferidos e desfazer embalagem exige confirmação simples, preserva autoria/histórico e aceita motivo opcional. Correção de item invalida embalagem automaticamente na mesma transação, com CAS/idempotência/realtime. WAITING_DISPATCH é o fechamento e rejeita novas correções normais. Sem nova migration. [Regras, testes e limites](docs/PHASE_5B1_FINISHING_CORRECTIONS.md). Despacho foi entregue na 5B.2; piloto físico permanece pendente.

## Fase 5B.2 — Despacho e conclusão operacional

Rota `/kitchen/dispatch`, fila por pedido com filtros Delivery e Retirada/Balcão, liberação mais antiga primeiro e próximos comandos explícitos. DELIVERED/PICKED_UP gravam completedAt e encerram o pedido. Novos timestamps e recibos têm migration aditiva, backup e comparação dos valores anteriores. Reutiliza PIN/presença, CAS, idempotência e realtime. v1 preservado, sem conversão automática. `npm run test:dispatch` e `npm run test:dispatch:browser` validam regras e ponta a ponta em dois tablets, incluindo 30 pedidos. [Contrato e limites](docs/PHASE_5B2_DISPATCH.md). Fechamento técnico da Fase 5 registrado nesta entrega; piloto físico pendente. Nenhuma integração externa ou Fase 6 iniciada.
