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

Não depende de seletor novo do jogo — os modelos são uma estrutura nossa (`settings.templates`), sem relação com os "Modelos de tropas" nativos do jogo (que são uma feature separada, limitada a 2 sem premium). Portanto **não há nada pra verificar ao vivo nessa mudança além do fluxo de UI em si** (criar/editar/excluir/selecionar modelo) — o envio real usa o mesmo caminho já verificado em v0.4.1.

## Fases futuras (ainda não implementadas)

- Fase 2 (Agendador): a duração de viagem e hora de chegada já vêm na resposta da etapa 1 (`submitAttackStep1`) — dá pra extrair de lá em vez de precisar de um seletor novo. O agendador provavelmente também deve usar `fetch()` direto (`submitAttack`) na hora certa, em vez de tentar clicar em algo.
- Fase 3 (Construção automática): estrutura da fila de construção e convenção de id/link por edifício — não identificado ainda.
- Fase 4 (Notificações): seletor do indicador de ataque chegando e do overlay de captcha/proteção anti-bot — não identificado ainda.
