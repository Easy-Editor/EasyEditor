# EasyEditor React Dashboard

## Engine Runtime Boundary

The Dashboard owns one explicit `EngineInstance` in `src/editor/runtime.ts`.
It uses `legacyTrusted` because the current Dashboard plugin chain and remote
UMD modules still rely on same-realm prototype/global behavior. This is an
explicit compatibility decision, not a sandbox claim.

Remote loaders are owned by the engine's `RemoteAdapter`. Policy checks happen
before network, DOM, or WebSocket effects; teardown aborts in-flight work and
removes the resources the adapter can actually own. UMD mutations to global
objects or prototypes cannot be reversed by removing their script elements.
For that reason, a destroyed Dashboard instance cannot safely reclaim an
already-loaded UMD global in the same JavaScript realm; HMR must perform a full
page reload before loading that global again. The Core engine itself is
re-instantiable, but this legacy UMD adapter remains an explicit compatibility
limit.

## AI Gateway

The browser only calls the same-origin `POST /api/ai/chat` endpoint. API keys,
the upstream URL, model, and trusted system prompt are owned by the server and
are never included in the Vite client bundle.

Copy `.env.example` to an ignored local `.env` and configure:

- `EASYEDITOR_AI_API_KEY` (required)
- `EASYEDITOR_AI_MODEL` (optional, defaults to `gpt-4o`)
- `EASYEDITOR_AI_UPSTREAM_URL` (optional, defaults to the existing OpenAI-compatible endpoint)

`pnpm dev` installs the gateway as Vite development middleware. For production,
run `pnpm build:only` and then `pnpm start`; both development and the production
server load the ignored `.env` file when it exists. The dependency-free Node
server serves `dist`, handles SPA fallback, and exposes the same gateway route.

Deployments that serve `dist` from a CDN or another static host **must** provide
their own same-origin `/api/ai/chat` route with the same contract. A static-only
deployment cannot enable AI safely because it has nowhere to keep the API key.
Same-origin routing is only the credential boundary; production deployments
must add TLS, authenticated user/tenant authorization, rate limits/quotas, and
centralized audit logging at the reverse proxy or application boundary.

The outbound canvas context is a bounded projection containing request-local
node aliases, component names, lock state, layout rectangles, and a small
allowlist of presentation text. Raw document/node IDs, revisions, methods,
lifecycles, state, CSS, data sources, structured URL/token fields, and unknown
props are not projected. Allowlisted presentation strings are sent to the AI
service. A conservative pattern filter removes some obvious secret-like values,
but it cannot prove that arbitrary natural-language text is free of credentials
or personal data; do not place sensitive data in presentation fields.

Projection, alias resolution, strict response parsing, and preview run inside a
request-scoped Web Worker. Its MessagePort capability uses
`executionAuthority: 'host'`: the peer can prepare a revision-bound plan, but a
peer `execute` call fails closed. The trusted Dashboard host privately retains
the plan and exposes only filtered assistant text plus a summary derived from
the Host's authoritative preview record. The UI never receives the capability, raw snapshot,
document/node IDs, aliases, plan ID, preview effects, or command payload.

Before the Worker is created, the host inspects only the newest 10 messages and
copies at most 2 KiB of UTF-8 per message and 12 KiB in total. Agent commands
fail closed at the capability boundary: the Dashboard currently allows only a
bounded `Text.text` prop, while inserted nodes must include a finite,
range-checked `$dashboard.rect`; other props and extra fields are denied.

The capability boundary limits *what* the model can change; it does not prove
that a permitted change matches the user's intent. Allowlisted canvas text is
untrusted model input and can contain prompt injection. The Dashboard therefore
stops after preview and shows a structured summary of the host's authoritative
preview record. Only an explicit user confirmation lets the trusted host
synchronously call `approveAndExecute(planId)` for that exact prepared plan.
Rejection, timeout,
dialog close, or a stale document revokes the plan without retrying. This is a
human-intent gate, not protection against XSS or a compromised host UI realm.
