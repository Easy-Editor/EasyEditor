# EasyEditor React Dashboard

## AI Gateway

The browser only calls the same-origin `POST /api/ai/chat` endpoint. API keys,
the upstream URL, model, and trusted system prompt are owned by the server and
are never included in the Vite client bundle.

Copy `.env.example` to an ignored local `.env` and configure:

- `EASYEDITOR_AI_API_KEY` (required)
- `EASYEDITOR_AI_MODEL` (optional, defaults to `gpt-4o`)
- `EASYEDITOR_AI_UPSTREAM_URL` (optional, defaults to the existing OpenAI-compatible endpoint)

`pnpm dev` installs the gateway as Vite development middleware. For production,
run `pnpm build:only` and then `pnpm start`; the dependency-free Node server
serves `dist`, handles SPA fallback, and exposes the same gateway route.

Deployments that serve `dist` from a CDN or another static host **must** provide
their own same-origin `/api/ai/chat` route with the same contract. A static-only
deployment cannot enable AI safely because it has nowhere to keep the API key.
Same-origin routing is only the credential boundary; production deployments
must add TLS, authenticated user/tenant authorization, rate limits/quotas, and
centralized audit logging at the reverse proxy or application boundary.

The outbound canvas context is a bounded projection containing request-local
node aliases, component names, lock state, layout rectangles, and a small
allowlist of presentation text. Raw document/node IDs, revisions, methods,
lifecycles, state, CSS, data sources, URLs, tokens, and unknown props are not sent.
