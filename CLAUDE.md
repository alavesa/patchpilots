# CLAUDE.md — PatchPilots

## Project overview

PatchPilots is a CLI tool with 8 AI agents that review and improve code automatically. Built with TypeScript + Node.js, powered by Claude API.

**Agents:** Planner, Reviewer, Coder, Tester, Docs, Security, Designer, Orchestrator.

## Commands

```bash
npm run dev          # Run CLI via tsx (development)
npm run build        # Compile TypeScript to dist/
npm test             # Run tests with vitest
npm publish          # Build + publish to npm (requires .npmrc with token)
```

## Architecture

- `src/agents/` — Each agent extends `BaseAgent<T>` with 3 methods: `getSystemPrompt()`, `buildUserMessage()`, `getOutputSchema()`
- `src/core/orchestrator.ts` — Coordinates agents, applies patches, tracks costs
- `src/core/llm-client.ts` — Anthropic SDK wrapper with streaming, structured outputs, adaptive thinking, prompt caching
- `src/core/config.ts` — Config resolution: CLI flags > project `.patchpilots.json` > global `~/.patchpilots.json` > env var
- `src/cli/commands/` — One file per CLI command, registered in `program.ts`
- `src/types/review.ts` — All result types (ReviewResult, CoderResult, SecurityResult, etc.)
- `src/utils/` — Formatter, logger, cost tracker, file collector, ASCII banner

## Key patterns

- **Structured outputs:** LLM responses are guaranteed to match Zod schemas via `json_schema` output config + `zod-to-json-schema`
- **Adaptive thinking:** All agents use `thinking: { type: "adaptive" }` — temperature must be 1
- **Streaming:** All LLM calls use `client.messages.stream()` with token callbacks
- **Prompt caching:** System prompts use `cache_control: { type: "ephemeral" }` for ~90% cost savings
- **Diff-based patches:** Coder agent returns `{find, replace, description}` patches, not full files — applied via string find-and-replace in the orchestrator
- **Cost tracking:** `CostTracker` class in `src/utils/cost.ts` — tracks per-agent token usage and USD estimates

## Adding a new agent

1. Create `src/agents/myagent.ts` — extend `BaseAgent<MyResultType>`
2. Add result type to `src/types/review.ts`
3. Add Zod schema in the agent file
4. Add formatter in `src/utils/formatter.ts`
5. Add orchestrator method in `src/core/orchestrator.ts`
6. Add CLI command in `src/cli/commands/myagent.ts`
7. Register in `src/cli/program.ts` and `src/agents/index.ts`
8. Update the ASCII banner in `src/utils/banner.ts`

## Publishing to npm

```bash
npm version patch --no-git-tag-version
echo "//registry.npmjs.org/:_authToken=YOUR_TOKEN" > .npmrc
npm publish
rm .npmrc
git add package.json && git commit -m "chore: bump version" && git push
```

The npm README updates only on publish — not on git push.

## Important notes

- `.npmrc` and `.patchpilots.json` are gitignored — never commit tokens or API keys
- `bin/patchpilots.ts` uses `#!/usr/bin/env node` (not tsx) for the published package
- `bin/demo.ts` plays the ASCII banner animation standalone
- Temperature must be 1 when adaptive thinking is enabled (Claude API requirement)
- The `files` field in package.json controls what goes to npm: `dist`, `README.md`, `LICENSE`
