import { Injectable } from '@nestjs/common';
import {
  AIProvider,
  createAIProvider,
  AIConfig,
  SopContent as AISopContent,
} from '@flowmind/ai-providers';

export interface WorkflowStep {
  stepNo: number;
  title: string;
  description: string;
  action?: string;
}

export type SopContent = AISopContent;

function cleanNoise(s: string): string {
  return s
    .replace(/\s*\|\s*Document:\s*missing value/gi, '')
    .replace(/\s*\|\s*Focused:\s*missing value/gi, '')
    .replace(/\(missing value\)/gi, '')
    .replace(/missing value/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}

@Injectable()
export class SopDraftGenerator {
  /**
   * Build a human-reviewable SOP draft from workflow steps.
   * Prefer step.action / description as imperative procedure lines (not window inventory).
   */
  async generateSopDraft(
    workflowTitle: string,
    steps: WorkflowStep[],
    aiConfig?: AIConfig,
  ): Promise<SopContent> {
    const apps = uniqueApps(steps);

    // Prefer action text only (titles like "Chrome: #gallery" are noisy in procedure)
    const rawLines = steps
      .map((step) => cleanNoise(step.action || step.description || ''))
      .filter(Boolean)
      // Drop residual "open page …; open page …" duplication inside a line
      .map((line) =>
        line
          .replace(/(Open page "[^"]+" \([^)]+\))(?:[.;]\s*\1)+/gi, '$1')
          .replace(/;\s*open page "[^"]+" \([^)]+\)/gi, '')
          .replace(/\s{2,}/g, ' ')
          .trim(),
      )
      .filter(Boolean);

    // Collapse consecutive identical (or near-identical) lines
    const collapsed: string[] = [];
    for (const line of rawLines) {
      const prev = collapsed[collapsed.length - 1];
      if (prev && normalizeLine(prev) === normalizeLine(line)) continue;
      // Skip pure click-echo of previous navigation
      if (
        prev &&
        /open |go to |switch to /i.test(prev) &&
        /^in .+, click on /i.test(line) &&
        shareUrlish(prev, line)
      ) {
        collapsed[collapsed.length - 1] = `${prev}. Interact with the page`;
        continue;
      }
      collapsed.push(line);
    }

    const procedure = collapsed.map((body, idx) => `${idx + 1}. ${body}`);

    // Polish weakly without inventing facts
    const polishedProcedure = this.polishSop(procedure, steps);

    let aiPolished: Partial<SopContent> | null = null;
    if (aiConfig && aiConfig.provider !== 'stub') {
      try {
        const provider: AIProvider = createAIProvider(aiConfig);
        const rawSop: SopContent = {
          title: `Standard Operating Procedure: ${workflowTitle}`,
          purpose: purposeText(workflowTitle),
          scope: scopeText(workflowTitle, apps),
          prerequisites: defaultPrereqs(apps),
          procedure: polishedProcedure,
          decisionPoints: [],
          exceptions: defaultExceptions(),
          checklist: defaultChecklist(),
        };
        aiPolished = await provider.polishSOPDraft(rawSop, {
          workflowTitle,
          stepCount: steps.length,
          instruction:
            'Preserve all concrete apps, URLs, UI control names, and selections. Convert window-switch noise into clear operator actions. Do not invent clicks or fields that were not captured.',
        });
      } catch (err) {
        console.warn('AI polishing failed, falling back to heuristic:', err);
      }
    }

    const decisionPoints = steps
      .filter((s) =>
        /decide|if |check|verify|confirm|choose|select|branch|error|exception|approve|reject/i.test(
          `${s.title} ${s.description} ${s.action || ''}`,
        ),
      )
      .map((s) => {
        const n = s.stepNo;
        const label = cleanNoise(s.action || s.title);
        return `${n}. ${label} — confirm expected outcome before continuing`;
      });

    if (decisionPoints.length === 0) {
      decisionPoints.push(
        'If the UI does not match a step (control missing, different label, unexpected page), pause and update the SOP or escalate.',
      );
    }

    const base: SopContent = {
      title: `Standard Operating Procedure: ${workflowTitle}`,
      purpose: purposeText(workflowTitle),
      scope: scopeText(workflowTitle, apps),
      prerequisites: defaultPrereqs(apps),
      procedure: polishedProcedure,
      decisionPoints,
      exceptions: defaultExceptions(),
      checklist: defaultChecklist(),
    };

    if (aiPolished) {
      return {
        title: aiPolished.title || base.title,
        purpose: aiPolished.purpose || base.purpose,
        scope: aiPolished.scope || base.scope,
        prerequisites: aiPolished.prerequisites?.length
          ? aiPolished.prerequisites
          : base.prerequisites,
        // Prefer AI procedure only if non-empty; still cleaned
        procedure: (aiPolished.procedure?.length ? aiPolished.procedure : polishedProcedure).map(
          cleanNoise,
        ),
        decisionPoints: aiPolished.decisionPoints?.length
          ? aiPolished.decisionPoints
          : decisionPoints,
        exceptions: aiPolished.exceptions?.length ? aiPolished.exceptions : base.exceptions,
        checklist: aiPolished.checklist?.length ? aiPolished.checklist : base.checklist,
      };
    }

    return base;
  }

  private polishSop(procedure: string[], steps: WorkflowStep[]): string[] {
    return procedure.map((step, idx) => {
      let polished = cleanNoise(step)
        .replace(/Switched to /gi, 'Switch to ')
        .replace(/Switch to and work in /gi, 'Switch to ')
        .replace(/Unknown Window/gi, 'the active window')
        .replace(/Unknown App/gi, 'the application');

      // If two consecutive steps share app context, mark continuation lightly
      if (idx > 0) {
        const prevApp = (steps[idx - 1]?.title || '').split(/[:\-]/)[0]?.trim();
        const curApp = (steps[idx]?.title || '').split(/[:\-]/)[0]?.trim();
        if (prevApp && curApp && prevApp === curApp && !polished.includes('(continued)')) {
          // only for pure switch-style leftovers
          if (/^\d+\. Switch to /i.test(polished)) {
            polished = polished.replace(/^(\d+\. )/, '$1(continued) ');
          }
        }
      }

      return polished;
    });
  }
}

function purposeText(workflowTitle: string): string {
  return `To document the operational workflow "${workflowTitle}" as performed in a real, consent-based capture session, including application context and in-window UI interactions (focus, selection, navigation), so operators can execute the process consistently.`;
}

function scopeText(workflowTitle: string, apps: string[]): string {
  const appList = apps.length ? apps.join(', ') : 'the applications used during capture';
  return `Applies to "${workflowTitle}". Covers the observed happy path across: ${appList}. Does not cover unobserved edge cases, hidden automation, or steps that were not captured (use User Notes during recording for intent that Accessibility cannot see).`;
}

function defaultPrereqs(apps: string[]): string[] {
  const list = [
    'Access to the applications used in this workflow' +
      (apps.length ? `: ${apps.join(', ')}` : '.'),
    'Required user permissions / accounts for those systems.',
    'macOS Accessibility permission granted to the FlowMind desktop agent (for in-window UI detail).',
    'Any files, URLs, or records referenced in the procedure steps.',
  ];
  return list;
}

function defaultExceptions(): string[] {
  return [
    'If an application, window, URL, or control label differs from the captured step, pause and confirm with a reviewer before improvising.',
    'Never type passwords or secrets into User Notes; secure fields are redacted by design.',
    'If Accessibility cannot expose in-window detail (some Electron/web apps), add a User Note describing the action during capture and refine the SOP in review.',
    'For errors or unexpected dialogs, capture a User Note and follow the team exception process.',
  ];
}

function defaultChecklist(): string[] {
  return [
    'Confirm prerequisites and application access before starting.',
    'Execute steps in order; do not skip decision points.',
    'Verify each UI target (button, field, selection, URL) matches the SOP.',
    'Record deviations via notes or SOP edit during review.',
    'Confirm expected outputs (records updated, files saved, messages sent) at the end.',
    'Submit the SOP for human review before use as training material.',
  ];
}

function normalizeLine(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(×\d+ clicks\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function shareUrlish(a: string, b: string): boolean {
  const urlRe = /https?:\/\/\S+|#[\w-]+/gi;
  const au: string[] = a.match(urlRe) ?? [];
  const bu: string[] = b.match(urlRe) ?? [];
  return au.some((u) => bu.includes(u));
}

function uniqueApps(steps: WorkflowStep[]): string[] {
  const set = new Set<string>();
  for (const s of steps) {
    const blob = `${s.title} ${s.description} ${s.action || ''}`;
    // Heuristic: "Switch to application "X"" or "In X"
    const m1 = blob.match(/application "([^"]+)"/i);
    const m2 = blob.match(/\bIn ([A-Z][\w.\- ]{1,40}?)(?=,| \(|$)/);
    const m3 = (s.title || '').split(/[:\-]/)[0]?.trim();
    if (m1?.[1]) set.add(m1[1]);
    else if (m3 && m3.length < 40 && !/^https?:/i.test(m3)) set.add(m3);
    else if (m2?.[1]) set.add(m2[1].trim());
  }
  return [...set].filter((a) => a && !/unknown/i.test(a));
}
