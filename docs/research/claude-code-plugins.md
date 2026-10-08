# Claude Code plugins: verified reference (2026-10-08)

Source: official docs at code.claude.com (plugins/manifest-reference, plugins/create, plugins/loading, plugins/install, plugins/cli-reference, plugins/marketplace-reference, skills, sub-agents, hooks). Items marked UNVERIFIED were not confirmed in the fetched text.

## Layout

```
plugin/
├── .claude-plugin/plugin.json   # manifest only
├── skills/<name>/SKILL.md       # /compositor:<name>
├── agents/<name>.md             # compositor:<name>
├── hooks/hooks.json             # top-level "hooks" key
├── scripts/ templates/ references/   # arbitrary files allowed
├── bin/                         # on Bash PATH while enabled
└── package.json (+ lockfile)    # deps auto-installed only for cached copies
```

- `plugin.json`: only `name` required. Omit `version` during local development.
- Component path keys start with `./`. `skills` adds to `skills/`; `agents` replaces `agents/`.
- Plugin-root `CLAUDE.md` is not loaded. Instructions live in skills.
- `${CLAUDE_PLUGIN_ROOT}` is substituted in skill/agent/command bodies and hook commands, not exported to Bash. `${CLAUDE_SKILL_DIR}` is the skill folder. `${CLAUDE_PLUGIN_DATA}` (`~/.claude/plugins/data/<id>/`) survives updates: use for caches, models, node_modules.
- In-place loads (local marketplace, `--plugin-dir`, skills-dir) get no automatic `npm ci`. Run it in the source dir or from a SessionStart hook into `${CLAUDE_PLUGIN_DATA}`.

## Skills

- Invoked as `/compositor:<dir>`; bare `/<dir>` works when unique.
- Frontmatter: `name`, `description` (+ `when_to_use`), `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context: fork`, `agent`, `background`, `hooks`, `paths`, `shell`.
- `agent:` documented values: `Explore`, `Plan`, `general-purpose`, custom agent from `.claude/agents/`. UNVERIFIED whether `compositor:<agent>` is accepted. Test it.
- Substitutions: `$ARGUMENTS`, `$N`, `$name`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PROJECT_DIR}`.
- Dynamic injection `` !`cmd` `` runs before load; a failing command aborts (observed: `cat` outside the session's working dirs is blocked by permissions, so do not rely on it for files outside the project).
- Listing budget: 1% of context window for all descriptions; per-entry cap 1,536 chars; key trigger first.

## Agents

- `agents/<name>.md` → scoped `compositor:<name>`; subfolders add segments. No `:` in `name`.
- Frontmatter: `name`, `description`, `tools`, `disallowedTools`, `model` (`haiku|sonnet|opus|fable|inherit`), `effort`, `maxTurns`, `skills` (preloaded), `memory`, `background`, `omitClaudeMd`, `isolation: worktree`, `color`.
- Ignored for plugin agents: `permissionMode`, `mcpServers`, `hooks`, `initialPrompt`.
- Invocation: `@agent-compositor:<name>`, natural language delegation, `claude --agent compositor:<name>`. Agent tool `subagent_type` most likely `compositor:<name>` (UNVERIFIED; test).

## Installation for local development

| Method | Command | Persist | Edits |
|---|---|---|---|
| Session | `claude --plugin-dir /abs/plugin` | no | in place, `/reload-plugins` |
| Skills dir | folder with `plugin.json` under `~/.claude/skills/compositor/` | yes | in place |
| **Local marketplace (chosen)** | `claude plugin marketplace add /abs/marketplace` then `claude plugin install compositor@<mkt>` | yes | in place, `/reload-plugins`, no version bump |
| Git source | marketplace entry with git/GitHub source | yes | copied to cache; needs version bump + update |

Marketplace layout: `<root>/.claude-plugin/marketplace.json` with `plugins: [{ name, source: "./plugin", description }]`; relative sources start with `./`, no `..`. Marketplace `name` must not be reserved (`inline`, `skills-dir`, `synced`, `claude-*`).

Settings written: `extraKnownMarketplaces.<name> = { source: { source: "directory", path } }` and `enabledPlugins["compositor@<name>"] = true` in `~/.claude/settings.json`.

QA: `claude plugin validate <path> [--strict] [--json]` (exit 0/1/2). `claude plugin eval` for behavioral cases (`evals/<case>/prompt.md` + `graders/*.md`). `/skill-doctor` reports listing cost and never-invoked skills.

## Hooks

- `hooks/hooks.json`, `{"hooks": {"PostToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/gate.mjs"]}]}]}}`.
- PostToolUse cannot prevent the call; exit 2 feeds stderr to Claude as feedback; may return `decision: "block"`, `additionalContext`, `updatedToolOutput`.
- Plugin hooks fire from session load, not only when a skill runs: keep matchers narrow.
- UNVERIFIED whether `Stop` can block with exit 2.
