// ==UserScript==
// @name         TW Suite
// @namespace    https://github.com/LuizAngeloF/tw-suite
// @version      0.2.1
// @description  Sistema centralizado de módulos de automação para Tribal Wars (uso privado / grupo fechado)
// @author       LuizAngeloF
// @match        https://*.tribalwars.com.br/game.php*
// @icon         https://www.tribalwars.com.br/favicon.ico
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM.setValue
// @grant        GM.getValue
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

    log.info(`Carregado. Tela: ${gameApi.getCurrentScreen()}. Menu nativo injetado: ${nativeMenuInjected}. Módulos registrados: ${moduleLoader.getRegistry().length}.`);

    await moduleLoader.runAll();
  }

  if (document.readyState === 'loading') {
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
// Reunião, e ao clicar "Enviar" preenche o formulário REAL de envio
// (#inputx/#inputy/#unit_input_<tropa>) e clica no botão real
// #target_attack — nunca recria a requisição na mão.
//
// Seletores confirmados ao vivo em 2026-09-19 (ver
// docs/verification-log.md): #inputx, #inputy, #unit_input_<tropa>
// (com data-all-count = disponível), #target_attack.
//
// O clique automático no botão de CONFIRMAR (tela try=confirm)
// ainda não foi verificado ao vivo — por isso autoConfirm começa
// desligado por padrão; liga manualmente só depois de confirmar
// que o seletor certo é usado.
// ============================================================
(function registerAutoFarmModule() {
  'use strict';

  const MODULE_ID = 'auto-farm';
  const PANEL_ID = 'twsuite-autofarm-panel';
  const VILLAGE_CACHE_KEY = 'auto-farm:villageIndexCache';
  const VILLAGE_CACHE_TTL_MS = 3 * 60 * 60 * 1000; // village.txt tem ~3MB; evita rebaixar toda hora

  const UNIT_OPTIONS = [
    { value: 'light', label: 'Cavalaria leve' },
    { value: 'spear', label: 'Lanceiro' },
    { value: 'sword', label: 'Espadachim' },
    { value: 'archer', label: 'Arqueiro' },
  ];

  const DEFAULT_SETTINGS = {
    unit: 'light',
    amount: 5,
    maxDistance: 12,
    cooldownMinutes: 30,
    dryRun: true,
    autoConfirm: false, // UNVERIFIED — ver comentário acima
  };

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

  function fillAndSubmitAttack(unit, amount, x, y) {
    const xInput = document.querySelector('#inputx');
    const yInput = document.querySelector('#inputy');
    const unitInput = document.querySelector('#unit_input_' + unit);
    const attackBtn = document.querySelector('#target_attack');
    if (!xInput || !yInput || !unitInput || !attackBtn) {
      return { ok: false, reason: 'campo do formulário não encontrado (seletor pode ter mudado)' };
    }
    xInput.value = String(x);
    yInput.value = String(y);
    unitInput.value = String(amount);
    for (const el of [xInput, yInput, unitInput]) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    attackBtn.click();
    return { ok: true };
  }

  function tryAutoConfirm(log) {
    const candidateSelectors = [
      '#troop_confirm_go',
      '#troop_confirm_submit',
      'input[type=submit][value*="onfirm" i]',
      'input[type=submit][value*="Confirmar" i]',
      '.btn-confirm-yes',
    ];
    for (const sel of candidateSelectors) {
      const btn = document.querySelector(sel);
      if (btn) {
        log.warn(`Auto-confirmar (seletor NÃO verificado ao vivo): clicando em "${sel}". Acompanhe pra garantir que é o botão certo.`);
        btn.click();
        return true;
      }
    }
    log.warn('Auto-confirmar ligado, mas não achei um botão de confirmação reconhecido — confirme manualmente desta vez e avise pra eu ajustar o seletor.');
    return false;
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

  function renderSettingsForm(container, settings, onChange) {
    const wrap = document.createElement('div');
    wrap.style.marginBottom = '8px';
    wrap.style.borderBottom = '1px solid #7a5230';
    wrap.style.paddingBottom = '8px';

    const unitSelect = document.createElement('select');
    for (const opt of UNIT_OPTIONS) {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      if (opt.value === settings.unit) o.selected = true;
      unitSelect.appendChild(o);
    }
    unitSelect.addEventListener('change', () => onChange({ unit: unitSelect.value }));

    const amountInput = document.createElement('input');
    amountInput.type = 'number';
    amountInput.min = '1';
    amountInput.value = String(settings.amount);
    amountInput.style.width = '50px';
    amountInput.title = 'Quantidade a enviar por alvo';
    amountInput.addEventListener('change', () =>
      onChange({ amount: Math.max(1, Number(amountInput.value) || 1) })
    );

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

    wrap.appendChild(document.createTextNode('Tropa: '));
    wrap.appendChild(unitSelect);
    wrap.appendChild(document.createElement('br'));
    wrap.appendChild(document.createTextNode('Qtd: '));
    wrap.appendChild(amountInput);
    wrap.appendChild(document.createTextNode('  Alcance: '));
    wrap.appendChild(distInput);
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

      const params = new URLSearchParams(location.search);
      const isConfirmStep = params.get('try') === 'confirm';
      let settings = await storage.getModuleSettings(MODULE_ID, DEFAULT_SETTINGS);

      let panel = document.getElementById(PANEL_ID);
      if (!panel) panel = buildPanel();
      panel.innerHTML = '';

      const title = document.createElement('div');
      title.style.fontWeight = 'bold';
      title.style.marginBottom = '6px';
      title.textContent = 'Auto Farm';
      panel.appendChild(title);

      if (isConfirmStep) {
        const info = document.createElement('div');
        info.textContent = settings.autoConfirm
          ? 'Tentando confirmar automaticamente (seletor não verificado)...'
          : 'Na tela de confirmação. Confirme manualmente — auto-confirmar está desligado.';
        panel.appendChild(info);
        if (settings.autoConfirm) tryAutoConfirm(log);
        return;
      }

      renderSettingsForm(panel, settings, async (patch) => {
        settings = { ...settings, ...patch };
        await storage.setModuleSettings(MODULE_ID, settings);
        log.info('Configurações do Auto Farm atualizadas:', settings);
      });

      const listEl = document.createElement('div');
      listEl.textContent = 'Buscando aldeias bárbaras próximas...';
      panel.appendChild(listEl);

      const myVillage = { id: gd.village.id, x: gd.village.x, y: gd.village.y };
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
        btn.addEventListener('click', async () => {
          const unitInput = document.querySelector('#unit_input_' + settings.unit);
          const available = unitInput ? Number(unitInput.dataset.allCount || 0) : 0;
          const amount = Math.min(settings.amount, available);

          if (settings.dryRun) {
            if (available <= 0) {
              log.info(`(modo teste) enviaria ${settings.amount} "${settings.unit}" para ${target.x}|${target.y} — mas você tem 0 disponíveis agora, um envio real seria bloqueado.`);
            } else {
              log.info(`(modo teste) enviaria ${amount} "${settings.unit}" para ${target.x}|${target.y}${amount < settings.amount ? ` (só ${available} disponíveis)` : ''}`);
            }
            return;
          }

          if (available <= 0) {
            log.warn(`Sem "${settings.unit}" disponível nesta aldeia (0 unidades) — não enviado.`);
            return;
          }
          if (amount < settings.amount) {
            log.warn(`Só ${available} "${settings.unit}" disponíveis — enviando ${amount} em vez de ${settings.amount}.`);
          }

          const result = fillAndSubmitAttack(settings.unit, amount, target.x, target.y);
          if (!result.ok) {
            log.error('Falha ao preencher/enviar:', result.reason);
            return;
          }
          await ctx.storage.set(cooldownKey(myVillage.id, target.id), Date.now());
          log.info(`Enviado: ${amount} "${settings.unit}" -> ${target.x}|${target.y}`);
        });
        row.appendChild(btn);
        listEl.appendChild(row);
      }
    },
  });
})();
