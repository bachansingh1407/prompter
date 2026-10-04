# PromptForge v0.02 — Baseline, Plan, Evidence Matrix

Status: **Phases 1–2 of 6 complete.** Phases 3–6 are NOT started. Nothing below is claimed beyond what is listed as PASS with evidence.

## 1. Inspection (what v0.01 actually was)
Source received: `PromptForge.zip` = `index.html`, `app.js` (721 lines), `styles.css`, `README.md`. `PROMPTFORGE.md` was **not** in the archive, so README.md was the only written spec.
Architecture: single global script; `state` object; full-page `innerHTML` re-render per route (home/generator, history, templates, settings); Groq `chat/completions` called directly from the browser with `response_format: json_schema`; history in `localStorage`; key in `sessionStorage`.

## 2. Baseline (executed before any change, jsdom, pristine v0.01)
`baseline.test.js` result: **0 pass / 9 fail**.

| ID | Defect (reproduced) | Evidence |
|----|---------------------|----------|
| D1 | Listener accumulation: static nav buttons re-bound every render | 1 click → 6 renders after 5 navigations |
| D2 | Draft lost when toggling "Add more context" | value became "" |
| D3 | Draft lost on navigating away/back (and on reload) | value became "" |
| D4 | Truncated output (`finish_reason: length`) reported as generic parse error | toast text |
| D5 | No request timeout / AbortController | none in source |
| D6 | Corrupt `localStorage` history crashes the app | TypeError |
| D7 | Fabricated "Demo item" cards on Home | rendered text |
| D8 | Theme setting stored but has no effect | no dark CSS |
| D9 | Storage quota error on save is unhandled; silent 50-item truncation | throws |
Additional risks noted from reading (not separately reproduced): API key was written into the DOM `value` attribute; Regenerate silently overwrote user edits; "Clear history" had no confirmation; Groq strict `json_schema` support for `openai/gpt-oss-20b` is **unverified** (no live key available).

## 3. Target architecture (vanilla HTML/CSS/JS retained — inspection did not justify a framework)
```
js/util.js     pure helpers
js/config.js   constants, targets, templates (single source of config)
js/storage.js  persistence: safe get/set, validation, migration, import/export, drafts   (no DOM)
js/groq.js     model adapter: generic structured call, timeout, error taxonomy, prompt validation + structure check (no DOM)
js/clarify.js  clarification engine: 4-option round validation, spec model, answer application, session validation (no DOM)
js/review.js   specification review (review-only, grounding check) and prompt critique (no DOM)
js/app.js      UI/state/views/delegated events
(planned) js/projects.js, js/library.js, js/lab/*.js, js/toolkit/*.js, js/eval.js
```
Scripts are plain `<script>` tags (not ES modules) so `index.html` still works from `file://`.

## 4. Phases
| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Stabilize bugs, response handling, tests, storage layer, theme, import/export | **Done (tested)** |
| 2 | Clarification engine, prompt sections + structure check, critique, specification review (no code) | **Done (tested with mocked model; see limits)** |
| 3 | Projects workspace (stable requirement IDs), reusable context, Prompt Library (search/filter/sort/duplicate/compare), clarity analytics | Not started |
| 4 | AI Lab (7 modules), coding-workflow prompts, implementation verification (PASS/FAIL/PARTIAL/BLOCKED/NOT VERIFIED) | Not started |
| 5 | Toolkit: Build datasets/scoring, Ship regression + thresholds, Production trace import (honest "not connected" state) | Not started |
| 6 | Hardening, migrations v2→v3, responsive/a11y pass, docs, final matrix | Not started |

Navigation today: Prompt Flow, Spec Review, History, Templates, Settings. AI Lab, Projects, Library & Analytics and Toolkit are added when those screens exist, not as empty tabs.

## 5. Tests actually executed
`npm test` runs both suites under jsdom with a mocked Groq (`fetch` is stubbed; no network):
- `tests/phase1.test.js`: **33 pass / 0 fail** (defects D1–D9, regressions R1–R15, security S1–S3, migration M1–M4).
- `tests/phase2.test.js`: **36 pass / 0 fail** (clarification C1–C15, prompt structure P1–P3, critique K1–K5, spec review V1–V10, navigation N1–N2).
- Baseline harness on pristine v0.01: 0/9 (confirms tests detect the original defects).
- Mutation check: 11 deliberate breakages of Phase 2 guards (5-option questions allowed, code-fence guard off, grounding off, no severity sort, custom answer ignored, answers not replaced, skipped questions not recorded, no retry, regenerate using the edited draft, critique score unchecked, 4th round allowed). Each made at least one test fail.
Not executed: any real browser, any live Groq request, mobile/responsive rendering, screen reader or keyboard-only walkthrough, visual check of the new screens in light or dark mode.

## 6. Requirement-to-evidence matrix (acceptance criteria §15)
Legend: PASS = automated test executed (mocked model) · PARTIAL · NOT STARTED.

| # | Acceptance criterion | Status | Evidence / note |
|---|----------------------|--------|-----------------|
| 1 | Preserved features | PASS (mocked) | Phase 1 R1–R15 still pass after Phase 2 changes. Live Groq not exercised |
| 2 | Stable navigation and listeners | PASS | D1, N1 (one page replacement per click, single active item) |
| 3 | Draft persistence | PASS | D2, D3, D3b, N2; clarification answers and unsaved selections persist (C2) |
| 4 | Validated structured prompt output | PARTIAL | Shape validated (R3–R5); structure diagnostic over 12 canonical sections with core-section warning (P1–P3). Whether the live model follows the section list is unverified, and the check is title-pattern based |
| 5 | Four-option clarification + custom input | PASS (mocked) | C1 (exactly 4 radios + custom box; separate checklist), C3, C6/C6b/C11 (format enforced, one retry) |
| 6 | Specification review without code | PASS (mocked, limited) | V1–V10. Output with fenced code (``` or ~~~) is rejected (V2). Unfenced pseudo-code or inline code is NOT detected; the prompt forbids it but that is not enforced |
| 7 | Stable requirement IDs and evidence links | NOT STARTED | Phase 3 |
| 8 | Five-state implementation verification | NOT STARTED | Phase 4 |
| 9 | Persistent projects / library | PARTIAL | History, drafts, clarification sessions and reviews persist and validate (D6, C12, V6, M1–M4). Projects/library NOT STARTED |
| 10 | Immutable original instructions | PASS (mocked) | C10: `roughRequirement` unchanged after the draft is edited and after regenerate; persisted copy checked |
| 11 | Prompt version comparison / export | PARTIAL | Versions + restore (R8, R9); original-vs-revised compare for critiques (K1); export (R10). Arbitrary two-version diff NOT STARTED |
| 12 | Actionable clarity analysis | NOT STARTED | Phase 3 (the model-based critique in K1 is separate from the planned local clarity analyzer) |
| 13 | Seven usable AI Lab modules | NOT STARTED | Phase 4 |
| 14 | Reproducible Build/Ship evaluation | NOT STARTED | Phase 5 |
| 15 | Truthful Production connection state | NOT STARTED | Phase 5 |
| 16 | Safe model errors | PASS | D4, D5, R3, S2, C6b, C9, K2, V2, V4, V10 |
| 17 | Documented security | PARTIAL | README + Settings notice; full threat notes in Phase 6 |
| 18 | Executed regression tests | PASS (Phases 1–2 scope) | 69/69 |
| 19 | Accurate README | PASS (Phases 1–2 scope) | updated |
| 20 | Final matrix | This table; final version due Phase 6 |

## 7. Known limitations (through Phase 2)
- Live Groq behaviour unverified: strict `json_schema` support for the configured model, CORS from `file://`, real rate-limit shapes. The `json_object` fallback is tested against a mock only.
- Browser-held API key remains a prototype risk by design.
- Unknown `target` values from imported data are preserved but cannot be regenerated until a supported target is chosen.
- Dark theme was checked structurally (attribute + CSS rules present), not visually.
- Live behaviour unverified for all new model features. Strict `json_schema` with `enum` fields may be rejected by the live API; the adapter's JSON-mode fallback only triggers when the 400 error text mentions response_format/json_schema/structured.
- The specification is an append-only log of "question → answer" lines plus your draft fields, built by code. It is not rewritten into polished prose, and it does not yet have requirement IDs.
- Clarification is capped at 3 rounds and 3 questions per round (extra questions are dropped). Questions are model-generated, so relevance is not guaranteed.
- Spec review findings are model-generated; only the verbatim-quote check is verified by code. The no-code guard detects fenced code only.
- Prompt Flow input form still has the v0.01 fields; functional/non-functional requirements, user stories, acceptance criteria, definition of done and examples are captured through clarification (and appear in the specification), not as dedicated input fields. A dedicated form is not built.
- Critique score is a model's estimate. It is labelled as such and is not used for any decision.
