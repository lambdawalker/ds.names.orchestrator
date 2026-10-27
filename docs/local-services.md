# Local services and encrypted credentials

The orchestrator owns the credential vault and the local process fleet. On startup it asks for the vault passphrase in the terminal, decrypts credentials into memory, starts configured service processes and sends each API credential to its authenticated loopback endpoint. Provider credentials are not written to YAML, generated MCP patches or client configuration files.

## Default ports

| Service | Port | Status |
|---|---:|---|
| Research store | 4318 | Implemented |
| Wiktionary | 4319 | Implemented |
| Wikidata | 4320 | Implemented |
| Behind the Name | 4321 | Implemented; provider key needed for lookups |
| Official statistics | 4322 | Implemented |
| Etymology Explorer | 4323 | Reserved, disabled pending verified Vanguard API documentation |
| Wikimedia Enterprise | 4324 | Reserved, unimplemented |

Each implemented API project ships `config.default.yaml` with its standalone loopback port. The orchestrator's `config.default.yaml` is the launch registry: it supplies each enabled checkout directory and port, overrides that child's port at launch, and rejects collisions before starting anything. Edit this registry when choosing different managed ports. It accepts no credential values. Checkouts need `npm ci`/a completed build before startup.

## First setup (Linux and Windows)

In each implemented source client, database, and orchestrator checkout:

```sh
npm ci
```

In `ds.names.orchestrator`:

```sh
npm run vault:init
# Optional credentialed providers/model/graph:
npm run vault:set -- behindthename
npm run vault:set -- model
npm run vault:set -- neo4j
```

The terminal asks for the passphrase and token without echoing either. `vault:init` creates `.data/credentials.vault` and generates the storage API token automatically. It refuses to overwrite an existing vault. `vault:set` unlocks and atomically replaces the encrypted file; a wrong passphrase leaves the old file intact. Custom paths are supported with `--file PATH`; set `vaultFile` in orchestrator YAML to the same path.

Use at least 12 passphrase characters (at most 1,024 UTF-8 bytes). Encryption uses scrypt with a fixed bounded profile and AES-256-GCM with fresh salt/nonce and authenticated version metadata. Only ciphertext is persisted. Passphrases cannot be supplied as command-line arguments; startup requires an interactive terminal. JavaScript strings and OS process memory are not a guarantee of secure memory erasure.

Edit `config.default.yaml` to select your loaded model ID and checkout directories, then run:

```sh
npm start -- run --config config.default.yaml --names examples/names.json
npm start -- status --config config.default.yaml --names examples/names.json
```

Relative directories are resolved from the launch directory. Linux and PowerShell use the same npm commands; YAML paths may use forward slashes on Windows. Default relative checkout names assume sibling folders named after their GitHub repositories. Stop any separately running process already occupying a configured port before using managed startup.

If migrating an externally managed database, use `npm run vault:set -- store` to save its existing API token and disable the `store` service entry; keep its URL in the `store.baseUrl` setting. An empty service registry retains externally managed operation. The orchestrator now reads its service/model credentials from the vault; old `STORE_API_TOKEN`/`MODEL_API_KEY` environment setup is not the normal startup source. Direct library/Harness APIs remain available for programmatic callers and tests.

## Bootstrap authentication

The orchestrator generates a fresh random **control credential** and boot identifier for every child process. The control credential travels only in the child's process environment and the orchestrator's memory. It is separate from the provider/API token. Before sending any credential, the orchestrator checks the expected service identity and boot identifier at `/health`; it will not seed an unrelated process that happens to own the port.

All managed listeners bind to `127.0.0.1`. Browser Origin requests and unexpected Host names are rejected. No CORS access is enabled. Credential and tool operations require authentication; a local listener is not treated as sufficient authorization.

Source API endpoints:

| Method/path | Purpose |
|---|---|
| `GET /health` | Non-secret service identity, boot identifier and credential-loaded boolean |
| `POST /v1/credentials` | Set or replace the in-memory provider token using `{ "token": "..." }`; `{ "token": null }` clears it |
| `GET /v1/tools` | Authenticated MCP tool descriptions |
| `POST /v1/tools/TOOL_NAME` | Authenticated validated MCP call; body is the tool arguments object |

The credential endpoint authenticates with `Authorization: Bearer CONTROL_CREDENTIAL`, accepts bounded JSON and never returns the credential. Behind the Name lookups return locked status until its token is loaded. Public Wiktionary/Wikidata/IBGE operations do not require a provider token; their endpoints can retain one in memory but do not send it to a public provider unnecessarily. Rotating/clearing a credential discards that epoch's MCP bridge/cache; a request whose upload crosses rotation must retry and cannot instantiate a revoked credential.

The research store uses the same `/health` and `/v1/credentials` bootstrap convention but keeps its existing `/v1/operations/OPERATION` application API. Its control credential only seeds/rotates the storage API token. Application operations use the seeded API token, and are unavailable while it is not loaded. Legacy standalone storage-token environment configuration remains supported when managed control mode is not enabled. Neo4j connection parameters are non-secret YAML settings; its optional password is supplied from the `neo4j` vault entry to the child process environment.

## Agent and orchestrator access

Every source retains its original standalone stdio MCP. `npm run mcp:remote` is an additional stdio proxy to the port-based service. It uses server-side `NAMES_SERVICE_URL` and `NAMES_CONTROL_TOKEN`, with the control credential supplied in memory by a supervising host. It preserves the existing tool descriptions/annotations and sends calls through the authenticated local API. It is a stdio bridge over local HTTP, not a Streamable HTTP `/mcp` endpoint.

The fleet's programmatic `connection(id)` and `callTool(id, name, args)` methods provide private authenticated access without logging/writing control tokens. Managed Wiktionary research uses that connection in the private research MCP worker, reconstructs bounded revision-consistent Markdown pages, and persists evidence through the existing storage API. The root research model still sees exactly the four existing constrained tools; this change does not expose unrestricted database operations or enable all enrichment tools in that workflow.

Startup validates all enabled processes. On failure it stops only processes it launched. After successful startup, research cancellation first lets the runner save its final checkpoint/accounting, then closes the fleet. Normal completion also closes owned services. Credentials therefore disappear with those processes; restart unlocks and reseeds from the encrypted vault. Updating a vault entry affects the next startup unless an application deliberately invokes the rotation endpoint while running. Automatic child restart/hot vault reload is not implemented.

## Etymology Explorer prerequisite

The official provider advertises a Vanguard API, but an executable integration still needs verified documentation for its URLs, operations, authentication scheme, response/error schemas, and provenance/reuse fields. No endpoint or authentication format has been guessed. The `etymology-explorer` entry remains disabled until that contract is supplied. A token alone is not sufficient to implement an unknown API; do not paste tokens into chat.
