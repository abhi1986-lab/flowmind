import { Test, TestingModule } from '@nestjs/testing';
import { TimelineBuilder } from './timeline.builder';
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
  });

  it('should build action-oriented steps for app and url changes', () => {
    const events: Partial<Event>[] = [
      {
        id: 'e1',
        sequenceNo: 1,
        eventType: 'APP_CHANGED',
        appName: 'Chrome',
        windowTitle: 'Google',
        metadata: { url: 'https://google.com/', pageTitle: 'Google' },
      },
      {
        id: 'e2',
        sequenceNo: 2,
        eventType: 'URL_CHANGED',
        appName: 'Chrome',
        windowTitle: 'Example',
        metadata: { url: 'https://example.com/', pageTitle: 'Example Domain' },
      },
    ];

    const steps = builder.buildTimeline(events as Event[]);
    expect(steps.length).toBeGreaterThanOrEqual(1);
    const blob = steps.map((s) => s.action || s.description).join(' | ');
    expect(blob).toMatch(/Chrome|example\.com|Google/i);
  });

  it('should collapse repeated generic clicks on the same URL', () => {
    const events: Partial<Event>[] = [
      {
        id: 'e1',
        sequenceNo: 1,
        eventType: 'URL_CHANGED',
        appName: 'Google Chrome',
        metadata: {
          url: 'http://127.0.0.1:5173/#gallery',
          pageTitle: 'Clinic',
        },
      },
      {
        id: 'e2',
        sequenceNo: 2,
        eventType: 'MOUSE_CLICK',
        appName: 'Google Chrome',
        metadata: { url: 'http://127.0.0.1:5173/#gallery', pageTitle: 'Clinic' },
      },
      {
        id: 'e3',
        sequenceNo: 3,
        eventType: 'MOUSE_CLICK',
        appName: 'Google Chrome',
        metadata: { url: 'http://127.0.0.1:5173/#gallery', pageTitle: 'Clinic' },
      },
      {
        id: 'e4',
        sequenceNo: 4,
        eventType: 'MOUSE_CLICK',
        appName: 'Google Chrome',
        metadata: { url: 'http://127.0.0.1:5173/#gallery', pageTitle: 'Clinic' },
      },
    ];

    const steps = builder.buildTimeline(events as Event[]);
    // Should not produce 4 nearly identical open+click steps
    expect(steps.length).toBeLessThanOrEqual(2);
    const text = steps.map((s) => s.action).join(' ');
    expect((text.match(/open page/gi) || []).length).toBeLessThanOrEqual(1);
  });

  it('should describe ChatGPT Enter as send message', () => {
    const events: Partial<Event>[] = [
      {
        id: 'e1',
        sequenceNo: 1,
        eventType: 'KEY_ACTION',
        appName: 'ChatGPT',
        windowTitle: 'ChatGPT',
        metadata: {
          action: 'ENTER_SUBMIT',
          actionHint: 'send/submit the message (see prior text step if intent capture was on)',
        },
      },
    ];
    const steps = builder.buildTimeline(events as Event[]);
    expect(steps).toHaveLength(1);
    expect(steps[0].action || steps[0].description).toMatch(/send|submit|message/i);
  });

  it('should surface TEXT_INPUT content in procedure steps', () => {
    const events: Partial<Event>[] = [
      {
        id: 'e1',
        sequenceNo: 1,
        eventType: 'TEXT_INPUT',
        appName: 'ChatGPT',
        metadata: {
          text: 'Rewrite the homepage hero for SEO',
          focusedName: 'Message',
        },
      },
    ];
    const steps = builder.buildTimeline(events as Event[]);
    expect(steps).toHaveLength(1);
    expect(steps[0].action || steps[0].description).toContain('Rewrite the homepage hero for SEO');
  });

  it('should keep distinct SPA hash routes as separate steps', () => {
    const events: Partial<Event>[] = [
      {
        id: 'e1',
        sequenceNo: 1,
        eventType: 'URL_CHANGED',
        appName: 'Google Chrome',
        metadata: { url: 'http://127.0.0.1:5173/#gallery', pageTitle: 'Clinic' },
      },
      {
        id: 'e2',
        sequenceNo: 2,
        eventType: 'URL_CHANGED',
        appName: 'Google Chrome',
        metadata: {
          url: 'http://127.0.0.1:5173/#booking',
          pageTitle: 'Clinic',
          previousUrl: 'http://127.0.0.1:5173/#gallery',
        },
      },
    ];
    const steps = builder.buildTimeline(events as Event[]);
    expect(steps.length).toBe(2);
    expect(steps[0].action).toMatch(/#gallery/);
    expect(steps[1].action).toMatch(/#booking/);
  });

  it('should skip pure Tab spam without focus target', () => {
    const events: Partial<Event>[] = [
      {
        id: 'e1',
        sequenceNo: 1,
        eventType: 'KEY_ACTION',
        appName: 'ChatGPT',
        metadata: { action: 'TAB_NAVIGATION' },
      },
    ];
    expect(builder.buildTimeline(events as Event[])).toHaveLength(0);
  });

  it('should sort by sequenceNo', () => {
    const events: Partial<Event>[] = [
      {
        id: 'e2',
        sequenceNo: 2,
        eventType: 'APP_CHANGED',
        appName: 'B',
        windowTitle: 'B',
      },
      {
        id: 'e1',
        sequenceNo: 1,
        eventType: 'APP_CHANGED',
        appName: 'A',
        windowTitle: 'A',
      },
    ];
    const steps = builder.buildTimeline(events as Event[]);
    expect(steps[0].action || steps[0].description).toMatch(/A/);
    expect(steps[1].action || steps[1].description).toMatch(/B/);
  });
});
