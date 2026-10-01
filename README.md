# Guig's Kitchen — Fase 1

Protótipo local da operação da cozinha: criar pedidos fictícios, persistir em SQLite e vê-los entrar na fila em tempo real. O escopo e as fases futuras estão em [BASE_DO_PROJETO.md](BASE_DO_PROJETO.md).

## Requisitos

- Windows com Node.js 20.19+ e npm instalados.
- Portas 5173 (painel) e 3333 (API) livres.

## Iniciar

No Windows, execute `start.bat` por duplo clique ou `./start.ps1` no PowerShell. O inicializador cria `.env` se faltar, instala dependências se necessário, gera o Prisma Client, aplica as migrations existentes, executa o seed de forma idempotente e inicia API e frontend no mesmo terminal. `Ctrl+C` encerra os serviços. Logs de ambos ficam no terminal.

Com ambiente preparado, também é possível executar `npm run dev`. Na primeira instalação manual, rode `npm install` e `npm run db:prepare` antes.

## URLs

| Página / serviço | Endereço |
| --- | --- |
| Painel | http://localhost:5173/ |
| Novo pedido | http://localhost:5173/orders/new |
| Cozinha | http://localhost:5173/kitchen |
| Saúde da API | http://localhost:3333/health |
| Fila aguardando | `GET http://localhost:3333/orders` |
| Criar pedido | `POST http://localhost:3333/orders` |
| Pedido por ID | `GET http://localhost:3333/orders/:id` |

`GET /orders` retorna apenas pedidos `WAITING_PRODUCTION`, em ordem de chegada. Após `POST /orders`, o servidor emite `order.created` via Socket.IO. A interface faz leitura pela API ao abrir e ao reconectar; o evento dispara nova leitura.

## Teste rápido

1. Inicie com `start.bat` e abra `/kitchen`.
2. Em outra aba, abra `/orders/new`, informe cliente e tipo, e adicione uma ou mais pizzas com modificadores.
3. Crie o pedido e observe o número de confirmação.
4. Confira se apareceu em `/kitchen` sem atualizar a página.
5. Pare e reinicie o sistema; o pedido deverá continuar na fila.

## Banco e seed

O arquivo SQLite fica em `apps/api/prisma/dev.db` e é ignorado pelo Git. As migrations reais ficam em `apps/api/prisma/migrations`. O seed registra os montadores Rafael, Lucas e João; os sabores Calabresa, Portuguesa, Mussarela e Frango com Catupiry; e os tamanhos Pequena, Média e Grande. O seed usa `upsert`, portanto pode ser repetido sem duplicar dados. Não cria pedidos por padrão.

Para recriar o ambiente de desenvolvimento do zero, pare o servidor, apague manualmente `apps/api/prisma/dev.db` e execute `npm run db:prepare`. Isso remove todos os pedidos locais; o inicializador normal jamais apaga o banco.

## Estrutura

- `apps/web`: React, Vite e as três páginas.
- `apps/api`: Express, Socket.IO, serviço de pedidos, Prisma e seed.
- `packages/shared`: contrato dos pedidos e validação Zod compartilhados.
- `apps/api/prisma`: schema, migrations e banco local.

## Tablet, celular e Android Emulator

Na mesma rede, acesse `http://IP-DO-WINDOWS:5173` no tablet ou celular. No Android Emulator, use `http://10.0.2.2:5173` para alcançar o host Windows. A interface usa automaticamente o mesmo host na porta 3333 para a API. Permita as portas 5173 e 3333 no firewall do Windows quando necessário. Em outros emuladores, o endereço do host pode variar. Para API em outro host, defina `VITE_API_URL` em `.env` e reinicie o Vite.

O projeto inclui um manifest web básico e layout responsivo, mas instalação offline/PWA completa será tratada em etapa posterior.

## Qualidade e problemas comuns

Execute `npm run lint`, `npm run typecheck`, `npm test` e `npm run build` para validar o projeto. Se o painel indicar API indisponível, confira logs, porta 3333 e firewall. Se o realtime estiver reconectando, confira a conexão Socket.IO; a fila também sincroniza periodicamente pela API. Se o Prisma falhar ao abrir o banco, verifique `.env` e execute `npm run db:prepare`.
