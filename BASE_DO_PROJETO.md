# BASE DO PROJETO — GUIG'S KITCHEN

> Documento-mestre de arquitetura, escopo e direção do projeto.
> Este arquivo deve permanecer na raiz do repositório e ser tratado como a fonte principal de verdade do projeto.
> Alterações de arquitetura, escopo ou regras centrais devem atualizar este documento.

---

# 1. Visão do produto

O projeto, provisoriamente chamado **Guig's Kitchen**, é um sistema interno de operação e produção para pizzarias, inicialmente desenvolvido e validado dentro da **Pizzaria Guig's**.

O objetivo inicial NÃO é substituir Saipos, CCM, iFood ou outros sistemas existentes.

O objetivo inicial é digitalizar e otimizar o trecho operacional que hoje começa quando o pedido chega à pizzaria e passa a circular manualmente dentro da cozinha.

Hoje, de forma simplificada:

```text
iFood
  ↓
CCM
  ↓
Saipos
  ↓
Impressora térmica
  ↓
Cupom de papel
  ↓
Cozinha
  ↓
Montadores pegam os pedidos manualmente
  ↓
Forno
  ↓
Finalização
  ↓
Aguardando motoboy
  ↓
Em rota
  ↓
Entregue
```

Pedidos feitos pelo link/cardápio digital também entram pela CCM, seguem para a Saipos e depois percorrem o mesmo processo.

Pedidos feitos no balcão podem ser cadastrados diretamente na Saipos.

A partir da impressão do pedido, grande parte da operação interna passa a ser manual.

O Guig's Kitchen deve atacar exatamente esse trecho.

---

# 2. Visão de longo prazo

A evolução imaginada é:

```text
FASE INICIAL
Saipos / CCM / iFood
        ↓
Guig's Kitchen
        ↓
Produção / forno / expedição / entrega
```

No futuro:

```text
Guig's Platform

├── Cardápio
├── Pedidos
├── Kitchen
├── Delivery
├── Customers
├── Stock
├── Analytics
└── Outros módulos
```

O **Guig's Stock** continua sendo um projeto separado durante seu desenvolvimento atual.

Não integrar Guig's Stock ao Guig's Kitchen neste momento.

Entretanto, a arquitetura do Kitchen deve evitar decisões que impossibilitem uma integração futura entre produtos.

---

# 3. Princípio fundamental

Não tentar reconstruir Saipos, CCM ou iFood na primeira versão.

Primeiro provar que conseguimos transformar o processo interno da pizzaria em uma operação digital eficiente.

A primeira meta real do projeto é:

> Conseguir simular uma noite inteira de operação da pizzaria, com múltiplos pedidos e múltiplos montadores, sem depender de integrações externas.

Somente depois disso investigar e implementar integrações oficiais com CCM/Saipos.

---

# 4. Fluxo operacional alvo

Fluxo macro:

```text
PEDIDO RECEBIDO
      ↓
AGUARDANDO PRODUÇÃO
      ↓
ATRIBUÍDO A UM MONTADOR
      ↓
EM PRODUÇÃO
      ↓
PIZZAS SENDO FINALIZADAS INDIVIDUALMENTE
      ↓
FORNO
      ↓
FINALIZAÇÃO / EMBALAGEM
      ↓
AGUARDANDO EXPEDIÇÃO
      ↓
AGUARDANDO MOTOBOY
      ↓
EM ROTA
      ↓
ENTREGUE
```

Para retirada:

```text
FINALIZAÇÃO
      ↓
PRONTO PARA RETIRADA
      ↓
RETIRADO
```

A máquina de estados deverá ser explícita, consistente e controlada pelo backend.

---

# 5. Unidade de controle

O sistema NÃO deve controlar somente pedidos.

Ele deve controlar:

- pedido;
- itens do pedido;
- pizzas individualmente;
- etapas de produção;
- montador responsável;
- timestamps;
- alterações de estado.

Exemplo:

```text
Pedido #102 — Rafael

✅ Portuguesa Grande
   montagem concluída
   enviada ao forno

🔵 Calabresa Grande
   em produção
```

O pedido só pode avançar para determinadas etapas quando seus itens obrigatórios tiverem concluído a etapa anterior.

---

# 6. Tablet do montador

Cada montador deverá utilizar um tablet ou PWA instalado em um tablet.

Exemplo de tela inicial:

```text
Rafael

Status: LIVRE

Fila de produção
3 pedidos aguardando

Próximo pedido
#102
2 pizzas

[ ASSUMIR PEDIDO ]
```

Quando um montador assume um pedido, o backend deve executar uma operação atômica.

Nunca permitir que dois montadores assumam o mesmo pedido.

A regra deve ser garantida no servidor/banco, não apenas na interface.

Exemplo conceitual:

```text
IF order.status == WAITING
    assign worker
    set status = IN_PRODUCTION
ELSE
    reject assignment
```

---

# 7. Produção de cada pizza

Ao abrir o pedido:

```text
PEDIDO #102
Cliente: Rafael

1. Portuguesa Grande
   SEM CEBOLA

2. Calabresa Grande
   BORDA CATUPIRY
```

O montador deve poder escolher qual pizza produzir primeiro.

Ao abrir uma pizza, mostrar claramente:

- nome;
- tamanho;
- ingredientes padrão;
- ingredientes removidos;
- adicionais;
- borda;
- observações.

Exemplo:

```text
PORTUGUESA GRANDE

Molho
Mussarela
Presunto
Ovo
Ervilha
Orégano
Azeitona

🚫 SEM CEBOLA

Observação:
Cortar em 8 pedaços
```

IMPORTANTE:

Não exigir checklist manual de cada ingrediente.

O sistema deve informar, e não transformar a montagem em uma sequência burocrática de cliques.

As alterações do produto devem ter alto destaque visual:

```text
🚫 SEM CEBOLA
+ BACON
+ BORDA CATUPIRY
```

A ação principal deve ser algo simples como:

```text
[ FINALIZAR PIZZA ]
```

---

# 8. Tempos

Registrar timestamps relevantes.

Inicialmente:

- order_received_at;
- production_queue_at;
- assigned_at;
- production_started_at;
- item_started_at;
- item_finished_at;
- oven_started_at;
- oven_expected_end_at;
- oven_finished_at;
- packing_finished_at;
- waiting_driver_at;
- dispatched_at;
- delivered_at.

A nomenclatura final pode ser adaptada ao padrão da aplicação.

Não depender apenas de um cronômetro do frontend.

Os tempos devem ser derivados de timestamps persistidos no backend.

---

# 9. Forno

A pizzaria utiliza forno de esteira.

O sistema deve ser preparado para trabalhar com tempo aproximado/configurável de forno.

Exemplo:

```text
Tempo configurado do forno: 6min30s
```

Quando a pizza for enviada ao forno:

```text
oven_started_at = now
oven_expected_end_at = now + configured_oven_time
```

Uma futura tela de forno poderá exibir:

```text
SAINDO EM BREVE

#102 Portuguesa     00:18
#101 Calabresa      00:47
#103 Frango         01:32
```

Não é necessário implementar toda a tela de forno no primeiro ciclo, mas a arquitetura deve suportá-la.

---

# 10. Expedição

Após todas as pizzas do pedido estarem concluídas:

```text
PEDIDO #102
2/2 pizzas prontas
```

O pedido poderá avançar para:

```text
AGUARDANDO EXPEDIÇÃO
```

Depois:

```text
AGUARDANDO MOTOBOY
```

No futuro:

```text
[ DESPACHAR ]
Motoboy: João
```

E:

```text
EM ROTA
```

Depois:

```text
ENTREGUE
```

Para retirada, utilizar fluxo específico.

---

# 11. Métricas futuras

A arquitetura deve permitir calcular no futuro:

- quantidade de pedidos;
- quantidade de pizzas;
- tempo médio em fila;
- tempo médio de montagem;
- tempo médio por pizza;
- tempo médio por sabor;
- tempo médio de forno;
- tempo médio de finalização;
- tempo esperando motoboy;
- tempo total até despacho;
- tempo total até entrega;
- produção por montador;
- carga de trabalho;
- gargalos por horário.

Evitar criar rankings simplistas de funcionários.

Métricas de produtividade deverão considerar contexto, volume, complexidade e carga de trabalho.

---

# 12. Integrações externas

Na fase inicial, NÃO depender de Saipos, CCM ou iFood.

Criar uma abstração de entrada de pedidos.

Exemplo conceitual:

```text
OrderProvider
```

Primeira implementação:

```text
TestOrderProvider
```

Futuras implementações:

```text
SaiposOrderProvider
CCMOrderProvider
```

A aplicação interna deve receber um pedido normalizado, independentemente da origem.

Formato conceitual:

```text
Order
Customer
OrderItems
Modifiers
Notes
OrderType
Timestamps
ExternalReferences
```

Quando chegar o momento de integrar, investigar apenas APIs oficiais, webhooks, Open Delivery ou integrações autorizadas.

Não construir automações frágeis baseadas em scraping de tela como arquitetura principal.

---

# 13. Estratégia de desenvolvimento

Construir por fatias verticais funcionais.

Cada etapa deve resultar em algo executável e testável.

Não criar grandes quantidades de código especulativo para funcionalidades futuras.

Prioridades:

1. fluxo funcionando;
2. consistência dos dados;
3. concorrência segura;
4. simplicidade da interface;
5. operação rápida em cozinha;
6. telemetria e métricas;
7. integrações;
8. expansão.

---

# 14. Stack inicial recomendada

Para o primeiro protótipo funcional:

## Frontend
- React
- TypeScript
- Vite
- React Router
- CSS organizado ou solução simples de design system
- PWA preparada para tablets

## Backend
- Node.js
- TypeScript
- API HTTP
- comunicação realtime via WebSocket/Socket.IO ou solução equivalente simples e robusta

## Persistência local
- Prisma
- SQLite no desenvolvimento inicial

Motivo:

O primeiro protótipo deve funcionar localmente sem obrigar configuração de serviços externos.

A camada de persistência deve ser organizada de modo que futuramente seja possível migrar para PostgreSQL/Supabase sem reescrever a aplicação inteira.

## Futuro
- PostgreSQL
- Supabase ou infraestrutura equivalente
- autenticação
- realtime em nuvem
- multi-tenant
- SaaS

---

# 15. Preparação futura para SaaS

Mesmo no protótipo, não acoplar regras à existência de uma única pizzaria.

No modelo futuro haverá conceitos como:

```text
organizations
stores
users
roles
workers
customers
products
recipes
orders
order_items
production_tasks
drivers
deliveries
```

Não é necessário implementar multi-tenancy completa agora.

Mas evitar nomes, regras ou hacks impossíveis de generalizar.

---

# 16. Desenvolvimento local

O projeto será desenvolvido inicialmente em Windows.

Criar inicializadores:

```text
start.bat
start.ps1
```

Objetivo:

O usuário deve conseguir abrir a pasta e iniciar o ambiente com poucos passos.

Também disponibilizar:

```text
npm run dev
```

O inicializador deve:

1. verificar dependências;
2. instalar dependências quando necessário;
3. preparar banco local quando necessário;
4. executar migrations;
5. executar seed mínimo quando apropriado;
6. iniciar frontend;
7. iniciar backend;
8. mostrar claramente as URLs no terminal.

Exemplo esperado:

```text
Guig's Kitchen iniciado.

Painel:
http://localhost:5173

API:
http://localhost:3333
```

As portas podem ser diferentes caso haja uma justificativa, mas devem ser documentadas.

---

# 17. Android Studio e tablets

A aplicação principal deve ser web/PWA, e não Android nativo neste momento.

O Android Studio poderá ser usado para abrir múltiplos emuladores de tablet.

Exemplo:

```text
Tablet 1 → Rafael
Tablet 2 → Lucas
Tablet 3 → João
```

Cada emulador acessará o servidor local pelo endereço adequado da máquina host.

Documentar no README como acessar o servidor do Windows a partir dos emuladores Android.

---

# 18. Primeira fatia vertical obrigatória

O PRIMEIRO CICLO DE IMPLEMENTAÇÃO deve terminar com algo utilizável.

Fluxo mínimo:

```text
CRIAR PEDIDO DE TESTE
        ↓
BACKEND
        ↓
BANCO LOCAL
        ↓
FILA DA COZINHA
        ↓
ATUALIZAÇÃO EM TEMPO REAL
```

O usuário deverá conseguir abrir uma página e criar um pedido.

Campos mínimos:

- nome do cliente;
- tipo: delivery ou retirada;
- telefone opcional;
- observação opcional;
- uma ou mais pizzas;
- sabor/nome;
- tamanho;
- ingredientes;
- ingredientes removidos;
- adicionais;
- observação do item.

Exemplo de pedido de seed:

```text
Cliente: Rafael
Tipo: Delivery

Pizza 1:
Portuguesa Grande
Sem cebola

Pizza 2:
Calabresa Grande
Borda de Catupiry
```

Depois de clicar em:

```text
[ CRIAR PEDIDO ]
```

o pedido deverá:

1. ser validado no backend;
2. ser persistido;
3. receber ID/número;
4. receber horário;
5. entrar com status correto;
6. aparecer imediatamente na tela da cozinha;
7. aparecer sem necessidade de recarregar a página.

---

# 19. Interface mínima do primeiro ciclo

Criar no mínimo estas rotas/telas:

```text
/
```

Dashboard simples do projeto com navegação.

```text
/orders/new
```

Simulador/criador de pedidos.

```text
/kitchen
```

Fila da cozinha.

Opcionalmente:

```text
/health
```

ou endpoint equivalente para verificar saúde da API.

A fila da cozinha deve exibir pelo menos:

- número;
- cliente;
- horário;
- tipo;
- quantidade de pizzas;
- status;
- resumo dos itens.

Não implementar design excessivamente complexo.

Priorizar interface limpa, rápida, responsiva e legível.

---

# 20. Dados iniciais

Criar seed simples com:

Montadores:

```text
Rafael
Lucas
João
```

Sabores de exemplo:

```text
Calabresa
Portuguesa
Mussarela
Frango com Catupiry
```

Tamanhos:

```text
Pequena
Média
Grande
```

Os dados servem apenas para desenvolvimento.

Não tratá-los como cardápio definitivo.

---

# 21. Qualidade técnica

O primeiro ciclo deve possuir:

- TypeScript sem erros;
- lint configurado;
- estrutura de pastas coerente;
- validação de payloads;
- tratamento básico de erros;
- banco versionado por migrations;
- seed reproduzível;
- IDs confiáveis;
- timestamps;
- logs legíveis;
- README;
- `.env.example`;
- `.gitignore`;
- scripts de inicialização;
- testes das regras centrais quando aplicável.

Evitar `any` desnecessário.

Evitar componentes gigantes.

Separar domínio, persistência e interface quando fizer sentido.

---

# 22. Segurança e consistência

Mesmo no protótipo:

- nunca confiar em status enviado livremente pelo frontend;
- validar transições no backend;
- não permitir IDs arbitrários sem validação;
- preparar regras para concorrência;
- persistir timestamps no servidor;
- manter histórico suficiente para auditoria futura.

Autenticação completa NÃO é prioridade do primeiro ciclo.

---

# 23. Git

Inicializar Git caso ainda não exista.

Criar `.gitignore`.

Ao final de uma alteração significativa e validada, deixar o repositório em estado limpo e apto a commit.

Não publicar automaticamente em repositório remoto sem autorização.

---

# 24. Arquivo-mestre

Este arquivo deve permanecer na raiz com o nome:

```text
BASE_DO_PROJETO.md
```

O Codex deve consultar este arquivo antes de mudanças importantes.

Quando uma decisão estrutural nova for tomada posteriormente, atualizar este documento.

Não apagar requisitos silenciosamente.

Se houver conflito entre uma implementação futura e este documento, sinalizar antes de alterar a premissa.

---

# 25. Plano macro

## Fase 1 — Fundação + simulador

Entregar:

- monorepo/projeto organizado;
- frontend;
- backend;
- banco local;
- migrations;
- seed;
- realtime;
- criador de pedidos;
- fila básica da cozinha;
- inicializadores;
- documentação.

## Fase 2 — Central da cozinha

Entregar:

- visão Kanban/operacional;
- estados do pedido;
- atualização realtime;
- histórico de transições.

## Fase 3 — Tablet do montador

Entregar:

- identificação do montador;
- fila;
- assumir pedido;
- lock concorrente;
- iniciar produção;
- selecionar pizza;
- visualizar ingredientes e modificadores;
- finalizar pizza;
- finalizar montagem.

## Fase 4 — Pizza individual + forno

Entregar:

- estados por item;
- tempos por pizza;
- entrada no forno;
- previsão de saída;
- tela operacional de forno.

## Fase 5 — Finalização + expedição

Entregar:

- embalagem;
- pedido completo;
- aguardando motoboy;
- despacho;
- em rota;
- entregue;
- retirada.

## Fase 6 — Analytics

Entregar:

- métricas;
- tempos;
- gargalos;
- relatórios operacionais.

## Fase 7 — Integrações

Investigar e posteriormente implementar:

- Saipos;
- CCM;
- APIs oficiais;
- webhooks;
- Open Delivery;
- sincronização de estados quando suportada.

---

# 26. Critério para primeira validação real

Antes de integrações externas, o sistema deverá conseguir executar uma simulação de pelo menos:

- 3 montadores simultâneos;
- 30 a 50 pedidos fictícios;
- múltiplas pizzas por pedido;
- modificadores;
- concorrência na atribuição;
- conclusão individual dos itens;
- fluxo completo sem inconsistências.

Depois disso poderá ser realizado teste assistido dentro da Pizzaria Guig's, inicialmente sem substituir o fluxo atual.

---

# 27. Regra de produto

O sistema deve reduzir ações manuais, não aumentá-las.

Toda funcionalidade deve responder:

> Isto ajuda a cozinha a produzir com mais clareza, velocidade e controle?

Se a funcionalidade exigir cliques desnecessários durante a montagem, simplificá-la.

A cozinha é um ambiente rápido.

A interface deve ser:

- visual;
- direta;
- resistente a erro;
- utilizável com toque;
- legível à distância;
- responsiva;
- rápida.

---

# 28. PROMPT DE EXECUÇÃO INICIAL PARA O CODEX

Você está iniciando do zero o projeto descrito neste documento.

Sua tarefa é implementar SOMENTE a primeira fatia vertical funcional, mas estruturar o código respeitando a visão de longo prazo.

## Objetivo desta execução

Ao terminar, eu preciso conseguir abrir o projeto no Windows, executar um inicializador e acessar uma interface funcional no navegador.

Nesta interface devo conseguir:

1. abrir um formulário de criação de pedido de teste;
2. criar um pedido com cliente, tipo e pizzas;
3. gravar esse pedido no banco local;
4. abrir a tela da cozinha;
5. ver o pedido criado;
6. criar outro pedido em outra aba;
7. ver a fila atualizar automaticamente sem F5.

Não implemente ainda integração com Saipos, CCM ou iFood.

Não implemente ainda autenticação completa, delivery real, pagamento ou cardápio público.

Não tente entregar todas as fases deste documento.

Construa uma fundação profissional e uma primeira demonstração funcional.

---

## Arquitetura esperada

Preferência:

```text
guigs-kitchen/
├── apps/
│   ├── web/
│   └── api/
├── packages/
│   └── shared/
├── prisma/ ou camada equivalente organizada
├── BASE_DO_PROJETO.md
├── README.md
├── start.bat
├── start.ps1
├── package.json
├── .env.example
└── .gitignore
```

Você pode ajustar a estrutura caso uma organização equivalente seja tecnicamente superior, mas mantenha frontend, backend e tipos compartilhados claramente organizados.

Usar:

- React;
- TypeScript;
- Vite;
- Node.js + TypeScript;
- Prisma;
- SQLite;
- realtime via Socket.IO/WebSocket;
- validação com Zod ou equivalente;
- React Router;
- npm workspaces ou solução simples equivalente.

Evite adicionar dependências grandes sem necessidade.

---

## Banco inicial

Criar entidades mínimas suficientes para a primeira demonstração.

Sugestão:

```text
Order
OrderItem
OrderItemModifier
Worker
```

Se `Worker` ainda não for utilizado funcionalmente, pode existir apenas como seed/preparação.

Um `Order` deve ter pelo menos:

- id;
- number;
- customerName;
- customerPhone opcional;
- type;
- status;
- notes opcional;
- receivedAt;
- createdAt;
- updatedAt.

Um `OrderItem` deve ter:

- id;
- orderId;
- name;
- size;
- status;
- notes opcional;
- createdAt;
- updatedAt.

Modificadores podem representar:

- REMOVED;
- ADDED;
- CRUST;
- NOTE;

ou estrutura equivalente bem modelada.

Não criar uma tabela gigante com JSON para tudo apenas para ganhar velocidade.

---

## Status iniciais

Criar enums ou tipos claros.

Pedido:

```text
WAITING_PRODUCTION
IN_PRODUCTION
OVEN
FINISHING
WAITING_DISPATCH
WAITING_DRIVER
OUT_FOR_DELIVERY
DELIVERED
READY_FOR_PICKUP
PICKED_UP
CANCELLED
```

Nem todos serão usados na primeira interface, mas o modelo deve permitir evolução sem improvisação.

Item:

```text
WAITING
IN_PRODUCTION
OVEN
FINISHED
CANCELLED
```

---

## API mínima

Implementar endpoints suficientes.

Exemplo conceitual:

```text
GET  /health
GET  /orders
POST /orders
GET  /orders/:id
```

Criar validações adequadas.

Depois do `POST /orders`, emitir um evento realtime:

```text
order.created
```

A página `/kitchen` deve ouvir o evento e atualizar a lista.

Evitar depender exclusivamente do evento para consistência.

A tela deve carregar a lista atual pela API ao abrir e utilizar realtime para alterações posteriores.

---

## Formulário `/orders/new`

Criar formulário confortável para desktop/tablet.

Campos:

```text
Cliente
Telefone
Tipo: Delivery / Retirada
Observação
```

Itens dinâmicos:

```text
Pizza
Tamanho
Ingredientes/descrição
Removidos
Adicionais
Observação
```

Permitir:

```text
[ + ADICIONAR PIZZA ]
[ REMOVER PIZZA ]
```

E:

```text
[ CRIAR PEDIDO ]
```

Após sucesso:

- exibir confirmação;
- exibir número do pedido;
- permitir criar outro;
- não duplicar envio se o botão for clicado repetidamente.

---

## Tela `/kitchen`

Mostrar os pedidos `WAITING_PRODUCTION`.

Cards grandes e legíveis.

Exemplo:

```text
#0001
Rafael

DELIVERY
20:42

2 pizzas

• Portuguesa Grande
  🚫 sem cebola

• Calabresa Grande
  + borda catupiry
```

Neste primeiro ciclo, não é obrigatório implementar o botão de assumir pedido.

Entretanto, se a fundação ficar sólida e isso não comprometer a entrega, pode existir uma ação simples futura/desabilitada visualmente.

Não implementar lógica incompleta fingindo que está pronta.

---

## Dashboard `/`

Criar uma página simples:

```text
GUIG'S KITCHEN

Protótipo de operação da cozinha

[ Novo pedido de teste ]
[ Abrir fila da cozinha ]
```

Mostrar também:

- status da API;
- quantidade de pedidos aguardando;
- indicação de conexão realtime.

---

## Realtime

Demonstrar claramente que funciona.

Teste:

1. abrir `/kitchen`;
2. abrir `/orders/new` em outra aba;
3. criar pedido;
4. pedido aparecer em `/kitchen` sem refresh.

Criar reconexão básica.

Exibir de forma discreta no frontend:

```text
Realtime: conectado
```

ou

```text
Realtime: reconectando
```

---

## Seed

Criar seed com:

Montadores:

- Rafael
- Lucas
- João

Opcionalmente incluir um pedido de demonstração.

Se incluir pedido demo, documentar como limpar/resetar banco.

---

## Inicialização no Windows

Criar:

```text
start.bat
start.ps1
```

Eles devem permitir iniciar o projeto de forma simples.

Idealmente:

```text
duplo clique em start.bat
```

ou:

```powershell
.\start.ps1
```

O script deve:

- detectar Node/npm;
- mostrar mensagem amigável se não estiver instalado;
- instalar dependências se necessário;
- gerar Prisma Client;
- aplicar migrations;
- executar seed quando necessário;
- iniciar API e frontend;
- não abrir processos duplicados desnecessariamente;
- manter logs visíveis.

Não apagar banco automaticamente a cada execução.

Ao final, imprimir:

```text
=======================================
 GUIG'S KITCHEN
=======================================

Painel:
http://localhost:5173

API:
http://localhost:3333

Ctrl+C para encerrar.
```

Se utilizar portas diferentes, ajustar documentação.

---

## README

Criar um `README.md` útil.

Incluir:

- objetivo;
- stack;
- requisitos;
- instalação;
- inicialização;
- URLs;
- banco;
- reset do ambiente;
- estrutura de pastas;
- teste realtime;
- solução de problemas;
- como acessar pelo celular/tablet na mesma rede;
- como acessar pelo Android Emulator.

Para Android Emulator, documentar corretamente o endereço especial para alcançar o host quando aplicável.

---

## BASE_DO_PROJETO.md

Criar na raiz este documento com todo o conteúdo conceitual do projeto.

Se este prompt tiver sido fornecido fora do repositório, copie esta especificação para `BASE_DO_PROJETO.md`.

Ele será a fonte de verdade do projeto.

---

## Aparência

Não gastar tempo criando branding definitivo.

Criar uma UI:

- moderna;
- limpa;
- escura ou neutra;
- excelente legibilidade;
- botões grandes;
- touch-friendly;
- responsiva;
- apropriada para cozinha.

Evitar excesso de animações.

O produto é uma ferramenta operacional.

---

## Testes

Criar testes especialmente para:

- criação válida de pedido;
- rejeição de payload inválido;
- numeração/identificação de pedido;
- persistência de itens;
- modificadores;
- carregamento da fila.

Se a arquitetura permitir de forma simples, criar teste de integração da API.

Executar antes de encerrar:

```text
lint
typecheck
tests
build
```

Corrigir falhas relevantes.

---

## Critérios de aceite desta primeira execução

Considere a tarefa concluída somente se:

- projeto inicia localmente;
- frontend abre;
- API responde;
- banco funciona;
- migrations funcionam;
- formulário cria pedido;
- pedido persiste;
- fila carrega pedidos;
- realtime atualiza;
- reiniciar o sistema não apaga os pedidos;
- README explica execução;
- `BASE_DO_PROJETO.md` existe;
- `start.bat` existe;
- `start.ps1` existe;
- lint passa;
- typecheck passa;
- testes passam;
- build passa.

---

## O que NÃO fazer agora

NÃO implementar:

- integração real com Saipos;
- integração real com CCM;
- integração iFood;
- scraping;
- pagamentos;
- fiscal;
- NFC-e;
- gestão financeira;
- estoque;
- autenticação complexa;
- aplicativo Android nativo;
- distribuição automática avançada;
- métricas avançadas;
- dashboard executivo;
- mapa;
- motoboy GPS;
- IA.

Também não iniciar a Fase 2 inteira.

Entregue a fundação + primeira fatia vertical.

---

## Forma de trabalho

1. Analise este documento.
2. Inspecione a pasta atual.
3. Planeje a estrutura.
4. Implemente.
5. Execute migrations/seed.
6. Rode o sistema.
7. Teste o fluxo de criação de pedido.
8. Teste realtime.
9. Rode lint/typecheck/tests/build.
10. Corrija problemas.
11. Atualize README.
12. Faça uma revisão final do estado do projeto.

Não apenas gere arquivos e pare.

Valide que o projeto realmente executa.

Ao final, responda com um resumo objetivo contendo:

- arquitetura criada;
- principais arquivos;
- banco;
- rotas;
- como iniciar;
- URLs;
- testes executados;
- resultado dos testes;
- limitações atuais;
- próximo passo recomendado.

Não implemente o próximo passo sem solicitação.

---

# 29. Decisões da Fase 2A — identidade e histórico

## Identidade visual

Guig's Kitchen pertence ao mesmo ecossistema do Guig's Stock. Ambos devem compartilhar linguagem visual, paleta e padrões de interface. A logo oficial da Pizzaria Guig's é o principal asset de marca. Nesta etapa foi usado `Logo_Guigs.png`, idêntico ao asset presente no Guig's Stock, copiado para `apps/web/public/logo-guigs.png` sem redesenho. A interface usa como referência a base escura, a superfície clara e o vermelho do Guig's Stock; os valores foram centralizados em tokens CSS para futura evolução conjunta.

## Desenvolvimento

- Fase 1 — concluída e validada.
- Fase 2A — máquina de estados do pedido, histórico persistente, atualização realtime e ajustes de fundação.
- Fase 2B — central Kanban completa; ainda não iniciada.

Na Fase 2A, somente as transições `WAITING_PRODUCTION → IN_PRODUCTION → OVEN → FINISHING → WAITING_DISPATCH` são habilitadas. O backend exige `expectedStatus`, valida a próxima etapa e grava status, timestamps e histórico na mesma transação. A criação do pedido registra o evento inicial `SYSTEM`; ações temporárias da cozinha registram `OPERATOR`. O histórico dos pedidos existentes foi preenchido pela migration. As etapas por pizza, atribuição de montador, cronômetro do forno e fluxo de entrega permanecem para fases posteriores.
