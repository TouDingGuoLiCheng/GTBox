(function () {
  if (window.__GLC_SPEED_PLAYER__) return;

  const RATE_MIN = 0.25;
  const RATE_MAX = 2;
  const RATE_STEP = 0.05;
  const STORAGE_PREFIX = "glcToolbox.speedPlayer.";
  const TICK_MS = 250;
  const MO_OBS_DEBOUNCE_MS = 300;

  const state = {
    rate: 1,
    abEnabled: false,
    pointA: null,
    pointB: null,
    markers: [],
    videoId: null,
    collapsed: false,
    rateDriftCount: 0,
  };

  let ui = null;
  let markerDialogEl = null;
  let markerDialogResolve = null;
  let lastHref = location.href;
  let moTimer = null;
  let activeVideo = null;

  function clampRate(v) {
    const n = Math.round(v / RATE_STEP) * RATE_STEP;
    return Math.min(RATE_MAX, Math.max(RATE_MIN, Number(n.toFixed(2))));
  }

  function collectVideosDeep(root) {
    const out = [];
    const walk = (node) => {
      if (!node) return;
      if (node.nodeName === "VIDEO") out.push(node);
      if (node.shadowRoot) walk(node.shadowRoot);
      if (node.children) {
        for (const child of node.children) walk(child);
      }
    };
    walk(root);
    return out;
  }

  function scoreVideo(v) {
    if (!v) return -1;
    let score = v.clientWidth * v.clientHeight;
    if (!v.paused) score += 1e6;
    if (v.readyState >= 2) score += 1e5;
    const rect = v.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) score += rect.width * rect.height;
    return score;
  }

  function findVideo() {
    const list = collectVideosDeep(document);
    if (!list.length) return null;
    let best = list[0];
    let bestScore = scoreVideo(best);
    for (let i = 1; i < list.length; i++) {
      const s = scoreVideo(list[i]);
      if (s > bestScore) {
        best = list[i];
        bestScore = s;
      }
    }
    return best;
  }

  function getVideoId() {
    const bv = location.pathname.match(/\/video\/(BV[\w]+)/i);
    if (bv) return bv[1];
    const av = location.pathname.match(/\/video\/(av\d+)/i);
    if (av) return av[1];
    const q = location.search.match(/[?&]bvid=(BV[\w]+)/i);
    return q ? q[1] : null;
  }

  function storageKey(videoId) {
    return STORAGE_PREFIX + "markers." + videoId;
  }

  function rateKey(videoId) {
    return STORAGE_PREFIX + "rate." + videoId;
  }

  function loadMarkers(videoId) {
    if (!videoId) return [];
    try {
      const raw = localStorage.getItem(storageKey(videoId));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function loadRate(videoId) {
    if (!videoId) return 1;
    try {
      const raw = localStorage.getItem(rateKey(videoId));
      const n = parseFloat(raw);
      return Number.isFinite(n) ? clampRate(n) : 1;
    } catch {
      return 1;
    }
  }

  function saveMarkers() {
    if (!state.videoId) return;
    try {
      localStorage.setItem(storageKey(state.videoId), JSON.stringify(state.markers));
    } catch {
      /* ignore */
    }
  }

  function saveRate() {
    if (!state.videoId) return;
    try {
      localStorage.setItem(rateKey(state.videoId), String(state.rate));
    } catch {
      /* ignore */
    }
  }

  function saveLastHref() {
    try {
      localStorage.setItem(STORAGE_PREFIX + "lastHref", location.href);
    } catch {
      /* ignore */
    }
  }

  function tryRestoreLastHref() {
    if (sessionStorage.getItem(STORAGE_PREFIX + "restored")) return;
    try {
      const last = localStorage.getItem(STORAGE_PREFIX + "lastHref");
      if (!last || !/bilibili\.com/i.test(last)) return;
      if (last === location.href) return;
      const onHome =
        location.pathname === "/" ||
        location.pathname === "/index.html" ||
        location.href === "https://www.bilibili.com/" ||
        location.href === "https://www.bilibili.com";
      if (!onHome) return;
      sessionStorage.setItem(STORAGE_PREFIX + "restored", "1");
      location.href = last;
    } catch {
      /* ignore */
    }
  }

  function formatTime(sec) {
    if (!Number.isFinite(sec)) return "0:00";
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ":" + String(r).padStart(2, "0");
  }

  function applyRate(force) {
    const v = findVideo();
    if (!v) return false;
    activeVideo = v;
    if (force || Math.abs(v.playbackRate - state.rate) > 0.001) {
      try {
        v.playbackRate = state.rate;
        if (Math.abs(v.playbackRate - state.rate) > 0.01) {
          state.rateDriftCount += 1;
        }
      } catch {
        /* ignore */
      }
    }
    return true;
  }

  function onVideoTick() {
    const v = activeVideo || findVideo();
    if (!v) return;
    if (Math.abs(v.playbackRate - state.rate) > 0.01) {
      v.playbackRate = state.rate;
      state.rateDriftCount += 1;
    }
    if (!state.abEnabled) return;
    if (state.pointA == null) return;
    const end = state.pointB != null ? state.pointB : v.duration;
    if (!Number.isFinite(end)) return;
    if (v.currentTime >= end - 0.05) {
      v.currentTime = state.pointA;
    }
  }

  function bindVideoEvents(v) {
    if (!v || v.dataset.glcBound === "1") return;
    v.dataset.glcBound = "1";
    const reapply = () => applyRate(true);
    v.addEventListener("timeupdate", onVideoTick);
    v.addEventListener("ratechange", reapply);
    v.addEventListener("loadedmetadata", reapply);
    v.addEventListener("canplay", reapply);
    v.addEventListener("playing", reapply);
    v.addEventListener("emptied", () => {
      delete v.dataset.glcBound;
      setTimeout(refreshVideoContext, 200);
    });
    applyRate(true);
  }

  function bindAllVideos() {
    for (const v of collectVideosDeep(document)) {
      bindVideoEvents(v);
    }
  }

  function refreshVideoContext() {
    const id = getVideoId();
    if (id !== state.videoId) {
      state.videoId = id;
      state.markers = id ? loadMarkers(id) : [];
      state.rate = id ? loadRate(id) : 1;
      state.pointA = null;
      state.pointB = null;
      state.abEnabled = false;
      state.rateDriftCount = 0;
      activeVideo = null;
      document.querySelectorAll("video[data-glc-bound]").forEach((el) => {
        delete el.dataset.glcBound;
      });
    }
    bindAllVideos();
    renderMarkers();
    updateUi();
  }

  function scheduleRefresh() {
    if (moTimer) clearTimeout(moTimer);
    moTimer = setTimeout(() => {
      moTimer = null;
      refreshVideoContext();
    }, MO_OBS_DEBOUNCE_MS);
  }

  function getFullscreenElement() {
    return (
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      null
    );
  }

  function syncBarHost() {
    const host = getFullscreenElement() || document.body;
    if (ui && ui.root.parentNode !== host) {
      host.appendChild(ui.root);
    }
    if (markerDialogEl && markerDialogEl.parentNode !== host) {
      host.appendChild(markerDialogEl);
    }
  }

  function closeMarkerDialog(result) {
    if (!markerDialogEl) return;
    markerDialogEl.style.display = "none";
    const resolve = markerDialogResolve;
    markerDialogResolve = null;
    if (resolve) resolve(result);
  }

  function ensureMarkerDialog() {
    if (markerDialogEl) return markerDialogEl;
    const backdrop = document.createElement("div");
    backdrop.id = "glc-speed-player-dialog";
    backdrop.innerHTML =
      '<div class="glc-sp-dialog" role="dialog" aria-modal="true">' +
      '<div class="glc-sp-dialog-head">' +
      '<span class="glc-sp-dialog-title"></span>' +
      '<span class="glc-sp-dialog-time"></span>' +
      "</div>" +
      '<label class="glc-sp-dialog-label">标记名称</label>' +
      '<input type="text" class="glc-sp-dialog-input" maxlength="48" autocomplete="off" spellcheck="false" />' +
      '<div class="glc-sp-dialog-shortcuts"></div>' +
      '<div class="glc-sp-dialog-actions">' +
      '<button type="button" class="glc-sp-dialog-btn glc-sp-dialog-cancel">取消</button>' +
      '<button type="button" class="glc-sp-dialog-btn glc-sp-dialog-ok">确定</button>' +
      "</div>" +
      "</div>";

    backdrop.style.display = "none";
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeMarkerDialog(null);
    });

    const panel = backdrop.querySelector(".glc-sp-dialog");
    panel.addEventListener("click", (e) => e.stopPropagation());

    const input = backdrop.querySelector(".glc-sp-dialog-input");
    const btnOk = backdrop.querySelector(".glc-sp-dialog-ok");
    const btnCancel = backdrop.querySelector(".glc-sp-dialog-cancel");

    function submit() {
      const val = input.value.trim();
      if (!val) {
        input.focus();
        input.classList.add("glc-sp-dialog-input-error");
        return;
      }
      closeMarkerDialog(val);
    }

    btnOk.addEventListener("click", submit);
    btnCancel.addEventListener("click", () => closeMarkerDialog(null));
    input.addEventListener("input", () => input.classList.remove("glc-sp-dialog-input-error"));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        submit();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeMarkerDialog(null);
      }
    });

    document.body.appendChild(backdrop);
    markerDialogEl = backdrop;
    syncBarHost();
    return backdrop;
  }

  function renderShortcutHints(container, hints) {
    container.innerHTML = hints
      .map(
        (h) =>
          '<span class="glc-sp-dialog-hint-row">' +
          '<kbd class="glc-sp-kbd">' +
          escapeHtml(h.key) +
          "</kbd>" +
          '<span class="glc-sp-dialog-hint-text">' +
          escapeHtml(h.text) +
          "</span></span>",
      )
      .join("");
  }

  function showMarkerNameDialog(opts) {
    return new Promise((resolve) => {
      if (markerDialogResolve) closeMarkerDialog(null);
      ensureMarkerDialog();
      markerDialogResolve = resolve;

      const backdrop = markerDialogEl;
      const titleEl = backdrop.querySelector(".glc-sp-dialog-title");
      const timeEl = backdrop.querySelector(".glc-sp-dialog-time");
      const input = backdrop.querySelector(".glc-sp-dialog-input");
      const hintsEl = backdrop.querySelector(".glc-sp-dialog-shortcuts");

      titleEl.textContent = opts.title || "标记";
      timeEl.textContent = Number.isFinite(opts.time) ? formatTime(opts.time) : "";
      timeEl.style.display = Number.isFinite(opts.time) ? "inline" : "none";
      input.value = opts.defaultValue || "";
      input.classList.remove("glc-sp-dialog-input-error");

      const hints = [];
      if (opts.triggerShortcut) {
        hints.push({ key: opts.triggerShortcut, text: "打标记" });
      }
      if (opts.jumpShortcut) {
        hints.push({ key: opts.jumpShortcut, text: "跳转到此标记" });
      }
      if (opts.mode === "rename") {
        hints.push({ key: "双击", text: "标记列表中重命名" });
      }
      hints.push({ key: "Enter", text: "确定" });
      hints.push({ key: "Esc", text: "取消" });
      renderShortcutHints(hintsEl, hints);

      syncBarHost();
      backdrop.style.display = "flex";
      requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
    });
  }

  function isMarkerDialogOpen() {
    return markerDialogEl && markerDialogEl.style.display !== "none";
  }

  function ensureUi() {
    if (ui) return ui;
    const root = document.createElement("div");
    root.id = "glc-speed-player-bar";
    root.innerHTML =
      '<div class="glc-sp-inner">' +
      '<button type="button" class="glc-sp-toggle" title="收起/展开 Esc">▼</button>' +
      '<label class="glc-sp-rate-wrap">' +
      '<span class="glc-sp-label">倍速</span>' +
      '<input type="range" class="glc-sp-slider" min="' +
      RATE_MIN +
      '" max="' +
      RATE_MAX +
      '" step="' +
      RATE_STEP +
      '" />' +
      '<span class="glc-sp-rate-val">1.00×</span>' +
      '<span class="glc-sp-drift" title="播放器曾重置倍速，已自动写回"></span>' +
      '<button type="button" class="glc-sp-btn" data-act="rate-dec" title="减速 [">−</button>' +
      '<button type="button" class="glc-sp-btn" data-act="rate-inc" title="加速 ]">+</button>' +
      "</label>" +
      '<span class="glc-sp-sep"></span>' +
      '<button type="button" class="glc-sp-btn" data-act="set-a" title="A 点（循环起点）Shift+A">A</button>' +
      '<button type="button" class="glc-sp-btn" data-act="set-b" title="B 点（循环终点）Shift+B">B</button>' +
      '<button type="button" class="glc-sp-btn" data-act="toggle-ab" title="AB 循环开/关 Shift+L">AB</button>' +
      '<button type="button" class="glc-sp-btn" data-act="clear-ab" title="清除 AB">清AB</button>' +
      '<button type="button" class="glc-sp-btn" data-act="add-marker" title="打标记 M，1-9 跳转">标记</button>' +
      '<div class="glc-sp-markers"></div>' +
      "</div>";

    const style = document.createElement("style");
    style.textContent =
      "#glc-speed-player-bar{position:fixed;left:0;right:0;bottom:0;z-index:2147483646;font-family:system-ui,sans-serif;font-size:12px;pointer-events:auto}" +
      "#glc-speed-player-bar *{box-sizing:border-box}" +
      ".glc-sp-inner{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 12px;background:rgba(12,12,14,.92);border-top:1px solid rgba(255,255,255,.12);color:#e4e4e7;backdrop-filter:blur(8px)}" +
      ".glc-sp-inner.collapsed{padding:4px 12px}" +
      ".glc-sp-inner.collapsed .glc-sp-rate-wrap,.glc-sp-inner.collapsed .glc-sp-sep,.glc-sp-inner.collapsed .glc-sp-btn:not(.glc-sp-toggle),.glc-sp-inner.collapsed .glc-sp-markers{display:none}" +
      ".glc-sp-toggle{background:transparent;border:none;color:#a1a1aa;cursor:pointer;padding:2px 6px}" +
      ".glc-sp-label{color:#a1a1aa;margin-right:4px}" +
      ".glc-sp-slider{width:120px;accent-color:#f59e0b}" +
      ".glc-sp-rate-val{min-width:44px;color:#fbbf24;font-variant-numeric:tabular-nums}" +
      ".glc-sp-drift{color:#f87171;font-size:11px;min-width:0;max-width:72px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".glc-sp-btn{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);color:#e4e4e7;border-radius:6px;padding:4px 8px;cursor:pointer}" +
      ".glc-sp-btn:hover{background:rgba(255,255,255,.14)}" +
      ".glc-sp-btn.active{background:rgba(245,158,11,.25);border-color:rgba(245,158,11,.5);color:#fbbf24}" +
      ".glc-sp-sep{width:1px;height:20px;background:rgba(255,255,255,.15)}" +
      ".glc-sp-markers{display:flex;flex-wrap:wrap;gap:4px;max-width:min(480px,50vw)}" +
      ".glc-sp-marker{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:6px;padding:2px 6px;cursor:pointer;color:#d4d4d8;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".glc-sp-marker:hover{border-color:rgba(245,158,11,.4)}" +
      ".glc-sp-marker-del{margin-left:4px;color:#71717a;cursor:pointer}" +
      ".glc-sp-rate-wrap{display:flex;align-items:center;gap:4px}" +
      "#glc-speed-player-dialog{position:fixed;inset:0;z-index:2147483647;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);font-family:system-ui,sans-serif;pointer-events:auto}" +
      "#glc-speed-player-dialog *{box-sizing:border-box}" +
      ".glc-sp-dialog{width:min(360px,calc(100vw - 32px));padding:18px 20px 16px;border-radius:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(165deg,rgba(24,24,28,.98),rgba(12,12,14,.98));color:#e4e4e7;box-shadow:0 24px 48px rgba(0,0,0,.45)}" +
      ".glc-sp-dialog-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:14px}" +
      ".glc-sp-dialog-title{font-size:15px;font-weight:600;color:#fafafa}" +
      ".glc-sp-dialog-time{font-size:12px;color:#fbbf24;font-variant-numeric:tabular-nums;white-space:nowrap}" +
      ".glc-sp-dialog-label{display:block;margin-bottom:8px;font-size:12px;color:#a1a1aa}" +
      ".glc-sp-dialog-input{width:100%;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.35);color:#fafafa;font-size:14px;outline:none;transition:border-color .15s,box-shadow .15s}" +
      ".glc-sp-dialog-input:focus{border-color:rgba(245,158,11,.55);box-shadow:0 0 0 3px rgba(245,158,11,.18)}" +
      ".glc-sp-dialog-input-error{border-color:#f87171!important;box-shadow:0 0 0 3px rgba(248,113,113,.2)!important}" +
      ".glc-sp-dialog-shortcuts{display:flex;flex-wrap:wrap;gap:8px 14px;margin:14px 0 16px;padding:10px 12px;border-radius:8px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06)}" +
      ".glc-sp-dialog-hint-row{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#a1a1aa}" +
      ".glc-sp-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:22px;padding:2px 7px;border-radius:5px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);color:#fbbf24;font-size:11px;font-family:inherit;line-height:1.4}" +
      ".glc-sp-dialog-hint-text{color:#d4d4d8}" +
      ".glc-sp-dialog-actions{display:flex;justify-content:flex-end;gap:8px}" +
      ".glc-sp-dialog-btn{padding:8px 16px;border-radius:8px;font-size:13px;cursor:pointer;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#e4e4e7;transition:background .15s,border-color .15s}" +
      ".glc-sp-dialog-btn:hover{background:rgba(255,255,255,.12)}" +
      ".glc-sp-dialog-ok{border-color:rgba(245,158,11,.45);background:rgba(245,158,11,.22);color:#fde68a;font-weight:500}" +
      ".glc-sp-dialog-ok:hover{background:rgba(245,158,11,.32)}";

    document.documentElement.appendChild(style);
    document.body.appendChild(root);

    const inner = root.querySelector(".glc-sp-inner");
    const slider = root.querySelector(".glc-sp-slider");
    const toggle = root.querySelector(".glc-sp-toggle");

    slider.addEventListener("input", () => {
      state.rate = clampRate(parseFloat(slider.value));
      applyRate(true);
      saveRate();
      updateUi();
    });

    toggle.addEventListener("click", () => {
      state.collapsed = !state.collapsed;
      updateUi();
    });

    root.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const act = btn.getAttribute("data-act");
      if (act === "rate-dec") nudgeRate(-RATE_STEP);
      if (act === "rate-inc") nudgeRate(RATE_STEP);
      if (act === "set-a") setPointA();
      if (act === "set-b") setPointB();
      if (act === "toggle-ab") toggleAb();
      if (act === "clear-ab") clearAb();
      if (act === "add-marker") addMarker();
    });

    root.querySelector(".glc-sp-markers").addEventListener("click", (e) => {
      const del = e.target.closest("[data-del]");
      if (del) {
        const idx = parseInt(del.getAttribute("data-del"), 10);
        if (!Number.isNaN(idx)) removeMarker(idx);
        return;
      }
      const item = e.target.closest("[data-jump]");
      if (item) {
        const idx = parseInt(item.getAttribute("data-jump"), 10);
        if (!Number.isNaN(idx)) jumpMarker(idx);
      }
    });

    root.querySelector(".glc-sp-markers").addEventListener("dblclick", (e) => {
      const item = e.target.closest("[data-jump]");
      if (!item) return;
      const idx = parseInt(item.getAttribute("data-jump"), 10);
      if (!Number.isNaN(idx)) renameMarker(idx);
    });

    ui = { root, inner, slider, toggle };
    syncBarHost();
    return ui;
  }

  function updateUi() {
    ensureUi();
    const v = findVideo();
    ui.slider.value = String(state.rate);
    const actual = v ? v.playbackRate : state.rate;
    const driftNow = v && Math.abs(actual - state.rate) > 0.02;
    ui.root.querySelector(".glc-sp-rate-val").textContent = state.rate.toFixed(2) + "×";
    const driftEl = ui.root.querySelector(".glc-sp-drift");
    if (driftNow) {
      driftEl.textContent = "↻写回";
      driftEl.style.display = "inline";
    } else if (state.rateDriftCount > 0) {
      driftEl.textContent = "已纠正×" + state.rateDriftCount;
      driftEl.style.display = "inline";
    } else {
      driftEl.textContent = "";
      driftEl.style.display = "none";
    }
    ui.inner.classList.toggle("collapsed", state.collapsed);
    ui.toggle.textContent = state.collapsed ? "▲" : "▼";
    ui.root.querySelector('[data-act="toggle-ab"]').classList.toggle("active", state.abEnabled);
    const hasVideo = !!v && !!state.videoId;
    ui.root.style.display = hasVideo ? "block" : "none";
  }

  function renderMarkers() {
    ensureUi();
    const box = ui.root.querySelector(".glc-sp-markers");
    box.innerHTML = state.markers
      .map(
        (m, i) =>
          '<span class="glc-sp-marker" data-jump="' +
          i +
          '" title="跳转 ' +
          (i + 1) +
          "，双击重命名\">" +
          (i + 1) +
          ". " +
          escapeHtml(m.label) +
          " " +
          formatTime(m.time) +
          '<span class="glc-sp-marker-del" data-del="' +
          i +
          '" title="删除">×</span></span>',
      )
      .join("");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function nudgeRate(delta) {
    state.rate = clampRate(state.rate + delta);
    applyRate(true);
    saveRate();
    updateUi();
  }

  function setPointA() {
    const v = findVideo();
    if (!v) return;
    state.pointA = v.currentTime;
    updateUi();
  }

  function setPointB() {
    const v = findVideo();
    if (!v) return;
    state.pointB = v.currentTime;
    updateUi();
  }

  function toggleAb() {
    state.abEnabled = !state.abEnabled;
    updateUi();
  }

  function clearAb() {
    state.abEnabled = false;
    state.pointA = null;
    state.pointB = null;
    updateUi();
  }

  function addMarker() {
    const v = findVideo();
    if (!v || !state.videoId || isMarkerDialogOpen()) return;
    const nextIdx = state.markers.length;
    const defaultName = "标记 " + (nextIdx + 1);
    const capturedTime = v.currentTime;
    void showMarkerNameDialog({
      title: "添加标记",
      defaultValue: defaultName,
      time: capturedTime,
      mode: "add",
      triggerShortcut: "M",
      jumpShortcut: nextIdx < 9 ? String(nextIdx + 1) : null,
    }).then((name) => {
      if (!name) return;
      state.markers.push({ time: capturedTime, label: name });
      saveMarkers();
      renderMarkers();
      updateUi();
    });
  }

  function removeMarker(idx) {
    state.markers.splice(idx, 1);
    saveMarkers();
    renderMarkers();
  }

  function jumpMarker(idx) {
    const m = state.markers[idx];
    const v = findVideo();
    if (!m || !v) return;
    v.currentTime = m.time;
    void v.play().catch(() => {});
  }

  function renameMarker(idx) {
    const m = state.markers[idx];
    if (!m || isMarkerDialogOpen()) return;
    void showMarkerNameDialog({
      title: "重命名标记",
      defaultValue: m.label,
      time: m.time,
      mode: "rename",
      jumpShortcut: idx < 9 ? String(idx + 1) : null,
    }).then((name) => {
      if (!name) return;
      m.label = name;
      saveMarkers();
      renderMarkers();
    });
  }

  function onKeydown(e) {
    if (isMarkerDialogOpen()) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeMarkerDialog(null);
      }
      return;
    }
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
    if (!findVideo() || !state.videoId) return;

    if (e.key === "[" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      nudgeRate(-RATE_STEP);
      return;
    }
    if (e.key === "]" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      nudgeRate(RATE_STEP);
      return;
    }
    if (e.shiftKey && (e.key === "A" || e.key === "a")) {
      e.preventDefault();
      e.stopPropagation();
      setPointA();
      return;
    }
    if (e.shiftKey && (e.key === "B" || e.key === "b")) {
      e.preventDefault();
      e.stopPropagation();
      setPointB();
      return;
    }
    if (e.shiftKey && (e.key === "L" || e.key === "l")) {
      e.preventDefault();
      e.stopPropagation();
      toggleAb();
      return;
    }
    if ((e.key === "m" || e.key === "M") && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      addMarker();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      state.collapsed = !state.collapsed;
      updateUi();
      return;
    }
    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= 9 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      jumpMarker(num - 1);
    }
  }

  function tick() {
    if (location.href !== lastHref) {
      lastHref = location.href;
      saveLastHref();
      refreshVideoContext();
    }
    syncBarHost();
    bindAllVideos();
    applyRate(false);
    updateUi();
  }

  function getDiagnostics() {
    const v = findVideo();
    const actual = v ? v.playbackRate : null;
    return {
      videoId: state.videoId,
      targetRate: state.rate,
      actualRate: actual,
      hasVideo: !!v,
      drift: v != null && Math.abs((actual || 0) - state.rate) > 0.02,
      rateCorrections: state.rateDriftCount,
      href: location.href,
      injected: true,
    };
  }

  window.__GLC_SPEED_PLAYER__ = {
    setRate(r) {
      state.rate = clampRate(r);
      applyRate(true);
      saveRate();
      updateUi();
    },
    nudgeRate(d) {
      nudgeRate(d);
    },
    setPointA,
    setPointB,
    toggleAb,
    clearAb,
    addMarker,
    jumpMarker,
    renameMarker,
    getState() {
      return { ...state };
    },
    getDiagnostics,
    refresh: refreshVideoContext,
  };

  ensureUi();
  document.addEventListener("keydown", onKeydown, true);
  window.addEventListener("keydown", onKeydown, true);
  document.addEventListener("fullscreenchange", syncBarHost);
  document.addEventListener("webkitfullscreenchange", syncBarHost);
  setInterval(tick, TICK_MS);
  const obs = new MutationObserver(() => scheduleRefresh());
  obs.observe(document.documentElement, { childList: true, subtree: true });
  saveLastHref();
  tryRestoreLastHref();
  refreshVideoContext();
})();
