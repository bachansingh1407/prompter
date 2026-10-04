const { JSDOM } = require("jsdom");
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);

function boot({ fetch, local = {}, session = {}, confirmAnswer = true } = {}) {
  const dom = new JSDOM(html.replace(/<script src="[^"]+"><\/script>/g, ""), { runScripts: "outside-only", url: "http://localhost/", pretendToBeVisual: true });
  const w = dom.window;
  for (const [k, v] of Object.entries(local)) w.localStorage.setItem(k, v);
  for (const [k, v] of Object.entries(session)) w.sessionStorage.setItem(k, v);
  w.fetch = fetch || (async () => { throw new Error("offline"); });
  w.confirm = () => confirmAnswer;
  const clip = { text: null, writeText: async t => { clip.text = t; } };
  Object.defineProperty(w.navigator, "clipboard", { value: clip });
  w.__downloads = [];
  w.URL.createObjectURL = blob => { w.__downloads.push(blob); return "blob:test"; };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { w.__downloads[w.__downloads.length - 1].filename = this.download; };
  for (const s of scripts) w.eval(fs.readFileSync(path.join(root, s), "utf8"));
  return { w, d: w.document, PF: w.PF, clip };
}
const goodBody = (over = {}) => ({ title: "Dash", summary: "sum", assumptions: ["a1"], clarifications: ["q1"], prompt: "ROLE: do the thing", sections: [{ title: "t", content: "c" }], ...over });
const okFetch = (body, extra = {}) => async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(body) } }] }), ...extra });
const type = (h, id, value) => { const el = h.d.getElementById(id); el.value = value; el.dispatchEvent(new h.w.Event("input", { bubbles: true })); };
const click = (h, sel) => { const el = h.d.querySelector(sel); if (!el) throw new Error("missing " + sel); el.click(); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
module.exports = { boot, goodBody, okFetch, type, click, sleep, scripts };

/** Mock Groq: dispatch on json_schema name. handler = object | fn(body, n) | array (sequence; last repeats). {__raw} returns a raw response. */
module.exports.router = function router(handlers, log = []) {
  const counts = {};
  return async (url, opts) => {
    const body = JSON.parse(opts.body);
    const name = body.response_format.json_schema ? body.response_format.json_schema.name : "json_object:" + (body.messages[0].content.includes("requirements analyst") ? "promptforge_clarify" : "other");
    log.push({ name, body, user: body.messages[1].content, system: body.messages[0].content });
    const key = name.replace("json_object:", "");
    const n = (counts[key] = (counts[key] || 0) + 1) - 1;
    let h = handlers[key];
    if (Array.isArray(h)) h = h[Math.min(n, h.length - 1)];
    if (typeof h === "function") h = await h(body, n);
    if (h === undefined) return { ok: false, status: 500, json: async () => ({ error: { message: "no mock for " + key } }) };
    if (h && h.__raw) return h.__raw;
    return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(h) } }] }) };
  };
};
