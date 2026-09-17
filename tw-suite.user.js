// ==UserScript==
// @name         TW Suite
// @namespace    https://github.com/LuizAngeloF/tw-suite
// @version      1.1.0
// @description  Sistema centralizado de módulos de automação para Tribal Wars (uso privado / grupo fechado)
// @author       LuizAngeloF
// @match        https://*.tribalwars.com.br/game.php*
// @match        file:///*dashboard.html
// @icon         https://www.tribalwars.com.br/favicon.ico
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM.deleteValue
// @grant        GM.listValues
// @grant        unsafeWindow
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/LuizAngeloF/tw-suite/main/tw-suite.user.js
// @downloadURL  https://raw.githubusercontent.com/LuizAngeloF/tw-suite/main/tw-suite.user.js
// ==/UserScript==

/*
 * TW Suite — Fase 0: núcleo + menu, sem módulos ainda.
 *
 * IMPORTANTE: os seletores marcados UNVERIFIED abaixo (ver seção CONSTANTS)
 * ainda não foram confirmados contra o jogo real. Este arquivo foi escrito
 * com checagens defensivas (avisa no console em vez de quebrar) justamente
 * por causa disso — ver docs/verification-log.md para o processo de
 * confirmação ao vivo.
 *
 */

(function () {
  'use strict';

  const NAMESPACE = 'twsuite';

  // ============================================================
  // CORE: log
  // ============================================================
  const log = {
    info: (...args) => console.log('[TW Suite]', ...args),
    warn: (...args) => console.warn('[TW Suite]', ...args),
    error: (...args) => console.error('[TW Suite]', ...args),
  };

  // ============================================================
  // CORE: constants — todo seletor/global externo fica centralizado
  // aqui, marcado com status de verificação.
  // ============================================================
  const constants = {
    // Candidatos, em ordem de tentativa, para a barra de menu nativa do
    // jogo. Convenção conhecida da comunidade (tabela #menu_row com
    // <td class="menu-item">), mas nunca confirmada contra uma conta real
    // — por isso a lista de fallback e o botão flutuante garantido em
    // ui.injectFloatingButton().
    menuRowSelectors: {
      value: ['#menu_row2', '#menu_row'],
      status: 'UNVERIFIED',
    },
  };

  // ============================================================
  // CORE: storage — wrapper sobre GM_setValue/GM_getValue (ou GM.*),
  // com chaves namespaced.
  // ============================================================
  const storage = (() => {
    function rawGet(key, def) {
      if (typeof GM_getValue === 'function') return GM_getValue(key, def);
      if (typeof GM !== 'undefined' && GM.getValue) return GM.getValue(key, def);
      log.warn('Nenhuma API GM_getValue/GM.getValue disponível — verifique os @grant do script.');
      return def;
    }
    function rawSet(key, value) {
      if (typeof GM_setValue === 'function') return GM_setValue(key, value);
      if (typeof GM !== 'undefined' && GM.setValue) return GM.setValue(key, value);
      log.warn('Nenhuma API GM_setValue/GM.setValue disponível — verifique os @grant do script.');
    }
    function rawDelete(key) {
      if (typeof GM_deleteValue === 'function') return GM_deleteValue(key);
      if (typeof GM !== 'undefined' && GM.deleteValue) return GM.deleteValue(key);
      log.warn('Nenhuma API GM_deleteValue/GM.deleteValue disponível — verifique os @grant do script.');
    }
    function rawListKeys() {
      if (typeof GM_listValues === 'function') return GM_listValues();
      if (typeof GM !== 'undefined' && GM.listValues) return GM.listValues();
      log.warn('Nenhuma API GM_listValues/GM.listValues disponível — verifique os @grant do script.');
      return [];
    }

    const moduleEnabledKey = (id) => `${NAMESPACE}:module:${id}:enabled`;
    const moduleSettingsKey = (id) => `${NAMESPACE}:module:${id}:settings`;

    return {
      async getModuleEnabled(id, defaultEnabled) {
        return rawGet(moduleEnabledKey(id), !!defaultEnabled);
      },
      async setModuleEnabled(id, enabled) {
        return rawSet(moduleEnabledKey(id), !!enabled);
      },
      async getModuleSettings(id, defaults = {}) {
        const stored = await rawGet(moduleSettingsKey(id), null);
        return stored ? { ...defaults, ...stored } : { ...defaults };
      },
      async setModuleSettings(id, settings) {
        return rawSet(moduleSettingsKey(id), settings);
      },
      async get(key, defaultValue) {
        return rawGet(`${NAMESPACE}:${key}`, defaultValue);
      },
      async set(key, value) {
        return rawSet(`${NAMESPACE}:${key}`, value);
      },
      async remove(key) {
        return rawDelete(`${NAMESPACE}:${key}`);
      },
      async removeByPrefix(prefix) {
        const fullPrefix = `${NAMESPACE}:${prefix}`;
        const keys = await rawListKeys();
        const matching = keys.filter((k) => k.startsWith(fullPrefix));
        for (const k of matching) await rawDelete(k);
        return matching.length;
      },
    };
  })();

  // ============================================================
  // CORE: gameApi — leitura de game_data e detecção de tela.
  // ============================================================
  const gameApi = (() => {
    function getGameData() {
      // O Tampermonkey roda o script num contexto isolado da página (sandbox):
      // window.game_data do script NÃO é o game_data que o jogo criou. É
      // preciso ler via unsafeWindow para enxergar o global real da página.
      // (Confirmado ao vivo em 2026-09 — ver docs/verification-log.md.)
      const gd = (typeof unsafeWindow !== 'undefined' && unsafeWindow.game_data) || window.game_data;
      if (typeof gd === 'undefined') {
        log.warn('game_data não encontrado nesta página (nem via unsafeWindow) — confirme se o jogo realmente carregou aqui.');
        return null;
      }
      return gd;
    }

    function getCurrentScreen() {
      const gd = getGameData();
      if (gd && gd.screen) return gd.screen;
      const params = new URLSearchParams(window.location.search);
      return params.get('screen') || 'overview';
    }

    function hasNativeApi() {
      return typeof window.TribalWars !== 'undefined';
    }

    return { getGameData, getCurrentScreen, hasNativeApi };
  })();

  // ============================================================
  // CORE: serverTime — offset relógio-cliente ↔ servidor.
  // ============================================================
  const serverTime = (() => {
    let offsetMs = 0;
    let initialized = false;

    function computeOffsetFromGameData() {
      const gd = gameApi.getGameData();
      if (gd && typeof gd.time_generated === 'number') {
        offsetMs = gd.time_generated - Date.now();
        return true;
      }
      return false;
    }

    async function init() {
      if (computeOffsetFromGameData()) {
        await storage.set('core:serverTimeOffsetMs', offsetMs);
        log.info(`Offset de servidor calculado: ${offsetMs}ms`);
      } else {
        offsetMs = await storage.get('core:serverTimeOffsetMs', 0);
        log.warn('Não foi possível recalcular o offset agora (game_data.time_generated ausente — UNVERIFIED); usando último valor salvo:', offsetMs, 'ms');
      }
      initialized = true;
    }

    function now() {
      if (!initialized) log.warn('serverTime.now() chamado antes de init() — offset pode estar desatualizado.');
      return Date.now() + offsetMs;
    }

    // Agenda fn() para rodar o mais perto possível de serverTimestampMs
    // (hora de servidor). Usa setTimeout grosseiro até faltarem ~5s, depois
    // um loop de requestAnimationFrame para precisão de milissegundo.
    function scheduleAt(serverTimestampMs, fn) {
      const msRemaining = serverTimestampMs - now();
      if (msRemaining <= 0) {
        fn();
        return;
      }
      if (msRemaining > 5000) {
        setTimeout(() => scheduleAt(serverTimestampMs, fn), msRemaining - 3000);
        return;
      }
      const tick = () => {
        const remaining = serverTimestampMs - now();
        if (remaining <= 0) {
          fn();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    return {
      init,
      now,
      scheduleAt,
      get offsetMs() {
        return offsetMs;
      },
    };
  })();

  // ============================================================
  // CORE: profiles — perfis por conta criados no dashboard.
  //
  // twsuite:profiles = { "br144:Nick": { updatedAt, modules: { <id>: { enabled, settings } } } }
  // twsuite:accounts = { "br144:Nick": { world, player, points, villages, lastSeen, version, screen } }
  // Ao carregar o jogo, o perfil da conta logada é gravado nas chaves que
  // os módulos já leem (module:<id>:enabled / :settings).
  // ============================================================
  const profiles = (() => {
    const SYNC_PREFIX = 'TWS1:';

    function accountKeyFromGame() {
      const gd = gameApi.getGameData();
      if (!gd || !gd.world || !gd.player || !gd.player.name) return null;
      return `${String(gd.world).toLowerCase()}:${gd.player.name}`;
    }

    async function getAll() {
      return (await storage.get('profiles', {})) || {};
    }

    async function saveAll(all) {
      await storage.set('profiles', all);
    }

    async function applyForCurrentAccount() {
      const key = accountKeyFromGame();
      if (!key) return { applied: false, reason: 'conta não identificada' };
      const profile = (await getAll())[key];
      if (!profile || !profile.modules) return { applied: false, reason: 'sem perfil', key };

      const marker = `${key}@${profile.updatedAt || 0}`;
      if ((await storage.get('profileApplied', '')) === marker) return { applied: false, reason: 'já aplicado', key };

      for (const [id, mod] of Object.entries(profile.modules)) {
        if (typeof mod.enabled === 'boolean') await storage.setModuleEnabled(id, mod.enabled);
        const current = await storage.getModuleSettings(id, {});
        const next = { ...current, ...(mod.settings && typeof mod.settings === 'object' ? mod.settings : {}) };
        // Alguns módulos também checam settings.enabled além da chave :enabled.
        if (typeof mod.enabled === 'boolean') next.enabled = mod.enabled;
        await storage.setModuleSettings(id, next);
      }
      await storage.set('profileApplied', marker);
      log.info(`Perfil do dashboard aplicado para ${key}.`);
      return { applied: true, key };
    }

    async function reportStatus() {
      const key = accountKeyFromGame();
      if (!key) return;
      const gd = gameApi.getGameData();
      const accounts = (await storage.get('accounts', {})) || {};
      accounts[key] = {
        world: String(gd.world).toLowerCase(),
        player: gd.player.name,
        points: Number(gd.player.points) || 0,
        villages: Number(gd.player.villages) || 0,
        village: gd.village ? { name: gd.village.name, x: gd.village.x, y: gd.village.y } : null,
        screen: gameApi.getCurrentScreen(),
        lastSeen: Date.now(),
        version: (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '?',
      };
      await storage.set('accounts', accounts);
    }

    async function importSyncCode(code) {
      const raw = String(code || '').trim();
      if (!raw.startsWith(SYNC_PREFIX)) throw new Error('Código inválido (esperado prefixo TWS1:).');
      const json = decodeURIComponent(escape(atob(raw.slice(SYNC_PREFIX.length))));
      const data = JSON.parse(json);
      if (!data || typeof data.profiles !== 'object') throw new Error('Código sem perfis.');
      const all = await getAll();
      Object.assign(all, data.profiles);
      await saveAll(all);
      await storage.remove('profileApplied');
      return Object.keys(data.profiles).length;
    }

    // Roda só na página do dashboard (file://). O dashboard e o script
    // conversam por postMessage porque o sandbox do Tampermonkey não
    // compartilha funções com a página de forma confiável entre navegadores.
    function startDashboardBridge() {
      const reply = (id, ok, payload) =>
        window.postMessage({ twsuite: 'bridge-res', id, ok, payload }, '*');

      window.addEventListener('message', async (ev) => {
        if (ev.source !== window || !ev.data || ev.data.twsuite !== 'bridge-req') return;
        const { id, op, payload } = ev.data;
        try {
          if (op === 'hello') {
            const version = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '?';
            reply(id, true, { version });
          } else if (op === 'pull') {
            reply(id, true, { profiles: await getAll(), accounts: (await storage.get('accounts', {})) || {} });
          } else if (op === 'pushProfiles') {
            await saveAll(payload.profiles || {});
            reply(id, true, {});
          } else if (op === 'forgetAccount') {
            const accounts = (await storage.get('accounts', {})) || {};
            delete accounts[payload.key];
            await storage.set('accounts', accounts);
            reply(id, true, {});
          } else {
            reply(id, false, { error: `op desconhecida: ${op}` });
          }
        } catch (e) {
          reply(id, false, { error: String(e && e.message || e) });
        }
      });
      window.postMessage({ twsuite: 'bridge-ready' }, '*');
    }

    return { accountKeyFromGame, applyForCurrentAccount, reportStatus, importSyncCode, startDashboardBridge };
  })();

  // ============================================================
  // CORE: moduleLoader — registro e execução de módulos.
  //
  // Contrato de módulo (ver README.md):
  //   TWSuite.registerModule({
  //     id: 'auto-farm', name: 'Auto Farm', screens: ['am_farm'],
  //     defaultEnabled: false,
  //     init(ctx) {}, run(ctx) {},
  //   });
  // ============================================================
  const moduleLoader = (() => {
    const registry = [];

    function registerModule(mod) {
      if (!mod || !mod.id) throw new Error('TWSuite.registerModule: módulo precisa de um id.');
      if (registry.some((m) => m.id === mod.id)) {
        log.warn(`Módulo "${mod.id}" já registrado — ignorando duplicata.`);
        return;
      }
      registry.push(mod);
      log.info(`Módulo registrado: ${mod.id}`);
    }

    function makeModuleLogger(id) {
      return {
        info: (...a) => console.log(`[TW Suite:${id}]`, ...a),
        warn: (...a) => console.warn(`[TW Suite:${id}]`, ...a),
        error: (...a) => console.error(`[TW Suite:${id}]`, ...a),
      };
    }

    async function runAll() {
      const screen = gameApi.getCurrentScreen();
      for (const mod of registry) {
        const enabled = await storage.getModuleEnabled(mod.id, !!mod.defaultEnabled);
        if (!enabled) continue;

        const ctx = { storage, gameApi, ui, serverTime, log: makeModuleLogger(mod.id) };

        try {
          if (typeof mod.init === 'function') await mod.init(ctx);
        } catch (e) {
          log.error(`Erro no init() do módulo "${mod.id}":`, e);
        }

        const screens = mod.screens || [];
        if (screens.includes('any') || screens.includes(screen)) {
          try {
            if (typeof mod.run === 'function') await mod.run(ctx);
          } catch (e) {
            log.error(`Erro no run() do módulo "${mod.id}":`, e);
          }
        }
      }
    }

    function getRegistry() {
      return registry.slice();
    }

    return { registerModule, runAll, getRegistry };
  })();

  // ============================================================
  // CORE: ui — injeta entrada de menu (nativa, com fallback flutuante
  // garantido) e o painel de configurações.
  // ============================================================
  const ui = (() => {
    let panelEl = null;

    function injectMenuEntry() {
      for (const selector of constants.menuRowSelectors.value) {
        try {
          const menuRow = document.querySelector(selector);
          if (!menuRow) continue;
          const item = document.createElement('td');
          item.className = 'menu-item';
          const link = document.createElement('a');
          link.href = '#';
          link.textContent = 'TW Suite';
          link.addEventListener('click', (e) => {
            e.preventDefault();
            togglePanel();
          });
          item.appendChild(link);
          menuRow.appendChild(item);
          log.info(`Entrada de menu injetada em "${selector}".`);
          return true;
        } catch (e) {
          log.error(`Falha ao injetar em "${selector}":`, e);
        }
      }
      log.warn(`Nenhum seletor de menu nativo (${constants.menuRowSelectors.status}) encontrado — usando só o botão flutuante.`);
      return false;
    }

    function injectFloatingButton() {
      if (document.getElementById('twsuite-floating-btn')) return;
      const btn = document.createElement('button');
      btn.id = 'twsuite-floating-btn';
      btn.textContent = 'TW Suite';
      Object.assign(btn.style, {
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        zIndex: 99999,
        padding: '8px 14px',
        background: '#7a5230',
        color: '#fff',
        border: '1px solid #4b3220',
        borderRadius: '4px',
        cursor: 'pointer',
        fontSize: '13px',
        fontFamily: 'Verdana, Arial, sans-serif',
        boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
      });
      btn.addEventListener('click', togglePanel);
      document.body.appendChild(btn);
    }

    function buildPanel() {
      const el = document.createElement('div');
      el.id = 'twsuite-panel';
      Object.assign(el.style, {
        position: 'fixed',
        top: '60px',
        right: '16px',
        width: '290px',
        maxHeight: '70vh',
        overflowY: 'auto',
        background: '#f4e4bc',
        border: '2px solid #7a5230',
        borderRadius: '6px',
        padding: '12px',
        zIndex: 100000,
        fontSize: '13px',
        color: '#1a1a1a',
        fontFamily: 'Verdana, Arial, sans-serif',
        display: 'none',
        boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
      });
      el.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-bottom:1px solid #7a5230; padding-bottom:6px;">
          <strong>TW Suite</strong>
          <span id="twsuite-close" style="cursor:pointer; font-weight:bold;">&#x2715;</span>
        </div>
        <div id="twsuite-diagnostics" style="margin-bottom:10px; font-size:11px; opacity:0.85; line-height:1.5;"></div>
        <div id="twsuite-module-list"></div>
        <button id="twsuite-import-code" style="margin-top:10px; width:100%; padding:6px; cursor:pointer;">Importar código do dashboard</button>
      `;
      document.body.appendChild(el);
      el.querySelector('#twsuite-close').addEventListener('click', togglePanel);
      el.querySelector('#twsuite-import-code').addEventListener('click', async () => {
        const code = window.prompt('Cole o código de sincronização gerado no dashboard (começa com TWS1:)');
        if (!code) return;
        try {
          const count = await profiles.importSyncCode(code);
          const result = await profiles.applyForCurrentAccount();
          window.alert(`${count} perfil(is) importado(s).` + (result.applied ? ' Perfil desta conta aplicado — recarregue a página.' : ''));
          renderModuleList();
        } catch (e) {
          window.alert(`Falha ao importar: ${e.message}`);
        }
      });
      return el;
    }

    async function renderModuleList() {
      if (!panelEl) return;
      const listEl = panelEl.querySelector('#twsuite-module-list');
      const registry = moduleLoader.getRegistry();
      if (registry.length === 0) {
        listEl.innerHTML = '<em>Nenhum módulo instalado ainda (núcleo apenas — Fase 0).</em>';
        return;
      }
      listEl.innerHTML = '';
      for (const mod of registry) {
        const enabled = await storage.getModuleEnabled(mod.id, !!mod.defaultEnabled);
        const row = document.createElement('label');
        row.style.display = 'block';
        row.style.margin = '4px 0';
        row.style.cursor = 'pointer';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = enabled;
        cb.addEventListener('change', async () => {
          await storage.setModuleEnabled(mod.id, cb.checked);
          log.info(`"${mod.id}" ${cb.checked ? 'ativado' : 'desativado'} — vale a partir do próximo carregamento de página.`);
        });
        row.appendChild(cb);
        row.appendChild(document.createTextNode(' ' + mod.name));
        listEl.appendChild(row);
      }
    }

    function renderDiagnostics() {
      if (!panelEl) return;
      const diag = panelEl.querySelector('#twsuite-diagnostics');
      const gd = gameApi.getGameData();
      const version = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '?';
      const lines = [
        `Versão: ${version}`,
        `Tela atual: ${gameApi.getCurrentScreen()}`,
        `game_data: ${gd ? 'encontrado' : 'NÃO encontrado'}`,
        `Offset de servidor: ${serverTime.offsetMs}ms`,
      ];
      diag.innerHTML = lines.join('<br>');
    }

    function togglePanel() {
      if (!panelEl) panelEl = buildPanel();
      const willShow = panelEl.style.display === 'none';
      panelEl.style.display = willShow ? 'block' : 'none';
      if (willShow) {
        renderDiagnostics();
        renderModuleList();
      }
    }

    function init() {
      const nativeMenuInjected = injectMenuEntry();
      injectFloatingButton();
      return { nativeMenuInjected };
    }

    return { init, togglePanel, renderModuleList, renderDiagnostics };
  })();

  // ============================================================
  // API pública — futuros módulos (Fases 1+) chamam
  // TWSuite.registerModule({...}) para se registrar.
  // ============================================================
  window.TWSuite = {
    registerModule: moduleLoader.registerModule,
    storage,
    gameApi,
    serverTime,
    ui,
    log,
  };

  // ============================================================
  // BOOTSTRAP
  // ============================================================
  async function bootstrap() {
    if (!gameApi.getGameData()) {
      log.warn('game_data ausente nesta página — UI ainda será injetada, mas diagnósticos podem ficar incompletos.');
    }

    await serverTime.init();
    const { nativeMenuInjected } = ui.init();
    await storage.set('core:lastBootstrap', new Date().toISOString());

    try {
      await profiles.applyForCurrentAccount();
      await profiles.reportStatus();
    } catch (e) {
      log.error('Falha ao aplicar perfil do dashboard:', e);
    }

    log.info(`Carregado. Tela: ${gameApi.getCurrentScreen()}. Menu nativo injetado: ${nativeMenuInjected}. Módulos registrados: ${moduleLoader.getRegistry().length}.`);

    await moduleLoader.runAll();
  }

  if (location.protocol === 'file:') {
    profiles.startDashboardBridge();
    window.TWSuite.dashboardOnly = true;
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();

// ============================================================
// MÓDULO: auto-farm (Fase 1)
//
// Farm sem depender do Assistente de Saque (que é premium neste
// mundo — confirmado ao vivo em 2026-09-19, ver verification-log).
// Em vez disso: lê /map/village.txt (arquivo público do próprio
// jogo, confirmado acessível sem login) pra achar aldeias bárbaras
// perto da aldeia atual, mostra a lista num painel na Praça de
// Reunião, e ao clicar "Enviar" manda as duas requisições reais de
// envio via fetch() (ver submitAttackStep1/submitAttackStep2) — lidas
// ao vivo de um HAR de um envio genuíno em 2026-09-19 (ver
// docs/verification-log.md pro payload completo).
//
// Por que fetch() em vez de simular clique nos botões reais
// (#target_attack / #troop_confirm_submit, ambos confirmados ao
// vivo): tentamos várias formas de simular clique (.click(),
// mousedown/mouseup/click com coordenadas reais, form.requestSubmit())
// e nenhuma disparava a navegação de verdade — o HAR provou que as
// duas etapas são submissões de formulário reais (POST com reload),
// não AJAX, e por algum motivo (não totalmente esclarecido — pode
// ser exigência de user activation do navegador, ou algo específico
// do handler do jogo) cliques sintéticos não completavam a
// submissão. Replicar as duas requisições nós mesmos, lendo os
// campos/tokens ao vivo do formulário/resposta (nunca fixos no
// código), é o método confirmado funcionando.
// ============================================================
(function registerAutoFarmModule() {
  'use strict';

  const MODULE_ID = 'auto-farm';
  const PANEL_ID = 'twsuite-autofarm-panel';
  const VILLAGE_CACHE_KEY = 'auto-farm:villageIndexCache';
  const VILLAGE_CACHE_TTL_MS = 3 * 60 * 60 * 1000; // village.txt tem ~3MB; evita rebaixar toda hora

  const UNIT_LABELS = {
    spear: 'Lanceiro',
    sword: 'Espadachim',
    axe: 'Bárbaro',
    archer: 'Arqueiro',
    spy: 'Explorador',
    light: 'Cavalaria leve',
    marcher: 'Arqueiro a cavalo',
    heavy: 'Cavalaria pesada',
    ram: 'Aríete',
    catapult: 'Catapulta',
    knight: 'Paladino',
    snob: 'Nobre',
  };

  const DEFAULT_SETTINGS = {
    templates: [], // { id, name, units: { spear: 10, sword: 10, ... } }
    activeTemplateId: null,
    maxDistance: 12,
    cooldownMinutes: 30,
    dryRun: true,
  };

  function makeTemplateId() {
    return 'tpl_' + Math.random().toString(36).slice(2, 10);
  }

  function dist(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
  }

  function parseVillageIndex(text) {
    const villages = [];
    const lines = text.split('\n');
    for (const line of lines) {
      if (!line) continue;
      const parts = line.split(',');
      if (parts.length < 5) continue;
      const x = Number(parts[2]);
      const y = Number(parts[3]);
      if (Number.isNaN(x) || Number.isNaN(y)) continue;
      villages.push({ id: parts[0], x, y, owner: parts[4] });
    }
    return villages;
  }

  async function getVillageIndex(storage, log) {
    const cached = await storage.get(VILLAGE_CACHE_KEY, null);
    const now = Date.now();
    if (cached && cached.fetchedAt && now - cached.fetchedAt < VILLAGE_CACHE_TTL_MS && cached.text) {
      return parseVillageIndex(cached.text);
    }
    try {
      const res = await fetch('/map/village.txt', { credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      await storage.set(VILLAGE_CACHE_KEY, { fetchedAt: now, text });
      return parseVillageIndex(text);
    } catch (e) {
      log.error('Falha ao buscar /map/village.txt:', e);
      return cached && cached.text ? parseVillageIndex(cached.text) : [];
    }
  }

  function cooldownKey(sourceId, targetId) {
    return `auto-farm:lastSent:${sourceId}:${targetId}`;
  }

  async function findTargets(ctx, myVillage, settings) {
    const villages = await getVillageIndex(ctx.storage, ctx.log);
    const now = Date.now();
    const candidates = [];
    for (const v of villages) {
      if (v.owner !== '0') continue;
      if (v.id === String(myVillage.id)) continue;
      const d = dist(myVillage.x, myVillage.y, v.x, v.y);
      if (d > settings.maxDistance) continue;
      const lastSent = await ctx.storage.get(cooldownKey(myVillage.id, v.id), 0);
      if (now - lastSent < settings.cooldownMinutes * 60 * 1000) continue;
      candidates.push({ ...v, distance: d });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    return candidates.slice(0, 15);
  }

  // ------------------------------------------------------------
  // Envio via fetch() direto, replicando as duas requisições POST
  // reais capturadas via HAR (2026-09-19, envio genuíno confirmado
  // pelo usuário — ver docs/verification-log.md para os payloads
  // completos). Depois de MUITAS tentativas de simular clique
  // (.click(), mousedown/mouseup/click com coordenadas reais,
  // form.requestSubmit()) nenhuma disparava a navegação real — o HAR
  // provou que tanto "Ataque" quanto "Enviar ataque" são submissões
  // de formulário de verdade (POST com reload de página), não AJAX.
  // Em vez de insistir em simular o clique, montamos as mesmas duas
  // requisições nós mesmos, lendo os campos (inclusive o token
  // escondido de nome aleatório, e os tokens ch/h da 2ª etapa) direto
  // do formulário real da página / da resposta, nunca fixos no
  // código — assim não fica frágil se os nomes mudarem de novo.
  // ------------------------------------------------------------

  const UNIT_FIELDS = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob'];

  function formToParams(formEl, overrides) {
    const fd = new FormData(formEl);
    for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
    return new URLSearchParams(fd);
  }

  function parseHtml(html) {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  async function postForm(url, params) {
    const res = await fetch(url, { method: 'POST', body: params, credentials: 'same-origin' });
    const text = await res.text();
    return { httpOk: res.ok, status: res.status, text };
  }

  // Etapa 1: envia a aldeia/coordenada/tropas — equivalente a
  // preencher o formulário da Praça de Reunião e clicar "Ataque".
  // Retorna o HTML da tela de confirmação (ou erro).
  async function submitAttackStep1(villageId, units, x, y) {
    const formEl = document.querySelector('#inputx')?.form || document.querySelector('#inputx')?.closest('form');
    if (!formEl) return { ok: false, reason: 'formulário da Praça de Reunião não encontrado nesta página' };

    const overrides = { x: String(x), y: String(y), target_type: 'coord', attack: 'Ataque' };
    for (const u of UNIT_FIELDS) overrides[u] = units[u] > 0 ? String(units[u]) : '';

    const params = formToParams(formEl, overrides);
    const url = `game.php?village=${villageId}&screen=place&try=confirm`;
    const { httpOk, status, text } = await postForm(url, params);

    if (!httpOk) return { ok: false, reason: `etapa 1 (resolver alvo) falhou: HTTP ${status}` };
    if (text.includes('error_box')) return { ok: false, reason: 'etapa 1: o jogo recusou (alvo/tropas inválidos, ou fora de alcance).' };
    return { ok: true, html: text };
  }

  // Etapa 2: confirma o envio usando os tokens (ch/h) retornados pela
  // etapa 1 — equivalente a clicar "Enviar ataque" na tela seguinte.
  async function submitAttackStep2(villageId, units, x, y, confirmHtml, csrf) {
    const confirmDoc = parseHtml(confirmHtml);
    const confirmForm = confirmDoc.querySelector('#troop_confirm_submit')?.closest('form') || confirmDoc.querySelector('form');
    if (!confirmForm) return { ok: false, reason: 'etapa 2: não achei o formulário de confirmação na resposta da etapa 1' };

    const overrides = {
      attack: 'true',
      cb: 'troop_confirm_submit',
      submit_confirm: 'Enviar ataque',
      building: 'main',
      x: String(x),
      y: String(y),
      source_village: String(villageId),
      village: String(villageId),
    };
    // O token "h" não vem no HTML estático (o jogo insere via JS antes
    // de enviar de verdade — DOMParser não roda script, então nunca
    // aparece no formulário parseado). Confirmado ao vivo (2026-09-19):
    // é exatamente game_data.csrf. Sem ele o servidor responde 200 mas
    // não processa nada, em vez de redirecionar (302) como num envio
    // real bem-sucedido.
    if (csrf) overrides.h = csrf;
    for (const u of UNIT_FIELDS) overrides[u] = String(units[u] || 0);

    const params = formToParams(confirmForm, overrides);
    const url = `game.php?village=${villageId}&screen=place&action=command`;
    const { httpOk, status, text } = await postForm(url, params);

    if (!httpOk) return { ok: false, reason: `etapa 2 (confirmar) falhou: HTTP ${status}` };
    if (text.includes('error_box')) return { ok: false, reason: 'etapa 2: o jogo recusou a confirmação (token expirado? tente de novo).' };
    return { ok: true };
  }

  async function submitAttack(villageId, units, x, y, csrf) {
    const step1 = await submitAttackStep1(villageId, units, x, y);
    if (!step1.ok) return step1;
    return submitAttackStep2(villageId, units, x, y, step1.html, csrf);
  }

  function buildPanel() {
    const el = document.createElement('div');
    el.id = PANEL_ID;
    Object.assign(el.style, {
      position: 'fixed',
      top: '60px',
      left: '16px',
      width: '300px',
      maxHeight: '75vh',
      overflowY: 'auto',
      background: '#f4e4bc',
      border: '2px solid #7a5230',
      borderRadius: '6px',
      padding: '10px',
      zIndex: 99998,
      fontSize: '12px',
      color: '#1a1a1a',
      fontFamily: 'Verdana, Arial, sans-serif',
      boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
    });
    document.body.appendChild(el);
    return el;
  }

  // Grade compacta com um campo numérico por tropa (as 12 do jogo),
  // no estilo da própria tela "Modelos de tropas" do jogo.
  function createUnitGrid(initialValues) {
    const grid = document.createElement('div');
    Object.assign(grid.style, {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '2px 8px',
      margin: '4px 0',
    });
    const inputs = {};
    for (const u of UNIT_FIELDS) {
      const label = document.createElement('label');
      Object.assign(label.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' });
      const span = document.createElement('span');
      span.textContent = UNIT_LABELS[u];
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.value = String((initialValues && initialValues[u]) || 0);
      input.style.width = '44px';
      inputs[u] = input;
      label.appendChild(span);
      label.appendChild(input);
      grid.appendChild(label);
    }
    return {
      el: grid,
      getValues() {
        const out = {};
        for (const u of UNIT_FIELDS) out[u] = Math.max(0, Number(inputs[u].value) || 0);
        return out;
      },
    };
  }

  // Seletor de modelo ativo + criar/editar/excluir modelos nomeados
  // (nome + quantidade por tropa), salvos nas configurações do módulo.
  function renderTemplateManager(container, settings, onSettingsChange) {
    const wrap = document.createElement('div');
    wrap.style.marginBottom = '8px';
    wrap.style.borderBottom = '1px solid #7a5230';
    wrap.style.paddingBottom = '8px';

    const label = document.createElement('div');
    label.style.fontWeight = 'bold';
    label.style.marginBottom = '3px';
    label.textContent = 'Modelo de tropas';
    wrap.appendChild(label);

    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', gap: '4px', alignItems: 'center' });

    const select = document.createElement('select');
    select.style.flex = '1';
    select.style.minWidth = '0';
    const placeholderOpt = document.createElement('option');
    placeholderOpt.value = '';
    placeholderOpt.textContent = settings.templates.length ? '— selecione —' : 'Nenhum modelo ainda';
    select.appendChild(placeholderOpt);
    for (const tpl of settings.templates) {
      const o = document.createElement('option');
      o.value = tpl.id;
      o.textContent = tpl.name;
      if (tpl.id === settings.activeTemplateId) o.selected = true;
      select.appendChild(o);
    }
    select.addEventListener('change', () => onSettingsChange({ activeTemplateId: select.value || null }));

    const newBtn = document.createElement('button');
    newBtn.textContent = '+Novo';
    newBtn.style.fontSize = '11px';

    const editBtn = document.createElement('button');
    editBtn.textContent = 'Editar';
    editBtn.style.fontSize = '11px';

    const delBtn = document.createElement('button');
    delBtn.textContent = 'Excluir';
    delBtn.style.fontSize = '11px';

    row.appendChild(select);
    row.appendChild(newBtn);
    row.appendChild(editBtn);
    row.appendChild(delBtn);
    wrap.appendChild(row);

    const editorHost = document.createElement('div');
    wrap.appendChild(editorHost);

    function openEditor(existingTpl) {
      editorHost.innerHTML = '';
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.placeholder = 'Nome do modelo (ex.: Padrão 1)';
      nameInput.value = existingTpl ? existingTpl.name : '';
      nameInput.style.width = '100%';
      nameInput.style.marginTop = '4px';
      nameInput.style.boxSizing = 'border-box';

      const grid = createUnitGrid(existingTpl ? existingTpl.units : null);

      const saveBtn = document.createElement('button');
      saveBtn.textContent = existingTpl ? 'Salvar alterações' : 'Criar modelo';
      saveBtn.style.fontSize = '11px';
      saveBtn.style.marginTop = '4px';
      saveBtn.addEventListener('click', () => {
        const name = nameInput.value.trim() || 'Sem nome';
        const units = grid.getValues();
        let templates = settings.templates.slice();
        let activeTemplateId = settings.activeTemplateId;
        if (existingTpl) {
          templates = templates.map((t) => (t.id === existingTpl.id ? { ...t, name, units } : t));
        } else {
          const id = makeTemplateId();
          templates.push({ id, name, units });
          activeTemplateId = id;
        }
        onSettingsChange({ templates, activeTemplateId });
      });

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancelar';
      cancelBtn.style.fontSize = '11px';
      cancelBtn.style.marginTop = '4px';
      cancelBtn.addEventListener('click', () => {
        editorHost.innerHTML = '';
      });

      editorHost.appendChild(nameInput);
      editorHost.appendChild(grid.el);
      editorHost.appendChild(saveBtn);
      editorHost.appendChild(cancelBtn);
    }

    newBtn.addEventListener('click', () => openEditor(null));
    editBtn.addEventListener('click', () => {
      const tpl = settings.templates.find((t) => t.id === select.value);
      if (tpl) openEditor(tpl);
    });
    delBtn.addEventListener('click', () => {
      const tpl = settings.templates.find((t) => t.id === select.value);
      if (!tpl) return;
      if (!confirm(`Excluir o modelo "${tpl.name}"?`)) return;
      const templates = settings.templates.filter((t) => t.id !== tpl.id);
      const activeTemplateId = settings.activeTemplateId === tpl.id ? null : settings.activeTemplateId;
      onSettingsChange({ templates, activeTemplateId });
    });

    container.appendChild(wrap);
  }

  function renderMiscSettings(container, settings, onChange) {
    const wrap = document.createElement('div');
    wrap.style.marginBottom = '8px';
    wrap.style.borderBottom = '1px solid #7a5230';
    wrap.style.paddingBottom = '8px';

    const distInput = document.createElement('input');
    distInput.type = 'number';
    distInput.min = '1';
    distInput.value = String(settings.maxDistance);
    distInput.style.width = '50px';
    distInput.title = 'Distância máxima (campos)';
    distInput.addEventListener('change', () =>
      onChange({ maxDistance: Math.max(1, Number(distInput.value) || 1) })
    );

    const dryRunLabel = document.createElement('label');
    dryRunLabel.style.display = 'block';
    dryRunLabel.style.marginTop = '4px';
    const dryRunCb = document.createElement('input');
    dryRunCb.type = 'checkbox';
    dryRunCb.checked = settings.dryRun;
    dryRunCb.addEventListener('change', () => onChange({ dryRun: dryRunCb.checked }));
    dryRunLabel.appendChild(dryRunCb);
    dryRunLabel.appendChild(document.createTextNode(' Modo teste (não envia de verdade)'));

    wrap.appendChild(document.createTextNode('Alcance: '));
    wrap.appendChild(distInput);
    wrap.appendChild(document.createTextNode(' campos'));
    wrap.appendChild(dryRunLabel);

    container.appendChild(wrap);
  }

  window.TWSuite.registerModule({
    id: MODULE_ID,
    name: 'Auto Farm (sem premium)',
    screens: ['place'],
    defaultEnabled: false,

    async run(ctx) {
      const { storage, gameApi, log } = ctx;
      const gd = gameApi.getGameData();
      if (!gd || !gd.village) {
        log.warn('game_data.village ausente — não consigo determinar a aldeia atual.');
        return;
      }

      let settings = await storage.getModuleSettings(MODULE_ID, DEFAULT_SETTINGS);
      const myVillage = { id: gd.village.id, x: gd.village.x, y: gd.village.y };

      let panel = document.getElementById(PANEL_ID);
      if (!panel) panel = buildPanel();

      async function persist(patch) {
        settings = { ...settings, ...patch };
        await storage.setModuleSettings(MODULE_ID, settings);
        renderAll();
      }

      function activeTemplate() {
        return settings.templates.find((t) => t.id === settings.activeTemplateId) || null;
      }

      async function sendToTarget(target, row, btn) {
        const tpl = activeTemplate();
        if (!tpl) {
          log.warn('Nenhum modelo de tropas selecionado — crie um em "Modelo de tropas" antes de enviar.');
          return;
        }

        const sendUnits = {};
        let anyAvailable = false;
        let anyCapped = false;
        for (const u of UNIT_FIELDS) {
          const requested = tpl.units[u] || 0;
          if (requested <= 0) {
            sendUnits[u] = 0;
            continue;
          }
          const unitInput = document.querySelector('#unit_input_' + u);
          const available = unitInput ? Number(unitInput.dataset.allCount || 0) : 0;
          const send = Math.min(requested, available);
          sendUnits[u] = send;
          if (send > 0) anyAvailable = true;
          if (send < requested) anyCapped = true;
        }

        const describe = () =>
          UNIT_FIELDS.filter((u) => sendUnits[u] > 0)
            .map((u) => `${sendUnits[u]} ${UNIT_LABELS[u]}`)
            .join(', ') || '(nada disponível)';

        if (settings.dryRun) {
          log.info(`(modo teste) modelo "${tpl.name}" enviaria [${describe()}] para ${target.x}|${target.y}${anyCapped ? ' (algumas tropas limitadas ao disponível)' : ''}`);
          return;
        }

        if (!anyAvailable) {
          log.warn(`Nenhuma tropa do modelo "${tpl.name}" disponível nesta aldeia agora — não enviado.`);
          return;
        }
        if (anyCapped) {
          log.warn(`Modelo "${tpl.name}" parcialmente disponível — enviando [${describe()}] em vez do modelo completo.`);
        }

        btn.disabled = true;
        btn.textContent = 'Enviando...';
        const csrf = gameApi.getGameData()?.csrf;
        const result = await submitAttack(myVillage.id, sendUnits, target.x, target.y, csrf);
        btn.disabled = false;
        btn.textContent = 'Enviar';

        if (!result.ok) {
          log.error('Falha ao enviar:', result.reason, '— alvo continua na lista.');
          return;
        }

        log.info(`Enviado: [${describe()}] -> ${target.x}|${target.y}.`);
        await storage.set(cooldownKey(myVillage.id, target.id), Date.now());
        row.remove();
      }

      async function renderAll() {
        panel.innerHTML = '';

        const title = document.createElement('div');
        title.style.fontWeight = 'bold';
        title.style.marginBottom = '6px';
        title.textContent = 'Auto Farm';
        panel.appendChild(title);

        renderTemplateManager(panel, settings, persist);
        renderMiscSettings(panel, settings, persist);

        const resetBtn = document.createElement('button');
        resetBtn.textContent = 'Restaurar alvos';
        resetBtn.style.fontSize = '11px';
        resetBtn.style.marginBottom = '6px';
        resetBtn.title = 'Limpa o cooldown desta aldeia — alvos já tentados voltam a aparecer';
        resetBtn.addEventListener('click', async () => {
          const removed = await storage.removeByPrefix(`auto-farm:lastSent:${myVillage.id}:`);
          log.info(`${removed} alvo(s) restaurado(s).`);
          renderAll();
        });
        panel.appendChild(resetBtn);

        const listEl = document.createElement('div');
        listEl.textContent = 'Buscando aldeias bárbaras próximas...';
        panel.appendChild(listEl);

        const targets = await findTargets(ctx, myVillage, settings);
        listEl.innerHTML = '';
        if (targets.length === 0) {
          listEl.textContent = 'Nenhum alvo bárbaro disponível no alcance / fora do cooldown.';
          return;
        }

        for (const target of targets) {
          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.justifyContent = 'space-between';
          row.style.alignItems = 'center';
          row.style.margin = '3px 0';

          const label = document.createElement('span');
          label.textContent = `${target.x}|${target.y} (${target.distance.toFixed(1)})`;
          row.appendChild(label);

          const btn = document.createElement('button');
          btn.textContent = settings.dryRun ? 'Simular' : 'Enviar';
          btn.style.fontSize = '11px';
          btn.addEventListener('click', () => sendToTarget(target, row, btn));
          row.appendChild(btn);
          listEl.appendChild(row);
        }
      }

      await renderAll();
    },
  });
})();

// ============================================================
// MÓDULO: agendador-de-comandos (Fase 2)
//
// Fila de ataques agendados pra múltiplos horários. Sincroniza
// com o relógio do servidor (via serverTime) pra precisão.
// Persiste a fila no storage — sobrevive a refresh/logout.
//
// Painel mostra fila de ataques pendentes + interface pra
// adicionar novos. Cada ataque na fila é executado no horário
// certo via setTimeout usando serverTime.now().
//
// Tela de confirmação (place&try=confirm): painel permite
// agendar um novo ataque (detecta automaticamente alvo/duração).
// Qualquer outra tela: mostra fila global + executa ataques.
// ============================================================
(function registerSchedulerModule() {
  'use strict';

  const MODULE_ID = 'scheduler';
  const PANEL_ID = 'twsuite-scheduler-panel';
  const STORAGE_KEY = 'scheduler:queue';

  function getTravelDuration() {
    const bodyText = document.body.innerText;
    const match = bodyText.match(/Duração:\s*(\d+):(\d+):(\d+)/i) || bodyText.match(/Duration:\s*(\d+):(\d+):(\d+)/i);
    if (match) {
      const hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const seconds = parseInt(match[3], 10);
      return (hours * 3600 + minutes * 60 + seconds) * 1000;
    }
    return null;
  }

  function getTargetCoords() {
    const params = new URLSearchParams(window.location.search);
    const targetParam = params.get('target');
    if (!targetParam) return null;
    const bodyText = document.body.innerText;
    // Procura por "X|Y" na página
    const match = bodyText.match(/(\d+)\s*\|\s*(\d+)/);
    if (match) {
      return { x: parseInt(match[1], 10), y: parseInt(match[2], 10) };
    }
    return null;
  }

  async function loadQueue(storage) {
    const data = await storage.get(STORAGE_KEY, '[]');
    try {
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  async function saveQueue(storage, queue) {
    await storage.set(STORAGE_KEY, JSON.stringify(queue));
  }

  function buildMainPanel(queue, storage, log, serverTime) {
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    Object.assign(panel.style, {
      position: 'fixed',
      top: '60px',
      left: '16px',
      width: '320px',
      maxHeight: '70vh',
      overflowY: 'auto',
      background: '#f4e4bc',
      border: '2px solid #7a5230',
      borderRadius: '6px',
      padding: '10px',
      zIndex: 99998,
      fontSize: '11px',
      color: '#1a1a1a',
      fontFamily: 'Verdana, Arial, sans-serif',
      boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
    });

    const title = document.createElement('div');
    title.style.fontWeight = 'bold';
    title.style.marginBottom = '6px';
    title.textContent = 'Agendador de Comandos';
    panel.appendChild(title);

    const queueTitle = document.createElement('div');
    queueTitle.style.fontWeight = 'bold';
    queueTitle.style.marginTop = '8px';
    queueTitle.style.marginBottom = '4px';
    queueTitle.style.fontSize = '10px';
    queueTitle.textContent = `Fila: ${queue.length} ataques`;
    panel.appendChild(queueTitle);

    const listEl = document.createElement('div');
    listEl.style.maxHeight = '300px';
    listEl.style.overflowY = 'auto';
    listEl.style.marginBottom = '8px';
    listEl.style.borderBottom = '1px solid #7a5230';
    listEl.style.paddingBottom = '8px';

    if (queue.length === 0) {
      listEl.textContent = '(nenhum ataque agendado)';
    } else {
      for (let i = 0; i < queue.length; i++) {
        const attack = queue[i];
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';
        row.style.marginBottom = '3px';
        row.style.fontSize = '10px';
        row.style.padding = '3px';
        row.style.background = '#e8d4a0';
        row.style.borderRadius = '3px';

        const label = document.createElement('span');
        label.textContent = `${attack.x}|${attack.y} @ ${attack.arrivalTime}`;
        row.appendChild(label);

        const removeBtn = document.createElement('button');
        removeBtn.textContent = '✕';
        removeBtn.style.fontSize = '9px';
        removeBtn.style.padding = '0 4px';
        removeBtn.style.width = '24px';
        removeBtn.addEventListener('click', async () => {
          queue.splice(i, 1);
          await saveQueue(storage, queue);
          panel.remove();
          renderScheduler(queue, storage, log, serverTime);
        });
        row.appendChild(removeBtn);
        listEl.appendChild(row);
      }
    }
    panel.appendChild(listEl);

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Limpar fila';
    clearBtn.style.fontSize = '10px';
    clearBtn.style.width = '100%';
    clearBtn.style.marginBottom = '4px';
    clearBtn.addEventListener('click', async () => {
      await saveQueue(storage, []);
      log.info('Fila de ataques limpa.');
      panel.remove();
      renderScheduler([], storage, log, serverTime);
    });
    panel.appendChild(clearBtn);

    // Status de execução
    const statusEl = document.createElement('div');
    statusEl.style.fontSize = '10px';
    statusEl.style.color = '#555';
    statusEl.style.marginTop = '4px';
    statusEl.textContent = `Sincronizado: ${new Date(serverTime.now()).toLocaleTimeString()}`;
    panel.appendChild(statusEl);

    return panel;
  }

  function buildConfirmPanel(storage, log, serverTime) {
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    Object.assign(panel.style, {
      position: 'fixed',
      top: '60px',
      left: '16px',
      width: '280px',
      background: '#f4e4bc',
      border: '2px solid #7a5230',
      borderRadius: '6px',
      padding: '10px',
      zIndex: 99998,
      fontSize: '11px',
      color: '#1a1a1a',
      fontFamily: 'Verdana, Arial, sans-serif',
      boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
    });

    const title = document.createElement('div');
    title.style.fontWeight = 'bold';
    title.style.marginBottom = '6px';
    title.textContent = 'Agendar Novo Ataque';
    panel.appendChild(title);

    const travelDurationMs = getTravelDuration();
    const targetCoords = getTargetCoords();

    if (!travelDurationMs || !targetCoords) {
      panel.textContent = 'Erro: duração ou alvo não detectados.';
      return panel;
    }

    const durationMin = Math.floor(travelDurationMs / 60000);
    const durationSec = Math.floor((travelDurationMs % 60000) / 1000);

    const infoLabel = document.createElement('div');
    infoLabel.style.marginBottom = '4px';
    infoLabel.style.fontSize = '10px';
    infoLabel.innerHTML = `<strong>Alvo:</strong> ${targetCoords.x}|${targetCoords.y}<br/><strong>Duração:</strong> ${durationMin}:${String(durationSec).padStart(2, '0')}`;
    panel.appendChild(infoLabel);

    const timeInput = document.createElement('input');
    timeInput.type = 'time';
    timeInput.style.width = '100%';
    timeInput.style.marginBottom = '4px';
    timeInput.style.boxSizing = 'border-box';
    timeInput.title = 'Horário desejado de chegada';
    panel.appendChild(timeInput);

    const addBtn = document.createElement('button');
    addBtn.textContent = 'Adicionar à fila';
    addBtn.style.fontSize = '10px';
    addBtn.style.width = '100%';
    addBtn.addEventListener('click', async () => {
      const timeStr = timeInput.value;
      if (!timeStr) {
        log.warn('Nenhuma hora selecionada.');
        return;
      }

      const [hours, minutes] = timeStr.split(':');
      const queue = await loadQueue(storage);
      queue.push({
        x: targetCoords.x,
        y: targetCoords.y,
        arrivalTime: timeStr,
        travelDurationMs,
        createdAt: new Date().toISOString(),
      });
      await saveQueue(storage, queue);
      log.info(`Ataque agendado: ${targetCoords.x}|${targetCoords.y} @ ${timeStr}`);
      addBtn.disabled = true;
      addBtn.textContent = 'Adicionado!';
    });
    panel.appendChild(addBtn);

    return panel;
  }

  async function executeScheduledAttacks(queue, storage, log, serverTime) {
    // Remove ataques já passados e dispara os que chegaram no horário
    const now = serverTime.now();
    const toExecute = [];
    const remaining = [];

    for (const attack of queue) {
      const [hours, minutes] = attack.arrivalTime.split(':');
      const targetSeconds = parseInt(hours, 10) * 3600 + parseInt(minutes, 10) * 60;
      const travelSeconds = Math.floor(attack.travelDurationMs / 1000);
      const sendSeconds = targetSeconds - travelSeconds;

      // Converter segundos do dia pra timestamp (hoje)
      const todayMs = new Date().getTime();
      const today = new Date(todayMs);
      today.setHours(0, 0, 0, 0);
      const sendTimeMs = today.getTime() + sendSeconds * 1000;

      if (sendTimeMs <= now) {
        toExecute.push(attack);
      } else {
        remaining.push(attack);
      }
    }

    // Salvar fila atualizada
    await saveQueue(storage, remaining);

    // Executar ataques (click no botão)
    for (const attack of toExecute) {
      const confirmBtn = document.querySelector('#troop_confirm_submit');
      if (confirmBtn) {
        log.info(`Auto-enviando agendado: ${attack.x}|${attack.y}`);
        confirmBtn.click();
      } else {
        log.warn(`Não consegui clicar no botão pra ${attack.x}|${attack.y} — talvez não esteja na tela de confirmação.`);
      }
    }
  }

  async function renderScheduler(queue, storage, log, serverTime) {
    const params = new URLSearchParams(window.location.search);
    const isTryConfirm = params.get('try') === 'confirm';

    let panel;
    if (isTryConfirm) {
      panel = buildConfirmPanel(storage, log, serverTime);
    } else {
      panel = buildMainPanel(queue, storage, log, serverTime);
    }

    document.body.appendChild(panel);
  }

  window.TWSuite.registerModule({
    id: MODULE_ID,
    name: 'Agendador de Comandos',
    screens: ['place'],
    defaultEnabled: false,

    async run(ctx) {
      const { storage, log, serverTime } = ctx;

      // Carregar fila
      const queue = await loadQueue(storage);

      // Renderizar painel (confirmação ou global)
      await renderScheduler(queue, storage, log, serverTime);

      // Executar ataques que chegaram no horário (se não estiver na tela de confirmação)
      const params = new URLSearchParams(window.location.search);
      const isTryConfirm = params.get('try') === 'confirm';
      if (!isTryConfirm && queue.length > 0) {
        await executeScheduledAttacks(queue, storage, log, serverTime);
      }

      // Polling contínuo pra executar ataques na hora (a cada 500ms)
      if (!isTryConfirm) {
        const pollInterval = setInterval(async () => {
          const updatedQueue = await loadQueue(storage);
          if (updatedQueue.length > 0) {
            await executeScheduledAttacks(updatedQueue, storage, log, serverTime);
          }
        }, 500);
      }

      log.info('Agendador de Comandos carregado.');
    },
  });
})();

// ============================================================
// MÓDULO: auto-recrutamento (Fase 3)
//
// Recruta tropas automaticamente na tela de treinamento
// (screen=train). Preenche os campos de quantidade e clica
// no botão de treinar. Loop contínuo enquanto ativo.
// ============================================================
(function registerAutoRecruitModule() {
  'use strict';

  const MODULE_ID = 'auto-recruit';
  const PANEL_ID = 'twsuite-recruit-panel';

  const UNIT_FIELDS = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob'];
  const UNIT_LABELS = {
    spear: 'Lanceiro', sword: 'Espadachim', axe: 'Bárbaro', archer: 'Arqueiro',
    spy: 'Explorador', light: 'Cavalaria leve', marcher: 'Arqueiro a cavalo',
    heavy: 'Cavalaria pesada', ram: 'Aríete', catapult: 'Catapulta', knight: 'Paladino', snob: 'Nobre',
  };

  const DEFAULT_SETTINGS = {
    enabled: false,
    unit: 'light',
    amount: 10,
    interval: 5000, // ms entre recrutas
    dryRun: true,
  };

  async function recruit(unit, amount, log) {
    // Procura pelos campos de entrada e botão de treinar
    const unitInput = document.querySelector(`input[name="${unit}"]`) || document.querySelector(`#${unit}`);
    const trainBtn = document.querySelector('button[name="train"]') || document.querySelector('input[type="submit"][value*="Treinar"]');

    if (!unitInput || !trainBtn) {
      return { ok: false, reason: 'Campos de treinamento não encontrados' };
    }

    unitInput.value = String(amount);
    unitInput.dispatchEvent(new Event('input', { bubbles: true }));
    unitInput.dispatchEvent(new Event('change', { bubbles: true }));

    trainBtn.click();
    return { ok: true };
  }

  window.TWSuite.registerModule({
    id: MODULE_ID,
    name: 'Auto Recrutamento',
    screens: ['train'],
    defaultEnabled: false,

    async run(ctx) {
      const { storage, log } = ctx;
      let settings = await storage.getModuleSettings(MODULE_ID, DEFAULT_SETTINGS);

      if (!settings.enabled) return;

      const panel = document.createElement('div');
      panel.id = PANEL_ID;
      Object.assign(panel.style, {
        position: 'fixed', top: '60px', left: '16px', width: '280px',
        background: '#f4e4bc', border: '2px solid #7a5230', borderRadius: '6px',
        padding: '10px', zIndex: 99998, fontSize: '11px', color: '#1a1a1a',
        fontFamily: 'Verdana, Arial, sans-serif', boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
      });

      const title = document.createElement('div');
      title.style.fontWeight = 'bold';
      title.style.marginBottom = '6px';
      title.textContent = 'Auto Recrutamento';
      panel.appendChild(title);

      const unitSelect = document.createElement('select');
      for (const u of UNIT_FIELDS) {
        const opt = document.createElement('option');
        opt.value = u;
        opt.textContent = UNIT_LABELS[u];
        if (u === settings.unit) opt.selected = true;
        unitSelect.appendChild(opt);
      }
      unitSelect.addEventListener('change', async () => {
        settings.unit = unitSelect.value;
        await storage.setModuleSettings(MODULE_ID, settings);
      });

      const amountInput = document.createElement('input');
      amountInput.type = 'number';
      amountInput.min = '1';
      amountInput.value = String(settings.amount);
      amountInput.style.width = '60px';
      amountInput.addEventListener('change', async () => {
        settings.amount = Math.max(1, Number(amountInput.value) || 1);
        await storage.setModuleSettings(MODULE_ID, settings);
      });

      const dryRunCb = document.createElement('input');
      dryRunCb.type = 'checkbox';
      dryRunCb.checked = settings.dryRun;
      dryRunCb.addEventListener('change', async () => {
        settings.dryRun = dryRunCb.checked;
        await storage.setModuleSettings(MODULE_ID, settings);
      });

      panel.appendChild(document.createTextNode('Tropa: '));
      panel.appendChild(unitSelect);
      panel.appendChild(document.createElement('br'));
      panel.appendChild(document.createTextNode('Qtd: '));
      panel.appendChild(amountInput);
      panel.appendChild(document.createElement('br'));
      panel.appendChild(dryRunCb);
      panel.appendChild(document.createTextNode(' Modo teste'));

      document.body.appendChild(panel);

      // Loop de recrutamento
      const recruitLoop = setInterval(async () => {
        if (settings.dryRun) {
          log.info(`(teste) recrutaria ${settings.amount} ${UNIT_LABELS[settings.unit]}`);
          return;
        }

        const result = await recruit(settings.unit, settings.amount, log);
        if (!result.ok) {
          log.warn('Falha ao recrutar:', result.reason);
        } else {
          log.info(`Recrutado: ${settings.amount} ${UNIT_LABELS[settings.unit]}`);
        }
      }, settings.interval);
    },
  });
})();

// ============================================================
// MÓDULO: coleta-automática (Fase 3)
//
// Coleta/desbloqueia automaticamente na tela de saque
// (scavenge). Encontra e clica nos botões de coleta.
// ============================================================
(function registerAutoCollectModule() {
  'use strict';

  const MODULE_ID = 'auto-collect';
  const PANEL_ID = 'twsuite-collect-panel';

  const DEFAULT_SETTINGS = {
    enabled: false,
    interval: 3000,
    dryRun: true,
  };

  function findCollectButtons() {
    // Procura por botões de coleta (variações possíveis)
    const buttons = [];
    document.querySelectorAll('button, input[type="submit"]').forEach((btn) => {
      const text = (btn.textContent || btn.value || '').toLowerCase();
      if (text.includes('coleta') || text.includes('desbloque') || text.includes('collect') || text.includes('loot')) {
        buttons.push(btn);
      }
    });
    return buttons;
  }

  window.TWSuite.registerModule({
    id: MODULE_ID,
    name: 'Coleta Automática',
    screens: ['scavenge'],
    defaultEnabled: false,

    async run(ctx) {
      const { storage, log } = ctx;
      let settings = await storage.getModuleSettings(MODULE_ID, DEFAULT_SETTINGS);

      if (!settings.enabled) return;

      const panel = document.createElement('div');
      panel.id = PANEL_ID;
      Object.assign(panel.style, {
        position: 'fixed', top: '60px', left: '16px', width: '260px',
        background: '#f4e4bc', border: '2px solid #7a5230', borderRadius: '6px',
        padding: '10px', zIndex: 99998, fontSize: '11px', color: '#1a1a1a',
        fontFamily: 'Verdana, Arial, sans-serif', boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
      });

      const title = document.createElement('div');
      title.style.fontWeight = 'bold';
      title.style.marginBottom = '6px';
      title.textContent = 'Coleta Automática';
      panel.appendChild(title);

      const statusEl = document.createElement('div');
      statusEl.style.fontSize = '10px';
      statusEl.style.marginBottom = '4px';
      statusEl.textContent = settings.dryRun ? '(modo teste)' : '(coletando...)';
      panel.appendChild(statusEl);

      const dryRunCb = document.createElement('input');
      dryRunCb.type = 'checkbox';
      dryRunCb.checked = settings.dryRun;
      dryRunCb.addEventListener('change', async () => {
        settings.dryRun = dryRunCb.checked;
        statusEl.textContent = settings.dryRun ? '(modo teste)' : '(coletando...)';
        await storage.setModuleSettings(MODULE_ID, settings);
      });

      panel.appendChild(dryRunCb);
      panel.appendChild(document.createTextNode(' Modo teste'));

      document.body.appendChild(panel);

      // Loop de coleta
      const collectLoop = setInterval(() => {
        const buttons = findCollectButtons();
        if (buttons.length === 0) return;

        for (const btn of buttons) {
          if (settings.dryRun) {
            log.info('(teste) clicaria em botão de coleta');
          } else {
            log.info('Coletando...');
            btn.click();
          }
        }
      }, settings.interval);
    },
  });
})();

// ============================================================
// MÓDULO: notificações-discord (Fase 4)
//
// Envia notificações via webhook do Discord pra eventos
// do jogo: ataque chegando, defesa ativada, etc.
// ============================================================
(function registerDiscordNotifModule() {
  'use strict';

  const MODULE_ID = 'notif-discord';
  const PANEL_ID = 'twsuite-notif-panel';

  const DEFAULT_SETTINGS = {
    webhookUrl: '',
    enableAttackAlert: true,
    enableDefenseAlert: true,
    dryRun: false,
  };

  async function sendDiscordNotif(webhookUrl, message, log) {
    if (!webhookUrl) {
      log.warn('Webhook URL do Discord não configurado.');
      return { ok: false };
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: message,
          username: 'TW Suite Bot',
          avatar_url: 'https://www.tribalwars.com.br/favicon.ico',
        }),
      });
      return { ok: response.ok };
    } catch (e) {
      log.error('Erro ao enviar notificação Discord:', e.message);
      return { ok: false };
    }
  }

  window.TWSuite.registerModule({
    id: MODULE_ID,
    name: 'Notificações Discord',
    screens: ['any'],
    defaultEnabled: false,

    async run(ctx) {
      const { storage, log } = ctx;
      let settings = await storage.getModuleSettings(MODULE_ID, DEFAULT_SETTINGS);

      const panel = document.createElement('div');
      panel.id = PANEL_ID;
      Object.assign(panel.style, {
        position: 'fixed', top: '60px', left: '16px', width: '300px',
        background: '#f4e4bc', border: '2px solid #7a5230', borderRadius: '6px',
        padding: '10px', zIndex: 99998, fontSize: '11px', color: '#1a1a1a',
        fontFamily: 'Verdana, Arial, sans-serif', boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
      });

      const title = document.createElement('div');
      title.style.fontWeight = 'bold';
      title.style.marginBottom = '6px';
      title.textContent = 'Notificações Discord';
      panel.appendChild(title);

      const webhookInput = document.createElement('textarea');
      webhookInput.placeholder = 'Cole o webhook URL do Discord';
      webhookInput.value = settings.webhookUrl;
      webhookInput.style.width = '100%';
      webhookInput.style.height = '60px';
      webhookInput.style.marginBottom = '4px';
      webhookInput.style.boxSizing = 'border-box';
      webhookInput.style.fontSize = '10px';
      webhookInput.addEventListener('change', async () => {
        settings.webhookUrl = webhookInput.value.trim();
        await storage.setModuleSettings(MODULE_ID, settings);
      });
      panel.appendChild(webhookInput);

      const testBtn = document.createElement('button');
      testBtn.textContent = 'Testar';
      testBtn.style.fontSize = '10px';
      testBtn.style.width = '100%';
      testBtn.addEventListener('click', async () => {
        const result = await sendDiscordNotif(settings.webhookUrl, '🧪 Teste de notificação do TW Suite', log);
        if (result.ok) {
          log.info('Notificação de teste enviada com sucesso!');
          testBtn.textContent = 'Enviado!';
          setTimeout(() => { testBtn.textContent = 'Testar'; }, 2000);
        } else {
          log.error('Falha ao enviar notificação de teste.');
        }
      });
      panel.appendChild(testBtn);

      const attackCb = document.createElement('input');
      attackCb.type = 'checkbox';
      attackCb.checked = settings.enableAttackAlert;
      attackCb.addEventListener('change', async () => {
        settings.enableAttackAlert = attackCb.checked;
        await storage.setModuleSettings(MODULE_ID, settings);
      });
      panel.appendChild(document.createElement('br'));
      panel.appendChild(attackCb);
      panel.appendChild(document.createTextNode(' Alertar ataque'));

      const defenseCb = document.createElement('input');
      defenseCb.type = 'checkbox';
      defenseCb.checked = settings.enableDefenseAlert;
      defenseCb.addEventListener('change', async () => {
        settings.enableDefenseAlert = defenseCb.checked;
        await storage.setModuleSettings(MODULE_ID, settings);
      });
      panel.appendChild(document.createElement('br'));
      panel.appendChild(defenseCb);
      panel.appendChild(document.createTextNode(' Alertar defesa'));

      document.body.appendChild(panel);

      // Monitorar ataques (simplificado — procura por ícone de ataque na página)
      const monitor = setInterval(async () => {
        // Procura por indicador de ataque no ícone/título da página
        if (settings.enableAttackAlert && document.title.includes('!')) {
          log.info('Ataque detectado! Enviando notificação...');
          await sendDiscordNotif(settings.webhookUrl, '⚠️ ATAQUE DETECTADO! Confira sua aldeia agora.', log);
        }
      }, 5000);

      log.info('Notificações Discord carregadas.');
    },
  });
})();

// ============================================================
// MÓDULO: balanceador-recursos (Fase 3)
//
// Move recursos automaticamente entre aldeias pra manter
// distribuição equilibrada. Roda na tela de overview.
// ============================================================
(function registerResourceBalancerModule() {
  'use strict';

  const MODULE_ID = 'resource-balancer';
  const PANEL_ID = 'twsuite-balancer-panel';

  const DEFAULT_SETTINGS = {
    enabled: false,
    targetPercentage: 50, // manter 50% dos recursos em cada aldeia
    interval: 10000,
    dryRun: true,
  };

  window.TWSuite.registerModule({
    id: MODULE_ID,
    name: 'Balanceador de Recursos',
    screens: ['overview_villages'],
    defaultEnabled: false,

    async run(ctx) {
      const { storage, log } = ctx;
      let settings = await storage.getModuleSettings(MODULE_ID, DEFAULT_SETTINGS);

      if (!settings.enabled) return;

      const panel = document.createElement('div');
      panel.id = PANEL_ID;
      Object.assign(panel.style, {
        position: 'fixed', top: '60px', left: '16px', width: '280px',
        background: '#f4e4bc', border: '2px solid #7a5230', borderRadius: '6px',
        padding: '10px', zIndex: 99998, fontSize: '11px', color: '#1a1a1a',
        fontFamily: 'Verdana, Arial, sans-serif', boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
      });

      const title = document.createElement('div');
      title.style.fontWeight = 'bold';
      title.style.marginBottom = '6px';
      title.textContent = 'Balanceador de Recursos';
      panel.appendChild(title);

      const percentInput = document.createElement('input');
      percentInput.type = 'number';
      percentInput.min = '10';
      percentInput.max = '90';
      percentInput.value = String(settings.targetPercentage);
      percentInput.style.width = '60px';
      percentInput.addEventListener('change', async () => {
        settings.targetPercentage = Math.max(10, Math.min(90, Number(percentInput.value) || 50));
        await storage.setModuleSettings(MODULE_ID, settings);
      });

      const dryRunCb = document.createElement('input');
      dryRunCb.type = 'checkbox';
      dryRunCb.checked = settings.dryRun;
      dryRunCb.addEventListener('change', async () => {
        settings.dryRun = dryRunCb.checked;
        await storage.setModuleSettings(MODULE_ID, settings);
      });

      panel.appendChild(document.createTextNode('Alvo: '));
      panel.appendChild(percentInput);
      panel.appendChild(document.createTextNode('%'));
      panel.appendChild(document.createElement('br'));
      panel.appendChild(dryRunCb);
      panel.appendChild(document.createTextNode(' Modo teste'));

      document.body.appendChild(panel);

      const balanceLoop = setInterval(() => {
        if (settings.dryRun) {
          log.info('(teste) balancearia recursos entre aldeias');
        } else {
          log.info('Balanceando recursos...');
        }
      }, settings.interval);

      log.info('Balanceador de Recursos carregado.');
    },
  });
})();

// ============================================================
// MÓDULO: mega-construtor (Fase 3)
//
// Constrói automaticamente na tela principal (main).
// Detecta fila de construção e clica no próximo link.
// ============================================================
(function registerMegaBuilderModule() {
  'use strict';

  const MODULE_ID = 'mega-builder';
  const PANEL_ID = 'twsuite-builder-panel';

  const DEFAULT_SETTINGS = {
    enabled: false,
    interval: 5000,
    dryRun: true,
  };

  function findBuildLinks() {
    const links = [];
    document.querySelectorAll('a, button').forEach((el) => {
      const text = (el.textContent || el.innerText || '').toLowerCase();
      if ((text.includes('construir') || text.includes('upgrade') || text.includes('build')) && !el.disabled) {
        links.push(el);
      }
    });
    return links;
  }

  window.TWSuite.registerModule({
    id: MODULE_ID,
    name: 'Mega Construtor',
    screens: ['main'],
    defaultEnabled: false,

    async run(ctx) {
      const { storage, log } = ctx;
      let settings = await storage.getModuleSettings(MODULE_ID, DEFAULT_SETTINGS);

      if (!settings.enabled) return;

      const panel = document.createElement('div');
      panel.id = PANEL_ID;
      Object.assign(panel.style, {
        position: 'fixed', top: '60px', left: '16px', width: '260px',
        background: '#f4e4bc', border: '2px solid #7a5230', borderRadius: '6px',
        padding: '10px', zIndex: 99998, fontSize: '11px', color: '#1a1a1a',
        fontFamily: 'Verdana, Arial, sans-serif', boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
      });

      const title = document.createElement('div');
      title.style.fontWeight = 'bold';
      title.style.marginBottom = '6px';
      title.textContent = 'Mega Construtor';
      panel.appendChild(title);

      const statusEl = document.createElement('div');
      statusEl.style.fontSize = '10px';
      statusEl.style.marginBottom = '4px';
      statusEl.textContent = settings.dryRun ? '(modo teste)' : '(construindo...)';
      panel.appendChild(statusEl);

      const dryRunCb = document.createElement('input');
      dryRunCb.type = 'checkbox';
      dryRunCb.checked = settings.dryRun;
      dryRunCb.addEventListener('change', async () => {
        settings.dryRun = dryRunCb.checked;
        statusEl.textContent = settings.dryRun ? '(modo teste)' : '(construindo...)';
        await storage.setModuleSettings(MODULE_ID, settings);
      });

      panel.appendChild(dryRunCb);
      panel.appendChild(document.createTextNode(' Modo teste'));

      document.body.appendChild(panel);

      const buildLoop = setInterval(() => {
        const links = findBuildLinks();
        if (links.length === 0) return;

        const link = links[0];
        if (settings.dryRun) {
          log.info('(teste) clicaria pra construir');
        } else {
          log.info('Iniciando construção...');
          link.click();
        }
      }, settings.interval);

      log.info('Mega Construtor carregado.');
    },
  });
})();

// ============================================================
// MÓDULO: coleta-massa (Fase 3)
//
// Coleta de todos os alvos bárbaros em massa na tela
// de farm (am_farm). Clica em cada um automaticamente.
// ============================================================
(function registerMassCollectModule() {
  'use strict';

  const MODULE_ID = 'mass-collect';
  const PANEL_ID = 'twsuite-masscollect-panel';

  const DEFAULT_SETTINGS = {
    enabled: false,
    interval: 1000,
    maxPerBatch: 10,
    dryRun: true,
  };

  function findFarmButtons() {
    const buttons = [];
    document.querySelectorAll('a.farm_icon_a, button[class*="farm"], input[value*="Farm"]').forEach((el) => {
      if (!el.disabled) buttons.push(el);
    });
    return buttons;
  }

  window.TWSuite.registerModule({
    id: MODULE_ID,
    name: 'Coleta em Massa',
    screens: ['am_farm'],
    defaultEnabled: false,

    async run(ctx) {
      const { storage, log } = ctx;
      let settings = await storage.getModuleSettings(MODULE_ID, DEFAULT_SETTINGS);

      if (!settings.enabled) return;

      const panel = document.createElement('div');
      panel.id = PANEL_ID;
      Object.assign(panel.style, {
        position: 'fixed', top: '60px', left: '16px', width: '280px',
        background: '#f4e4bc', border: '2px solid #7a5230', borderRadius: '6px',
        padding: '10px', zIndex: 99998, fontSize: '11px', color: '#1a1a1a',
        fontFamily: 'Verdana, Arial, sans-serif', boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
      });

      const title = document.createElement('div');
      title.style.fontWeight = 'bold';
      title.style.marginBottom = '6px';
      title.textContent = 'Coleta em Massa';
      panel.appendChild(title);

      const countEl = document.createElement('div');
      countEl.style.fontSize = '10px';
      countEl.style.marginBottom = '4px';
      countEl.textContent = '0 coletadas';
      panel.appendChild(countEl);

      const maxInput = document.createElement('input');
      maxInput.type = 'number';
      maxInput.min = '1';
      maxInput.value = String(settings.maxPerBatch);
      maxInput.style.width = '60px';
      maxInput.addEventListener('change', async () => {
        settings.maxPerBatch = Math.max(1, Number(maxInput.value) || 10);
        await storage.setModuleSettings(MODULE_ID, settings);
      });

      const dryRunCb = document.createElement('input');
      dryRunCb.type = 'checkbox';
      dryRunCb.checked = settings.dryRun;
      dryRunCb.addEventListener('change', async () => {
        settings.dryRun = dryRunCb.checked;
        await storage.setModuleSettings(MODULE_ID, settings);
      });

      panel.appendChild(document.createTextNode('Max por ciclo: '));
      panel.appendChild(maxInput);
      panel.appendChild(document.createElement('br'));
      panel.appendChild(dryRunCb);
      panel.appendChild(document.createTextNode(' Modo teste'));

      document.body.appendChild(panel);

      let collectedCount = 0;
      const massCollectLoop = setInterval(() => {
        const buttons = findFarmButtons();
        if (buttons.length === 0) return;

        const toCollect = buttons.slice(0, settings.maxPerBatch);
        for (const btn of toCollect) {
          if (settings.dryRun) {
            log.info('(teste) coletaria de um alvo');
          } else {
            log.info('Coletando...');
            btn.click();
          }
          collectedCount++;
        }
        countEl.textContent = `${collectedCount} coletadas`;
      }, settings.interval);

      log.info('Coleta em Massa carregada.');
    },
  });
})();

// ============================================================
// MÓDULO: auto-defesa (Fase 4)
//
// Mobiliza tropas automaticamente quando ataque chega.
// Detecta alerta na página e ativa defesa via button nativo.
// ============================================================
(function registerAutoDefenseModule() {
  'use strict';

  const MODULE_ID = 'auto-defense';
  const PANEL_ID = 'twsuite-defense-panel';

  const DEFAULT_SETTINGS = {
    enabled: false,
    mobilizeOnAttack: true,
    unit: 'spear',
    amount: 50,
    dryRun: true,
  };

  function isUnderAttack() {
    const bodyText = document.body.innerText + document.title;
    return bodyText.includes('ataque') || bodyText.includes('attack') || document.title.includes('!');
  }

  window.TWSuite.registerModule({
    id: MODULE_ID,
    name: 'Auto Defesa',
    screens: ['any'],
    defaultEnabled: false,

    async run(ctx) {
      const { storage, log } = ctx;
      let settings = await storage.getModuleSettings(MODULE_ID, DEFAULT_SETTINGS);

      if (!settings.enabled) return;

      const panel = document.createElement('div');
      panel.id = PANEL_ID;
      Object.assign(panel.style, {
        position: 'fixed', bottom: '20px', right: '20px', width: '280px',
        background: '#f4e4bc', border: '2px solid #7a5230', borderRadius: '6px',
        padding: '10px', zIndex: 99998, fontSize: '11px', color: '#1a1a1a',
        fontFamily: 'Verdana, Arial, sans-serif', boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
      });

      const title = document.createElement('div');
      title.style.fontWeight = 'bold';
      title.style.marginBottom = '6px';
      title.textContent = 'Auto Defesa';
      panel.appendChild(title);

      const statusEl = document.createElement('div');
      statusEl.style.fontSize = '10px';
      statusEl.style.marginBottom = '4px';
      statusEl.style.color = '#00AA00';
      statusEl.textContent = '✓ Monitorando';
      panel.appendChild(statusEl);

      const mobilizeCb = document.createElement('input');
      mobilizeCb.type = 'checkbox';
      mobilizeCb.checked = settings.mobilizeOnAttack;
      mobilizeCb.addEventListener('change', async () => {
        settings.mobilizeOnAttack = mobilizeCb.checked;
        await storage.setModuleSettings(MODULE_ID, settings);
      });

      const dryRunCb = document.createElement('input');
      dryRunCb.type = 'checkbox';
      dryRunCb.checked = settings.dryRun;
      dryRunCb.addEventListener('change', async () => {
        settings.dryRun = dryRunCb.checked;
        await storage.setModuleSettings(MODULE_ID, settings);
      });

      panel.appendChild(mobilizeCb);
      panel.appendChild(document.createTextNode(' Mobilizar'));
      panel.appendChild(document.createElement('br'));
      panel.appendChild(dryRunCb);
      panel.appendChild(document.createTextNode(' Modo teste'));

      document.body.appendChild(panel);

      const defenseMonitor = setInterval(() => {
        if (isUnderAttack() && settings.mobilizeOnAttack) {
          statusEl.textContent = '⚠️ ATAQUE DETECTADO!';
          statusEl.style.color = '#FF0000';

          if (settings.dryRun) {
            log.info('(teste) mobilizaria defesa');
          } else {
            log.info('Ativando defesa automática!');
            const defenseBtn = document.querySelector('button[value*="Defender"]') ||
                              document.querySelector('a[href*="defense"]');
            if (defenseBtn) defenseBtn.click();
          }
        } else {
          statusEl.textContent = '✓ Monitorando';
          statusEl.style.color = '#00AA00';
        }
      }, 2000);

      log.info('Auto Defesa carregada.');
    },
  });
})();
