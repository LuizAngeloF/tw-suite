// ==UserScript==
// @name         TW Suite
// @namespace    https://github.com/SEU_USUARIO/tw-suite
// @version      0.1.0
// @description  Sistema centralizado de módulos de automação para Tribal Wars (uso privado / grupo fechado)
// @author       SEU_USUARIO
// @match        https://*.tribalwars.com.br/game.php*
// @icon         https://www.tribalwars.com.br/favicon.ico
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM.setValue
// @grant        GM.getValue
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/SEU_USUARIO/tw-suite/main/tw-suite.user.js
// @downloadURL  https://raw.githubusercontent.com/SEU_USUARIO/tw-suite/main/tw-suite.user.js
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
 * Antes de instalar: troque "SEU_USUARIO" acima pelo usuário/repo real do
 * GitHub onde este arquivo vai ficar hospedado, senão o auto-update não
 * funciona.
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
    };
  })();

  // ============================================================
  // CORE: gameApi — leitura de game_data e detecção de tela.
  // ============================================================
  const gameApi = (() => {
    function getGameData() {
      if (typeof window.game_data === 'undefined') {
        log.warn('game_data não encontrado nesta página — confirme se o jogo realmente carregou aqui.');
        return null;
      }
      return window.game_data;
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
      `;
      document.body.appendChild(el);
      el.querySelector('#twsuite-close').addEventListener('click', togglePanel);
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
      const lines = [
        `Versão: 0.1.0 (Fase 0)`,
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

    log.info(`Carregado. Tela: ${gameApi.getCurrentScreen()}. Menu nativo injetado: ${nativeMenuInjected}. Módulos registrados: ${moduleLoader.getRegistry().length}.`);

    await moduleLoader.runAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
