# Alexs-Ralph Project Guidelines

## Issue & Ticket Workflow

### Ticket Format
When creating a ticket, include these sections:
- Summary
- Key Features
- Implementation Phases
- Acceptance Criteria

### Issue Creation
Create issues in this repo using the GitHub CLI:

```bash
gh issue create --repo alexh/alexs-ralph --title "<descriptive title>" --body "<body text>"
```

When creating or editing GitHub issues, use `--body-file` or a heredoc so newlines render correctly (never include literal `\\n` in issue bodies).

### Assigned Issues
When a user assigns a GitHub issue or ticket to work on:
- Ask clarifying questions first unless the ticket is fully explicit and unambiguous.
- Confirm scope, preferred approach, and edge cases before implementation.

## Ralph Loop Conventions

### Completion Promise
Loops should emit a completion promise tag to signal “done”:

```
<promise>TASK COMPLETE</promise>
```

If a loop needs a custom completion promise, define it explicitly in the prompt and reuse it consistently.

### Stop Conditions
When a loop references acceptance criteria, treat them as explicit stop conditions. Avoid declaring completion until all criteria are satisfied.

## Tech Stack
- **Runtime**: Bun (not npm/node)
- **Language**: TypeScript
- **TUI**: blessed

### Package Management
Always use `bun` instead of `npm`:
```bash
bun install        # not npm install
bun run build      # not npm run build
bun run start      # not npm start
```

## Repository
- GitHub repo: https://github.com/alexh/alexs-ralph
- Use `gh` for issue operations and keep logs in the project directory.
