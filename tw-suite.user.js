// ==UserScript==
// @name         TW Suite
// @namespace    https://github.com/LuizAngeloF/tw-suite
// @version      0.3.4
// @description  Sistema centralizado de módulos de automação para Tribal Wars (uso privado / grupo fechado)
// @author       LuizAngeloF
// @match        https://*.tribalwars.com.br/game.php*
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
// (com data-all-count = disponível), #target_attack,
// #troop_confirm_submit (botão final "Enviar ataque"). Preencher
// x/y não seleciona o alvo na hora — o jogo resolve a coordenada de
// forma assíncrona (a URL ganha ?target=<id> quando termina), por
// isso o código espera esse parâmetro aparecer antes de clicar.
//
// autoConfirm começa DESLIGADO por padrão mesmo com o seletor já
// verificado — é uma ação real e definitiva (as tropas saem de
// verdade), então fica opt-in por segurança, não por incerteza
// técnica.
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
    autoConfirm: false, // seletor verificado, mas opt-in por ser uma ação definitiva
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

  // Preencher x/y não seleciona o alvo na hora — o jogo resolve a
  // coordenada pra um alvo de verdade de forma assíncrona (a URL ganha
  // ?target=<id> quando termina). Clicar em "Ataque" antes disso é
  // rejeitado pelo próprio jogo (confirmado ao vivo em 2026-09-19).
  function waitForTargetResolved(timeoutMs = 4000, intervalMs = 150) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const params = new URLSearchParams(location.search);
        if (params.get('target')) {
          resolve(true);
          return;
        }
        if (Date.now() - start >= timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(tick, intervalMs);
      };
      tick();
    });
  }

  async function fillAndSubmitAttack(unit, amount, x, y) {
    const xInput = document.querySelector('#inputx');
    const yInput = document.querySelector('#inputy');
    const attackBtn = document.querySelector('#target_attack');
    if (!xInput || !yInput || !attackBtn) {
      return { ok: false, reason: 'campo do formulário não encontrado (seletor pode ter mudado)' };
    }
    xInput.value = String(x);
    yInput.value = String(y);
    for (const el of [xInput, yInput]) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const resolved = await waitForTargetResolved();
    if (!resolved) {
      return { ok: false, reason: 'o jogo não confirmou o alvo a tempo (sem ?target= na URL) — tente de novo' };
    }

    const unitInput = document.querySelector('#unit_input_' + unit);
    if (!unitInput) {
      return { ok: false, reason: `campo de tropa "${unit}" não encontrado` };
    }
    unitInput.value = String(amount);
    unitInput.dispatchEvent(new Event('input', { bubbles: true }));
    unitInput.dispatchEvent(new Event('change', { bubbles: true }));

    attackBtn.click();
    return { ok: true };
  }

  function isVisible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }

  // el.click() dispara um evento sem coordenadas reais (clientX/Y = 0).
  // Algumas páginas rejeitam clique de confirmação final assim, mesmo
  // sem checar isTrusted — simula mousedown/mouseup/click com as
  // coordenadas reais do botão, que é o máximo que dá pra fazer via JS
  // (o navegador nunca marca evento sintético como isTrusted; se o
  // bloqueio for por isso, não tem contorno possível do lado do script).
  function realisticClick(el) {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
    el.dispatchEvent(new MouseEvent('mouseover', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }

  // Última tentativa: em vez de simular um clique (sempre isTrusted:
  // false), envia o <form> diretamente pela API do navegador.
  // form.requestSubmit(el) ainda dispara o evento "submit" nativo (então
  // um handler JS da página que intercepta esse evento continua rodando
  // normalmente) mas pula o tratamento de clique do botão em si — se o
  // bloqueio for especificamente no listener de click do botão, isso
  // pode contornar. form.submit() (mais antigo) nem dispara "submit",
  // então fica como último recurso.
  function submitViaForm(el) {
    const form = el.form || el.closest('form');
    if (!form) return false;
    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit(el);
      return true;
    }
    form.submit();
    return true;
  }

  // A tela de confirmação também aparece via transição client-side (sem
  // recarregar a página), então o botão não existe ainda no instante em
  // que clicamos "Ataque" — precisa esperar aparecer, do mesmo jeito que
  // esperamos o alvo ser resolvido. Exige visível (não só presente no
  // DOM) porque a página pode manter um nó oculto/gabarito antes da
  // troca de conteúdo terminar de verdade.
  function waitForElement(selector, timeoutMs = 5000, intervalMs = 150) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const el = document.querySelector(selector);
        if (el && isVisible(el)) {
          resolve(el);
          return;
        }
        if (Date.now() - start >= timeoutMs) {
          resolve(null);
          return;
        }
        setTimeout(tick, intervalMs);
      };
      tick();
    });
  }

  // #troop_confirm_submit confirmado ao vivo em 2026-09-19 (botão
  // "Enviar ataque").
  async function waitForConfirmButton(timeoutMs = 6000) {
    const found = await waitForElement('#troop_confirm_submit', timeoutMs);
    if (!found) return null;
    // Pequena espera de estabilização + reconsulta: se a página tiver
    // re-renderizado o formulário logo depois de aparecer visível, o nó
    // que pegamos pode já estar "morto" (desligado do form ao vivo).
    await new Promise((r) => setTimeout(r, 350));
    const fresh = document.querySelector('#troop_confirm_submit');
    return fresh && isVisible(fresh) ? fresh : found;
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

    const autoConfirmLabel = document.createElement('label');
    autoConfirmLabel.style.display = 'block';
    autoConfirmLabel.style.marginTop = '2px';
    const autoConfirmCb = document.createElement('input');
    autoConfirmCb.type = 'checkbox';
    autoConfirmCb.checked = settings.autoConfirm;
    autoConfirmCb.addEventListener('change', () => onChange({ autoConfirm: autoConfirmCb.checked }));
    autoConfirmLabel.appendChild(autoConfirmCb);
    autoConfirmLabel.appendChild(document.createTextNode(' Auto-confirmar envio (ação definitiva!)'));

    wrap.appendChild(document.createTextNode('Tropa: '));
    wrap.appendChild(unitSelect);
    wrap.appendChild(document.createElement('br'));
    wrap.appendChild(document.createTextNode('Qtd: '));
    wrap.appendChild(amountInput);
    wrap.appendChild(document.createTextNode('  Alcance: '));
    wrap.appendChild(distInput);
    wrap.appendChild(dryRunLabel);
    wrap.appendChild(autoConfirmLabel);

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
      panel.innerHTML = '';

      const title = document.createElement('div');
      title.style.fontWeight = 'bold';
      title.style.marginBottom = '6px';
      title.textContent = 'Auto Farm';
      panel.appendChild(title);

      // A confirmação do ataque acontece via transição client-side (a
      // URL não muda de um jeito detectável em run(), que só executa
      // uma vez por carregamento real de página) — por isso o clique em
      // "Enviar ataque" é tratado dentro do próprio fluxo de envio
      // abaixo (fillAndSubmitAttack -> aguardar #troop_confirm_submit),
      // não como uma tela separada.

      renderSettingsForm(panel, settings, async (patch) => {
        settings = { ...settings, ...patch };
        await storage.setModuleSettings(MODULE_ID, settings);
        log.info('Configurações do Auto Farm atualizadas:', settings);
      });

      const resetBtn = document.createElement('button');
      resetBtn.textContent = 'Restaurar alvos';
      resetBtn.style.fontSize = '11px';
      resetBtn.style.marginBottom = '6px';
      resetBtn.title = 'Limpa o cooldown desta aldeia — alvos já tentados voltam a aparecer';
      resetBtn.addEventListener('click', async () => {
        const removed = await storage.removeByPrefix(`auto-farm:lastSent:${myVillage.id}:`);
        log.info(`${removed} alvo(s) restaurado(s).`);
        await refreshList();
      });
      panel.appendChild(resetBtn);

      const listEl = document.createElement('div');
      panel.appendChild(listEl);

      async function refreshList() {
        listEl.innerHTML = 'Buscando aldeias bárbaras próximas...';
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

            btn.disabled = true;
            btn.textContent = 'Aguardando alvo...';
            const result = await fillAndSubmitAttack(settings.unit, amount, target.x, target.y);
            if (!result.ok) {
              btn.disabled = false;
              btn.textContent = 'Enviar';
              log.error('Falha ao preencher/enviar:', result.reason);
              return;
            }
            log.info('Alvo confirmado, aguardando tela de "Enviar ataque"...');

            const confirmBtn = await waitForConfirmButton();
            btn.disabled = false;
            btn.textContent = 'Enviar';

            if (!confirmBtn) {
              log.warn('A tela de confirmação não apareceu a tempo — confira manualmente se o ataque ficou pendente. Esse alvo continua na lista (nada foi marcado como enviado).');
              return;
            }

            if (!settings.autoConfirm) {
              log.info('Na tela de confirmação — confirme manualmente. Esse alvo continua na lista até você clicar "Restaurar alvos" (nada foi gravado como enviado ainda).');
              return;
            }

            // Reconsulta na hora do clique — o nó pego pela espera pode
            // ter sido substituído por um novo (SPA re-renderizando).
            const clickTarget = document.querySelector('#troop_confirm_submit') || confirmBtn;
            log.info(`Auto-confirmar: enviando o formulário -> ${target.x}|${target.y}.`);
            const submitted = submitViaForm(clickTarget);
            if (!submitted) {
              log.warn('Não achei o <form> do botão de confirmação — tentando clique simulado como último recurso.');
              realisticClick(clickTarget);
            }

            // Diagnóstico: se o botão ainda estiver lá e visível depois
            // do envio, provavelmente não teve efeito (alguns jogos
            // bloqueiam interação automática na ação final, como
            // proteção anti-bot) — melhor avisar do que assumir sucesso.
            await new Promise((r) => setTimeout(r, 800));
            const stillThere = document.querySelector('#troop_confirm_submit');
            if (stillThere && isVisible(stillThere)) {
              log.warn('O botão "Enviar ataque" ainda está na tela depois da tentativa — o auto-confirmar provavelmente NÃO funcionou (o jogo pode estar bloqueando envio automático nessa etapa). Confirme manualmente. Alvo continua na lista.');
              return;
            }

            log.info(`Enviado (auto-confirmado): ${amount} "${settings.unit}" -> ${target.x}|${target.y}.`);
            await ctx.storage.set(cooldownKey(myVillage.id, target.id), Date.now());
            row.remove();
          });
          row.appendChild(btn);
          listEl.appendChild(row);
        }
      }

      await refreshList();
    },
  });
})();
