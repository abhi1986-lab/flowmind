# @flowmind/ai-providers

Pluggable, provider-agnostic AI interface.

Core: AIProvider interface with methods like:
- summarizeWorkflow(context)
- extractSteps(context)
- generateSOPDraft(workflow, context)
- detectDecisionPoints(...)
- suggestAutomation(...)

Implementations (one per supported provider):
- OpenAIProvider
- ClaudeProvider
- GeminiProvider
- AzureOpenAIProvider
- OllamaProvider
- etc.

Business logic (workflow module, SOP module) depends **only** on the interface, never on a concrete SDK.

Selected at runtime from client_routes.ai_config_ref (per-client LLM config).

MVP: Start with stub / one provider. Full interface first.
