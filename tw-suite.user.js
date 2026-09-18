// ==UserScript==
// @name         TW Suite
// @namespace    https://github.com/LuizAngeloF/tw-suite
// @version      1.9.0
// @description  Sistema centralizado de módulos de automação para Tribal Wars (uso privado / grupo fechado)
// @author       LuizAngeloF
// @match        https://*.tribalwars.com.br/game.php*
// @match        http://localhost/*dashboard.html*
// @match        http://127.0.0.1/*dashboard.html*
// @match        file:///*dashboard.html
// @match        file://*/dashboard.html
// @include      file:///*dashboard.html*
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
    let lastApplyResult = null;

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
      if (!key) {
        lastApplyResult = { applied: false, reason: 'conta não identificada (game_data.world ou game_data.player ausente)' };
        return lastApplyResult;
      }
      const all = await getAll();
      const profile = all[key];
      if (!profile || !profile.modules) {
        lastApplyResult = { applied: false, reason: 'sem perfil salvo pro dashboard para esta chave', key, knownKeys: Object.keys(all) };
        return lastApplyResult;
      }

      const marker = `${key}@${profile.updatedAt || 0}`;
      if ((await storage.get('profileApplied', '')) === marker) {
        lastApplyResult = { applied: false, reason: 'já aplicado (nada novo)', key };
        return lastApplyResult;
      }

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
      lastApplyResult = { applied: true, key };
      return lastApplyResult;
    }

    function getLastApplyResult() {
      return lastApplyResult;
    }

    async function reportStatus() {
      const key = accountKeyFromGame();
      if (!key) return;
      const gd = gameApi.getGameData();
      const accounts = (await storage.get('accounts', {})) || {};
      // Merge (não sobrescreve) — o módulo live-status também escreve nesta
      // mesma chave com recursos/tropas/ataques a caminho, em ciclo próprio.
      accounts[key] = {
        ...(accounts[key] || {}),
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

    // Roda só na página do dashboard (file:// ou http://localhost). O dashboard e o script
    // conversam por postMessage porque o sandbox do Tampermonkey não
    // compartilha funções com a página de forma confiável entre navegadores.
    //
    // Como uma página file:// não mostra painel nenhum do TW Suite (bootstrap()
    // nunca roda ali), não dava pra saber se o script sequer chegou a ser
    // injetado. Esse selo visual resolve isso: se ele NUNCA aparecer, o
    // problema é permissão do navegador (Tampermonkey não rodou o script
    // nesta página) — não tem nada que o script possa fazer sobre isso. Se
    // aparecer mas ficar em "aguardando dashboard...", o script rodou mas
    // não recebeu nenhuma mensagem da página — aí é bug de sincronização.
    function injectFileBadge() {
      const version = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '?';
      const el = document.createElement('div');
      Object.assign(el.style, {
        position: 'fixed', bottom: '10px', left: '10px', zIndex: 2147483647,
        background: '#1b1208', color: '#e9a54b', border: '1px solid #7a5230',
        borderRadius: '6px', padding: '5px 10px', fontSize: '11px',
        fontFamily: 'Consolas, monospace', boxShadow: '0 2px 8px rgba(0,0,0,.5)',
      });
      el.textContent = `● TW Suite v${version} — aguardando dashboard...`;
      document.body.appendChild(el);
      return {
        markContacted() {
          el.textContent = `● TW Suite v${version} — conectado ao dashboard`;
          el.style.color = '#6cc4a6';
          el.style.borderColor = '#3e9b7c';
        },
      };
    }

    function startDashboardBridge() {
      const badge = injectFileBadge();
      // O Tampermonkey roda o userscript num sandbox isolado — o `window`
      // enxergado aqui dentro NÃO é garantidamente o mesmo objeto que o
      // `window` da página real (varia por navegador/config de sandbox do
      // Tampermonkey). Comparar `ev.source !== window` pra filtrar
      // mensagens falha nesse caso: a mensagem chega, mas é descartada
      // silenciosamente por não bater a identidade. Usamos `unsafeWindow`
      // (o window real da página) pros dois lados — enviar e escutar —
      // pra garantir que ambos falem com o mesmo objeto, e confiamos só
      // na assinatura `data.twsuite` pra filtrar (não tem iframe nesta
      // página, então não tem risco de pegar mensagem de outra origem).
      const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      const reply = (id, ok, payload) =>
        pageWindow.postMessage({ twsuite: 'bridge-res', id, ok, payload }, '*');

      pageWindow.addEventListener('message', async (ev) => {
        if (!ev.data || ev.data.twsuite !== 'bridge-req') return;
        badge.markContacted();
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
          } else if (op === 'resetAutoFarmTargets') {
            // Não dá pra chamar o módulo diretamente daqui — essa página
            // (dashboard) roda sua PRÓPRIA instância do script, separada
            // da aba do jogo. Em vez disso, grava um pedido (por conta)
            // que a aba do jogo confere no próprio ciclo de atualização
            // (a cada ~8s) e executa sozinha, na aldeia certa.
            const requests = (await storage.get('autoFarmResetRequests', {})) || {};
            requests[payload.accountKey] = Date.now();
            await storage.set('autoFarmResetRequests', requests);
            reply(id, true, {});
          } else {
            reply(id, false, { error: `op desconhecida: ${op}` });
          }
        } catch (e) {
          reply(id, false, { error: String(e && e.message || e) });
        }
      });
      pageWindow.postMessage({ twsuite: 'bridge-ready' }, '*');
    }

    return { accountKeyFromGame, applyForCurrentAccount, getLastApplyResult, reportStatus, importSyncCode, startDashboardBridge };
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
      const registry = moduleLoader.getRegistry().filter((m) => m.id !== 'live-status');
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
      const key = profiles.accountKeyFromGame();
      const last = profiles.getLastApplyResult();
      const lines = [
        `Versão: ${version}`,
        `Tela atual: ${gameApi.getCurrentScreen()}`,
        `game_data: ${gd ? 'encontrado' : 'NÃO encontrado'}`,
        `Offset de servidor: ${serverTime.offsetMs}ms`,
        `---`,
        `<strong>Sincronização com o dashboard</strong>`,
        `game_data.world: <code>${gd ? esc(String(gd.world)) : '?'}</code>`,
        `game_data.player.name: <code>${gd && gd.player ? esc(String(gd.player.name)) : '?'}</code>`,
        `Chave calculada: <code>${key ? esc(key) : '(não identificada)'}</code>`,
        `Último perfil aplicado: ${last ? (last.applied ? `✅ ${esc(last.key)}` : `⚠️ ${esc(last.reason)}${last.knownKeys ? ` — chaves salvas: ${last.knownKeys.length ? last.knownKeys.map(esc).join(', ') : '(nenhuma)'}` : ''}`) : 'ainda não tentado'}`,
      ];
      diag.innerHTML = lines.join('<br>');
    }

    function esc(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
    accountKeyFromGame: profiles.accountKeyFromGame,
    applyProfileNow: profiles.applyForCurrentAccount,
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

  // Detecta a página do dashboard pelo caminho, não pelo protocolo — assim
  // funciona tanto aberto direto (file://) quanto servido em localhost
  // (http://localhost:PORTA/dashboard.html), que evita de vez os problemas
  // de permissão do navegador com file:// (ver start-dashboard.bat).
  if (/dashboard\.html$/.test(location.pathname)) {
    profiles.startDashboardBridge();
    window.TWSuite.dashboardOnly = true;
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();

// ============================================================
// SHARED — utilitários usados pelos módulos (v1.2.0)
//
// Rotas do jogo usadas aqui:
//  - place try=confirm / action=command: VERIFIED via HAR (ver verification-log).
//  - ajaxaction (train, send_squads, exchange_begin/confirm): mesmo formato
//    usado por stefan2200/TWB (GPL-3, só consultado como referência).
//  Tudo que não foi confirmado ao vivo está marcado UNVERIFIED nos módulos.
// ============================================================
(function registerShared() {
  'use strict';

  const TW = window.TWSuite;
  const pageWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const TAB_ID = Math.random().toString(36).slice(2, 10);

  const UNITS = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob'];
  const UNIT_LABELS = {
    spear: 'Lanceiro', sword: 'Espadachim', axe: 'Bárbaro', archer: 'Arqueiro', spy: 'Explorador',
    light: 'Cavalaria leve', marcher: 'Arqueiro a cavalo', heavy: 'Cavalaria pesada', ram: 'Aríete',
    catapult: 'Catapulta', knight: 'Paladino', snob: 'Nobre',
  };
  const RESOURCES = ['wood', 'stone', 'iron'];
  const RES_LABELS = { wood: 'Madeira', stone: 'Argila', iron: 'Ferro' };

  class BotCheckError extends Error {
    constructor() {
      super('Proteção anti-bot ativa');
      this.name = 'BotCheckError';
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = (min, max) => Math.round(min + Math.random() * Math.max(0, max - min));
  const gd = () => TW.gameApi.getGameData();
  const csrf = () => (gd() && gd().csrf) || '';
  const villageId = () => gd() && gd().village && gd().village.id;
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const num = (s) => Number(String(s == null ? '' : s).replace(/[^\d-]/g, '')) || 0;

  function parseHtml(html) {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function gameDataFromHtml(text) {
    const m = text.match(/TribalWars\.updateGameData\((\{.+?\})\);/s);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch { return null; }
  }

  function formParams(form, overrides = {}) {
    const params = new URLSearchParams();
    for (const el of form.elements) {
      if (!el.name || el.disabled) continue;
      const type = (el.type || '').toLowerCase();
      if (['submit', 'button', 'image', 'reset', 'file'].includes(type)) continue;
      if ((type === 'checkbox' || type === 'radio') && !el.checked) continue;
      params.append(el.name, el.value);
    }
    for (const [k, v] of Object.entries(overrides)) params.set(k, v == null ? '' : String(v));
    return params;
  }

  function appendData(params, data, prefix) {
    for (const [k, v] of Object.entries(data)) {
      const key = prefix ? `${prefix}[${k}]` : k;
      if (v && typeof v === 'object') appendData(params, v, key);
      else params.append(key, v == null ? '' : String(v));
    }
    return params;
  }

  // ---------- captcha / proteção anti-bot ----------
  const botState = { active: false };
  const BOT_SELECTORS = '#bot_check, #botprotection_quest, .bot-protection-row, iframe[src*="hcaptcha"], iframe[src*="recaptcha"]';

  function pageHasBotCheck(root = document) {
    return !!root.querySelector(BOT_SELECTORS);
  }

  function textHasBotCheck(text) {
    return /id="bot_check"|botprotection_quest|bot-protection-row|hcaptcha\.com/i.test(text);
  }

  async function flagBotCheck() {
    if (botState.active) return;
    botState.active = true;
    TW.log.warn('Proteção anti-bot detectada — automações pausadas até recarregar a página depois de resolver.');
    const last = await TW.storage.get('shared:lastBotNotify', 0);
    if (Date.now() - last > 10 * 60 * 1000) {
      await TW.storage.set('shared:lastBotNotify', Date.now());
      notify('🛑 Captcha / proteção anti-bot na tela. As automações pararam até você resolver.', { kind: 'captcha' });
    }
  }

  async function guard() {
    if (botState.active) return false;
    if (pageHasBotCheck()) {
      await flagBotCheck();
      return false;
    }
    return true;
  }

  // ---------- HTTP ----------
  async function getPage(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    const text = await res.text();
    if (textHasBotCheck(text)) {
      await flagBotCheck();
      throw new BotCheckError();
    }
    return { ok: res.ok, status: res.status, text, doc: parseHtml(text), url: res.url };
  }

  async function postForm(url, params) {
    const res = await fetch(url, { method: 'POST', body: params, credentials: 'same-origin' });
    const text = await res.text();
    if (textHasBotCheck(text)) {
      await flagBotCheck();
      throw new BotCheckError();
    }
    return { ok: res.ok, status: res.status, text, redirected: res.redirected, url: res.url };
  }

  function errorFromHtml(text) {
    if (!text.includes('error_box')) return null;
    const box = parseHtml(text).querySelector('.error_box');
    return (box && box.textContent.trim().replace(/\s+/g, ' ')) || 'o jogo recusou a ação';
  }

  async function ajax(screen, action, data = {}, extra = {}, vid = villageId()) {
    const q = new URLSearchParams({ village: String(vid), screen, ajaxaction: action, h: csrf() });
    for (const [k, v] of Object.entries(extra)) q.set(k, String(v));
    const body = appendData(new URLSearchParams(), { ...data, h: csrf() });
    const res = await fetch(`/game.php?${q}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'TribalWars-Ajax': '1',
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* resposta não-JSON */ }
    if (!json) {
      if (textHasBotCheck(text)) { await flagBotCheck(); throw new BotCheckError(); }
      return { ok: false, reason: `HTTP ${res.status}: resposta inesperada` };
    }
    if (json.bot_protect) { await flagBotCheck(); throw new BotCheckError(); }
    if (json.error) {
      const reason = Array.isArray(json.error) ? json.error.join(' ') : String(json.error);
      return { ok: false, reason, json };
    }
    return { ok: true, json, response: json.response };
  }

  // ---------- comandos (ataque / apoio) ----------
  async function getPlaceDoc(vid) {
    const here = document.querySelector('#inputx');
    if (here && String(villageId()) === String(vid) && TW.gameApi.getCurrentScreen() === 'place' && !location.search.includes('try=')) {
      return document;
    }
    const { doc } = await getPage(`/game.php?village=${vid}&screen=place`);
    return doc;
  }

  function availableUnits(doc) {
    const out = {};
    for (const u of UNITS) {
      const input = doc.querySelector(`#unit_input_${u}`);
      out[u] = input ? Number(input.getAttribute('data-all-count') || 0) : 0;
    }
    return out;
  }

  // Etapa 1 (try=confirm). units: { spear: 10 | 'all' }. Retorna o formulário
  // de confirmação e a duração, sem enviar nada ainda.
  async function prepareCommand({ villageId: vid, units, x, y, type = 'attack', capToAvailable = true, catapultTarget = null }) {
    const doc = await getPlaceDoc(vid);
    const input = doc.querySelector('#inputx');
    const form = input && (input.form || input.closest('form'));
    if (!form) return { ok: false, reason: 'formulário da Praça de Reunião não encontrado' };

    const avail = availableUnits(doc);
    const finalUnits = {};
    let any = false;
    for (const u of UNITS) {
      let n = units[u] === 'all' ? avail[u] : Number(units[u] || 0);
      if (capToAvailable) n = Math.min(n, avail[u]);
      finalUnits[u] = Math.max(0, n);
      if (finalUnits[u] > 0) any = true;
    }
    if (!any) return { ok: false, reason: 'nenhuma tropa disponível para esse envio', available: avail };

    const o1 = { x, y, target_type: 'coord' };
    if (type === 'support') o1.support = 'Apoio';
    else o1.attack = 'Ataque';
    for (const u of UNITS) o1[u] = finalUnits[u] > 0 ? finalUnits[u] : '';

    const r1 = await postForm(`/game.php?village=${vid}&screen=place&try=confirm`, formParams(form, o1));
    if (!r1.ok) return { ok: false, reason: `etapa 1 falhou: HTTP ${r1.status}` };
    const err = errorFromHtml(r1.text);
    if (err) return { ok: false, reason: err };

    const cdoc = parseHtml(r1.text);
    const confirmForm = (cdoc.querySelector('#troop_confirm_submit') || {}).form
      || (cdoc.querySelector('#troop_confirm_submit') && cdoc.querySelector('#troop_confirm_submit').closest('form'))
      || cdoc.querySelector('form');
    if (!confirmForm) return { ok: false, reason: 'formulário de confirmação não encontrado' };
    const durEl = cdoc.querySelector('.relative_time[data-duration]') || cdoc.querySelector('[data-duration]');
    const durationMs = durEl ? Number(durEl.getAttribute('data-duration')) * 1000 : null;

    return { ok: true, vid, x, y, type, units: finalUnits, confirmForm, durationMs, catapultTarget };
  }

  // Etapa 2 (action=command) — token h = game_data.csrf (VERIFIED).
  // catapultTarget: UNVERIFIED — em ataques com catapulta o jogo mostra um
  // seletor de "alvo do cerco" na tela de confirmação; supomos que o campo
  // se chama `catapult_target` com valores como `wall`/`headquarter`/etc,
  // convenção comum em scripts da comunidade, mas nunca confirmada ao vivo
  // contra este mundo. Se o campo não existir na tela real, o jogo
  // provavelmente ignora o valor extra e ataca normalmente (sem mirar a
  // muralha) em vez de dar erro — degradação seguro, não perigosa.
  async function confirmCommand(prep) {
    const o2 = { cb: 'troop_confirm_submit', building: 'main', x: prep.x, y: prep.y, source_village: prep.vid, village: prep.vid, h: csrf() };
    if (prep.type === 'support') {
      o2.support = 'true';
      o2.submit_confirm = 'Enviar apoio';
    } else {
      o2.attack = 'true';
      o2.submit_confirm = 'Enviar ataque';
    }
    if (prep.catapultTarget) o2.catapult_target = prep.catapultTarget;
    for (const u of UNITS) o2[u] = prep.units[u] || 0;
    const startedAt = TW.serverTime.now();
    const r2 = await postForm(`/game.php?village=${prep.vid}&screen=place&action=command`, formParams(prep.confirmForm, o2));
    const endedAt = TW.serverTime.now();
    if (!r2.ok) return { ok: false, reason: `etapa 2 falhou: HTTP ${r2.status}` };
    const err = errorFromHtml(r2.text);
    if (err) return { ok: false, reason: err };
    return { ok: true, startedAt, endedAt, sentAt: Math.round((startedAt + endedAt) / 2), html: r2.text };
  }

  async function sendCommand(opts) {
    const prep = await prepareCommand(opts);
    if (!prep.ok) return prep;
    const res = await confirmCommand(prep);
    return { ...res, units: prep.units, durationMs: prep.durationMs };
  }

  // Comandos próprios que ainda podem ser cancelados (links action=cancel).
  // UNVERIFIED: formato exato da tabela; busca só pelo padrão do link e
  // extrai o texto da linha inteira como rótulo (não sabemos os nomes
  // exatos das colunas, então não tentamos separar alvo/hora com certeza).
  function cancelLinks(doc) {
    const seen = new Map();
    for (const a of doc.querySelectorAll('a[href*="action=cancel"]')) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/[?&]id=(\d+)/);
      if (!m || seen.has(m[1])) continue;
      const row = a.closest('tr');
      const text = row ? row.textContent.replace(/\s+/g, ' ').trim() : '';
      seen.set(m[1], { id: m[1], href, label: text.slice(0, 90) });
    }
    return seen;
  }

  async function listCancelableCommands(vid) {
    const { doc } = await getPage(`/game.php?village=${vid}&screen=place`);
    return [...cancelLinks(doc).values()];
  }

  async function cancelCommand(vid, id, href) {
    let url = href ? new URL(href, location.origin) : new URL(`/game.php?village=${vid}&screen=place&action=cancel&id=${id}`, location.origin);
    if (!url.searchParams.get('h')) url.searchParams.set('h', csrf());
    const res = await getPage(url.pathname + url.search);
    const err = errorFromHtml(res.text);
    return err ? { ok: false, reason: err } : { ok: true };
  }

  // ---------- mercado premium (recursos <-> pontos premium) ----------
  // UNVERIFIED: baseado em stefan2200/TWB (GPL-3, só consultado como
  // referência de endpoints) — dois ajaxaction em sequência, o primeiro
  // devolve um rate_hash que precisa voltar no segundo. "buy_<recurso>"
  // é suposição simétrica a "sell_<recurso>" (só o sell foi referenciado
  // de verdade); pode não existir — nesse caso o exchange_begin deve
  // simplesmente falhar com erro, não fazer nada indevido.
  async function premiumExchange(vid, kind, resource, amount) {
    const field = `${kind === 'buy' ? 'buy' : 'sell'}_${resource}`;
    const r1 = await ajax('market', 'exchange_begin', { [field]: amount }, {}, vid);
    if (!r1.ok) return r1;
    const rateHash = r1.response && r1.response[0] && r1.response[0].rate_hash;
    if (!rateHash) return { ok: false, reason: 'rate_hash não encontrado na resposta do jogo' };
    return ajax('market', 'exchange_confirm', { [field]: amount, rate_hash: rateHash, mb: '1' }, {}, vid);
  }

  async function premiumExchangeRates(vid) {
    const { text } = await getPage(`/game.php?village=${vid}&screen=market&mode=exchange`);
    const m = text.match(/PremiumExchange\.receiveData\((.+?)\);/s) || text.match(/PremiumExchange\.data\s*=\s*(\{.+?\});/s);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch { return null; }
  }

  // ---------- mercado: envio de recursos entre aldeias ----------
  // UNVERIFIED: usa o formulário de screen=market&mode=send e o formulário
  // devolvido na confirmação, lendo action/campos direto do HTML.
  async function sendResources(fromVid, amounts, x, y) {
    const { doc } = await getPage(`/game.php?village=${fromVid}&screen=market&mode=send`);
    const woodInput = doc.querySelector('input[name="wood"]');
    const form = woodInput && (woodInput.form || woodInput.closest('form'));
    if (!form) return { ok: false, reason: 'formulário do mercado não encontrado (sem mercado nesta aldeia?)' };
    const o1 = { wood: amounts.wood || 0, stone: amounts.stone || 0, iron: amounts.iron || 0, x, y, target_type: 'coord', input: `${x}|${y}` };
    const action1 = form.getAttribute('action') || `/game.php?village=${fromVid}&screen=market&mode=send&try=confirm_send`;
    const r1 = await postForm(new URL(action1, location.origin).toString(), formParams(form, o1));
    const err1 = errorFromHtml(r1.text);
    if (err1) return { ok: false, reason: err1 };
    const cdoc = parseHtml(r1.text);
    const cform = [...cdoc.querySelectorAll('form')].find((f) => /action=send|try=confirm_send|mode=send/.test(f.getAttribute('action') || ''));
    if (!cform) return { ok: false, reason: 'confirmação do mercado não encontrada' };
    const action2 = new URL(cform.getAttribute('action'), location.origin);
    if (!action2.searchParams.get('h')) action2.searchParams.set('h', csrf());
    const r2 = await postForm(action2.toString(), formParams(cform, { h: csrf() }));
    const err2 = errorFromHtml(r2.text);
    return err2 ? { ok: false, reason: err2 } : { ok: true };
  }

  // ---------- aldeias (village.txt, mesmo cache do Auto Farm) ----------
  const VILLAGE_CACHE_KEY = 'auto-farm:villageIndexCache';
  const VILLAGE_CACHE_TTL_MS = 3 * 60 * 60 * 1000;
  let villageMemo = null;

  function parseVillageTxt(text) {
    const out = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      const p = line.split(',');
      if (p.length < 5) continue;
      const x = Number(p[2]);
      const y = Number(p[3]);
      if (Number.isNaN(x) || Number.isNaN(y)) continue;
      let name = p[1];
      try { name = decodeURIComponent(p[1].replace(/\+/g, ' ')); } catch { /* mantém cru */ }
      out.push({ id: p[0], name, x, y, owner: p[4], points: Number(p[5]) || 0 });
    }
    return out;
  }

  async function getVillageIndex() {
    if (villageMemo && Date.now() - villageMemo.at < 5 * 60 * 1000) return villageMemo.list;
    const cached = await TW.storage.get(VILLAGE_CACHE_KEY, null);
    let text = cached && cached.text;
    if (!cached || Date.now() - (cached.fetchedAt || 0) > VILLAGE_CACHE_TTL_MS) {
      try {
        const res = await fetch('/map/village.txt', { credentials: 'omit' });
        if (res.ok) {
          text = await res.text();
          await TW.storage.set(VILLAGE_CACHE_KEY, { fetchedAt: Date.now(), text });
        }
      } catch (e) {
        TW.log.warn('Falha ao atualizar village.txt, usando cache:', e);
      }
    }
    const list = text ? parseVillageTxt(text) : [];
    villageMemo = { at: Date.now(), list };
    return list;
  }

  async function myVillages() {
    const pid = gd() && gd().player && String(gd().player.id);
    const list = (await getVillageIndex()).filter((v) => v.owner === pid);
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }

  // ---------- horário do servidor ----------
  // O jogo mostra horário local do servidor em #serverDate / #serverTime.
  // Guardamos a diferença entre esse relógio "de parede" e serverTime.now().
  function serverWallOffsetMs() {
    const d = document.querySelector('#serverDate');
    const t = document.querySelector('#serverTime');
    if (!d || !t) return null;
    const dm = d.textContent.trim().match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    const tm = t.textContent.trim().match(/(\d{1,2}):(\d{2}):(\d{2})/);
    if (!dm || !tm) return null;
    const wall = Date.UTC(+dm[3], +dm[2] - 1, +dm[1], +tm[1], +tm[2], +tm[3]);
    const raw = wall - TW.serverTime.now();
    return Math.round(raw / (15 * 60 * 1000)) * 15 * 60 * 1000;
  }

  // Aceita "14:22:01:345", "hoje às 14:22:01:345", "amanhã às 14:22:01",
  // "17/09 14:22:01:345" ou "17/09/2026 14:22:01". Retorna epoch (serverTime).
  function parseGameTime(input) {
    const s = String(input || '').trim().toLowerCase();
    const tm = s.match(/(\d{1,2}):(\d{2}):(\d{2})(?:[:.,](\d{1,3}))?/);
    if (!tm) return null;
    const wallOffset = serverWallOffsetMs();
    if (wallOffset == null) return null;
    const nowWall = new Date(TW.serverTime.now() + wallOffset);
    let y = nowWall.getUTCFullYear();
    let mo = nowWall.getUTCMonth();
    let da = nowWall.getUTCDate();
    const dm = s.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
    let explicitDay = false;
    if (dm) {
      da = +dm[1];
      mo = +dm[2] - 1;
      if (dm[3]) y = dm[3].length === 2 ? 2000 + +dm[3] : +dm[3];
      explicitDay = true;
    } else if (/amanh/.test(s)) {
      da += 1;
      explicitDay = true;
    }
    const ms = tm[4] ? Number(tm[4].padEnd(3, '0')) : 0;
    let wall = Date.UTC(y, mo, da, +tm[1], +tm[2], +tm[3], ms);
    if (!explicitDay && wall < nowWall.getTime() - 1000) wall += 86400000;
    return wall - wallOffset;
  }

  function formatServerTime(epochMs, withMs = true) {
    const off = serverWallOffsetMs();
    const d = new Date(epochMs + (off == null ? 0 : off));
    const p = (n, l = 2) => String(n).padStart(l, '0');
    const base = `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
    return withMs ? `${base}:${p(d.getUTCMilliseconds(), 3)}` : base;
  }

  let worldConfigMemo = null;
  async function worldConfig() {
    if (worldConfigMemo) return worldConfigMemo;
    const cached = await TW.storage.get('shared:worldConfig', null);
    if (cached && Date.now() - cached.at < 24 * 3600 * 1000) {
      worldConfigMemo = cached.data;
      return worldConfigMemo;
    }
    const data = { commandCancelTime: 600, speed: 1, unitSpeed: 1 };
    try {
      const res = await fetch('/interface.php?func=get_config', { credentials: 'omit' });
      const xml = new DOMParser().parseFromString(await res.text(), 'text/xml');
      const read = (sel) => { const n = xml.querySelector(sel); return n ? Number(n.textContent) : null; };
      data.commandCancelTime = read('commands > command_cancel_time') || 600;
      data.speed = read('config > speed') || 1;
      data.unitSpeed = read('config > unit_speed') || 1;
    } catch (e) {
      TW.log.warn('get_config indisponível, usando cancelamento de 600s:', e);
    }
    await TW.storage.set('shared:worldConfig', { at: Date.now(), data });
    worldConfigMemo = data;
    return data;
  }

  // ---------- notificações (Discord + WhatsApp via CallMeBot) ----------
  function gmRequest(opts) {
    return new Promise((resolve, reject) => {
      const fn = typeof GM_xmlhttpRequest === 'function'
        ? GM_xmlhttpRequest
        : (typeof GM !== 'undefined' && GM.xmlHttpRequest) ? GM.xmlHttpRequest : null;
      if (!fn) {
        fetch(opts.url, { method: opts.method, headers: opts.headers, body: opts.data }).then(resolve, reject);
        return;
      }
      fn({ ...opts, timeout: 15000, onload: resolve, onerror: reject, ontimeout: reject });
    });
  }

  async function notify(text, { kind = 'info', force = false } = {}) {
    const enabled = await TW.storage.getModuleEnabled('notif-discord', false);
    if (!enabled && !force) return { ok: false, reason: 'módulo de notificações desligado' };
    const s = await TW.storage.getModuleSettings('notif-discord', {});
    if (!force) {
      if (kind === 'attack' && s.enableAttackAlert === false) return { ok: false };
      if (kind === 'captcha' && s.enableCaptchaAlert === false) return { ok: false };
    }
    const g = gd();
    const tag = g && g.player ? `[${g.world} · ${g.player.name}] ` : '';
    const message = tag + text;
    const jobs = [];
    if (s.webhookUrl) {
      jobs.push(gmRequest({
        method: 'POST', url: s.webhookUrl, headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ content: message, username: 'TW Suite' }),
      }));
    }
    if (s.whatsappPhone && s.whatsappApiKey) {
      const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(s.whatsappPhone)}&text=${encodeURIComponent(message)}&apikey=${encodeURIComponent(s.whatsappApiKey)}`;
      jobs.push(gmRequest({ method: 'GET', url }));
    }
    if (!jobs.length) return { ok: false, reason: 'nenhum canal configurado' };
    const results = await Promise.allSettled(jobs);
    return { ok: results.some((r) => r.status === 'fulfilled') };
  }

  // ---------- loops com trava entre abas ----------
  async function acquireLock(name, ttlMs) {
    const key = `lock:${name}`;
    const cur = await TW.storage.get(key, null);
    const now = Date.now();
    if (cur && cur.tab !== TAB_ID && cur.until > now) return false;
    await TW.storage.set(key, { tab: TAB_ID, until: now + ttlMs });
    return true;
  }

  function loop(name, fn, minMs, maxMs) {
    let stopped = false;
    const run = async () => {
      if (stopped || botState.active) return;
      const delay = jitter(minMs, maxMs);
      try {
        if (await acquireLock(name, delay + 20000) && await guard()) await fn();
      } catch (e) {
        if (!(e instanceof BotCheckError)) TW.log.error(`[${name}] erro no ciclo:`, e);
      }
      if (!stopped && !botState.active) setTimeout(run, delay);
    };
    setTimeout(run, jitter(1500, 4000));
    return () => { stopped = true; };
  }

  // ---------- UI: painel lateral único com cartões ----------
  function h(tag, props = {}, children = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(children)) {
      if (c == null || c === false) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }

  function dockEl() {
    let dock = document.getElementById('twsuite-dock');
    if (dock) return dock;
    const style = h('style', { text: `
      #twsuite-dock{position:fixed;left:10px;top:110px;width:290px;max-height:calc(100vh - 130px);overflow-y:auto;z-index:99990;display:flex;flex-direction:column;gap:8px;font:11px Verdana,Arial,sans-serif;color:#1a1a1a}
      .tws-card{background:#f4e4bc;border:2px solid #7a5230;border-radius:6px;box-shadow:0 3px 10px rgba(0,0,0,.35)}
      .tws-head{display:flex;justify-content:space-between;align-items:center;gap:6px;padding:6px 8px;background:#c1a264;cursor:pointer;font-weight:bold;border-radius:4px 4px 0 0}
      .tws-card.collapsed .tws-body{display:none}
      .tws-card.collapsed .tws-head{border-radius:4px}
      .tws-status{font-weight:normal;font-size:10px;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px}
      .tws-body{padding:8px;display:flex;flex-direction:column;gap:6px}
      .tws-row{display:flex;align-items:center;justify-content:space-between;gap:6px}
      .tws-body input[type=text],.tws-body input[type=number],.tws-body select,.tws-body textarea{font-size:11px;padding:2px 4px;box-sizing:border-box}
      .tws-body button{font-size:11px;cursor:pointer}
      .tws-list{max-height:180px;overflow-y:auto;border-top:1px solid #c1a264;padding-top:4px}
      .tws-muted{opacity:.7;font-size:10px}
      .tws-test{color:#8a4b00;font-weight:bold}
    ` });
    document.head.appendChild(style);
    dock = h('div', { id: 'twsuite-dock' });
    document.body.appendChild(dock);
    return dock;
  }

  function card(id, title) {
    const existing = document.getElementById(`tws-card-${id}`);
    if (existing) existing.remove();
    const status = h('span', { class: 'tws-status' });
    const body = h('div', { class: 'tws-body' });
    const head = h('div', { class: 'tws-head' }, [h('span', { text: title }), status]);
    const el = h('div', { class: 'tws-card', id: `tws-card-${id}` }, [head, body]);
    const key = `twsuite-collapsed:${id}`;
    try { if (localStorage.getItem(key) === '1') el.classList.add('collapsed'); } catch { /* sem storage */ }
    head.addEventListener('click', () => {
      el.classList.toggle('collapsed');
      try { localStorage.setItem(key, el.classList.contains('collapsed') ? '1' : '0'); } catch { /* sem storage */ }
    });
    dockEl().appendChild(el);
    return {
      el,
      body,
      setStatus(text) { status.textContent = text; status.title = text; },
    };
  }

  function parseUnitList(value) {
    if (Array.isArray(value)) return value;
    return String(value || '').split(/[\s,;]+/).map((s) => s.trim()).filter((s) => UNITS.includes(s));
  }

  // ---------- status ao vivo (usado pelo core pra reportar ao dashboard) ----------
  // UNVERIFIED: screen=info_command é a tela padrão de "Visão geral de comandos"
  // do Tribal Wars clássico; formato exato da tabela nunca confirmado ao vivo
  // neste mundo. Falha aqui não deve quebrar o resto do snapshot.
  // Lê o widget "Próprios comandos" / "Comandos chegando" — CONFIRMADO ao
  // vivo duas vezes (2026-09-20, HTML real mandado pelo usuário, com 2 e
  // depois 4 comandos reais): fica em `screen=overview` (a "Visualização
  // geral" da aldeia, com o mapa visual) — **não** em `screen=main` (que é
  // só a tela de Edifício principal). Essa troca de tela era o bug real:
  // o parser em si sempre esteve certo (`#commands_outgoings` >
  // `tr.command-row` > `[data-endtime]`), só buscava a página errada, então
  // nunca achava o container e voltava lista vazia. O incoming usa o mesmo
  // template (id #commands_incomings), dentro de um widget colapsado por
  // padrão quando não há nada chegando — não confirmado com um ataque
  // chegando de verdade ainda, mas é o mesmo widget do jogo, alta confiança
  // por simetria com o outgoing.
  function parseCommandsWidget(doc, containerId) {
    const container = doc.querySelector(`#${containerId}`);
    if (!container) return [];
    const now = TW.serverTime.now();
    const out = [];
    for (const tr of container.querySelectorAll('tr.command-row')) {
      const endEl = tr.querySelector('[data-endtime]');
      if (!endEl) continue;
      const arrivesAtMs = Number(endEl.getAttribute('data-endtime')) * 1000;
      const labelEl = tr.querySelector('.quickedit-label');
      const hintEl = tr.querySelector('.command_hover_details');
      out.push({
        id: hintEl ? hintEl.getAttribute('data-command-id') : null,
        etaMs: Math.max(0, arrivesAtMs - now),
        arrivesAtMs,
        label: labelEl ? labelEl.textContent.replace(/\s+/g, ' ').trim() : null,
        kind: (hintEl && hintEl.getAttribute('data-command-type')) || 'other',
      });
    }
    out.sort((a, b) => a.etaMs - b.etaMs);
    return out;
  }

  async function getIncomingAttacks(vid) {
    try {
      const { doc } = await getPage(`/game.php?village=${vid}&screen=overview`);
      return parseCommandsWidget(doc, 'commands_incomings');
    } catch (e) {
      if (e instanceof BotCheckError) throw e;
      return null; // widget pode não existir nesta conta/tela — não derruba o snapshot
    }
  }

  async function troopsHome(vid) {
    try {
      const doc = await getPlaceDoc(vid);
      return availableUnits(doc);
    } catch {
      return null;
    }
  }

  // Comandos que EU enviei e ainda estão viajando (ataque/apoio). Sem isso
  // não dava pra ver na tela nem no dashboard que o Auto Farm realmente
  // mandou algo, só o efeito colateral (alvo sumindo da lista).
  async function getOutgoingCommands(vid) {
    try {
      const { doc } = await getPage(`/game.php?village=${vid}&screen=overview`);
      return parseCommandsWidget(doc, 'commands_outgoings');
    } catch (e) {
      if (e instanceof BotCheckError) throw e;
      return null;
    }
  }

  // Fila de construção exibida na tela (nome, nível-alvo, tempo restante).
  // UNVERIFIED: extrai por texto, não por seletor fixo, mas o formato real
  // da tabela nunca foi confirmado ao vivo.
  function readBuildQueue(doc) {
    const rows = [];
    for (const tr of doc.querySelectorAll('#build_queue tr[class*="buildorder_"]')) {
      const cells = [...tr.querySelectorAll('td')].map((td) => td.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
      if (!cells.length) continue;
      const first = cells[0];
      const levelMatch = first.match(/N[íi]vel\s*(\d+)/i);
      const name = first.replace(/N[íi]vel\s*\d+/i, '').trim() || first;
      const remaining = cells.find((c) => /^\d{1,2}:\d{2}:\d{2}$/.test(c)) || null;
      const etaText = cells.find((c) => /\bàs\b/i.test(c)) || null;
      rows.push({ name, level: levelMatch ? Number(levelMatch[1]) : null, remaining, etaText });
    }
    return rows;
  }

  // Fila de recrutamento nas telas de treino (quartel/estábulo/oficina) —
  // CONFIRMADO ao vivo (2026-09-20, HTML real mandado pelo usuário, tela do
  // quartel): o container é `#trainqueue_wrap_<edifício>`, com DUAS <tbody>
  // dentro da mesma tabela — a primeira (sem id, linha `.lit`) é a unidade
  // em treino agora, a segunda (`#trainqueue_<edifício>`) é a fila atrás
  // dela, mesmo formato de linha nas duas. A unidade não vem como texto
  // "10x Lanceiro" (como eu tinha suposto) — vem como `1 Lanceiro` com um
  // `<div class="unit_sprite ... <código-da-unidade>">` do lado, então lemos
  // o tipo da tropa pela classe do sprite (mais confiável que ler o rótulo
  // em português). A última linha da fila ("Cancelar tudo") não tem 3 <td>
  // úteis e é ignorada.
  async function readTrainQueueForBuilding(vid, building, label) {
    try {
      const { doc } = await getPage(`/game.php?village=${vid}&screen=${building}`);
      const container = doc.querySelector(`#trainqueue_wrap_${building}`) || doc.querySelector('.trainqueue_wrap');
      if (!container) return [];
      const rows = [];
      for (const tr of container.querySelectorAll('tbody tr')) {
        const cells = tr.querySelectorAll('td');
        if (cells.length < 3) continue; // cabeçalho ou linha "Cancelar tudo"
        const remaining = cells[1].textContent.trim();
        if (!/^\d{1,2}:\d{2}:\d{2}$/.test(remaining)) continue;
        const spriteEl = tr.querySelector('[class*="unit_sprite"]');
        const unit = spriteEl ? UNITS.find((u) => spriteEl.classList.contains(u)) : null;
        const countText = cells[0].textContent.replace(/\s+/g, ' ').trim();
        const countMatch = countText.match(/^(\d+)/);
        rows.push({ building: label, unit, name: countText, count: countMatch ? Number(countMatch[1]) : null, remaining });
      }
      return rows;
    } catch {
      return [];
    }
  }

  async function getTrainQueue(vid) {
    const [barracks, stable, garage] = await Promise.all([
      readTrainQueueForBuilding(vid, 'barracks', 'Quartel'),
      readTrainQueueForBuilding(vid, 'stable', 'Estábulo'),
      readTrainQueueForBuilding(vid, 'garage', 'Oficina'),
    ]);
    return [...barracks, ...stable, ...garage];
  }

  // Status da Coleta (screen=place&mode=scavenge) — CONFIRMADO ao vivo
  // (2026-09-20, JS real mandado pelo usuário, antes e depois de clicar pra
  // coletar). A tela não é HTML estático: o conteúdo visível é montado por
  // JS a partir de `var village = {...}` embutido no <script> da própria
  // página — igual ao `game_data`, então dá pra ler por texto sem executar
  // nada (mesma técnica de `gameDataFromHtml`). Cada opção (1-4, "Pequena"
  // até "Extrema Coleta") tem `is_locked` e, se ocupada, `scavenging_squad`
  // com `return_time` (epoch em SEGUNDOS — precisa ×1000), `unit_counts` e
  // `loot_res`. Antes disso o módulo de Coleta lia esses mesmos dados só
  // pra decidir enviar ou não, e descartava tudo — por isso o card não
  // mostrava nada além de "todas em andamento".
  function parseScavengeVillageData(text) {
    const m = text.match(/var village = (\{.+?\});/s);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch { return null; }
  }

  async function getScavengeStatus(vid) {
    try {
      const { text } = await getPage(`/game.php?village=${vid}&screen=place&mode=scavenge`);
      const data = parseScavengeVillageData(text);
      if (!data || !data.options) return null;
      return Object.entries(data.options).map(([id, o]) => {
        const squad = o.scavenging_squad;
        return {
          id: Number(id),
          locked: !!o.is_locked,
          busy: !!squad,
          returnAtMs: squad ? squad.return_time * 1000 : null,
          units: squad ? squad.unit_counts : null,
          loot: squad ? squad.loot_res : null,
        };
      });
    } catch (e) {
      if (e instanceof BotCheckError) throw e;
      return null;
    }
  }

  // "0:11:31" / "0:04:15" → ms. Usado pra transformar o texto de contagem
  // regressiva (que já vem formatado do jogo) num horário-alvo absoluto, pra
  // dar pra manter um relógio rodando localmente entre sincronizações, em
  // vez do número só "congelar" até o próximo ciclo.
  function parseCountdownToMs(text) {
    const m = String(text || '').match(/^(\d+):(\d{2}):(\d{2})$/);
    if (!m) return null;
    return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000;
  }

  async function buildLiveSnapshot() {
    const g = gd();
    if (!g || !g.village) return null;
    const vid = g.village.id;
    const [troops, incoming, outgoing, buildQueue, trainQueue, scavenge] = await Promise.all([
      troopsHome(vid).catch(() => null),
      getIncomingAttacks(vid).catch(() => null),
      getOutgoingCommands(vid).catch(() => null),
      getPage(`/game.php?village=${vid}&screen=main`).then((p) => readBuildQueue(p.doc)).catch(() => null),
      getTrainQueue(vid).catch(() => null),
      getScavengeStatus(vid).catch(() => null),
    ]);
    const now = TW.serverTime.now();
    const withEta = (list) => list ? list.map((item) => {
      const ms = parseCountdownToMs(item.remaining);
      return ms == null ? item : { ...item, etaAtMs: now + ms };
    }) : list;
    const buildingLevels = {};
    if (g.village.buildings) {
      for (const [b, lvl] of Object.entries(g.village.buildings)) buildingLevels[b] = Number(lvl) || 0;
    }
    return {
      at: Date.now(),
      village: { id: vid, name: g.village.name, x: g.village.x, y: g.village.y },
      resources: { wood: Math.floor(g.village.wood), stone: Math.floor(g.village.stone), iron: Math.floor(g.village.iron), storageMax: g.village.storage_max },
      points: g.player ? Number(g.player.points) : null,
      villages: g.player ? Number(g.player.villages) : null,
      troops,
      buildingLevels,
      incoming: incoming ? incoming.slice(0, 5) : null,
      incomingAttacks: incoming ? incoming.filter((c) => c.kind === 'attack').length : null,
      outgoing: outgoing ? outgoing.slice(0, 5) : null,
      outgoingAttacks: outgoing ? outgoing.filter((c) => c.kind === 'attack').length : null,
      buildQueue: withEta(buildQueue),
      buildQueueAt: buildQueue ? Date.now() : undefined,
      trainQueue: withEta(trainQueue),
      trainQueueAt: trainQueue ? Date.now() : undefined,
      scavenge,
      scavengeAt: scavenge ? Date.now() : undefined,
    };
  }

  // ---------- relatórios de ataque ----------
  // Lista da tela `screen=report&mode=attack` — CONFIRMADO ao vivo
  // (2026-09-20, HTML real do usuário: lista e um relatório aberto). Cada
  // linha é `tr[class*="report-"]` (opcionalmente prefixada "unread "),
  // com o id vindo de `data-id` no `.report-link` (mais confiável que
  // extrair da classe da linha).
  async function getAttackReportsList(vid, { limit = 20 } = {}) {
    try {
      const { doc } = await getPage(`/game.php?village=${vid}&screen=report&mode=attack`);
      const rows = [];
      for (const tr of doc.querySelectorAll('#report_list tr[class*="report-"]')) {
        const link = tr.querySelector('.report-link[data-id]');
        if (!link) continue;
        const labelEl = tr.querySelector('.quickedit-label');
        const dotEl = tr.querySelector('img[src*="/dots/"]');
        const dateEl = tr.querySelector('td.nowrap');
        const iconMatch = dotEl ? (dotEl.getAttribute('src') || '').match(/dots\/(\w+)\.webp/) : null;
        rows.push({
          id: link.getAttribute('data-id'),
          title: labelEl ? labelEl.textContent.replace(/\s+/g, ' ').trim() : null,
          resultLabel: dotEl ? dotEl.getAttribute('title') : null,
          resultIcon: iconMatch ? iconMatch[1] : null,
          unread: /(^|\s)unread(\s|$)/.test(tr.className),
          receivedAtText: dateEl ? dateEl.textContent.trim() : null,
        });
        if (rows.length >= limit) break;
      }
      return rows;
    } catch (e) {
      if (e instanceof BotCheckError) throw e;
      return null;
    }
  }

  // Lê uma linha "Quantidade:"/"Perdas:" de uma tabela de tropas de relatório
  // (`#attack_info_att_units`/`#attack_info_def_units`) — cada célula de
  // unidade tem `data-unit-count` e uma classe `unit-item-<unidade>`.
  function parseReportUnitRow(table, rowLabel) {
    const out = {};
    if (!table) return out;
    for (const tr of table.querySelectorAll('tr')) {
      const firstTd = tr.querySelector('td');
      if (!firstTd || !firstTd.textContent.trim().startsWith(rowLabel)) continue;
      for (const td of tr.querySelectorAll('td[data-unit-count]')) {
        const unitClass = [...td.classList].find((c) => c.startsWith('unit-item-') && c !== 'unit-item');
        const unit = unitClass ? unitClass.replace('unit-item-', '') : null;
        if (unit) out[unit] = Number(td.getAttribute('data-unit-count')) || 0;
      }
      break;
    }
    return out;
  }

  // Relatório de ataque aberto (`screen=report&mode=all&group_id=0&view=<id>`)
  // — CONFIRMADO ao vivo. Extrai tropas enviadas/perdidas dos dois lados,
  // saque e aldeia de origem/destino. Só cobre relatórios de ATAQUE
  // (`report_ReportAttack`) — apoio/comércio/outros tipos têm layout
  // diferente, não tratado aqui.
  async function getAttackReportDetail(vid, reportId) {
    try {
      const { doc } = await getPage(`/game.php?village=${vid}&screen=report&mode=all&group_id=0&view=${reportId}`);
      const titleEl = doc.querySelector('.quickedit-label');
      const dotEl = doc.querySelector('table.vis img[src*="/dots/"]');
      const resultH3 = doc.querySelector('.report_ReportAttack h3');
      const attTable = doc.querySelector('#attack_info_att_units');
      const defTable = doc.querySelector('#attack_info_def_units');
      const origin = doc.querySelector('#attack_info_att .village_anchor');
      const target = doc.querySelector('#attack_info_def .village_anchor');
      const lootRow = doc.querySelector('#attack_results tr');
      let loot = null;
      if (lootRow) {
        loot = {};
        for (const span of lootRow.querySelectorAll('span.nowrap')) {
          const iconEl = span.querySelector('[class*="icon header"]');
          const cls = iconEl ? RESOURCES.find((r) => iconEl.classList.contains(r)) : null;
          if (cls) loot[cls] = num(span.textContent);
        }
        const capacityTd = lootRow.querySelectorAll('td')[1];
        if (capacityTd) loot.capacityText = capacityTd.textContent.trim();
      }
      if (!attTable && !defTable) return null; // não é um relatório de ataque (layout diferente)
      return {
        id: reportId,
        title: titleEl ? titleEl.textContent.replace(/\s+/g, ' ').trim() : null,
        resultLabel: dotEl ? dotEl.getAttribute('title') : null,
        resultText: resultH3 ? resultH3.textContent.trim() : null,
        attackerSent: parseReportUnitRow(attTable, 'Quantidade'),
        attackerLosses: parseReportUnitRow(attTable, 'Perdas'),
        defenderTroops: parseReportUnitRow(defTable, 'Quantidade'),
        defenderLosses: parseReportUnitRow(defTable, 'Perdas'),
        origin: origin ? { id: origin.getAttribute('data-id'), playerId: origin.getAttribute('data-player'), name: origin.textContent.replace(/\s+/g, ' ').trim() } : null,
        target: target ? { id: target.getAttribute('data-id'), playerId: target.getAttribute('data-player'), name: target.textContent.replace(/\s+/g, ' ').trim() } : null,
        loot,
      };
    } catch (e) {
      if (e instanceof BotCheckError) throw e;
      return null;
    }
  }

  TW.shared = {
    TAB_ID, pageWin, UNITS, UNIT_LABELS, RESOURCES, RES_LABELS, BotCheckError,
    sleep, jitter, gd, csrf, villageId, dist, num, parseHtml, gameDataFromHtml, formParams,
    getPage, postForm, ajax, errorFromHtml, guard, pageHasBotCheck, flagBotCheck, botState,
    prepareCommand, confirmCommand, sendCommand, availableUnits, listCancelableCommands, cancelLinks, cancelCommand,
    sendResources, premiumExchange, premiumExchangeRates, getVillageIndex, myVillages, parseGameTime, formatServerTime, serverWallOffsetMs, worldConfig,
    notify, acquireLock, loop, h, card, parseUnitList, getIncomingAttacks, getOutgoingCommands, troopsHome,
    readBuildQueue, getTrainQueue, buildLiveSnapshot, getAttackReportsList, getAttackReportDetail, getScavengeStatus,
  };
})();

// ============================================================
// MÓDULO INTERNO: live-status — snapshot ao vivo pro dashboard
//
// Sempre ativo (não aparece nem precisa ser ligado no dashboard).
// A cada ~75s junta recursos/tropas/ataques a caminho (buildLiveSnapshot,
// em shared.js) e guarda em storage:'accounts', a mesma estrutura que o
// core já expõe pra ponte do dashboard (profiles.reportStatus/bridge
//'pull'). O dashboard lê isso e mostra sem precisar de ação manual.
// ============================================================
(function registerLiveStatus() {
  'use strict';
  const TW = window.TWSuite;
  const S = TW.shared;

  function renderList(host, items, emptyText) {
    host.innerHTML = '';
    if (!items || !items.length) {
      host.appendChild(S.h('div', { class: 'tws-muted', text: emptyText }));
      return;
    }
    for (const line of items) host.appendChild(S.h('div', { class: 'tws-row', text: line }));
  }

  // Formata ms restantes como "H:MM:SS", igual ao texto que o próprio jogo
  // mostra — usado pra manter a contagem regressiva rodando localmente entre
  // sincronizações (a cada ~15-25s), em vez do número ficar parado até o
  // próximo ciclo buscar a página de novo.
  function fmtCountdown(ms) {
    const total = Math.max(0, Math.floor((ms || 0) / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  TW.registerModule({
    id: 'live-status',
    name: 'Status ao Vivo (interno)',
    screens: ['any'],
    defaultEnabled: true,
    async run(ctx) {
      // Antes só aparecia visível de algum jeito no dashboard, e mesmo lá
      // dependia de outro módulo estar ligado pra reportar. Agora tem um
      // cartão próprio, sempre visível dentro do jogo também.
      const ui = S.card('live-status', 'Status ao Vivo');
      const resHost = S.h('div');
      const buildHost = S.h('div', { class: 'tws-list' });
      const trainHost = S.h('div', { class: 'tws-list' });
      const cmdHost = S.h('div', { class: 'tws-list' });
      const scavengeHost = S.h('div', { class: 'tws-list' });
      ui.body.append(
        resHost,
        S.h('div', { style: { fontWeight: 'bold', fontSize: '10px', marginTop: '4px' }, text: 'Construindo' }), buildHost,
        S.h('div', { style: { fontWeight: 'bold', fontSize: '10px', marginTop: '4px' }, text: 'Recrutando' }), trainHost,
        S.h('div', { style: { fontWeight: 'bold', fontSize: '10px', marginTop: '4px' }, text: 'Comandos' }), cmdHost,
        S.h('div', { style: { fontWeight: 'bold', fontSize: '10px', marginTop: '4px' }, text: 'Coletando' }), scavengeHost,
      );

      // `lastSnap` é redesenhado a cada segundo (renderTick), sem refazer
      // nenhuma requisição — só recalcula os "faltam Xh" a partir dos
      // horários absolutos (etaAtMs/arrivesAtMs) já capturados no último
      // ciclo real (S.loop, a cada ~15-25s). É esse o "relógio próprio" que
      // o usuário pediu: fica vivo entre sincronizações, e a sincronização
      // seguinte só corrige o valor pro real, não reinicia a contagem.
      let lastSnap = null;

      function renderTick() {
        if (!lastSnap) return;
        const now = S.serverTime.now();
        renderList(buildHost, (lastSnap.buildQueue || []).map((q) =>
          `${q.name}${q.level ? ` nv.${q.level}` : ''}${q.etaAtMs ? ` · ${fmtCountdown(q.etaAtMs - now)}` : q.remaining ? ` · ${q.remaining}` : ''}`
        ), 'Nada na fila agora.');
        renderList(trainHost, (lastSnap.trainQueue || []).map((t) =>
          `${t.building}: ${t.name}${t.etaAtMs ? ` · ${fmtCountdown(t.etaAtMs - now)}` : t.remaining ? ` · ${t.remaining}` : ''}`
        ), 'Nada treinando agora.');

        const cmdLines = [];
        for (const c of (lastSnap.outgoing || [])) {
          const arrived = c.arrivesAtMs <= now;
          const returnTxt = !c.returnAtMs ? ''
            : c.returnAtMs <= now ? ' · de volta' : ` · volta em ~${fmtCountdown(c.returnAtMs - now)}`;
          cmdLines.push(`${c.kind === 'attack' ? '⚔' : '🛡'} ${c.label || '?'} — ${arrived ? 'chegou' : `chega em ${fmtCountdown(c.arrivesAtMs - now)}`}${returnTxt}`);
        }
        for (const c of (lastSnap.incoming || [])) {
          if (c.arrivesAtMs <= now) continue;
          cmdLines.push(`⚠ ${c.label || 'comando'} chegando em ${fmtCountdown(c.arrivesAtMs - now)}`);
        }
        renderList(cmdHost, cmdLines, 'Nenhum comando ativo.');

        const scavengeLines = [];
        for (const s of (lastSnap.scavenge || [])) {
          if (s.locked) continue;
          if (!s.busy) { scavengeLines.push(`Opção ${s.id}: livre`); continue; }
          const unitsTxt = s.units ? Object.entries(s.units).filter(([, n]) => n > 0).map(([u, n]) => `${n} ${S.UNIT_LABELS[u] || u}`).join(', ') : '';
          const returned = s.returnAtMs != null && s.returnAtMs <= now;
          scavengeLines.push(`Opção ${s.id}: ${returned ? 'de volta' : `volta em ${fmtCountdown(s.returnAtMs - now)}`}${unitsTxt ? ` (${unitsTxt})` : ''}`);
        }
        renderList(scavengeHost, scavengeLines, 'Nenhuma opção de coleta disponível.');
      }
      setInterval(renderTick, 1000);

      // Antes só mostrava fila de construção/recrutamento quando o módulo
      // de automação correspondente estava ligado (era ele quem lia e
      // reportava). Status ao Vivo roda sempre — agora é a única fonte
      // dessas leituras, pra aparecer mesmo com tudo desligado. Intervalo
      // encurtado (era 60-95s) porque o usuário reportou demora grande
      // pra atualizar.
      S.loop('live-status', async () => {
        const snap = await S.buildLiveSnapshot();
        if (!snap) return;

        // Estimativa de ida+volta dos comandos enviados: a tela só dá a
        // hora de CHEGADA, nunca quando foi enviado. Aproximamos "enviado"
        // pela primeira vez que este ciclo viu aquele comando (atraso real
        // de no máximo ~25s, pequeno perto do tempo de viagem de um
        // ataque). Ida = volta em condições normais, então
        // volta ≈ 2×chegada − primeira-vez-visto. Só fica disponível a
        // partir do 2º ciclo em que o mesmo comando aparece — por isso
        // "~" no texto exibido, é estimativa, não a hora exata do jogo.
        if (snap.outgoing && snap.outgoing.length) {
          const firstSeen = (await ctx.storage.get('live-status:cmdFirstSeen', {})) || {};
          const now = Date.now();
          let changed = false;
          for (const cmd of snap.outgoing) {
            if (!cmd.id) continue;
            if (!firstSeen[cmd.id]) { firstSeen[cmd.id] = now; changed = true; }
            else cmd.returnAtMs = 2 * cmd.arrivesAtMs - firstSeen[cmd.id];
          }
          const stillHere = new Set(snap.outgoing.map((c) => c.id).filter(Boolean));
          for (const id of Object.keys(firstSeen)) {
            if (!stillHere.has(id)) { delete firstSeen[id]; changed = true; }
          }
          if (changed) await ctx.storage.set('live-status:cmdFirstSeen', firstSeen);
        }

        resHost.textContent = snap.resources
          ? `${S.RES_LABELS.wood} ${snap.resources.wood} · ${S.RES_LABELS.stone} ${snap.resources.stone} · ${S.RES_LABELS.iron} ${snap.resources.iron} (máx ${snap.resources.storageMax})`
          : '';
        lastSnap = snap;
        renderTick();
        ui.setStatus(`atualizado ${new Date().toLocaleTimeString()}`);

        const key = TW.accountKeyFromGame && TW.accountKeyFromGame();
        if (!key) return;
        const accounts = (await ctx.storage.get('accounts', {})) || {};
        accounts[key] = { ...(accounts[key] || {}), ...snap, lastSeen: Date.now() };
        await ctx.storage.set('accounts', accounts);
      }, 15000, 25000);
    },
  });
})();

// ============================================================
// MÓDULO INTERNO: battle-reports — relatórios de ataque (saque, perdas)
//
// Pedido do usuário: "relatórios de ataques (aldeias saqueadas, tropas
// abatidas, recursos roubados)". Sempre ativo, mesmo padrão do live-status.
// A cada ciclo lê a lista de `screen=report&mode=attack` (CONFIRMADO ao
// vivo, ver shared.js/getAttackReportsList) e, pra qualquer id novo nunca
// visto (rastreado em storage), busca o relatório aberto
// (getAttackReportDetail, também CONFIRMADO ao vivo) e guarda um resumo
// num log com os últimos 50, tanto no painel do jogo quanto em
// storage:'accounts' pro dashboard.
// ============================================================
(function registerBattleReports() {
  'use strict';
  const TW = window.TWSuite;
  const S = TW.shared;
  const MODULE_ID = 'battle-reports';
  const LOG_LIMIT = 50;
  const SEEN_LIMIT = 300; // teto pra lista de ids já processados não crescer pra sempre
  const DAILY_LIMIT = 14; // dias de agregação guardados, pro gráfico do dashboard

  // Chave local (não do servidor) — precisão de dia é suficiente pro
  // gráfico, e evita parsear a data em português do relatório (frágil,
  // depende de locale) só pra bucketizar por dia.
  function dayKey(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function addToDaily(daily, summary) {
    const key = dayKey(summary.at);
    const bucket = daily[key] || { wins: 0, losses: 0, other: 0, lootWood: 0, lootStone: 0, lootIron: 0, myLosses: 0, enemyLosses: 0, attacks: 0 };
    bucket.attacks += 1;
    if (summary.resultIcon === 'green') bucket.wins += 1;
    else if (summary.resultIcon === 'yellow') bucket.losses += 1;
    else bucket.other += 1;
    if (summary.loot) {
      bucket.lootWood += summary.loot.wood || 0;
      bucket.lootStone += summary.loot.stone || 0;
      bucket.lootIron += summary.loot.iron || 0;
    }
    bucket.myLosses += summary.lostAtt || 0;
    bucket.enemyLosses += summary.lostDef || 0;
    daily[key] = bucket;
    const keys = Object.keys(daily).sort();
    while (keys.length > DAILY_LIMIT) delete daily[keys.shift()];
  }

  function summarize(row, detail) {
    const lostAtt = detail ? Object.values(detail.attackerLosses || {}).reduce((a, b) => a + b, 0) : null;
    const lostDef = detail ? Object.values(detail.defenderLosses || {}).reduce((a, b) => a + b, 0) : null;
    const lootTotal = detail && detail.loot ? S.RESOURCES.reduce((sum, r) => sum + (detail.loot[r] || 0), 0) : null;
    return {
      id: row.id,
      title: (detail && detail.title) || row.title,
      resultLabel: (detail && detail.resultLabel) || row.resultLabel,
      resultIcon: row.resultIcon,
      target: detail && detail.target ? detail.target.name : null,
      lostAtt, lostDef, lootTotal,
      loot: detail ? detail.loot : null,
      at: Date.now(),
    };
  }

  function renderList(host, log) {
    host.innerHTML = '';
    if (!log || !log.length) {
      host.appendChild(S.h('div', { class: 'tws-muted', text: 'Nenhum relatório de ataque ainda.' }));
      return;
    }
    for (const b of log.slice(0, 8)) {
      const icon = b.resultIcon === 'green' ? '✅' : b.resultIcon === 'yellow' ? '⚠️' : '❔';
      const lootTxt = b.loot ? ` · 🪵${b.loot.wood || 0} 🧱${b.loot.stone || 0} ⛏${b.loot.iron || 0}` : '';
      const lossTxt = b.lostAtt ? ` · perdi ${b.lostAtt}` : '';
      host.appendChild(S.h('div', { class: 'tws-row', text: `${icon} ${b.target || b.title || '?'}${lootTxt}${lossTxt}` }));
    }
  }

  TW.registerModule({
    id: MODULE_ID,
    name: 'Relatórios de Ataque (interno)',
    screens: ['any'],
    defaultEnabled: true,
    async run(ctx) {
      const ui = S.card(MODULE_ID, 'Relatórios de Ataque');
      const listHost = S.h('div', { class: 'tws-list' });
      ui.body.append(listHost);

      S.loop(MODULE_ID, async () => {
        const vid = S.villageId();
        if (!vid) return;
        const rows = await S.getAttackReportsList(vid, { limit: 15 });
        if (!rows) return;

        const seen = (await ctx.storage.get(`${MODULE_ID}:seen`, [])) || [];
        const seenSet = new Set(seen);
        // Só relatórios que realmente têm um resultado de combate (bolinha
        // colorida) — a tela já vem filtrada por mode=attack, isso aqui é
        // só uma rede de segurança contra algo inesperado na lista.
        const newOnes = rows.filter((r) => r.resultIcon && !seenSet.has(r.id));

        let log = (await ctx.storage.get(`${MODULE_ID}:log`, [])) || [];
        let daily = (await ctx.storage.get(`${MODULE_ID}:daily`, {})) || {};
        for (const row of newOnes) {
          const detail = await S.getAttackReportDetail(vid, row.id);
          const summary = summarize(row, detail);
          log.unshift(summary);
          addToDaily(daily, summary);
          seenSet.add(row.id);
        }
        if (newOnes.length) {
          log = log.slice(0, LOG_LIMIT);
          await ctx.storage.set(`${MODULE_ID}:log`, log);
          await ctx.storage.set(`${MODULE_ID}:daily`, daily);
          await ctx.storage.set(`${MODULE_ID}:seen`, [...seenSet].slice(-SEEN_LIMIT));
        }

        renderList(listHost, log);
        ui.setStatus(newOnes.length ? `+${newOnes.length} novo(s) · atualizado ${new Date().toLocaleTimeString()}` : `atualizado ${new Date().toLocaleTimeString()}`);

        const key = TW.accountKeyFromGame && TW.accountKeyFromGame();
        if (!key) return;
        const accounts = (await ctx.storage.get('accounts', {})) || {};
        accounts[key] = { ...(accounts[key] || {}), battleLog: log.slice(0, 10), battleDaily: daily, battleLogAt: Date.now() };
        await ctx.storage.set('accounts', accounts);
      }, 90000, 150000);
    },
  });
})();

// ============================================================
// MÓDULO: auto-farm (reescrito v1.4.0 — ondas contínuas)
//
// Até v1.3: encontrava alvos e mostrava botão "Enviar" por linha —
// exigia clique humano em cada ataque. Pedido do usuário: farm
// totalmente autônomo — mantém até N ataques ("ondas") viajando ao
// mesmo tempo, e assim que uma onda volta pra casa, dispara a
// próxima sozinho, sem clique nenhum.
//
// Envio em si: VERIFIED (mesmo `S.sendCommand`, payload idêntico ao
// validado ao vivo em 2026-09-19 — dois POSTs reais, ver
// verification-log.md). O que é NOVO e ainda UNVERIFIED nesta versão:
//   - Rastreio de "ondas no ar" — assume que uma onda volta em
//     2×durationMs (ida+volta) contado a partir do envio. Se as
//     tropas morrerem no ataque (sem voltar) ou o jogo cobrar tempo
//     diferente por algum motivo, o contador de ondas pode ficar
//     desalinhado da realidade — isso só afasta o farm do teto
//     configurado (fica mais conservador), nunca manda mais ataque
//     do que devia.
//   - Limite por hora e pausa noturna — lógica simples de contagem/
//     janela de horário, nunca testada em uso real.
// ============================================================
(function registerAutoFarmModule() {
  'use strict';

  const TW = window.TWSuite;
  const S = TW.shared;
  const MODULE_ID = 'auto-farm';

  const UNIT_FIELDS = S.UNITS;
  const UNIT_LABELS = S.UNIT_LABELS;

  const DEFAULT_SETTINGS = {
    templates: [], // { id, name, units: { spear: 10, sword: 10, ... } }
    activeTemplateId: null,
    maxDistance: 12,
    cooldownMinutes: 30,
    maxConcurrentWaves: 1,
    enableHourlyLimit: false,
    attacksPerHour: 20,
    enableNightPause: false,
    nightPauseStart: '00:00',
    nightPauseEnd: '06:00',
    dryRun: true,
  };

  function makeTemplateId() {
    return 'tpl_' + Math.random().toString(36).slice(2, 10);
  }

  function cooldownKey(sourceId, targetId) {
    return `auto-farm:lastSent:${sourceId}:${targetId}`;
  }
  function wavesKey(vid) {
    return `auto-farm:waves:${vid}`;
  }
  function sendLogKey(vid) {
    return `auto-farm:sendLog:${vid}`;
  }

  async function getWaves(storage, vid) {
    return (await storage.get(wavesKey(vid), [])) || [];
  }
  async function pruneWaves(storage, vid) {
    const waves = await getWaves(storage, vid);
    const now = Date.now();
    const alive = waves.filter((w) => w.returnAt > now);
    if (alive.length !== waves.length) await storage.set(wavesKey(vid), alive);
    return alive;
  }
  async function addWave(storage, vid, wave) {
    const waves = await getWaves(storage, vid);
    waves.push(wave);
    await storage.set(wavesKey(vid), waves);
  }

  async function recordSend(storage, vid) {
    const cutoff = Date.now() - 3600000;
    const log = ((await storage.get(sendLogKey(vid), [])) || []).filter((t) => t > cutoff);
    log.push(Date.now());
    await storage.set(sendLogKey(vid), log);
  }
  async function hourlyCount(storage, vid) {
    const cutoff = Date.now() - 3600000;
    const log = (await storage.get(sendLogKey(vid), [])) || [];
    return log.filter((t) => t > cutoff).length;
  }

  function parseHM(s) {
    const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }
  function isNightPaused(settings) {
    if (!settings.enableNightPause) return false;
    const start = parseHM(settings.nightPauseStart);
    const end = parseHM(settings.nightPauseEnd);
    if (start == null || end == null || start === end) return false;
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    return start < end ? (cur >= start && cur < end) : (cur >= start || cur < end);
  }

  async function findTargets(storage, myVillage, settings, excludeIds) {
    const villages = await S.getVillageIndex();
    const now = Date.now();
    const candidates = [];
    for (const v of villages) {
      if (v.owner !== '0') continue;
      if (String(v.id) === String(myVillage.id)) continue;
      if (excludeIds.has(String(v.id))) continue;
      const d = S.dist(myVillage.x, myVillage.y, v.x, v.y);
      if (d > settings.maxDistance) continue;
      const lastSent = await storage.get(cooldownKey(myVillage.id, v.id), 0);
      if (now - lastSent < settings.cooldownMinutes * 60000) continue;
      candidates.push({ ...v, distance: d });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    return candidates;
  }

  // ------------------------------------------------------------
  // UI: gerenciador de modelos de tropas (igual às versões
  // anteriores — o dashboard também edita os mesmos dados, essa
  // parte só existe pra quem prefere editar sem sair do jogo).
  // ------------------------------------------------------------
  function createUnitGrid(initialValues) {
    const grid = document.createElement('div');
    Object.assign(grid.style, { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px', margin: '4px 0' });
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

  function renderTemplateManager(container, settings, onSettingsChange) {
    const wrap = document.createElement('div');
    wrap.style.marginBottom = '8px';
    wrap.style.borderBottom = '1px solid #c1a264';
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
    const editBtn = document.createElement('button');
    editBtn.textContent = 'Editar';
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Excluir';

    row.append(select, newBtn, editBtn, delBtn);
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
      cancelBtn.style.marginTop = '4px';
      cancelBtn.addEventListener('click', () => { editorHost.innerHTML = ''; });

      editorHost.append(nameInput, grid.el, saveBtn, cancelBtn);
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

  function renderPaceSettings(container, settings, onChange) {
    const wrap = document.createElement('div');
    wrap.style.marginBottom = '8px';
    wrap.style.borderBottom = '1px solid #c1a264';
    wrap.style.paddingBottom = '8px';
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '4px';

    const row1 = document.createElement('div');
    const distInput = document.createElement('input');
    distInput.type = 'number';
    distInput.min = '1';
    distInput.value = String(settings.maxDistance);
    distInput.style.width = '48px';
    distInput.addEventListener('change', () => onChange({ maxDistance: Math.max(1, Number(distInput.value) || 1) }));
    row1.append('Alcance: ', distInput, ' campos');

    const row2 = document.createElement('div');
    const wavesInput = document.createElement('input');
    wavesInput.type = 'number';
    wavesInput.min = '1';
    wavesInput.max = '20';
    wavesInput.value = String(settings.maxConcurrentWaves);
    wavesInput.style.width = '48px';
    wavesInput.addEventListener('change', () => onChange({ maxConcurrentWaves: Math.max(1, Number(wavesInput.value) || 1) }));
    row2.append('Ondas simultâneas: ', wavesInput);

    const row3 = document.createElement('div');
    const cdInput = document.createElement('input');
    cdInput.type = 'number';
    cdInput.min = '1';
    cdInput.value = String(settings.cooldownMinutes);
    cdInput.style.width = '48px';
    cdInput.addEventListener('change', () => onChange({ cooldownMinutes: Math.max(1, Number(cdInput.value) || 1) }));
    row3.append('Espera por alvo: ', cdInput, ' min');

    const row4 = document.createElement('label');
    const hourlyCb = document.createElement('input');
    hourlyCb.type = 'checkbox';
    hourlyCb.checked = settings.enableHourlyLimit;
    const hourlyInput = document.createElement('input');
    hourlyInput.type = 'number';
    hourlyInput.min = '1';
    hourlyInput.value = String(settings.attacksPerHour);
    hourlyInput.style.width = '48px';
    hourlyCb.addEventListener('change', () => onChange({ enableHourlyLimit: hourlyCb.checked }));
    hourlyInput.addEventListener('change', () => onChange({ attacksPerHour: Math.max(1, Number(hourlyInput.value) || 1) }));
    row4.append(hourlyCb, ' Limite de ', hourlyInput, ' ataques/hora');

    const row5 = document.createElement('label');
    const nightCb = document.createElement('input');
    nightCb.type = 'checkbox';
    nightCb.checked = settings.enableNightPause;
    const startInput = document.createElement('input');
    startInput.type = 'text';
    startInput.placeholder = '00:00';
    startInput.value = settings.nightPauseStart;
    startInput.style.width = '44px';
    const endInput = document.createElement('input');
    endInput.type = 'text';
    endInput.placeholder = '06:00';
    endInput.value = settings.nightPauseEnd;
    endInput.style.width = '44px';
    nightCb.addEventListener('change', () => onChange({ enableNightPause: nightCb.checked }));
    startInput.addEventListener('change', () => onChange({ nightPauseStart: startInput.value.trim() }));
    endInput.addEventListener('change', () => onChange({ nightPauseEnd: endInput.value.trim() }));
    row5.append(nightCb, ' Pausar de ', startInput, ' até ', endInput, ' (seu horário local)');

    const dryRunLabel = document.createElement('label');
    const dryRunCb = document.createElement('input');
    dryRunCb.type = 'checkbox';
    dryRunCb.checked = settings.dryRun;
    dryRunCb.addEventListener('change', () => onChange({ dryRun: dryRunCb.checked }));
    dryRunLabel.append(dryRunCb, ' Modo teste (não envia de verdade)');

    wrap.append(row1, row2, row3, row4, row5, dryRunLabel);
    container.appendChild(wrap);
  }

  TW.registerModule({
    id: MODULE_ID,
    name: 'Auto Farm (sem premium)',
    // Antes só rodava com `screens: ['place']` — exigia deixar a aba
    // parada na Praça de Reunião, senão o módulo nem chegava a iniciar
    // o loop. O envio em si já buscava a Praça via fetch() quando
    // necessário (getPlaceDoc tem fallback), então essa restrição era
    // desnecessária — roda em qualquer tela agora.
    screens: ['any'],
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

      const ui = S.card(MODULE_ID, 'Auto Farm');
      const statusBox = S.h('div', { style: { fontSize: '11px', marginBottom: '6px' }, text: 'Iniciando...' });
      const templateHost = S.h('div');
      const paceHost = S.h('div');
      const targetsHost = S.h('div', { class: 'tws-list' });

      async function persist(patch) {
        settings = { ...settings, ...patch };
        await storage.setModuleSettings(MODULE_ID, settings);
        renderConfig();
      }

      function activeTemplate() {
        return settings.templates.find((t) => t.id === settings.activeTemplateId) || null;
      }

      function renderConfig() {
        templateHost.innerHTML = '';
        paceHost.innerHTML = '';
        renderTemplateManager(templateHost, settings, persist);
        renderPaceSettings(paceHost, settings, persist);
      }

      async function resetTargets() {
        // Antes só mandava a confirmação pro console (log.info) — parecia
        // não fazer nada porque a única resposta ficava escondida no
        // DevTools. Agora mostra o resultado (ou o erro) na própria tela.
        statusBox.textContent = 'Restaurando alvos...';
        try {
          const removed = await storage.removeByPrefix(`auto-farm:lastSent:${myVillage.id}:`);
          log.info(`${removed} alvo(s) restaurado(s).`);
          statusBox.textContent = `${removed} alvo(s) restaurado(s).`;
          await refreshTargetsPreview();
        } catch (e) {
          log.error('Falha ao restaurar alvos:', e);
          statusBox.textContent = `Falha ao restaurar alvos: ${(e && e.message) || e}`;
        }
      }

      const resetBtn = S.h('button', {
        text: 'Restaurar alvos', style: { fontSize: '11px', marginBottom: '6px', width: '100%' },
        title: 'Limpa o cooldown desta aldeia — alvos já tentados voltam a aparecer',
        onclick: resetTargets,
      });

      async function refreshTargetsPreview() {
        const waves = await pruneWaves(storage, myVillage.id);
        const excludeIds = new Set(waves.map((w) => String(w.targetId)));
        const targets = await findTargets(storage, myVillage, settings, excludeIds).catch(() => []);
        targetsHost.innerHTML = '';
        if (!targets.length) {
          targetsHost.appendChild(S.h('div', { class: 'tws-muted', text: 'Nenhum alvo elegível agora.' }));
          return;
        }
        for (const t of targets.slice(0, 8)) {
          targetsHost.appendChild(S.h('div', { class: 'tws-row', text: `${t.x}|${t.y} (${t.distance.toFixed(1)})` }));
        }
      }

      ui.body.append(statusBox, templateHost, paceHost, resetBtn,
        S.h('div', { style: { fontWeight: 'bold', fontSize: '10px', marginTop: '2px' }, text: 'Próximos alvos' }), targetsHost);
      renderConfig();
      await refreshTargetsPreview();

      // --------------------------------------------------------
      // Loop autônomo: a cada ~20-35s verifica se pode mandar mais
      // uma onda (ondas no ar < máximo, ritmo permite, tem alvo
      // elegível) e envia sozinho — sem precisar de clique.
      // --------------------------------------------------------
      S.loop(`${MODULE_ID}:${myVillage.id}`, async () => {
        const s = await storage.getModuleSettings(MODULE_ID, DEFAULT_SETTINGS);
        const tpl = (s.templates || []).find((t) => t.id === s.activeTemplateId);
        if (!tpl) { statusBox.textContent = 'Sem modelo de tropas ativo — crie um acima.'; return; }

        const waves = await pruneWaves(storage, myVillage.id);
        const maxWaves = Math.max(1, Number(s.maxConcurrentWaves) || 1);
        if (waves.length >= maxWaves) {
          statusBox.textContent = `${waves.length}/${maxWaves} onda(s) no ar — aguardando voltar.`;
          return;
        }
        if (isNightPaused(s)) {
          statusBox.textContent = `Pausado (${s.nightPauseStart}–${s.nightPauseEnd}, horário local).`;
          return;
        }
        if (s.enableHourlyLimit) {
          const count = await hourlyCount(storage, myVillage.id);
          if (count >= (Number(s.attacksPerHour) || 20)) {
            statusBox.textContent = `Limite de ${s.attacksPerHour}/h atingido — aguardando.`;
            return;
          }
        }

        const excludeIds = new Set(waves.map((w) => String(w.targetId)));
        const targets = await findTargets(storage, myVillage, s, excludeIds);
        if (!targets.length) {
          statusBox.textContent = `${waves.length}/${maxWaves} onda(s) no ar — nenhum alvo elegível.`;
          return;
        }
        const target = targets[0];

        if (s.dryRun) {
          log.info(`(teste) atacaria ${target.x}|${target.y} com modelo "${tpl.name}" (${waves.length}/${maxWaves} ondas simuladas)`);
          statusBox.textContent = `teste: atacaria ${target.x}|${target.y}`;
          return;
        }

        statusBox.textContent = `Enviando para ${target.x}|${target.y}...`;
        const res = await S.sendCommand({ villageId: myVillage.id, units: tpl.units, x: target.x, y: target.y, type: 'attack', capToAvailable: true });
        if (!res.ok) {
          log.warn(`Falha ao atacar ${target.x}|${target.y}:`, res.reason);
          statusBox.textContent = `falhou: ${res.reason}`;
          return;
        }

        await storage.set(cooldownKey(myVillage.id, target.id), Date.now());
        const roundTripMs = res.durationMs ? res.durationMs * 2 : 30 * 60000; // sem duração lida, assume 30min por segurança
        await addWave(storage, myVillage.id, { targetId: String(target.id), x: target.x, y: target.y, sentAt: res.sentAt, returnAt: res.sentAt + roundTripMs });
        await recordSend(storage, myVillage.id);

        log.info(`Atacou ${target.x}|${target.y} com "${tpl.name}".`);
        statusBox.textContent = `Enviado a ${target.x}|${target.y} · ${waves.length + 1}/${maxWaves} onda(s) no ar.`;
        refreshTargetsPreview();
      }, 20000, 35000);

      // Live-refresh: se o dashboard mudar configurações desta conta
      // enquanto a página está aberta, reaplica o perfil e atualiza a
      // UI (o loop acima já relê settings a cada ciclo — isso é só
      // pra UI/preview não ficarem visualmente desatualizados). Também
      // confere se o botão "Restaurar alvos" do dashboard pediu reset
      // (não dá pra chamar o módulo direto do dashboard — ele roda numa
      // aba separada — então o pedido fica num sinalizador em storage.get
      // and a aba do jogo confere aqui, a cada ciclo).
      setInterval(async () => {
        if (typeof window.TWSuite.applyProfileNow === 'function') {
          await window.TWSuite.applyProfileNow();
        }
        const key = window.TWSuite.accountKeyFromGame && window.TWSuite.accountKeyFromGame();
        if (key) {
          const requests = (await storage.get('autoFarmResetRequests', {})) || {};
          const requestedAt = requests[key] || 0;
          const handledAt = await storage.get(`auto-farm:resetHandledAt:${myVillage.id}`, 0);
          if (requestedAt > handledAt) {
            await storage.set(`auto-farm:resetHandledAt:${myVillage.id}`, requestedAt);
            await resetTargets();
          }
        }
        const fresh = await storage.getModuleSettings(MODULE_ID, DEFAULT_SETTINGS);
        if (JSON.stringify(fresh) !== JSON.stringify(settings)) {
          settings = fresh;
          renderConfig();
          refreshTargetsPreview();
        }
      }, 8000);
    },
  });
})();

// ============================================================
// MÓDULO: scheduler — Agendador de Comandos (reescrito v1.2.0)
//
// Bug da v0.7.0: só rodava na tela `place`, e o disparo dependia de
// estar exatamente na tela de confirmação (`try=confirm`) no segundo
// certo — impraticável (exigia deixar a aba parada naquela tela
// específica). Reescrito para rodar em `screens: ['any']` e disparar
// via `shared.sendCommand()` (fetch real, dois POSTs), igual ao Auto
// Farm — não depende de qual tela está aberta nem de clique.
//
// Dois modos:
//  - "Chegar às": mede a duração UMA vez (prepareCommand é
//    side-effect-free — não gasta tropa, só resolve o alvo) e calcula
//    o horário de envio subtraindo a duração.
//  - "Enviar às": dispara no horário exato, sem calcular chegada.
//
// Correção adaptativa: guarda a média móvel do tempo de ida-e-volta
// da 2ª requisição (confirmCommand) e antecipa o disparo por metade
// desse valor, pra compensar a latência de rede — mesma ideia que
// os concorrentes anunciam como "calibração automática", sem
// prometer precisão de milissegundo que não dá pra garantir aqui.
// ============================================================
(function registerScheduler() {
  'use strict';
  const TW = window.TWSuite;
  const S = TW.shared;
  const MODULE_ID = 'scheduler';
  const QUEUE_KEY = 'scheduler:queue';
  const LATENCY_KEY = 'scheduler:avgLatencyMs';

  const queueLoad = () => TW.storage.get(QUEUE_KEY, []);
  const queueSave = (q) => TW.storage.set(QUEUE_KEY, q);

  async function getLatency() {
    return Number(await TW.storage.get(LATENCY_KEY, 400));
  }
  async function updateLatency(sampleMs) {
    const prev = await getLatency();
    const next = Math.round(prev * 0.7 + sampleMs * 0.3);
    await TW.storage.set(LATENCY_KEY, Math.min(3000, Math.max(50, next)));
  }

  function fmtEta(ms) {
    if (ms <= 0) return 'agora';
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  }

  async function addItem(item) {
    const q = await queueLoad();
    q.push(item);
    await queueSave(q);
    return q;
  }

  async function removeItem(id) {
    const q = (await queueLoad()).filter((i) => i.id !== id);
    await queueSave(q);
    return q;
  }

  async function updateItem(id, patch) {
    const q = await queueLoad();
    const idx = q.findIndex((i) => i.id === id);
    if (idx >= 0) q[idx] = { ...q[idx], ...patch };
    await queueSave(q);
    return q;
  }

  async function executeItem(item, log, refresh) {
    const lockName = `scheduler:${item.id}`;
    if (!(await S.acquireLock(lockName, 60000))) return;
    await updateItem(item.id, { status: 'sending' });
    refresh();

    const latency = await getLatency();
    // Se ainda faltar um pouquinho pro instante exato, espera aqui
    // (scheduleAt já fez a espera grossa; isso cobre o resto fino).
    const remaining = item.sendAtMs - latency / 2 - S.serverTime.now();
    if (remaining > 0) await S.sleep(remaining);

    try {
      const res = await S.sendCommand({
        villageId: item.vid, units: item.units, x: item.x, y: item.y, type: item.type, capToAvailable: item.capToAvailable !== false,
      });
      if (res.ok) {
        await updateLatency(res.endedAt - res.startedAt);
        log.info(`Agendado disparado: ${item.type === 'support' ? 'apoio' : 'ataque'} -> ${item.x}|${item.y} (previsto ${S.formatServerTime(item.sendAtMs)}, real ${S.formatServerTime(res.sentAt)}).`);
        await S.notify(`✅ Comando agendado enviado: ${item.x}|${item.y}${item.label ? ` (${item.label})` : ''}`);
        await removeItem(item.id);
      } else {
        log.error(`Falha ao disparar agendado ${item.x}|${item.y}:`, res.reason);
        await S.notify(`⚠️ Falha no comando agendado ${item.x}|${item.y}: ${res.reason}`);
        await updateItem(item.id, { status: 'failed', error: res.reason });
      }
    } catch (e) {
      if (e instanceof S.BotCheckError) {
        await updateItem(item.id, { status: 'pending' }); // tenta de novo depois que o captcha for resolvido
      } else {
        log.error(`Erro inesperado no agendado ${item.x}|${item.y}:`, e);
        await updateItem(item.id, { status: 'failed', error: String(e && e.message || e) });
      }
    }
    refresh();
  }

  function scheduleTick(state, log, refresh) {
    (async () => {
      const q = await queueLoad();
      const now = S.serverTime.now();
      for (const item of q) {
        if (item.status !== 'pending') continue;
        if (item.sendAtMs - now <= 5000 && !state.armed.has(item.id)) {
          state.armed.add(item.id);
          S.serverTime.scheduleAt(item.sendAtMs, () => {
            state.armed.delete(item.id);
            executeItem(item, log, refresh);
          });
        }
      }
    })();
  }

  function renderList(body, state, log, refresh) {
    body.innerHTML = '';
    if (!state.queue.length) {
      body.appendChild(S.h('div', { class: 'tws-muted', text: 'Fila vazia.' }));
      return;
    }
    const list = S.h('div', { class: 'tws-list' });
    for (const item of state.queue.slice().sort((a, b) => a.sendAtMs - b.sendAtMs)) {
      const eta = item.sendAtMs - S.serverTime.now();
      const statusTxt = item.status === 'sending' ? 'enviando…' : item.status === 'failed' ? `falhou: ${item.error || ''}` : fmtEta(eta);
      const row = S.h('div', { class: 'tws-row', style: { borderBottom: '1px solid #c1a264', paddingBottom: '4px', marginBottom: '4px' } }, [
        S.h('span', { text: `${item.type === 'support' ? '🛡' : '⚔'} ${item.x}|${item.y} · ${item.modeLabel} ${statusTxt}` }),
        S.h('button', { text: '✕', onclick: async () => { state.queue = await removeItem(item.id); renderList(body, state, log, refresh); } }),
      ]);
      list.appendChild(row);
    }
    body.appendChild(list);
  }

  function unitGrid(values) {
    const wraps = {};
    const grid = S.h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px' } });
    for (const u of S.UNITS) {
      const input = S.h('input', { type: 'text', placeholder: '0 ou tudo', value: values[u] != null ? String(values[u]) : '', style: { width: '100%' } });
      wraps[u] = input;
      grid.appendChild(S.h('label', { style: { fontSize: '10px', display: 'flex', flexDirection: 'column', gap: '1px' } }, [S.UNIT_LABELS[u], input]));
    }
    return { grid, read: () => { const o = {}; for (const u of S.UNITS) { const v = wraps[u].value.trim().toLowerCase(); if (v === 'tudo' || v === 'all') o[u] = 'all'; else if (v) o[u] = Number(v) || 0; } return o; } };
  }

  TW.registerModule({
    id: MODULE_ID,
    name: 'Agendador de Comandos',
    screens: ['any'],
    defaultEnabled: false,
    async run(ctx) {
      const { log } = ctx;
      const state = { queue: await queueLoad(), armed: new Set() };
      const ui = S.card(MODULE_ID, 'Agendador');
      const listBody = S.h('div');
      const refresh = () => { renderList(listBody, state, log, refresh); ui.setStatus(`${state.queue.filter((i) => i.status !== 'failed').length} na fila`); };

      const villages = await S.myVillages();
      const villageSelect = S.h('select', {}, villages.length
        ? villages.map((v) => S.h('option', { value: v.id }, `${v.name} (${v.x}|${v.y})`))
        : [S.h('option', { value: S.villageId() || '' }, 'Aldeia atual')]);
      if (S.villageId()) villageSelect.value = String(S.villageId());

      const xInput = S.h('input', { type: 'number', placeholder: 'X', style: { width: '50%' } });
      const yInput = S.h('input', { type: 'number', placeholder: 'Y', style: { width: '50%' } });
      const typeSelect = S.h('select', {}, [S.h('option', { value: 'attack' }, 'Ataque'), S.h('option', { value: 'support' }, 'Apoio')]);
      const modeSelect = S.h('select', {}, [S.h('option', { value: 'arrival' }, 'Chegar às'), S.h('option', { value: 'send' }, 'Enviar às')]);
      const timeInput = S.h('input', { type: 'text', placeholder: 'HH:MM:SS ou 17/09 21:14:59', style: { width: '100%' } });
      const labelInput = S.h('input', { type: 'text', placeholder: 'Etiqueta (opcional)', style: { width: '100%' } });
      const { grid: unitsGrid, read: readUnits } = unitGrid({});
      const addStatus = S.h('div', { class: 'tws-muted' });
      const addBtn = S.h('button', { text: '+ Agendar', style: { width: '100%' } });

      addBtn.addEventListener('click', async () => {
        addStatus.textContent = 'calculando...';
        addBtn.disabled = true;
        try {
          const x = Number(xInput.value);
          const y = Number(yInput.value);
          const vid = villageSelect.value;
          const type = typeSelect.value;
          const mode = modeSelect.value;
          const units = readUnits();
          if (!x || !y) throw new Error('informe X e Y do alvo');
          if (!Object.keys(units).length) throw new Error('informe ao menos 1 tropa');
          const targetMs = S.parseGameTime(timeInput.value);
          if (!targetMs) throw new Error('não entendi o horário — use HH:MM:SS');

          let sendAtMs = targetMs;
          if (mode === 'arrival') {
            const prep = await S.prepareCommand({ villageId: vid, units, x, y, type });
            if (!prep.ok) throw new Error(prep.reason);
            if (!prep.durationMs) throw new Error('não consegui ler a duração da viagem');
            sendAtMs = targetMs - prep.durationMs;
          }
          if (sendAtMs < S.serverTime.now()) throw new Error('esse horário já passou (considerando a duração da viagem)');

          state.queue = await addItem({
            id: 'sch_' + Math.random().toString(36).slice(2, 10),
            vid, x, y, type, units, sendAtMs, capToAvailable: true,
            modeLabel: mode === 'arrival' ? `chegando ${timeInput.value}` : `enviando ${timeInput.value}`,
            label: labelInput.value.trim() || null,
            status: 'pending', createdAt: Date.now(),
          });
          addStatus.textContent = `agendado para ${S.formatServerTime(sendAtMs, false)}`;
          refresh();
        } catch (e) {
          addStatus.textContent = `erro: ${e.message}`;
        }
        addBtn.disabled = false;
      });

      ui.body.appendChild(S.h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, [
        S.h('label', { class: 'tws-muted' }, ['Aldeia de origem', villageSelect]),
        S.h('div', { class: 'tws-row' }, [xInput, yInput]),
        S.h('div', { class: 'tws-row' }, [typeSelect, modeSelect]),
        timeInput,
        unitsGrid,
        labelInput,
        addBtn,
        addStatus,
      ]));
      ui.body.appendChild(S.h('div', { style: { fontWeight: 'bold', fontSize: '10px', marginTop: '4px' }, text: 'Fila' }));
      ui.body.appendChild(listBody);

      refresh();
      const tick = () => { scheduleTick(state, log, refresh); refresh(); };
      tick();
      setInterval(async () => { state.queue = await queueLoad(); tick(); }, 4000);

      log.info('Agendador de Comandos carregado (v1.2.0 — independente de tela).');
    },
  });
})();

// ============================================================
// MÓDULO: auto-recruit — Recrutamento por metas (reescrito v1.6.0)
//
// Antes: uma unidade só, "recruta N por ciclo, pra sempre" — nunca parava
// sozinho. Pedido do usuário: metas por tropa ("10 lanceiros, 20 bárbaros,
// 10 espadachins NO TOTAL") — recruta conforme o recurso permite e PARA
// quando cada meta é atingida, sem ficar em loop pedindo mais.
//
// `progress[unidade]` guarda quanto já foi recrutado por ESTA campanha
// (incrementado a cada ordem aceita pelo jogo — não compara com a
// quantidade de tropas em casa, que pode cair por perdas em batalha ou
// subir por outros meios; contar só o que este módulo pediu evita
// confundir "meta" com "tropas totais"). Aumentar a meta depois retoma
// de onde parou; "Resetar progresso" (painel do jogo) zera pra uma
// campanha nova com os mesmos números.
//
// Envia via ajaxaction=train no edifício certo (quartel/estábulo/oficina),
// mantendo uma reserva % do armazém pras outras filas.
// UNVERIFIED: ids #<unidade>_0_cost_<recurso> / #<unidade>_0_a no HTML.
// ============================================================
(function registerAutoRecruit() {
  'use strict';
  const TW = window.TWSuite;
  const S = TW.shared;
  const MODULE_ID = 'auto-recruit';
  const DEFAULTS = { goals: {}, reservePercent: 20, maxQueueOrders: 2, dryRun: true };
  const BUILDING = {
    spear: 'barracks', sword: 'barracks', axe: 'barracks', archer: 'barracks',
    spy: 'stable', light: 'stable', marcher: 'stable', heavy: 'stable',
    ram: 'garage', catapult: 'garage',
  };
  const progressKey = (vid) => `auto-recruit:progress:${vid}`;

  function readCosts(doc, unit) {
    const out = {};
    for (const r of S.RESOURCES) {
      const el = doc.querySelector(`#${unit}_0_cost_${r}`);
      out[r] = el ? S.num(el.textContent) : null;
    }
    return out;
  }

  function readMaxAffordable(doc, unit) {
    const a = doc.querySelector(`#${unit}_0_a`);
    const m = a && a.textContent.match(/\((\d+)\)/);
    return m ? Number(m[1]) : null;
  }

  TW.registerModule({
    id: MODULE_ID,
    name: 'Recrutamento Automático',
    screens: ['any'],
    defaultEnabled: false,
    async run(ctx) {
      const vid = S.villageId();
      const ui = S.card(MODULE_ID, 'Recrutamento');
      const goalsHost = S.h('div', { class: 'tws-list' });
      const resetBtn = S.h('button', {
        text: 'Resetar progresso', style: { width: '100%', fontSize: '11px', marginTop: '4px' },
        title: 'Zera o quanto já foi recrutado nesta campanha — os mesmos números voltam a valer do zero',
        onclick: async () => {
          await ctx.storage.set(progressKey(vid), {});
          ctx.log.info('Progresso de recrutamento resetado.');
          ui.setStatus('progresso resetado');
          renderGoals(await ctx.storage.getModuleSettings(MODULE_ID, DEFAULTS), {});
        },
      });
      ui.body.append(goalsHost, resetBtn);

      function renderGoals(s, progress) {
        goalsHost.innerHTML = '';
        const entries = Object.entries(s.goals || {}).filter(([, g]) => g > 0);
        if (!entries.length) {
          goalsHost.appendChild(S.h('div', { class: 'tws-muted', text: 'Sem metas configuradas.' }));
          return;
        }
        for (const [u, g] of entries) {
          const p = Math.min(g, progress[u] || 0);
          const done = p >= g;
          goalsHost.appendChild(S.h('div', { class: 'tws-row', text: `${done ? '✅' : '⏳'} ${S.UNIT_LABELS[u] || u}: ${p}/${g}` }));
        }
      }

      S.loop(`${MODULE_ID}:${vid}`, async () => {
        const s = await ctx.storage.getModuleSettings(MODULE_ID, DEFAULTS);
        const progress = (await ctx.storage.get(progressKey(vid), {})) || {};
        renderGoals(s, progress);

        const pending = Object.entries(s.goals || {}).filter(([u, g]) => g > 0 && (progress[u] || 0) < g && BUILDING[u]);
        if (!pending.length) return ui.setStatus('meta concluída — nada pendente');

        const byBuilding = {};
        for (const [u] of pending) (byBuilding[BUILDING[u]] = byBuilding[BUILDING[u]] || []).push(u);

        const parts = [];
        for (const [building, units] of Object.entries(byBuilding)) {
          const page = await S.getPage(`/game.php?village=${vid}&screen=${building}`);
          const g2 = S.gameDataFromHtml(page.text) || S.gd();
          const orders = (page.text.match(/TrainOverview\.cancelOrder\(\d+\)/g) || []).length;
          if (orders >= s.maxQueueOrders) { parts.push(`${building}: fila cheia`); continue; }

          for (const u of units) {
            const remaining = s.goals[u] - (progress[u] || 0);
            const costs = readCosts(page.doc, u);
            const maxAff = readMaxAffordable(page.doc, u);
            if (maxAff === null && costs.wood === null) continue; // não recrutável aqui — tenta a próxima tropa desta aldeia

            const v = g2.village;
            const reserve = Math.floor((Number(v.storage_max) || 0) * (s.reservePercent / 100));
            let n = remaining;
            if (costs.wood) for (const r of S.RESOURCES) { if (costs[r]) n = Math.min(n, Math.floor((Number(v[r]) - reserve) / costs[r])); }
            if (maxAff !== null) n = Math.min(n, maxAff);
            if (n <= 0) continue;

            if (s.dryRun) {
              ctx.log.info(`(teste) recrutaria ${n} ${S.UNIT_LABELS[u]} (meta ${remaining} restante)`);
              parts.push(`teste: +${n} ${S.UNIT_LABELS[u]}`);
              break;
            }
            const res = await S.ajax(building, 'train', { units: { [u]: n } }, { mode: 'train' }, vid);
            if (!res.ok) { parts.push(`${S.UNIT_LABELS[u]}: ${res.reason}`); break; }
            progress[u] = (progress[u] || 0) + n;
            await ctx.storage.set(progressKey(vid), progress);
            ctx.log.info(`Recrutado ${n} ${S.UNIT_LABELS[u]} (${progress[u]}/${s.goals[u]}).`);
            parts.push(`+${n} ${S.UNIT_LABELS[u]} (${progress[u]}/${s.goals[u]})`);
            break; // 1 ordem por edifício por ciclo, junto com o teto de fila
          }
        }
        renderGoals(s, progress);
        ui.setStatus(parts.join(' · ') || `aguardando recursos (reserva ${s.reservePercent}%)`);
      }, 25000, 35000);
    },
  });
})();

// ============================================================
// Motor de coleta (scavenge) — usado por auto-collect e mass-collect
//
// Dados: `var village = {...}` na página screen=place&mode=scavenge
// (mesmo regex do TWB, GPL-3, só consultado como referência). Envio:
// ajaxaction=send_squads em scavenge_api. Divisão de tropas com pesos
// 15/6/3/2 (victorgare/tribalwars, MIT) para as opções terminarem em
// tempos parecidos.
// UNVERIFIED no seu mundo.
// ============================================================
(function registerScavengeEngine() {
  'use strict';
  const TW = window.TWSuite;
  const S = TW.shared;
  const CARRY = { spear: 25, sword: 15, axe: 10, archer: 10, light: 80, marcher: 50, heavy: 50 };
  const WEIGHTS = { 1: 15, 2: 6, 3: 3, 4: 2 };

  function villageDataFrom(text) {
    const m = text.match(/var village = (\{.+?\});\s*$/m) || text.match(/var village = (\{.+?\});/s);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch { return null; }
  }

  async function unitsHome(vid, data) {
    if (data && data.unit_counts_home) return data.unit_counts_home;
    const { doc } = await S.getPage(`/game.php?village=${vid}&screen=place&mode=units&display=units`);
    const out = {};
    const row = doc.querySelector('#units_home tbody tr:not(:first-child)') || doc.querySelector('#units_home tr:nth-child(2)');
    if (row) {
      for (const td of row.querySelectorAll('td[class*="unit-item-"]')) {
        const m = td.className.match(/unit-item-([a-z]+)/);
        if (m) out[m[1]] = S.num(td.textContent);
      }
    }
    return out;
  }

  // Retorna { sent, reason } — sent = nº de opções enviadas.
  async function scavengeVillage(vid, settings, log) {
    const page = await S.getPage(`/game.php?village=${vid}&screen=place&mode=scavenge`);
    const data = villageDataFrom(page.text);
    if (!data || !data.options) return { sent: 0, reason: 'dados de coleta não encontrados (desbloqueada nesta aldeia?)' };

    const options = Object.entries(data.options).map(([id, o]) => ({ id: Number(id), locked: !!o.is_locked, busy: !!o.scavenging_squad }));
    const unlocked = options.filter((o) => !o.locked);
    const idle = unlocked.filter((o) => !o.busy);
    if (!unlocked.length) return { sent: 0, reason: 'coleta bloqueada nesta aldeia' };
    if (!idle.length) return { sent: 0, reason: 'todas as coletas em andamento' };
    if (settings.waitAllIdle !== false && idle.length < unlocked.length) return { sent: 0, reason: 'aguardando todas as coletas voltarem' };

    // unitCaps: teto opcional por tropa — "nunca usar mais que N pra
    // coleta, o resto fica em casa". null/undefined/'' = sem teto (usa
    // tudo que tiver disponível, comportamento de antes). 0 = nunca usa
    // essa tropa (equivalente ao antigo excludeUnits).
    const caps = settings.unitCaps || {};
    const home = await unitsHome(vid, data);
    const pool = {};
    for (const u of Object.keys(CARRY)) {
      const avail = Number(home[u] || 0);
      const cap = caps[u];
      pool[u] = (cap === null || cap === undefined || cap === '') ? avail : Math.max(0, Math.min(avail, Number(cap) || 0));
    }
    if (!Object.values(pool).some((n) => n > 0)) return { sent: 0, reason: 'sem tropas disponíveis (verifique os tetos configurados)' };

    const totalWeight = idle.reduce((acc, o) => acc + WEIGHTS[o.id], 0);
    const payload = {};
    let i = 0;
    const remaining = { ...pool };
    idle.sort((a, b) => b.id - a.id).forEach((o, idx) => {
      const last = idx === idle.length - 1;
      const counts = {};
      let carry = 0;
      for (const u of Object.keys(CARRY)) {
        const n = last ? remaining[u] : Math.floor((pool[u] * WEIGHTS[o.id]) / totalWeight);
        counts[u] = Math.min(n, remaining[u]);
        remaining[u] -= counts[u];
        carry += counts[u] * CARRY[u];
      }
      if (carry <= 0) return;
      payload.squad_requests = payload.squad_requests || {};
      payload.squad_requests[i] = {
        village_id: vid,
        option_id: o.id,
        use_premium: 'false',
        candidate_squad: { unit_counts: counts, carry_max: carry },
      };
      i++;
    });
    if (!i) return { sent: 0, reason: 'tropas insuficientes para dividir' };

    if (settings.dryRun) {
      log.info(`(teste) coleta na aldeia ${vid}:`, JSON.stringify(payload.squad_requests));
      return { sent: i, dry: true };
    }
    const res = await S.ajax('scavenge_api', 'send_squads', payload, {}, vid);
    if (!res.ok) return { sent: 0, reason: res.reason };
    return { sent: i };
  }

  TW.shared.scavengeVillage = scavengeVillage;
})();

// ============================================================
// MÓDULO: auto-collect — coleta na aldeia atual
// ============================================================
(function registerAutoCollect() {
  'use strict';
  const TW = window.TWSuite;
  const S = TW.shared;
  const MODULE_ID = 'auto-collect';
  // Paladino (knight), aríete, catapulta e nobre nunca entram na coleta —
  // não fazem parte de CARRY (o jogo não aceita esses tipos em expedições).
  const DEFAULTS = { interval: 60000, unitCaps: {}, waitAllIdle: true, dryRun: true };

  TW.registerModule({
    id: MODULE_ID,
    name: 'Coleta Automática',
    screens: ['any'],
    defaultEnabled: false,
    async run(ctx) {
      const ui = S.card(MODULE_ID, 'Coleta');
      S.loop(`${MODULE_ID}:${S.villageId()}`, async () => {
        const s = await ctx.storage.getModuleSettings(MODULE_ID, DEFAULTS);
        const r = await S.scavengeVillage(S.villageId(), s, ctx.log);
        ui.setStatus(r.sent ? `${r.dry ? 'teste: ' : ''}${r.sent} coleta(s) enviada(s)` : r.reason);
      }, 45000, 75000);
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
// MÓDULO: mega-builder — fila de construção sem premium
//
// Lê `BuildingMain.buildings` (regex do TWB, GPL-3, só referência) e
// constrói via ajaxaction=upgrade_building. Fila: "main:3, barracks:1".
// UNVERIFIED: payload do upgrade_building e textos de erro exatos.
// ============================================================
(function registerMegaBuilder() {
  'use strict';
  const TW = window.TWSuite;
  const S = TW.shared;
  const MODULE_ID = 'mega-builder';
  const DEFAULT_QUEUE = 'wood:1, stone:1, iron:1, wood:2, stone:2, main:2, farm:2, storage:2, wood:3, stone:3, iron:2, main:3, barracks:1, wood:5, stone:5, iron:4, storage:5, farm:5, main:5, market:1, smith:1, wood:10, stone:10, iron:8, storage:10, farm:10, main:10, wall:5';
  const DEFAULTS = { queue: DEFAULT_QUEUE, interval: 60000, maxQueue: 2, strictOrder: true, autoFarmStorage: true, allVillages: false, dryRun: true };
  const NAMES = { main: 'Edifício principal', barracks: 'Quartel', stable: 'Estábulo', garage: 'Oficina', church: 'Igreja', church_f: 'Primeira igreja', watchtower: 'Torre', snob: 'Academia', smith: 'Ferreiro', place: 'Praça', statue: 'Estátua', market: 'Mercado', wood: 'Bosque', stone: 'Poço de argila', iron: 'Mina de ferro', farm: 'Fazenda', storage: 'Armazém', hide: 'Esconderijo', wall: 'Muralha' };

  function parseQueue(text) {
    return String(text || '').split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean).map((p) => {
      const [b, lvl] = p.split(':').map((x) => x.trim());
      return { building: b, level: Number(lvl) || 1 };
    }).filter((q) => NAMES[q.building]);
  }

  function buildingsFrom(text) {
    const m = text.match(/BuildingMain\.buildings = (\{.+?\});/s);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch { return null; }
  }

  function queuedCounts(doc) {
    const counts = {};
    let total = 0;
    for (const tr of doc.querySelectorAll('#build_queue tr[class*="buildorder_"]')) {
      const m = tr.className.match(/buildorder_([a-z_]+)/);
      if (!m) continue;
      counts[m[1]] = (counts[m[1]] || 0) + 1;
      total++;
    }
    return { counts, total };
  }

  // A leitura/relato da fila pro dashboard agora é feita pelo módulo
  // "Status ao Vivo" (sempre ativo, ver shared.buildLiveSnapshot) — antes
  // só aparecia quando este módulo estava ligado, porque era ele quem
  // lia e reportava. Aqui só usamos S.readBuildQueue pra montar a lista
  // de feedback imediato deste cartão específico.
  async function buildOnce(vid, vname, s, log) {
    const page = await S.getPage(`/game.php?village=${vid}&screen=main`);
    const queue = S.readBuildQueue(page.doc).map((q) => ({ ...q, village: vname }));
    const buildings = buildingsFrom(page.text);
    if (!buildings) return { status: 'dados do edifício principal não encontrados', queue };
    const { counts, total } = queuedCounts(page.doc);
    if (total >= s.maxQueue) return { status: `fila cheia (${total}/${s.maxQueue})`, queue };

    const plan = parseQueue(s.queue || DEFAULT_QUEUE);
    for (const step of plan) {
      const b = buildings[step.building];
      if (!b) continue;
      const effective = Number(b.level || 0) + (counts[step.building] || 0);
      if (effective >= step.level) continue;

      let target = step.building;
      const err = String(b.error || '');
      if (err && s.autoFarmStorage) {
        if (/fazenda|popula/i.test(err) && buildings.farm && !buildings.farm.error) target = 'farm';
        else if (/armaz/i.test(err) && buildings.storage && !buildings.storage.error) target = 'storage';
      }
      const tb = buildings[target];
      if (tb && tb.error && target === step.building) {
        if (s.strictOrder) return { status: `aguardando: ${NAMES[step.building]} nv.${step.level} (${String(tb.error).replace(/<[^>]+>/g, '')})`, queue };
        continue;
      }

      if (s.dryRun) {
        log.info(`(teste) construiria ${NAMES[target]} na aldeia ${vname}`);
        return { status: `teste: construiria ${NAMES[target]}`, queue };
      }
      const res = await S.ajax('main', 'upgrade_building', { id: target, force: 1, destroy: 0, source: vid }, { type: 'main' }, vid);
      if (!res.ok) return { status: `recusado: ${res.reason}`, queue };
      log.info(`Construção iniciada: ${NAMES[target]} (aldeia ${vname})`);
      return { status: `${NAMES[target]} entrou na fila`, queue };
    }
    return { status: 'fila de construção concluída', queue };
  }

  function renderQueueList(host, entries, showVillage) {
    host.innerHTML = '';
    if (!entries.length) {
      host.appendChild(S.h('div', { class: 'tws-muted', text: 'Nada na fila agora.' }));
      return;
    }
    for (const q of entries) {
      const label = `${showVillage ? `${q.village}: ` : ''}${q.name}${q.level ? ` nv.${q.level}` : ''}${q.remaining ? ` · ${q.remaining}` : ''}`;
      host.appendChild(S.h('div', { class: 'tws-row', text: label, title: q.etaText || '' }));
    }
  }

  TW.registerModule({
    id: MODULE_ID,
    name: 'Mega Construtor',
    screens: ['any'],
    defaultEnabled: false,
    async run(ctx) {
      const ui = S.card(MODULE_ID, 'Construtor');
      const queueHost = S.h('div', { class: 'tws-list' });
      ui.body.append(S.h('div', { style: { fontWeight: 'bold', fontSize: '10px' }, text: 'Fila de construção' }), queueHost);
      // Intervalo lido só uma vez no carregamento (o S.loop já fixa o
      // ritmo na hora de registrar) — mudar no dashboard vale a partir
      // do próximo carregamento da página, igual ligar/desligar o módulo.
      let allVillages = false;
      let interval = DEFAULTS.interval;
      try {
        const initial = await ctx.storage.getModuleSettings(MODULE_ID, DEFAULTS);
        allVillages = initial.allVillages;
        interval = Math.max(20000, Number(initial.interval) || DEFAULTS.interval);
      } catch { /* usa padrão */ }

      S.loop(allVillages ? MODULE_ID : `${MODULE_ID}:${S.villageId()}`, async () => {
        const s = { ...DEFAULTS, ...(await ctx.storage.getModuleSettings(MODULE_ID, DEFAULTS)) };
        const villages = s.allVillages ? await S.myVillages() : [{ id: S.villageId(), name: 'aldeia atual' }];
        const results = [];
        let allQueue = [];
        for (const v of villages) {
          if (S.botState.active) return;
          const r = await buildOnce(v.id, v.name, s, ctx.log);
          results.push(r.status);
          allQueue = allQueue.concat(r.queue);
          if (villages.length > 1) await S.sleep(S.jitter(1500, 3500));
        }
        ui.setStatus(villages.length > 1 ? `${villages.length} aldeia(s) verificada(s)` : results[0]);
        renderQueueList(queueHost, allQueue, villages.length > 1);
      }, interval, interval * 1.5);
    },
  });
})();

// ============================================================
// MÓDULO: resource-balancer — distribui recursos entre as aldeias
//
// Lê recursos/armazém de cada aldeia pela página do mercado
// (TribalWars.updateGameData embutido no HTML) e envia excedentes
// para quem está abaixo do alvo, priorizando a aldeia mais perto.
// UNVERIFIED: formulários de envio do mercado (screen=market&mode=send).
// ============================================================
(function registerBalancer() {
  'use strict';
  const TW = window.TWSuite;
  const S = TW.shared;
  const MODULE_ID = 'resource-balancer';
  const DEFAULTS = { targetPercentage: 50, tolerance: 15, cycleMinutes: 30, minShipment: 1000, maxVillages: 30, dryRun: true };

  async function snapshot(v) {
    const page = await S.getPage(`/game.php?village=${v.id}&screen=market&mode=send`);
    const g = S.gameDataFromHtml(page.text);
    const merchantsEl = page.doc.querySelector('#market_merchant_available_count');
    if (!g || !g.village) return null;
    return {
      ...v,
      storage: Number(g.village.storage_max) || 0,
      res: { wood: Math.floor(g.village.wood), stone: Math.floor(g.village.stone), iron: Math.floor(g.village.iron) },
      merchants: merchantsEl ? S.num(merchantsEl.textContent) : 0,
      hasMarket: !!page.doc.querySelector('input[name="wood"]'),
    };
  }

  function plan(snaps, s) {
    const target = s.targetPercentage / 100;
    const tol = s.tolerance / 100;
    const shipments = [];
    const cap = new Map(snaps.map((v) => [v.id, v.merchants * 1000]));
    for (const r of S.RESOURCES) {
      const donors = snaps.filter((v) => v.hasMarket && v.storage && v.res[r] / v.storage > target + tol);
      const takers = snaps.filter((v) => v.storage && v.res[r] / v.storage < target - tol);
      for (const t of takers) {
        let need = Math.floor(target * t.storage - t.res[r]);
        donors.sort((a, b) => S.dist(a.x, a.y, t.x, t.y) - S.dist(b.x, b.y, t.x, t.y));
        for (const d of donors) {
          if (need < s.minShipment) break;
          const spare = Math.floor(d.res[r] - target * d.storage);
          const amount = Math.floor(Math.min(need, spare, cap.get(d.id) || 0) / 1000) * 1000;
          if (amount < s.minShipment) continue;
          shipments.push({ from: d, to: t, r, amount });
          d.res[r] -= amount;
          t.res[r] += amount;
          cap.set(d.id, cap.get(d.id) - amount);
          need -= amount;
        }
      }
    }
    return shipments;
  }

  TW.registerModule({
    id: MODULE_ID,
    name: 'Balanceador de Recursos',
    screens: ['any'],
    defaultEnabled: false,
    async run(ctx) {
      const ui = S.card(MODULE_ID, 'Balanceador');
      S.loop(MODULE_ID, async () => {
        const s = { ...DEFAULTS, ...(await ctx.storage.getModuleSettings(MODULE_ID, DEFAULTS)) };
        const villages = (await S.myVillages()).slice(0, s.maxVillages);
        if (villages.length < 2) return ui.setStatus('precisa de 2+ aldeias');
        const snaps = [];
        for (const v of villages) {
          if (S.botState.active) return;
          ui.setStatus(`lendo ${v.name}`);
          const snap = await snapshot(v);
          if (snap && snap.storage) snaps.push(snap);
          await S.sleep(S.jitter(900, 2000));
        }
        const shipments = plan(snaps, s);
        if (!shipments.length) return ui.setStatus(`equilibrado (alvo ${s.targetPercentage}%)`);
        let ok = 0;
        for (const sh of shipments) {
          if (S.botState.active) return;
          const desc = `${sh.amount} ${S.RES_LABELS[sh.r]}: ${sh.from.name} → ${sh.to.name}`;
          if (s.dryRun) {
            ctx.log.info(`(teste) enviaria ${desc}`);
            ok++;
            continue;
          }
          const res = await S.sendResources(sh.from.id, { [sh.r]: sh.amount }, sh.to.x, sh.to.y);
          if (res.ok) {
            ok++;
            ctx.log.info(`Enviado ${desc}`);
          } else {
            ctx.log.warn(`Falhou ${desc}:`, res.reason);
          }
          await S.sleep(S.jitter(1500, 3500));
        }
        ui.setStatus(`${s.dryRun ? 'teste: ' : ''}${ok}/${shipments.length} envio(s)`);
      }, Math.max(10, DEFAULTS.cycleMinutes) * 60000, Math.max(10, DEFAULTS.cycleMinutes) * 60000 * 1.2);
    },
  });
})();

// ============================================================
// MÓDULO: mass-collect — coleta em todas as aldeias
// ============================================================
(function registerMassCollect() {
  'use strict';
  const TW = window.TWSuite;
  const S = TW.shared;
  const MODULE_ID = 'mass-collect';
  const DEFAULTS = { cycleMinutes: 15, maxPerBatch: 25, interval: 2500, unitCaps: {}, waitAllIdle: true, groupFilter: '', dryRun: true };

  TW.registerModule({
    id: MODULE_ID,
    name: 'Coleta em Massa',
    screens: ['any'],
    defaultEnabled: false,
    async run(ctx) {
      const ui = S.card(MODULE_ID, 'Coleta em Massa');

      S.loop(MODULE_ID, async () => {
        const s = await ctx.storage.getModuleSettings(MODULE_ID, DEFAULTS);
        let villages = await S.myVillages();
        if (s.groupFilter) {
          const f = String(s.groupFilter).toLowerCase();
          villages = villages.filter((v) => v.name.toLowerCase().includes(f));
        }
        villages = villages.slice(0, Math.max(1, Number(s.maxPerBatch) || 25));
        let total = 0;
        for (const [idx, v] of villages.entries()) {
          if (S.botState.active) return;
          ui.setStatus(`${idx + 1}/${villages.length}: ${v.name}`);
          try {
            const r = await S.scavengeVillage(v.id, s, ctx.log);
            total += r.sent || 0;
          } catch (e) {
            if (e instanceof S.BotCheckError) return;
            ctx.log.warn(`Coleta falhou em ${v.name}:`, e);
          }
          await S.sleep(S.jitter(Number(s.interval) || 2500, (Number(s.interval) || 2500) * 1.8));
        }
        ui.setStatus(`${s.dryRun ? 'teste: ' : ''}${total} coleta(s) em ${villages.length} aldeia(s) · ${new Date().toLocaleTimeString()}`);
      }, Math.max(5, DEFAULTS.cycleMinutes) * 60000, Math.max(5, DEFAULTS.cycleMinutes) * 60000 * 1.25);
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

// ============================================================
// MÓDULO: coin-mint — Cunhar Moedas & Puxar Recursos
//
// screen=snob, action=coin (coin_mint_count) ou action=reserve
// (mundos com sistema de pacotes) — POST de formulário real, mesmo
// padrão do TWB (GPL-3, só referência de endpoint). Puxar recursos
// reusa S.sendResources (mercado), já usado pelo Balanceador.
// UNVERIFIED — nunca testado ao vivo.
// ============================================================
(function registerCoinMint() {
  'use strict';
  const TW = window.TWSuite;
  const S = TW.shared;
  const MODULE_ID = 'coin-mint';
  const DEFAULTS = {
    cycleMinutes: 20, coinWood: 28000, coinStone: 30000, coinIron: 25000, maxPerCycle: 10,
    pullResources: false, pullKeepPercent: 30, pullMaxVillages: 15, dryRun: true,
  };

  async function mint(vid, vname, s, log) {
    const page = await S.getPage(`/game.php?village=${vid}&screen=snob`);
    const g = S.gameDataFromHtml(page.text) || S.gd();
    const coinInput = page.doc.querySelector('[name="coin_mint_count"]');
    const reserveForm = page.doc.querySelector('form[action*="action=reserve"]');
    if (!coinInput && !reserveForm) return { minted: 0, reason: 'sem opção de cunhar nesta aldeia' };

    const v = g.village;
    const byRes = Math.min(Math.floor(v.wood / s.coinWood), Math.floor(v.stone / s.coinStone), Math.floor(v.iron / s.coinIron));
    const maxAttr = coinInput && Number(coinInput.getAttribute('max'));
    let count = Math.min(byRes, Number(s.maxPerCycle) || 1);
    if (maxAttr) count = Math.min(count, maxAttr);
    if (count <= 0) return { minted: 0, reason: 'recursos insuficientes' };

    if (s.dryRun) {
      log.info(`(teste) cunharia ${count} moeda(s) em ${vname}`);
      return { minted: count, dry: true };
    }
    const action = coinInput ? 'coin' : 'reserve';
    const body = coinInput ? { coin_mint_count: count, count, h: S.csrf() } : { factor: count, h: S.csrf() };
    const res = await S.postForm(`/game.php?village=${vid}&screen=snob&action=${action}&h=${S.csrf()}`, new URLSearchParams(body));
    const err = S.errorFromHtml(res.text);
    if (err) return { minted: 0, reason: err };
    log.info(`Cunhado: ${count} moeda(s) em ${vname}`);
    return { minted: count };
  }

  async function pull(target, s, log) {
    const villages = (await S.myVillages()).filter((v) => String(v.id) !== String(target.id)).slice(0, s.pullMaxVillages);
    let sent = 0;
    for (const v of villages) {
      if (S.botState.active) return sent;
      const page = await S.getPage(`/game.php?village=${v.id}&screen=market&mode=send`);
      const g = S.gameDataFromHtml(page.text);
      const merchantsEl = page.doc.querySelector('#market_merchant_available_count');
      if (!g || !merchantsEl || !page.doc.querySelector('input[name="wood"]')) continue;
      let capacity = S.num(merchantsEl.textContent) * 1000;
      const keep = (Number(g.village.storage_max) || 0) * (s.pullKeepPercent / 100);
      const amounts = {};
      for (const r of S.RESOURCES) {
        const spare = Math.floor((g.village[r] - keep) / 1000) * 1000;
        const take = Math.max(0, Math.min(spare, Math.floor(capacity / 1000) * 1000));
        if (take >= 1000) { amounts[r] = take; capacity -= take; }
      }
      if (!Object.keys(amounts).length) continue;
      if (s.dryRun) { log.info(`(teste) puxaria de ${v.name}:`, amounts); sent++; }
      else {
        const res = await S.sendResources(v.id, amounts, target.x, target.y);
        if (res.ok) sent++; else log.warn(`Puxar de ${v.name} falhou:`, res.reason);
      }
      await S.sleep(S.jitter(1500, 3000));
    }
    return sent;
  }

  TW.registerModule({
    id: MODULE_ID,
    name: 'Cunhar Moedas & Puxar Recursos',
    screens: ['any'],
    defaultEnabled: false,
    async run(ctx) {
      const g = S.gd();
      const target = { id: g.village.id, x: g.village.x, y: g.village.y, name: g.village.name };
      const ui = S.card(MODULE_ID, 'Cunhar Moedas');
      S.loop(`${MODULE_ID}:${target.id}`, async () => {
        const s = { ...DEFAULTS, ...(await ctx.storage.getModuleSettings(MODULE_ID, DEFAULTS)) };
        const r = await mint(target.id, target.name, s, ctx.log);
        let msg = r.minted ? `${r.dry ? 'teste: ' : ''}${r.minted} moeda(s)` : r.reason;
        if (s.pullResources && !S.botState.active) {
          const pulled = await pull(target, s, ctx.log);
          msg += ` · ${pulled} envio(s) puxados`;
        }
        ui.setStatus(msg);
      }, Math.max(5, DEFAULTS.cycleMinutes) * 60000, Math.max(5, DEFAULTS.cycleMinutes) * 60000 * 1.2);
    },
  });
})();

// ============================================================
// MÓDULO: command-labeler — Etiquetador de Comandos
//
// Roda só na tela "Visão geral de comandos" (screen=info_command) —
// não dá pra ativar de outra tela porque é um recurso nativo do
// jogo (marcar todas as caixinhas + clicar em "Etiqueta"), não uma
// requisição própria. Técnica adaptada de vercorgare/tribalwars,
// MIT — clique DOM simples, sem token nenhum envolvido, risco baixo.
// UNVERIFIED: nunca confirmado se o botão realmente se chama
// "Etiqueta" neste mundo/idioma.
// ============================================================
(function registerCommandLabeler() {
  'use strict';
  const TW = window.TWSuite;
  const S = TW.shared;
  const MODULE_ID = 'command-labeler';
  const DEFAULTS = { dryRun: true };

  function findLabelButton() {
    const candidates = [...document.querySelectorAll('input[type="submit"], button')];
    return candidates.find((el) => /etiqueta/i.test(el.value || el.textContent || ''));
  }

  TW.registerModule({
    id: MODULE_ID,
    name: 'Etiquetador de Comandos',
    screens: ['info_command'],
    defaultEnabled: false,
    async run(ctx) {
      const s = await ctx.storage.getModuleSettings(MODULE_ID, DEFAULTS);
      const ui = S.card(MODULE_ID, 'Etiquetador');
      ui.body.appendChild(S.h('div', { class: 'tws-muted', text: 'Só age quando você está nesta tela (Comandos).' }));

      const boxes = [...document.querySelectorAll('input[type="checkbox"]')];
      const btn = findLabelButton();
      if (!boxes.length || !btn) {
        ui.setStatus('elementos não encontrados nesta tela');
        return;
      }
      boxes.forEach((cb) => { cb.checked = true; });
      if (s.dryRun) {
        ctx.log.info(`(teste) etiquetaria ${boxes.length} comando(s)`);
        ui.setStatus(`teste: etiquetaria ${boxes.length}`);
        return;
      }
      btn.click();
      ctx.log.info(`Etiquetou ${boxes.length} comando(s).`);
      ui.setStatus(`${boxes.length} comando(s) etiquetado(s)`);
    },
  });
})();

// ============================================================
// MÓDULO: wall-breaker — Derrubar Muralha
//
// Envia catapultas mirando a muralha (campo `catapult_target`,
// UNVERIFIED — ver nota em shared.confirmCommand) antes de uma
// aldeia entrar na rotação de farm pesado. Lista de alvos é manual
// (não faz sentido descobrir via village.txt: bárbaras raramente
// têm muralha relevante — isso é pra aldeias de jogador específicas).
// ============================================================
(function registerWallBreaker() {
  'use strict';
  const TW = window.TWSuite;
  const S = TW.shared;
  const MODULE_ID = 'wall-breaker';
  const DEFAULTS = { targets: '', catapultCount: 4, escortUnit: 'none', escortAmount: 0, cooldownHours: 12, dryRun: true };

  function parseTargets(text) {
    return String(text || '').split(/[\n;]+/).map((s) => s.trim()).filter(Boolean).map((s) => {
      const m = s.match(/(\d+)\s*\|\s*(\d+)/);
      return m ? { x: Number(m[1]), y: Number(m[2]), label: s } : null;
    }).filter(Boolean);
  }

  TW.registerModule({
    id: MODULE_ID,
    name: 'Derrubar Muralha',
    screens: ['any'], // envio usa S.sendCommand, que já busca a Praça via fetch() quando preciso
    defaultEnabled: false,
    async run(ctx) {
      const gd = ctx.gameApi.getGameData();
      if (!gd || !gd.village) return;
      const vid = gd.village.id;
      const ui = S.card(MODULE_ID, 'Derrubar Muralha');
      const listHost = S.h('div', { class: 'tws-list' });
      ui.body.append(
        S.h('div', { class: 'tws-muted', text: 'Alvos configurados no dashboard (um "X|Y" por linha).' }),
        listHost,
      );

      S.loop(`${MODULE_ID}:${vid}`, async () => {
        const s = { ...DEFAULTS, ...(await ctx.storage.getModuleSettings(MODULE_ID, DEFAULTS)) };
        const targets = parseTargets(s.targets);
        listHost.innerHTML = '';
        if (!targets.length) { ui.setStatus('sem alvos configurados'); return; }

        const now = Date.now();
        let picked = null;
        for (const t of targets) {
          const key = `wall-breaker:lastSent:${vid}:${t.x}_${t.y}`;
          const last = await ctx.storage.get(key, 0);
          listHost.appendChild(S.h('div', { class: 'tws-row', text: `${t.x}|${t.y} · ${last ? `há ${Math.round((now - last) / 60000)}min` : 'nunca'}` }));
          if (!picked && now - last >= s.cooldownHours * 3600000) picked = t;
        }
        if (!picked) { ui.setStatus(`${targets.length} alvo(s), todos em cooldown`); return; }

        const units = { catapult: Number(s.catapultCount) || 1 };
        if (s.escortUnit !== 'none' && s.escortAmount > 0) units[s.escortUnit] = Number(s.escortAmount);

        if (s.dryRun) {
          ctx.log.info(`(teste) derrubaria muralha de ${picked.x}|${picked.y} com ${units.catapult} catapulta(s)`);
          ui.setStatus(`teste: miraria ${picked.x}|${picked.y}`);
          return;
        }

        const res = await S.sendCommand({ villageId: vid, units, x: picked.x, y: picked.y, type: 'attack', catapultTarget: 'wall', capToAvailable: true });
        if (!res.ok) { ctx.log.warn(`Falha ao mirar muralha de ${picked.x}|${picked.y}:`, res.reason); ui.setStatus(`falhou: ${res.reason}`); return; }
        await ctx.storage.set(`wall-breaker:lastSent:${vid}:${picked.x}_${picked.y}`, Date.now());
        ctx.log.info(`Catapultas enviadas contra a muralha de ${picked.x}|${picked.y}.`);
        ui.setStatus(`enviado a ${picked.x}|${picked.y}`);
      }, 60000, 100000);
    },
  });
})();

// ============================================================
// MÓDULO: snip-cancel — Cancelamento agendado
//
// Não tentamos automatizar a decisão de "qual comando enviar pra
// criar o efeito de snipe" — isso depende de ler a tela do
// adversário (Etiquetador) e calcular janelas que nunca confirmamos.
// O que este módulo garante, com confiança: você escolhe QUALQUER
// comando seu que ainda pode ser cancelado, escolhe a hora, e o
// cancelamento dispara no segundo certo (via serverTime.scheduleAt),
// mesmo se você não estiver olhando a tela.
// ============================================================
(function registerSnipCancel() {
  'use strict';
  const TW = window.TWSuite;
  const S = TW.shared;
  const MODULE_ID = 'snip-cancel';
  const QUEUE_KEY = 'snip-cancel:queue';

  const queueLoad = () => TW.storage.get(QUEUE_KEY, []);
  const queueSave = (q) => TW.storage.set(QUEUE_KEY, q);

  TW.registerModule({
    id: MODULE_ID,
    name: 'Snip por Cancelamento',
    screens: ['any'],
    defaultEnabled: false,
    async run(ctx) {
      const vid = S.villageId();
      if (!vid) return;
      const ui = S.card(MODULE_ID, 'Snip/Cancelamento');
      const state = { queue: await queueLoad(), armed: new Set() };

      const cmdHost = S.h('div', { class: 'tws-list' });
      const queueHost = S.h('div', { class: 'tws-list' });
      const timeInput = S.h('input', { type: 'text', placeholder: 'HH:MM:SS para cancelar', style: { width: '100%' } });
      let selectedId = null;

      async function refreshCommands() {
        cmdHost.innerHTML = '';
        const cmds = await S.listCancelableCommands(vid).catch(() => []);
        if (!cmds.length) { cmdHost.appendChild(S.h('div', { class: 'tws-muted', text: 'Nenhum comando cancelável agora.' })); return; }
        for (const c of cmds) {
          const row = S.h('button', {
            class: 'tws-row', style: { width: '100%', textAlign: 'left', border: c.id === selectedId ? '1px solid #7a5230' : 'none' },
            text: c.label || `#${c.id}`,
            onclick: () => { selectedId = c.id; refreshCommands(); },
          });
          cmdHost.appendChild(row);
        }
      }

      function refreshQueue() {
        queueHost.innerHTML = '';
        if (!state.queue.length) { queueHost.appendChild(S.h('div', { class: 'tws-muted', text: 'Nada agendado.' })); return; }
        for (const item of state.queue) {
          const eta = item.cancelAtMs - S.serverTime.now();
          queueHost.appendChild(S.h('div', { class: 'tws-row' }, [
            `#${item.commandId} em ${Math.max(0, Math.round(eta / 1000))}s`,
            S.h('button', { text: '✕', onclick: async () => { state.queue = state.queue.filter((i) => i.id !== item.id); await queueSave(state.queue); refreshQueue(); } }),
          ]));
        }
      }

      const addBtn = S.h('button', {
        text: '+ Agendar cancelamento', style: { width: '100%' },
        onclick: async () => {
          if (!selectedId) return ctx.log.warn('Selecione um comando na lista acima primeiro.');
          const cancelAtMs = S.parseGameTime(timeInput.value);
          if (!cancelAtMs) return ctx.log.warn('Horário inválido — use HH:MM:SS.');
          state.queue.push({ id: 'snip_' + Math.random().toString(36).slice(2, 9), commandId: selectedId, vid, cancelAtMs, status: 'pending' });
          await queueSave(state.queue);
          refreshQueue();
        },
      });

      ui.body.append(
        S.h('div', { style: { fontWeight: 'bold', fontSize: '10px' }, text: 'Comandos que ainda dá pra cancelar' }), cmdHost,
        timeInput, addBtn,
        S.h('div', { style: { fontWeight: 'bold', fontSize: '10px', marginTop: '4px' }, text: 'Fila' }), queueHost,
      );

      await refreshCommands();
      refreshQueue();

      setInterval(async () => {
        const now = S.serverTime.now();
        for (const item of state.queue) {
          if (item.status !== 'pending' || item.cancelAtMs - now > 5000 || state.armed.has(item.id)) continue;
          state.armed.add(item.id);
          S.serverTime.scheduleAt(item.cancelAtMs, async () => {
            const res = await S.cancelCommand(item.vid, item.commandId);
            item.status = res.ok ? 'done' : 'failed';
            ctx.log.info(res.ok ? `Comando #${item.commandId} cancelado.` : `Falha ao cancelar #${item.commandId}: ${res.reason}`);
            state.queue = state.queue.filter((i) => i.id !== item.id);
            await queueSave(state.queue);
            refreshQueue();
          });
        }
      }, 3000);
    },
  });
})();

// ============================================================
// MÓDULO: market-exchange — Compra/Venda no Mercado (pontos premium)
//
// Usa a Troca Premium (screen=market&mode=exchange), não o mercado
// entre jogadores. UNVERIFIED: nomes de campo baseados em
// stefan2200/TWB (GPL-3, só referência de endpoint) — "sell_<recurso>"
// confirmado no código deles; "buy_<recurso>" é suposição simétrica.
// ============================================================
(function registerMarketExchange() {
  'use strict';
  const TW = window.TWSuite;
  const S = TW.shared;
  const MODULE_ID = 'market-exchange';
  const DEFAULTS = { mode: 'sell', resource: 'wood', amount: 1000, targetRate: 300, cycleMinutes: 30, dryRun: true };

  TW.registerModule({
    id: MODULE_ID,
    name: 'Troca Premium',
    screens: ['any'],
    defaultEnabled: false,
    async run(ctx) {
      const vid = S.villageId();
      if (!vid) return;
      const ui = S.card(MODULE_ID, 'Troca Premium');
      S.loop(`${MODULE_ID}:${vid}`, async () => {
        const s = { ...DEFAULTS, ...(await ctx.storage.getModuleSettings(MODULE_ID, DEFAULTS)) };
        const rates = await S.premiumExchangeRates(vid).catch(() => null);
        if (!rates) { ui.setStatus('taxas indisponíveis (sem mercado premium aqui?)'); return; }
        const rate = rates.rates && rates.rates[s.resource];
        if (rate == null) { ui.setStatus('taxa do recurso não encontrada'); return; }

        const worth = s.mode === 'sell' ? rate >= s.targetRate : rate <= s.targetRate;
        if (!worth) { ui.setStatus(`taxa atual ${rate} — fora do alvo (${s.targetRate})`); return; }

        if (s.dryRun) {
          ctx.log.info(`(teste) ${s.mode === 'sell' ? 'venderia' : 'compraria'} ${s.amount} ${s.resource} (taxa ${rate})`);
          ui.setStatus(`teste: ${s.mode} ${s.amount} ${s.resource} @ ${rate}`);
          return;
        }
        const res = await S.premiumExchange(vid, s.mode, s.resource, s.amount);
        if (!res.ok) { ctx.log.warn('Troca recusada:', res.reason); ui.setStatus(`recusado: ${res.reason}`); return; }
        ctx.log.info(`Troca concluída: ${s.mode} ${s.amount} ${s.resource} @ ${rate}.`);
        ui.setStatus(`trocado @ ${rate}`);
      }, Math.max(10, DEFAULTS.cycleMinutes) * 60000, Math.max(10, DEFAULTS.cycleMinutes) * 60000 * 1.3);
    },
  });
})();

// ============================================================
// MÓDULO: paladin-trainer — Upar Paladino em Massa (RASCUNHO)
//
// Diferente dos outros módulos novos, este NÃO tenta comprar/treinar
// nada de verdade — não temos nenhuma referência confiável (nem de
// projeto aberto, nem de HAR) pra saber o endpoint real de evolução
// do Paladino neste jogo. Em vez de chutar um ajaxaction e arriscar
// gastar recursos de verdade num palpite errado, este módulo só
// detecta a tela e relata o que vê — modo teste permanente até
// alguém confirmar o mecanismo ao vivo (ver docs/verification-log.md).
// ============================================================
(function registerPaladinTrainer() {
  'use strict';
  const TW = window.TWSuite;
  const S = TW.shared;
  const MODULE_ID = 'paladin-trainer';

  TW.registerModule({
    id: MODULE_ID,
    name: 'Upar Paladino (diagnóstico)',
    screens: ['statue'],
    defaultEnabled: false,
    async run(ctx) {
      const ui = S.card(MODULE_ID, 'Paladino');
      ui.body.appendChild(S.h('div', { class: 'tws-test', text: 'Só diagnóstico — não compra nada ainda.' }));
      const forms = document.querySelectorAll('form');
      const buttons = [...document.querySelectorAll('input[type="submit"], button')].filter((b) => /treinar|comprar|equipar|livro/i.test(b.value || b.textContent || ''));
      ui.body.appendChild(S.h('div', { class: 'tws-muted', text: `${forms.length} formulário(s), ${buttons.length} botão(ões) candidato(s) nesta tela.` }));
      ui.setStatus(buttons.length ? `achei ${buttons.length} botão(ões)` : 'nada reconhecido');
      ctx.log.info(`Diagnóstico do Paladino: ${forms.length} forms, botões candidatos: ${buttons.map((b) => (b.value || b.textContent || '').trim()).join(' | ') || '(nenhum)'}`);
    },
  });
})();
