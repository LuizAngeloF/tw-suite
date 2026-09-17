# TW Suite · Sala de Guerra

Painel para cadastrar suas contas e escolher o que cada uma automatiza. O script aplica a configuração sozinho quando você abre o jogo com a conta.

## Instalação

1. Atualize o **TW Suite no Tampermonkey para a v1.2.0** ou mais nova.
2. Baixe o `dashboard.html` para o seu computador (qualquer pasta).
3. No Chrome, abra `chrome://extensions`, clique em **Detalhes** no Tampermonkey e ative **Permitir acesso a URLs de arquivo**.
4. Abra o `dashboard.html` no navegador. O selo no topo deve mostrar **Sincronizado**.

Sem o passo 3 o painel funciona, mas grava só no navegador. Nesse caso use o **código de sincronização**: gere no painel e, no jogo, abra `TW Suite → Importar código do dashboard`.

## Como funciona

- Cada conta é identificada por **mundo + nick** (ex.: `br144` + `Agostinho`), exatamente como no jogo.
- Ao carregar o jogo, o script lê o perfil da conta logada e liga/desliga os módulos com as configurações escolhidas.
- O script também informa ao painel os pontos, as aldeias e o último acesso de cada conta.
- **Nenhuma senha é pedida nem guardada.** O script roda no seu navegador, já logado. Se você colar uma lista `usuario|senha|mundo`, a senha é descartada.

## Recursos

| Recurso | Onde |
|---|---|
| Adição em massa (`nick\|mundo`, `mundo:nick` ou só `nick`) com escolha de scripts por módulo | Botão **Em massa** |
| Perfis prontos por módulo (ex.: Farm Leve / Equilibrado / Agressivo) e ajustes finos com sliders | Cartões no dossiê da conta |
| Modo teste por conta (os módulos só simulam) | Faixa abaixo das estatísticas |
| Modelos reutilizáveis (3 prontos + os seus) | Painel lateral ou **Aplicar modelo** |
| Ações em lote: clique no selo do mundo (ou Ctrl+clique) para selecionar várias contas | Barra inferior |
| Paleta de comandos | `Ctrl + K` |
| Busca de contas | `/` |
| Backup e importação em `.json` (aceita também o formato do dashboard antigo) | Topo |
| **Modelos de tropas editáveis** — crie, edite e marque o modelo ativo do Auto Farm sem abrir o jogo | Cartão "Auto Farm" |
| **Status ao vivo** — recursos, tropas em casa e aviso de ataque a caminho | Cartão "Ao vivo", no dossiê da conta |

Contas novas sempre começam em **modo teste**.

## Modelos de tropas

O cartão do Auto Farm tem uma lista de modelos de tropas (nome + quantidade de cada unidade, incluindo aríete, catapulta, paladino e nobre). Clique no círculo à esquerda de um modelo pra marcá-lo como ativo — é esse que o script usa pra enviar. A mudança chega na aba do jogo em poucos segundos (o Auto Farm relê a configuração a cada ~8s), sem precisar recarregar a página.

## Status ao vivo

Depois que o script roda pelo menos uma vez numa conta (até ~90s após abrir o jogo), o dossiê ganha um cartão **Ao vivo** com barras de recursos, tropas paradas na aldeia e um aviso quando há ataque a caminho. O dashboard busca essa informação a cada ~20s enquanto estiver aberto.

## Limitações conhecidas

- **Ligar/desligar** um módulo só vale a partir do próximo carregamento de página. Já **ajustar valores** de um módulo que já está ligado (modelo de tropas, quantidade, intervalo) chega sem precisar recarregar.
- Precisa do navegador aberto com a aba do jogo carregada — diferente de serviços que rodam num servidor deles, aqui a automação para se você fechar a aba ou desligar o PC.
- Vários módulos (recrutamento, coleta, construção, balanceador) foram reescritos nesta versão mas ainda não testados contra o jogo ao vivo — todos nascem em **modo teste**, ligue o modo real um de cada vez.
