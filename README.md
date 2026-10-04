# PromptForge

PromptForge is a polished, browser-based AI Prompt Generator / Prompt Engineering Assistant. It converts rough natural-language requirements into structured, implementation-ready prompts optimized for:

- Claude Code
- ChatGPT
- Gemini
- Cursor
- GitHub Copilot

## What it does

1. Select an AI target.
2. Enter a rough requirement.
3. Optionally add project context.
4. Send the requirement to Groq.
5. Receive a structured prompt as JSON.
6. Review, copy, edit, regenerate, or export the resulting prompt.
7. Store generated prompts in browser history.

## Run it

No build system is required.

Option 1: open `index.html` directly in a modern browser.

Option 2: run a tiny local server from this folder:

```bash
python -m http.server 5500
```

Then open:

`http://localhost:5500`

Using a local server is recommended because browser security behavior around API requests can differ when an HTML file is opened directly.

## Groq API key

Create a Groq API key through your Groq account, then open:

**Settings → Groq API → Groq API Key**

Click **Connect Groq**.

The prototype keeps the key in `sessionStorage` by default, meaning it is only available to the current browser tab/session. It is not hardcoded into the source.

The interface explicitly labels this as a prototype because browser-side API calls expose the key to the browser environment.

## Model

The prototype uses:

`openai/gpt-oss-20b`

The model is defined as a configuration constant in `js/config.js`, so it can be changed without changing the application architecture.

## Prompt generation

PromptForge sends:

- selected target AI
- rough requirement
- optional project type
- technology/framework
- existing codebase context
- design requirements
- constraints
- expected output
- additional notes

The Groq system instruction asks the model to analyze the requirement, identify missing information, make only safe/obvious assumptions, and produce a directly usable prompt. Target-specific instructions adapt the result for coding agents versus general-purpose assistants.

Groq Structured Outputs are used with a JSON schema, and the UI primarily displays the generated `prompt` field.

## History

Generated prompts can be saved to localStorage. The Settings page includes a **Save history** toggle.

History entries contain:

- title
- target AI
- timestamp
- prompt
- original requirement
- optional context

## Prototype security limitations

This is intentionally a browser-only prototype.

Do not treat direct browser-to-Groq requests as a production security architecture. A user-entered API key can be inspected by browser tooling and is not protected like a server-side secret.

For production, move the Groq request behind a server-side endpoint. The browser should authenticate with your application and your server should keep the Groq credential private.

## Production architecture recommendation

A production version can use:

Browser → authenticated application API → server-side Groq client → Groq API

The server can then add:

- authentication and authorization
- rate limiting
- usage quotas
- server-side API key management
- request validation
- audit logging
- abuse protection
- provider/model configuration
- analytics

## Files (v0.02)

- `index.html` — shell and semantic markup; loads the scripts below in order
- `styles.css` — visual system, responsive layout, light/dark themes
- `js/util.js`, `js/config.js` — helpers; constants, targets, templates
- `js/storage.js` — validated persistence, v0.01 → v0.02 migration, import/export, draft saving (no DOM)
- `js/groq.js` — Groq adapter: generic structured call, timeout, error codes, truncation detection, output validation, structure check (no DOM)
- `js/clarify.js` — clarification engine (four-option questions, spec model, session validation; no DOM)
- `js/review.js` — specification review (review-only) and prompt critique (no DOM)
- `js/app.js` — UI state, views, delegated event handlers
- `tests/` — jsdom harness, `phase1.test.js`, `phase2.test.js`
- `docs/PLAN.md` — baseline defects, phased plan, requirement-to-evidence matrix, limitations

## Tests

```bash
npm install
npm test
```

Tests use jsdom with a mocked `fetch`. They do not call Groq and do not replace a manual browser check.

## What changed in v0.02 Phase 1

Fixed: listener accumulation, lost drafts (now saved to `localStorage`), truncated/malformed/invalid model output handling, request timeout (60 s), corrupt-history crash (invalid entries skipped, original kept as a backup key), fabricated demo cards, no-op theme setting, storage quota errors, silent history trimming (cap raised to 200 with a notice).
Added: history JSON export/import with validation, prompt version list with restore (edits and regenerations no longer overwrite silently), confirmations before destructive actions, safer API-key handling (never placed in the DOM, history, drafts or exports).
## What changed in v0.02 Phase 2

- **Clarify first:** from Prompt Flow, ask the model for up to 3 focused questions per round (max 3 rounds). Every question has exactly four options plus your own typed answer, and a separate tick-list of extra considerations. Format is enforced in code with one automatic retry. Each saved answer updates the specification immediately; unanswered questions are recorded as remaining uncertainty. Answers and unsaved selections survive reload.
- **Generate from the clarified specification:** the spec, answers and remaining uncertainty are sent with your original requirement, which is never modified.
- **Structure check:** generated prompts are checked for 12 standard sections (role, goal, context, requirements, constraints, execution steps, examples, output contract, acceptance criteria, assumptions, risks, self-critique). Missing optional sections are shown as information; missing core sections get a warning.
- **Critique:** a separate model pass scores a prompt (a diagnostic estimate, not a guarantee), lists findings and proposes a revision. Applying it keeps the original under Earlier versions.
- **Spec Review:** review-only mode. It sends the exact request "Review my specification. Do not write code. Find ambiguities, missing requirements, conflicting requirements, edge cases, and assumptions I haven't specified." Each finding has the original statement, issue, impact, severity, clarification and suggested revision. Output containing fenced code is rejected. Quoted statements that do not appear verbatim in your text are flagged. Export as Markdown.

Not yet built: projects, library analytics, AI Lab, Toolkit (Phases 3–5). See `docs/PLAN.md` for the evidence matrix and limitations. Everything above was tested against a mocked model only.

## Verification checklist

The prototype implements:

- navigation
- target AI selector
- requirement input and character count
- optional context
- Groq API call
- structured JSON response handling
- generated prompt display
- copy
- edit/save/cancel
- regenerate
- export as text/Markdown
- history
- templates
- settings
- API key connection
- loading states
- error handling
- toast notifications
- responsive layout
- localStorage history

## Important note about API availability

The code uses the Groq Chat Completions endpoint requested by the prototype specification and the `openai/gpt-oss-20b` model. Verify your Groq account permissions and current API policies before deploying.

