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

## Static Server

Run `pnpm build:only` and then `pnpm start` to serve the generated `dist`
directory. The dependency-free Node server serves immutable static assets,
returns `index.html` for client-side routes, and accepts `HOST` and `PORT` from
the process environment.

The server keeps every Dashboard API boundary default-off. The Agent model
Gateway and the other reviewed host routes are enabled only through their
explicit server environment switches.

## Local Agent Relay

For one OpenAI-compatible relay, copy the checked-in template and fill in the
local values:

```bash
cp .env.example .env.local
pnpm dev
```

The simple path uses these server-only variables instead of a JSON document:

```bash
EASY_EDITOR_AGENT_GATEWAY_ENABLED=1
EASY_EDITOR_AGENT_BASE_URL=https://relay.example.com/v1
EASY_EDITOR_AGENT_API_KEY=replace-with-local-secret
EASY_EDITOR_AGENT_MODEL=gpt-4.1
EASY_EDITOR_AGENT_SESSION_TOKEN=replace-with-a-random-local-session-token
EASY_EDITOR_AGENT_PROJECT_ID=replace-with-active-project-id
```

The Agent Workspace header shows the active project id. The browser receives
only the model name and the same-origin Gateway path; it never receives the
relay API key or local session token. In `pnpm dev`, the Vite Gateway injects the
configured flat local session on the server side only for loopback Gateway
requests, so no browser-console cookie step is required. The project id must
still match the active Agent Workspace project.

`EASY_EDITOR_AGENT_PROVIDER_ID` and
`EASY_EDITOR_AGENT_SESSION_COOKIE_NAME` are optional overrides. When overriding
the provider id, set `VITE_DASHBOARD_AGENT_MODEL_PROVIDER_ID` to the same value.
The provider id otherwise defaults to `default`, matching the browser runtime
default. `baseUrl` is the API prefix (for example `/v1`); the Gateway adds
`/chat/completions`.

`EASY_EDITOR_AGENT_GATEWAY_CONFIG_JSON` remains the advanced production and
multi-provider contract. When it is present it is authoritative: the simple
variables are ignored, and invalid JSON fails closed rather than falling back.
The server-side loopback injection exists only in the Vite development plugin;
the production server never performs it. Production must replace the local
cookie-session values with the reviewed HttpOnly/external-session integration
described in the rollout runbook.
