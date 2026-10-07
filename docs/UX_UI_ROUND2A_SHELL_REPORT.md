# Guig's Kitchen OS — Rodada 2A: shell operacional

## Escopo

Rodada de frontend sobre `b3a8489`. Sem Fase 6, integração Saipos, migrations, mudanças de domínio ou alteração da geração/persistência da workstation key. Conteúdo interno de Forno/Rotas e Balcão preservado para a Rodada 2B.

## Shell e navegação

`OperationalHeader` compartilha logo existente, faixa escura, título central em caixa alta, identidade discreta e menu nas telas Visão Geral, Forno e Finalização, Balcão e Simulador. `StationIdentity` exibe nome do operador e um único indicador Online/Reconectando/Offline, usando os tokens existentes. O Simulador e a Visão Geral permitem consulta sem sessão; quando há sessão, exibem seu operador.

`OperationalNavigation` mantém o mapa único de destinos, Recuperação condicionada a supervisor e Compatibilidade/Dev recolhida. O acionador passou a `Nome da tela | Menu`, com `×` ao abrir. Saiu o ícone redundante. `OperationalPopover` fornece abertura por toque, fechamento pelo acionador, Escape e clique externo, retorno de foco no fechamento explícito e navegação por setas/Home/End. Links ativos mantêm `aria-current="page"`; controles expõem `aria-expanded`/`aria-controls`. Alvos mínimos de 44 px.

## Montagem

As três colunas e a linguagem visual foram preservadas. A identidade está no topo direito; a fila concentra filtro único, título, ordenação e cards. `OperationalFilter` substitui os três botões por um dropdown com Fila geral/Minhas pizzas/Disponíveis, estado selecionado acessível e fechamento ao selecionar.

A navegação fica no rodapé da lateral. O painel separa NAVEGAÇÃO de ESTAÇÃO DE MONTAGEM. Recebimento exibe Ativo/Pausado; Trocar montador e Encerrar turno mantêm as regras existentes, bloqueio por pizzas sob responsabilidade e opção Continuar montando. Essas ações usam as mesmas funções de sessão, sem alterar disponibilidade, assignment ou auditoria.

Saíram da fila o nome técnico do tablet, a identidade duplicada, os controles administrativos, o link avulso de Despacho, o rodapé Persistidos/Montagem/Dev e o botão Atualizar. A identificação por PIN também deixou de mostrar a chave do terminal, mantendo sua geração existente.

## Realtime e recovery

Os hooks existentes recebem `order.created`, `order.updated`, `kitchen.order.updated`, `kitchen.pizza.updated` e `dispatch.route.updated`. O evento da rota já reconcilia a leitura do Balcão; não foi necessário alterar a infraestrutura. O fallback existente de 30 segundos foi preservado; nenhum polling novo foi adicionado. O Simulador utiliza a mesma conexão operacional para informar seu status.

As telas principais deixaram de exibir Atualizar no fluxo normal. `Tentar novamente` aparece somente em erro de leitura. Confirmação de comando pendente, reconexão e recovery supervisionado permanecem. Componentes históricos de Forno/Finalização/Despacho fora do roteamento principal continuam como compatibilidade e não receberam redesign.

## Responsividade

Montagem usa 100dvh e scroll interno nas colunas. Visão Geral ocupa 100dvh e distribui scroll nas listas das quatro colunas. O header é sticky; listas longas de Forno/Balcão e o formulário do Simulador mantêm o scroll necessário do conteúdo. Menus têm altura limitada ao viewport; o menu inferior abre para cima.

## Validação

| Verificação | Resultado |
| --- | --- |
| `npm run lint` | Aprovado |
| `npm run typecheck` | Aprovado nos três workspaces |
| `npm test -- -- --maxWorkers=1 --no-file-parallelism --hookTimeout=60000 --testTimeout=60000` | 273/274 aprovados; um timeout no stress de 30 pizzas |
| Repetição isolada do stress de Forno | Aprovado em 23,022 s, mantendo o limite de 60 s e todas as asserções |
| `npm run test:assembly` | 34 aprovados |
| `npm run test:oven` | 17 aprovados |
| `npm run test:finishing` | 14 aprovados |
| `npm run test:dispatch` | 10 aprovados |
| `npm run build` | Aprovado; aviso de bundle 500,29 kB / gzip 149,98 kB |
| `npm run test:ux:round2a` | Aprovado: sessão, menus, filtros, bloqueios, geometria e os três destinos Dev/Compatibilidade |
| `npm run test:ui:browser` | Aprovado: fluxo completo, offline/reconexão/restart, resposta perdida/replay, Delivery/Pickup, 30 pizzas e 30 pedidos |

Os 274 testes distintos da API foram cobertos com aprovação entre a execução completa e a repetição isolada; somados aos 75 de frontend, são 349 testes distintos. Não houve alteração de testes de domínio ou de seus timeouts nesta rodada. A primeira execução concorreu com ambientes de navegador/AVD. Na preparação dos smokes, foram corrigidos seletores antigos de header/menu e esperas explícitas por sessão/foco. Uma execução visual sofreu reload de desenvolvimento durante edição; a validação final utiliza fontes estáveis.

O smoke específico inclui cinco sessões reais em banco descartável, elegibilidade `[true,true,false,false,false]`, contexto de aba ativa, recebimento persistido após reload, três filtros, liberação/claim de uma pizza disponível, bloqueios de troca/encerramento, Escape/foco/setas/Home/End/clique externo, `aria-current`, nome real do operador, um único status e ausência de UUID/nome técnico/Atualizar na UI principal. A entrada da rota fechada no Balcão tem limite de 5 segundos; o fluxo não clica em Atualizar.

Foram aprovadas 24 verificações de geometria: cinco telas principais e Recuperação em 1024×768, 1280×800, 1280×648 e 1366×768. Nenhum overflow horizontal ou alvo visível abaixo de 44×44 px; Visão Geral e Montagem sem scroll residual. Menus das telas principais foram inspecionados abertos e fechados em cada tamanho.

O smoke completo confirmou criar pedido → Montagem automática → envio ao forno → entrada automática em Forno/Finalização → finalização individual → fechamento de rota → Balcão automático, sem Atualizar. Também aprovou rota parcial/reabertura/move/remove, conferência/correções, Delivery/Pickup, conflitos, resposta perdida/replay após reload contextual, redirects, offline/reconexão/restart, 30 pizzas e 30 pedidos. Suas capturas finais estão em `C:/Users/Usuario/AppData/Local/Temp/guigs-flow-v2-validation/`.

## Android Emulator e capturas

API 36, landscape 1280×800, Chrome Android, viewport web real 1280×648. AVD novo descartável, sem retomar/modificar os cinco perfis do piloto. API/Vite com banco descartável e `adb reverse`; nenhum pedido de teste foi escrito no banco operacional local. O AVD foi encerrado e removido ao concluir, preservando capturas e perfis originais.

Eventos reais de toque via CDP validaram menu, PIN, criação de pedido, dropdown, navegação, recebimento Ativo/Pausado, encerramento sem pendências e bloqueio de troca/encerramento com pizzas sob responsabilidade. Teclas PIN mediram 104×66 px. Todas as telas medidas tinham documento de 1280 px de largura, um único status e nenhum alvo visível menor que 44×44 px. Visão Geral/Montagem/menu mantiveram documento de 648 px; Forno, Balcão e Simulador mantiveram scroll de conteúdo necessário (758, 1618 e 2480 px no cenário). Menu da Montagem: x=8, y=22, largura=300, altura=568, dentro do viewport. O painel rola internamente quando há destinos extras de supervisor. Houve substituição de alvo CDP e reconexão; não foi atribuída automaticamente à aplicação.

Capturas e medições locais ficam em `artifacts/ui-audit/round2a/` (artefatos ignorados pelo Git). `validation.json` e `android-validation.json` guardam os resultados.

- [Visão Geral Android](../artifacts/ui-audit/round2a/android-visao-geral.png)
- [Montagem — montador](../artifacts/ui-audit/round2a/android-montagem-montador.png)
- [Menu inferior — montador](../artifacts/ui-audit/round2a/android-menu-montagem-montador.png)
- [Forno Android](../artifacts/ui-audit/round2a/android-forno.png)
- [Balcão Android](../artifacts/ui-audit/round2a/android-balcao.png)
- [Simulador Android](../artifacts/ui-audit/round2a/android-simulador.png)
- [Bloqueio de troca no Android](../artifacts/ui-audit/round2a/android-aviso-troca.png)
- [Captura nativa do Balcão](../artifacts/ui-audit/round2a/android-balcao-native.png)

## Regressões e limites

Identidade técnica permanece no backend/auditoria. Recuperação teve apenas o nome/status do cabeçalho padronizado; a identificação dos destinos de supervisor continua disponível. Componentes históricos fora das rotas operacionais principais mantêm seus controles de desenvolvimento. `package-lock.json` e dependências não mudaram; não é necessário npm install nesta rodada. Não foi feito push.

## Rodada 2B

Permanecem o redesenho estrutural das filas/rotas no Forno, organização de listas longas e conferência no Balcão. A troca de workstation após retomada do AVD do Atendente permanece investigação isolada. O build emite aviso de bundle ligeiramente acima de 500 kB; não impede a compilação e não houve alteração de dependências nesta rodada.
