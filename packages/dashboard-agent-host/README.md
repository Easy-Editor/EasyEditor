# `@easy-editor/dashboard-agent-host`

Browser-side Dashboard Agent Host adapter for EasyEditor.

The source entry aggregates the proven Dashboard Host implementation while the
published `dist/index.js` is a self-contained bundle. Consumers can use the
direct Host constructor or bind the factory to an already composed Dashboard
runtime in a Vite page.

`createDashboardAgentHostCompatibility` creates the strict EasyDashboard
compatibility tuple. Artifact SHA-256 values are required at delivery time so
the tuple describes the actual immutable runtime, Core, renderer, Host bundle,
static browser bundle, and material manifest rather than mutable source paths.
