# Central Operacional da Cozinha

**Documento histórico, substituído em 06/10/2026.** A interface de supervisão abaixo foi retirada. `/kitchen` agora é um quadro de quatro colunas por pizza; o contrato vigente e as responsabilidades estão em [KITCHEN_OPERATION_FLOW_V2.md](KITCHEN_OPERATION_FLOW_V2.md). Não há novos dashboards ou filtros administrativos nesta tela.

`/kitchen` é a visão de supervisão da operação. Ela lê os pedidos estruturados de `GET /orders/v2`, a presença operacional de `GET /operators/overview` e os eventos Socket.IO já usados pelos módulos. A cada evento e a cada 30 segundos há nova leitura no servidor; reconexão e atualização manual preservam a mesma fonte persistida.

## Escopo

A Central é somente leitura. Os comandos continuam nos módulos `/kitchen/assembly`, `/kitchen/oven`, `/kitchen/finishing` e `/kitchen/dispatch`. A tela consolida pizzas, extras, responsáveis, presença, filas do forno, conferência da finalização e despacho sem criar regras novas de negócio.

Os filtros são Todos, Montagem, Forno, Finalização e Despacho. Cada pedido mostra o status agregado, progresso e detalhes por pizza, incluindo tamanho, composição, estado, responsável e observações. Pedidos sem dados e filas vazias possuem estados explícitos.

## Indicadores

Os contadores de montagem, forno e finalização são derivados dos estados persistidos de cada pizza. A carga do operador usa as atribuições ativas já retornadas pelos pedidos. Presença e disponibilidade vêm das sessões operacionais vigentes. Forno e despacho reutilizam os mesmos estados e timestamps dos módulos próprios.

## Limites conhecidos

Esta tela não executa comandos, não atribui pizzas, não altera presença, não cria histórico paralelo e não implementa analytics históricos. Capacidade e timers detalhados permanecem no módulo de forno. A API de operadores é uma projeção de leitura, sem migração de banco. A validação de piloto físico e endereço estruturado de Delivery permanecem pendências do produto.
