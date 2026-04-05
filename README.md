# PatchPilots

[![npm version](https://img.shields.io/npm/v/patchpilots)](https://www.npmjs.com/package/patchpilots)
[![license](https://img.shields.io/npm/l/patchpilots)](https://github.com/alavesa/patchpilots/blob/main/LICENSE)
[![Reviewed by PatchPilots](https://img.shields.io/badge/reviewed%20by-PatchPilots%20🎯-blueviolet)](https://github.com/alavesa/patchpilots)

A team of AI agents that reviews and improves your code automatically.

```
     ○      ○      ○      ○      ○      ○      ○      ○
    /|\    /|\    /|\    /|\    /|\    /|\    /|\    /|\
    / \    / \    / \    / \    / \    / \    / \    / \
     🧠      🔍      ✨      🧪      📝      🔒      🎨      🎯
  Planner Reviewer  Coder   Tester   Docs  Security Designer Orchestrator

    ____        __       __    ____  _ __      __
   / __ \____ _/ /______/ /_  / __ \(_) /___  / /______
  / /_/ / __ `/ __/ ___/ __ \/ /_/ / / / __ \/ __/ ___/
 / ____/ /_/ / /_/ /__/ / / / ____/ / / /_/ / /_(__  )
/_/    \__,_/\__/\___/_/ /_/_/   /_/_/\____/\__/____/

     ○      ○      ○      ○      ○      ○      ○      ○
    /|\    /|\    /|\    /|\    /|\    /|\    /|\    /|\
    / \    / \    / \    / \    / \    / \    / \    / \

    Your code crew is ready. One dev. Eight agents. Zero bugs.
```

**One dev. Eight AI agents. Zero excuses.**

Built for solo developers and hobby projects — when you don't have a team to review your PRs, PatchPilots is your crew.

## See it in action

<div align="center">
     
**PatchPilots Reviewer and Coder in action on CLI.**

<img src="https://github.com/user-attachments/assets/14080558-ff40-4d28-bc4e-e77505093731" alt="PatchPilots CLI demo" width="700">


**PatchPilots auto-reviews PRs and posts findings as comments.**

<img src="https://github.com/user-attachments/assets/69eacb82-f314-46b9-a98b-a8bdee5038d9" alt="PatchPilots GitHub PR demo" width="700">

</div>

## Use it 4 ways

### `npx` — no install, one-off
```bash
npx patchpilots audit ./src
```

### Global install — your machine, any project
```bash
npm install -g patchpilots
patchpilots audit ./src
```

### GitHub Action — automatic on every PR
```yaml
- uses: alavesa/patchpilots@main
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### MCP Server — security scanning inside your IDE
```json
{
  "mcpServers": {
    "patchpilots": {
      "command": "npx",
      "args": ["-y", "patchpilots-mcp"],
      "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }
    }
  }
}
```

Works with Claude Code, Cursor, VS Code, and any MCP-compatible IDE. Exposes the security agent and a supply chain dependency scanner as conversational tools — ask your AI assistant to scan your code and it calls PatchPilots automatically. See [patchpilots-mcp](https://github.com/alavesa/patchpilots-mcp) for setup details.

The CLI and Action give you all 8 agents. The MCP server brings security scanning into your editor conversation. Same analysis, different delivery.

## The Killer Feature

**`patchpilots audit`** — run all 8 agents in one command. No other tool does this.

```bash
npx patchpilots audit ./src --write
```

```
⚡ TypeScript → 🧠 Planner → 🔍 Reviewer → 🔒 Security → 🎨 Designer → ✨ Coder → 🧪 Tester → 📝 Docs
```

One command gives you: TypeScript pre-check (free), implementation plan, code review, security audit, design & accessibility audit, auto-fixes, unit tests, and documentation. Skip what you don't need:

```bash
npx patchpilots audit ./src --skip plan,docs --write
```

## The Crew

| Agent | Command | What it does |
|-------|---------|--------------|
| 🎯 Orchestrator | `patchpilots audit` | Runs the full pipeline in one command |
| 🧠 Planner | `patchpilots plan` | Analyzes codebase and breaks down work into tasks |
| 🔍 Reviewer | `patchpilots review` | Finds bugs, security issues, and code smells |
| ✨ Coder | `patchpilots improve` | Fixes code based on review findings (diff-based patches) |
| 🧪 Tester | `patchpilots test` | Generates unit tests for your source files |
| 📝 Docs | `patchpilots docs` | Generates JSDoc/TSDoc documentation |
| 🔒 Security | `patchpilots security` | OWASP Top 10 audit, secrets detection, auth analysis |
| 🎨 Designer | `patchpilots designer` | WCAG 2.1 AA accessibility, design tokens, CSS consistency |

## Quick start

```bash
# Set your API key (get one at https://console.anthropic.com/settings/keys)
# Option 1: Global config (set once, works everywhere)
echo '{"apiKey": "sk-ant-..."}' > ~/.patchpilots.json

# Option 2: Environment variable
export ANTHROPIC_API_KEY=your-key-here

# Run the full audit
npx patchpilots audit ./src --write

# Or run individual agents:
npx patchpilots review ./src
npx patchpilots security ./src
npx patchpilots designer ./src
npx patchpilots improve ./src --write
npx patchpilots test ./src --write
npx patchpilots docs ./src --write
npx patchpilots plan ./src --task "add authentication"
```

## CLI commands

### `patchpilots audit <path>`

Runs all agents in sequence: **TypeScript pre-check** → plan → review → security → designer → improve → test → docs.

Before any AI agent runs, PatchPilots executes `tsc --noEmit` to catch TypeScript errors instantly — unused imports, type mismatches, missing arguments. These findings are free (no API tokens) and get merged into the review results.

| Option | Description |
|--------|-------------|
| `--write` | Apply patches and write tests/docs to disk |
| `--backup` | Create `.bak` files before patching |
| `--skip <agents>` | Skip agents (comma-separated: `plan,test,docs`) |
| `--severity <level>` | Minimum severity for review findings |
| `--framework <name>` | Test framework (default: `vitest`) |
| `--json` | Output raw JSON |
| `--verbose` | Show per-agent token usage |
| `--routing` | Smart model routing (Haiku/Sonnet/Opus by file complexity) |
| `-m, --model <model>` | Claude model to use |

### `patchpilots review <path>`

Runs a TypeScript pre-check, then analyzes your code with AI. Findings grouped by file, color-coded by severity.

| Option | Description |
|--------|-------------|
| `-m, --model <model>` | Claude model to use |
| `-c, --config <path>` | Path to config file |
| `--severity <level>` | Minimum severity: `critical`, `warning`, `info` |
| `--json` | Output raw JSON |
| `--verbose` | Show token usage and thinking progress |

### `patchpilots improve <path>`

Reviews code and generates search-and-replace patches to fix issues.

All `review` options plus:

| Option | Description |
|--------|-------------|
| `--write` | Apply patches to disk (default: dry-run) |
| `--backup` | Create `.bak` files before patching |

### `patchpilots test <path>`

Generates unit tests for source files.

| Option | Description |
|--------|-------------|
| `--write` | Write test files to disk |
| `--framework <name>` | Test framework to use (default: `vitest`) |

### `patchpilots plan <path>`

Analyzes codebase and creates a structured implementation plan.

| Option | Description |
|--------|-------------|
| `-t, --task <description>` | Specific task to plan for |

### `patchpilots docs <path>`

Generates documentation for source files.

| Option | Description |
|--------|-------------|
| `--write` | Write documented files to disk |
| `--backup` | Create `.bak` files before overwriting |

### `patchpilots security <path>`

Runs a security audit focused on OWASP Top 10, secrets detection, and auth patterns.

| Option | Description |
|--------|-------------|
| `--severity <level>` | Minimum severity: `critical`, `high`, `medium`, `low` |
| `--json` | Output raw JSON |
| `--verbose` | Show token usage and timing |

### `patchpilots designer <path>`

Audits accessibility (WCAG 2.1 AA), design tokens, CSS consistency, and component markup.

| Option | Description |
|--------|-------------|
| `--severity <level>` | Minimum severity: `critical`, `high`, `medium`, `low` |
| `--json` | Output raw JSON |
| `--verbose` | Show token usage and timing |

### `patchpilots custom <agent-name> <path>`

Runs a custom agent you defined in `.patchpilots.json`. List available agents with `patchpilots custom list .`.

### `patchpilots memory <path>`

View or clear project memory from previous runs.

| Option | Description |
|--------|-------------|
| `--clear` | Clear all project memory |
| `--json` | Output raw JSON |

## Project Memory

PatchPilots remembers. After each review or security audit, findings are tracked in `.patchpilots-memory.json`. On the next run, agents get context about:

- **Recurring issues** — found multiple times across runs, flagged for extra attention
- **Recently fixed** — verified to stay fixed
- **Open vs closed** — track what's been addressed

```bash
# View memory status
npx patchpilots memory ./src

# Clear memory
npx patchpilots memory ./src --clear
```

Memory makes every subsequent review smarter — agents know what was found before, what keeps coming back, and what's been fixed.

## Custom Agents

Define your own review rules in `.patchpilots.json`:

```json
{
  "customAgents": [
    {
      "name": "naming",
      "description": "Check naming conventions",
      "prompt": "Review code for our naming rules: components PascalCase, hooks use*, utils camelCase, constants UPPER_SNAKE"
    },
    {
      "name": "api-patterns",
      "description": "Verify API patterns",
      "prompt": "Check that all API calls use our fetchWrapper, have error handling, and include loading states"
    }
  ]
}
```

Then run:

```bash
# Run your custom agent
npx patchpilots custom naming ./src

# List available custom agents
npx patchpilots custom list .
```

No other AI code review tool lets you define your own agents like this.

## Configuration

Set your API key **once globally** so it works for every project:

```bash
echo '{"apiKey": "sk-ant-..."}' > ~/.patchpilots.json
```

Or create a per-project `.patchpilots.json`:

```json
{
  "model": "claude-sonnet-4-6",
  "maxTokens": 64000,
  "include": ["**/*.ts", "**/*.js", "**/*.tsx", "**/*.jsx", "**/*.html", "**/*.css"],
  "exclude": ["node_modules/**", "dist/**"],
  "maxFileSize": 100000,
  "maxFiles": 20
}
```

Config resolution order: CLI flags > project `.patchpilots.json` > global `~/.patchpilots.json` > `ANTHROPIC_API_KEY` env var.

### Smart Model Routing

Route files to different Claude models based on complexity — simple files go to Haiku (cheap + fast), most code to Sonnet, and complex/security-critical files to Opus.

```bash
# Enable via CLI flag
npx patchpilots audit ./src --routing

# Or in .patchpilots.json
```

```json
{
  "modelRouting": {
    "enabled": true,
    "fast": "claude-haiku-4-5",
    "standard": "claude-sonnet-4-6",
    "deep": "claude-opus-4-6",
    "fastMaxLines": 50,
    "deepMinLines": 500,
    "fastPatterns": ["types", "constants", "config", "index"],
    "deepPatterns": ["auth", "crypto", "security", "middleware", "payment", "database"]
  }
}
```

| Tier | Default model | When |
|------|--------------|------|
| **fast** | claude-haiku-4-5 | Files under 50 lines, or matching `types`, `config`, `constants`, `index`, `.d.ts` |
| **standard** | claude-sonnet-4-6 | Everything else |
| **deep** | claude-opus-4-6 | Files over 500 lines, or matching `auth`, `crypto`, `security`, `middleware`, `payment`, `database`, `migration` |

Pattern matching takes priority over line count. All thresholds and patterns are configurable.

### Supported file types

TypeScript, JavaScript, JSX/TSX, Python, Go, Rust, Java, Ruby, PHP, C/C++, C#, Swift, Kotlin, HTML, CSS, SCSS, Vue, Svelte.

## GitHub Action

Auto-review every PR with one workflow file:

```yaml
# .github/workflows/patchpilots.yml
name: PatchPilots Review
on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: alavesa/patchpilots@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          path: './src'
```

The action posts findings as a PR comment (updated on each push, no spam). Critical findings fail the check by default.

| Input | Default | Description |
|-------|---------|-------------|
| `anthropic_api_key` | (required) | Your Anthropic API key |
| `path` | `./src` | Path to review |
| `model` | `claude-sonnet-4-6` | Claude model to use |
| `skip` | | Agents to skip (e.g. `plan,test,docs`) |
| `severity` | `info` | Minimum severity to report |
| `fail_on_critical` | `true` | Fail the check on critical findings |
| `changed_only` | `false` | Only review files changed in the PR (faster, cheaper) |

## Powered by Claude API

- **Structured outputs** — guaranteed schema compliance via JSON schema enforcement
- **Adaptive thinking** — deeper reasoning catches bugs a surface scan misses
- **Streaming** — real-time response delivery, no timeouts
- **Prompt caching** — ~90% cost savings on repeat runs
- **Smart model routing** — Haiku for simple files, Sonnet for most code, Opus for complex/critical
- **Cost tracking** — per-agent token usage and USD estimate after every run
- **Diff-based patches** — search-and-replace instead of full files, works on large codebases

## Architecture

Every agent extends `BaseAgent<T>` and implements three methods:

```typescript
class MyAgent extends BaseAgent<MyOutputType> {
  getSystemPrompt()          // What the agent's role is
  buildUserMessage(context)  // How to format the input
  getOutputSchema()          // Zod schema — guarantees output shape
}
```

Adding a new agent is one file + three methods.

## Roadmap

### Done
- [x] 8 AI agents: Planner, Reviewer, Coder, Tester, Docs, Security, Designer, Orchestrator
- [x] `patchpilots audit` — full pipeline in one command
- [x] Structured outputs, adaptive thinking, streaming
- [x] Prompt caching + cost tracking
- [x] Diff-based Coder output (patches instead of full files)
- [x] Global config + per-project config
- [x] Published to npm (`npx patchpilots`)
- [x] Custom agents via `.patchpilots.json`
- [x] Project memory — tracks findings across runs
- [x] 18 file types supported

### Next up
- [x] **GitHub Action** — auto-review PRs and post findings as comments
- [x] **Parallel file review** — review in batches instead of one giant prompt
- [x] **Changed files only** — GitHub Action reviews only files touched in the PR for faster, cheaper runs
- [x] **Smart model routing** — Haiku for simple files, Sonnet for most code, Opus for complex/critical
- [x] **Custom agents** — define your own agents via `.patchpilots.json`
- [x] **Designer agent** — WCAG 2.1 AA accessibility, design tokens, CSS consistency, component markup

### Future agents

**Code quality**
- [ ] 🌍 **i18n** — hardcoded strings, RTL issues, locale assumptions
- [ ] ⚡ **Performance** — bundle size, render patterns, lazy loading opportunities
- [ ] 📊 **Analytics** — event tracking coverage, naming consistency, missing flow events
- [ ] ♻️ **Refactor** — duplication detection, abstraction suggestions
- [ ] 🧓 **Legacy** — flags patterns that made sense in 2019 but not anymore

**Design systems**
- [ ] 📐 **Consistency** — same pattern implemented 3 different ways across components
- [ ] 🧩 **API** — component prop naming consistency, missing variants, breaking changes

**Solo dev tools**
- [ ] 🚢 **ShipPilot** — "is this actually ready to deploy?" checklist agent
- [ ] 📣 **Changelog** — auto-generates release notes from diffs
- [ ] 💸 **CostPilot** — estimates Claude API spend before running the full audit

### Future platforms
- [x] 🔌 **MCP Server** — security agent inside Claude Code, Cursor, and any MCP-compatible IDE ([patchpilots-mcp](https://github.com/alavesa/patchpilots-mcp))
- [ ] 🌐 **Web UI** — drag and drop a repo, get a report. No CLI needed

## License

MIT
