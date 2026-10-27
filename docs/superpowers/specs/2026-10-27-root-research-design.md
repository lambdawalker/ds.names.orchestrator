# Root research workflow

User-authorized scope: build the orchestrator here, iterate names with isolated LLM sessions, find roots and save cited results. Extend storage/client as necessary. Provider credential setup is postponed. Existing storage bearer authentication remains required; it is configuration, not a new vault workflow.

## Chosen approach

TypeScript/Node24, official DeepSeek Harness SDK0.2.1-rc.3, locally served OpenAI-compatible model via the pi-ai adapter. MCP exposes bounded research tools; the orchestrator imports the source library rather than launching its standalone MCP server. An additional HTTP API for a public-read source client would add no benefit here. The source client separately gains read-only stdio MCP for reuse by other agents. The store remains the only persistence service and writer of its database directory.

Use sdk-minimal with explicit overlays disabling all shell, filesystem, working-directory and image tools, direct DeepSeek route, compaction and image-offload. No generic storage MCP is exposed to this research profile: a narrow combined research MCP server validates citations and constructs findings deterministically. Dedicated per-task Harness home; no ambient user's Harness profile/home. The profile's effective tool list is verified in an actual subprocess integration test. This is an allowlist configuration, not an OS sandbox.

## Sessions and recovery

Names are UTF-8 JSON: array of strings or {name,language?}. Optional language is the source heading/context hint. Sequential processing avoids competing GPU requests. NFC identity preserves case/accents. Deterministic task ID derives from name/language and workflow version. Every name has its own sessions; bounded continuations receive only task input, durable document/fragment references and bounded notes, not prior conversation history. Limits cover sessions, pre-request steps per session, tools, source attempts and wall time. A native pre-step guard also uses the Harness usage/heuristic token meter to reserve context headroom before continuing. Metadata admission is bounded to16KiB and pending finding to12KiB; compact fragment references avoid repeating locators. ContextWindow/maxOutputTokens are explicit model config, not claims that a given quantization fits a4090.

Task snapshots use revision CAS and idempotent writes. Source documents/fragments are durable before their references enter checkpoints. A pending finding is checkpointed BEFORE record_finding; recovery replays its exact idempotency key/payload then finishes the task. A crash may leave an unreferenced source document, but cannot claim an uncommitted root. A single orchestrator process owns each task; concurrent modifications fail CAS rather than overwrite. Interrupted running tasks resume with a fresh session. Terminal states review_required (candidate root saved), unresolved, budget_stopped, failed are reported distinctly; exhausted names are not silently skipped as successful. No arbitrary script execution, URL selection or direct database writes by the model.

## Tools

- lookup_name(title, language?): English-edition live Wiktionary lookup, store attributed Markdown, checkpoint IDs/section bounds, return a short etymology preview. Cache by saved title/language within task. Limit document references8 by default.
- read_evidence(document_id,offset,limit<=4000): require a document admitted to this task, create a precise persisted fragment, checkpoint it, return exact text and citation ID. No arbitrary document access.
- submit_root(subject language/script/kind, root form, citation_ids, meaning?,meaning_language?,interpretation): require admitted fragments, root spelling present in cited text, meaning paired with its language, subject matches the input name/context. Resolve existing forms by exact canonical identity. Deterministic IDs; host constructs candidate origin with explicit subject_form_id and evidence IDs. No invented intermediate transmission edges. Root and subject can coincide; ambiguity remains separate task input/context or origin_sense. Candidate semantic correctness requires review.
- finish_unresolved(reason): stop without manufacturing a root.

Source content is untrusted evidence, never instructions. Each tool validates inputs and output limits. Store errors cannot be converted into fabricated success. Source/store tokens never enter prompts or model request bodies. A local model may be keyless; a nonsecret placeholder is allowed if its protocol adapter requires one. Only explicitly configured endpoints are used.

## Storage changes

Backward-compatible origin.subject_form_id validation/hydration/graph reference. Exact get_form_by_identity. Durable research_tasks and task_writes with CAS/idempotent receipts, get/save operations through HTTP and existing MCP. Task metadata is not projected into Neo4j. SQLite finding journal/outbox semantics remain unchanged; saved candidate root does not imply graph projection already applied.

## Delivery

CLI run/status commands, example config/names, Windows/Linux setup, offline tests and actual Harness+stdioMCP+HTTPstore integration with a scripted local OpenAI-compatible model. Real GPU/LMStudio inference must be validated on the user's machine; no local GPU/model is available in this workspace. Source live behavior is independently checked by the client. Publish reviewable PRs across all3repos; do not merge implementation changes without user direction.
