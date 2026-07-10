# [SEC-MCP-01] Enforce fail-closed route security and production perimeter

## Objective

Implement the complete specification under:

```txt
.kiro/specs/SEC-MCP-01-security-hardening/
```

## Required reading

- `README.md`
- `.kiro/specs/SEC-MCP-01-security-hardening/requirements.md`
- `.kiro/specs/SEC-MCP-01-security-hardening/design.md`
- `.kiro/specs/SEC-MCP-01-security-hardening/tasks.md`
- Existing security and AgentOps implementation files referenced by the spec

## Execution rules

- Create a dedicated branch and isolated worktree/session folder.
- Follow `tasks.md` in dependency order.
- Do not touch unrelated behavior.
- Do not commit secrets or real tokens.
- Preserve existing GitHub repository allowlist and protected-branch controls.
- Report validation honestly.

## Definition of done

- All acceptance criteria in `requirements.md` are satisfied.
- Correctness properties in `design.md` are covered.
- Relevant tasks in `tasks.md` are completed.
- `npm run typecheck`, `npm run build`, and `npm test` pass.
- Security-sensitive changes include regression tests.
- Remaining risks and required environment variables are documented.

## Priority

P0
