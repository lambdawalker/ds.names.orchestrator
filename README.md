# ds.names.orchestrator

Research personal-name roots using isolated, resumable DeepSeek Harness sessions and the research storage service. Proposed roots remain cited candidates for human review.

The orchestrator now owns an **encrypted credential vault** and a **YAML-configured local service fleet**. Startup asks for a passphrase, launches enabled clients, verifies their boot identities, and injects API credentials into memory through authenticated loopback endpoints. Provider keys are not stored in YAML or generated MCP patches.

See [local services and encrypted credentials](docs/local-services.md) for the port registry, endpoint contract, migration, Linux/Windows setup and agent access.

## Start

Requires Node.js 24+, Git, built sibling client/database checkouts and a local OpenAI-compatible model with tool calling. Use current main checkouts of the orchestrator and each managed service so all bootstrap endpoints are available.

```sh
npm ci
npm run vault:init
# Only if needed:
npm run vault:set -- behindthename
npm run vault:set -- model
# Edit model.id and checkout directories in config.default.yaml:
npm start -- run --config config.default.yaml --names examples/names.json
```

These commands work in Linux shells and PowerShell. Passphrases and provider tokens are entered through hidden terminal prompts, never command-line arguments. The generated storage API token lives in the encrypted vault. For a pre-existing external storage API, save its existing token with `npm run vault:set -- store` and disable managed startup of that service.

Default ports are 4318 for storage, 4319 Wiktionary, 4320 Wikidata, 4321 Behind the Name, 4322 statistics and 4323 Etymology Explorer. Etymology Explorer uses the confirmed staging API without a provider token. Wikimedia Enterprise (4324) remains reserved and disabled because its client is not implemented.

The root milestone still finds roots only. Adaptations, borrowing and other enrichment phases are not automatically enabled by launching additional clients. Managed Wiktionary lookups use the configured local port while preserving the existing source/claim validation boundary. An actual model/GPU benchmark remains a local validation step.

## Results and resuming

```bash
npm start -- status --config config.json --names examples/names.json
# Explicitly reset budgets for failed/budget-stopped tasks, retaining evidence:
npm start -- run --retry-stopped --config config.json --names examples/names.json
```

`run` prints JSON result lines; `status` prints saved task status/statistics/result IDs. Rerun the same command after an interruption to resume unfinished tasks in fresh sessions. Terminal results are reused. `--retry-stopped` explicitly resets task budgets and session-ID history for `failed`/`budget_stopped` tasks while preserving evidence/pending findings; historical Harness logs remain under `dataDir`. `unresolved` and `review_required` tasks are retained as results, not automatically retried.

| Task status | Meaning |
|---|---|
| `review_required` | A candidate root and cited evidence were durably admitted. |
| `unresolved` | Research stopped without an established root, including ambiguous senses. |
| `budget_stopped` | Session/tool/time budget reached; evidence retained. |
| `failed` | Model/session execution failed; saved progress retained. |
| `pending` / `running` | Not completed; safe to resume with the same task identity. |

Exit codes: 0 for completed research outcomes (including unresolved), 2 for failed/budget-stopped tasks, 1 for configuration/service errors, 130 for interruption. An origin result includes its journal finding ID; that does not imply Neo4j projection has finished.

## Memory and tool boundaries

Each name has a deterministic task ID and separate Harness home; every continuation gets a new session ID. Continuations receive bounded durable document/fragment references rather than old conversations. Default limits are four sessions per name, six model steps per session, 24 tool calls, eight source attempts, three minutes per session and ten minutes total. Failed source attempts consume quota before fetching; cached pages do not. A native pre-step guard rejects an excess model request before inference starts and ends a session when Harness's usage/heuristic token meter approaches its configured context capacity. The meter is an estimate, not the model's exact tokenizer. Interrupted session intervals count toward the durable total, including downtime, so crashes cannot reset budgets. Reduce per-session steps/output caps for smaller contexts. The local server's tokenizer/template/context enforcement still matters; no GPU inference benchmark was run here.

Checkpoint metadata is capped at 16 KiB, reserving another 12 KiB for a pending finding inside the store's 32 KiB checkpoint cap. Oversized metadata admissions are refused with a tool error while existing citations remain usable; shorten optional proposal details if the candidate payload exceeds its reservation. A crash after journal admission but before task completion replays the exact pending payload without creating another finding.

The SDK launches a patched `sdk-minimal` profile. Shell, filesystem/image tools, working-directory tools, generic MCP resources and automatic compaction are disabled. Only these combined research MCP tools are advertised:

| Tool | Behavior |
|---|---|
| `lookup_name` | Fetch and store English-edition Wiktionary evidence; return a short etymology preview and offsets. |
| `read_evidence` | Create/read an exact bounded fragment from a document admitted to this task. |
| `submit_root` | Validate citations and spelling, reuse canonical forms, checkpoint and admit a candidate origin. |
| `finish_unresolved` | Save an honest no-root outcome. |

The model cannot choose arbitrary URLs, execute code, or submit unrestricted database findings. This tool profile is not an OS sandbox. Source text remains untrusted evidence. Citation validation proves traceability, not that the model interpreted the etymology correctly. Multiple-source corroboration and human review remain future work.

The standalone source MCP remains reusable. With managed Wiktionary enabled, the private research worker reads from its authenticated local service port; externally managed mode retains direct public-library lookup. Model-facing root tools remain constrained.

## Verification

```bash
npm test
npm run typecheck
```

The tests include the **actual Harness subprocess**, stdio MCP, authenticated HTTP and SQLite storage, with a scripted local OpenAI-compatible model. They verify the advertised four-tool roster and that the storage token is absent from model requests. No GPU, real LLM, external provider key, or Neo4j is required for those tests. Live model quality/VRAM must be checked on your own machine.

Code is MIT. Source evidence retains provider terms and attribution; candidate research output is not a public-redistribution clearance decision. See the [design](docs/superpowers/specs/2026-10-27-root-research-design.md) and [plan](docs/superpowers/plans/2026-10-27-root-research.md).
