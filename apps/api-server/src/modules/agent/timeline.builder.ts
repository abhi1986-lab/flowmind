import { Injectable } from '@nestjs/common';
import { Event } from '@prisma/client'; // or from generated

export interface WorkflowStep {
  stepNo: number;
  title: string;
  description: string;
  eventRefs?: string[];
}

@Injectable()
export class TimelineBuilder {
  /**
   * Converts a list of events (from client DB) into an ordered, grouped workflow timeline.
   * Simple deterministic grouping for MVP:
   * - Group consecutive events in same app/window.
   * - Treat APP_CHANGED / WINDOW_CHANGED as major steps.
   * - Include clicks, safe key actions, user notes as sub-actions.
   * - Reject any typedText or raw keystroke (already filtered at ingestion).
   */
  buildTimeline(events: Event[]): WorkflowStep[] {
    if (!events || events.length === 0) return [];

    // Ensure sorted by sequence or timestamp
    const sorted = [...events].sort((a, b) => {
      if (a.sequenceNo != null && b.sequenceNo != null)
        return a.sequenceNo - b.sequenceNo;
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });

    const steps: WorkflowStep[] = [];
    let currentStepNo = 1;
    let lastApp = '';
    let lastWindow = '';

    for (const ev of sorted) {
      const app = ev.appName || 'Unknown App';
      const win = ev.windowTitle || 'Unknown Window';

      const url = (ev as any).metadata?.url || (ev as any).url;
      const focused = (ev as any).metadata?.focusedElement || (ev as any).focusedName || (ev as any).focusedElement;
      const doc = (ev as any).metadata?.document || (ev as any).document;

      if (
        ev.eventType === 'APP_CHANGED' ||
        ev.eventType === 'WINDOW_CHANGED' ||
        ev.eventType === 'URL_CHANGED' ||
        ev.eventType === 'FOCUS_CHANGED' ||
        app !== lastApp ||
        win !== lastWindow
      ) {
        let description = `Switched to ${app} window: ${win}`;
        if (url) {
          if (ev.eventType === 'URL_CHANGED') {
            description = `Navigated in ${app} to: ${url}`;
          } else {
            description += ` (URL: ${url})`;
          }
        }
        if (focused) {
          description += ` | Focused: ${focused}`;
        }
        if (doc) {
          description += ` | Document: ${doc}`;
        }

        let title = `${app} - ${win}`;
        if (focused) title += ` [${focused}]`;
        if (doc) title += ` (${doc})`;

        steps.push({
          stepNo: currentStepNo++,
          title,
          description,
          eventRefs: [ev.id],
        });
        lastApp = app;
        lastWindow = win;
      } else {
        // Group action inside current context
        let desc = '';
        if (ev.eventType === 'MOUSE_CLICK') desc = 'Performed mouse click';
        else if (ev.eventType === 'KEY_ACTION') {
          const meta = ev.metadata as
            | Record<string, unknown>
            | null
            | undefined;
          desc = `Key action: ${(meta?.action as string) || 'navigation'}`;
        } else if (ev.eventType === 'USER_NOTE') {
          const meta = ev.metadata as
            | Record<string, unknown>
            | null
            | undefined;
          const noteVal: unknown = meta?.note ?? meta ?? '';
          desc = `Note: ${String(noteVal)}`;
        } else if (ev.eventType === 'SCREEN_DELTA')
          desc = 'Significant screen change detected';
        else desc = ev.eventType;

        if (steps.length > 0) {
          const last = steps[steps.length - 1];
          last.description += `. ${desc}`;
          if (last.eventRefs) last.eventRefs.push(ev.id);
          else last.eventRefs = [ev.id];
        } else {
          steps.push({
            stepNo: currentStepNo++,
            title: `${app} action`,
            description: desc,
            eventRefs: [ev.id],
          });
        }
      }
    }

    return steps;
  }
}
