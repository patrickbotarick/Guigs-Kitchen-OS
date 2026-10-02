# Catálogo da montagem — fonte de verdade

Fonte: **Cardapio Guig's Vertical 2026.pdf**, quatro páginas, fornecido pelo usuário. SHA-256: `533f14a1719bd4cd79866879a64e049374c1f0f6a0d98db5acfe8f1dbcb9d04d`.

O PDF prevalece sobre mocks antigos, dados legados e conhecimento culinário geral. Nunca acrescentar ingredientes por suposição. Alterações futuras devem indicar a nova fonte ou uma exceção validada explicitamente. Pontos ausentes, repetidos ou ambíguos são preservados e registrados em `catalogReviews`, com `status: needs_review`.

As quatro páginas foram renderizadas e conferidas visualmente. A extração textual perde alguns acentos por causa das fontes do documento; eles foram lidos nas imagens. Uma comparação independente também conferiu os 60 nomes e as receitas completas contra o texto extraído, mantendo a ordem de ingredientes das categorias principais. As colunas de preços foram conferidas visualmente, inclusive nos doces.

## Estrutura

| Conteúdo | Quantidade | Origem |
| --- | --- | --- |
| Tradicionais | 21 | Página 1 |
| Especiais | 20 | Página 2 |
| Premium | 9 | Página 3 |
| Doces | 10 | Página 4 |
| Favoritas | 5 referências, sem sabores novos | Página 3 |
| Ingredientes | 50 IDs normalizados | Receitas das quatro páginas |
| Adicionais | 12 referências a ingredientes | Página 4 |
| Bordas recheadas | 5 | Página 4 |
| Tradicional / sem recheio | 1 opção, preço não informado | Solicitação explícita do usuário |

`catalog.ts` guarda sabores, categorias, `sourceRecipe`, IDs de ingredientes, número da página/posição, preços em centavos, bordas, adicionais, regras impressas e pendências. IDs removem acentos apenas para identificação; os nomes mantêm a grafia do PDF, apresentados com caixa de título nos sabores. Expressões como “carne em tiras”, “cobertura de leite ninho” e “biscoito negresco triturado” são preservadas, sem inferir cortes, marcas, quantidades ou sub-receitas.

Exemplos de preservação: Calabresa, Palmito com Requeijão e Vegetariana não recebem mussarela extra; Salmão Cream Cheese e Temaki não recebem azeitona/orégano por padrão; doces não recebem molho de tomate, mussarela ou outros ingredientes não listados.

O tamanho interno `GRANDE` corresponde ao **Tradicional (8 fatias)** impresso, conforme nomenclatura solicitada. Permite inteira ou duas metades. `BROTO` corresponde a **Broto (4 fatias)** e só aceita sabor único. A opção de borda sem recheio tem origem explícita `USER_VALIDATED`; não foi atribuída ao PDF.

`PizzaDraft`/`PizzaItem` guardam referências: tamanho, composição, `firstHalf`, `secondHalf` apenas quando aplicável, `crustId`, observação e estado. Cada metade tem `flavorId` e modificadores `{ type: REMOVE | ADD, ingredientId }`. A resolução combina a receita do catálogo com alterações daquela metade, mantendo as remoções visíveis. A borda pertence à pizza inteira. Trocar o sabor no simulador limpa os modificadores daquela metade; mudar para Broto descarta a segunda metade. Nenhuma dessas ações configura status separados por metade.

Adicionais permitidos: cebola roxa, ovo, pimenta, cebola, milho, alho frito, palmito, cheddar, requeijão, cream cheese, bacon e mussarela. Bordas recheadas: requeijão, cheddar, cream cheese, chocolate branco e chocolate ao leite.

O pedido mantém apenas `extraCount` para contexto. Extras não viram ingredientes, cards ou tarefas do montador. Preços não são renderizados na montagem nem no simulador. Não existe cálculo de venda nesta etapa.

## Revisão manual pendente

1. **`featured-reprints`**: Favoritas repete cinco sabores. Portuguesa Especial troca a ordem de ovo/cebola; Quatro Queijos Premium muda a posição do bacon. Os conjuntos de ingredientes e preços coincidem. A receita operacional segue a categoria principal; `favoriteReprints` preserva a redação da seção Favoritas e referencia o mesmo sabor. Confirmar se a ordem impressa teria algum significado operacional.
2. **`catupiry-not-listed`**: Catupiry foi citado como exemplo no pedido de desenvolvimento, mas não aparece no PDF. Não foi cadastrado nem convertido em requeijão. Validar explicitamente caso deva ser uma exceção.
3. **`technical-quantities`**: o cardápio não informa gramagens, composição interna dos molhos/coberturas, tempos de forno nem quantidades de adicionais por tamanho/metade. Não houve preenchimento dessas lacunas.
4. **`link-channel-pricing`**: o PDF informa maior preço para meio a meio e média para pedidos pelo link. Ambas as frases estão preservadas. O vínculo entre “link” e os canais mockados não foi definido; não há cálculo financeiro.
5. **`traditional-crust-price`**: a opção tradicional/sem recheio foi solicitada pelo usuário, mas seu preço não consta no PDF. Está como `null`, sem assumir custo zero.

Estas pendências também são visíveis no painel de desenvolvimento, fora da interface do montador.

## Ícones

`AssemblyIcons.tsx` importa os 14 SVGs fornecidos em `src/assets/kitchen/icons`. Os arquivos originais permanecem intactos. Ícones monocromáticos usam máscara CSS com `currentColor`; check circular, remover e adicionar preservam suas cores oficiais em imagens SVG isoladas. Isso evita colisões entre IDs/classes do Illustrator. Como não há SVG de pausa fornecido, o botão usa o texto **Pausar**, sem criar outro desenho nem usar Unicode como ícone.

## Escopo desta evolução

Criados: `catalog.ts`, `pizzaRecipe.ts`, `components/PizzaBuilder.tsx` e este documento.

Atualizados no módulo: `types.ts`, `mockOrders.ts`, `assembly.ts`, `assembly.test.ts`, `assembly.css`, `components/AssemblyIcons.tsx`, `components/OrderQueue.tsx`, `components/CurrentOrder.tsx`, `components/PizzaDetail.tsx`, `pages/KitchenAssemblyPage.tsx` e `pages/KitchenSimulatorPage.tsx`. Também atualizados `scripts/assembly-browser-smoke.mjs` e `README.md`.

Rotas e contexto React da implementação anterior foram reutilizados. Painel do balcão, API, Prisma, tipos compartilhados e dados legados não foram alterados. O catálogo novo não lê os sabores do seed antigo da API. Integração real continua pendente; a demonstração permanece local e reinicia ao recarregar ou sair do módulo.
