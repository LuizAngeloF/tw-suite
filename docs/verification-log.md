# Log de verificação

Registro do que já foi confirmado ao vivo contra o jogo real vs. o que ainda é suposição baseada em pesquisa de projetos open-source de terceiros. Todo item "UNVERIFIED" também está marcado como tal em `constants` no `tw-suite.user.js`.

Como confirmar um item: instalar o build atual, logar normalmente no `tribalwars.com.br`, abrir a tela relevante, e ou (a) deixar o Claude inspecionar a página ao vivo via navegador (sem tocar em login/senha), ou (b) colar no DevTools um trecho que o Claude preparar e devolver o resultado.

## Fase 0 — Núcleo

| Item | Uso no código | Status | Observação |
|---|---|---|---|
| `#menu_row2` / `#menu_row` | Entrada de menu nativa (`ui.injectMenuEntry`) | UNVERIFIED | Convenção conhecida da engine clássica do Tribal Wars, nunca confirmada nesta conta. Se nenhum dos dois existir, o script cai automaticamente no botão flutuante (sempre funciona, não depende de seletor nenhum). |
| `window.game_data` | Leitura de aldeia/mundo/tela (`gameApi.getGameData`) | UNVERIFIED | Praticamente certo de existir (é a convenção universal da engine), mas o formato exato (`.screen`, `.time_generated`) não foi confirmado. |
| `game_data.time_generated` | Cálculo do offset de servidor (`serverTime.computeOffsetFromGameData`) | UNVERIFIED | Se o campo não existir ou tiver outro nome, o script avisa no console e reaproveita o último offset salvo em vez de quebrar. |
| `window.TribalWars` (API nativa `.get`/`.post`) | Ainda não usado na Fase 0 — reservado para Fase 1/2 | UNVERIFIED | Vem da pesquisa em `thevtm/Tribal-Wars-Farm-Assistant-Plus`; precisa confirmar antes de usar em módulo de automação real. |

## Fases futuras (ainda não implementadas)

- Fase 1 (Auto Farm): classes dos botões de template A/B no Assistente de Saque (`am_farm`) — pesquisa apontou algo como `a.farm_icon_a` / `a.farm_icon_b`, não confirmado.
- Fase 2 (Agendador): elemento que mostra a duração de viagem na tela de confirmação (`screen=place&try=confirm`) — não identificado ainda, precisa inspeção ao vivo.
- Fase 3 (Construção automática): estrutura da fila de construção e convenção de id/link por edifício — não identificado ainda.
- Fase 4 (Notificações): seletor do indicador de ataque chegando e do overlay de captcha/proteção anti-bot — não identificado ainda.
