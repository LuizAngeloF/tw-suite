# TW Suite

Sistema centralizado de módulos de automação para o Tribal Wars (tribalwars.com.br), pra uso privado de um grupo fechado. Um script único, instalado uma vez, com um menu dentro do próprio jogo pra ligar/desligar cada módulo.

Não é afiliado à InnoGames. Automatizar o jogo viola as regras oficiais do Tribal Wars — usar por sua conta e risco, mantendo o uso restrito ao grupo, sem revenda nem divulgação pública.

## Status atual

**Fase 0 (núcleo) e Fase 1 (Auto Farm) prontas e confirmadas ao vivo.**

- **Núcleo**: menu, armazenamento, sincronização de horário do servidor, carregador de módulos.
- **Auto Farm**: ativo na tela da Praça de Reunião (`screen=place`). Lê `/map/village.txt` (dados públicos do mundo) pra achar aldeias bárbaras perto da aldeia atual, mostra a lista num painel com distância, e ao clicar "Enviar" manda as duas requisições reais de ataque direto via `fetch()` (não simula clique — depois de várias tentativas sem sucesso, descobrimos via HAR que o envio real é uma submissão de formulário genuína, então replicamos ela). **Sobe desligado por padrão** (ative em "TW Suite" → módulo "Auto Farm (sem premium)") e em **modo teste (dry-run)** — nada é enviado de verdade até você desmarcar essa opção no painel do próprio módulo.
  - Não depende do Assistente de Saque nativo (que é premium neste mundo).
  - Não depende de simular clique em nada — os tokens/campos são lidos ao vivo do formulário e da resposta do jogo a cada envio, não fixos no código.
  - **Testado ao vivo e confirmado (v0.4.1): envio real funcionando ponta a ponta.** Ver [`docs/verification-log.md`](docs/verification-log.md) pro histórico completo (inclusive o que foi tentado e não funcionou, útil se algo quebrar no futuro).
  - Um alvo só sai da lista depois de um envio realmente confirmado. Botão **"Restaurar alvos"** no painel limpa o cooldown da aldeia atual, trazendo de volta qualquer alvo já tentado.
  - **Modelos de tropas (v0.5.0)**: em vez de escolher 1 tropa + quantidade, agora dá pra criar modelos nomeados com quantidade por tropa (as 12 do jogo — Lanceiro, Espadachim, Bárbaro, Arqueiro, Explorador, Cavalaria leve, Arqueiro a cavalo, Cavalaria pesada, Aríete, Catapulta, Paladino, Nobre), no estilo da tela "Modelos de tropas" do próprio jogo. Crie/edite/exclua modelos direto no painel ("+Novo"/"Editar"/"Excluir"), escolha qual fica ativo no seletor — esse é o modelo usado nos envios. Se faltar tropa de algum tipo no modelo na hora do envio, manda só o que tiver disponível daquele tipo (avisa no console).

Módulos planejados, em ordem: ~~Auto Farm~~ → Agendador de Comandos → Construção Automática → Notificações (Discord/WhatsApp).

## Instalação

1. Instale a extensão **[Tampermonkey](https://www.tampermonkey.net/)** no navegador (Chrome, Firefox ou Edge) — é gratuita.
2. Abra o link raw do `tw-suite.user.js` neste repositório no GitHub. O Tampermonkey detecta automaticamente e mostra a tela de instalação.
3. Confirme a instalação. O script já vem com `@updateURL` configurado — o Tampermonkey verifica novas versões sozinho.
4. Entre em qualquer aldeia no `tribalwars.com.br`. Um botão **"TW Suite"** aparece no canto inferior direito da tela (e, se o menu nativo do jogo permitir, também como aba no menu superior).

## Como usar

Clique no botão/aba "TW Suite" pra abrir o painel. Nele aparecem:
- Diagnóstico rápido (tela atual, se o `game_data` foi encontrado, offset de horário do servidor)
- Lista de módulos instalados, cada um com uma caixinha pra ligar/desligar

**Ligar ou desligar um módulo só vale a partir do próximo carregamento de página** (não é instantâneo).

## Para quem for manter o script

- Arquivo único (`tw-suite.user.js`) organizado em seções comentadas (`storage`, `gameApi`, `serverTime`, `moduleLoader`, `ui`) — só vale separar em arquivos reais se isso aqui passar de ~1500-2000 linhas.
- Contrato de módulo:

  ```js
  TWSuite.registerModule({
    id: 'meu-modulo',        // único, nunca renomear depois de publicado
    name: 'Nome exibido no painel',
    screens: ['am_farm'],    // ou ['any'] para rodar em qualquer tela
    defaultEnabled: false,
    init(ctx) { /* roda uma vez por carregamento de página, se habilitado */ },
    run(ctx)  { /* só roda quando a tela atual bate com `screens` */ },
  });
  ```

  `ctx` = `{ storage, gameApi, ui, serverTime, log }`. Um módulo nunca deve chamar `GM_*` ou ler globais do jogo direto — sempre pelo `ctx`, pra manter os pontos de ajuste centralizados.

- Antes de publicar uma nova versão: atualize o `@version` no cabeçalho do userscript (o Tampermonkey só baixa de novo se o número mudar).
- Seletores/variáveis do jogo usados no código (ex.: `#menu_row`, `game_data.time_generated`) ainda não foram 100% confirmados contra uma conta real — ver [`docs/verification-log.md`](docs/verification-log.md) pro que já foi validado e o que ainda é suposição.

## Segurança

- O script roda inteiramente no seu navegador, na sua sessão já logada — não pede senha, não acessa sua conta de forma independente.
- Nenhum segredo (webhook do Discord etc., quando existir) fica no repositório — cada pessoa cola o próprio nas configurações, guardado só localmente.
- **Exceção deliberada**: a ferramenta opcional e separada `multi-contas/` (ver [`multi-contas/docs/MULTI-CONTAS.md`](multi-contas/docs/MULTI-CONTAS.md)) guarda senha de jogo localmente, criptografada, só pra quem optar por instalá-la — essa promessa acima vale pro TW Suite principal (`tw-suite.user.js` + `dashboard.html`), não pra ela.
