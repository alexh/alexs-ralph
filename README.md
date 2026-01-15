# ALEx - **A**nother **L**oop **Ex**perience

<img src="docs/tutorial.gif" width="100%" alt="ALEx tutorial" />

<img src="docs/demo.gif" width="100%" alt="ALEx demo" />

TUI for running multiple AI coding agents in parallel. Point it at GitHub issues, let Claude, Codex, or Gemini do the work.

Inspired by [ralph-claude-code](https://github.com/frankbria/ralph-claude-code) but without the strict project structure requirements, and with support for multiple agents.

## Features

### Core Loop Management
- Spawn agent loops from GitHub issue URLs
- Parse acceptance criteria from issue markdown (headings + checklists)
- Live transcript streaming with JSONL logging
- Pause/resume/stop loops (SIGSTOP/SIGCONT/SIGTERM)
- Send interventions to agent stdin mid-task
- Cross-session persistence — resume paused loops after restarting

### Intelligent Loop Control
- **Circuit breaker** — Detects stuck loops via:
  - Consecutive iterations with no file changes
  - Repeated errors
  - Test-only saturation (test runs without implementation progress)
  - Output decline (>70% reduction)
- **Acceptance criteria tracking** — Agents mark criteria complete via `<criterion-complete>N</criterion-complete>` tags
- **Multiple completion signals** — `<promise>TASK COMPLETE</promise>`, `EXIT_SIGNAL: true`, keyword patterns
- **Rate limiting** — Per-hour API call limits
- **Timeout management** — 5-minute per-iteration timeout

### Operator Controls
- Live intervention injection mid-execution
- Manual criterion marking
- Manual completion override for stuck loops
- Retry mechanism for errored/stopped loops

### Advanced Features
- **Worktree isolation** — Create isolated git worktrees per loop for parallel branch development (requires `wt` CLI)
- **Cross-agent code review** — Launch review loops from completed work with git diffs
- **Follow-up loops** — Create new loops based on reviewer feedback
- **Auto-review** — Optional automatic review on completion
- **Git baseline tracking** — Detect progress via content hashes
- **Metrics** — Per-agent success rates, daily/weekly trends, failure reasons

## Install

Requires [Bun](https://bun.sh), [GitHub CLI](https://cli.github.com/) authenticated, and at least one agent CLI installed.

```bash
bun install && bun run build && bun link
```

### Optional: Worktree Isolation

For git worktree support (isolated branches per loop), install [worktrunk](https://worktrunk.dev):

```bash
# macOS
brew install max-sixty/tap/worktrunk

# Or via cargo
cargo install worktrunk
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
| `V` | Request review / Navigate review↔original |
| `↑↓` | Navigate loops |
| `Tab` | Cycle filter tabs (All/Running/Paused/Completed/Errors) |
| `R` | Retry errored loop |
| `L` | View full logs |
| `C` | Close issue (when completed) |
| `M` | Mark loop as complete (manual override) |
| `Q` | Quit |

## CLI Commands

ALEx provides several CLI commands beyond the main TUI:

```bash
alex                    # Launch TUI (default)
alex configure          # View/set configuration
alex clean              # Remove orphaned worktrees
alex uninstall          # Remove alex completely
alex help               # Show help
```

### `alex configure`

Persist settings to `~/.alex/config.json`:

```bash
alex configure --list                    # Show current config
alex configure --default-agent gemini    # Set default agent
alex configure --max-iterations 30       # Set max iterations
alex configure --theme light             # UI theme (dark/light)
alex configure --transparency off        # Disable transparent modals
alex configure --editor vim              # Preferred editor
alex configure --stuck-timeout 10        # Stuck timeout in minutes
alex configure --auto-complete off       # Disable auto-complete on criteria
alex configure --worktree-base ~/wt      # Custom worktree directory
```

### `alex clean`

Remove orphaned worktrees (worktrees without active loops):

```bash
alex clean              # Remove with confirmation prompt
alex clean --dry-run    # Show what would be removed
alex clean --force      # Skip confirmation
```

### `alex uninstall`

Interactive wizard to completely remove alex:

```bash
alex uninstall            # Launch uninstall wizard (confirms twice)
alex uninstall --dry-run  # Test the wizard without deleting anything
```

Removes `~/.alex/` directory and runs `bun unlink`.

## Agents

ALEx uses a YAML-based adapter system—any CLI agent can be integrated by defining a config file.

**Built-in adapters:**
- `claude` — Anthropic Claude Code
- `codex` — OpenAI Codex CLI
- `gemini` — Google Gemini CLI

**Custom adapters:** Drop a YAML file in `~/.alex/adapters/` or `./.alex/adapters/`. See `src/adapters/builtin/` for templates.

```yaml
name: my-agent
displayName: My Custom Agent
command: my-agent-cli

availability:
  check: which              # or: exec, exists

spawn:
  args: ["-p", "{{prompt}}"]

continue:
  args: ["--resume", "{{sessionId}}", "-p", "{{prompt}}"]

sessionExtraction:
  patterns: ['"session":\\s*"([^"]+)"']

resumePrompt: |             # optional custom resume template
  RESUMING: {{workSummary}}
  Remaining: {{remainingCriteria}}

meta:
  version: "1.0"
  author: "your-name"
```

### Template Variables
- `{{prompt}}` — Current prompt text
- `{{sessionId}}` — Session ID from previous iteration
- `{{workSummary}}` — Auto-generated summary on resume
- `{{remainingCriteria}}` — List of incomplete criteria
- `{{#skipPermissions}}...{{/skipPermissions}}` — Conditional blocks

Agents run in the repo directory you specify. Completion detected via `<promise>TASK COMPLETE</promise>` tag.

## Loop Lifecycle

| Status | Description |
|--------|-------------|
| Queued | Loop created, waiting to start |
| Running | Agent iterating (max 20 iterations by default) |
| Paused | SIGSTOP sent, can resume same session or across restarts |
| Completed | Exit condition met (completion signal, all criteria done) |
| Stopped | User stopped manually |
| Error | Unrecoverable error or circuit breaker opened |

### Exit Reasons

| Reason | Trigger |
|--------|---------|
| `completion_signal` | `<promise>TASK COMPLETE</promise>` detected |
| `exit_signal` | `EXIT_SIGNAL: true` in RALPH_STATUS block |
| `test_saturation` | 3+ consecutive test-only iterations |
| `circuit_breaker` | No progress, repeated errors, or output decline |
| `max_iterations` | Hit iteration limit |
| `user_stopped` | Manual stop |
| `manual_complete` | Operator override |

## Configuration

User settings persist to `~/.alex/config.json` via `alex configure`. Defaults in `src/config.ts`:

| Setting | Default | Description |
|---------|---------|-------------|
| `MAX_ITERATIONS_DEFAULT` | 20 | Max iterations per loop |
| `ITERATION_TIMEOUT_MS` | 5 min | Per-iteration timeout |
| `CB_NO_PROGRESS_THRESHOLD` | 3 | Circuit breaker: no file changes |
| `CB_SAME_ERROR_THRESHOLD` | 5 | Circuit breaker: repeated errors |
| `CB_OUTPUT_DECLINE_THRESHOLD` | 0.7 | Circuit breaker: output drop |
| `CB_CONSECUTIVE_TEST_THRESHOLD` | 3 | Exit after test-only loops |
| `RATE_LIMIT_CALLS_PER_HOUR` | 100 | API rate limit |

## Data

State and logs stored in `~/.alex/data/`:
- `state.json` — Loop metadata + app settings
- `loops/{id}/log.jsonl` — Transcript per loop (JSONL format)

## Architecture

```
src/
├── index.ts           # TUI entry point
├── config.ts          # Global config & thresholds
├── core/
│   ├── loops.ts       # Loop lifecycle management
│   ├── issues.ts      # GitHub issue parsing
│   ├── analyzer.ts    # Completion/stuck detection
│   ├── circuitBreaker.ts
│   ├── rateLimiter.ts
│   ├── worktree.ts    # Git worktree integration
│   ├── review.ts      # Cross-agent review
│   └── metrics.ts     # Analytics
├── ui/                # Blessed TUI components
└── adapters/          # Agent adapter system
```
