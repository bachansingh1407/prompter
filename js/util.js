/* PromptForge v0.02 — shared helpers (no DOM side effects). */
(function (root) {
  "use strict";
  const PF = (root.PF = root.PF || {});

  PF.esc = function esc(value = "") {
    return String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));
  };

  PF.uid = function uid() {
    const c = root.crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  };

  PF.slugify = function slugify(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "prompt";
  };

  PF.formatTime = function formatTime(ts) {
    const date = new Date(ts);
    if (isNaN(date)) return "Unknown date";
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (date.toDateString() === today.toDateString()) return `Today, ${time}`;
    if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
    return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  };

  PF.debounce = function debounce(fn, ms) {
    let t;
    const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    d.flush = (...a) => { clearTimeout(t); fn(...a); };
    return d;
  };
})(typeof window !== "undefined" ? window : globalThis);
