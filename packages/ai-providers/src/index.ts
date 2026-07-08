export interface SopContent {
  title: string;
  purpose: string;
  scope: string;
  prerequisites: string[];
  procedure: string[];
  decisionPoints: string[];
  exceptions: string[];
  checklist: string[];
}

export interface AIProvider {
  polishSOPDraft(raw: SopContent, context?: Record<string, any>): Promise<SopContent>;
}

export interface AIConfig {
  provider: 'grok' | 'openai' | 'ollama' | 'stub';
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export { GrokProvider } from './providers/grok.provider';
export { StubProvider } from './providers/stub.provider';
export { OpenAIProvider } from './providers/openai.provider';

import { GrokProvider } from './providers/grok.provider';
import { StubProvider } from './providers/stub.provider';
import { OpenAIProvider } from './providers/openai.provider';

export function createAIProvider(config: AIConfig): AIProvider {
  switch (config.provider) {
    case 'grok':
      return new GrokProvider(config);
    case 'openai':
    case 'ollama':
      // OpenAI-compatible (OpenAI, Grok via baseURL override if needed, Ollama /v1, LM Studio, etc.)
      return new OpenAIProvider(config);
    case 'stub':
    default:
      return new StubProvider();
  }
}
