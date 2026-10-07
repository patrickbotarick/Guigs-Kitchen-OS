# Guig's Kitchen OS — Rodada 1 UX/UI pós-piloto Android

Data: 07/10/2026. Base: `main`, `d119e44`. Escopo: A01, A02, A03, A07, A08, A09 e A10. Sem Fase 6, redesenho estrutural de Forno/Balcão, novas roles ou dependências. Sem push.

## 1–7. Correções realizadas

| Achado | Comportamento resultante |
| --- | --- |
| A01 — conferência física | Cada pizza no Despacho mostra número, sabores, tamanho, composição, borda e observação. Remoções vermelhas e adicionais roxos têm SVG e texto; em meio a meio, identificam a metade e seu sabor. O resumo usa o snapshot histórico, sem reconstrução pelo catálogo atual. Linhas compactas e botão de conferência preservado. |
| A02 — legado | A raiz abre Visão geral. Links operacionais usam as telas do fluxo v2. O painel antigo continua em `/compatibility`, com aviso explícito; formulário legado e demonstração permanecem acessíveis na seção fechada Compatibilidade / Dev em desenvolvimento. Endpoints e dados antigos foram preservados. |
| A03 — disponibilidade | Workstation persiste contexto e recebimento. Apenas Montagem/ASSEMBLY, com ASSEMBLER disponível e presente, entra na distribuição e nos destinos de recuperação. Forno/Finalização, Despacho e Visão geral/Supervisão iniciam sem recebimento. Nomes pessoais não definem regras. |
| A07 — toque | Disponibilidade, troca de montador, encerramento, atualização, links e confirmações da Montagem têm área mínima de 44×44 px. Recuperação usa campos de 48 px e botões comuns. Ícones pequenos, grade e densidade da referência preservados. |
| A08 — supervisor | Visão geral oferece identificação discreta e acesso contextual Recuperação para SUPERVISOR. O menu também oferece esse destino apenas para supervisor. ASSEMBLER recebe acesso restrito na rota direta. Recuperação usa superfícies, campos e botões compartilhados. |
| A09 — conclusão | A Montagem persistente não mostra o botão permanentemente desabilitado “Concluir montagem”. O rodapé informa quantas pizzas foram enviadas ao forno e o avanço automático por pizza. O fluxo continua Iniciar → montar → Enviar pro forno. Demonstração local preservada como compatibilidade. |
| A10 — navegação | `OperationalNavigation` define um único mapa, ordem e nomenclatura. Cada tela mostra seu nome no acionador Menu e destaca o link ativo com `aria-current="page"`. Ferramentas ficam separadas das áreas operacionais. |

## 8. Estrutura de navegação

| Área | Nome | Destino testado |
| --- | --- | --- |
| Cozinha | Visão geral | `/kitchen` |
| Cozinha | Montagem | `/kitchen/assembly` |
| Cozinha | Forno e Finalização | `/kitchen/finishing` |
| Balcão | Despacho | `/counter/dispatch` |
| Ferramentas | Simulador de Pedido | `/orders/new` |
| Ferramentas, SUPERVISOR | Recuperação | `/kitchen/assembly/recovery` |

Todos os links foram acionados no navegador e o destino e estado ativo foram conferidos. Nenhum link principal leva à fila legada `/orders`. Redirects existentes de Forno/Despacho continuam funcionando. O quadro de Visão geral mantém as quatro colunas aprovadas.

## 9–10. Referência e componentes compartilhados

`/kitchen/assembly` e `UI_VISUAL_STANDARDIZATION.md` foram auditados antes das alterações. Mantêm-se a estratégia tipográfica Inter/system-ui, fundo off-white, superfícies brancas, carvão, vermelho da marca, verde funcional, bordas suaves e raios 7/6/5 px. Não houve nova fonte, biblioteca ou paleta. Montagem preserva sua grade de três colunas, ingredientes, cards, seleção e fluxo; suas alterações específicas são menu, áreas de toque e remoção da ação obsoleta.

Reutilizados: `AssemblyIcon`, SVGs oficiais, tokens `--kui-*`, classes de botões/superfícies/estados e campos. O novo token `--kui-added` usa `#330e7d`, presente no SVG de adição da Montagem. Novos componentes pequenos: `OperationalNavigation`, `PhysicalPizzaSummary` e `OperatorSessionProvider`. As outras telas derivam dessa referência, com ajustes simples de cabeçalho, feedback e superfícies. Não foi criada nova arquitetura visual.

O shell agora acompanha `100dvh`. A Montagem conserva o scroll interno aprovado; demais telas conservam scroll do documento; o menu tem altura limitada e scroll próprio quando necessário. Não se oculta conteúdo para mascarar overflow.

## 11. Disponibilidade e persistência

| Posto testado | Contexto | Recebimento |
| --- | --- | --- |
| Montador 1 | ASSEMBLY | Sim |
| Montador 2 | ASSEMBLY | Sim |
| Finalizador | PRODUCTION | Não |
| Atendente | COUNTER | Não |
| Supervisor | SUPERVISION | Não |

A API aplica a regra inclusive se um posto não elegível tentar enviar `available: true`. O teste de distribuição com cinco contextos atribui dez pizzas somente aos dois postos de Montagem, cinco para cada um. A suspensão manual persiste após novo login na mesma workstation em Montagem. Trocar de contexto conserva sessão, chave do terminal, presença e reservas existentes; voltar de outro contexto para Montagem inicia recebimento habilitado.

As roles permanecem ASSEMBLER/SUPERVISOR. A migration aditiva `20261007040000_workstation_receiving` acrescenta `stationKind` e `receivingEnabled`. Clientes antigos que omitem contexto usam a workstation persistida; novas workstations sem contexto mantêm o padrão ASSEMBLY para compatibilidade. O provider central mantém heartbeat também durante navegação pela Visão geral.

Prisma foi regenerado e a migration aplicada ao banco local. Nenhum dado foi removido; `package-lock.json` está intacto. Outros ambientes precisam gerar Prisma e aplicar migrations antes de iniciar a API atualizada.

## 12. Validação funcional

| Verificação | Resultado |
| --- | --- |
| `npm run lint` | Aprovado |
| `npm run typecheck` | Aprovado |
| `npm test` | 274 testes únicos de API aprovados, considerando execução completa e repetições descritas abaixo |
| `npm run test:assembly` | 34 testes aprovados |
| `npm run test:oven` | 17 testes aprovados |
| `npm run test:finishing` | 14 testes aprovados |
| `npm run test:dispatch` | 10 testes aprovados |
| `npm run build` | API e web aprovados; bundle web aproximadamente 499 kB antes de gzip |
| `node scripts/operational-flow-browser-smoke.mjs` | Aprovado: produção, rotas, conferência, correções, entrega/retirada, versões concorrentes, resposta perdida/replay, offline/restart e carga com 30 pizzas e 30 pedidos |
| `npm run test:ux:round1` | Aprovado: cinco contextos, distribuição, receitas, navegação, supervisor/negação, toque, três resoluções desktop, contexto entre abas e suspensão/retomada após refresh |

Os primeiros testes de API tiveram timeouts de preparação do SQLite e de carga nesta máquina. A execução completa com um worker, `--hookTimeout=60000` e `--testTimeout=30000` terminou com 266 aprovados e oito falhas. A repetição de Forno/Fluxo operacional/Despacho, com `--testTimeout=60000`, aprovou 73 dos 74 casos; restou apenas a carga de 30 pedidos. A repetição isolada desse caso, com limite de 300 segundos, passou em aproximadamente 140 segundos. Assim, todos os 274 casos únicos foram verificados com sucesso; não se apresenta a execução inicial como se tivesse retornado exit code zero. Com os 75 testes de interface, são **349 testes únicos aprovados**.

A fixture do fluxo operacional agora renova heartbeat antes de cada cenário; a política de presença da aplicação não foi relaxada. Os limites dos testes de carga foram ampliados: Forno 20→60 segundos e Despacho 30→300 segundos, mantendo todas as operações e assertions. O smoke unificado espera identidade e conexão Online antes de simular offline, eliminando uma corrida de inicialização do teste.

Cenário físico criado pelo formulário real: Grande Calabresa, Requeijão, Sem cebola e + bacon; Grande Calabresa/Portuguesa com bacon apenas na segunda metade; Broto Mussarela. As três pizzas percorreram comandos reais de produção e uma rota fechada. O Balcão confirmou todos os detalhes; remoção `rgb(161,38,38)` e adição `rgb(51,14,125)` são distintas. Não houve erro JavaScript no cenário desktop.

## 13. Capturas e emulador

Capturas desktop de seis telas em 1024×768, 1280×800 e 1366×768 estão em `artifacts/ui-audit/round1/`; `validation.json` registra contextos, menu, cores, medidas e erros. As medições verificam largura do documento e áreas de botões, links e summaries. Capturas foram inspecionadas visualmente, incluindo estado vazio, receita no Balcão e formulário de recuperação.

- [Montagem com pedido](../artifacts/ui-audit/round1/montagem-com-pedido.png)
- [Balcão e três receitas](../artifacts/ui-audit/round1/balcao-1280x800.png)
- [Recuperação](../artifacts/ui-audit/round1/recuperacao-1024x768.png)
- [Forno e Finalização](../artifacts/ui-audit/round1/forno-1280x800.png)
- [Visão geral](../artifacts/ui-audit/round1/visao-geral-1280x800.png)
- [Simulador](../artifacts/ui-audit/round1/simulador-1280x800.png)

Conferência em **Android Emulator API 36, landscape 1280×800, Chrome Android**, com área web real **1280×648**. Um AVD novo descartável foi usado após o Chrome dos perfis retomados não responder antes da abertura do projeto. Os perfis e dados do piloto foram preservados. API e Vite usaram banco descartável e `adb reverse`, sem alteração permanente de URLs ou dados operacionais locais.

As seis telas foram capturadas e medidas no Android; largura do documento 1280 px e nenhum botão/link/summary visível abaixo de 44×44 px. O teclado PIN mediu 104×66 px por tecla. Supervisor entrou pelo PIN e acionou Recuperação por eventos reais de toque. O aviso de troca com pizza sob responsabilidade teve botão de 121,625×44 px. O cenário Android acrescentou um pedido descartável de duas pizzas e capturou Montagem com responsabilidade ativa.

Foi encontrado e corrigido scroll residual do menu da Montagem: o documento tinha 665 px na área de 648 px; após limitar o menu, sua borda inferior ficou em 632,844 px e o documento permaneceu com 648 px. Forno, Balcão e Simulador mantêm scroll normal, com alturas de 791, 1698 e 2456 px no cenário observado. A Visão geral chegou a 719 px por exibir três pizzas finalizadas; Recuperação coube em 648 px.

Algumas navegações encerraram a conexão CDP e precisaram de reconexão; não se atribuiu isso automaticamente à aplicação. Abas duplicadas do teste expuseram a necessidade de preservar o contexto da aba ativa: abas ocultas agora mantêm heartbeat sem trocar estação; foco restaura o contexto; disponibilidade explícita envia o contexto atual. Esse ajuste trata recebimento e não altera a chave da workstation. Como o Chromium headless informa todas as abas como visíveis e focadas, o caso automatizado de abas controla somente os eventos/estado de visibilidade; sessão, preferência e API permanecem reais.

- [Android — menu da Montagem](../artifacts/ui-audit/round1/android-menu-montagem.png)
- [Android — conferência física](../artifacts/ui-audit/round1/android-balcao.png)
- [Android — Recuperação do Supervisor](../artifacts/ui-audit/round1/android-recuperacao.png)
- [Android — aviso de troca](../artifacts/ui-audit/round1/android-montagem-dialogo.png)
- [Android — Simulador](../artifacts/ui-audit/round1/android-simulador.png)
- [Android — captura nativa com pedido](../artifacts/ui-audit/round1/android-final-state.png)

`android-validation.json` registra as medidas. O AVD descartável foi encerrado e removido para liberar espaço; os cinco perfis anteriores e todas as capturas foram preservados. As evidências ficam ignoradas pelo Git; o script versionado permite reproduzir o cenário em banco descartável. Não são baselines pixel a pixel.

## 14. Pendências para Rodada 2

- Redesenho específico de Forno/Finalização/Rotas: hierarquia e uso do espaço com carga, sem executar nesta rodada.
- Redesenho estrutural do Balcão: conferência/embalagem/saída em listas grandes ainda exigem scroll normal longo. Resumo físico compacto não resolve toda a estrutura.
- Investigar a workstation do Atendente após retomada do AVD. Não se assumiu bug da aplicação, não se alterou geração/armazenamento de chave do terminal e não se tentou corrigir a ocorrência.
- Validar em tablet físico, com fonte disponível, dedo, iluminação e rotina da loja. Emulador e geometria não substituem esse piloto.

Sem paginação, analytics, integração Saipos ou Fase 6. Commit solicitado: `fix: refine kitchen navigation and operational ux`. Sem push.
