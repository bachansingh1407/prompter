/* PromptForge v0.02 (Phase 1) — UI layer. One set of delegated listeners, registered once. Draft lives in state, not in the DOM. */
(function () {
  "use strict";
  const { CONFIG, STORAGE, TARGETS, TEMPLATES, CONTEXT_FIELDS, esc, store } = PF;
  const C = PF.CLARIFY;
  const $ = id => document.getElementById(id);
  const page = $("page"), sidebar = $("sidebar"), overlay = $("overlay");

  const historyLoad = PF.loadHistory();
  const savedTarget = store.getRaw(STORAGE.target);
  const state = {
    route: "generator",
    selectedTarget: TARGETS[savedTarget] ? savedTarget : "Claude Code",
    history: historyLoad.items,
    historyLoad,
    draft: PF.loadDraft(),
    clarify: PF.loadClarify(),
    review: { ...PF.loadReview(), loading: false },
    busy: { clarify: false, critique: false },
    result: null, loading: false, editing: false, editDraft: "", exportOpen: false
  };
  PF.state = state; // exposed for tests/debugging only

  /* ---------- helpers ---------- */
  const getApiKey = () => store.getRaw(STORAGE.key, "session") || "";
  const isConnected = () => Boolean(getApiKey());
  const historyEnabled = () => store.getRaw(STORAGE.saveHistory) !== "false";

  function toast(message, type = "success", title = type === "error" ? "Something went wrong" : "Done") {
    const item = document.createElement("div");
    item.className = `toast ${type}`;
    const s = document.createElement("strong"); s.textContent = title;
    const m = document.createElement("span"); m.textContent = message;
    item.append(s, m);
    $("toastStack").appendChild(item);
    setTimeout(() => item.remove(), type === "error" ? 7000 : 3600);
  }

  function download(filename, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const persistDraft = PF.debounce(() => {
    const r = PF.saveDraft(state.draft);
    if (!r.ok && !persistDraft.warned) { persistDraft.warned = true; toast("Draft could not be saved to browser storage; keep this tab open or copy your text.", "error", "Draft not persisted"); }
  }, 400);

  function persistClarify() {
    const r = PF.saveClarify(state.clarify);
    if (!r.ok && !persistClarify.warned) { persistClarify.warned = true; toast("Clarification answers could not be saved to browser storage.", "error", "Not persisted"); }
  }
  const persistClarifyLater = PF.debounce(persistClarify, 400);
  const persistReviewLater = PF.debounce(() => PF.saveReview(state.review), 400);

  function persistHistory(notify = true) {
    if (!historyEnabled()) return true;
    const r = PF.saveHistory(state.history);
    if (r.trimmed) { state.history = r.items; if (notify) toast(`History is capped at ${CONFIG.HISTORY_LIMIT}; ${r.trimmed} oldest item(s) were removed. Export history to keep a full copy.`, "error", "History trimmed"); }
    if (!r.ok && notify) toast(r.error === "QUOTA" ? "Browser storage is full. Export your history as JSON now to avoid losing it." : "Browser storage is unavailable, so history was not saved.", "error", "History not saved");
    return r.ok;
  }

  /* ---------- theme ---------- */
  function resolvedTheme() {
    const t = store.getRaw(STORAGE.theme) || "light";
    if (t === "system") return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    return t === "dark" ? "dark" : "light";
  }
  function applyTheme() { document.documentElement.dataset.theme = resolvedTheme(); }

  /* ---------- views ---------- */
  const targetOptions = selected => Object.entries(TARGETS).map(([n, d]) =>
    `<option value="${esc(n)}" ${n === selected ? "selected" : ""}>${esc(n)} — ${esc(d.description)}</option>`).join("");

  function generatorView() {
    const open = state.draft.contextOpen;
    return `
    <div class="hero">
      <span class="eyebrow"><span class="eyebrow-dot"></span> AI prompt engineering assistant</span>
      <h1>Generate better prompts.</h1>
      <p>Turn rough ideas into clear, implementation-ready instructions optimized for the AI tool you're using.</p>
      <div class="flow" aria-label="Prompt transformation flow">
        <span class="flow-node">ROUGH REQUIREMENT</span><span class="flow-arrow">→</span>
        <span class="flow-node accent">PROMPT ENGINE</span><span class="flow-arrow">→</span>
        <span class="flow-node">READY TO EXECUTE</span>
      </div>
    </div>
    <div class="card generator-card"><div class="card-body">
      <div class="field">
        <div class="label-row"><label for="targetAI">Optimize prompt for</label></div>
        <div class="select-wrap"><select id="targetAI" aria-label="Target AI">${targetOptions(state.selectedTarget)}</select></div>
      </div>
      <div class="field">
        <div class="label-row"><label for="requirement">Your rough requirement</label><span class="counter" id="charCount">0 / ${CONFIG.MAX_REQUIREMENT}</span></div>
        <textarea id="requirement" data-draft maxlength="${CONFIG.MAX_REQUIREMENT}" placeholder="I need a dashboard for my SaaS app where users can see revenue, active users, charts and recent transactions..."></textarea>
        <div class="helper mt8">Don't worry about formatting. Describe your idea naturally. Your draft is saved automatically in this browser.</div>
      </div>
      <button class="context-toggle" data-action="toggle-context" aria-expanded="${open}">
        <span>${open ? "− Hide additional context" : "+ Add more context"}</span><span>${open ? "Less" : "Optional"}</span>
      </button>
      <div class="context-content ${open ? "open" : ""}" id="contextContent"><div class="context-grid">
        <div><div class="field-label"><label for="projectType">Project type</label></div><input id="projectType" data-draft placeholder="Web application" /></div>
        <div><div class="field-label"><label for="technology">Technology / framework</label></div><input id="technology" data-draft placeholder="React, Node.js, PostgreSQL" /></div>
        <div class="full"><div class="field-label"><label for="existingCode">Existing codebase</label></div><textarea id="existingCode" data-draft placeholder="Optional — describe architecture, relevant files, current behavior..."></textarea></div>
        <div class="full"><div class="field-label"><label for="designRequirements">Design requirements</label></div><textarea id="designRequirements" data-draft placeholder="Optional — visual style, responsiveness, accessibility, references..."></textarea></div>
        <div><div class="field-label"><label for="constraints">Constraints</label></div><textarea id="constraints" data-draft placeholder="Optional — dependencies, performance, compatibility..."></textarea></div>
        <div><div class="field-label"><label for="expectedOutput">Expected output</label></div><textarea id="expectedOutput" data-draft placeholder="Optional — files, code, explanation, checklist..."></textarea></div>
        <div class="full"><div class="field-label"><label for="additionalNotes">Additional notes</label></div><textarea id="additionalNotes" data-draft placeholder="Anything else the AI should know..."></textarea></div>
      </div></div>
      <div class="gap18"></div>
      <button class="cta" id="generateBtn" data-action="generate" ${state.loading ? "disabled" : ""}>${state.loading ? '<span class="spinner"></span> Generating prompt...' : "Generate optimized prompt <span>↗</span>"}</button>
      <button class="btn block mt8" data-action="clarify-start" ${state.busy.clarify || state.loading ? "disabled" : ""}>${state.busy.clarify ? "Analyzing requirement..." : "Clarify first — ask me focused questions"}</button>
      <div class="draft-actions"><button class="text-btn" data-action="clear-draft">Clear draft</button></div>
    </div></div>
    ${clarifyPanel()}
    ${state.result ? resultView() : recentSection()}`;
  }

  function recentSection() {
    const recent = state.history.slice(0, 3);
    return `
    <div class="section-head"><div><h2>Recent prompts</h2><p>${recent.length ? "Your latest generated prompts." : "Prompts you generate will appear here."}</p></div>
      <button class="text-btn" data-route="history">View history →</button></div>
    ${recent.length ? `<div class="recent-grid">${recent.map(i => `
      <button class="recent-card" data-action="open-history" data-id="${esc(i.id)}">
        <div class="recent-title">${esc(i.title)}</div><div class="meta">${esc(PF.formatTime(i.timestamp))}</div><span class="badge">${esc(i.target)}</span>
      </button>`).join("")}</div>` : `<div class="empty">No prompts yet. Describe a requirement above and generate your first one.</div>`}`;
  }

  function listBlock(title, items) {
    if (!items || !items.length) return "";
    return `<div class="note-block"><h3>${esc(title)}</h3><ul>${items.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
  }

  function resultView() {
    const r = state.result;
    const versions = r.versions || [];
    return `
    <div class="result-shell mt42">
      <div class="result-header">
        <div><h2>Generated Prompt</h2><div class="meta">${esc(r.title || "Untitled prompt")} · ${esc(r.target)}</div></div>
        <div class="result-actions">
          <button class="btn" data-action="copy" id="copyBtn">Copy</button>
          <button class="btn" data-action="regenerate" ${state.loading || !r.roughRequirement ? "disabled" : ""}>${state.loading ? "Generating..." : "↻ Regenerate"}</button>
          <button class="btn" data-action="edit" ${state.editing ? "disabled" : ""}>${state.editing ? "Editing" : "Edit"}</button>
          <div class="export-wrap" id="exportWrap">
            <button class="btn primary" data-action="export-toggle" aria-haspopup="true" aria-expanded="${state.exportOpen}">Export ▾</button>
            <div class="export-menu ${state.exportOpen ? "open" : ""}" id="exportMenu">
              <button class="text-btn export-choice" data-action="export" data-kind="copy">Copy as text</button>
              <button class="text-btn export-choice" data-action="export" data-kind="txt">Download .txt</button>
              <button class="text-btn export-choice" data-action="export" data-kind="md">Download .md</button>
            </div>
          </div>
        </div>
      </div>
      ${r.summary ? `<p class="result-summary">${esc(r.summary)}</p>` : ""}
      <div class="card result-card">
        <div class="result-toolbar"><span class="editor-dots"><i></i><i></i><i></i></span><span>implementation-ready / ${esc(r.target)}</span></div>
        ${state.editing
          ? `<textarea class="prompt-editor" id="promptEditor" aria-label="Edit prompt">${esc(state.editDraft)}</textarea>
             <div class="edit-actions"><button class="btn" data-action="cancel-edit">Cancel</button><button class="btn primary" data-action="save-edit">Save changes</button></div>`
          : `<div class="prompt-output" id="promptOutput">${esc(r.prompt)}</div>`}
      </div>
      ${structureLine(r)}${listBlock("Assumptions made", r.assumptions)}${listBlock("Open questions", r.clarifications)}${qaBlock(r)}${critiqueBlock(r)}
      ${versions.length ? `<details class="versions"><summary>Earlier versions (${versions.length})</summary>
        ${versions.map((v, i) => `<div class="version-row"><span>${esc(v.label)} · ${esc(PF.formatTime(v.timestamp))}</span><button class="btn" data-action="restore-version" data-index="${i}">Restore</button></div>`).join("")}</details>` : ""}
    </div>`;
  }

  function structureLine(r) {
    const sc = r.structureCheck; if (!sc) return "";
    const L = k => k.replace(/([A-Z])/g, " $1").toLowerCase();
    return `<p class="structure-line"><strong>Structure check (diagnostic):</strong> ${sc.present.length}/${sc.total} standard sections found${sc.missing.length ? `; not present: ${esc(sc.missing.map(L).join(", "))}` : ""}.${sc.minimumMissing.length ? ` <span class="warn-text">Core sections missing: ${esc(sc.minimumMissing.map(L).join(", "))}.</span>` : ""} Optional sections may legitimately be absent for some tasks.</p>`;
  }

  function qaBlock(r) {
    if (!r.qa || !r.qa.length) return r.uncertainty && r.uncertainty.length ? listBlock("Remaining uncertainty", r.uncertainty) : "";
    return `<div class="note-block"><h3>Clarifications used</h3><ul>${r.qa.map(q => `<li><strong>${esc(q.question)}</strong> ${esc(q.answer)}</li>`).join("")}</ul></div>${listBlock("Remaining uncertainty", r.uncertainty)}`;
  }

  function critiqueBlock(r) {
    const c = r.critique;
    const busy = state.busy.critique;
    let body = "";
    if (c) {
      const stale = c.reviewedPrompt !== r.prompt && !c.applied;
      body = `<p class="meta">Quality score <strong>${c.score}/100</strong> — a diagnostic estimate by the model, not a guarantee of results.${stale ? " The prompt has changed since this critique." : ""}</p>
        ${c.summary ? `<p class="result-summary">${esc(c.summary)}</p>` : ""}
        ${c.findings.length ? `<ul class="crit-list">${c.findings.map(f => `<li><span class="sev sev-${esc(f.severity)}">${esc(f.severity)}</span> ${esc(f.issue)}<div class="meta">Suggestion: ${esc(f.suggestion)}</div></li>`).join("")}</ul>` : `<p class="meta">No findings reported.</p>`}
        <details class="versions"><summary>Compare original and revised prompt</summary>
          <div class="compare"><div><div class="field-label">Original (reviewed)</div><pre class="cmp">${esc(c.reviewedPrompt)}</pre></div><div><div class="field-label">Revised</div><pre class="cmp">${esc(c.revisedPrompt)}</pre></div></div></details>
        <div class="mt8">${c.applied ? `<span class="meta">Revision applied. The original is kept under Earlier versions.</span>` : `<button class="btn primary" data-action="apply-revision" ${c.revisedPrompt === r.prompt ? "disabled" : ""}>Apply revised prompt</button>`}</div>`;
    }
    return `<div class="note-block critique"><h3>Prompt critique</h3>
      <button class="btn" data-action="critique" ${busy ? "disabled" : ""}>${busy ? "Critiquing..." : c ? "↻ Critique again" : "Critique this prompt"}</button>${body}</div>`;
  }

  function clarifyPanel() {
    const c = state.clarify;
    if (!c) return "";
    const answered = id => c.answers.find(a => a.qid === id);
    const qs = C.currentQuestions(c);
    const active = c.status === "active";
    let body = "";
    if (active) {
      body += `<p class="meta">Round ${c.round} of ${C.MAX_ROUNDS}. Answer what you can: pick one of the four options or type your own answer (typed text wins). Each saved answer updates the specification below immediately.</p>`;
      body += qs.map(q => {
        const p = c.pending[q.id] || {}; const a = answered(q.id);
        return `<fieldset class="q-card" data-qid="${esc(q.id)}"><legend>${esc(q.question)}</legend>
          ${q.why ? `<div class="helper">${esc(q.why)}</div>` : ""}
          ${q.options.map((o, i) => `<label class="opt"><input type="radio" name="q-${esc(q.id)}" value="${i}" data-pending="${esc(q.id)}" ${p.choice === i ? "checked" : ""}> <span>${esc(o)}</span></label>`).join("")}
          <label class="opt-custom"><span class="field-label">Or your own answer (optional)</span><textarea data-custom="${esc(q.id)}" rows="2" maxlength="2000">${esc(p.custom || "")}</textarea></label>
          <div class="q-actions"><button class="btn" data-action="clarify-answer" data-qid="${esc(q.id)}">${a ? "Update answer" : "Save answer"}</button>${a ? `<span class="saved-tag">Saved: ${esc(a.answer)}</span>` : ""}</div></fieldset>`;
      }).join("");
      if (c.checklist.length) {
        body += `<fieldset class="q-card checklist"><legend>Also consider (select all that apply)</legend>
          ${c.checklist.map(it => `<label class="opt"><input type="checkbox" data-check="${esc(it.id)}" ${c.checkPending[it.id] ? "checked" : ""}> <span>${esc(it.label)} <em class="meta">→ ${esc(C.LABELS[it.field])}</em></span></label>`).join("")}
          <div class="q-actions"><button class="btn" data-action="clarify-checklist">Save selections</button></div></fieldset>`;
      }
      body += `<div class="q-actions">${c.round < C.MAX_ROUNDS ? `<button class="btn" data-action="clarify-next" ${state.busy.clarify ? "disabled" : ""}>${state.busy.clarify ? "Thinking..." : "Get next questions"}</button>` : ""}<button class="btn primary" data-action="clarify-finish">Finish clarification</button></div>`;
    } else {
      body += `<p class="meta">${esc(c.reason || "Clarification finished.")}</p>`;
    }
    if (c.uncertainty.length) body += `<div class="note-block"><h3>Remaining uncertainty (recorded, not resolved)</h3><ul>${c.uncertainty.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
    const text = C.specToText(c.spec);
    return `<div class="card clarify-card" id="clarifyPanel"><div class="card-body">
      <div class="section-head"><div><h2>Clarification</h2><p>${active ? "In progress" : "Finished"} · ${c.answers.length} answer(s) saved</p></div></div>
      ${body}
      <details class="versions" open><summary>Specification so far</summary><pre class="cmp">${esc(text || "(empty)")}</pre></details>
      <div class="q-actions mt8">
        <button class="btn primary" data-action="clarify-generate" ${state.loading ? "disabled" : ""}>Generate prompt from clarified specification</button>
        <button class="btn" data-action="review-from-clarify">Review this specification</button>
        <button class="btn danger" data-action="clarify-discard">Discard clarification</button></div>
    </div></div>`;
  }

  function reviewView() {
    const rv = state.review, res = rv.result;
    return `
    <div class="page-title"><h1>Specification Review</h1><p>Review-only mode: finds problems in your specification. It does not write code, and the app rejects model output that contains code blocks.</p></div>
    <div class="card"><div class="card-body">
      <div class="mode-line"><span class="field-label">Request sent to the model</span><code>${esc(PF.REVIEW_REQUEST)}</code></div>
      <div class="field"><div class="label-row"><label for="reviewText">Your specification</label><span class="counter" id="reviewCount">${rv.text.length} / ${PF.REVIEW.MAX_INPUT}</span></div>
        <textarea id="reviewText" class="review-text" maxlength="${PF.REVIEW.MAX_INPUT}" placeholder="Paste requirements, user stories, acceptance criteria, constraints...">${esc(rv.text)}</textarea></div>
      <div class="q-actions"><button class="cta cta-inline" data-action="review-run" ${rv.loading ? "disabled" : ""}>${rv.loading ? '<span class="spinner"></span> Reviewing...' : "Review specification"}</button>
        <button class="btn" data-action="review-load-spec">Load from Prompt Flow</button><button class="btn" data-action="review-clear">Clear</button></div>
    </div></div>
    ${res ? `<div class="result-shell mt42"><div class="result-header"><div><h2>Findings (${res.findings.length})</h2><div class="meta">Model-generated; verify before acting. Quotes that do not appear in your text are flagged.</div></div>
      <div class="result-actions"><button class="btn" data-action="review-copy">Copy as Markdown</button><button class="btn" data-action="review-download">Download .md</button></div></div>
      <p class="result-summary">${esc(res.summary)}</p>
      ${res.findings.map(f => `<div class="card finding sev-border-${esc(f.severity)}"><div class="card-body">
        <div class="finding-head"><span class="sev sev-${esc(f.severity)}">${esc(f.severity)}</span><span class="badge">${esc(PF.REVIEW.CAT_LABELS[f.category])}</span></div>
        <div class="field-label">Original statement</div>${f.original ? `<blockquote>${esc(f.original)}</blockquote>${f.grounded ? "" : `<div class="warn-text">This quote was not found verbatim in your specification.</div>`}` : `<div class="meta">Not stated in your specification.</div>`}
        <div class="field-label">Issue</div><p>${esc(f.issue)}</p><div class="field-label">Impact</div><p>${esc(f.impact)}</p>
        <div class="field-label">Clarification needed</div><p>${esc(f.clarification)}</p><div class="field-label">Suggested revision</div><p>${esc(f.suggestedRevision)}</p></div></div>`).join("")}
      ${res.findings.length ? "" : `<div class="empty">No findings were reported.</div>`}</div>` : ""}`;
  }

  function historyView() {
    const items = state.history;
    const hl = state.historyLoad;
    return `
    <div class="page-title"><h1>History</h1><p>Prompts generated in this browser.${historyEnabled() ? "" : " History saving is currently turned off."}</p></div>
    ${hl.dropped ? `<div class="banner warn">${hl.error ? esc(hl.error) : `${hl.dropped} stored entr${hl.dropped === 1 ? "y was" : "ies were"} invalid and skipped. The original data is preserved in a browser-storage backup.`}</div>` : ""}
    <div class="card pad18">
      <div class="history-toolbar">
        <button class="btn" data-action="history-export" ${items.length ? "" : "disabled"}>Export JSON</button>
        <button class="btn" data-action="history-import">Import JSON</button>
        <input type="file" id="importFile" accept="application/json,.json" hidden />
        ${items.length ? `<button class="btn danger" data-action="clear-history">Clear history</button>` : ""}
      </div>
      ${items.length ? `<div class="history-list">${items.map(item => `
        <div class="history-item">
          <div class="history-main"><div class="history-title">${esc(item.title)}</div><div class="meta">${esc(item.target)} · ${esc(PF.formatTime(item.timestamp))}</div></div>
          <div class="history-actions"><button class="btn" data-action="open-history" data-id="${esc(item.id)}">Open</button><button class="btn danger" data-action="delete-history" data-id="${esc(item.id)}">Delete</button></div>
        </div>`).join("")}</div>` : `<div class="empty">No generated prompts yet. Create your first one from Prompt Generator.</div>`}
    </div>`;
  }

  function templatesView() {
    return `
    <div class="page-title"><h1>Templates</h1><p>Start with a proven prompt shape, then tailor it to your project.</p></div>
    <div class="template-grid">${TEMPLATES.map(([t, d], i) => `
      <div class="template-card"><h3>${esc(t)}</h3><p>${esc(d)}</p><button class="btn" data-action="use-template" data-index="${i}">Use template →</button></div>`).join("")}</div>`;
  }

  function settingsView() {
    const key = getApiKey();
    const theme = store.getRaw(STORAGE.theme) || "light";
    const masked = key ? `${key.slice(0, 4)}…${key.slice(-4)}` : "";
    return `
    <div class="page-title"><h1>Settings</h1><p>Configure Groq and your local PromptForge preferences.</p></div>
    <div class="settings-grid">
      <div class="card setting-card">
        <h3>Groq API</h3>
        <p><strong>Prototype security notice:</strong> a key entered here is used directly from your browser and can be read by browser tools or extensions. It is kept in <code>sessionStorage</code> (cleared when the tab closes) and is never written to history, drafts or exports. For production, route requests through a server that holds the key.</p>
        <div class="setting-row">
          <div class="field-label"><label for="apiKeyInput">Groq API Key</label></div>
          <div class="secret-wrap mt9"><input id="apiKeyInput" type="password" autocomplete="off" placeholder="${key ? "Key stored for this session — enter a new one to replace" : "gsk_..."}" /><button class="show-secret" data-action="toggle-secret">Show</button></div>
          <div class="status-line"><span class="groq-dot ${key ? "connected" : ""}"></span><span>${key ? `Key stored for this session (${esc(masked)}). Not verified until the first request.` : "Not connected"}</span></div>
        </div>
        <div class="setting-row"><div class="field-label">Model</div><input value="${esc(CONFIG.GROQ_MODEL)}" readonly aria-label="Model" class="readonly-input mt9" /><div class="helper mt8">Set in <code>js/config.js</code>.</div></div>
        <div class="setting-row"><button class="btn primary" data-action="connect">${key ? "Replace key" : "Connect Groq"}</button><button class="btn ml6" data-action="clear-key">Clear key</button></div>
      </div>
      <div class="card setting-card">
        <h3>Preferences</h3><p>These settings are stored locally in this browser.</p>
        <div class="setting-row"><div class="switch-row"><div><div class="field-label">Save history</div><div class="helper">Keep generated prompts in localStorage.</div></div>
          <button class="switch ${historyEnabled() ? "on" : ""}" data-action="toggle-history-save" role="switch" aria-checked="${historyEnabled()}" aria-label="Save history"><span></span></button></div></div>
        <div class="setting-row"><div class="field-label mb10"><label for="defaultTarget">Default target AI</label></div><div class="select-wrap"><select id="defaultTarget">${targetOptions(state.selectedTarget)}</select></div></div>
        <div class="setting-row"><div class="field-label mb10">Theme</div>
          <div class="radio-group">${["light", "dark", "system"].map(x => `<div class="radio-chip"><input type="radio" name="theme" id="theme-${x}" value="${x}" ${theme === x ? "checked" : ""}><label for="theme-${x}">${x[0].toUpperCase() + x.slice(1)}</label></div>`).join("")}</div></div>
      </div>
    </div>`;
  }

  const views = { home: generatorView, generator: generatorView, review: reviewView, history: historyView, templates: templatesView, settings: settingsView };

  function render() {
    page.innerHTML = (views[state.route] || generatorView)();
    page.querySelectorAll("[data-draft]").forEach(el => { el.value = state.draft[el.id] || ""; });
    const counter = $("charCount");
    if (counter) counter.textContent = `${state.draft.requirement.length} / ${CONFIG.MAX_REQUIREMENT}`;
    document.querySelectorAll(".nav-item").forEach(b => {
      const on = b.dataset.route === state.route || (state.route === "home" && b.dataset.route === "home");
      b.classList.toggle("active", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    const dot = $("sidebarStatusDot"), label = $("sidebarStatus");
    if (dot && label) { dot.classList.toggle("connected", isConnected()); label.textContent = isConnected() ? "Key set (session)" : "Not connected"; }
  }

  function navTo(route) {
    if (state.editing && route !== state.route && state.editDraft !== state.result?.prompt) toast("Your unsaved prompt edit is kept — return to Prompt Generator to finish it.", "success", "Edit kept");
    state.route = route;
    closeNav();
    render();
    if (window.scrollTo && !/jsdom/i.test(navigator.userAgent)) window.scrollTo({ top: 0 });
  }
  function openNav() { sidebar.classList.add("open"); overlay.style.display = "block"; $("mobileMenuBtn")?.setAttribute("aria-expanded", "true"); }
  function closeNav() { sidebar.classList.remove("open"); overlay.style.display = "none"; $("mobileMenuBtn")?.setAttribute("aria-expanded", "false"); }

  /* ---------- actions ---------- */
  const extrasFromSession = c => c && (c.answers.length || c.spec.goal.length) ? { clarifiedSpecification: C.specToText(c.spec), clarificationAnswers: c.answers.map(a => ({ question: a.question, answer: a.answer })), remainingUncertainty: c.uncertainty } : null;
  const extrasFromItem = it => it && it.specSnapshot ? { clarifiedSpecification: it.specSnapshot, clarificationAnswers: it.qa.map(q => ({ question: q.question, answer: q.answer })), remainingUncertainty: it.uncertainty } : null;

  async function generate(isRegen, useSpec) {
    if (state.loading) return;
    const prev = state.result;
    const requirement = isRegen ? (prev && prev.roughRequirement) : state.draft.requirement.trim();
    if (!requirement) { toast("Please enter a requirement first.", "error", "Requirement required"); return; }
    if (!getApiKey()) { toast("Connect Groq in Settings before generating a prompt.", "error", "Groq not connected"); navTo("settings"); return; }
    const context = isRegen ? (prev.optionalContext || {}) : Object.fromEntries(CONTEXT_FIELDS.map(k => [k, (state.draft[k] || "").trim()]));
    const target = isRegen ? (TARGETS[prev.target] ? prev.target : state.selectedTarget) : state.selectedTarget;
    const extras = isRegen ? extrasFromItem(prev) : useSpec ? extrasFromSession(state.clarify) : null;
    state.loading = true; render();
    try {
      const out = await PF.groq.generate({ key: getApiKey(), target, requirement, context, extras });
      const versions = prev && isRegen ? [...(prev.versions || []), { prompt: prev.prompt, timestamp: prev.timestamp, label: "before regenerate" }].slice(-CONFIG.VERSION_LIMIT) : [];
      state.result = { id: isRegen && prev ? prev.id : PF.uid(), ...out, target, timestamp: Date.now(), roughRequirement: requirement, optionalContext: context, versions,
        qa: extras ? extras.clarificationAnswers.map(a => ({ ...a, field: "" })) : [], specSnapshot: extras ? extras.clarifiedSpecification : "", uncertainty: extras ? extras.remainingUncertainty : [], critique: null };
      state.editing = false;
      if (historyEnabled()) {
        state.history = [state.result, ...state.history.filter(x => x.id !== state.result.id)];
        persistHistory();
      }
      toast(state.route === "generator" || state.route === "home" ? "Prompt generated successfully" : "Prompt generated — open Prompt Generator to view it");
    } catch (e) {
      if (!(e instanceof PF.PFError)) console.error("PromptForge unexpected error:", e);
      const { title, message } = PF.groq.describeError(e);
      toast(message, "error", title);
    } finally { state.loading = false; render(); }
  }

  async function runClarifyRound(isStart) {
    if (state.busy.clarify) return;
    const draft = { ...state.draft };
    const requirement = draft.requirement.trim();
    if (!requirement) { toast("Describe your requirement first, then ask for clarification.", "error", "Requirement required"); return; }
    if (!getApiKey()) { toast("Connect Groq in Settings before using clarification.", "error", "Groq not connected"); navTo("settings"); return; }
    let session, skipped = [];
    if (isStart) {
      if (state.clarify && state.clarify.answers.length && !confirm("Start a new clarification? Your saved answers will be replaced.")) return;
      session = C.newSession(draft);
    } else { session = state.clarify; skipped = C.unanswered(session).map(q => `Unanswered: ${q.question}`); }
    state.busy.clarify = true; render();
    try {
      await C.requestRound(session, { key: getApiKey(), draft, target: state.selectedTarget });
      session.uncertainty = [...new Set([...session.uncertainty, ...skipped])];
      state.clarify = session; persistClarify();
      if (session.status === "done") toast(session.round === 1 && !session.questions.length ? "Your requirement already looks clear — no questions needed." : "Clarification complete.");
    } catch (e) {
      if (!(e instanceof PF.PFError)) console.error("PromptForge unexpected error:", e);
      const { title, message } = PF.groq.describeError(e); toast(message, "error", title);
    } finally { state.busy.clarify = false; render(); }
  }

  async function runCritique() {
    const r = state.result; if (!r || state.busy.critique) return;
    if (!getApiKey()) { toast("Connect Groq in Settings first.", "error", "Groq not connected"); navTo("settings"); return; }
    state.busy.critique = true; render();
    try {
      const c = await PF.critiquePrompt({ key: getApiKey(), prompt: r.prompt, target: r.target, requirement: r.roughRequirement });
      if (state.result !== r) { toast("The prompt changed while it was being critiqued, so the critique was discarded.", "error", "Critique discarded"); }
      else { r.critique = c; const i = state.history.findIndex(x => x.id === r.id); if (i >= 0) state.history[i] = r; persistHistory(); toast("Critique ready"); }
    } catch (e) {
      if (!(e instanceof PF.PFError)) console.error("PromptForge unexpected error:", e);
      const { title, message } = PF.groq.describeError(e); toast(message, "error", title);
    } finally { state.busy.critique = false; render(); }
  }

  async function runReview() {
    const rv = state.review; if (rv.loading) return;
    if (!rv.text.trim()) { toast("Paste a specification to review first.", "error", "Nothing to review"); return; }
    if (!getApiKey()) { toast("Connect Groq in Settings before reviewing.", "error", "Groq not connected"); navTo("settings"); return; }
    rv.loading = true; render();
    try {
      rv.result = await PF.reviewSpec({ key: getApiKey(), text: rv.text });
      PF.saveReview(rv); toast(`Review complete: ${rv.result.findings.length} finding(s)`);
    } catch (e) {
      if (!(e instanceof PF.PFError)) console.error("PromptForge unexpected error:", e);
      const { title, message } = PF.groq.describeError(e); toast(message, "error", title);
    } finally { rv.loading = false; render(); }
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast("Prompt copied to clipboard"); }
    catch { toast("Clipboard access was blocked by the browser. Use Export → Download instead.", "error", "Copy failed"); }
  }

  const actions = {
    "open-nav": openNav, "close-nav": closeNav,
    "clarify-start": () => runClarifyRound(true),
    "clarify-next": () => runClarifyRound(false),
    "clarify-answer": el => {
      const c = state.clarify; const q = c && c.questions.find(x => x.id === el.dataset.qid); if (!q) return;
      const p = c.pending[q.id] || {}; const custom = (p.custom || "").trim();
      const text = custom || (Number.isInteger(p.choice) ? q.options[p.choice] : "");
      if (!text) { toast("Pick one of the four options or type your own answer.", "error", "No answer selected"); return; }
      C.applyAnswer(c, q.id, text, !!custom); persistClarify(); render(); toast("Answer saved — specification updated");
    },
    "clarify-checklist": () => { if (!state.clarify) return; C.applyChecklist(state.clarify); persistClarify(); render(); toast("Selections saved — specification updated"); },
    "clarify-finish": () => { if (!state.clarify) return; C.finish(state.clarify); persistClarify(); render(); },
    "clarify-generate": () => generate(false, true),
    "clarify-discard": () => { if (!state.clarify) return; if (!confirm("Discard this clarification and its saved answers?")) return; state.clarify = null; PF.saveClarify(null); render(); },
    "review-from-clarify": () => { state.review.text = C.specToText(state.clarify.spec).slice(0, PF.REVIEW.MAX_INPUT); persistReviewLater(); navTo("review"); },
    "review-run": runReview,
    "review-load-spec": () => {
      const text = state.clarify ? C.specToText(state.clarify.spec) : C.specToText(C.newSession(state.draft).spec);
      if (!text) { toast("Nothing to load yet — write a requirement in Prompt Flow first.", "error", "Empty"); return; }
      if (state.review.text.trim() && state.review.text.trim() !== text.trim() && !confirm("Replace the specification text in this box?")) return;
      state.review.text = text.slice(0, PF.REVIEW.MAX_INPUT); persistReviewLater(); render();
    },
    "review-clear": () => {
      if ((state.review.text || state.review.result) && !confirm("Clear the specification text and the review result?")) return;
      state.review.text = ""; state.review.result = null; PF.saveReview(state.review); render();
    },
    "review-copy": () => state.review.result && copyText(PF.reviewToMarkdown(state.review.result)),
    "review-download": () => { if (!state.review.result) return; download("specification-review.md", PF.reviewToMarkdown(state.review.result), "text/markdown"); toast("Review exported as .md"); },
    critique: runCritique,
    "apply-revision": () => {
      const r = state.result; const c = r && r.critique; if (!c || c.applied || c.revisedPrompt === r.prompt) return;
      r.versions = [...(r.versions || []), { prompt: r.prompt, timestamp: Date.now(), label: "before critique revision" }].slice(-CONFIG.VERSION_LIMIT);
      r.prompt = c.revisedPrompt; c.applied = true;
      const i = state.history.findIndex(x => x.id === r.id); if (i >= 0) state.history[i] = r;
      persistHistory(); render(); toast("Revised prompt applied; the original is kept in Earlier versions");
    },
    "toggle-context": () => { state.draft.contextOpen = !state.draft.contextOpen; persistDraft(); render(); },
    generate: () => generate(false),
    regenerate: () => generate(true),
    copy: () => state.result && copyText(state.editing ? state.editDraft : state.result.prompt),
    edit: () => { if (!state.result) return; state.editing = true; state.editDraft = state.result.prompt; render(); $("promptEditor")?.focus(); },
    "cancel-edit": () => { state.editing = false; render(); },
    "save-edit": () => {
      const r = state.result; if (!r) return;
      const text = state.editDraft.trim();
      if (!text) { toast("A prompt cannot be empty.", "error", "Nothing to save"); return; }
      if (text !== r.prompt) {
        r.versions = [...(r.versions || []), { prompt: r.prompt, timestamp: Date.now(), label: "before edit" }].slice(-CONFIG.VERSION_LIMIT);
        r.prompt = text;
        const i = state.history.findIndex(x => x.id === r.id);
        if (i >= 0) state.history[i] = r;
        persistHistory();
      }
      state.editing = false; render(); toast("Prompt changes saved");
    },
    "restore-version": el => {
      const r = state.result; const v = r && r.versions[Number(el.dataset.index)]; if (!v) return;
      r.versions = [...r.versions, { prompt: r.prompt, timestamp: Date.now(), label: "before restore" }].slice(-CONFIG.VERSION_LIMIT);
      r.prompt = v.prompt;
      persistHistory(); render(); toast("Earlier version restored");
    },
    "export-toggle": () => { state.exportOpen = !state.exportOpen; $("exportMenu")?.classList.toggle("open", state.exportOpen); },
    export: el => {
      const r = state.result; if (!r) return;
      state.exportOpen = false; $("exportMenu")?.classList.remove("open");
      if (el.dataset.kind === "copy") return copyText(r.prompt);
      const md = el.dataset.kind === "md";
      download(`${PF.slugify(r.title)}.${md ? "md" : "txt"}`, r.prompt, md ? "text/markdown" : "text/plain");
      toast(`Prompt exported as .${md ? "md" : "txt"}`);
    },
    "open-history": el => {
      const item = state.history.find(x => x.id === el.dataset.id); if (!item) return;
      state.result = item; if (TARGETS[item.target]) state.selectedTarget = item.target;
      state.editing = false; state.route = "generator"; render();
    },
    "delete-history": el => {
      state.history = state.history.filter(x => x.id !== el.dataset.id);
      if (state.result && state.result.id === el.dataset.id) state.result = null;
      persistHistory(); render(); toast("History item deleted");
    },
    "clear-history": () => {
      if (!confirm(`Delete all ${state.history.length} saved prompts? Export first if you want a copy.`)) return;
      state.history = []; state.result = null; persistHistory(); render(); toast("History cleared");
    },
    "history-export": () => { download(`promptforge-history-${new Date().toISOString().slice(0, 10)}.json`, PF.exportBundle(state.history), "application/json"); toast(`Exported ${state.history.length} prompt(s)`); },
    "history-import": () => $("importFile")?.click(),
    "use-template": el => {
      const starter = TEMPLATES[Number(el.dataset.index)][2];
      if (state.draft.requirement.trim() && state.draft.requirement.trim() !== starter && !confirm("Replace your current requirement draft with this template?")) return;
      state.draft.requirement = starter; persistDraft(); state.result = null; state.route = "generator"; render();
      toast("Template loaded — customize it before generating");
    },
    "clear-draft": () => {
      if (CONTEXT_FIELDS.concat("requirement").some(k => state.draft[k]) && !confirm("Clear the requirement and all context fields?")) return;
      state.draft.requirement = ""; CONTEXT_FIELDS.forEach(k => (state.draft[k] = "")); persistDraft.flush(); render();
    },
    connect: () => {
      const key = $("apiKeyInput")?.value.trim();
      if (!key) { toast("Enter your Groq API key first.", "error", "Missing API key"); return; }
      if (key.length < 20 || /\s/.test(key)) { toast("That does not look like an API key (too short or contains spaces).", "error", "Check the key"); return; }
      const r = store.setRaw(STORAGE.key, key, "session");
      if (!r.ok) { toast("Session storage is unavailable, so the key could not be kept.", "error", "Key not stored"); return; }
      toast("Key stored for this tab session. It is only verified on the first request.", "success", "Groq key saved"); render();
    },
    "clear-key": () => { store.remove(STORAGE.key, "session"); render(); toast("Groq API key cleared"); },
    "toggle-secret": el => { const i = $("apiKeyInput"); i.type = i.type === "password" ? "text" : "password"; el.textContent = i.type === "password" ? "Show" : "Hide"; },
    "toggle-history-save": () => {
      const next = !historyEnabled(); store.setRaw(STORAGE.saveHistory, String(next));
      if (next) persistHistory(); render(); toast(`History saving ${next ? "enabled" : "disabled"}`);
    }
  };

  /* ---------- event delegation (registered exactly once) ---------- */
  document.addEventListener("click", e => {
    if (state.exportOpen && !e.target.closest("#exportWrap")) { state.exportOpen = false; $("exportMenu")?.classList.remove("open"); }
    const routeEl = e.target.closest("[data-route]");
    if (routeEl) { navTo(routeEl.dataset.route); return; }
    const el = e.target.closest("[data-action]");
    if (el && actions[el.dataset.action] && !el.disabled) actions[el.dataset.action](el);
  });

  document.addEventListener("input", e => {
    const t = e.target;
    if (t.matches && t.matches("[data-draft]")) {
      state.draft[t.id] = t.value; persistDraft();
      if (t.id === "requirement") $("charCount").textContent = `${t.value.length} / ${CONFIG.MAX_REQUIREMENT}`;
    } else if (t.id === "promptEditor") state.editDraft = t.value;
    else if (t.dataset && t.dataset.custom && state.clarify) { const id = t.dataset.custom; state.clarify.pending[id] = { choice: null, ...(state.clarify.pending[id] || {}), custom: t.value }; persistClarifyLater(); }
    else if (t.id === "reviewText") { state.review.text = t.value; $("reviewCount").textContent = `${t.value.length} / ${PF.REVIEW.MAX_INPUT}`; persistReviewLater(); }
  });

  document.addEventListener("change", async e => {
    const t = e.target;
    if (t.dataset && t.dataset.pending && state.clarify) {
      const id = t.dataset.pending; state.clarify.pending[id] = { custom: "", ...(state.clarify.pending[id] || {}), choice: Number(t.value) }; persistClarify(); return;
    }
    if (t.dataset && t.dataset.check && state.clarify) {
      if (t.checked) state.clarify.checkPending[t.dataset.check] = true; else delete state.clarify.checkPending[t.dataset.check];
      persistClarify(); return;
    }
    if (t.id === "targetAI" || t.id === "defaultTarget") {
      if (!TARGETS[t.value]) return;
      state.selectedTarget = t.value; store.setRaw(STORAGE.target, t.value);
      if (t.id === "defaultTarget") toast("Default target updated");
    } else if (t.name === "theme") {
      store.setRaw(STORAGE.theme, t.value); applyTheme(); toast("Theme updated");
    } else if (t.id === "importFile" && t.files && t.files[0]) {
      const text = await t.files[0].text(); t.value = "";
      const parsed = PF.parseImport(text);
      if (!parsed.ok) { toast(parsed.error, "error", "Import failed"); return; }
      const m = PF.mergeHistory(state.history, parsed.items);
      state.history = m.items; persistHistory(); render();
      toast(`Imported ${m.added} new, ${m.updated} updated${parsed.skipped ? `, ${parsed.skipped} invalid skipped` : ""}.`);
    }
  });

  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    closeNav();
    if (state.exportOpen) { state.exportOpen = false; $("exportMenu")?.classList.remove("open"); }
  });

  window.addEventListener("pagehide", () => { persistDraft.flush(); persistClarifyLater.flush(); persistReviewLater.flush(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") persistDraft.flush(); });
  if (window.matchMedia) { try { window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme); } catch { /* old browsers */ } }

  /* ---------- boot ---------- */
  applyTheme();
  render();
  if (historyLoad.dropped) toast(historyLoad.error || `${historyLoad.dropped} invalid history entr${historyLoad.dropped === 1 ? "y was" : "ies were"} skipped; original kept as a backup.`, "error", "History recovered");
})();
