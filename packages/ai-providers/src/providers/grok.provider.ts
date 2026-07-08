import { AIProvider, SopContent, AIConfig } from '../index';

export class GrokProvider implements AIProvider {
  private apiKey: string;
  private baseURL: string;
  private model: string;

  constructor(config: AIConfig) {
    this.apiKey = config.apiKey || process.env.XAI_API_KEY || '';
    this.baseURL = config.baseURL || 'https://api.x.ai/v1';
    this.model = config.model || 'grok-beta';
    if (!this.apiKey) {
      throw new Error('GrokProvider requires apiKey (XAI_API_KEY env or in config)');
    }
  }

  async polishSOPDraft(raw: SopContent, context?: Record<string, any>): Promise<SopContent> {
    const systemPrompt = `You are an expert technical writer specializing in Standard Operating Procedures (SOPs).
Polish the provided raw SOP draft. 
Rules:
- Keep all factual steps from the captured workflow (do not invent or remove real actions).
- Improve language: make it clear, professional, action-oriented.
- Group related micro-steps if they are consecutive switches to the same app.
- Replace "Unknown Window" with "the active window" or infer context when possible.
- Improve structure and readability.
- Keep the same JSON keys.
- Output ONLY valid JSON matching the input structure.`;

    const userPrompt = `Here is the raw SOP draft:\n${JSON.stringify(raw, null, 2)}\n\nContext: ${JSON.stringify(context || {})}`;

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Grok API error: ${response.status} ${err}`);
    }

    const json: any = await response.json();
    const content = json.choices?.[0]?.message?.content;

    if (!content) throw new Error('No content from Grok');

    // Extract JSON from possible markdown code block
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, content];
    const polishedJson = jsonMatch[1].trim();

    try {
      const polished: SopContent = JSON.parse(polishedJson);
      // Basic validation
      if (!polished.procedure || !Array.isArray(polished.procedure)) {
        throw new Error('Polished output missing procedure array');
      }
      return polished;
    } catch (parseErr) {
      console.error('Failed to parse Grok response as JSON, falling back to raw + minor clean');
      // Fallback
      return this.basicPolish(raw);
    }
  }

  private basicPolish(raw: SopContent): SopContent {
    const procedure = raw.procedure.map(step =>
      step.replace('Switched to ', 'Switch to and work in ')
          .replace(/Unknown Window/g, 'the active window')
    );
    return { ...raw, procedure };
  }
}
