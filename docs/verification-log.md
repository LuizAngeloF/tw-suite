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
| `#inputx` / `#inputy` (coordenada alvo) | `fillAndSubmitAttack` | **VERIFIED** (2026-09-19, Opera GX) | Inputs de texto simples, confirmados no dump do formulário. |
| `#unit_input_<tropa>` com atributo `data-all-count` | Preencher quantidade + ler disponível (`fillAndSubmitAttack`, checagem de disponibilidade) | **VERIFIED** (2026-09-19, Opera GX) | Confirmado pra `spy`, `light`, `marcher`, `heavy` (todos com `data-all-count="0"` nessa conta em proteção de iniciante — mecanismo confirmado, só não há tropa ainda pra testar envio real). |
| `#target_attack` (botão "Ataque") | Disparar o envio (`fillAndSubmitAttack`) | **VERIFIED** (2026-09-19, Opera GX) | `<input type="submit" id="target_attack" name="attack" value="Ataque">`, confirmado no dump. |
| Botão de confirmação na tela `try=confirm` | `tryAutoConfirm` | **UNVERIFIED — ainda não testado** | Não dá pra testar com 0 tropas (jogo não deixa avançar até a tela de confirmação sem tropa pra enviar). `autoConfirm` fica desligado por padrão até confirmar. Reconfirmar assim que alguém do grupo tiver tropa disponível: clicar em "Ataque" com 1 unidade, dar F12 na tela de confirmação, rodar o mesmo tipo de script de inspeção, **sem clicar em confirmar**, e mandar o resultado. |

## Fases futuras (ainda não implementadas)

- Fase 2 (Agendador): elemento que mostra a duração de viagem na tela de confirmação (`screen=place&try=confirm`) — não identificado ainda; pode ser resolvido junto da verificação do botão de confirmar acima.
- Fase 3 (Construção automática): estrutura da fila de construção e convenção de id/link por edifício — não identificado ainda.
- Fase 4 (Notificações): seletor do indicador de ataque chegando e do overlay de captcha/proteção anti-bot — não identificado ainda.
