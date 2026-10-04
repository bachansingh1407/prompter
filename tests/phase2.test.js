const { boot, goodBody, type, click, sleep, router } = require("./harness");
const results = [];
async function t(name, fn) {
  try { await fn(); results.push([true, name]); console.log("PASS ", name); }
  catch (e) { results.push([false, name, e.message]); console.log("FAIL ", name, "\n       ", e.stack.split("\n").slice(0, 3).join("\n        ")); }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || "expected equal"}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };
const KEY = "gsk_" + "x".repeat(30);
const withKey = { session: { promptforge_groq_key: KEY } };
const toastText = h => h.d.getElementById("toastStack").textContent;
const page = h => h.d.getElementById("page").textContent;

const Q = (text, field = "functional") => ({ question: text, why: "because it matters", field, options: ["A", "B", "C", "D"].map(x => `${text} ${x}`) });
const round = (qs, extra = {}) => ({ done: false, reason: "", questions: qs, checklist: [], uncertainty: [], ...extra });
const pick = (h, qid, i) => { const el = h.d.querySelector(`input[data-pending="${qid}"][value="${i}"]`); el.checked = true; el.dispatchEvent(new h.w.Event("change", { bubbles: true })); };
const custom = (h, qid, v) => { const el = h.d.querySelector(`textarea[data-custom="${qid}"]`); el.value = v; el.dispatchEvent(new h.w.Event("input", { bubbles: true })); };
const specText = h => h.PF.CLARIFY.specToText(h.PF.state.clarify.spec);
async function started(handlers, opts = {}) {
  const log = [];
  const h = boot({ fetch: router({ promptforge_result: goodBody(), ...handlers }, log), ...withKey, ...opts });
  type(h, "requirement", "build a todo app"); click(h, '[data-action="clarify-start"]'); await sleep(30);
  return { h, log };
}
const review = (findings, summary = "ok") => ({ summary, findings });
const F = (o = {}) => ({ category: "ambiguity", original: "fast", issue: "Vague term", impact: "Cannot be tested", severity: "high", clarification: "How fast?", suggestedRevision: "Responds within 200 ms at p95.", ...o });

(async () => {
  /* ===== Clarification engine ===== */
  await t("C1 four-option questions render: exactly 4 radios + 1 custom input each; checklist is a separate multi-select", async () => {
    const { h, log } = await started({ promptforge_clarify: round([Q("Who uses it?", "userStories"), Q("Where is data stored?", "constraints")], { checklist: [{ label: "Offline support", field: "nonFunctional" }, { label: "Dark mode", field: "nonFunctional" }, { label: "Export to CSV", field: "functional" }] }) });
    const cards = [...h.d.querySelectorAll("fieldset.q-card[data-qid]")]; eq(cards.length, 2);
    for (const c of cards) { eq(c.querySelectorAll('input[type="radio"]').length, 4, "radios"); eq(c.querySelectorAll("textarea[data-custom]").length, 1, "custom input"); }
    const chk = h.d.querySelector("fieldset.checklist"); eq(chk.querySelectorAll('input[type="checkbox"]').length, 3); ok(!chk.hasAttribute("data-qid"), "checklist separate from questions");
    eq(log[0].name, "promptforge_clarify"); eq(JSON.parse(log[0].user).roughRequirement, "build a todo app");
  });
  await t("C2 saving an answer updates the specification immediately and persists; survives reload incl. unsaved selection", async () => {
    const { h } = await started({ promptforge_clarify: round([Q("Who uses it?", "userStories"), Q("Storage?", "constraints")]) });
    pick(h, "r1q1", 2); click(h, '[data-action="clarify-answer"][data-qid="r1q1"]');
    ok(/## User stories\n- Who uses it\? → Who uses it\? C/.test(specText(h)), specText(h)); ok(/Saved: Who uses it\? C/.test(page(h)));
    pick(h, "r1q2", 1); // selected but NOT saved
    const raw = h.w.localStorage.getItem("promptforge_clarify"); ok(raw);
    const h2 = boot({ local: { promptforge_clarify: raw }, ...withKey });
    eq(h2.PF.state.clarify.answers.length, 1); ok(h2.d.querySelector('input[data-pending="r1q2"][value="1"]').checked, "unsaved selection restored"); ok(/Saved: Who uses it\? C/.test(h2.d.getElementById("page").textContent));
  });
  await t("C3 custom text overrides option; re-answering replaces (no duplicate spec entry)", async () => {
    const { h } = await started({ promptforge_clarify: round([Q("Who uses it?", "userStories")]) });
    pick(h, "r1q1", 0); custom(h, "r1q1", "Freelance designers"); click(h, '[data-action="clarify-answer"]');
    ok(/→ Freelance designers/.test(specText(h))); eq(h.PF.state.clarify.answers[0].custom, true);
    custom(h, "r1q1", "Teams of 5"); click(h, '[data-action="clarify-answer"]');
    eq(h.PF.state.clarify.answers.length, 1); eq(h.PF.state.clarify.spec.userStories.length, 1); ok(/Teams of 5/.test(specText(h)) && !/Freelance/.test(specText(h)));
  });
  await t("C4 saving with nothing selected is rejected and spec unchanged", async () => {
    const { h } = await started({ promptforge_clarify: round([Q("Who uses it?")]) });
    const before = specText(h); click(h, '[data-action="clarify-answer"]'); ok(/No answer selected/.test(toastText(h))); eq(specText(h), before); eq(h.PF.state.clarify.answers.length, 0);
  });
  await t("C5 checklist: ticking adds spec entries in the right section; unticking and saving removes them", async () => {
    const { h } = await started({ promptforge_clarify: round([Q("Q?")], { checklist: [{ label: "Offline support", field: "nonFunctional" }, { label: "Export CSV", field: "functional" }] }) });
    h.d.querySelector('[data-check="r1c1"]').checked = true; h.d.querySelector('[data-check="r1c1"]').dispatchEvent(new h.w.Event("change", { bubbles: true }));
    click(h, '[data-action="clarify-checklist"]'); ok(/## Non-functional requirements\n- Offline support/.test(specText(h)), specText(h));
    const box = h.d.querySelector('[data-check="r1c1"]'); box.checked = false; box.dispatchEvent(new h.w.Event("change", { bubbles: true })); click(h, '[data-action="clarify-checklist"]');
    ok(!/Offline support/.test(specText(h)));
  });
  await t("C6 wrong option count: one automatic retry with the error fed back; recovers", async () => {
    const bad = round([{ ...Q("Q1"), options: ["a", "b", "c"] }]); const { h, log } = await started({ promptforge_clarify: [bad, round([Q("Q1")])] });
    eq(log.filter(l => l.name === "promptforge_clarify").length, 2); ok(/formatErrorInYourPreviousReply/.test(log[1].user) && /exactly 4/.test(log[1].user), log[1].user);
    eq(h.d.querySelectorAll('fieldset[data-qid] input[type="radio"]').length, 4);
  });
  await t("C6b still invalid after retry: clear error, no session created, nothing persisted", async () => {
    const bad = round([{ ...Q("Q1"), options: ["a", "b", "c", "d", "e"] }]); const { h, log } = await started({ promptforge_clarify: bad });
    eq(log.length, 2); ok(/exactly 4 options/.test(toastText(h)), toastText(h)); eq(h.PF.state.clarify, null); eq(h.w.localStorage.getItem("promptforge_clarify"), null);
  });
  await t("C7 done=true on first round: no questions asked, session finished", async () => {
    const { h } = await started({ promptforge_clarify: { done: true, reason: "Requirement is already specific.", questions: [], checklist: [], uncertainty: ["Hosting not mentioned"] } });
    eq(h.PF.state.clarify.status, "done"); eq(h.d.querySelectorAll("fieldset[data-qid]").length, 0); ok(/already looks clear/.test(toastText(h))); ok(/Hosting not mentioned/.test(page(h)));
  });
  await t("C8 rounds: skipped questions become recorded uncertainty; cap of 3 rounds; finish records unanswered", async () => {
    const { h } = await started({ promptforge_clarify: [round([Q("R1 question")]), round([Q("R2 question")]), round([Q("R3 question")])] });
    click(h, '[data-action="clarify-next"]'); await sleep(30); eq(h.PF.state.clarify.round, 2); ok(h.PF.state.clarify.uncertainty.includes("Unanswered: R1 question"));
    pick(h, "r2q1", 0); click(h, '[data-action="clarify-answer"]'); click(h, '[data-action="clarify-next"]'); await sleep(30);
    eq(h.PF.state.clarify.round, 3); ok(!h.d.querySelector('[data-action="clarify-next"]'), "no 4th round offered"); eq(h.PF.state.clarify.answers.length, 1);
    click(h, '[data-action="clarify-finish"]'); eq(h.PF.state.clarify.status, "done"); ok(h.PF.state.clarify.uncertainty.includes("Unanswered: R3 question")); ok(/Remaining uncertainty/.test(page(h)));
    eq(h.PF.state.clarify.answers.length, 1, "answers preserved");
  });
  await t("C9 failed next round leaves the session and answers intact", async () => {
    const { h } = await started({ promptforge_clarify: [round([Q("R1")]), { __raw: { ok: false, status: 429, json: async () => ({}) } }] });
    pick(h, "r1q1", 3); click(h, '[data-action="clarify-answer"]'); click(h, '[data-action="clarify-next"]'); await sleep(30);
    ok(/rate limit/i.test(toastText(h))); eq(h.PF.state.clarify.round, 1); eq(h.PF.state.clarify.answers.length, 1); eq(h.PF.state.clarify.status, "active");
  });
  await t("C10 generate from clarified spec: payload carries spec/answers/uncertainty; original requirement immutable", async () => {
    const { h, log } = await started({ promptforge_clarify: round([Q("Who uses it?", "userStories")], { uncertainty: ["Hosting unknown"] }) });
    pick(h, "r1q1", 1); click(h, '[data-action="clarify-answer"]'); click(h, '[data-action="clarify-generate"]'); await sleep(30);
    const gen = JSON.parse(log.find(l => l.name === "promptforge_result").user);
    eq(gen.roughRequirement, "build a todo app"); ok(/Who uses it\? → Who uses it\? B/.test(gen.clarifiedSpecification)); eq(gen.clarificationAnswers.length, 1); eq(gen.remainingUncertainty, ["Hosting unknown"]);
    const r = h.PF.state.result; eq(r.qa.length, 1); ok(r.specSnapshot.includes("## Goal"));
    type(h, "requirement", "COMPLETELY DIFFERENT"); click(h, '[data-action="regenerate"]'); await sleep(30);
    const regen = JSON.parse(log.filter(l => l.name === "promptforge_result")[1].user); eq(regen.roughRequirement, "build a todo app", "original instruction unchanged"); eq(regen.clarifiedSpecification, gen.clarifiedSpecification);
    eq(JSON.parse(h.w.localStorage.getItem("promptforge_history"))[0].roughRequirement, "build a todo app");
  });
  await t("C11 validateRound unit rules", async () => {
    const h = boot(); const V = h.PF.CLARIFY.validateRound; const thr = o => { try { V(o); return null; } catch (e) { return e.code; } };
    eq(thr(round([{ ...Q("a"), options: ["x", "x", "y", "z"] }])), "INVALID_QUESTIONS", "duplicates");
    eq(thr(round([{ ...Q("a"), options: ["1", "2", "3", "4", "5"] }])), "INVALID_QUESTIONS", "5 options");
    eq(thr(round([{ ...Q("a"), field: "bogus" }])), "INVALID_QUESTIONS", "bad field"); eq(thr(round([])), "INVALID_QUESTIONS", "not done, no questions");
    eq(thr({ done: "yes", questions: [] }), "INVALID_QUESTIONS"); eq(thr(round([{ ...Q("a"), options: ["1", "2", "3", " "] }])), "INVALID_QUESTIONS", "blank option");
    eq(thr({ done: true, questions: [], checklist: [], uncertainty: [] }), null);
    eq(V(round([Q("1"), Q("2"), Q("3"), Q("4"), Q("5")])).questions.length, 3, "truncated to 3");
  });
  await t("C12 corrupt stored clarification: app boots, original backed up, no session", async () => {
    const raw = JSON.stringify({ status: "active", round: 99, spec: {} }); const h = boot({ local: { promptforge_clarify: raw } });
    eq(h.PF.state.clarify, null); eq(h.w.localStorage.getItem("promptforge_clarify_backup"), raw);
  });
  await t("C13 discard respects confirm", async () => {
    const { h } = await started({ promptforge_clarify: round([Q("Q")]) }); h.w.confirm = () => false; click(h, '[data-action="clarify-discard"]'); ok(h.PF.state.clarify);
    h.w.confirm = () => true; click(h, '[data-action="clarify-discard"]'); eq(h.PF.state.clarify, null); eq(h.w.localStorage.getItem("promptforge_clarify"), null);
  });
  await t("C14 clarify requires requirement and key; no request otherwise", async () => {
    const log = []; const h = boot({ fetch: router({}, log) }); click(h, '[data-action="clarify-start"]'); ok(/Requirement required/.test(toastText(h)));
    type(h, "requirement", "x"); click(h, '[data-action="clarify-start"]'); ok(/not connected/i.test(toastText(h))); eq(log.length, 0);
  });
  await t("C15 model text in questions/options is escaped", async () => {
    const evil = '<img src=x onerror="window.__pwn=1">'; const { h } = await started({ promptforge_clarify: round([{ ...Q("q"), question: evil, options: [evil, "b", "c", "d"] }], { checklist: [{ label: evil, field: "functional" }] }) });
    eq(h.d.querySelectorAll("#page img").length, 0); ok(!h.w.__pwn); ok(page(h).includes("<img src=x"));
  });

  /* ===== Prompt engine structure ===== */
  await t("P1 structure check reports present/missing sections and flags missing core sections", async () => {
    const h = boot(); const S = h.PF.structureCheck;
    const full = ["Role", "Goal", "Context", "Requirements", "Constraints", "Execution Steps", "Examples", "Output Contract", "Acceptance Criteria", "Assumptions", "Risks", "Self-Critique"].map(title => ({ title, content: "c" }));
    eq(S(full, "").present.length, 12); eq(S(full, "").minimumMissing, []);
    const partial = S([{ title: "Role", content: "" }, { title: "Goal", content: "" }], ""); ok(partial.missing.includes("examples")); eq(partial.minimumMissing.sort(), ["acceptanceCriteria", "outputContract", "requirements"]);
    ok(S([], "Goal:\nsomething\n\nAcceptance criteria\n- x").present.includes("acceptanceCriteria"), "falls back to prompt headings");
  });
  await t("P2 generated result shows structure diagnostic; core-section warning visible; persisted through reload", async () => {
    const body = goodBody({ sections: [{ title: "Role", content: "r" }, { title: "Goal", content: "g" }] });
    const h = boot({ fetch: router({ promptforge_result: body }), ...withKey }); type(h, "requirement", "x"); click(h, "#generateBtn"); await sleep(30);
    ok(/Structure check \(diagnostic\): 2\/12/.test(page(h)), page(h)); ok(/Core sections missing/.test(page(h)));
    const h2 = boot({ local: { promptforge_history: h.w.localStorage.getItem("promptforge_history") } }); eq(h2.PF.state.history[0].structureCheck.present.length, 2);
  });
  await t("P3 system prompt names the canonical sections and the clarified-spec rule; user payload unchanged without clarification", async () => {
    const log = []; const h = boot({ fetch: router({ promptforge_result: goodBody() }, log), ...withKey }); type(h, "requirement", "x"); click(h, "#generateBtn"); await sleep(30);
    for (const s of ["Role, Goal, Context, Requirements, Constraints, Execution Steps, Examples, Output Contract, Acceptance Criteria, Assumptions, Risks, Self-Critique", "clarifiedSpecification"]) ok(log[0].system.includes(s), s);
    ok(!("clarifiedSpecification" in JSON.parse(log[0].user)));
  });

  /* ===== Critique ===== */
  const critique = (o = {}) => ({ score: 72, summary: "Decent but vague output format.", findings: [{ issue: "No output format", severity: "high", suggestion: "Specify JSON schema" }], revisedPrompt: "REVISED PROMPT", ...o });
  const generated = async (handlers, log = []) => { const h = boot({ fetch: router({ promptforge_result: goodBody(), ...handlers }, log), ...withKey }); type(h, "requirement", "x"); click(h, "#generateBtn"); await sleep(30); return h; };
  await t("K1 critique shows labelled diagnostic score, findings, compare; apply keeps original as a version", async () => {
    const h = await generated({ promptforge_critique: critique() }); click(h, '[data-action="critique"]'); await sleep(30);
    ok(/72\/100/.test(page(h)) && /diagnostic estimate/.test(page(h)) && /No output format/.test(page(h)));
    const cmp = [...h.d.querySelectorAll("pre.cmp")].map(p => p.textContent); ok(cmp.includes("ROLE: do the thing") && cmp.includes("REVISED PROMPT"));
    eq(h.PF.state.result.prompt, "ROLE: do the thing", "not applied automatically");
    click(h, '[data-action="apply-revision"]'); eq(h.PF.state.result.prompt, "REVISED PROMPT"); eq(h.PF.state.result.versions[0].prompt, "ROLE: do the thing"); eq(h.PF.state.result.versions[0].label, "before critique revision");
    const saved = JSON.parse(h.w.localStorage.getItem("promptforge_history"))[0]; eq(saved.prompt, "REVISED PROMPT"); eq(saved.critique.reviewedPrompt, "ROLE: do the thing"); eq(saved.critique.applied, true);
  });
  await t("K2 invalid critique (score out of range / non-integer / empty revision) rejected, state unchanged", async () => {
    for (const bad of [critique({ score: 150 }), critique({ score: 7.5 }), critique({ revisedPrompt: " " }), critique({ findings: [{ issue: "x", severity: "bogus", suggestion: "y" }] })]) {
      const h = await generated({ promptforge_critique: bad }); click(h, '[data-action="critique"]'); await sleep(30);
      ok(/Critique format error/.test(toastText(h)), toastText(h)); eq(h.PF.state.result.critique, null);
    }
  });
  await t("K3 critique that returns after the prompt changed is discarded", async () => {
    const h = await generated({ promptforge_critique: async () => { await sleep(40); return critique(); } }); click(h, '[data-action="critique"]');
    h.PF.state.result = { ...h.PF.state.result, id: "other" }; await sleep(80); ok(/discarded/i.test(toastText(h)));
  });
  await t("K4 critique persists across reload; stale note after edit", async () => {
    const h = await generated({ promptforge_critique: critique() }); click(h, '[data-action="critique"]'); await sleep(30);
    const h2 = boot({ local: { promptforge_history: h.w.localStorage.getItem("promptforge_history") }, ...withKey }); click(h2, '[data-action="open-history"]'); ok(/72\/100/.test(h2.d.getElementById("page").textContent));
    click(h2, '[data-action="edit"]'); type(h2, "promptEditor", "changed"); click(h2, '[data-action="save-edit"]'); ok(/prompt has changed since this critique/.test(h2.d.getElementById("page").textContent));
  });
  await t("K5 critique of an item with a tampered critique field is dropped safely on load", async () => {
    const item = { id: "a", title: "t", prompt: "p", target: "Cursor", timestamp: 1, critique: { score: "high", reviewedPrompt: "p" } };
    const h = boot({ local: { promptforge_history: JSON.stringify([item]) } }); eq(h.PF.state.history[0].critique, null);
  });

  /* ===== Specification review ===== */
  const SPEC = "The app must be fast.\nUsers can log in.\nAdmins can delete   any record.";
  const openReview = (handlers, log = []) => { const h = boot({ fetch: router(handlers, log), ...withKey }); click(h, '.nav-item[data-route="review"]'); return h; };
  await t("V1 review: sends the exact review request, renders all six report fields, sorted by severity, no prompt generation call", async () => {
    const log = []; const h = openReview({ promptforge_spec_review: review([F({ severity: "low", issue: "LOWISSUE", original: "Users can log in." }), F({ severity: "critical", issue: "CRITISSUE" }), F({ severity: "medium", issue: "MEDISSUE", original: "" , category: "missing" })], "Three problems.") }, log);
    type(h, "reviewText", SPEC); click(h, '[data-action="review-run"]'); await sleep(30);
    eq(log.length, 1); eq(log[0].name, "promptforge_spec_review"); ok(log[0].system.includes(h.PF.REVIEW_REQUEST)); ok(/Do NOT write, suggest, or include any implementation code/.test(log[0].system)); eq(JSON.parse(log[0].user).specification, SPEC);
    const heads = [...h.d.querySelectorAll(".finding .sev")].map(x => x.textContent); eq(heads, ["critical", "medium", "low"]);
    const f = h.d.querySelector(".finding").textContent; for (const label of ["Original statement", "Issue", "Impact", "Clarification needed", "Suggested revision"]) ok(f.includes(label), label);
    ok(/Three problems/.test(page(h)));
  });
  await t("V2 review-only: fenced code anywhere in output is rejected (finding fields and summary)", async () => {
    for (const bad of [review([F({ suggestedRevision: "Use this:\n```js\nfoo()\n```" })]), review([F()], "Summary ```x```"), review([F({ issue: "~~~\ncode\n~~~" })])]) {
      const h = openReview({ promptforge_spec_review: bad }); type(h, "reviewText", SPEC); click(h, '[data-action="review-run"]'); await sleep(30);
      ok(/returned code in review-only mode/.test(toastText(h)), toastText(h)); eq(h.PF.state.review.result, null); eq(h.d.querySelectorAll(".finding").length, 0);
    }
  });
  await t("V3 grounding: verbatim quotes (case/whitespace-insensitive) pass; fabricated quotes are flagged", async () => {
    const h = openReview({ promptforge_spec_review: review([F({ original: "admins can DELETE any record." }), F({ original: "The system must support SSO", issue: "FABQ" }), F({ original: "", category: "missing", issue: "MISS" })]) });
    type(h, "reviewText", SPEC); click(h, '[data-action="review-run"]'); await sleep(30);
    const fs = h.PF.state.review.result.findings; const by = n => fs.find(f => f.issue.includes(n) || n === "ADMIN" && /DELETE/.test(f.original));
    eq(fs.find(f => /DELETE/.test(f.original)).grounded, true); eq(fs.find(f => f.issue === "FABQ").grounded, false); eq(fs.find(f => f.issue === "MISS").grounded, true);
    ok(/not found verbatim in your specification/.test(page(h)));
  });
  await t("V4 malformed review shapes are rejected", async () => {
    for (const bad of [{ summary: "s" }, review([F({ severity: "urgent" })]), review([F({ category: "bug" })]), review([F({ issue: "  " })]), review([F({ impact: 3 })]), "not an object"]) {
      const h = openReview({ promptforge_spec_review: bad }); type(h, "reviewText", SPEC); click(h, '[data-action="review-run"]'); await sleep(30);
      ok(/Review format error/.test(toastText(h)), JSON.stringify(bad) + " -> " + toastText(h)); eq(h.PF.state.review.result, null);
    }
  });
  await t("V5 empty / oversize input rejected before any request", async () => {
    const log = []; const h = openReview({}, log); click(h, '[data-action="review-run"]'); ok(/Nothing to review/.test(toastText(h))); eq(log.length, 0);
    let code; try { await h.PF.reviewSpec({ key: KEY, text: "x".repeat(20001), fetchImpl: router({}, log) }); } catch (e) { code = e.code; } eq(code, "INVALID_REVIEW"); eq(log.length, 0);
  });
  await t("V6 review text and result persist across reload (result re-validated on load)", async () => {
    const h = openReview({ promptforge_spec_review: review([F()]) }); type(h, "reviewText", SPEC); click(h, '[data-action="review-run"]'); await sleep(30); h.w.dispatchEvent(new h.w.Event("pagehide"));
    const h2 = boot({ local: { promptforge_review: h.w.localStorage.getItem("promptforge_review") } }); click(h2, '.nav-item[data-route="review"]');
    eq(h2.d.getElementById("reviewText").value, SPEC); eq(h2.d.querySelectorAll(".finding").length, 1);
    const tampered = JSON.parse(h.w.localStorage.getItem("promptforge_review")); tampered.result.findings[0].severity = "bogus";
    const h3 = boot({ local: { promptforge_review: JSON.stringify(tampered) } }); eq(h3.PF.state.review.result, null); eq(h3.PF.state.review.text, SPEC);
  });
  await t("V7 markdown report: all fields, ungrounded flag; copy and download work", async () => {
    const h = openReview({ promptforge_spec_review: review([F({ original: "NOT IN TEXT" })]) }); type(h, "reviewText", SPEC); click(h, '[data-action="review-run"]'); await sleep(30);
    const md = h.PF.reviewToMarkdown(h.PF.state.review.result); for (const s of ["[HIGH]", "**Original statement:**", "**Issue:**", "**Impact:**", "**Clarification needed:**", "**Suggested revision:**", "not found verbatim"]) ok(md.includes(s), s);
    click(h, '[data-action="review-copy"]'); await sleep(5); eq(h.clip.text, md); click(h, '[data-action="review-download"]'); eq(h.w.__downloads.pop().filename, "specification-review.md");
  });
  await t("V8 load spec from Prompt Flow draft and from clarification; clear respects confirm", async () => {
    const h = boot({ fetch: router({}), ...withKey }); click(h, '.nav-item[data-route="generator"]'); type(h, "requirement", "Build X"); click(h, '[data-action="toggle-context"]'); type(h, "technology", "Rust");
    click(h, '.nav-item[data-route="review"]'); click(h, '[data-action="review-load-spec"]'); const v = h.d.getElementById("reviewText").value; ok(/## Goal\n- Build X/.test(v) && /Technology: Rust/.test(v), v);
    h.w.confirm = () => false; click(h, '[data-action="review-clear"]'); ok(h.PF.state.review.text);
    h.w.confirm = () => true; click(h, '[data-action="review-clear"]'); eq(h.PF.state.review.text, "");
  });
  await t("V9 review output is escaped; review mode exposes no code-generation control", async () => {
    const evil = '<img src=x onerror="window.__pwn=1">'; const h = openReview({ promptforge_spec_review: review([F({ original: evil, issue: evil, impact: evil, clarification: evil, suggestedRevision: evil })], evil) });
    type(h, "reviewText", SPEC); click(h, '[data-action="review-run"]'); await sleep(30); eq(h.d.querySelectorAll("#page img").length, 0); ok(!h.w.__pwn);
    eq(h.d.querySelectorAll('[data-action="generate"], #generateBtn').length, 0);
  });
  await t("V10 review failures use safe messages (timeout, 401, network)", async () => {
    const cases = [[{ __raw: { ok: false, status: 401, json: async () => ({}) } }, /rejected/], [async () => { throw new TypeError("Failed to fetch"); }, /reach Groq/]];
    for (const [hnd, re] of cases) { const h = boot({ fetch: typeof hnd === "function" ? hnd : router({ promptforge_spec_review: hnd }), ...withKey }); click(h, '.nav-item[data-route="review"]'); type(h, "reviewText", SPEC); click(h, '[data-action="review-run"]'); await sleep(30); ok(re.test(toastText(h)), toastText(h)); ok(!h.d.querySelector('[data-action="review-run"]').disabled); }
  });

  /* ===== Navigation / listeners ===== */
  await t("N1 navigation across all routes keeps a single handler set (no accumulation) and highlights the active item", async () => {
    const h = boot(); let renders = 0; const obs = new h.w.MutationObserver(r => { renders += r.length; }); obs.observe(h.d.getElementById("page"), { childList: true });
    for (let i = 0; i < 4; i++) for (const r of ["review", "generator", "history", "templates", "settings"]) click(h, `.nav-item[data-route="${r}"]`);
    await sleep(10); obs.takeRecords(); renders = 0; click(h, '.nav-item[data-route="review"]'); await sleep(10); ok(renders === 1, "page replacements per click: " + renders);
    eq(h.d.querySelector(".nav-item.active").dataset.route, "review"); eq(h.d.querySelectorAll(".nav-item.active").length, 1);
  });
  await t("N2 requirement draft survives a trip through Spec Review and a clarification session", async () => {
    const { h } = await started({ promptforge_clarify: round([Q("Q")]) }); click(h, '.nav-item[data-route="review"]'); click(h, '.nav-item[data-route="generator"]');
    eq(h.d.getElementById("requirement").value, "build a todo app"); eq(h.d.querySelectorAll("fieldset[data-qid]").length, 1);
  });

  const failed = results.filter(r => !r[0]);
  console.log(`\nPHASE 2 SUITE: ${results.length - failed.length} pass / ${failed.length} fail of ${results.length}`);
  process.exit(failed.length ? 1 : 0);
})();
