# [SEC-HTTP-01] Harden browser and API traffic with headers and distributed rate limits

## Objective

Implement the complete specification under:

```txt
.kiro/specs/SEC-HTTP-01-browser-api-hardening/
```

## Required reading

- `README.md`
- `.kiro/specs/SEC-HTTP-01-browser-api-hardening/requirements.md`
- `.kiro/specs/SEC-HTTP-01-browser-api-hardening/design.md`
- `.kiro/specs/SEC-HTTP-01-browser-api-hardening/tasks.md`
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

P2
