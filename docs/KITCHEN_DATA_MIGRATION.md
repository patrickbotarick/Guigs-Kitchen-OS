# Kitchen — fechamento da montagem e integração de dados

Data: 05/10/2026. Base analisada: commit `f2c5051`, mais os ajustes locais da Fase 2C.

As seções 1–9 registram o diagnóstico e a proposta da Fase 2C. A seção 10 distingue o que foi implementado na Fase 3A das capacidades ainda futuras. A montagem continua em memória, sem comandos de API por pizza.

## 1. Estado atual por camada

| Conceito | Balcão: Dashboard/NewOrder | packages/shared e API | Prisma/SQLite | Assembly e catálogo |
| --- | --- | --- | --- | --- |
| Pedido | Entrada manual de teste; cliente, telefone, Delivery/Retirada, observação | CreateOrderInput/OrderView; ID cuid, número, datas; Zod strict; eventos order.created/order.updated | Order, contador transacional OrderCounter, histórico OrderStatusHistory | AssemblyOrder; ID demo-order-N, numeração a partir de 1001; cliente, receivedAt, canal, pizzas e extraCount |
| Pizza/item | Formulário dinâmico com nome, tamanho e ingredientes livres | Cada item tem name, size, ingredients, notes e modifiers; 1–30 itens | OrderItem genérico, sem discriminador de tipo | PizzaItem com kind=PIZZA; IDs locais; composição por referências |
| Sabor | Texto livre, datalist com quatro sugestões fixas | name não é uma FK e não é validado contra catálogo | CatalogFlavor só id/name; seed de quatro sabores; sem vínculo com OrderItem | flavorId em cada PizzaHalf; catálogo estático de 60 sabores, categorias, receitas, preços, revisão e fonte |
| Tamanho | Pequena, Média, Grande | String livre validada por comprimento | OrderItem.size String; CatalogSize sem vínculo; seed de três nomes | PizzaSize BROTO/GRANDE; Broto 4 fatias, Grande 8; regras estruturadas |
| Meio a meio | Não há campos estruturados; possível apenas texto | Sem composição, metades ou validação de Broto | Sem modelo de metade | WHOLE/ HALF_HALF; firstHalf e secondHalf; estado único para a pizza |
| Borda | Campo de texto | ModifierKind.CRUST e name, no nível do item | OrderItemModifier genérico | crustId único por pizza; cinco bordas recheadas + tradicional |
| Modificadores | Removidos/adicionais separados por vírgula | REMOVED/ADDED/CRUST por nome; máximo 30 por item | Sem ingredientId, escopo de metade ou quantidade | REMOVE/ADD com ingredientId por metade; REMOVE deve pertencer à receita; ADD ao catálogo de adicionais; duplicatas rejeitadas |
| Observação | Geral e por item | Strings até 1000 caracteres | Order.notes e OrderItem.notes | Só observação por pizza; AssemblyOrder não projeta a observação geral |
| Extras | Sem campos estruturados | Sem ExtraItem | Sem categoria de item/extra | extraCount inteiro 0–30; não identifica bebidas/complementos nem cria tarefas |
| Status do pedido | Dashboard mostra aguardando/API/realtime; Kitchen tem botões temporários | WAITING_PRODUCTION → IN_PRODUCTION → OVEN → FINISHING → WAITING_DISPATCH | Status/timestamps/histórico gravados juntos | Estágio calculado pela montagem; OVEN significa fila do forno; handoff local remove pedido da fila |
| Status da pizza | Sem comandos individuais | ItemStatus WAITING/IN_PRODUCTION/OVEN/FINISHED/CANCELLED; API não transiciona itens | Campos de estado/tempo existem, mas transição do pedido não os atualiza | Fase 2C: WAITING_ASSEMBLY/ASSEMBLING/WAITING_OVEN, paused boolean; sem timestamps operacionais/histórico persistido |
| Pessoas/estação | Sem identificação operacional | ActorType para histórico, ações como OPERATOR sem identidade autenticada | Worker no seed, sem relação de atribuição ao pedido/item; Order.assignedAt isolado | Sem assignedTo, claim, estação ou lock |

Fontes: `apps/web/src/pages/{Dashboard,NewOrder,Kitchen}.tsx`, `packages/shared/src/index.ts`, `apps/api/src/{app,orders}.ts`, `apps/api/prisma/{schema.prisma,seed.ts}`, `apps/web/src/features/kitchen/{types,assembly,mockOrders,pizzaRecipe,catalog}.ts`, `CATALOG.md` e README.

## 2. Divergências que impedem integração direta

1. `OrderView.items` não pode ser convertido com segurança para PizzaItem: name/ingredients/size não identificam receita, composição ou metades.
2. Pequena/Média não têm equivalência autorizada com BROTO. Grande é candidata a GRANDE, mas o backfill exige validação dos dados reais; não converter por aproximação.
3. Um nome contendo barra não prova meio a meio. Não dividir texto automaticamente nem duplicar estados por metade.
4. Bordas são modificadores livres no legado; no Assembly são uma referência obrigatória única. Múltiplos CRUST legados precisam de revisão.
5. REMOVE/ADD por nome não determinam ingredientId nem metade. “Sem cebola” em pizza meio a meio é ambíguo.
6. Catupiry do seed/exemplos legados não existe no catálogo oficial; não converter silenciosamente para requeijão.
7. O seed do banco não é a fonte das receitas da montagem. CatalogFlavor/CatalogSize não contêm receitas/preços/revisões nem estão ligados ao item.
8. Tipo de atendimento e canal foram misturados: DELIVERY/PICKUP é atendimento; IFOOD/WHATSAPP/COUNTER é origem. Retirada no simulador não identifica origem.
9. extraCount não permite recuperar nome, quantidade por produto, observação ou conferência dos extras. Não fabricar ExtraItems a partir dele.
10. O status do pedido não comprova estado da pizza. Hoje um pedido pode estar OVEN e seus OrderItems ainda WAITING; timestamps do pedido não autorizam backfill de tempos por pizza.
11. Pausas, progresso, IDs e transferências da montagem são locais e independentes por aba. Um evento assembly.completed não registra entrada física no forno, cozimento ou conclusão do pedido.
12. História operacional só existe por pedido. Os campos individuais do schema não equivalem a uma máquina de estados implementada.
13. Observação geral/telefone/tipo do OrderView não estão todos na projeção AssemblyOrder. Adaptador futuro deve preservar o contrato completo e selecionar somente os dados relevantes à tela.

## 3. Ajustes efetivos da Fase 2C

Antes, a pizza enviada ao forno recebia `OVEN`, card “Concluída”, contador “Pizzas concluídas”, comando COMPLETE_ORDER e handoff com destino FINISHING. Isso confundia fim da montagem com cozimento/finalização.

Agora a pizza fica WAITING_OVEN; o card diz “Aguardando forno”, o contador “Montagens concluídas”, a ação “Concluir montagem”/COMPLETE_ASSEMBLY e o destino do handoff é OVEN. A timeline diz “Fila do forno”. O evento permanece `assembly.completed`, explicitamente restrito à montagem. Não há indicação de pizza assada. `orderStatus: OVEN` é uma projeção de fila, não o estado individual.

A captura em 1024×768 revelou quebra dentro da palavra “Portuguesa” após introduzir o rótulo mais explícito. A base flexível do título foi ajustada para permitir que o badge passe à linha seguinte; cores, componentes e estrutura permanecem iguais. O teste de navegador agora verifica também palavras de sabores quebradas. Nenhuma outra falha funcional foi reproduzida nos cenários executados.

Pausa permanece boolean nesta demonstração; a Fase 3 deverá representar ASSEMBLY_PAUSED e suas datas/histórico. Não há persistência nova ou tela de forno nesta entrega.

O lockfile preexistente muda apenas 15 campos peer e remove 14 campos libc: versões, pacotes e dependências permanecem iguais. Classificação: variação ambiental de metadados compatível com instalação/regravação pelo npm, sem necessidade funcional para Fase 2C. A causa exata não é demonstrável apenas pelo diff. Foi preservado; não deve ser incluído automaticamente em um commit da fase. Uma eventual restauração deve ser decisão separada após revisão do proprietário.

## 4. Contrato alvo recomendado (proposta v2)

Fonte do contrato: packages/shared, independente de React e Prisma; schemas de entrada e comando com validação em runtime. Prisma é a representação persistente, não o contrato público. API é autoridade de IDs, estado, datas, versões e agregação; cliente não envia status arbitrário.

```ts
type ID = string;
type Instant = string; // ISO-8601 UTC no transporte; DateTime no banco
type PizzaSize = 'BROTO' | 'GRANDE';
type PizzaComposition = 'WHOLE' | 'HALF_HALF';
type FulfillmentType = 'DELIVERY' | 'PICKUP';
type OrderChannel = 'COUNTER' | 'WHATSAPP' | 'IFOOD' | 'OTHER';
type PizzaProductionState =
  | 'WAITING_ASSEMBLY' | 'ASSEMBLING' | 'ASSEMBLY_PAUSED'
  | 'WAITING_OVEN' | 'IN_OVEN' | 'BAKED'
  | 'FINISHING' | 'FINISHED' | 'CANCELLED';
type ProductionOrderStatus =
  | 'WAITING_PRODUCTION' | 'IN_PRODUCTION' | 'OVEN'
  | 'FINISHING' | 'WAITING_DISPATCH';
type OrderStatus = ProductionOrderStatus | 'WAITING_DRIVER'
  | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'READY_FOR_PICKUP'
  | 'PICKED_UP' | 'CANCELLED';

interface IngredientModifier {
  type: 'REMOVE' | 'ADD';
  ingredientId: ID;
  // Quantidades/gramagens dependem de ficha validada; não assumir.
}
interface PizzaHalf {
  flavorId: ID;
  modifiers: IngredientModifier[];
}
type PizzaRecipe =
  | { size: PizzaSize; composition: 'WHOLE'; firstHalf: PizzaHalf; secondHalf?: never }
  | { size: 'GRANDE'; composition: 'HALF_HALF'; firstHalf: PizzaHalf; secondHalf: PizzaHalf };
interface WorkAssignment {
  assignedTo: ID | null;
  claimedAt: Instant | null;
  workstationId: ID | null;
  leaseExpiresAt: Instant | null;
  claimToken: string | null; // somente ao titular autorizado
}
interface PizzaProduction {
  state: PizzaProductionState;
  version: number;
  assignment: WorkAssignment;
  queuedAt: Instant;
  assemblyStartedAt: Instant | null;
  pausedAt: Instant | null; // início da pausa atual; limpar ao retomar
  assemblyCompletedAt: Instant | null;
  ovenStartedAt: Instant | null;
  ovenExpectedEndAt: Instant | null;
  bakedAt: Instant | null;
  finishingStartedAt: Instant | null;
  finishedAt: Instant | null;
  cancelledAt: Instant | null;
}
interface OrderItemBase {
  id: ID;
  orderId: ID;
  position: number;
  notes: string | null;
}
type PizzaItem = OrderItemBase & PizzaRecipe & {
  kind: 'PIZZA';
  crustId: ID; // uma borda para a pizza inteira
  catalogRevisionId: ID;
  recipeSnapshotId: ID; // referência a retrato imutável validado no servidor
  production: PizzaProduction;
};
interface ExtraItem extends OrderItemBase {
  kind: 'EXTRA';
  extraCatalogId: ID;
  catalogRevisionId: ID;
  quantity: number; // inteiro positivo
  state: 'WAITING_FINISHING' | 'FINISHED' | 'CANCELLED';
  checkedQuantity: number; // 0..quantity
  checkedAt: Instant | null;
  checkedBy: ID | null;
  version: number;
}
type OrderItem = PizzaItem | ExtraItem;
interface Order {
  id: ID;
  number: number;
  customerName: string;
  customerPhone: string | null;
  fulfillmentType: FulfillmentType;
  channel: OrderChannel;
  notes: string | null;
  receivedAt: Instant;
  createdAt: Instant;
  updatedAt: Instant;
  version: number;
  status: OrderStatus;
  items: OrderItem[];
  packingFinishedAt: Instant | null;
  packingFinishedBy: ID | null;
}
interface PizzaFlavor {
  id: ID; revisionId: ID; name: string;
  category: 'TRADICIONAL' | 'ESPECIAL' | 'PREMIUM' | 'DOCE';
  ingredientIds: ID[];
  sourceRecipe: string;
  pricesInCents: Record<PizzaSize, number>;
  active: boolean;
}
interface PizzaCrust {
  id: ID; revisionId: ID; name: string;
  priceInCents: number | null;
  active: boolean;
}
interface PizzaProductionHistoryEntry {
  id: ID; pizzaId: ID;
  eventType: 'CREATED' | 'TRANSITION' | 'CLAIMED' | 'RELEASED' | 'REASSIGNED';
  fromState: PizzaProductionState | null;
  toState: PizzaProductionState;
  changedAt: Instant;
  actorType: 'SYSTEM' | 'WORKER' | 'OPERATOR' | 'ADMIN' | 'INTEGRATION';
  actorId: ID | null;
  workstationId: ID | null;
  commandId: ID;
  itemVersion: number;
  reason: string | null;
}
```

### Invariantes e persistência futura

- Uma PizzaItem representa uma unidade física; duas pizzas iguais continuam com IDs/estados distintos. Uma pizza meio a meio é um item com duas metades, não dois itens de produção.
- WHOLE tem exatamente firstHalf; HALF_HALF exige GRANDE e duas metades. A validação de runtime deve rejeitar payloads incompatíveis mesmo fora da UI.
- IngredientModifier pertence à metade; borda pertence à pizza. Validar referências, duplicatas, remoções da receita e adicionais permitidos no servidor.
- PizzaSize/PizzaComposition são códigos estáveis; no catálogo, conservar rótulos e regras de tamanhos. PizzaFlavor/PizzaCrust/Ingredient e catálogo de extras usam IDs estáveis, revisões e active; desativar sem apagar referências históricas. Favoritas são referências aos mesmos sabores.
- O retrato imutável registra nomes/receitas, modificadores resolvidos e borda no momento da criação. Nunca recalcular um pedido antigo com a receita atual. Catálogo por ID é a identidade; snapshot é a evidência histórica, validada pelo servidor.
- Extras são itens identificáveis (bebida, complemento etc.), nunca ingredientes de pizza. O contador da montagem é projeção da soma das quantidades dos extras ativos, não fonte de verdade. Catálogo de extras ainda precisa ser definido.
- Preços permanecem fora das projeções operacionais da cozinha. Null da borda tradicional não significa zero; política financeira não faz parte desta fase.
- Preservar limites atuais de 1–30 pizzas e 0–30 unidades de extras nos novos comandos até decisão explícita de produto; manter limites de texto. Não generalizar silenciosamente o limite legado de 30 itens para pizzas + extras.
- Proposta relacional aditiva: OrderItem com kind/position; dados específicos em PizzaItem ou ExtraItem; PizzaHalf com posição/escopo e FK de sabor; modificador ligado à metade; FK de borda no PizzaItem; histórico e atribuição/versionamento individuais. Não usar JSON sem validação como atalho para todo o domínio. IDs demo não devem ser importados como pedidos reais.
- Entrada de criação não contém estado, versão, snapshots confiáveis ou datas operacionais do cliente. A API gera esses campos; commandId permite idempotência de criação e transição. Payloads v1 continuam tratados pelo caminho legado durante a transição.

## 5. Máquina persistente da pizza proposta

BAKED já significa assada aguardando finalização. Não criar também WAITING_FINISHING para a pizza: ambos representariam a mesma espera. FINISHING distingue o trabalho do finalizador. Extras podem usar WAITING_FINISHING porque não passam pelo forno.

| Origem | Destino | Quem pode executar | Datas/efeitos no servidor |
| --- | --- | --- | --- |
| Criação | WAITING_ASSEMBLY | Sistema, após validação da entrada | queuedAt, história inicial |
| WAITING_ASSEMBLY | ASSEMBLING | Montador titular do claim | assemblyStartedAt somente na primeira entrada |
| ASSEMBLING | ASSEMBLY_PAUSED | Montador titular | pausedAt, evento de pausa |
| ASSEMBLY_PAUSED | ASSEMBLING | Montador titular (ou novo titular após reatribuição autorizada) | registrar retomada, limpar pausedAt |
| ASSEMBLING | WAITING_OVEN | Montador titular | assemblyCompletedAt; liberar posse de montagem; nenhuma data de forno |
| WAITING_OVEN | IN_OVEN | Operador de forno autorizado | ovenStartedAt; ovenExpectedEndAt apenas com duração configurada/validada |
| IN_OVEN | BAKED | Operador de forno autorizado | bakedAt; previsão/timer não prova cozimento |
| BAKED | FINISHING | Finalizador autorizado que assumiu a tarefa | finishingStartedAt |
| FINISHING | FINISHED | Finalizador titular | finishedAt; ainda depende da conferência de extras/embalagem do pedido |
| Qualquer não terminal | CANCELLED | Operador/admin com permissão e motivo | cancelledAt, liberar atribuição, auditoria; tratar unidade física já produzida |

FINISHED e CANCELLED são terminais nesta proposta. Não há saltos, retomada de pizza já enviada, reabertura automática ou cancelamento silencioso. Refação será outro comando explícito e nova unidade física vinculada à original; definir política antes de implementar.

“Enviar pro forno” corresponde a WAITING_OVEN. Só o operador do forno confirma entrada física IN_OVEN. `assembly.completed` nunca equivale a `pizza.baked`, `pizza.finished` ou `order.completed`. A liberação do pedido da fila de montagem é derivada de todas as pizzas terem superado a montagem; não deve bloquear a entrada de uma pizza já pronta no forno enquanto as demais estão sendo montadas.

Histórico append-only registra cada transição e claim com ator, estação, commandId e versão. Datas vêm do servidor. Pausas repetidas precisam de eventos/intervalos para calcular duração acumulada; pausedAt isolado só descreve a pausa atual. Reatribuição não reinicia assemblyStartedAt. Escrever item, histórico, versão e agregação do pedido na mesma transação; publicar Socket.IO após commit.

Os papéis acima são requisitos futuros de autorização no servidor. CORS, rótulo OPERATOR e um workerId enviado pelo tablet não autenticam um usuário. Não presumir autenticação existente.

## 6. Agregação do pedido

Calcular no servidor sobre pizzas ativas (excluir CANCELLED), extras ativos e embalagem. O status individual não reutiliza OrderStatus. A versão/status agregado do pedido muda na mesma transação dos comandos. Ordem das regras:

1. Se todos os itens foram cancelados, status CANCELLED. Pedido sem itens é inválido; nunca concluir por `every([])`.
2. Após despacho/retirada, conservar a máquina logística do pedido; não recalcular para produção a cada leitura. Cancelamento logístico precisa de política própria.
3. Havendo pizzas ativas e todas WAITING_ASSEMBLY: WAITING_PRODUCTION.
4. Havendo qualquer pizza WAITING_ASSEMBLY, ASSEMBLING ou ASSEMBLY_PAUSED, mas não sendo todas WAITING_ASSEMBLY: IN_PRODUCTION. Pausa não elimina o pedido da produção.
5. Sem pizza na montagem e havendo qualquer WAITING_OVEN ou IN_OVEN: OVEN. Esse agregado cobre fila e cozimento; a UI deve mostrar contagens separadas de aguardando forno/em forno/assadas.
6. Todas as pizzas ativas em BAKED/FINISHING/FINISHED: FINISHING enquanto faltar pizza FINISHED, extra conferido integralmente ou embalagem confirmada. Todas as pizzas FINISHED com extras pendentes continuam FINISHING.
7. Todas as pizzas FINISHED, todos os extras ativos FINISHED com checkedQuantity=quantity e embalagem confirmada: WAITING_DISPATCH. Ser “montagem concluída” nunca satisfaz essa condição.

Pedidos apenas de extras são uma extensão futura explícita: entrar em FINISHING e exigir conferência/embalagem, sem etapas de montagem/forno. O contrato legado e o simulador atuais continuam exigindo pizzas. Não liberar essa modalidade sem testar o fluxo de entrada.

| Pizzas ativas | Extras/embalagem | Agregado |
| --- | --- | --- |
| WAITING_ASSEMBLY, WAITING_ASSEMBLY | qualquer | WAITING_PRODUCTION |
| WAITING_OVEN, ASSEMBLING, WAITING_ASSEMBLY | qualquer | IN_PRODUCTION |
| WAITING_OVEN, ASSEMBLY_PAUSED | qualquer | IN_PRODUCTION |
| IN_OVEN, WAITING_OVEN, FINISHED | qualquer | OVEN |
| BAKED, FINISHING | pendentes | FINISHING |
| FINISHED, FINISHED | extras/embalagem pendentes | FINISHING |
| FINISHED, FINISHED | conferidos e embalagem confirmada | WAITING_DISPATCH |

Regra geral: o estágio mais atrasado das pizzas ativas governa a produção; extras/embalagem governam a liberação para despacho. Para DELIVERY/PICKUP, as transições logísticas futuras divergem após WAITING_DISPATCH. Comandos antigos que avançam pedido inteiro não podem coexistir como autoridade sobre pedidos v2; impedir essa rota para v2 e preservar funcionamento de v1 durante a migração.

## 7. Concorrência entre tablets

- `assignedTo`, `claimedAt`, `workstationId`, `leaseExpiresAt` e token de posse pertencem à tarefa/pizza; `pausedAt` pertence à produção. Registrar transferência/liberação em histórico. Pedido pode ter uma reserva opcional se a operação exigir um único montador por pedido; isso não substitui proteção do item.
- Claim atômico: atualizar somente se tarefa elegível e sem posse ativa. Renovação exige o mesmo titular/token. Reatribuição após expiração ou por supervisor deve ser auditada e incrementar version; não apagar progresso nem retomar uma pizza pausada automaticamente.
- Todo comando inclui pizzaId, expectedState, expectedVersion, commandId e token de posse quando aplicável. O servidor obtém o ator autenticado e valida a estação; nenhum desses campos permite ao cliente escolher o ator arbitrariamente.
- Compare-and-swap na transação: condição de ID + versão + estado + posse válida; somente uma atualização pode vencer. Zero linhas: HTTP 409, carregar o estado atual, sem novo histórico. Aplicar também a claim/pausa/liberação, não só mudança de estado.
- `commandId` tem unicidade por escopo e payload armazenado: repetir o mesmo comando retorna o resultado original; mesma chave com payload diferente é conflito. Desconexão após commit não pode duplicar a transição/handoff.
- Socket.IO informa item/order ID e versões após commit, sem token de posse. Ignorar eventos antigos e recarregar por API ao abrir/reconectar; eventos não são fonte exclusiva de consistência.
- Não manter fila offline de comandos operacionais nesta primeira integração. Sem conexão, bloquear alterações e mostrar reconexão. Ao retornar, recarregar estado/claim antes de permitir comandos.
- SQLite continuará tendo um único serviço API como autoridade. Não compartilhar arquivo do banco entre tablets ou abrir vários escritores de aplicação sem estratégia. Transações curtas e tratamento de conflitos/busy precisam de testes.

## 8. Migração segura e sequência da Fase 3

1. Introduzir contrato v2 e schemas em packages/shared, regras puras de transição/agregação e seus testes; manter v1. Definir papéis, catálogo de extras e política de atribuição com a operação.
2. Fazer backup consistente do SQLite, testar restauração e inventariar pedidos/itens legados. Produzir relatório de mapeamento: exato, ambíguo ou não suportado. Não modificar dados durante o inventário.
3. Criar migrations aditivas com discriminador/revisão de contrato, tabelas de metades/modificadores, catálogo versionado/snapshots, estado/histórico/claim por pizza e extras. Preservar campos e histórico antigos; ensaiar numa cópia do banco.
4. Criar novos pedidos v2 pelo balcão e persistir por IDs. Adaptador de leitura conserva o painel existente. Pedidos v1 ficam no fluxo legado até revisão individual; evitar dual-write sem transação e monitoramento. Não lançar dados ambíguos na montagem.
5. Implementar somente montagem persistente: claim, START/PAUSE/RESUME/SEND_TO_OVEN, concorrência, idempotência, histórico, agregação e Socket.IO. Substituir mocks por adaptador da API; manter Dev em contexto de demonstração separado. WAITING_OVEN é o limite desta entrega.
6. Testar dois tablets, troca rápida, comandos repetidos, versões antigas, reconexão, reinício, rollback e fila de 30 pizzas. Validar legado e painel sem regressões, antes de habilitar na loja.
7. Em ciclos separados, implementar entrada/saída do forno e depois finalização de pizzas/extras/embalagem. Só então liberar despacho/retirada e o fluxo completo. Estoque e canais externos permanecem fora desta fase.

Não remover o contrato v1 nem colunas antigas até reconciliação dos dados, período de convivência validado e plano de reversão testado. Reverter frontend/feature flag não é downgrade de banco: planejar compatibilidade de versões e preservar pedidos v2 ao voltar uma versão.

### Riscos da migração

- Conversão incorreta de sabores/tamanhos/modificadores e perda de significado das metades; exige revisão, não heurística silenciosa.
- Inferir cozimento a partir de OVEN legado ou timestamps agregados inventa histórico. Marcar origem legada e preservar evidência sem fabricar eventos individuais.
- Receita/preço alterados retroativamente sem revisão/snapshot; referências apagadas; NULL tratado como gratuidade.
- Extras desconhecidos a partir de contador; nenhum dado permite reconstruir quais produtos foram pedidos.
- Duas autoridades (transição do pedido inteiro e item v2), idempotência incompleta, agregação atrasada ou evento publicado antes do commit.
- Retorno de tablet desconectado com posse vencida, reatribuição sem auditoria, tokens vazados e ausência de autorização real.
- Backup inconsistente com banco em uso, migração sem ensaio e rollback que perde dados novos.
- Métricas/estoque baseados em gramagens ou tempos não validados. Permanecem pendências do catálogo, inclusive Catupiry e regras de preços por link.

## 9. Validação da montagem

O roteiro cobre uma pizza, várias e 30; Broto/Grande/inteira/meio a meio; independência de modificadores, borda e observação; seleção sem mutação; iniciar/pausar/retomar/enviar; bloqueios; troca de pedidos/pizzas; ordenação; fila vazia e rejeição de pedido sem pizza. O navegador verifica os scrolls e ações em 1024×768, 1280×800 e 1152×645. Teste automatizado com viewport não substitui aceite de toque/legibilidade no tablet físico.

Comandos de aceite: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:assembly`, `npm run build` e `npm run test:assembly:browser` com frontend ativo. Os testes SQLite usam banco temporário separado; o teste de montagem não deve chamar a API. Não executar smoke que cria pedidos no banco da loja para validar somente esta etapa.

### Resultado desta execução

| Verificação | Resultado em 05/10/2026 |
| --- | --- |
| npm run lint | Passou |
| npm run typecheck | Passou nas três workspaces |
| npm test | 10 testes da API passaram, incluindo SQLite temporário/concorrência/rollback |
| npm run test:assembly | 16 testes passaram |
| npm run build | API e frontend passaram; repetido após ajuste CSS |
| npm run test:assembly:browser | Passou após ajuste; frontend temporário em 127.0.0.1:5179, sem API real |
| Captura de montagem concluída em 1024×768 | Inspecionada visualmente após correção de quebra do nome |

O frontend temporário foi encerrado. Não houve migration/seed, escrita no banco da loja, implementação de forno/finalização ou alteração funcional do balcão. Aceite em tablet físico, integração realtime por pizza e ensaio de migração continuam para ciclos posteriores.

## 10. Fase 3A — implementação efetiva

Fechamento da Fase 2C no commit `e5848f3` (`feat: finalize kitchen assembly domain and integration plan`), sem package-lock.json, segredos ou bancos. Alterações da Fase 3A são separadas desse commit.

### Contratos e domínio

- `packages/shared/src/legacy.ts` mantém os contratos v1 anteriores. `index.ts` reexporta v1 e v2 sem mudar os imports públicos existentes.
- `kitchen.ts` implementa PizzaSize, PizzaComposition, PizzaFlavorReference, IngredientModifier, PizzaHalf, PizzaCrust, PizzaDraft/PizzaRecipe, PizzaItem, ExtraItem, OrderItem, Order v2, snapshot, estado/timestamps e schemas Zod strict. IDs de catálogo permanecem referências explícitas. Entrada de comando/criação HTTP v2 ainda não foi implementada.
- `canTransitionPizza` centraliza a matriz das nove situações da pizza. O reducer local consulta esse helper, mantendo sua projeção com paused boolean e seus mocks; não foi conectado ao backend. Tipos de tamanho/composição/metade/modificador passam a ser reutilizados no frontend.
- `deriveOrderProductionState` implementa as regras da seção 6, exclui cancelados e exige extras/embalagem para despacho. Pedido vazio é erro; suporte puro a agregação de extras isolados não libera a criação dessa modalidade (Order v2 ainda exige 1–30 pizzas). Não chamar o helper para sobrescrever estados logísticos; `isLogisticsOrderStatus` permite identificá-los.
- Timestamps são ISO UTC no transporte. Marcos já percorridos devem existir e estar em ordem; pausa exige pausedAt atual. Ainda não há serviço de comandos que grave/recalcule essas datas.
- Ajuste justificado da proposta: campos de composição ficam em `PizzaItem.recipe`, e observação em `PizzaItem.notes`, evitando colisões com produção/identidade e duplicação de notes. Snapshot é embutido na pizza nesta fundação, em vez de uma tabela/ID de snapshot separada: isso permite persistência atômica da evidência histórica sem introduzir gerenciamento de versões de snapshot reutilizado.

### Snapshot

`createRecipeSnapshot` resolve sabor, ingredientes removidos/adicionados e borda a partir de catálogo confiável com revisão. Faz cópia independente dos dados. Preserva nomes, composição, tamanho, modificadores por metade, ingredientes relevantes e borda, inclusive preço null. `recipeSnapshotSchema` e `pizzaItemSchema` validam cardinalidade/consistência. A leitura não depende de consultar o catálogo atual.

Snapshot confiável deve ser construído no servidor ao criar o pedido na Fase 3B. O schema não prova que texto recebido de um cliente é a receita oficial. API de criação não deve aceitar snapshot/estado/version arbitrários. Imutabilidade após criação será regra do serviço: não existe endpoint de edição de snapshot nesta fase. Mudanças no cardápio não podem alterar snapshots armazenados.

### Banco e migration

Migration: `apps/api/prisma/migrations/20261005180000_structured_kitchen/migration.sql`.

- Adiciona a Order: schemaVersion (default 1), structuredChannel (nullable), version (default 0) e packingFinishedBy (nullable). Atendimento permanece em Order.type. Todos os pedidos existentes continuam v1.
- Cria PizzaItem, PizzaHalf, PizzaIngredientModifier, ExtraItem e PizzaProductionHistory, ligados ao pedido existente. Nenhuma tabela/coluna legada removida ou reconstruída; nenhum backfill inferido.
- PizzaItem contém tamanho/composição/borda/revisão, snapshot JSON validado, observação, estado, versão e timestamps. PizzaHalf armazena flavorId e posição 1/2; modificadores têm ingredientId e escopo de metade. ExtraItem armazena ID/revisão/nome histórico, quantidade e conferência.
- Novos vínculos usam ON DELETE RESTRICT para proteger evidências estruturadas. Unicidade por pizza/metade/modificador e índices de fila/histórico. CHECKs SQL protegem Broto/composição, posições de metade e quantidades; os CHECKs devem ser mantidos em futuras migrations, pois não são declarados no schema Prisma. Cardinalidade completa das metades, unicidade de posição entre PizzaItem e ExtraItem e pertencimento ao catálogo exigem validação transacional de serviço, não são garantidos só por FKs.
- Flavor/crust/ingredient IDs referenciam o catálogo estruturado, sem FK para CatalogFlavor legado. Não foi importado o catálogo para tabelas novas nesta fase. A criação futura terá que validar essas referências com catálogo/revisão confiáveis.
- Histórico individual preparado, mas nenhuma linha criada para pizzas antigas. Claims/leases/locks não foram implementados. Campos de ator/estação no histórico não equivalem a autenticação.

O diff automático do Prisma propunha reconstruir Order. A migration final substitui essa operação por quatro ALTER TABLE ADD COLUMN e apenas CREATE TABLE/INDEX. Foi ensaiada em SQLite temporário contendo pedido, item, modificador, contador e histórico legados antes da aplicação.

A API em execução foi encerrada com autorização do usuário para liberar a DLL Prisma no Windows. Backup consistente criado via SQLite backup API em `apps/api/prisma/backup-phase3a-before-20261005T174023Z.db` (ignorado pelo Git). Migration aplicada ao dev.db local sem seed. A comparação integral das colunas preexistentes de oito tabelas legadas passou, com integrity_check/foreign_key_check OK e nenhuma pizza/história individual inferida.

### Leitura compatível e proteção do legado

`readOrderData` retorna envelope discriminado `{ schemaVersion, legacy, order }`. Sem versão ou versão 1: valida e preserva o texto legado, sem converter tamanhos/nomes ou inventar histórico. Versão 2: exige estrutura/snapshot válidos. Versão desconhecida ou v2 inválido é erro, nunca fallback silencioso.

`apps/api/src/kitchen-data.ts` implementa `loadCompatibleOrder` para leitura interna persistida v1/v2. Os endpoints públicos continuam v1: lista/detalhe/histórico não expõem v2 como legado; comando de transição do pedido inteiro rejeita v2. Não há endpoint de criação v2, eventos por pizza ou integração do Assembly nesta fase.

### Rollback operacional

1. Parar API/frontend antes de trocar cliente/código/banco. Fazer novo backup consistente do estado atual, mesmo que pretenda retornar à versão anterior.
2. Para rollback de código com dados novos: manter schema aditivo; nunca apagar tabelas/colunas ou desativar FKs. Voltar a leitura legacy apenas não elimina os registros v2. Validar a compatibilidade do Prisma Client e das queries da versão que será executada.
3. Restaurar o backup pré-migration apenas se não houve nenhuma escrita posterior que precise ser preservada, ou após exportação/reconciliação dessas escritas. Restaurar também metadados de migration do mesmo backup, com serviços parados. Não copiar o banco para trás enquanto WAL/conexões estão ativos.
4. Esta migration não tem down destrutivo. Nunca editar sua SQL depois de aplicada. Migrações corretivas devem ser novas, aditivas. O backup contém dados da loja e deve permanecer fora do Git.

### Testes e limite da entrega

Novos testes em `kitchen-domain.test.ts` e `kitchen-data.integration.test.ts`: matriz de estados/transições, Broto/Grande/metades, escopo de modificadores/borda, snapshot independente, extras/conferência, versões e leitura legacy/v2, agregação, migration preservando dados, round-trip Prisma, FK/CHECK e proteção contra transição v1 de pedido v2. A suíte anterior de integração aplica também a migration nova em seu banco temporário.

Fase 3B ainda precisa: catálogo confiável/revisão estável (incluindo extras), serviço transacional de criação v2 com contador/histórico inicial/snapshot e idempotência, payload/endpoint versionado e formulário estruturado do balcão. Validar limites/cross-table positions/cardinalidade na transação e nunca confiar em status/snapshot do navegador. Claims e comandos por pizza, Socket.IO por item e troca dos mocks serão entregas posteriores.

### Aceite final da Fase 3A

Lint, typecheck das três workspaces e build API/frontend passaram. `npm test`: 34 testes passaram (10 anteriores + 18 de domínio + 6 de persistência/compatibilidade). `npm run test:assembly`: 16 passaram. O teste de navegador da montagem também passou após reutilizar tipos/regras compartilhados. `prisma migrate diff` não detecta diferença entre migrations e schema; `migrate status` confirma banco atualizado.

A API foi retomada após a migration 3A e a leitura HTTP foi verificada sem criar pedidos reais. A Fase 3A foi posteriormente fechada no commit local `5b472b4`, após repetir as validações, preservando o lockfile ambiental fora do commit. Nenhum push foi executado.

## 11. Fase 3B implementada

A criação estruturada, catálogo compartilhado, idempotência transacional, snapshot/histórico inicial, formulário v2 e leitura HTTP explícita foram implementados. Estado e payload dessa etapa, nova migration aditiva, convivência v1/v2, validações e riscos estão em [PHASE_3B_STRUCTURED_CREATION.md](PHASE_3B_STRUCTURED_CREATION.md). A montagem em memória descrita nesse documento corresponde ao fechamento original da 3B.

## 12. Roadmap técnico atualizado após 3D.2A

- Concluído: criação v2/catalog/snapshot e compatibilidade v1 (3B); leitura persistida Assembly (3C.1); comandos individuais transacionais/CAS/idempotência/histórico (3C.2); realtime versionado e recuperação (3D.1).
- Atual: identidade operacional/terminal/sessão (3D.2A), comandos autenticados e vínculos de autoria históricos. Modelo, migration, configuração e limites em [PHASE_3D2A_OPERATOR_IDENTITY.md](PHASE_3D2A_OPERATOR_IDENTITY.md). Sem conversão retroativa de SYSTEM ou Worker legado.
- Próximo: 3D.2B define responsabilidade/claim explícitos, validade e liberação, com auditoria/versões. Campos futuros possíveis apenas documentados: assignedOperatorId, assignedWorkstationId, assignedAt, claimExpiresAt e assignmentVersion. Não são estados de produção nem estão ativados.
- Depois: distribuição automática só após claims e disponibilidade confiáveis, com carga por pizzas/complexidade e critério auditável; validar múltiplos tablets, quedas, concorrência e carga real.
- Fases próprias posteriores: forno operacional e finalização/embalagem/despacho; estoque/ficha técnica e métricas/administração. Não foram iniciadas nesta entrega.
