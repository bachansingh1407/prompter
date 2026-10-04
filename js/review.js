/* PromptForge v0.02 — specification review (review-only, no code) and generated-prompt critique. Pure logic, no DOM. */
(function (root) {
  "use strict";
  const PF = (root.PF = root.PF || {});
  const { PFError } = PF;

  PF.REVIEW_REQUEST = "Review my specification. Do not write code. Find ambiguities, missing requirements, conflicting requirements, edge cases, and assumptions I haven't specified.";
  const CATS = ["ambiguity", "missing", "conflict", "edge_case", "assumption"];
  const SEVS = ["critical", "high", "medium", "low"];
  PF.REVIEW = { CATS, SEVS, MAX_INPUT: 20000, CAT_LABELS: { ambiguity: "Ambiguity", missing: "Missing requirement", conflict: "Conflicting requirements", edge_case: "Edge case", assumption: "Unspecified assumption" } };

  PF.REVIEW_SCHEMA = {
    type: "object", additionalProperties: false,
    properties: {
      summary: { type: "string" },
      findings: { type: "array", items: { type: "object", additionalProperties: false,
        properties: { category: { type: "string", enum: CATS }, original: { type: "string" }, issue: { type: "string" }, impact: { type: "string" }, severity: { type: "string", enum: SEVS }, clarification: { type: "string" }, suggestedRevision: { type: "string" } },
        required: ["category", "original", "issue", "impact", "severity", "clarification", "suggestedRevision"] } }
    },
    required: ["summary", "findings"]
  };

  PF.buildReviewSystem = () => `You are a meticulous requirements reviewer. The user's request is:
"${PF.REVIEW_REQUEST}"

REVIEW-ONLY MODE. Do NOT write, suggest, or include any implementation code, pseudo-code, code fences, SQL, or configuration snippets anywhere in your output. Describe problems and requirement wording in plain prose only.

For every finding return: category (ambiguity, missing, conflict, edge_case, or assumption); "original" = the exact statement copied verbatim from the specification that the finding concerns (use an empty string only for things that are missing entirely); issue; impact; severity (critical, high, medium, low); clarification = one concrete question the author should answer; suggestedRevision = replacement requirement wording in plain prose (not code).
Only report real, specific findings grounded in the text. Do not invent requirements the author did not imply. If the specification is solid, return few or no findings and say so in the summary.
Return ONLY valid JSON matching the schema.`;

  const hasCode = t => /```|~~~/.test(t);

  PF.validateReview = function validateReview(o, specText) {
    const bad = why => { throw new PFError("INVALID_REVIEW", why); };
    if (!o || typeof o !== "object" || Array.isArray(o)) bad("response is not an object");
    if (typeof o.summary !== "string") bad("summary must be a string");
    if (!Array.isArray(o.findings)) bad("findings must be an array");
    if (hasCode(o.summary)) throw new PFError("CODE_IN_REVIEW");
    const norm = t => String(t).toLowerCase().replace(/\s+/g, " ").trim();
    const hay = norm(specText || "");
    const findings = o.findings.slice(0, 40).map((f, i) => {
      if (!f || typeof f !== "object") bad(`finding ${i + 1} is not an object`);
      if (!CATS.includes(f.category)) bad(`finding ${i + 1} has unknown category`);
      if (!SEVS.includes(f.severity)) bad(`finding ${i + 1} has unknown severity`);
      for (const k of ["original", "issue", "impact", "clarification", "suggestedRevision"]) {
        if (typeof f[k] !== "string") bad(`finding ${i + 1}.${k} must be a string`);
        if (hasCode(f[k])) throw new PFError("CODE_IN_REVIEW");
      }
      if (!f.issue.trim()) bad(`finding ${i + 1} has no issue text`);
      const original = f.original.trim();
      // Grounding: a quoted statement must actually occur in the specification. Ungrounded quotes are flagged, not trusted.
      const grounded = original === "" ? f.category === "missing" || f.category === "assumption" || f.category === "edge_case" : hay.includes(norm(original));
      return { category: f.category, severity: f.severity, original, issue: f.issue.trim(), impact: f.impact.trim(), clarification: f.clarification.trim(), suggestedRevision: f.suggestedRevision.trim(), grounded };
    });
    const rank = Object.fromEntries(SEVS.map((s, i) => [s, i]));
    findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
    return { summary: o.summary.trim(), findings };
  };

  PF.reviewSpec = async function reviewSpec({ key, text, fetchImpl, timeoutMs }) {
    const spec = String(text || "").trim();
    if (!spec) throw new PFError("INVALID_REVIEW", "Paste a specification to review first.");
    if (spec.length > PF.REVIEW.MAX_INPUT) throw new PFError("INVALID_REVIEW", `Specification is longer than ${PF.REVIEW.MAX_INPUT} characters.`);
    const raw = await PF.groq.structured({ key, name: "promptforge_spec_review", schema: PF.REVIEW_SCHEMA, system: PF.buildReviewSystem(), user: JSON.stringify({ specification: spec }), fetchImpl, timeoutMs, temperature: 0.2 });
    const r = PF.validateReview(raw, spec);
    return { ...r, reviewedAt: Date.now(), specLength: spec.length };
  };

  PF.reviewToMarkdown = function (r) {
    const L = ["# Specification review", "", `_Review-only. No code was requested or produced. Findings are model-generated and should be verified by you._`, "", r.summary, ""];
    r.findings.forEach((f, i) => {
      L.push(`## ${i + 1}. [${f.severity.toUpperCase()}] ${PF.REVIEW.CAT_LABELS[f.category]}`);
      L.push(f.original ? `**Original statement:** > ${f.original.replace(/\n+/g, " ")}${f.grounded ? "" : "  _(quote not found verbatim in your text)_"}` : "**Original statement:** _(not stated)_");
      L.push(`**Issue:** ${f.issue}`, `**Impact:** ${f.impact}`, `**Clarification needed:** ${f.clarification}`, `**Suggested revision:** ${f.suggestedRevision}`, "");
    });
    return L.join("\n");
  };

  /* ---------- critique of a generated prompt (separate from spec review) ---------- */
  PF.CRITIQUE_SCHEMA = {
    type: "object", additionalProperties: false,
    properties: {
      score: { type: "integer" }, summary: { type: "string" },
      findings: { type: "array", items: { type: "object", additionalProperties: false, properties: { issue: { type: "string" }, severity: { type: "string", enum: SEVS }, suggestion: { type: "string" } }, required: ["issue", "severity", "suggestion"] } },
      revisedPrompt: { type: "string" }
    },
    required: ["score", "summary", "findings", "revisedPrompt"]
  };

  PF.buildCritiqueSystem = target => `You are a strict prompt reviewer. Critique the given prompt written for ${target}. Check: is the goal unambiguous, are requirements testable, are constraints and output format explicit, are acceptance criteria present, are assumptions marked, does it invite fabrication, is it longer than needed. "score" is a 0-100 integer diagnostic estimate of prompt quality (not a guarantee of results). Provide specific findings and a "revisedPrompt" that fixes them while preserving the original intent and every explicit requirement. Do not add requirements the user never implied. Return ONLY valid JSON matching the schema.`;

  PF.validateCritique = function (o) {
    const bad = why => { throw new PFError("INVALID_CRITIQUE", why); };
    if (!o || typeof o !== "object" || Array.isArray(o)) bad("response is not an object");
    if (!Number.isInteger(o.score) || o.score < 0 || o.score > 100) bad("score must be an integer 0-100");
    if (typeof o.summary !== "string") bad("summary must be a string");
    if (typeof o.revisedPrompt !== "string" || !o.revisedPrompt.trim()) bad("revisedPrompt is empty");
    if (!Array.isArray(o.findings)) bad("findings must be an array");
    const findings = o.findings.slice(0, 30).map((f, i) => {
      if (!f || typeof f.issue !== "string" || !f.issue.trim() || !SEVS.includes(f.severity) || typeof f.suggestion !== "string") bad(`finding ${i + 1} malformed`);
      return { issue: f.issue.trim(), severity: f.severity, suggestion: f.suggestion.trim() };
    });
    return { score: o.score, summary: o.summary.trim(), findings, revisedPrompt: o.revisedPrompt.trim() };
  };

  PF.critiquePrompt = async function ({ key, prompt, target, requirement, fetchImpl, timeoutMs }) {
    const raw = await PF.groq.structured({ key, name: "promptforge_critique", schema: PF.CRITIQUE_SCHEMA, system: PF.buildCritiqueSystem(target), user: JSON.stringify({ originalRequirement: requirement || "", promptToCritique: prompt }), fetchImpl, timeoutMs, temperature: 0.2 });
    return { ...PF.validateCritique(raw), reviewedPrompt: prompt, createdAt: Date.now(), applied: false };
  };

  PF.normalizeCritique = function (c) {
    if (!c || typeof c !== "object" || typeof c.reviewedPrompt !== "string") return null;
    try { const v = PF.validateCritique(c); return { ...v, reviewedPrompt: c.reviewedPrompt.slice(0, 100000), createdAt: Number(c.createdAt) || Date.now(), applied: !!c.applied }; } catch { return null; }
  };
})(typeof window !== "undefined" ? window : globalThis);
