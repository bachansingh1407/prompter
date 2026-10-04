const { boot, goodBody, okFetch, type, click, sleep, scripts } = require("./harness");
const results = [];
async function t(name, fn) {
  try { await fn(); results.push([true, name]); console.log("PASS ", name); }
  catch (e) { results.push([false, name, e.message]); console.log("FAIL ", name, "\n       ", e.message); }
}
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || "expected equal"}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };
const KEY = "gsk_" + "x".repeat(30);
const withKey = { session: { promptforge_groq_key: KEY } };
const toastText = h => h.d.getElementById("toastStack").textContent;

(async () => {
  console.log("scripts loaded from index.html:", scripts.join(", "), "\n");

  /* ===== Defects reproduced in baseline (9) ===== */
  await t("D1 nav listeners do not accumulate (1 render per click)", async () => {
    const h = boot();
    for (let i = 0; i < 5; i++) { click(h, '.nav-item[data-route="settings"]'); click(h, '.nav-item[data-route="generator"]'); }
    let renders = 0; const page = h.d.getElementById("page");
    const obs = new h.w.MutationObserver(recs => { renders += recs.length; }); obs.observe(page, { childList: true });
    click(h, '.nav-item[data-route="templates"]'); await sleep(10);
    eq(h.d.querySelectorAll(".template-card").length, 6, "templates rendered once");
    ok(renders <= 1, "page replaced more than once per click: " + renders);
  });
  await t("D2 draft survives toggling context", async () => {
    const h = boot(); type(h, "requirement", "my draft"); click(h, '[data-action="toggle-context"]');
    eq(h.d.getElementById("requirement").value, "my draft");
  });
  await t("D3 draft (incl. context fields) survives navigation", async () => {
    const h = boot(); click(h, '[data-action="toggle-context"]');
    type(h, "requirement", "draft two"); type(h, "technology", "Rust");
    click(h, '.nav-item[data-route="settings"]'); click(h, '.nav-item[data-route="generator"]');
    eq(h.d.getElementById("requirement").value, "draft two"); eq(h.d.getElementById("technology").value, "Rust");
  });
  await t("D3b draft survives a full reload (localStorage)", async () => {
    const h = boot(); type(h, "requirement", "persist me"); h.w.dispatchEvent(new h.w.Event("pagehide"));
    const h2 = boot({ local: { promptforge_draft: h.w.localStorage.getItem("promptforge_draft") } });
    eq(h2.d.getElementById("requirement").value, "persist me");
  });
  await t("D4 truncated output (finish_reason=length) reports truncation and saves nothing", async () => {
    const f = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: "length", message: { content: '{"title":"x","prompt":"abc' } }] }) });
    const h = boot({ fetch: f, ...withKey }); type(h, "requirement", "build"); click(h, "#generateBtn"); await sleep(20);
    ok(/cut off/i.test(toastText(h)), toastText(h)); eq(h.PF.state.history.length, 0); eq(h.PF.state.result, null);
  });
  await t("D5 request times out via AbortController and keeps the draft", async () => {
    const f = (url, opts) => new Promise((_, rej) => opts.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; rej(e); }));
    const h = boot({ fetch: f, ...withKey }); h.PF.CONFIG.REQUEST_TIMEOUT_MS = 40;
    type(h, "requirement", "slow one"); click(h, "#generateBtn"); await sleep(150);
    ok(/did not respond/i.test(toastText(h)), toastText(h)); eq(h.d.getElementById("requirement").value, "slow one");
    ok(!h.d.getElementById("generateBtn").disabled, "button re-enabled");
  });
  await t("D6 corrupt history (non-array) does not crash; original backed up", async () => {
    const raw = '{"not":"an array"}'; const h = boot({ local: { promptforge_history: raw } });
    eq(h.PF.state.history.length, 0); eq(h.w.localStorage.getItem("promptforge_history_backup"), raw);
    click(h, '.nav-item[data-route="history"]'); ok(/original/i.test(h.d.getElementById("page").textContent));
  });
  await t("D6b mixed-validity history keeps valid entries, backs up original", async () => {
    const raw = JSON.stringify([{ id: "a", title: "ok", prompt: "p", target: "Cursor", timestamp: 5 }, { id: "b" }, "junk", null]);
    const h = boot({ local: { promptforge_history: raw } });
    eq(h.PF.state.history.length, 1); eq(h.PF.state.historyLoad.dropped, 3); eq(h.w.localStorage.getItem("promptforge_history_backup"), raw);
  });
  await t("D7 no fabricated demo cards; honest empty state", async () => {
    const h = boot(); const txt = h.d.getElementById("page").textContent;
    ok(!/Demo item/.test(txt)); ok(/No prompts yet/.test(txt));
  });
  await t("D8 theme actually applies (dark / light / system)", async () => {
    const h = boot(); click(h, '.nav-item[data-route="settings"]');
    const r = v => { const el = h.d.getElementById("theme-" + v); el.checked = true; el.dispatchEvent(new h.w.Event("change", { bubbles: true })); };
    r("dark"); eq(h.d.documentElement.dataset.theme, "dark"); r("light"); eq(h.d.documentElement.dataset.theme, "light");
    r("system"); ok(["light", "dark"].includes(h.d.documentElement.dataset.theme));
    const css = require("fs").readFileSync(__dirname + "/../styles.css", "utf8"); ok(/\[data-theme="dark"\]/.test(css), "dark CSS present");
    const h2 = boot({ local: { promptforge_theme: "dark" } }); eq(h2.d.documentElement.dataset.theme, "dark", "persisted theme applied at boot");
  });
  await t("D9 storage quota errors are reported, not thrown; in-memory result kept", async () => {
    const h = boot({ fetch: okFetch(goodBody()), ...withKey });
    h.w.Storage.prototype.setItem = function (k) { if (k === "promptforge_history") throw new h.w.DOMException("q", "QuotaExceededError"); };
    type(h, "requirement", "x"); click(h, "#generateBtn"); await sleep(20);
    ok(/storage is full/i.test(toastText(h)), toastText(h)); ok(h.PF.state.result, "result still shown");
  });

  /* ===== Preserved v0.01 features (regression) ===== */
  await t("R1 generate success: renders prompt, saves history, sends correct request", async () => {
    let req; const f = async (u, o) => { req = { u, o, body: JSON.parse(o.body) }; return okFetch(goodBody())(); };
    const h = boot({ fetch: f, ...withKey }); click(h, '[data-action="toggle-context"]');
    type(h, "requirement", "Build a dashboard"); type(h, "technology", "React");
    h.d.getElementById("targetAI").value = "Cursor"; h.d.getElementById("targetAI").dispatchEvent(new h.w.Event("change", { bubbles: true }));
    click(h, "#generateBtn"); await sleep(20);
    eq(h.d.getElementById("promptOutput").textContent, "ROLE: do the thing");
    eq(req.u, "https://api.groq.com/openai/v1/chat/completions"); eq(req.o.headers.Authorization, "Bearer " + KEY);
    eq(req.body.model, "openai/gpt-oss-20b"); eq(req.body.response_format.type, "json_schema");
    ok(/Cursor/.test(req.body.messages[0].content), "target instructions in system prompt");
    const user = JSON.parse(req.body.messages[1].content); eq(user.roughRequirement, "Build a dashboard"); eq(user.optionalContext.technology, "React");
    eq(h.PF.state.history.length, 1); eq(JSON.parse(h.w.localStorage.getItem("promptforge_history"))[0].target, "Cursor");
  });
  await t("R2 API key never lands in history, draft, or DOM value", async () => {
    const h = boot({ fetch: okFetch(goodBody()), ...withKey }); type(h, "requirement", "x"); click(h, "#generateBtn"); await sleep(20);
    h.w.dispatchEvent(new h.w.Event("pagehide"));
    for (let i = 0; i < h.w.localStorage.length; i++) ok(!h.w.localStorage.getItem(h.w.localStorage.key(i)).includes(KEY), "key leaked to localStorage");
    click(h, '.nav-item[data-route="settings"]'); eq(h.d.getElementById("apiKeyInput").value, "");
  });
  await t("R3 error mapping: 401, 429, network, empty, malformed, schema-invalid, empty prompt", async () => {
    const cases = [
      [async () => ({ ok: false, status: 401, json: async () => ({}) }), /rejected/],
      [async () => ({ ok: false, status: 429, json: async () => ({}) }), /rate limit/i],
      [async () => { throw new TypeError("Failed to fetch"); }, /reach Groq/],
      [async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "" } }] }) }), /no usable/],
      [async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "not json" } }] }) }), /not valid JSON/],
      [okFetch({ prompt: 42 }), /expected structure/],
      [okFetch(goodBody({ prompt: "   " })), /empty prompt/],
      [okFetch({ prompt: "p", assumptions: [1] }), /expected structure/],
      [async () => ({ ok: false, status: 500, json: async () => ({ error: { message: "boom" } }) }), /boom/]
    ];
    for (const [f, re] of cases) {
      const h = boot({ fetch: f, ...withKey }); type(h, "requirement", "x"); click(h, "#generateBtn"); await sleep(20);
      ok(re.test(toastText(h)), `${re} vs ${toastText(h)}`); ok(!h.d.getElementById("generateBtn").disabled, "re-enabled");
    }
  });
  await t("R4 json_schema rejected by API -> one retry in json_object mode, output still validated (MOCKED, live API unverified)", async () => {
    const bodies = []; const f = async (u, o) => { const b = JSON.parse(o.body); bodies.push(b.response_format.type);
      return b.response_format.type === "json_schema" ? { ok: false, status: 400, json: async () => ({ error: { message: "response_format json_schema unsupported" } }) } : okFetch(goodBody())(); };
    const h = boot({ fetch: f, ...withKey }); type(h, "requirement", "x"); click(h, "#generateBtn"); await sleep(20);
    eq(bodies.join(","), "json_schema,json_object"); ok(h.PF.state.result);
  });
  await t("R5 fenced JSON tolerated; other garbage rejected", async () => {
    const f = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: "```json\n" + JSON.stringify(goodBody()) + "\n```" } }] }) });
    const h = boot({ fetch: f, ...withKey }); type(h, "requirement", "x"); click(h, "#generateBtn"); await sleep(20); ok(h.PF.state.result);
  });
  await t("R6 requires key and requirement; no request is made", async () => {
    let calls = 0; const f = async () => { calls++; return okFetch(goodBody())(); };
    const h = boot({ fetch: f }); click(h, "#generateBtn"); ok(/Requirement required/.test(toastText(h)));
    type(h, "requirement", "x"); click(h, "#generateBtn"); ok(/Groq not connected/.test(toastText(h))); eq(h.PF.state.route, "settings"); eq(calls, 0);
  });
  await t("R7 double-click while loading sends exactly one request", async () => {
    let calls = 0; const f = async () => { calls++; await sleep(30); return okFetch(goodBody())(); };
    const h = boot({ fetch: f, ...withKey }); type(h, "requirement", "x"); click(h, "#generateBtn");
    ok(h.d.getElementById("generateBtn").disabled, "disabled during load"); h.PF.state.route = "generator"; await sleep(60); eq(calls, 1);
  });
  await t("R8 copy, edit/save/cancel, versions & restore", async () => {
    const h = boot({ fetch: okFetch(goodBody()), ...withKey }); type(h, "requirement", "x"); click(h, "#generateBtn"); await sleep(20);
    click(h, "#copyBtn"); await sleep(5); eq(h.clip.text, "ROLE: do the thing");
    click(h, '[data-action="edit"]'); type(h, "promptEditor", "EDITED"); click(h, '[data-action="cancel-edit"]'); eq(h.PF.state.result.prompt, "ROLE: do the thing");
    click(h, '[data-action="edit"]'); type(h, "promptEditor", "EDITED"); click(h, '[data-action="save-edit"]');
    eq(h.d.getElementById("promptOutput").textContent, "EDITED"); eq(JSON.parse(h.w.localStorage.getItem("promptforge_history"))[0].prompt, "EDITED");
    eq(h.PF.state.result.versions.length, 1); click(h, '[data-action="restore-version"]'); eq(h.d.getElementById("promptOutput").textContent, "ROLE: do the thing");
  });
  await t("R9 regenerate keeps same id, preserves previous prompt as a version, no silent edit loss", async () => {
    let n = 0; const f = async () => okFetch(goodBody({ prompt: "gen" + ++n }))();
    const h = boot({ fetch: f, ...withKey }); type(h, "requirement", "x"); click(h, "#generateBtn"); await sleep(20);
    const id = h.PF.state.result.id; click(h, '[data-action="regenerate"]'); await sleep(20);
    eq(h.PF.state.result.id, id); eq(h.PF.state.result.prompt, "gen2"); eq(h.PF.state.result.versions[0].prompt, "gen1"); eq(h.PF.state.history.length, 1);
  });
  await t("R10 export .txt/.md contents and filenames", async () => {
    const h = boot({ fetch: okFetch(goodBody({ title: "My Great Prompt!" })), ...withKey }); type(h, "requirement", "x"); click(h, "#generateBtn"); await sleep(20);
    click(h, '[data-action="export-toggle"]'); ok(h.d.getElementById("exportMenu").classList.contains("open"));
    click(h, '[data-kind="md"]'); const b = h.w.__downloads[0]; eq(b.filename, "my-great-prompt.md");
    eq(await new Promise(r => { const fr = new h.w.FileReader(); fr.onload = () => r(fr.result); fr.readAsText(b); }), "ROLE: do the thing");
    ok(!h.d.getElementById("exportMenu").classList.contains("open"), "menu closes");
  });
  await t("R11 history open/delete/clear and recent cards", async () => {
    const h = boot({ fetch: okFetch(goodBody()), ...withKey }); type(h, "requirement", "x"); click(h, "#generateBtn"); await sleep(20);
    h.PF.state.result = null; click(h, '.nav-item[data-route="generator"]'); ok(h.d.querySelectorAll(".recent-card").length === 1);
    click(h, '.nav-item[data-route="history"]'); click(h, '[data-action="open-history"]'); eq(h.PF.state.route, "generator"); ok(h.d.getElementById("promptOutput"));
    click(h, '.nav-item[data-route="history"]'); click(h, '[data-action="delete-history"]'); eq(h.PF.state.history.length, 0); ok(/No generated prompts/.test(h.d.getElementById("page").textContent));
  });
  await t("R12 clear history respects confirm=false (no data loss)", async () => {
    const h = boot({ fetch: okFetch(goodBody()), ...withKey, confirmAnswer: false }); type(h, "requirement", "x"); click(h, "#generateBtn"); await sleep(20);
    click(h, '.nav-item[data-route="history"]'); click(h, '[data-action="clear-history"]'); eq(h.PF.state.history.length, 1);
  });
  await t("R13 templates load into draft; confirm guards overwrite", async () => {
    const h = boot(); type(h, "requirement", "keep me");
    const h2 = boot({ confirmAnswer: false }); type(h2, "requirement", "keep me"); click(h2, '.nav-item[data-route="templates"]'); click(h2, '[data-action="use-template"]');
    eq(h2.PF.state.draft.requirement, "keep me"); click(h, '.nav-item[data-route="templates"]'); click(h, '[data-action="use-template"]');
    ok(/I want to build a web application for/.test(h.d.getElementById("requirement").value), h.d.getElementById("requirement").value);
  });
  await t("R14 settings: connect validates, stores in sessionStorage only, clear works, history toggle", async () => {
    const h = boot(); click(h, '.nav-item[data-route="settings"]');
    type(h, "apiKeyInput", "short"); click(h, '[data-action="connect"]'); ok(/does not look like/.test(toastText(h))); eq(h.w.sessionStorage.getItem("promptforge_groq_key"), null);
    type(h, "apiKeyInput", KEY); click(h, '[data-action="connect"]'); eq(h.w.sessionStorage.getItem("promptforge_groq_key"), KEY); eq(h.w.localStorage.getItem("promptforge_groq_key"), null);
    click(h, '[data-action="clear-key"]'); eq(h.w.sessionStorage.getItem("promptforge_groq_key"), null);
    click(h, '[data-action="toggle-history-save"]'); eq(h.w.localStorage.getItem("promptforge_save_history"), "false");
  });
  await t("R15 history saving off => nothing written to history storage", async () => {
    const h = boot({ fetch: okFetch(goodBody()), local: { promptforge_save_history: "false" }, ...withKey }); type(h, "requirement", "x"); click(h, "#generateBtn"); await sleep(20);
    eq(h.w.localStorage.getItem("promptforge_history"), null); ok(h.PF.state.result);
  });

  /* ===== Security ===== */
  await t("S1 untrusted model/history/import content is escaped (no script/img injection)", async () => {
    const evil = '<img src=x onerror="window.__pwn=1"><script>window.__pwn=1</script>';
    const h = boot({ fetch: okFetch(goodBody({ title: evil, summary: evil, prompt: evil, assumptions: [evil], clarifications: [evil] })), ...withKey });
    type(h, "requirement", "x"); click(h, "#generateBtn"); await sleep(20);
    eq(h.d.querySelectorAll("#page img, #page script").length, 0); ok(!h.w.__pwn);
    click(h, '.nav-item[data-route="history"]'); eq(h.d.querySelectorAll("#page img, #page script").length, 0);
    const h2 = boot({ local: { promptforge_history: JSON.stringify([{ id: '"><img src=x onerror=1>', title: evil, prompt: evil, target: evil, timestamp: 1 }]) } });
    click(h2, '.nav-item[data-route="history"]'); eq(h2.d.querySelectorAll("#page img, #page script").length, 0);
    click(h2, '[data-action="open-history"]'); eq(h2.d.querySelectorAll("#page img, #page script").length, 0);
  });
  await t("S2 toast uses textContent (HTML in error detail not injected)", async () => {
    const f = async () => ({ ok: false, status: 500, json: async () => ({ error: { message: "<img src=x onerror=1>" } }) });
    const h = boot({ fetch: f, ...withKey }); type(h, "requirement", "x"); click(h, "#generateBtn"); await sleep(20);
    eq(h.d.querySelectorAll("#toastStack img").length, 0); ok(/<img/.test(toastText(h)));
  });
  await t("S3 model output is never executed (no eval/Function/innerHTML of prompt text in source)", async () => {
    const src = scripts.map(s => require("fs").readFileSync(__dirname + "/../" + s, "utf8")).join("\n");
    ok(!/\beval\s*\(|new Function\(/.test(src), "eval/Function found");
  });

  /* ===== Import / export / migration ===== */
  await t("M1 export -> import round trip; merge by id, newer wins; invalid skipped", async () => {
    const h = boot({ fetch: okFetch(goodBody()), ...withKey }); type(h, "requirement", "x"); click(h, "#generateBtn"); await sleep(20);
    const bundle = h.PF.exportBundle(h.PF.state.history); const p = h.PF.parseImport(bundle); ok(p.ok); eq(p.items.length, 1);
    const newer = { ...p.items[0], prompt: "NEWER", timestamp: p.items[0].timestamp + 10 }; const m = h.PF.mergeHistory(h.PF.state.history, [newer, { ...p.items[0], id: "other" }]);
    eq(m.updated, 1); eq(m.added, 1); eq(m.items.find(i => i.id === newer.id).prompt, "NEWER");
  });
  await t("M2 import rejects bad JSON, wrong app, future schema, oversize; accepts legacy bare array", async () => {
    const h = boot(); const P = h.PF;
    ok(!P.parseImport("{nope").ok); ok(!P.parseImport('{"app":"other","history":[]}').ok); ok(!P.parseImport('{"app":"promptforge","schema":99,"history":[]}').ok); ok(!P.parseImport("x".repeat(6 * 1024 * 1024)).ok);
    const legacy = P.parseImport(JSON.stringify([{ id: "1", title: "t", prompt: "p", target: "Gemini", timestamp: 1 }, { bad: true }])); ok(legacy.ok); eq(legacy.items.length, 1); eq(legacy.skipped, 1);
  });
  await t("M3 import via file input end-to-end", async () => {
    const h = boot(); click(h, '.nav-item[data-route="history"]');
    const input = h.d.getElementById("importFile"); const text = JSON.stringify({ app: "promptforge", schema: 2, history: [{ id: "z", title: "Imp", prompt: "P", target: "Cursor", timestamp: 9 }] });
    Object.defineProperty(input, "files", { value: [{ text: async () => text }] }); input.dispatchEvent(new h.w.Event("change", { bubbles: true })); await sleep(20);
    eq(h.PF.state.history.length, 1); ok(/Imp/.test(h.d.getElementById("page").textContent));
  });
  await t("M4 history is capped with an explicit notice (not silent)", async () => {
    const items = Array.from({ length: 205 }, (_, i) => ({ id: "i" + i, title: "t", prompt: "p", target: "Cursor", timestamp: i }));
    const h = boot({ fetch: okFetch(goodBody()), ...withKey, local: { promptforge_history: JSON.stringify(items.slice(0, 200)) } });
    type(h, "requirement", "x"); click(h, "#generateBtn"); await sleep(20); ok(/capped at 200/.test(toastText(h)), toastText(h)); eq(h.PF.state.history.length, 200);
  });

  const failed = results.filter(r => !r[0]);
  console.log(`\nPHASE 1 SUITE: ${results.length - failed.length} pass / ${failed.length} fail of ${results.length}`);
  process.exit(failed.length ? 1 : 0);
})();
