# Guig's Kitchen — Balcão e montagem

Protótipo local da operação da cozinha: criar pedidos fictícios, persistir em SQLite, avançar por estados validados e acompanhar o histórico em tempo real. O escopo e as fases futuras estão em [BASE_DO_PROJETO.md](BASE_DO_PROJETO.md).

A nova **Fila de Montagem** é um módulo isolado para tablets, dentro deste mesmo frontend. Nesta primeira versão, usa exclusivamente dados em memória para validar a operação por pizza. As páginas existentes e sua integração com SQLite/API continuam preservadas.

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
| Fila de Montagem (demo local) | http://localhost:5173/kitchen/assembly |
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
5. Repita nas demais pizzas. A timeline continua em **Montagem** enquanto qualquer pizza não tiver sido enviada. Todas no forno: timeline em **Forno** e botão **Concluir pedido** habilitado.
6. Clique em **Concluir pedido**. O pedido sai da fila, o próximo na ordenação atual é selecionado e um evento local `assembly.completed` guarda o pedido com o contador de extras e seu estado real `OVEN`, destinado à futura finalização depois do forno.
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
| `assembly.test.ts` | 13 testes de catálogo, composição, modificadores, ordenação e montagem |

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
