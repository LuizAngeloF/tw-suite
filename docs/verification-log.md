# Log de verificação

Registro do que já foi confirmado ao vivo contra o jogo real vs. o que ainda é suposição baseada em pesquisa de projetos open-source de terceiros. Todo item "UNVERIFIED" também está marcado como tal em `constants` no `tw-suite.user.js`.

Como confirmar um item: instalar o build atual, logar normalmente no `tribalwars.com.br`, abrir a tela relevante, e ou (a) deixar o Claude inspecionar a página ao vivo via navegador (sem tocar em login/senha), ou (b) colar no DevTools um trecho que o Claude preparar e devolver o resultado.

## Fase 0 — Núcleo

| Item | Uso no código | Status | Observação |
|---|---|---|---|
| `#menu_row2` / `#menu_row` | Entrada de menu nativa (`ui.injectMenuEntry`) | **VERIFIED** (2026-09-19, Opera GX) | Um dos dois existe — o link "TW Suite" foi injetado com sucesso na barra ao lado do nome da aldeia, sem quebrar o layout. Não sabemos ainda qual dos dois matched exatamente (não crítico, os dois convivem bem). |
| `window.game_data` | Leitura de aldeia/mundo/tela (`gameApi.getGameData`) | **VERIFIED** (2026-09-19, Opera GX, v0.1.1) | Painel mostrou "game_data: NÃO encontrado" no primeiro teste. Causa: sandbox do Tampermonkey — `window.game_data` do script não é o `game_data` da página. Corrigido lendo via `unsafeWindow.game_data`. Reteste confirmou "game_data: encontrado". |
| `game_data.time_generated` | Cálculo do offset de servidor (`serverTime.computeOffsetFromGameData`) | **VERIFIED** (2026-09-19) | Offset calculado em 1254ms no reteste (não mais 0ms) — campo existe e tem o formato esperado. |
| `window.TribalWars` (API nativa `.get`/`.post`) | Ainda não usado na Fase 0 — reservado para Fase 1/2 | UNVERIFIED | Vem da pesquisa em `thevtm/Tribal-Wars-Farm-Assistant-Plus`; provavelmente também precisa de `unsafeWindow.TribalWars` pelo mesmo motivo do sandbox. Confirmar antes de usar em módulo de automação real. |

## Fase 1 — Auto Farm

**Mudança de abordagem (2026-09-19):** o Assistente de Saque nativo (`am_farm`) é feature premium neste mundo — confirmado ao vivo (clicar no ícone `#manager_icon_farm` redirecionou para `screen=premium&mode=help&feature=FarmAssistent`). Descartada a ideia de clicar nos botões desse widget. Nova abordagem: ler `/map/village.txt` (arquivo público do mundo) pra achar aldeias bárbaras, e enviar pela Praça de Reunião (`screen=place`) preenchendo o formulário real.

| Item | Uso no código | Status | Observação |
|---|---|---|---|
| `GET /map/village.txt` (mesma origem, sem login) | `getVillageIndex` | **VERIFIED** (2026-09-19, via curl direto) | HTTP 200, ~3.3MB, 69301 linhas, formato `id,nome,x,y,dono,pontos,rank`. `dono=0` confirmado como aldeia bárbara (linha de exemplo: `4,Aldeia+de+bárbaros,553,473,0,233,0`). |
| `game_data.player.id`, `game_data.village.{id,x,y}` | Identificar aldeia/jogador atual (`findTargets`) | **VERIFIED** (2026-09-19, Opera GX) | Dump ao vivo da tela `place` confirmou os campos e formato exatos. |
| `#inputx` / `#inputy` (coordenada alvo), `#unit_input_<tropa>` com `data-all-count` | Ler disponibilidade de tropa antes de enviar | **VERIFIED** (2026-09-19, Opera GX) | Inputs de texto simples com `data-all-count` mostrando o disponível, confirmados no dump do formulário real. |

### Histórico: tentativas de simular clique (abandonadas na v0.4.0)

Entre v0.3.0 e v0.3.4 o módulo tentou automatizar o envio **simulando interação na UI real** — preencher `#inputx`/`#inputy`, clicar `#target_attack` ("Ataque"), esperar a tela de confirmação, clicar `#troop_confirm_submit` ("Enviar ataque"). Registro do que foi tentado, pra quem for mexer nisso de novo no futuro:

1. `.click()` simples no botão de confirmação — não funcionou, botão continuava na tela.
2. Suspeita de corrida (botão "achado" antes de estar pronto) — corrigido esperando visibilidade + reconsulta antes de clicar (v0.3.1). Não resolveu.
3. Suspeita de clique sem coordenadas reais — trocado por mousedown/mouseup/click com coordenadas do centro do botão (v0.3.3). Não resolveu.
4. Suspeita de que o botão não estava dentro de um `<form>` de verdade — trocado por `form.requestSubmit()` (v0.4.0-tentativa). Não resolveu.
5. **Causa raiz encontrada via HAR do Chrome DevTools (2026-09-19), capturando um envio genuíno feito manualmente**: as duas etapas (`screen=place&try=confirm` e `screen=place&action=command`) são **submissões de formulário reais** (`_resourceType: "document"`, POST com reload de página completo) — não AJAX, não SPA. Nenhuma das tentativas de simular clique conseguia disparar essa navegação real, por motivo não totalmente esclarecido (user activation do navegador expirando durante as esperas assíncronas é a hipótese mais provável, mas não foi isolada com certeza).

**Decisão**: abandonar simulação de clique pra essa etapa. Ver seção seguinte.

### Abordagem final (v0.4.0): replicar as requisições via `fetch()`

Com o HAR completo (exportado com filtro "All", não só "Fetch/XHR" — o filtro anterior escondia as navegações de documento) foi possível capturar o payload **exato** das duas requisições de um envio real e bem-sucedido:

**Etapa 1** — `POST game.php?village=80995&screen=place&try=confirm`:
```
b54d938573939eca8eea70=99832682b54d93   (campo escondido de nome ALEATÓRIO — token anti-fraude)
template_id=
source_village=80995
spear=1  sword=  axe=  archer=  spy=  light=  marcher=  heavy=  ram=  catapult=  knight=  snob=
x=703  y=566  target_type=coord  input=
attack=Ataque
```

**Etapa 2** — `POST game.php?village=80995&screen=place&action=command` (campos vindos da RESPOSTA da etapa 1):
```
attack=true
ch=2f06dec35d8a4e30872ab4c878211191:be79c4575ae063d77161d16607b1a0c0a407fb20bff7a9a691cd80eff5b9e873
cb=troop_confirm_submit
x=703  y=566  source_village=80995  village=80995
spear=1  sword=0  axe=0  ... (todas as tropas, 0 pras não usadas — não vazio como na etapa 1)
building=main
submit_confirm=Enviar+ataque
h=ffbbc10a
```

**VERIFIED** (2026-09-19) — payload real de um envio genuíno bem-sucedido, capturado via HAR. Implementado em `submitAttackStep1`/`submitAttackStep2`/`submitAttack`: os campos são lidos ao vivo do formulário real da página (etapa 1) e da resposta HTML da etapa 1 (etapa 2, via `DOMParser`) — nunca fixos no código, pra não quebrar se os tokens/nomes mudarem. `autoConfirm` como toggle separado foi removido: como o envio agora é determinístico (POST direto, não depende de clique funcionar ou não), a única opção relevante continua sendo `dryRun`.

**Teste ao vivo do v0.4.0 (2026-09-19): falhou, causa identificada.** As duas requisições saíram (confirmado via HAR: ambas HTTP 200), mas a etapa 2 (`action=command`) retornou **200 em vez de 302** — comparando com um envio manual bem-sucedido feito logo em seguida (que retornou 302, redirecionamento = sucesso), a diferença era o campo **`h`** (token anti-CSRF), presente no envio manual e **ausente** no nosso payload.

Causa: `submitAttackStep2` monta o corpo da requisição a partir do HTML estático devolvido pela etapa 1, parseado via `DOMParser` — que **não executa `<script>`**. O campo `h` não é um `<input>` oculto no HTML; é inserido pelo próprio JavaScript do jogo na hora do envio de verdade, então nunca aparece no HTML puro.

**Corrigido em v0.4.1**: confirmado ao vivo que `h` é simplesmente `game_data.csrf` (`Object.keys(game_data)` incluía `csrf`, e o valor batia exatamente com o `h` capturado no envio manual: `ffbbc10a`). `submitAttack`/`submitAttackStep2` agora recebem esse valor como parâmetro (lido de `gameApi.getGameData().csrf` no momento do clique) e o incluem explicitamente no corpo da etapa 2.

**RETESTADO E FUNCIONANDO (2026-09-19, v0.4.1).** Envio real confirmado pelo usuário — ataque saiu de verdade, sem clicar em nada na UI do jogo. **Fase 1 (Auto Farm) considerada 100% concluída e verificada ponta a ponta**: descoberta de alvo via `/map/village.txt` → montagem e envio da etapa 1 (`try=confirm`) → extração de `game_data.csrf` → envio da etapa 2 (`action=command`) → ataque despachado de verdade, tudo via `fetch()`, sem depender de nenhum clique simulado.

### v0.5.0 — Modelos de tropas (múltiplas unidades por envio)

Pedido do usuário: em vez de escolher 1 tropa + 1 quantidade, poder montar modelos nomeados com quantidade por tropa (todas as 12), igual à tela nativa "Modelos de tropas" do jogo (`screen=place&mode=units`, referência visual mandada pelo usuário).

`submitAttackStep1`/`submitAttackStep2`/`submitAttack` já eram genéricos o bastante (iteram `UNIT_FIELDS` e leem de um objeto) — só trocou a assinatura de `(unit, amount)` pra `(units)`, um objeto `{spear: N, sword: N, ...}`. Não precisou mexer no mecanismo de envio em si (mesmos dois POSTs, mesmo token `h`), só na camada de UI/dados acima.

Não depende de seletor novo do jogo — os modelos são uma estrutura nossa (`settings.templates`), sem relação com os "Modelos de tropas" nativos do jogo (que são uma feature separada, limitada a 2 sem premium).

**VERIFIED (2026-09-19)** — testado ao vivo pelo usuário: criar modelo, selecionar como ativo, enviar com múltiplas tropas de uma vez. Funcionando.

## Fase 5 — v1.2.0: módulos reescritos (2026-09-20)

Contexto: v0.6/v0.7/v1.0 tinham 6 módulos que só *fingiam* agir — procuravam botões por texto (`textContent.includes('construir')`), clicavam DOM sem verificar se existia, ou (o Agendador) dependiam de a aba estar parada na tela exata de confirmação no segundo certo. Reescritos em `shared.js` (motor comum) + módulos próprios, usando o mesmo padrão que funcionou no Auto Farm: ler a página real via `fetch()`, extrair dados de estruturas que o próprio jogo já embute no HTML, e submeter via `ajaxaction=` (cabeçalho `TribalWars-Ajax: 1`) ou POST de formulário real — nunca clique simulado.

**Nenhum destes foi testado contra o jogo ao vivo ainda** — só logicamente contra a documentação/código de projetos abertos citados (GPL-3 `stefan2200/TWB`, consultado só como referência de endpoints, nada de código copiado; MIT `victorgare/tribalwars`, mesma coisa). Marcar cada item como VERIFIED aqui assim que for confirmado.

| Módulo | Endpoint assumido | Status |
|---|---|---|
| Agendador | `place&try=confirm` + `place&action=command` (mesmos 2 POSTs do Auto Farm, já VERIFIED) — roda em `screens: ['any']` agora, não depende mais da aba estar na tela de confirmação | Envio em si VERIFIED (reusa `submitAttack`); a *independência de tela* e o cálculo de horário de chegada (duração lida da resposta da etapa 1) — UNVERIFIED |
| Recrutamento | `ajaxaction=train` no quartel/estábulo/oficina; `#<unidade>_0_cost_<recurso>` e `#<unidade>_0_a` pro custo/máximo | UNVERIFIED |
| Coleta / Coleta em Massa | `var village = {...}` na página `place&mode=scavenge` (opções bloqueadas/ocupadas); `ajaxaction=send_squads` em `scavenge_api`; divisão de tropas com pesos 15/6/3/2 | UNVERIFIED |
| Mega Construtor | `BuildingMain.buildings = {...}` (regex no HTML da tela principal); `ajaxaction=upgrade_building` | **VERIFIED (2026-09-20)** — usuário confirmou construção entrando na fila de verdade (`Bosque Nível 7`, com contagem regressiva e horário de conclusão reais). O parser de fila exibida (`readBuildQueue`, v1.4.0 — nome/nível/tempo restante por linha da tabela `#build_queue`) ainda é **UNVERIFIED**: extrai por texto, não por seletor fixo, mas o formato exato nunca foi conferido campo a campo. |
| Balanceador | Recursos/armazém lidos de `TribalWars.updateGameData(...)` embutido no HTML de `market&mode=send`; envio reusa o fluxo de mercado abaixo | UNVERIFIED |
| Envio de recursos (mercado) | `market&mode=send` → formulário de confirmação → 2º POST | UNVERIFIED |
| Status ao vivo (`live-status`, sempre ativo) | Tropas em casa: mesma leitura do Auto Farm (`#unit_input_<u>`, `data-all-count`) na Praça de Reunião. Ataques a caminho: tela `info_command&type=incomings` — **nome de tela e formato de tabela não confirmados**, pode simplesmente não achar nada (o snapshot não quebra se essa parte falhar) | UNVERIFIED |

**Como testar cada um com segurança**: todos nasceram com `dryRun: true` por padrão — ligam, mostram no console o que fariam, e não tocam em nada. Ative modo real um módulo por vez.

**Sincronização dashboard ↔ jogo**: perfis (`twsuite:profiles`) trocam via `postMessage` entre `dashboard.html` (aberto como `file://`) e o script rodando na aba do jogo. O Auto Farm agora relê a configuração a cada ~8s enquanto a página está aberta (`window.TWSuite.applyProfileNow` + comparação de `templates`/`activeTemplateId`) — os outros módulos econômicos releem a configuração a cada ciclo próprio (25s–30min conforme o módulo), então uma mudança no dashboard vale a partir do próximo ciclo, sem precisar recarregar. Ligar/desligar um módulo continua valendo só no próximo carregamento de página (limitação conhecida, documentada no `DASHBOARD.md`).

## Fase 6 — v1.4.0: Auto Farm contínuo (ondas simultâneas)

Pedido do usuário: o Auto Farm exigia clique manual por ataque (mesmo em modo real, mostrava uma lista com botão "Enviar" por alvo). Reescrito pra atacar sozinho, sem parar — mantém até N ataques ("ondas") viajando ao mesmo tempo e dispara o próximo assim que uma onda volta, sem clique nenhum.

O envio em si continua o mesmo mecanismo **VERIFIED** (`S.sendCommand`, os dois POSTs já validados). O que é novo nesta versão, e nunca testado ao vivo:

- **Rastreio de "ondas no ar"**: ao enviar, grava `{ targetId, sentAt, returnAt }` em `auto-farm:waves:<aldeia>`, assumindo retorno em `2×durationMs` (a duração de ida, lida da resposta real da etapa 1, dobrada). Cada ciclo (a cada ~20–35s) descarta ondas cujo `returnAt` já passou e só manda uma nova se `ondas no ar < máximo configurado`. **UNVERIFIED**: nunca confirmado se `durationMs` bate exatamente com o tempo de ida+volta real (perdas de tropa, efeitos do mundo etc. podem alterar isso) — na pior hipótese o contador fica errado e o farm manda menos ataques do que podia, nunca mais.
- **Limite por hora** e **pausa noturna**: contagem simples de envios na última hora e janela de horário (local do navegador, não do servidor) configuráveis no dashboard — lógica nunca testada em uso real.
- Alvos em ondas atualmente "no ar" ficam excluídos da lista de próximos alvos (evita mandar duas ondas pro mesmo bárbaro ao mesmo tempo).

## Fase 7 — v1.5.0: os 6 módulos que faltavam + conserto do "Restaurar alvos"

Pedido do usuário: implementar os recursos que só existiam no produto do Paulinho e nunca tiveram equivalente aqui. Seis módulos novos, nenhum testado ao vivo ainda — todos nascem em modo teste (exceto onde indicado):

| Módulo | Mecanismo | Confiança |
|---|---|---|
| Cunhar Moedas & Puxar Recursos | `screen=snob`, `action=coin`/`reserve` (POST de formulário real) | UNVERIFIED — mesmo padrão do TWB, nunca testado |
| Troca Premium | `ajaxaction=exchange_begin`/`exchange_confirm` em `screen=market` — `sell_<recurso>` confirmado no código do TWB, `buy_<recurso>` é suposição simétrica | UNVERIFIED, venda com mais base que compra |
| Derrubar Muralha | Reusa `S.sendCommand` com o novo parâmetro `catapultTarget` → campo `catapult_target` no POST de confirmação | UNVERIFIED — nome do campo é convenção de scripts da comunidade, nunca visto no HTML real deste jogo. Degradação esperada se estiver errado: ataca normal, sem mirar a muralha (não devia dar erro) |
| Snip por Cancelamento | Não tenta automatizar a decisão de *quando* snipar — só agenda o cancelamento de um comando escolhido pelo usuário, no segundo exato (`serverTime.scheduleAt` + `cancelCommand`, ambos já usados em outro lugar) | Mecanismo de cancelamento é o mesmo já existente; a *seleção da lista de comandos canceláveis* (`listCancelableCommands`, agora devolve `{id, href, label}` por linha da tabela) é nova e UNVERIFIED |
| Etiquetador de Comandos | Clique DOM simples (marca todas as caixinhas + clica no botão "Etiqueta") — só roda quando o usuário está na tela `info_command`, não em background | UNVERIFIED — nunca confirmado se o botão se chama exatamente "Etiqueta" |
| Upar Paladino | **Não implementado de verdade.** Sem nenhuma referência confiável do endpoint, o módulo só faz diagnóstico (lista formulários/botões da tela `statue` e loga no console) — evita chutar um `ajaxaction` e arriscar gastar recurso à toa. Precisa de uma captura HAR de alguém treinando o paladino manualmente pra virar um módulo de verdade, igual foi feito com o Auto Farm |

**Conserto do "Restaurar alvos" (Auto Farm)**: o botão já funcionava (`storage.removeByPrefix`), mas só confirmava via `log.info` — invisível pra quem não está com o DevTools aberto. Agora mostra o resultado (quantidade restaurada, ou o erro) direto na tela do painel. Também adicionado um botão equivalente no dashboard: como o dashboard roda numa aba separada da do jogo, ele não chama o módulo diretamente — grava um pedido em `autoFarmResetRequests` (por conta) que a aba do jogo confere no próprio ciclo de atualização de ~8s e executa sozinha.

## Fase 8 — v1.6.0: recrutamento por metas + lote de correções do dashboard

Pedido do usuário: revisão geral após relatar vários problemas de uma vez — Auto Farm/Construção exigindo estar na tela certa, botões de "Ajustes finos" não abrindo, "Construindo" não atualizando e só listando Bosque, falta de modelo de tropas pra Coleta, e por fim o pedido específico de Recrutamento por metas (substituindo o "recruta N por ciclo, pra sempre" por metas por tropa com parada automática).

| Mudança | O que era | Status |
|---|---|---|
| `screens` do Auto Farm e Derrubar Muralha | `['place']` — só agia com a aba parada na Praça, mesmo o envio já sendo por requisição direta (`getPlaceDoc` com fallback) | Trocado pra `['any']`. Não depende de seletor novo, só destrava o `run()` pra executar fora daquela tela — **VERIFIED por leitura de código**, o mecanismo de envio em si já era VERIFIED antes |
| Bug do toggle "Ajustes finos" no dashboard | Ao adicionar o botão "Restaurar alvos" ao lado do toggle, um `<div>` novo foi inserido no meio, quebrando `fine.parentElement.classList.toggle('open')` — afetava **todos** os módulos, não só Auto Farm | Corrigido trocando pra `fine.closest('.fine-wrap')`. **Confirmado por teste no navegador** (toggle abrindo/fechando corretamente, com screenshot) |
| Relatório de fila de construção/recrutamento/comandos | Só existia dentro do módulo Mega Construtor, e só quando ele estava ativo — por isso "não atualiza quando desligado" | Movido pro módulo `live-status` (sempre ativo), que já reportava recursos/tropas/ataques a caminho. Ciclo reduzido de 60-95s pra 35-55s. Acrescenta `outgoing`/`outgoingAttacks` (via `getOutgoingCommands`, novo em `shared.js`) e `trainQueue` (via `getTrainQueue`, novo, lê `#trainqueue` do quartel/estábulo/oficina em paralelo) |
| Coleta / Coleta em Massa: `excludeUnits` | Uma tropa inteira era excluída ou não | Trocado por `unitCaps: {}` — teto de quantidade por tropa (vazio = sem limite, `0` = nunca usar). Cavalaria/aríete/catapulta/nobre nunca apareciam de qualquer forma (não estão em `CARRY`, nunca foram elegíveis pra coleta) |
| Construção: fila só mostrava "Bosque" | Não era bug — a fila é sequencial por prioridade (`"edifício:nível, edifício:nível, ..."`) e todo passo antes de `wood:10` já estava satisfeito na aldeia do usuário (confirmado por aritmética contra um screenshot real dos níveis) | Dashboard ganhou editor visual de fila (`queueEditorHTML`) com setas de prioridade, e 4 presets (equilibrado/economia/militar/crescimento) em vez de 1 só |
| Recrutamento | `DEFAULTS = { unit, amount, interval }` — uma tropa, quantidade fixa por ciclo, looping infinito, nunca parava sozinho | Reescrito pra `DEFAULTS = { goals: {}, reservePercent, maxQueueOrders }` — objeto `goals` (unidade → meta total), progresso persistido em `auto-recruit:progress:<vid>`, incrementado só pela quantidade realmente aceita pelo jogo a cada ordem. Agrupa tropas pendentes por edifício (quartel/estábulo/oficina), tenta uma por edifício por ciclo respeitando reserva e teto de fila. Painel do jogo ganhou lista de progresso por tropa + botão "Resetar progresso". Dashboard ganhou grade de metas (`recruitGoalsHTML`, mesmo padrão do `unitCapsHTML`) pras 10 tropas recrutáveis (as 8 + aríete/catapulta) |

**Nada deste lote foi testado contra o jogo ao vivo**, exceto onde marcado VERIFIED acima — todos nascem em modo teste. `node --check` passou nos dois arquivos; a UI foi testada via navegador com uma ponte simulada do Tampermonkey (sem extensão real), o que confirma a lógica de renderização/persistência mas não o comportamento HTTP real do jogo.

## Fase 8.1 — v1.6.1 a v1.6.3: correções contra o jogo real (primeira conta ao vivo)

Primeira vez que alguém testou o lote de v1.6.0 contra uma conta de verdade (`br144:promiss`). Os dois pontos marcados UNVERIFIED na Fase 8 (fila de recrutamento e comandos a caminho) estavam de fato errados — usuário mandou o HTML real das telas, permitindo corrigir com confiança em vez de continuar chutando:

- **Fila de recrutamento (v1.6.1)**: eu tinha suposto uma tabela `#trainqueue` com linhas tipo "10x Lanceiro". O real: container `#trainqueue_wrap_<edifício>` com duas `<tbody>` (a unidade treinando agora + a fila atrás dela), e o texto da linha é `"1 Lanceiro"` sem "x" — o tipo da tropa vem da classe do ícone (`unit_sprite ... spear/sword/...`), não do texto. Testado com Playwright direto contra o HTML real antes de aplicar (2/2 linhas extraídas certas). **VERIFIED** — usuário confirmou aparecendo certo no painel do jogo e no dashboard depois do fix.
- **Comandos a caminho (v1.6.3)**: o parser em si (`#commands_outgoings` → `tr.command-row` → `[data-endtime]`) sempre esteve certo — o erro era a **tela**: eu buscava `screen=main` (tela de Edifício principal), mas esse widget vive em `screen=overview` (Visualização geral, com o mapa visual da aldeia). Confirmado duas vezes com HTML real do usuário (2 comandos, depois 4). Trocada a URL em `getIncomingAttacks`/`getOutgoingCommands`. **Correção aplicada, aguardando confirmação do usuário em uso real** (o parser já foi testado isolado, só a busca pela tela certa que não tinha como testar sem sessão ao vivo).
- **Ciclo do "Ao vivo" (v1.6.2)**: reduzido de 35-55s pra 15-25s a pedido do usuário, depois de confirmar que a "demora" era só o intervalo do ciclo, não um bug de sincronização.

**Lição pro processo**: a suposição errada de tela (`screen=main` vs `screen=overview`) não teria sido pega só lendo código — só apareceu comparando contra o `view-source` real, que é exatamente o motivo desse projeto insistir em marcar tudo como UNVERIFIED até alguém testar contra o jogo de verdade.

## Fase 9 — Multi Contas (companion app separado, Fase A)

Pedido do usuário: reproduzir a categoria "Multi Contas" de concorrentes (cadastro/login em lote, proxy por conta, automação em massa, tribo automática, barbarização automática), aceitando explicitamente guardar senha localmente pra isso — algo que o resto do projeto tinha decidido evitar. Ver plano completo em `multi-contas/docs/MULTI-CONTAS.md`.

Arquitetura: processo Node.js separado (`multi-contas/`), porta própria (8788), Playwright abrindo um contexto de navegador isolado por conta. Em vez de depender da extensão Tampermonkey dentro de cada perfil automatizado, `tw-suite.user.js` é injetado direto via `context.addInitScript()`, precedido por um shim síncrono de `GM_setValue/GM_getValue/GM_deleteValue/GM_listValues` baseado no `localStorage` daquele contexto (`multi-contas/inject/gm-shim.js`) — o script roda sem nenhuma modificação. `notify()` já cai em `fetch()` puro hoje (sem `GM_xmlhttpRequest` nos grants), então funciona sem ajuste nenhum dentro do perfil injetado.

**O que está implementado (Fase A) e ainda não foi testado contra o jogo ao vivo:**

| Peça | Mecanismo | Status |
|---|---|---|
| Vault (`multi-contas/vault.js`) | AES-256-GCM + scrypt, `crypto` nativo do Node, sem dependência nova | Lógica de criptografia testável isoladamente (não depende do jogo); não testada em uso real ainda |
| Switch mestre + aviso de risco (`multi-contas/settings.js`) | Bloqueia (`403`) qualquer rota que aja de verdade até o aceite + switch ligado | Lógica simples, sem dependência externa |
| Injeção do script (`gm-shim.js` + `status-bridge.js`) | `addInitScript` na ordem shim → script real → ponte de status; ponte usa `context.exposeFunction` (push), não polling | **UNVERIFIED** — nunca confirmado ao vivo que o script inteiro roda igual dentro de um contexto Playwright sem a extensão Tampermonkey |
| Login automático (`multi-contas/login.js`) | Campos `#user`/`#password` e botão `a.btn-login` **confirmados por inspeção ao vivo da página em 2026-09-17** (o `input#login_submit_button` real fica `display:none` — quem aparece pro usuário é um link estilizado, por isso a primeira tentativa com seletores "melhor palpite" falhou com "Botão de login não encontrado") | **Preencher campos + clicar no botão: VERIFIED.** O que vem depois do clique (chegar em `game.php`, tela de escolha de mundo) continua **UNVERIFIED** — nunca testado com credenciais reais |
| hCaptcha no login | Testado ao vivo com credenciais inválidas: o desafio aparece **imediatamente após clicar em Login**, antes de qualquer validação de credencial — não parece ser algo que só aparece com suspeita de bot | **Confirmado que acontece sempre** ao passar pelo formulário de login. `login.js` espera até 3 min (`CAPTCHA_WAIT_MS`) pra alguém resolver manualmente, em vez do timeout curto original (~3,5s) que sempre desistia antes da pessoa terminar — esse era o bug real por trás do usuário reportar "está sempre pedindo". **Nunca vamos automatizar a resolução do captcha em si**, isso está fora de cogitação (é o mesmo motivo que qualquer serviço tipo 2Captcha/Anti-Captcha nunca vai ser integrado aqui). Mitigação real: como o formulário já marca "Lembrar-me" e cada conta tem perfil de navegador persistente, `loginAccount` agora tenta entrar direto por `https://<mundo>.tribalwars.com.br/game.php` antes de refazer o formulário — se a sessão anterior ainda vale, pula login e captcha inteiramente. **UNVERIFIED** se isso realmente evita o captcha em lançamentos seguintes da mesma conta (a lógica está implementada, mas só um teste real confirma) |
| Orquestrador (`orchestrator.js`) | `launchPersistentContext` por conta (`user-data-dir` isolado), `launchMany` com jitter entre lançamentos | Lógica de orquestração testável sem jogo real; ponta a ponta com login real ainda não confirmado |

**Ainda não implementado** (fases B–F do plano): proxy testado ponta a ponta, push de modelo/configuração em massa, comandos em massa, modo seguro configurável na UI, tribo automática, barbarização automática (esta última já nasce escopada pra só disparar o pedido de exclusão e depois notificar o humano — é bem provável que a confirmação final exija clicar num link de e-mail, fora do escopo).

## Fases futuras (ainda não implementadas)

- Auto Defesa: ainda no formato antigo (detecta "ataque" como texto solto na página — falso-positivo praticamente garantido). Candidato a reescrever com o mesmo parser de `info_command` do live-status, uma vez confirmado.
- Notificações: só Discord; WhatsApp via CallMeBot já está pronto em `shared.notify()` mas sem UI no dashboard/painel nativo pra configurar telefone/apikey.
- Upar Paladino: precisa de referência ao vivo (HAR) pra sair do diagnóstico e virar automação de verdade.
- Recursos citados pelo usuário mas ainda não implementados: Snip por Cancelamento, Cunhar Moedas (rascunho existe mas não integrado), Etiquetador de Comandos, Compra/Venda no mercado, Derrubar Muralha, Farm pelo Mapa, Upar Paladino em Massa.
