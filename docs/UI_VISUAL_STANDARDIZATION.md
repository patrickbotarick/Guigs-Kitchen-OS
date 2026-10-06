# Padrão visual do Guig's Kitchen OS

**Atualização do fluxo em 06/10/2026:** os tokens e a Montagem abaixo continuam como referência. O quadro `/kitchen` foi simplificado para quatro colunas; Forno e Finalização usam uma única estação em `/kitchen/finishing`; rotas/conferência/embalagem/despacho pertencem a `/counter/dispatch`. Os detalhes de antigas telas abaixo são registro histórico. `test:ui:browser` agora executa `operational-flow-browser-smoke.mjs`, com fluxo persistente, redirects e capturas em 1024×768, 1280×800 e 1366×768 no diretório temporário `guigs-flow-v2-validation`. Ver [contrato vigente](KITCHEN_OPERATION_FLOW_V2.md).

Referência oficial: **`/kitchen/assembly`**, auditada no código e no navegador em 06/10/2026. A Montagem permanece intacta. Esta rodada aproxima Balcão/Fila, Forno, Finalização e Despacho da referência, sem alterar domínio ou iniciar a Fase 6.

## Auditoria da Montagem

| Elemento | Padrão observado e regra para as demais telas |
| --- | --- |
| Fonte | Inter, system-ui, -apple-system, Segoe UI, sans-serif; fonte efetiva depende da disponibilidade local, sem download adicional. |
| Fundo / superfícies | Off-white `#f4f3f1`, painéis brancos, texto `#141416`, secundário `#66636a`. |
| Borda / raio | Linha `#e6e5e7`, painéis 7 px, cards 6 px, botões 5 px. |
| Sombras | Discretas e usadas para seleção; `0 4px 8px #1714191c`, sem sombra pesada em todos os cards. |
| Espaçamento | Base 8 px, padding de cards aproximadamente 8–12 px; manter densidade operacional. |
| Hierarquia | Pedido/título principal 27–40 px, seção 19–25 px, card 16–19 px, body 14 px, labels/secundário 11–13 px. Letras ligeiramente compactas nos títulos. |
| Seleção | Borda vermelha da marca, fundo `#fff5f6`; texto normal. Não selecionados usam texto neutro, sem opacidade global ou aparência desabilitada. |
| Chips | Neutros arredondados, status curto legível; a cor complementa o texto. Cores de canal existentes não são redefinidas. |
| Botões | Ação principal com 55 px; navegação/filtros com mínimo 44 px; radius 5 px, peso 700, feedback touch e foco visível. |
| Ícones | SVGs existentes em `apps/web/src/assets/kitchen/icons`, por `AssemblyIcon`. Masks preservam currentColor; SVGs multicoloridos mantêm arte oficial. Sem emoji. |
| Conexão / identidade | Texto de operador e terminal, indicador Online/Reconectando/Offline; mesma escala secundária e cores semânticas. |
| Scroll | A Montagem conserva suas colunas e áreas de scroll existentes. Demais estações usam scroll vertical do documento, sem adicionar scroll aninhado. |
| Loading / erro / vazio | Mensagem explícita, neutro para carga/vazio, vermelho suave para erro; superfícies e raios consistentes. Comportamento de recuperação preservado. |

## Tokens e classes compartilhados

`apps/web/src/operational-ui.css` reúne os tokens `--kui-*` e os estilos comuns. Carregado após os estilos existentes no entrypoint, aplica aliases de `--color-*` e `--radius-*` **somente em `.oven-page` e `.page`**. Não redefine as cores/radii da `.ka-screen` nem muda o stylesheet de Montagem. `--color-brand-primary` permanece o vermelho já existente `#ab2933`.

Tokens: background/surface/text/muted/line/selected/neutral; success `#19653c`, success-soft `#effaf3`, warning `#976018`, danger `#a12626`; panel/card/button-radius; gap e selected-shadow. Usam cores já presentes na referência, sem nova paleta independente.

Classes existentes compartilhadas: `.oven-header`, `.oven-header-actions`, `.oven-connection-*`, `.oven-toolbar`, `.oven-alert`, `.oven-notice`, `.oven-empty`, `.button` e suas variantes. `.finishing-order`, `.finishing-columns`, `.finishing-detail` e `.finishing-release` continuam compartilhadas entre Finalização e Despacho. `AssemblyIcon` também passa a aparecer nos títulos das estações e nos modificadores da Fila, substituindo o emoji legado.

Não foi criado um novo componente de cabeçalho: as diferenças de links, ações e condições de cada estação permanecem no JSX original; a apresentação comum fica nas classes, evitando refatorar callbacks/autorização.

## Botões e estados

- Primário: vermelho da marca, texto branco. Ações de início/conclusão verdes da Montagem permanecem como referência específica, sem redesenhá-las.
- Secundário: branco e borda neutra; discreto: texto de marca e borda leve. Confirmação de correção usa `.button.danger`, vermelho escuro existente, separada da ação de cancelar por 12 px.
- Desabilitado: opacidade .55 e cursor not-allowed nas telas padronizadas; mantém todas as condições funcionais existentes. Loading preserva texto e bloqueio atuais, sem animação que possa sugerir sucesso.
- Aguardando: branco/neutro; ativo: vermelho suave/borda existente; pausado: texto de alerta quando esse estado já existe; conferido: verde suave e rótulo explícito. Cancelado mantém o rótulo funcional existente.
- Erro/offline: vermelho; reconexão: neutro com texto; mensagens de resultado/conflito usam painel neutro, pois o contrato atual não fornece severidade tipada. Não inferir severidade pelo conteúdo textual.
- Corrigido não é um novo estado persistente. Diálogo de confirmação e mensagens existentes diferenciam a correção; o item retorna à aparência de seu estado confirmado pelo servidor. Não inventar badge histórico sem dados fornecidos pelo contrato.
- Selecionado usa borda/fundo e `aria-pressed` existentes; hover somente em dispositivos que o suportam. Foco roxo `#461588` preserva a referência da Montagem.

## Ajustes por área

**Forno:** painéis Aguardando/No forno com títulos na escala da referência; cards/padding compactos, tamanho em chip neutro, números e timers tabulares. No forno usa superfície ativa suave; estados NEAR/REACHED/OVER preservam os cálculos e acrescentam somente as bordas/cores já usadas para alerta. Ocupação permanece textual e Forno cheio é destacado. Nenhuma alteração de tempo/capacidade.

**Finalização:** fila compacta, seleção vermelha e detalhe em superfície branca; cabeçalho do pedido e itens na mesma hierarquia de Montagem. `data-state` no JSX apenas expõe o estado existente ao CSS. Em conferência usa destaque suave; conferidos usam verde; correções ficam discretas e separadas. Embalagem/liberação preservam bloqueios e comandos.

**Despacho:** reutiliza fila e detalhe da Finalização, filtros compactos com seleção explícita, chip de status neutro e tempos tabulares. Delivery/Retirada, timestamps e próxima ação continuam iguais.

**Balcão/Fila:** navegação carvão preservada, cards compactos sem sombra pesada, chips e numeração alinhados à referência, SVGs existentes nos modificadores. Formulário v2 mantém campos, helpers, catálogo e fluxo; apenas superfícies, espaçamento e botões são padronizados. Home e formulário legado recebem as mesmas classes globais de apresentação da recepção.

## Responsividade e scroll

Validado em **1024×768 e 1280×800**, sem overflow horizontal. Cabeçalhos das três estações permanecem visíveis durante scroll do documento; em telas abaixo de 700 px voltam ao fluxo natural para não consumir toda a área útil. Não foi inserido scroll interno em filas dessas estações. A Montagem mantém seu próprio layout e comportamento original.

Grid usa `minmax(0, …)` e cards refluem sem largura mínima que exceda o viewport. Navegação do Balcão permite quebra de linha. Ações principais têm 55 px; filtros/navegação mínimo 44 px, inputs preservam 48 px. O documento pode ultrapassar a altura do tablet: ações abaixo da dobra são acessíveis por scroll normal.

## Validação e limites

`npm run test:ui:browser` usa API/Vite e SQLite descartáveis, fixtures de operador, criação e comandos reais para alcançar os estados de cada estação. Captura Montagem/Forno/Finalização/Despacho/Fila/formulário v2 nas duas resoluções, verifica overflow, alvos touch e cabeçalho no scroll. Capturas ficam no diretório temporário `guigs-ui-visual-validation`, fora do Git; não são baseline pixel a pixel.

Suites existentes preservadas: lint/typecheck/build; API 247, Assembly 34, Forno 17, Finalização 14, Despacho 10 — 322 testes. Smoke tests de Montagem/demo, Forno, Finalização/correções e Despacho cobrem ponta a ponta, conflitos, reconexão, resposta perdida, refresh e filas de 30. Capturas são inspecionadas visualmente; testes de geometria não substituem piloto físico.

Resultados finais de 06/10/2026: todas as validações acima aprovadas, incluindo `test:ui:browser`. O smoke existente de criação v2 também passou (metades/modificadores/borda/Broto/extras, duas abas, histórico, conflito e replay após resposta perdida). Como a porta 3333 estava ocupada, seu código foi executado sem alteração de arquivo, adaptando somente as portas em memória para API 3359/Vite 5189; a API da loja não foi encerrada. Nenhuma regressão funcional identificada. Uma importação não utilizada no novo smoke visual foi retirada após o lint; a verificação geométrica considera páginas com e sem scroll.

Revisão isolada de apresentação: nenhum endpoint, hook de dados, contrato, migration, comando, estado, timer, Socket.IO, concorrência, distribuição ou permissão alterado. Sem novas dependências; lockfile intacto. Fase 6 não iniciada e push não executado.

Pendências: validar em tablets físicos/fonte disponível/iluminação da loja; a Montagem mantém o cabeçalho distribuído na fila, enquanto as outras estações usam cabeçalho horizontal — identidade e feedback comuns, sem redesenhar a referência. Severidade tipada para mensagens e indicador histórico específico de correção exigiriam mudança de contrato e ficam fora desta rodada. Aviso de bundle >500kB e pendências funcionais anteriores, incluindo endereço de Delivery, permanecem.

## Arquivos desta rodada

- `apps/web/src/operational-ui.css`, `main.tsx` e `pages/Kitchen.tsx`.
- `apps/web/src/features/oven/OvenPage.tsx` e `oven.css`.
- `apps/web/src/features/finishing/FinishingPage.tsx`, `CorrectionDialog.tsx` e `finishing.css`.
- `apps/web/src/features/dispatch/DispatchPage.tsx` e `dispatch.css`.
- `scripts/ui-visual-browser-smoke.mjs`, `package.json`, `README.md` e este documento.

Commit único previsto: `style: standardize kitchen operational interfaces`, sem push. Assembly, API, Prisma, banco e contratos compartilhados permanecem sem diff nesta rodada.
