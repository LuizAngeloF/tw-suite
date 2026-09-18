# TW Suite · Sala de Guerra

Painel para cadastrar suas contas e escolher o que cada uma automatiza. O script aplica a configuração sozinho quando você abre o jogo com a conta.

## Instalação

1. Atualize o **TW Suite no Tampermonkey para a v1.5.0** ou mais nova.
2. Baixe a pasta do projeto (ou pelo menos `dashboard.html` + `start-dashboard.bat`, os dois juntos na mesma pasta).
3. Dê **2 cliques em `start-dashboard.bat`**. Abre uma aba em `http://localhost:8787/dashboard.html` — use essa aba, não um arquivo aberto direto.
4. O selo no topo deve mostrar **Sincronizado**. Deixe a janela preta do `.bat` aberta enquanto usar o dashboard — fechar ela desliga o servidor.

**Por que `start-dashboard.bat` em vez de abrir o `dashboard.html` direto?** Um arquivo aberto como `file://` exige que você ative manualmente "Permitir acesso a URLs de arquivo" (e, em navegadores baseados em Chromium mais novos, também "Permitir scripts de usuário") nos detalhes da extensão Tampermonkey — fácil de esquecer um dos dois, e o navegador não avisa quando falta. Servido em `localhost`, o Tampermonkey trata como qualquer outra página e não precisa de nenhuma dessas permissões.

Prefere continuar abrindo o arquivo direto? Ainda funciona — ative as duas permissões acima em `chrome://extensions → Tampermonkey → Detalhes`. Sem elas, o painel funciona mas grava só neste navegador; nesse caso use o **código de sincronização**: gere no painel e, no jogo, abra `TW Suite → Importar código do dashboard`.

## Como funciona

- Cada conta é identificada por **mundo + nick** (ex.: `br144` + `Agostinho`), exatamente como no jogo.
- Ao carregar o jogo, o script lê o perfil da conta logada e liga/desliga os módulos com as configurações escolhidas.
- O script também informa ao painel os pontos, as aldeias e o último acesso de cada conta.
- **Nenhuma senha é pedida nem guardada** neste dashboard. O script roda no seu navegador, já logado. Se você colar uma lista `usuario|senha|mundo`, a senha é descartada. (Existe uma ferramenta separada e opcional, `multi-contas/`, que quebra essa regra de propósito pra permitir login em lote — ver [`multi-contas/docs/MULTI-CONTAS.md`](multi-contas/docs/MULTI-CONTAS.md). Ela não faz parte deste dashboard.)

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

## Auto Farm contínuo

Ligado em modo real, o Auto Farm ataca sozinho, sem parar — não precisa mais clicar em "Enviar" por alvo. Em "Ajustes finos" você configura:

- **Ondas simultâneas** — quantos ataques ficam viajando ao mesmo tempo (pra alvos diferentes). Assim que uma onda volta pra aldeia, o script já manda a próxima sozinho.
- **Espera por alvo** — quanto tempo esperar antes de reatacar a mesma aldeia bárbara.
- **Limitar ataques por hora** e **Pausar de madrugada** — dois jeitos independentes de reduzir o ritmo pra não parecer automação o tempo todo. Os dois ficam desligados por padrão (farm sem limite, 24h) — o card avisa o risco disso.

## Status ao vivo

Depois que o script roda pelo menos uma vez numa conta (até ~90s após abrir o jogo), o dossiê ganha um cartão **Ao vivo** com barras de recursos, tropas paradas na aldeia e um aviso quando há ataque a caminho. Com o módulo **Construção** ligado, o mesmo cartão também mostra o que está sendo construído agora e o tempo restante. O dashboard busca essa informação a cada ~20s enquanto estiver aberto.

## Se não sincronizar

1. **Primeiro, use `start-dashboard.bat`** em vez do arquivo direto — resolve a maioria dos casos, porque tira a permissão de arquivo local da equação inteira.
2. Com o dashboard aberto em `http://localhost:8787/dashboard.html`, olhe o canto inferior esquerdo da aba. Deve aparecer um selo:
   - **Nenhum selo** → o Tampermonkey não rodou o script nessa aba. Confirme que o TW Suite está atualizado (v1.4.0+) e habilitado no painel do Tampermonkey.
   - **"aguardando dashboard..."** → o script rodou mas não trocou mensagem com a página. Recarregue a aba uma vez; se persistir, é bug — me avise.
   - **"conectado ao dashboard"** (fica verde) → a ponte funcionou; se o selo do topo ainda disser "Só neste navegador", recarregue a página uma vez.
3. No jogo, abra o painel **TW Suite** (link no menu ou botão flutuante). Ele mostra um bloco **"Sincronização com o dashboard"** com `game_data.world`, o nick e a **chave calculada** (ex.: `br144:promiss`).
4. No dashboard, confira se a conta está cadastrada com **exatamente** esse mesmo mundo e nick — a chave precisa bater dos dois lados.
5. Ainda sem sincronizar? Use **"Usar código de sincronização"** no dashboard — copia um código, cole em `TW Suite → Importar código do dashboard` no jogo. Não depende de nenhuma permissão, mas é manual: repita sempre que mudar algo no dashboard.
6. Depois de importar, abra o painel **TW Suite** de novo — "Último perfil aplicado" deve mostrar ✅ com a chave da conta. Se mostrar "sem perfil salvo", ele lista as chaves que reconhece — compare com a chave calculada do passo 3.

## Módulos novos (v1.5.0)

Seis módulos que faltavam: **Cunhar Moedas & Puxar Recursos**, **Troca Premium**, **Derrubar Muralha**, **Snip por Cancelamento**, **Etiquetador de Comandos** e um diagnóstico de **Upar Paladino** (esse último ainda não faz nada de verdade — só relata o que vê na tela, porque não tenho referência confiável do mecanismo real; me manda uma captura de rede de alguém treinando o paladino manualmente que eu termino).

Todos nascem em **modo teste** e nenhum foi testado contra o jogo ainda — ligue o modo real um de cada vez e me avise o que funcionar ou falhar.

## Novidades (v1.6.0)

- **Recrutamento por metas** — reescrito do zero. Antes era "recruta N por ciclo, pra sempre" (nunca parava sozinho). Agora, em "Ajustes finos", você define uma meta por tropa (ex.: 10 Lanceiros, 20 Bárbaros, 10 Espadachins — cada campo é o **total desejado**, não por ciclo). O script recruta conforme os recursos permitem e **para sozinho** quando cada meta é atingida — sem loop infinito. Aumentar uma meta depois retoma de onde parou; o botão "Resetar progresso" no painel do jogo zera pra uma campanha nova com os mesmos números.
- **Construção e Auto Farm não precisam mais estar na tela certa** — antes, Auto Farm/Derrubar Muralha só agiam se a aba estivesse parada na Praça de Reunião, mesmo o envio em si já funcionando via requisição direta. Agora rodam em qualquer tela.
- **Fila de construção com prioridade editável** — no cartão "Construção", a fila agora é uma lista visual (não mais um texto solto) com setas pra subir/descer a prioridade de cada passo, excluir ou adicionar. A ordem da lista é a ordem que o script segue.
- **Coleta com teto por tropa** — em vez de só excluir uma tropa inteira, agora dá pra definir um limite de quantidade por tropa (deixe em branco pra "sem limite", ou `0` pra nunca usar aquela tropa).
- **"Ao vivo" mostra recrutamento e comandos a caminho** — o mesmo cartão que já mostrava construção agora também lista o que está sendo recrutado e os comandos (ataques/apoios) a caminho, atualizado com mais frequência (~35s).

## Restaurar alvos

O botão "Restaurar alvos" do Auto Farm agora mostra o resultado direto na tela (antes só ia pro console, parecia não fazer nada). Também tem um botão igual no dashboard, ao lado de "Ajustes finos" — como o dashboard roda numa aba separada da do jogo, ele não limpa na hora: grava um pedido que a aba do jogo aplica sozinha no próprio ciclo (~8s depois).

## Limitações conhecidas

- **Ligar/desligar** um módulo só vale a partir do próximo carregamento de página. Já **ajustar valores** de um módulo que já está ligado (modelo de tropas, quantidade, intervalo) chega sem precisar recarregar.
- Precisa do navegador aberto com a aba do jogo carregada — diferente de serviços que rodam num servidor deles, aqui a automação para se você fechar a aba ou desligar o PC.
- Recrutamento, Coleta, Balanceador, e o rastreio de "ondas no ar" do Auto Farm ainda não foram testados contra o jogo ao vivo — todos nascem em **modo teste**, ligue o modo real um de cada vez. A Construção já foi confirmada funcionando (constrói de verdade e mostra a fila certa).
