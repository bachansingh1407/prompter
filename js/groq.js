/* PromptForge v0.02 — Groq model adapter. No DOM access. Fetch is injectable for tests. */
(function (root) {
  "use strict";
  const PF = (root.PF = root.PF || {});
  const { CONFIG, TARGETS } = PF;

  class PFError extends Error {
    constructor(code, detail) { super(code); this.name = "PFError"; this.code = code; this.detail = detail || ""; }
  }
  PF.PFError = PFError;

  PF.RESPONSE_SCHEMA = {
    type: "object", additionalProperties: false,
    properties: {
      title: { type: "string" }, summary: { type: "string" },
      assumptions: { type: "array", items: { type: "string" } },
      clarifications: { type: "array", items: { type: "string" } },
      prompt: { type: "string" },
      sections: { type: "array", items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, content: { type: "string" } }, required: ["title", "content"] } }
    },
    required: ["title", "summary", "assumptions", "clarifications", "prompt", "sections"]
  };

  PF.buildSystemPrompt = function buildSystemPrompt(target) {
    return `You are an expert AI prompt engineer and software requirements analyst.

Your job is to transform vague user requirements into precise, implementation-ready prompts for another AI system.

Do not simply rewrite the user's text. Analyze the requirement first. Identify missing information. Infer reasonable details only when they are safe and obvious. Clearly mark assumptions. Never fabricate information about the user's project.

Structure the final prompt so another AI can understand exactly what needs to be accomplished. Where relevant to the task, use these section titles in this order: Role, Goal, Context, Requirements, Constraints, Execution Steps, Examples, Output Contract, Acceptance Criteria, Assumptions, Risks, Self-Critique. Omit a section only when it genuinely does not apply; do not pad. Put the assembled text in "prompt" and the same content as "sections" (title + content). Prefer precise, testable statements over length.

If the user payload contains "clarifiedSpecification", treat it as authoritative, do not re-ask what it already answers, and list "remainingUncertainty" items under Assumptions.

If important information is missing, include an "Assumptions / Clarifications" section.

The final prompt must be directly copyable and usable.

TARGET-SPECIFIC INSTRUCTIONS:
${TARGETS[target].instructions}

Return ONLY valid JSON matching the requested schema.`;
  };

  PF.buildUserPayload = (requirement, target, context, extras) => {
    const p = { target, targetDescription: TARGETS[target].description, roughRequirement: requirement, optionalContext: context };
    if (extras && extras.clarifiedSpecification) {
      p.clarifiedSpecification = extras.clarifiedSpecification;
      p.clarificationAnswers = extras.clarificationAnswers || [];
      p.remainingUncertainty = extras.remainingUncertainty || [];
    }
    return p;
  };

  /** Diagnostic structure check of a generated prompt. Missing optional sections are information, not errors. */
  const CANON = {
    role: /role|persona/i, goal: /goal|objective|mission/i, context: /context|background/i, requirements: /requirement/i,
    constraints: /constraint|limitation/i, executionSteps: /step|plan|instruction|workflow|execution|implementation/i,
    examples: /example/i, outputContract: /output|deliverable|response format|format/i,
    acceptanceCriteria: /acceptance|definition of done|success criteria/i, assumptions: /assumption|clarification/i,
    risks: /risk|edge case|pitfall/i, selfCritique: /self.?critique|self.?check|verification|verify/i
  };
  PF.MIN_SECTIONS = ["goal", "requirements", "outputContract", "acceptanceCriteria"];
  PF.structureCheck = function structureCheck(sections, prompt) {
    let heads = (sections || []).map(x => x.title);
    if (!heads.length) heads = String(prompt || "").split("\n").map(l => l.trim()).filter(l => l && l.length < 70);
    const present = Object.keys(CANON).filter(k => heads.some(h => CANON[k].test(h)));
    const missing = Object.keys(CANON).filter(k => !present.includes(k));
    return { present, missing, total: Object.keys(CANON).length, minimumMissing: PF.MIN_SECTIONS.filter(k => !present.includes(k)) };
  };

  /** Strict structural validation of model output. Returns the cleaned object or throws PFError(SCHEMA_INVALID). */
  PF.validateResult = function validateResult(o) {
    const bad = why => { throw new PFError("SCHEMA_INVALID", why); };
    if (!o || typeof o !== "object" || Array.isArray(o)) bad("not an object");
    if (typeof o.prompt !== "string") bad("prompt must be a string");
    if (!o.prompt.trim()) throw new PFError("EMPTY_PROMPT");
    for (const k of ["title", "summary"]) if (o[k] != null && typeof o[k] !== "string") bad(k + " must be a string");
    for (const k of ["assumptions", "clarifications"]) if (o[k] != null && (!Array.isArray(o[k]) || o[k].some(x => typeof x !== "string"))) bad(k + " must be a string array");
    if (o.sections != null && (!Array.isArray(o.sections) || o.sections.some(s => !s || typeof s.title !== "string" || typeof s.content !== "string"))) bad("sections malformed");
    const sections = o.sections || [];
    return {
      title: (o.title || "").trim() || "Generated prompt", summary: o.summary || "",
      assumptions: o.assumptions || [], clarifications: o.clarifications || [], sections, prompt: o.prompt.trim(),
      structureCheck: PF.structureCheck(sections, o.prompt)
    };
  };

  function parseContent(content) {
    let text = String(content).trim();
    const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);   // tolerate fenced JSON only; nothing else is repaired
    if (fence) text = fence[1];
    try { return JSON.parse(text); } catch { throw new PFError("MALFORMED_RESPONSE"); }
  }

  async function post(fetchImpl, key, body, ms) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
    try {
      return await fetchImpl(CONFIG.GROQ_ENDPOINT, {
        method: "POST", signal: ctrl ? ctrl.signal : undefined,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
    } catch (e) {
      if (e && e.name === "AbortError") throw new PFError("TIMEOUT");
      throw new PFError("NETWORK", e && e.message);
    } finally { if (timer) clearTimeout(timer); }
  }

  async function readError(res) {
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch { /* body not JSON */ }
    return detail;
  }

  /**
   * Generic structured call used by every model feature. Returns parsed JSON (shape is the caller's job to validate).
   * opts: { key, name, schema, system, user, fetchImpl?, timeoutMs?, maxTokens?, temperature? }
   */
  async function structured({ key, name, schema, system, user, fetchImpl, timeoutMs, maxTokens, temperature }) {
    if (!key) throw new PFError("NO_KEY");
    const f = fetchImpl || root.fetch.bind(root);
    const ms = timeoutMs || CONFIG.REQUEST_TIMEOUT_MS;
    const base = {
      model: CONFIG.GROQ_MODEL, temperature: temperature == null ? 0.35 : temperature, max_completion_tokens: maxTokens || CONFIG.MAX_COMPLETION_TOKENS,
      messages: [{ role: "system", content: system }, { role: "user", content: user }]
    };
    let res = await post(f, key, { ...base, response_format: { type: "json_schema", json_schema: { name, strict: true, schema } } }, ms);
    if (res.status === 400) {
      const detail = await readError(res);
      if (/response_format|json_schema|structured/i.test(detail)) {
        // Model/account may not support strict schemas: retry once in plain JSON mode. Output is still fully validated by callers.
        res = await post(f, key, { ...base, response_format: { type: "json_object" } }, ms);
      } else throw new PFError("HTTP", detail || "HTTP 400");
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new PFError("INVALID_KEY");
      if (res.status === 429) throw new PFError("RATE_LIMIT");
      const detail = await readError(res);
      throw new PFError("HTTP", detail || `HTTP ${res.status}`);
    }
    let data;
    try { data = await res.json(); } catch { throw new PFError("MALFORMED_RESPONSE"); }
    const choice = data && data.choices && data.choices[0];
    if (choice && choice.finish_reason === "length") throw new PFError("TRUNCATED");
    const content = choice && choice.message && choice.message.content;
    if (!content) throw new PFError("EMPTY_RESPONSE");
    return parseContent(content);
  }

  PF.groq = {
    structured,
    async generate({ key, target, requirement, context, extras, fetchImpl, timeoutMs }) {
      if (!TARGETS[target]) throw new PFError("BAD_TARGET", target);
      const raw = await structured({
        key, name: "promptforge_result", schema: PF.RESPONSE_SCHEMA, system: PF.buildSystemPrompt(target),
        user: JSON.stringify(PF.buildUserPayload(requirement, target, context, extras), null, 2), fetchImpl, timeoutMs
      });
      return PF.validateResult(raw);
    },
    describeError(e) {
      const m = {
        NO_KEY: ["Connect Groq in Settings before generating a prompt.", "Groq not connected"],
        INVALID_KEY: ["The Groq API key was rejected. Check the key in Settings and try again.", "Invalid API key"],
        RATE_LIMIT: ["Groq rate limit reached. Wait a moment and try again.", "Rate limit"],
        TIMEOUT: [`Groq did not respond within ${Math.round(CONFIG.REQUEST_TIMEOUT_MS / 1000)} seconds. Your draft is kept; try again.`, "Request timed out"],
        NETWORK: ["Could not reach Groq. Check your connection (or browser/CORS/extension blocking) and try again.", "Network error"],
        TRUNCATED: ["The model hit the output limit and the prompt was cut off, so it was discarded. Shorten the requirement or context and try again.", "Output truncated"],
        EMPTY_RESPONSE: ["The model returned no usable response. Please try again.", "Empty response"],
        MALFORMED_RESPONSE: ["The model response was not valid JSON. Please try again.", "Response error"],
        SCHEMA_INVALID: ["The model response did not match the expected structure. Please try again.", "Invalid response structure"],
        EMPTY_PROMPT: ["The model returned an empty prompt. Please try again.", "Empty prompt"],
        INVALID_QUESTIONS: [null, "Clarification format error"],
        INVALID_REVIEW: [null, "Review format error"],
        CODE_IN_REVIEW: ["The model returned code in review-only mode, so the result was discarded. Try again.", "Code not allowed in review"],
        INVALID_CRITIQUE: [null, "Critique format error"],
        HTTP: [null, "Groq error"]
      };
      const [msg, title] = m[e && e.code] || ["Something unexpected went wrong while generating your prompt.", "Generation failed"];
      return { title, message: msg || (e && e.detail) || "The request failed." };
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
