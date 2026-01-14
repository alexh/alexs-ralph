# PRD: Alex — Multi-Agent Ralph Loop Orchestrator (TUI)

## Overview
Alex is a project-local TUI that orchestrates and monitors multiple “Ralph loops” across different AI agents (Claude, Codex, etc.). It is agent-agnostic and lives outside any vendor-specific CLI (no direct dependency on codex/claude internal APIs). Operators launch loops from GitHub issue links; the TUI fetches the issue, parses acceptance criteria (stop conditions), and manages loop execution and supervision. The system is designed for multi-loop visibility and eventual inter-agent review (agent A reviewing agent B’s output).

The implementation will be in Python using `uv` for environment management and `blessed` for the TUI.

## Goals
- Provide a single TUI to launch, monitor, and manage multiple concurrent Ralph loops.
- Allow loop creation by pasting a GitHub issue URL and auto-derive acceptance criteria as stop conditions.
- Support multiple agent backends via shelling out to their CLIs (e.g., `claude`, `codex exec`).
- Preserve loop context and logs per loop to allow resumption and review.
- Present a cyberpunk / vaporwave themed interface (“Alex”).
- Be user-friendly: clear tabs, clickable navigation, and inline interventions when agents get stuck.

## Non-Goals
- No vendor-specific API integration in v1 (use shell commands only).
- No remote orchestrator or server component in v1 (local-only TUI).
- No automatic code review by other agents in v1 (design for later).
- No “AI-based” acceptance criteria generation beyond parsing issue text.

## Target Users
- Solo developer operating multiple AI loops across different agents.
- A lead who wants centralized observability of multiple agent executions.

## Key User Stories
- As a user, I can open the TUI, paste a GitHub issue URL, and launch a loop with the correct stop conditions.
- As a user, I can click tabs to switch between “Running”, “Paused”, “Completed”, and “All” loops.
- As a user, I can click into a loop and see the conversation transcript and current step.
- As a user, I can type a manual hint or correction into a loop if the agent appears stuck.
- As a user, I can watch multiple loops run concurrently and see their current step, latest output, and status.
- As a user, I can pause, resume, or stop a loop.
- As a user, I can open a loop’s full log and inspect its output history.

## Functional Requirements

### 1) Loop Creation
- Input: GitHub issue URL (e.g., `https://github.com/org/repo/issues/123`).
- Action: Use `gh issue view` to fetch title/body/labels.
- Parse acceptance criteria from issue body:
  - Primary: “Acceptance Criteria” section (heading-based).
  - Secondary: bullet lists under any “Criteria”, “Done When”, or “Stop Conditions” headings.
  - Fallback: detect checklist items (`- [ ]`) anywhere in body.
  - Phase 2: allow manual edit of stop conditions in TUI.
- Infer task summary for display and loop naming from issue title.

### 2) Agent Selection & Launch
- Offer agent types: Claude, Codex, “Custom” (shell command template).
- Launch loops by shelling out to agent CLIs:
  - Example: `claude` or `codex exec` with the loop prompt.
- Pass a standard prompt that includes:
  - Issue title
  - Issue body
  - Parsed acceptance criteria (stop conditions)
  - Loop constraints (iteration limits, run cadence, log path)
- Phase 2: pluggable adapter system for custom invocation templates.

### 3) Loop Execution & Monitoring
- Each loop runs in a managed subprocess.
- Maintain per-loop state:
  - Status: `queued`, `running`, `paused`, `stopped`, `completed`, `error`.
  - Current iteration count.
  - Last output chunk (tail view).
  - Start time, elapsed time, last activity timestamp.
- TUI should support multiple concurrent loops.
- Logs are stored per loop and can be viewed in a scrollable panel.

### 4) Operator Intervention
- When viewing a loop, provide an input area to send a manual hint or correction to the agent.
- The intervention is appended to the loop log and injected into the agent prompt stream.
- Phase 2: allow tagging interventions as “blocking”, “suggestion”, or “clarification”.

### 5) Stop Conditions
- Each loop ends when all acceptance criteria are met, or a manual stop is triggered.
- In v1, rely on the agent’s own loop completion signals and explicit stop conditions in the prompt.
- Allow a max-iterations guard and a manual “Stop” action.

### 6) History & Resume
- Store loop metadata and logs locally under the project directory.
- On startup, show recent loops and allow resuming a paused loop.

### 7) UI / Theming
- Cyberpunk / vaporwave theme:
  - Background: black.
  - Primary: neon pink (#ff4fd8) and cyan (#2de2e6).
  - Secondary: purple accents (#9b5de5) and dim gray for borders.
- Use ASCII box drawing, high-contrast panels, and neon color blocks for active elements.

## UX / TUI Structure

### High-Level Layout
- **Top Tabs**: click to switch views: `All`, `Running`, `Paused`, `Completed`, `Errors`.
- **Left Pane**: Loop list (status, agent, issue ID, elapsed time).
- **Right Pane**: Selected loop detail view.
- **Bottom Bar**: Keybinds and status line.

### Loop Detail View (Right Pane)
- **Header**: loop name, status pill, agent type, issue link.
- **Conversation Panel**: scrollable chat transcript (agent + operator interventions).
- **Acceptance Criteria Panel**: visible checklist of stop conditions (auto-checked when agent reports completion).
- **Controls**: buttons for Pause/Resume/Stop + “Open Logs”.
- **Operator Input**: single-line or multi-line input to inject guidance into the agent.

### UX Details
- Clicking a loop item selects it and updates the detail view.
- Clicking a tab filters the loop list and updates counts.
- Selected loop highlights in neon pink; active agent highlight in cyan.
- Stuck-loop indicator: if no output in N minutes, show a subtle warning badge.

### Keybinds (suggested)
- `N` — New loop (prompt for issue URL + agent).
- `Tab` — Cycle tabs.
- `Enter` — Focus loop detail.
- `P` — Pause/Resume loop.
- `S` — Stop loop.
- `L` — View logs.
- `R` — Refresh issue data.
- `Q` — Quit.

## Visual Style Details

### Color Palette
- Background: #0b0b0f (near-black).
- Text: #eaeaea (high-contrast neutral).
- Primary neon: #ff4fd8 (pink), #2de2e6 (cyan).
- Accent: #9b5de5 (purple), #444 (borders), #1a1a1f (panel background).

### Typography
- Use monospace for log output and conversation transcripts.
- Use bold neon for active tabs and selected loop.

### UI Motifs
- ASCII frames with neon borders.
- Neon corner markers (e.g., `⟐` or `◆`) for active sections.
- Light scanline effect via alternating row colors (optional).

## Data Model

### LoopRecord
- `id`: string
- `issue_url`: string
- `issue_title`: string
- `issue_body`: string
- `acceptance_criteria`: list[string]
- `agent_type`: string (e.g., `claude`, `codex`, `custom`)
- `command`: string
- `status`: enum
- `started_at`: datetime
- `last_activity`: datetime
- `iterations`: int
- `log_path`: string

### Project State
- `loops`: list[LoopRecord]
- `recent_issues`: list[string]

## System Design (v1)

### Components
- `tui/`: UI, layout, keybinds.
- `core/loops.py`: loop lifecycle manager (spawn, pause, resume, stop).
- `core/issues.py`: issue fetcher + acceptance criteria parser (via `gh`).
- `core/state.py`: state persistence to disk.
- `core/logs.py`: log writing and tailing.
- `adapters/`: agent launch templates.

### Process Model
- Each loop is a subprocess launched with a command template.
- The loop prompt includes stop conditions and a completion promise (if supported by agent).
- STDOUT/STDERR are streamed to a log file; tail view in TUI.

## Parsing Acceptance Criteria

### Phase 1 (v1)
- Parse markdown headings (case-insensitive):
  - “Acceptance Criteria”, “Criteria”, “Done When”, “Stop Conditions”.
- Extract bullet lists under matched headings.
- Fallback: parse checkboxes anywhere (`- [ ]` / `- [x]`).

### Phase 2
- UI for editing criteria before launch.
- Persist edited criteria with loop record.

## Extensibility (Phase 2+)
- **Adapter plugins**: JSON/YAML templates for invoking agents.
- **Cross-agent review**: option to launch a reviewer loop on completion.
- **Metrics**: per-loop token/time estimates and success rate.

## Risks & Mitigations
- **CLI instability**: different agent CLIs may change flags.
  - Mitigation: adapter layer + per-agent templates.
- **Stop conditions not honored**: agents may ignore criteria.
  - Mitigation: explicit prompts + max-iteration guard.
- **Concurrent subprocess load**: heavy loops may degrade UI.
  - Mitigation: asyncio subprocess management + buffered logs.

## Milestones

### Phase 1 (v1 MVP)
- TUI layout with tabs, loop list + detail pane.
- GitHub issue fetch via `gh`.
- Acceptance criteria parsing.
- Launch loops via shell command templates.
- Live log tail view.

### Phase 2
- Criteria editing before launch.
- Operator intervention input field.
- Custom agent adapter config.
- Resume paused loops.

### Phase 3
- Cross-agent review workflow.
- Dashboard metrics and completion analytics.

## Open Questions
- What are the canonical CLI commands for each agent (Claude/Codex) and required flags?
- Should loop logs be structured (JSONL) or plain text in v1?
- How should the loop completion signal be detected (pattern match, explicit tag, or external status file)?

## Appendix: Example Loop Prompt (Template)

```
You are running a Ralph loop. Complete the task described below. Stop when all acceptance criteria are satisfied.

Issue: <TITLE>

Description:
<BODY>

Acceptance Criteria:
- <CRITERION 1>
- <CRITERION 2>

Constraints:
- Max iterations: <N>
- Write progress to stdout.
- Output "<promise>DONE</promise>" when complete.
```
