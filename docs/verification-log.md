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
| Preencher `#inputx`/`#inputy` NÃO seleciona o alvo na hora | `waitForTargetResolved` | **VERIFIED** (2026-09-19, Opera GX) | O jogo resolve a coordenada pra um alvo de verdade de forma assíncrona — a URL ganha `?target=<id_da_aldeia>` quando termina (ex.: `target=73362`). O primeiro teste falhou porque clicávamos em "Ataque" antes disso terminar (erro "selecione um alvo"); corrigido esperando `?target=` aparecer antes de continuar. |
| A "tela" de confirmação é uma transição client-side, não uma navegação real | Arquitetura do módulo (removida a detecção por `try=confirm` na URL) | **VERIFIED** (2026-09-19, Opera GX) | Não existe `screen=place&try=confirm` nesta versão do jogo — a URL não muda de um jeito detectável em `run()` (que só roda uma vez por carregamento real de página). O clique em "Enviar ataque" agora é tratado dentro do próprio fluxo de envio (`fillAndSubmitAttack` → `waitForConfirmButton`), não como uma tela separada. |
| `#troop_confirm_submit` (botão final "Enviar ataque") | `waitForConfirmButton` / clique de auto-confirm | **VERIFIED** (2026-09-19, Opera GX) | `<input type="submit" id="troop_confirm_submit" name="submit_confirm" class="troop_confirm_go btn btn-attack" value="Enviar ataque">`, confirmado no dump da tela de confirmação real (chegada a um alvo bárbaro em 706\|568, duração 0:40:15). `autoConfirm` segue desligado por padrão mesmo assim — é opt-in por ser uma ação definitiva, não por incerteza técnica. |

**Fase 1 considerada verificada ponta a ponta** (descoberta de alvo → preencher formulário → resolver alvo → enviar → tela de confirmação → botão final identificado).

**Teste com `autoConfirm` ligado (2026-09-19):** chegou até a tela de confirmação, mas não clicou em "Enviar ataque" — suspeita de corrida de novo (achou o botão rápido demais, antes de estar de fato pronto/vivo no DOM). Corrigido em v0.3.1: `waitForElement` agora exige o elemento **visível** (não só presente), e `waitForConfirmButton` espera 350ms depois de achá-lo e reconsulta o seletor antes de considerar válido — e o clique em si reconsulta o seletor mais uma vez na hora, pra não clicar num nó que a página já substituiu.

**Retestado, ainda não funcionou (v0.3.1).** Hipótese revisada: pode não ser timing — é possível que o jogo rejeite cliques sintéticos (`.click()` via JS, sem `isTrusted`) especificamente na ação final de envio, como proteção anti-bot deliberada (faria sentido: é exatamente o ponto em que as tropas saem de verdade). v0.3.2 adiciona um diagnóstico direto: depois do clique automático, espera 800ms e verifica se `#troop_confirm_submit` ainda está visível na tela — se estiver, avisa no log que o clique provavelmente não funcionou, em vez de assumir sucesso. Isso vai confirmar ou descartar a hipótese no próximo teste. Se for confirmado que cliques sintéticos são bloqueados nessa etapa específica, `autoConfirm` pode não ser tecnicamente viável — restando só a confirmação manual (que já funciona normalmente).

Também corrigido nessa versão: o cooldown de um alvo só é gravado (e o alvo removido da lista) depois de um envio **realmente confirmado**, não mais assim que chega na tela de confirmação — antes disso, "Enviar" numa aldeia e não confirmar (manual ou por falha do auto-confirm) fazia o alvo sumir da lista sem o ataque ter saído de verdade. Adicionado botão "Restaurar alvos" no painel pra limpar o cooldown da aldeia atual sob demanda.

## Fases futuras (ainda não implementadas)

- Fase 2 (Agendador): a duração de viagem já aparece na mesma tela de confirmação já verificada acima ("Duração: 0:40:15", "Chegada: hoje às ...") — falta só achar o seletor exato desses campos pra ler programaticamente.
- Fase 3 (Construção automática): estrutura da fila de construção e convenção de id/link por edifício — não identificado ainda.
- Fase 4 (Notificações): seletor do indicador de ataque chegando e do overlay de captcha/proteção anti-bot — não identificado ainda.
