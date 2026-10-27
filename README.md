# ds.names.orchestrator

Research personal-name roots with a local model through DeepSeek Harness. Names run sequentially, each with isolated sessions and durable checkpoints. Evidence and candidate roots are stored through [names.research.store](https://github.com/lambdawalker/names.research.store); source reads use [names.api.wiktionary](https://github.com/lambdawalker/names.api.wiktionary).

This milestone finds candidate roots only. It does not expand adaptations/borrowings or certify etymological truth. A saved root has `status: candidate`, exact source fragments, original-language spelling, and an explicit link to the input name. The research task becomes `review_required`. A fluent prose answer alone cannot complete a task.

## Requirements

- Node.js 24+, npm and Git. See the client's [Linux setup guide](https://github.com/lambdawalker/names.api.wiktionary/blob/main/docs/linux-setup.md) for installing Node via nvm on Ubuntu/Debian/Fedora.
- A running storage API with the root-task operations from [storage PR #2](https://github.com/lambdawalker/names.research.store/pull/2). Existing SQL stores acquire additive task tables at startup; no reset is required.
- LM Studio or another OpenAI-compatible Chat Completions server with **streaming and tool calling** enabled. No particular model/quantization is selected as best; confirm the model's tools/chat template and actual context capacity on your hardware.

Public Wiktionary/WiktAPI reads need no provider credentials. The credential wizard is postponed. The existing storage API still requires its bearer token; the orchestrator uses the same `STORE_API_TOKEN` as the service. That token never enters model prompts or request bodies. An optional `MODEL_API_KEY` comes from your environment if the model endpoint requires authentication; a keyless local endpoint uses a nonsecret placeholder.

## 1. Start storage

Until the storage PR is merged, check out `feat/root-research-tasks` in the storage repository. Use `main` once merged.

Linux/Bash, in a separate terminal:

```bash
git clone https://github.com/lambdawalker/names.research.store.git
cd names.research.store
git checkout feat/root-research-tasks
npm ci
export STORE_API_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
# Copy this value for the orchestrator terminal before starting the service:
printf '%s\n' "$STORE_API_TOKEN"
npm start
```

Windows/PowerShell:

```powershell
git clone https://github.com/lambdawalker/names.research.store.git
cd names.research.store
git checkout feat/root-research-tasks
npm ci
$env:STORE_API_TOKEN = node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))'
$env:STORE_API_TOKEN # Copy this value for the orchestrator terminal.
npm start
```

The API listens on loopback port **4318** by default. Use the storage repository's instructions for Neo4j/Compose and persistent configuration. SQLite durably admits findings even if Neo4j is offline; graph projection remains pending until the worker applies it. Neo4j is not needed for the workflow tests or initial evidence admission, but is needed to query the graph.

## 2. Start the local model

In LM Studio, load a model that supports tool calling, configure its context window to match the project configuration, and start its local server. Its usual API base is `http://127.0.0.1:1234/v1`. See [LM Studio's OpenAI compatibility documentation](https://lmstudio.ai/docs/developer/openai-compat).

Get the model identifier with `curl http://127.0.0.1:1234/v1/models` on Linux, or `Invoke-RestMethod http://127.0.0.1:1234/v1/models` in PowerShell. Set `model.id` to the returned model ID. `contextWindow` is routing metadata; the server must actually load the requested context. A 4090's usable context depends on weights/quantization/KV cache; these defaults are starting limits, not a VRAM benchmark.

## 3. Install and configure the orchestrator

```bash
git clone https://github.com/lambdawalker/ds.names.orchestrator.git
cd ds.names.orchestrator
# Until the implementation PR is merged:
git checkout feat/root-research
npm ci
npm run build
```

Dependencies use exact Git commits for the source/storage packages and an exact Harness developer-preview release. Git must be installed and able to reach GitHub. Allow npm's normal build lifecycle; `--ignore-scripts` prevents these Git packages from building their exports. The source/storage dependencies need not be published to npm. A separate storage **process** is still required: importing its validation contracts does not start the service.

Linux:

```bash
cp config.example.json config.json
export STORE_API_TOKEN='PASTE_THE_SAME_TOKEN_USED_BY_THE_STORAGE_SERVICE'
```

PowerShell:

```powershell
Copy-Item config.example.json config.json
$env:STORE_API_TOKEN = 'PASTE_THE_SAME_TOKEN_USED_BY_THE_STORAGE_SERVICE'
```

**Edit `config.json` first**, replacing `REPLACE_WITH_LOADED_MODEL_ID`. Use your own contact User-Agent. `dataDir` is resolved relative to the launch directory; reuse the same directory/config when resuming. For inference on another machine, change the explicitly configured model base URL and enable that server's network listener. Remote storage URLs require HTTPS. Do not put tokens into JSON configuration.

Then run (same command in Bash and PowerShell):

```sh
npm start -- run --config config.json --names examples/names.json
```

You may instead supply variables through a local ignored `.env` file; the `npm start` command loads it. The program does not provide an interactive credential/vault wizard.

The input is a UTF-8 JSON array of strings or `{ "name": "...", "language": "..." }` objects, up to 1000 names. Language is an optional source/context hint such as `Spanish` on English Wiktionary, not the edition. Include it for ambiguous spellings. Spelling case and accents are preserved. NFC-equivalent spellings share task identity; different language hints do not.

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

The separate source client's read-only MCP is reusable by other agents. This runner imports the client library directly inside its research MCP; it does not need an additional HTTP API or a separately started client MCP process.

## Verification

```bash
npm test
npm run typecheck
```

The tests include the **actual Harness subprocess**, stdio MCP, authenticated HTTP and SQLite storage, with a scripted local OpenAI-compatible model. They verify the advertised four-tool roster and that the storage token is absent from model requests. No GPU, real LLM, external provider key, or Neo4j is required for those tests. Live model quality/VRAM must be checked on your own machine.

Code is MIT. Source evidence retains provider terms and attribution; candidate research output is not a public-redistribution clearance decision. See the [design](docs/superpowers/specs/2026-10-27-root-research-design.md) and [plan](docs/superpowers/plans/2026-10-27-root-research.md).
