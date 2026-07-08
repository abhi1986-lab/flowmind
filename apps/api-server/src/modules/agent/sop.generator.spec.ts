import { Test, TestingModule } from '@nestjs/testing';
import { SopDraftGenerator, WorkflowStep } from './sop.generator';
import { AIConfig } from '@flowmind/ai-providers';

describe('SopDraftGenerator', () => {
  let generator: SopDraftGenerator;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SopDraftGenerator],
    }).compile();

    generator = module.get<SopDraftGenerator>(SopDraftGenerator);
  });

  it('should be defined', () => {
    expect(generator).toBeDefined();
  });

  const sampleSteps: WorkflowStep[] = [
    { stepNo: 1, title: 'Chrome - Google', description: 'Switched to Chrome window: Google' },
    { stepNo: 2, title: 'Chrome - Google', description: 'Performed mouse click' },
    { stepNo: 3, title: 'VSCode - main.ts', description: 'Switched to VSCode window: main.ts' },
  ];

  it('should generate a complete SOP draft with default structure', async () => {
    const result = await generator.generateSopDraft('Test Workflow', sampleSteps);

    expect(result.title).toBe('Standard Operating Procedure: Test Workflow');
    expect(result.procedure.length).toBeGreaterThan(0);
    expect(result.procedure[0]).toContain('Switch to and work in');
    expect(result.decisionPoints.length).toBeGreaterThan(0);
    expect(result.exceptions.length).toBe(3);
    expect(result.checklist.length).toBe(5);
    expect(result.purpose).toContain('captured from a real session');
  });

  it('should replace "Unknown Window" in procedure', async () => {
    const stepsWithUnknown: WorkflowStep[] = [
      { stepNo: 1, title: 'App', description: 'Switched to App window: Unknown Window' },
    ];
    const result = await generator.generateSopDraft('Test', stepsWithUnknown);
    expect(result.procedure[0]).not.toContain('Unknown Window');
    expect(result.procedure[0]).toContain('the active window');
  });

  it('should add continued note for consecutive same app steps (heuristic)', async () => {
    const consecutive: WorkflowStep[] = [
      { stepNo: 1, title: 'Chrome - Google', description: 'Switched to Chrome window: Google' },
      { stepNo: 2, title: 'Chrome - Google', description: 'Performed mouse click' },
    ];
    const result = await generator.generateSopDraft('Test', consecutive);
    expect(result.procedure[1]).toContain('(continued)');
  });

  it('should detect decision points from step content', async () => {
    const decisionSteps: WorkflowStep[] = [
      { stepNo: 1, title: 'Check if valid', description: 'verify something' },
      { stepNo: 2, title: 'Normal step', description: 'do work' },
    ];
    const result = await generator.generateSopDraft('Test', decisionSteps);
    expect(result.decisionPoints.some(d => d.includes('Check if valid'))).toBe(true);
  });

  it('should use stub AI provider (skip real AI when provider=stub)', async () => {
    const aiConfig: AIConfig = { provider: 'stub' };
    const result = await generator.generateSopDraft('Test', sampleSteps, aiConfig);
    expect(result.procedure.length).toBeGreaterThan(0);
    // With stub it still does heuristic polish
  });

  it('should fallback gracefully if AI provider fails (e.g. bad config)', async () => {
    const badAiConfig: any = { provider: 'grok', apiKey: 'invalid-for-test' };
    const result = await generator.generateSopDraft('Test', sampleSteps, badAiConfig);
    expect(result.procedure.length).toBeGreaterThan(0);
    // Should still return base structure
  });

  it('should handle empty steps gracefully', async () => {
    const result = await generator.generateSopDraft('Empty', []);
    expect(result.procedure).toEqual([]);
    expect(result.decisionPoints.length).toBe(1); // default message
  });

  it('should incorporate URL and focused context into procedure descriptions when present in steps', async () => {
    const richSteps: WorkflowStep[] = [
      { stepNo: 1, title: 'Chrome - Google', description: 'Switched to Chrome window: Google | Focused: search field' },
      { stepNo: 2, title: 'Chrome - Google', description: 'Navigated in Chrome to: https://example.com' },
    ];
    const result = await generator.generateSopDraft('Web Search', richSteps);
    expect(result.procedure[0]).toContain('search field');
    expect(result.procedure[1]).toContain('https://example.com');
  });
});
