# Fase 3C.1 — leitura persistida do Assembly

## Git e escopo

Fase 3B fechada no commit local `c5ffbc8` — `feat: add structured v2 order creation`. Antes do commit foram revisados código, migration e arquivos incluídos; passaram lint, typecheck, 55 testes da API, 16 testes da montagem e build. Nenhum banco, backup, `.env` ou segredo foi incluído. `package-lock.json` foi preservado fora do commit: somente metadados ambientais `peer`/`libc`, sem mudança de dependências/versões. Não houve push.

Esta entrega é somente banco → API → Assembly. Não modifica Prisma, migrations, API de comandos ou histórico operacional. Não implementa iniciar/pausar/retomar/enviar ao forno/concluir persistentes, locks, atribuição de montador, Socket.IO por pizza, forno, finalização ou estoque.

## Fonte normal e acesso

`/kitchen/assembly` passa a usar a API em desenvolvimento e produção. `features/kitchen/api.ts` centraliza fetch, validação do contrato compartilhado e projeção para leitura. `usePersistentAssembly.ts` gerencia carga inicial, erro, atualização e cancelamento. Componentes de apresentação não fazem fetch.

- `GET /orders/v2`: fonte completa da fila; já traz pizzas, extras, snapshots e estados individuais.
- `GET /orders/v2/:id`: método `load` da mesma camada, disponível e testado para leitura individual. A seleção normal usa os dados completos da lista, evitando uma segunda consulta redundante.

A atualização ocorre 30 segundos após a conclusão da consulta anterior, sem requisições sobrepostas. Timeout de 10 segundos. Botão Atualizar permite refetch manual. Ao sair da rota ou substituir uma consulta, o AbortController cancela a anterior; respostas antigas não substituem o estado atual. Não é usado Socket.IO nesta fase.

## Filtro da fila e leitura

Inclui apenas pedidos v2 com status WAITING_PRODUCTION/IN_PRODUCTION e ao menos uma pizza WAITING_ASSEMBLY, ASSEMBLING ou ASSEMBLY_PAUSED. Exclui pedidos já fora da montagem ou sem trabalho de montagem pendente. Em pedidos mistos, mantém todas as pizzas desse pedido e mostra seus estados reais, inclusive WAITING_OVEN, IN_OVEN, BAKED, FINISHING, FINISHED e CANCELLED. Enviar para forno continua significando montagem encerrada, sem confundir com pizza assada.

Mantém ordenação antigo/recente, cliente, canal e tempo desde recebimento. Pizzas respeitam sua posição persistida. Extras são contador de **unidades** não canceladas; não são convertidos em pizzas nem tratados pela montagem. Observação geral aparece na área rolável do pedido; observação individual vem do snapshot, com fallback apenas para o campo persistido de snapshots antigos sem notes.

A seleção por IDs é preservada no refetch enquanto pedido/pizza existirem. Se forem removidos da resposta, escolhe um item válido; fila vazia limpa a seleção. Mudanças de ordenação não apagam a seleção.

## Snapshots

Contratos são validados com `readOrderData`, sem duplicar DTOs. Para v2, a projeção preserva o snapshot. `pizzaName`, `halfName`, `crustLabel` e `pizzaIngredients` usam nomes e fichas do snapshot quando presente. O catálogo atual só resolve receitas da demonstração local, sem snapshot. Tamanho, composição e IDs da receita são validados contra o snapshot pelo contrato compartilhado.

Meio a meio mantém 1ª/2ª metade com ingredientes e modificadores históricos independentes. Nomes de sabores, bordas e ingredientes podem diferir do catálogo atual ou pertencer a IDs já retirados dele; isso não impede exibição. A tela não mostra preços.

Pedidos v1 são explicitamente ignorados pelo adaptador; nunca são convertidos de texto livre. A rota consultada é v2, sem fetch ao endpoint legacy. Pedidos v1 continuam no balcão/fila legacy e em seus endpoints anteriores.

## Loading, erro e ações

- Carga inicial: Carregando pedidos...
- Fila vazia: Nenhum pedido aguardando montagem.
- Falha inicial: API indisponível e mensagem visível com botão Atualizar.
- Falha depois de carregar: mensagem visível e dados/seleção anteriores preservados. Não há fallback automático para mocks.

Pedidos reais exibem o indicador Persistidos · somente leitura. Ações de montagem e conclusão estão desabilitadas; o dispatch persistido aceita somente seleção e ordenação. Portanto nenhuma interação operacional local simula uma mudança real. Estados avançados são apenas lidos, sem implementar tela/fluxo de forno ou finalização.

## Simulador isolado

Mocks permanecem para testes e desenvolvimento. Em DEV, `/kitchen/assembly?source=demo` abre uma fila separada, identificada DEV · Simulador local. `/kitchen/assembly/dev` continua com o simulador; seus links retornam à fila demo explicitamente. Trocar para Pedidos persistidos cria outro provider, sem juntar filas. Em build de produção, `source=demo` não habilita mocks e o simulador não tem rota.

O formulário `/orders/new` agora oferece Abrir montagem após salvar, substituindo a mensagem antiga que dizia que a tela ainda usava somente demonstração.

## Testes e evidência integrada

11 testes novos em `assembly-read.test.ts`: lista e leitura individual v2, Broto inteiro, meio a meio, snapshot histórico com ID retirado, ingredientes/modificadores por metade, borda, observação, extras por unidade, v1 ignorado, filtro/estados individuais, fila vazia/erro/resposta inválida, ordenação, 30 pizzas e preservação/limpeza da seleção. `npm run test:assembly` executa 27 testes, incluindo os 16 anteriores.

`npm run test:assembly:browser` verifica a demonstração explicitamente por `source=demo`, o simulador, catálogo, fluxos locais, scroll e rotas. A rota normal é verificada como fila persistida vazia nesse smoke com resposta controlada.

`npm run test:assembly:persisted:browser` usa o servidor compilado na porta 3347, com migrations completas em SQLite descartável. O navegador só redireciona o transporte das consultas/criação para essa API; as respostas de sucesso vêm do banco real de teste. Não para nem escreve na API/banco da loja. Requer Vite em 5173 e porta 3347 livre.

O teste integrado cria **pelo formulário** `/orders/new`:

- Grande Calabresa inteira com borda e observação;
- Grande meio a meio Calabresa/Mussarela, remoção de cebola na primeira metade e adicional de bacon na segunda;
- Broto inteiro;
- duas unidades de extra.

Confere linhas Prisma, `GET /orders/v2` e exibição na rota normal `/kitchen/assembly`, sem mock desse pedido. Verifica ações desabilitadas e apenas três históricos iniciais. No banco descartável, altera nomes do snapshot para demonstrar exibição histórica independente do catálogo. Também cria um lote separado de 30 pizzas, verifica ordenação, loading/vazio/erro, preservação após erro e ausência de POSTs operacionais pelo Assembly.

## Arquivos da entrega

Novos: `features/kitchen/api.ts`, `usePersistentAssembly.ts`, `assembly-read.test.ts`, `scripts/assembly-persisted-browser-smoke.mjs`, `scripts/helpers/isolated-api.mjs` e este documento.

Alterados: `types.ts`, `assembly.ts`, `pizzaRecipe.ts`, `useAssembly.tsx`, `assembly.css`, `components/CurrentOrder.tsx`, `components/OrderQueue.tsx`, `components/PizzaDetail.tsx`, `pages/KitchenAssemblyPage.tsx`, `pages/KitchenSimulatorPage.tsx`, `apps/web/src/pages/NewOrder.tsx`, `scripts/assembly-browser-smoke.mjs`, `package.json` e `README.md`. Nenhuma dependência nova; lockfile continua preexistente.

## Problemas corrigidos e riscos

O protótipo dependia exclusivamente de mocks e reconstruía nomes/ingredientes pelo catálogo atual. Também não representava todos os estados persistentes e não distinguia origem da fila. Agora usa snapshot validado, estados individuais, filtro de montagem e separação explícita das fontes. A confirmação do balcão estava desatualizada e foi corrigida.

Riscos/limites: atraso de atualização de até cerca de 30 segundos mais tempo da consulta; em falha, dados preservados podem estar desatualizados e a mensagem permanece visível. Não há claims, identidade de montador ou proteção operacional entre tablets, pois nenhuma ação é gravada. Listagem ainda carrega pedidos v2 ativos completos, sem paginação/endpoint otimizado de montagem; validar volume real antes de escala. Extras e revisões do catálogo continuam sujeitos às pendências documentadas na 3B. Recarregar/sair da demonstração pode reiniciar seus dados locais.

## Fase 3C.2

Próximo escopo: definir comandos individuais com estado/versão esperados e idempotência, persistir timestamps e histórico, recalcular agregação na mesma transação e testar conflitos, rollback e reconexão. Definir identidade/claims e estratégia de realtime antes de liberar múltiplos tablets alterando a mesma pizza. Só então habilitar ações na fila real. Nada disso foi iniciado na 3C.1.
