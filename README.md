# Alex

TUI for running multiple AI coding agents in parallel. Point it at GitHub issues, let Claude or Codex do the work.

Inspired by [ralph-claude-code](https://github.com/frankbria/ralph-claude-code) but without the strict project structure requirements, and with support for multiple agents.

![screenshot](docs/screenshot.png)

## What it does

- Spawn agent loops from GitHub issue URLs
- Parse acceptance criteria from issue markdown
- Live transcript streaming
- Pause/resume/stop loops (SIGSTOP/SIGCONT/SIGTERM)
- Send interventions to agent stdin mid-task
- Persists state across sessions

## Install

Requires Node 20+, [GitHub CLI](https://cli.github.com/) authenticated, and either `claude` or `codex` CLI installed.

```bash
bun install
bun run build
bun link
```

Then run from any repo:

```bash
cd ~/your-project
alex
```

## Usage

| Key | Action |
|-----|--------|
| `N` | New loop (paste GH issue URL) |
| `Enter` | Start queued loop |
| `P` | Pause/Resume |
| `S` | Stop |
| `I` | Intervene (send message to agent) |
| `↑↓` | Navigate loops |
| `Q` | Quit |

## Agents

- **Claude**: `claude --dangerously-skip-permissions` (toggle in modal)
- **Codex**: `codex`

Agents run in the repo directory you specify. Completion detected via `<promise>TASK COMPLETE</promise>` tag.

## Data

State and logs stored in `./data/`:
- `state.json` - loop metadata
- `loops/{id}/log.jsonl` - transcript per loop
