import { Test, TestingModule } from '@nestjs/testing';
import { TimelineBuilder, WorkflowStep } from './timeline.builder';
import { Event } from '@prisma/client';

describe('TimelineBuilder', () => {
  let builder: TimelineBuilder;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TimelineBuilder],
    }).compile();

    builder = module.get<TimelineBuilder>(TimelineBuilder);
  });

  it('should be defined', () => {
    expect(builder).toBeDefined();
  });

  it('should return empty array for no events', () => {
    expect(builder.buildTimeline([])).toEqual([]);
    expect(builder.buildTimeline(null as any)).toEqual([]);
    expect(builder.buildTimeline(undefined as any)).toEqual([]);
  });

  it('should build steps for APP_CHANGED and WINDOW_CHANGED', () => {
    const events: Partial<Event>[] = [
      {
        id: 'e1',
        sequenceNo: 1,
        eventType: 'APP_CHANGED',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        appName: 'Chrome',
        windowTitle: 'Google',
      },
      {
        id: 'e2',
        sequenceNo: 2,
        eventType: 'WINDOW_CHANGED',
        timestamp: new Date('2024-01-01T10:01:00Z'),
        appName: 'VSCode',
        windowTitle: 'main.ts',
      },
    ];

    const steps = builder.buildTimeline(events as Event[]);
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({
      stepNo: 1,
      title: 'Chrome - Google',
      description: 'Switched to Chrome window: Google',
      eventRefs: ['e1'],
    });
    expect(steps[1]).toMatchObject({
      stepNo: 2,
      title: 'VSCode - main.ts',
      description: 'Switched to VSCode window: main.ts',
      eventRefs: ['e2'],
    });
  });

  it('should group consecutive actions inside the same app/window', () => {
    const events: Partial<Event>[] = [
      {
        id: 'e1',
        sequenceNo: 1,
        eventType: 'APP_CHANGED',
        timestamp: new Date(),
        appName: 'Chrome',
        windowTitle: 'Docs',
      },
      {
        id: 'e2',
        sequenceNo: 2,
        eventType: 'MOUSE_CLICK',
        timestamp: new Date(),
        appName: 'Chrome',
        windowTitle: 'Docs',
      },
      {
        id: 'e3',
        sequenceNo: 3,
        eventType: 'KEY_ACTION',
        timestamp: new Date(),
        appName: 'Chrome',
        windowTitle: 'Docs',
        metadata: { action: 'TAB' },
      },
      {
        id: 'e4',
        sequenceNo: 4,
        eventType: 'USER_NOTE',
        timestamp: new Date(),
        appName: 'Chrome',
        windowTitle: 'Docs',
        metadata: { note: 'remember this' },
      },
    ];

    const steps = builder.buildTimeline(events as Event[]);
    expect(steps).toHaveLength(1);
    expect(steps[0].description).toContain('Switched to Chrome window: Docs');
    expect(steps[0].description).toContain('Performed mouse click');
    expect(steps[0].description).toContain('Key action: TAB');
    expect(steps[0].description).toContain('Note: remember this');
    expect(steps[0].eventRefs).toEqual(['e1', 'e2', 'e3', 'e4']);
  });

  it('should start a new step when app or window changes', () => {
    const events: Partial<Event>[] = [
      { id: 'e1', sequenceNo: 1, eventType: 'APP_CHANGED', appName: 'Chrome', windowTitle: 'A' },
      { id: 'e2', sequenceNo: 2, eventType: 'MOUSE_CLICK', appName: 'Chrome', windowTitle: 'A' },
      { id: 'e3', sequenceNo: 3, eventType: 'APP_CHANGED', appName: 'VSCode', windowTitle: 'B' },
      { id: 'e4', sequenceNo: 4, eventType: 'KEY_ACTION', appName: 'VSCode', windowTitle: 'B' },
    ];

    const steps = builder.buildTimeline(events as Event[]);
    expect(steps).toHaveLength(2);
    expect(steps[0].title).toBe('Chrome - A');
    expect(steps[1].title).toBe('VSCode - B');
  });

  it('should handle SCREEN_DELTA and other event types', () => {
    const events: Partial<Event>[] = [
      { id: 'e1', sequenceNo: 1, eventType: 'APP_CHANGED', appName: 'App', windowTitle: 'Win' },
      { id: 'e2', sequenceNo: 2, eventType: 'SCREEN_DELTA', appName: 'App', windowTitle: 'Win' },
    ];

    const steps = builder.buildTimeline(events as Event[]);
    expect(steps[0].description).toContain('Significant screen change detected');
  });

  it('should sort events by sequenceNo when available', () => {
    const events: Partial<Event>[] = [
      { id: 'e2', sequenceNo: 2, eventType: 'APP_CHANGED', appName: 'B', windowTitle: 'B' },
      { id: 'e1', sequenceNo: 1, eventType: 'APP_CHANGED', appName: 'A', windowTitle: 'A' },
    ];

    const steps = builder.buildTimeline(events as Event[]);
    expect(steps[0].title).toBe('A - A');
    expect(steps[1].title).toBe('B - B');
  });

  it('should handle URL_CHANGED with url in metadata for any app context', () => {
    const events: Partial<Event>[] = [
      {
        id: 'e1',
        sequenceNo: 1,
        eventType: 'URL_CHANGED',
        timestamp: new Date(),
        appName: 'Chrome',
        windowTitle: 'Google',
        metadata: { url: 'https://example.com' },
      },
    ];

    const steps = builder.buildTimeline(events as Event[]);
    expect(steps).toHaveLength(1);
    expect(steps[0].description).toContain('Navigated in Chrome to: https://example.com');
  });

  it('should handle FOCUS_CHANGED with focusedElement and document for any app', () => {
    const events: Partial<Event>[] = [
      {
        id: 'e1',
        sequenceNo: 1,
        eventType: 'FOCUS_CHANGED',
        timestamp: new Date(),
        appName: 'TextEdit',
        windowTitle: 'notes.txt',
        metadata: { focusedElement: 'text field', document: 'notes.txt', value: 'hello' },
      },
    ];

    const steps = builder.buildTimeline(events as Event[]);
    expect(steps).toHaveLength(1);
    expect(steps[0].title).toContain('[text field]');
    expect(steps[0].description).toContain('Focused: text field');
    expect(steps[0].description).toContain('Document: notes.txt');
  });
});
