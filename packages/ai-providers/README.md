# @flowmind/ai-providers

Pluggable, provider-agnostic AI interface for FlowMind.

## Usage (switch providers per client)

Configure via `client_routes.aiConfigRef` (JSON string in control DB, seeded in `scripts/seed-control.ts`).

```json
{
  "provider": "grok",           // "grok" | "openai" | "ollama" | "stub"
  "model": "grok-beta",
  "apiKey": "xai-...",          // or set env XAI_API_KEY (grok) / OPENAI_API_KEY
  "baseURL": "https://api.x.ai/v1"   // override for compat (ollama: http://localhost:11434/v1)
}
```

- `stub`: heuristic only, no external calls (default for MVP safety).
- `grok`: xAI Grok (https://api.x.ai/v1). Uses XAI_API_KEY if apiKey omitted.
- `openai`: OpenAI or any OpenAI-compatible. Uses OPENAI_API_KEY.
- `ollama`: Set provider:"ollama", baseURL:"http://localhost:11434/v1", model:"llama3" (no key often required).

In code:
```ts
import { createAIProvider, AIConfig } from '@flowmind/ai-providers';
const provider = createAIProvider(aiConfigFromScope);
const polished = await provider.polishSOPDraft(rawSop, context);
```

SOP generator in api-server automatically uses it when `aiConfig.provider !== 'stub'`.

## Configure Grok (or switch AI)

1. Get key from https://console.x.ai (or OpenAI etc.)
2. Option A (env): `XAI_API_KEY=...` (or `OPENAI_API_KEY`)
3. Option B (per-client): edit seed or run:
   ```sql
   UPDATE client_routes SET ai_config_ref = '{"provider":"grok","model":"grok-beta"}' WHERE ...;
   ```
4. Re-seed or restart API. Call generate-sop-draft on a session -> auto polished SOP.

To switch to any other AI: change `provider` in aiConfigRef + provide key/base. No code change.

Business logic depends only on AIProvider interface. Add new providers by implementing the interface + case in createAIProvider.
