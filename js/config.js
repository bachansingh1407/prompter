/* PromptForge v0.02 — static configuration: targets and templates (carried over from v0.01). */
(function (root) {
  "use strict";
  const PF = (root.PF = root.PF || {});

  PF.CONFIG = {
    GROQ_ENDPOINT: "https://api.groq.com/openai/v1/chat/completions",
    GROQ_MODEL: "openai/gpt-oss-20b",
    MAX_REQUIREMENT: 5000,
    REQUEST_TIMEOUT_MS: 60000,
    MAX_COMPLETION_TOKENS: 5000,
    HISTORY_LIMIT: 200,
    VERSION_LIMIT: 20,
    SCHEMA_VERSION: 2,
    APP_VERSION: "0.02-phase2"
  };

  PF.STORAGE = {
    key: "promptforge_groq_key",          // sessionStorage only
    history: "promptforge_history",
    historyBackup: "promptforge_history_backup",
    saveHistory: "promptforge_save_history",
    target: "promptforge_default_target",
    theme: "promptforge_theme",
    draft: "promptforge_draft",
    schema: "promptforge_schema",
    clarify: "promptforge_clarify",
    review: "promptforge_review"
  };

  PF.TARGETS = {
    "Claude Code": { description: "Terminal-based AI coding agent",
      instructions: "Adapt the prompt for Claude Code. Tell it to inspect the existing repository first, understand architecture and conventions, identify relevant files, avoid rewriting working code unnecessarily, create a concise implementation plan, implement the feature, install dependencies only when needed, run tests/build/lint where available, verify the result, report changed files and important decisions, and identify anything incomplete." },
    "ChatGPT": { description: "General-purpose AI assistant",
      instructions: "Adapt the prompt for ChatGPT. Emphasize role, context, objective, detailed requirements, constraints, examples where useful, acceptance criteria, and a precise desired response/deliverable format. Ask for clarification when critical information is genuinely missing." },
    "Gemini": { description: "Google's AI assistant",
      instructions: "Adapt the prompt for Gemini. Organize the task around context, task definition, supporting information, requirements, constraints, expected output, and structured deliverables. Keep instructions explicit and easy to execute." },
    "Cursor": { description: "AI-first code editor",
      instructions: "Adapt the prompt for Cursor. Emphasize existing codebase context, repository/file inspection, relevant files, implementation steps, coding conventions, dependency discipline, tests, verification, and acceptance criteria." },
    "GitHub Copilot": { description: "AI coding assistant",
      instructions: "Adapt the prompt for GitHub Copilot. Emphasize repository context, implementation requirements, coding standards, relevant files, expected behavior, tests, and acceptance criteria." }
  };

  PF.TEMPLATES = [
    ["Build a web application", "Turn a product idea into an implementation-ready web application plan and build prompt.", "I want to build a web application for [describe the product]. Users should be able to [main actions]."],
    ["Add a feature to existing code", "Describe a focused change without disturbing existing functionality.", "I have an existing application and want to add [feature]. The current behavior is [describe]. The new behavior should be [describe]."],
    ["Fix a bug", "Create a reproducible debugging and implementation prompt.", "I have a bug where [describe the issue]. It happens when [steps]. I expected [expected behavior], but instead [actual behavior]."],
    ["Refactor code", "Improve maintainability while preserving behavior.", "I want to refactor [area/file/module] because [reason]. Existing behavior that must remain unchanged: [details]."],
    ["Create UI from requirements", "Convert product requirements into a polished interface implementation prompt.", "Create a responsive UI for [product/page]. It should include [sections/components] and follow these design requirements: [details]."],
    ["Research a technical topic", "Get a structured research prompt with useful deliverables.", "Research [topic]. I need to understand [questions]. Compare relevant approaches, explain tradeoffs, and provide practical recommendations."]
  ];

  PF.CONTEXT_FIELDS = ["projectType", "technology", "existingCode", "designRequirements", "constraints", "expectedOutput", "additionalNotes"];
})(typeof window !== "undefined" ? window : globalThis);
