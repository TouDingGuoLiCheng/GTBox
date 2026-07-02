(function () {
  if (window.__GLC_NAV_FIX__) return;
  window.__GLC_NAV_FIX__ = true;

  function isBilibiliUrl(url) {
    try {
      const host = new URL(url, location.href).hostname.toLowerCase();
      return host === "b23.tv" || host === "bilibili.com" || host.endsWith(".bilibili.com");
    } catch {
      return false;
    }
  }

  function go(url) {
    try {
      location.assign(new URL(url, location.href).href);
    } catch {
      /* ignore */
    }
  }

  const rawOpen = window.open;
  window.open = function (url, target, features) {
    if (url && isBilibiliUrl(url)) {
      go(url);
      return window;
    }
    if (rawOpen) {
      try {
        return rawOpen.apply(window, arguments);
      } catch {
        return null;
      }
    }
    return null;
  };

  document.addEventListener(
    "click",
    function (e) {
      const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a) return;
      const target = (a.getAttribute("target") || "").toLowerCase();
      if (target !== "_blank" && target !== "blank") return;
      if (!isBilibiliUrl(a.href)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      go(a.href);
    },
    true,
  );
})();
