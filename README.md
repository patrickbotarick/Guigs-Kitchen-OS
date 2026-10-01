# Guig's Kitchen — Fase 2A

Protótipo local da operação da cozinha: criar pedidos fictícios, persistir em SQLite, avançar por estados validados e acompanhar o histórico em tempo real. O escopo e as fases futuras estão em [BASE_DO_PROJETO.md](BASE_DO_PROJETO.md).

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

- `apps/web`: React, Vite e as três páginas.
- `apps/api`: Express, Socket.IO, serviço de pedidos, Prisma e seed.
- `packages/shared`: contrato dos pedidos e validação Zod compartilhados.
- `apps/api/prisma`: schema, migrations e banco local.
- `Logo_Guigs.png`: asset oficial fornecido; a cópia servida pelo frontend está em `apps/web/public/logo-guigs.png`.

## Tablet, celular e Android Emulator

Na mesma rede, acesse `http://IP-DO-WINDOWS:5173` no tablet ou celular. No Android Emulator, use `http://10.0.2.2:5173` para alcançar o host Windows. A interface usa automaticamente o mesmo host na porta 3333 para a API. Permita as portas 5173 e 3333 no firewall do Windows quando necessário. Em outros emuladores, o endereço do host pode variar. Para API em outro host, defina `VITE_API_URL` em `.env` e reinicie o Vite.

O projeto inclui um manifest web básico e layout responsivo, mas instalação offline/PWA completa será tratada em etapa posterior.

## Qualidade e problemas comuns

Execute `npm run lint`, `npm run typecheck`, `npm test`, `npm run smoke` (com o servidor ativo), `npm run test:browser` (com Edge ou Chrome instalado e servidor ativo) e `npm run build` para validar o projeto. Se o painel indicar API indisponível, confira logs, porta 3333 e firewall. Se o realtime estiver reconectando, confira a conexão Socket.IO. Se `prisma generate` apresentar EPERM no Windows, encerre a instância anterior do Kitchen com `Ctrl+C`, confirme que as portas 3333/5173 estão livres e execute `npm run setup`; o inicializador não encerra outros processos Node automaticamente.
