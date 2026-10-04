/* PromptForge v0.02 — clarification engine. Pure logic, no DOM.
 * The model proposes focused questions (exactly four options each) plus an optional separate checklist.
 * Answers are applied to the specification deterministically by this code, not by the model. */
(function (root) {
  "use strict";
  const PF = (root.PF = root.PF || {});
  const { PFError, CONTEXT_FIELDS } = PF;

  const C = (PF.CLARIFY = { MAX_ROUNDS: 3, MAX_QUESTIONS: 3, MAX_CHECKLIST: 8 });
  C.FIELDS = ["goal", "context", "userStories", "functional", "nonFunctional", "constraints", "acceptance", "definitionOfDone", "examples", "outputFormat"];
  C.LABELS = { goal: "Goal", context: "Context / existing system", userStories: "User stories", functional: "Functional requirements", nonFunctional: "Non-functional requirements", constraints: "Constraints", acceptance: "Acceptance criteria", definitionOfDone: "Definition of done", examples: "Examples", outputFormat: "Output format" };

  C.SCHEMA = {
    type: "object", additionalProperties: false,
    properties: {
      done: { type: "boolean" }, reason: { type: "string" },
      questions: { type: "array", items: { type: "object", additionalProperties: false,
        properties: { question: { type: "string" }, why: { type: "string" }, field: { type: "string", enum: C.FIELDS }, options: { type: "array", items: { type: "string" } } },
        required: ["question", "why", "field", "options"] } },
      checklist: { type: "array", items: { type: "object", additionalProperties: false, properties: { label: { type: "string" }, field: { type: "string", enum: C.FIELDS } }, required: ["label", "field"] } },
      uncertainty: { type: "array", items: { type: "string" } }
    },
    required: ["done", "reason", "questions", "checklist", "uncertainty"]
  };

  C.buildSystem = function () {
    return `You are a requirements analyst helping someone sharpen a rough software/AI task before a prompt is written.

Analyze the requirement and any specification so far for ambiguity, omissions, conflicts and unstated assumptions. Then:
- Ask at most ${C.MAX_QUESTIONS} focused questions. Each question must address one material ambiguity that is NOT already answered. Every question must have EXACTLY 4 distinct, concrete, mutually exclusive answer options (do not include an "other" option; the UI provides custom input). Set "field" to the specification section the answer belongs to.
- Optionally provide a separate checklist (max ${C.MAX_CHECKLIST} items) of independent considerations the user may tick (for example edge cases or non-functional needs). Do not duplicate the questions in the checklist.
- Set "done": true and return no questions when the specification is already clear enough to write a good prompt. Prefer stopping early over asking low-value questions.
- Put anything still unresolved in "uncertainty". Never invent facts about the user's project.

Return ONLY valid JSON matching the schema.`;
  };

  C.buildUser = function (session, draft, target) {
    return JSON.stringify({
      target, round: session.round + 1, maxRounds: C.MAX_ROUNDS,
      roughRequirement: draft.requirement, optionalContext: Object.fromEntries(CONTEXT_FIELDS.map(k => [k, draft[k] || ""]).filter(([, v]) => v)),
      specificationSoFar: C.specToText(session.spec),
      alreadyAnswered: session.answers.map(a => ({ question: a.question, answer: a.answer })),
      knownUncertainty: session.uncertainty
    }, null, 2);
  };

  /* ---------- specification model ---------- */
  C.emptySpec = () => Object.fromEntries(C.FIELDS.map(f => [f, []]));

  C.newSession = function (draft) {
    const spec = C.emptySpec();
    const add = (field, label, v) => { if (v && v.trim()) spec[field].push({ text: label ? `${label}: ${v.trim()}` : v.trim(), source: "draft:" + (label || "goal").toLowerCase().replace(/\W+/g, "-") }); };
    add("goal", "", draft.requirement);
    add("context", "Project type", draft.projectType); add("context", "Technology", draft.technology);
    add("context", "Existing system", draft.existingCode); add("context", "Notes", draft.additionalNotes);
    add("nonFunctional", "Design", draft.designRequirements); add("constraints", "", draft.constraints); add("outputFormat", "", draft.expectedOutput);
    return { id: PF.uid(), status: "active", round: 0, spec, questions: [], checklist: [], answers: [], checked: {}, checkPending: {}, pending: {}, uncertainty: [], reason: "", startedAt: Date.now() };
  };

  C.specToText = function (spec) {
    return C.FIELDS.filter(f => spec[f] && spec[f].length).map(f => `## ${C.LABELS[f]}\n${spec[f].map(e => `- ${e.text}`).join("\n")}`).join("\n\n");
  };

  const dropSource = (spec, source) => { for (const f of C.FIELDS) spec[f] = spec[f].filter(e => e.source !== source); };

  /** Record (or replace) the answer to one question and update the specification immediately. */
  C.applyAnswer = function (session, qid, answer, custom) {
    const q = session.questions.find(x => x.id === qid);
    const text = String(answer || "").trim();
    if (!q || !text) return false;
    const source = "answer:" + qid;
    dropSource(session.spec, source);
    session.spec[q.field].push({ text: `${q.question} → ${text}`, source });
    session.answers = session.answers.filter(a => a.qid !== qid);
    session.answers.push({ qid, round: q.round, question: q.question, field: q.field, answer: text, custom: !!custom });
    return true;
  };

  C.applyChecklist = function (session) {
    for (const item of session.checklist) {
      const source = "check:" + item.id;
      dropSource(session.spec, source);
      if (session.checkPending[item.id]) { session.spec[item.field].push({ text: item.label, source }); session.checked[item.id] = true; }
      else delete session.checked[item.id];
    }
  };

  C.currentQuestions = s => s.questions.filter(q => q.round === s.round);
  C.unanswered = s => C.currentQuestions(s).filter(q => !s.answers.some(a => a.qid === q.id));

  const uniq = arr => [...new Set(arr.filter(Boolean))];
  /** End the session. Unanswered questions are recorded as remaining uncertainty, never dropped silently. */
  C.finish = function (session, reason) {
    for (const q of C.unanswered(session)) session.uncertainty.push(`Unanswered: ${q.question}`);
    session.uncertainty = uniq(session.uncertainty);
    session.status = "done";
    if (reason) session.reason = reason;
  };

  /* ---------- validation of a model round ---------- */
  C.validateRound = function (o) {
    const bad = why => { throw new PFError("INVALID_QUESTIONS", why); };
    if (!o || typeof o !== "object" || Array.isArray(o)) bad("response is not an object");
    if (typeof o.done !== "boolean") bad("done must be true/false");
    const strs = (v, k) => { if (v == null) return []; if (!Array.isArray(v) || v.some(x => typeof x !== "string")) bad(k + " must be a string array"); return v.map(x => x.trim()).filter(Boolean); };
    const uncertainty = strs(o.uncertainty, "uncertainty");
    const reason = typeof o.reason === "string" ? o.reason.trim() : "";
    let questions = [];
    if (!o.done) {
      if (!Array.isArray(o.questions) || o.questions.length === 0) bad("not done but no questions were returned");
      questions = o.questions.slice(0, C.MAX_QUESTIONS).map((q, i) => {
        if (!q || typeof q.question !== "string" || !q.question.trim()) bad(`question ${i + 1} has no text`);
        if (!C.FIELDS.includes(q.field)) bad(`question ${i + 1} has an unknown field "${q.field}"`);
        if (!Array.isArray(q.options) || q.options.length !== 4) bad(`question ${i + 1} must have exactly 4 options (got ${Array.isArray(q.options) ? q.options.length : "none"})`);
        const opts = q.options.map(x => (typeof x === "string" ? x.trim() : ""));
        if (opts.some(x => !x)) bad(`question ${i + 1} has an empty option`);
        if (new Set(opts.map(x => x.toLowerCase())).size !== 4) bad(`question ${i + 1} has duplicate options`);
        return { question: q.question.trim().slice(0, 400), why: typeof q.why === "string" ? q.why.trim().slice(0, 400) : "", field: q.field, options: opts.map(x => x.slice(0, 300)) };
      });
    }
    let checklist = [];
    if (o.checklist != null) {
      if (!Array.isArray(o.checklist)) bad("checklist must be an array");
      const seen = new Set();
      for (const c of o.checklist.slice(0, C.MAX_CHECKLIST)) {
        if (!c || typeof c.label !== "string" || !c.label.trim() || !C.FIELDS.includes(c.field)) bad("checklist item malformed");
        const k = c.label.trim().toLowerCase(); if (seen.has(k)) continue; seen.add(k);
        checklist.push({ label: c.label.trim().slice(0, 300), field: c.field });
      }
    }
    if (o.done) checklist = [];
    return { done: o.done, reason, questions, checklist, uncertainty };
  };

  /**
   * Ask the model for the next round. Retries ONCE with the validation error fed back if the format is wrong.
   * Mutates the session only after a valid round is obtained.
   */
  C.requestRound = async function (session, { key, draft, target, fetchImpl, timeoutMs }) {
    if (session.round >= C.MAX_ROUNDS) throw new PFError("INVALID_QUESTIONS", "maximum rounds reached");
    let user = C.buildUser(session, draft, target), lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await PF.groq.structured({ key, name: "promptforge_clarify", schema: C.SCHEMA, system: C.buildSystem(), user, fetchImpl, timeoutMs, maxTokens: 2500 });
      try {
        const r = C.validateRound(raw);
        session.round += 1;
        session.questions.push(...r.questions.map((q, i) => ({ ...q, id: `r${session.round}q${i + 1}`, round: session.round })));
        session.checklist = r.checklist.map((c, i) => ({ ...c, id: `r${session.round}c${i + 1}`, round: session.round }));
        session.checkPending = {}; session.reason = r.reason;
        session.uncertainty = uniq([...session.uncertainty, ...r.uncertainty]);
        if (r.done || session.round >= C.MAX_ROUNDS && r.questions.length === 0) { session.status = "done"; }
        return session;
      } catch (e) {
        if (!(e instanceof PFError) || e.code !== "INVALID_QUESTIONS") throw e;
        lastErr = e; user = JSON.stringify({ ...JSON.parse(user), formatErrorInYourPreviousReply: e.detail, instruction: "Fix this exact problem and reply again." }, null, 2);
      }
    }
    throw lastErr;
  };

  /* ---------- persistence validation ---------- */
  C.validateSession = function (s) {
    const isO = v => v && typeof v === "object" && !Array.isArray(v);
    if (!isO(s) || !["active", "done"].includes(s.status) || !Number.isInteger(s.round) || s.round < 0 || s.round > C.MAX_ROUNDS || !isO(s.spec)) return null;
    const spec = C.emptySpec();
    for (const f of C.FIELDS) if (Array.isArray(s.spec[f])) spec[f] = s.spec[f].filter(e => isO(e) && typeof e.text === "string" && typeof e.source === "string").map(e => ({ text: e.text.slice(0, 2000), source: e.source.slice(0, 80) })).slice(0, 100);
    const questions = (Array.isArray(s.questions) ? s.questions : []).filter(q => isO(q) && typeof q.id === "string" && typeof q.question === "string" && C.FIELDS.includes(q.field) && Array.isArray(q.options) && q.options.length === 4 && q.options.every(o => typeof o === "string") && Number.isInteger(q.round))
      .map(q => ({ id: q.id, round: q.round, question: q.question, why: typeof q.why === "string" ? q.why : "", field: q.field, options: q.options }));
    const checklist = (Array.isArray(s.checklist) ? s.checklist : []).filter(c => isO(c) && typeof c.id === "string" && typeof c.label === "string" && C.FIELDS.includes(c.field)).map(c => ({ id: c.id, label: c.label, field: c.field, round: Number(c.round) || 0 }));
    const answers = (Array.isArray(s.answers) ? s.answers : []).filter(a => isO(a) && typeof a.qid === "string" && typeof a.answer === "string" && typeof a.question === "string" && C.FIELDS.includes(a.field))
      .map(a => ({ qid: a.qid, round: Number(a.round) || 0, question: a.question, field: a.field, answer: a.answer, custom: !!a.custom }));
    const bools = v => (isO(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => x === true)) : {});
    const pending = {};
    if (isO(s.pending)) for (const [k, v] of Object.entries(s.pending)) if (isO(v)) pending[k] = { choice: Number.isInteger(v.choice) && v.choice >= 0 && v.choice < 4 ? v.choice : null, custom: typeof v.custom === "string" ? v.custom.slice(0, 2000) : "" };
    return { id: typeof s.id === "string" ? s.id : PF.uid(), status: s.status, round: s.round, spec, questions, checklist, answers, checked: bools(s.checked), checkPending: bools(s.checkPending), pending,
      uncertainty: (Array.isArray(s.uncertainty) ? s.uncertainty : []).filter(x => typeof x === "string").slice(0, 50), reason: typeof s.reason === "string" ? s.reason : "", startedAt: Number(s.startedAt) || Date.now() };
  };
})(typeof window !== "undefined" ? window : globalThis);
