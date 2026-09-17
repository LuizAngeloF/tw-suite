# TW Suite Dashboard

Dashboard centralizado para controlar todos os módulos de automação do TW Suite.

## Como Usar

### 1. Abrir o Dashboard

Você tem duas opções:

**Opção A: Via Menu do Jogo**
- Instale o script do TW Suite via Tampermonkey
- Acesse o Tribal Wars e procure por "Dashboard TW Suite" no menu de navegação (próximo ao nome da aldeia)
- Clique para abrir o dashboard em nova aba

**Opção B: Arquivo Local**
- Abra o arquivo `dashboard.html` diretamente no navegador
- Use `Ctrl+O` (Windows) ou `Cmd+O` (Mac) e selecione o arquivo

### 2. Selecionar Conta

- **Servidor**: Digite o servidor (ex: br144)
- **Nick**: Digite seu nick no jogo
- Clique em "Carregar Conta" pra carregar as configurações dessa conta

### 3. Ativar/Desativar Módulos

- Clique em qualquer módulo da lista à esquerda
- Marque a checkbox "Módulo Habilitado" pra ativar/desativar
- Edite as configurações em JSON
- Clique em "Salvar" pra aplicar

### 4. Multi Contas

Cada conta (servidor + nick) tem suas próprias configurações salvas:

- Mude o servidor/nick
- Clique "Carregar Conta" pra ver as configurações dessa conta
- Clique "Nova Conta" pra criar uma configuração nova

### 5. Backup e Restore

**Exportar** (download):
- Clique "📥 Exportar Config"
- Um arquivo JSON é baixado com todas as configurações
- Salve esse arquivo em lugar seguro

**Importar** (upload):
- Clique "📤 Importar Config"
- Selecione um arquivo JSON exportado antes
- As configurações são carregadas

## Estrutura de Configurações

Cada módulo pode ter configurações diferentes:

```json
{
  "auto-farm": {
    "enabled": true,
    "dryRun": false,
    "maxDistance": 12,
    "cooldownMinutes": 30,
    "templates": [
      {
        "id": "tpl_abc123",
        "name": "Padrão 1",
        "units": {
          "spear": 10,
          "sword": 10,
          "light": 5
        }
      }
    ],
    "activeTemplateId": "tpl_abc123"
  },
  "scheduler": {
    "enabled": true
  },
  "notif-discord": {
    "enabled": true,
    "webhookUrl": "https://discord.com/api/webhooks/...",
    "enableAttackAlert": true,
    "enableDefenseAlert": true
  }
}
```

## Sincronização com Tampermonkey

1. **No Dashboard**: Configure os módulos e clique "Salvar"
2. **Clique "Exportar Config"** pra baixar um JSON com todas as suas configurações
3. **No Jogo**: Abra o menu TW Suite e procure por um botão de importar configurações (em desenvolvimento)
4. As configurações são armazenadas **localmente** no seu navegador via `localStorage`

## Módulos Disponíveis

| Módulo | Tela | Descrição |
|--------|------|-----------|
| Auto Farm | place | Descoberta e envio de ataques |
| Agendador | place | Fila de ataques agendados |
| Auto Recrutamento | train | Recruta tropas automaticamente |
| Coleta Automática | scavenge | Coleta/desbloqueia recursos |
| Notificações Discord | any | Alertas via Discord |
| Balanceador | overview_villages | Distribui recursos |
| Mega Construtor | main | Constrói automaticamente |
| Coleta em Massa | am_farm | Coleta todos de uma vez |
| Auto Defesa | any | Mobiliza tropas em ataque |

## Multi Contas - Guia Prático

**Cenário**: Você tem 3 contas (br144 Player, pt100 Guerreiro, br145 Explorador)

1. Abra o Dashboard
2. Defina: Servidor = `br144`, Nick = `Player`
3. Configure os módulos como quiser
4. Clique "Salvar"
5. Clique "Exportar Config" → salve como `br144-player.json`
6. Agora mude: Servidor = `pt100`, Nick = `Guerreiro`
7. Configure diferente (ex: sem Discord, só farm)
8. Clique "Salvar"
9. Cada conta tem suas próprias configurações!

**Pra trocar entre contas**:
- Mude o servidor/nick no dashboard
- Clique "Carregar Conta"
- As configurações daquela conta aparecem

**Pra restaurar de um backup**:
- Mude pro servidor/nick correto
- Clique "Importar Config"
- Selecione o arquivo JSON baixado antes
- Pronto!

## Dica de Segurança

- **Nunca** compartilhe seus arquivos JSON exportados — contêm URLs de webhooks Discord e outras configs sensíveis
- Use senhas fortes no Tampermonkey (se usar)
- Os dados são armazenados **apenas localmente** no seu navegador — ninguém tem acesso

## Problemas Comuns

**P: Dashboard não abre?**
- Verifique se o Tampermonkey tem permissão pra acessar `about:blank`
- Ou abra o `dashboard.html` diretamente no navegador

**P: Configurações não salvam?**
- Verifique o console (F12) pra erros de JSON
- Confirme que está marcando "Salvar" depois de alterar
- O navegador armazena via localStorage — dados só existem localmente

**P: JSON inválido ao editar?**
- Abra o console (F12) pra ver o erro exato
- Use um validador JSON online pra testar

## Próximas Melhorias

- [ ] Upload direto de config dentro do Tampermonkey (sem download/upload manual)
- [ ] Cloud sync (salvar configurações num servidor)
- [ ] Interface de edição mais visual (sem JSON)
- [ ] Histórico de alterações
- [ ] Importar config de outras contas
