/* PromptForge v0.02 — persistence layer. Never throws; reports failures; validates shapes; migrates. */
(function (root) {
  "use strict";
  const PF = (root.PF = root.PF || {});
  const { STORAGE, CONFIG, TARGETS } = PF.CONFIG ? { STORAGE: PF.STORAGE, CONFIG: PF.CONFIG, TARGETS: PF.TARGETS } : {};
  const isObj = v => v && typeof v === "object" && !Array.isArray(v);
  const str = (v, max = 100000) => (typeof v === "string" ? v.slice(0, max) : "");
  const strArr = v => (Array.isArray(v) ? v.filter(x => typeof x === "string").slice(0, 200) : []);

  const store = {
    getRaw(key, area = "local") {
      try { return root[area + "Storage"].getItem(key); } catch { return null; }
    },
    setRaw(key, value, area = "local") {
      try { root[area + "Storage"].setItem(key, value); return { ok: true }; }
      catch (error) { return { ok: false, error: error && error.name === "QuotaExceededError" ? "QUOTA" : "UNAVAILABLE" }; }
    },
    remove(key, area = "local") { try { root[area + "Storage"].removeItem(key); } catch { /* ignore */ } },
    getJSON(key, fallback) {
      const raw = store.getRaw(key);
      if (raw == null) return fallback;
      try { const v = JSON.parse(raw); return v == null ? fallback : v; } catch { return fallback; }
    },
    setJSON(key, value) { return store.setRaw(key, JSON.stringify(value)); }
  };
  PF.store = store;

  /** Normalise one stored/imported prompt record; returns null when unusable. */
  PF.normalizeItem = function normalizeItem(x) {
    if (!isObj(x) || typeof x.prompt !== "string" || !x.prompt.trim()) return null;
    const ts = Number.isFinite(Number(x.timestamp)) ? Number(x.timestamp) : Date.now();
    return {
      id: typeof x.id === "string" && x.id ? x.id.slice(0, 80) : PF.uid(),
      title: str(x.title, 300) || "Untitled prompt",
      summary: str(x.summary, 5000),
      assumptions: strArr(x.assumptions),
      clarifications: strArr(x.clarifications),
      sections: Array.isArray(x.sections) ? x.sections.filter(s => isObj(s) && typeof s.title === "string" && typeof s.content === "string").slice(0, 50) : [],
      prompt: str(x.prompt),
      target: str(x.target, 60) || "ChatGPT",
      timestamp: ts,
      roughRequirement: str(x.roughRequirement, CONFIG.MAX_REQUIREMENT * 2),
      optionalContext: isObj(x.optionalContext) ? Object.fromEntries(Object.entries(x.optionalContext).filter(([, v]) => typeof v === "string").slice(0, 20)) : {},
      qa: Array.isArray(x.qa) ? x.qa.filter(q => isObj(q) && typeof q.question === "string" && typeof q.answer === "string").slice(0, 60).map(q => ({ question: str(q.question, 500), answer: str(q.answer, 1000), field: str(q.field, 30) })) : [],
      specSnapshot: str(x.specSnapshot, 50000),
      uncertainty: strArr(x.uncertainty),
      structureCheck: isObj(x.structureCheck) && Array.isArray(x.structureCheck.present) ? { present: strArr(x.structureCheck.present), missing: strArr(x.structureCheck.missing), total: Number(x.structureCheck.total) || 12, minimumMissing: strArr(x.structureCheck.minimumMissing) } : null,
      critique: PF.normalizeCritique ? PF.normalizeCritique(x.critique) : null,
      versions: Array.isArray(x.versions)
        ? x.versions.filter(v => isObj(v) && typeof v.prompt === "string").slice(-CONFIG.VERSION_LIMIT)
            .map(v => ({ prompt: str(v.prompt), timestamp: Number(v.timestamp) || ts, label: str(v.label, 80) || "previous" }))
        : []
    };
  };

  /**
   * Load history, validate, and migrate from v0.01 (schema 1, no schema marker).
   * If anything is dropped, the untouched raw value is preserved in a backup key first.
   */
  PF.loadHistory = function loadHistory() {
    const raw = store.getRaw(STORAGE.history);
    if (raw == null) { store.setRaw(STORAGE.schema, String(CONFIG.SCHEMA_VERSION)); return { items: [], dropped: 0, backedUp: false, error: null }; }
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    const list = Array.isArray(parsed) ? parsed : null;
    if (!list) {
      store.setRaw(STORAGE.historyBackup, raw);
      return { items: [], dropped: 1, backedUp: true, error: "History data was not a list and could not be loaded; the original was kept as a backup." };
    }
    const seen = new Set();
    const items = [];
    for (const entry of list) {
      const n = PF.normalizeItem(entry);
      if (n && !seen.has(n.id)) { seen.add(n.id); items.push(n); }
    }
    const dropped = list.length - items.length;
    let backedUp = false;
    if (dropped > 0) backedUp = store.setRaw(STORAGE.historyBackup, raw).ok;
    store.setRaw(STORAGE.schema, String(CONFIG.SCHEMA_VERSION));
    return { items, dropped, backedUp, error: null };
  };

  /** Persist history. Returns { ok, trimmed, error }. Trimming is reported, never silent. */
  PF.saveHistory = function saveHistory(items) {
    let list = items;
    let trimmed = 0;
    if (list.length > CONFIG.HISTORY_LIMIT) { trimmed = list.length - CONFIG.HISTORY_LIMIT; list = list.slice(0, CONFIG.HISTORY_LIMIT); }
    const r = store.setJSON(STORAGE.history, list);
    return { ok: r.ok, trimmed, error: r.error || null, items: list };
  };

  PF.exportBundle = function exportBundle(items) {
    return JSON.stringify({ app: "promptforge", appVersion: CONFIG.APP_VERSION, schema: CONFIG.SCHEMA_VERSION, exportedAt: new Date().toISOString(), history: items }, null, 2);
  };

  /** Validate an import file. Accepts a bundle or a bare array. */
  PF.parseImport = function parseImport(text) {
    if (typeof text !== "string" || text.length > 5 * 1024 * 1024) return { ok: false, error: "File is empty or larger than 5 MB.", items: [], skipped: 0 };
    let data;
    try { data = JSON.parse(text); } catch { return { ok: false, error: "File is not valid JSON.", items: [], skipped: 0 }; }
    const list = Array.isArray(data) ? data : isObj(data) && data.app === "promptforge" && Array.isArray(data.history) ? data.history : null;
    if (!list) return { ok: false, error: "Not a PromptForge export (expected app: \"promptforge\" with a history list).", items: [], skipped: 0 };
    if (isObj(data) && Number(data.schema) > CONFIG.SCHEMA_VERSION) return { ok: false, error: `Export schema ${data.schema} is newer than this app supports (${CONFIG.SCHEMA_VERSION}).`, items: [], skipped: 0 };
    const items = list.map(PF.normalizeItem).filter(Boolean);
    return { ok: true, error: null, items, skipped: list.length - items.length };
  };

  /** Merge imported items into existing by id; the newer timestamp wins. */
  PF.mergeHistory = function mergeHistory(existing, incoming) {
    const map = new Map(existing.map(i => [i.id, i]));
    let added = 0, updated = 0;
    for (const item of incoming) {
      const cur = map.get(item.id);
      if (!cur) { map.set(item.id, item); added++; }
      else if (item.timestamp > cur.timestamp) { map.set(item.id, item); updated++; }
    }
    return { items: [...map.values()].sort((a, b) => b.timestamp - a.timestamp), added, updated };
  };

  PF.loadDraft = function loadDraft() {
    const d = store.getJSON(STORAGE.draft, null);
    const draft = { requirement: "", contextOpen: false };
    PF.CONTEXT_FIELDS.forEach(k => (draft[k] = ""));
    if (isObj(d)) {
      if (typeof d.requirement === "string") draft.requirement = d.requirement.slice(0, CONFIG.MAX_REQUIREMENT);
      if (typeof d.contextOpen === "boolean") draft.contextOpen = d.contextOpen;
      PF.CONTEXT_FIELDS.forEach(k => { if (typeof d[k] === "string") draft[k] = d[k].slice(0, 20000); });
    }
    return draft;
  };
  PF.saveDraft = draft => store.setJSON(STORAGE.draft, draft);
})(typeof window !== "undefined" ? window : globalThis);

(function (root) {
  "use strict";
  const PF = root.PF, { STORAGE } = PF, store = PF.store;
  /** Clarification session: validated on load; an unusable stored value is backed up, not silently discarded. */
  PF.loadClarify = function () {
    const raw = store.getRaw(STORAGE.clarify);
    if (raw == null) return null;
    let v = null; try { v = PF.CLARIFY.validateSession(JSON.parse(raw)); } catch { v = null; }
    if (!v) store.setRaw(STORAGE.clarify + "_backup", raw);
    return v;
  };
  PF.saveClarify = s => (s ? store.setJSON(STORAGE.clarify, s) : (store.remove(STORAGE.clarify), { ok: true }));
  PF.loadReview = function () {
    const d = store.getJSON(STORAGE.review, null);
    const out = { text: "", result: null };
    if (d && typeof d === "object") {
      if (typeof d.text === "string") out.text = d.text.slice(0, PF.REVIEW.MAX_INPUT);
      if (d.result) { try { out.result = { ...PF.validateReview(d.result, d.text), reviewedAt: Number(d.result.reviewedAt) || 0, specLength: Number(d.result.specLength) || 0 }; } catch { out.result = null; } }
    }
    return out;
  };
  PF.saveReview = r => store.setJSON(STORAGE.review, { text: r.text, result: r.result });
})(typeof window !== "undefined" ? window : globalThis);
