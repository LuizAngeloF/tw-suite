# Log de verificação

Registro do que já foi confirmado ao vivo contra o jogo real vs. o que ainda é suposição baseada em pesquisa de projetos open-source de terceiros. Todo item "UNVERIFIED" também está marcado como tal em `constants` no `tw-suite.user.js`.

Como confirmar um item: instalar o build atual, logar normalmente no `tribalwars.com.br`, abrir a tela relevante, e ou (a) deixar o Claude inspecionar a página ao vivo via navegador (sem tocar em login/senha), ou (b) colar no DevTools um trecho que o Claude preparar e devolver o resultado.

## Fase 0 — Núcleo

| Item | Uso no código | Status | Observação |
|---|---|---|---|
| `#menu_row2` / `#menu_row` | Entrada de menu nativa (`ui.injectMenuEntry`) | **VERIFIED** (2026-09-19, Opera GX) | Um dos dois existe — o link "TW Suite" foi injetado com sucesso na barra ao lado do nome da aldeia, sem quebrar o layout. Não sabemos ainda qual dos dois matched exatamente (não crítico, os dois convivem bem). |
| `window.game_data` | Leitura de aldeia/mundo/tela (`gameApi.getGameData`) | **Corrigido** (2026-09-19) | Painel mostrou "game_data: NÃO encontrado" no primeiro teste. Causa identificada: sandbox do Tampermonkey — `window.game_data` do script não é o `game_data` da página. Corrigido lendo via `unsafeWindow.game_data` (v0.1.1). Precisa reconfirmar no próximo teste. |
| `game_data.time_generated` | Cálculo do offset de servidor (`serverTime.computeOffsetFromGameData`) | UNVERIFIED | Dependia do fix acima (`game_data` não era lido de jeito nenhum). Reconfirmar offset != 0 no próximo teste. |
| `window.TribalWars` (API nativa `.get`/`.post`) | Ainda não usado na Fase 0 — reservado para Fase 1/2 | UNVERIFIED | Vem da pesquisa em `thevtm/Tribal-Wars-Farm-Assistant-Plus`; provavelmente também precisa de `unsafeWindow.TribalWars` pelo mesmo motivo do sandbox. Confirmar antes de usar em módulo de automação real. |

## Fases futuras (ainda não implementadas)

- Fase 1 (Auto Farm): classes dos botões de template A/B no Assistente de Saque (`am_farm`) — pesquisa apontou algo como `a.farm_icon_a` / `a.farm_icon_b`, não confirmado.
- Fase 2 (Agendador): elemento que mostra a duração de viagem na tela de confirmação (`screen=place&try=confirm`) — não identificado ainda, precisa inspeção ao vivo.
- Fase 3 (Construção automática): estrutura da fila de construção e convenção de id/link por edifício — não identificado ainda.
- Fase 4 (Notificações): seletor do indicador de ataque chegando e do overlay de captcha/proteção anti-bot — não identificado ainda.
