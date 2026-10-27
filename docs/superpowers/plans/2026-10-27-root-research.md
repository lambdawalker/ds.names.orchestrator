# Root Research Implementation Plan

> Use superpowers:executing-plans for orchestration; independently delegated store/client tasks use TDD. One final cross-repository review.

**Goal:** Research candidate roots per name using fresh bounded Harness sessions and persist exact citations/results.
**Architecture:** Source library -> scoped research MCP -> authenticated storage HTTP, controlled by a sequential SDK runner.
**Tech Stack:** Node24, TypeScript, Zod, DeepSeek HarnessSDK0.2.1-rc.3, MCP2.4.0.
**Spec:** ../specs/2026-10-27-root-research-design.md

## Global Constraints

- No provider credential wizard; store authentication remains enforced.
- No unrestricted model tools, invented citations, automatic supported status, or history sharing between names.
- Preserve immutable source/finding identity and replay pending findings after crash.
- Every model request uses configured context/output caps; steps/time/tools/sessions are bounded.

## Review Focus

- Crash between finding submission and checkpoint completion replays safely.
- Cross-task forged citation IDs and roots absent from passages are refused.
- Canonical identities reuse existing full forms without immutable metadata conflicts.
- Fresh sessions never inherit another name's conversation; budgets persist across restarts.
- Real Harness profile advertises only intended research tools and reaches the configured local model.

### Task1: Store root/task contracts (delegated)
- [x] RED tests for origin subjects, exact identity lookup, CAS/replay/restart/HTTP.
- [x] Implement additive tables and APIs, contracts subpath, docs; test/typecheck; commit.

### Task2: Source client MCP (delegated)
- [x] RED paging/cache/error/MCP tests.
- [x] Implement bounded read-only MCP, stdio, docs; all tests/typecheck/package; commit.

### Task3: Scoped research tools
**Files:** src/config.ts,store-client.ts,checkpoint.ts,research-tools.ts,research-mcp.ts; tests/research.test.ts.
**Interfaces:** Storage.call(operation,input), ResearchTools.execute(name,input), validated checkpoint schema.
- [x] RED tests for lookup storage, admitted fragments, root citations, candidate creation, identity reuse, pending replay.
- [x] Implement and verify; commit.

### Task4: Session runner and CLI
**Files:** src/harness.ts,runner.ts,cli.ts; tests/runner.test.ts, tests/harness.integration.test.ts; config/names examples andREADME.
**Interfaces:** runNames(inputs,config,sessionFactory); fresh run(prompt) per session; task status persisted by storage.
- [x] RED tests for isolation/continuations/budgets/resume/terminal behavior.
- [x] Implement CLI/profile/SDK adapter, documentation and CI.
- [x] Run full tests/typecheck and real runtime integration with local scripted model; review/fix important findings; publish linkedPRs.
