import { Injectable } from '@nestjs/common';
import { AIProvider, createAIProvider, AIConfig, SopContent as AISopContent } from '@flowmind/ai-providers';

export interface WorkflowStep {
  stepNo: number;
  title: string;
  description: string;
}

export type SopContent = AISopContent;

@Injectable()
export class SopDraftGenerator {
  /**
   * Deterministic / template-based SOP generator for MVP.
   * No LLM. Pure logic from workflow steps + fixed sections.
   * Output is structured for human review (status DRAFT).
   */
  async generateSopDraft(workflowTitle: string, steps: WorkflowStep[], aiConfig?: AIConfig): Promise<SopContent> {
    const rawProcedure = steps.map((step) => {
      let desc = step.description;
      if (desc.includes('Unknown Window')) {
        desc = desc.replace(/Unknown Window/g, 'the active window');
      }
      return `${step.stepNo}. ${step.title}: ${desc}`;
    });

    let procedure = this.polishSop(rawProcedure, steps);

    // If AI config provided, use AI provider to further polish (Grok/OpenAI/etc. switchable via client_routes.aiConfigRef)
    let aiPolished: Partial<SopContent> | null = null;
    if (aiConfig && aiConfig.provider !== 'stub') {
      try {
        const provider = createAIProvider(aiConfig);
        const rawSop: SopContent = {
          title: `Standard Operating Procedure: ${workflowTitle}`,
          purpose: `To document the operational workflow captured from a real session for consistent execution, training, and process improvement. This SOP was generated from actual user activity to reflect how work is performed in practice.`,
          scope: `Applies to the process "${workflowTitle}". Covers the primary happy path and common variations observed in the captured session. Does not cover unrelated processes or future automation.`,
          prerequisites: [
            'Access to required applications and systems as used in the captured workflow.',
            'Necessary user permissions and credentials.',
            'Any supporting documents or data referenced in the steps.',
          ],
          procedure: rawProcedure,
          decisionPoints: [],
          exceptions: [
            'If an application or window title changes unexpectedly, log the variation and follow the nearest matching step.',
            'For errors or unexpected screens, pause and escalate per team exception handling process.',
            'User notes captured during the session may indicate ad-hoc workarounds or exceptions.',
          ],
          checklist: [
            'Verify all prerequisites are met before starting.',
            'Complete each step in order; do not skip unless documented decision point allows.',
            'Record any deviations in the process log or notes.',
            'At end of procedure, confirm all outputs (files, updates, notifications) were produced as expected.',
            'If this is training use, have reviewer observe and sign off.',
          ],
        };
        aiPolished = await provider.polishSOPDraft(rawSop, { workflowTitle, stepCount: steps.length });
        procedure = aiPolished.procedure || procedure;
      } catch (err) {
        console.warn('AI polishing failed, falling back to heuristic:', err);
      }
    }

    // Simple heuristic for decision points from step titles/descriptions
    const decisionPoints = steps
      .filter((s) =>
        /decide|if|check|verify|confirm|choose|select|branch|error|exception/i.test(
          s.title + ' ' + s.description,
        ),
      )
      .map(
        (s) => `${s.stepNo}. ${s.title} - look for decision or branch point`,
      );

    if (decisionPoints.length === 0) {
      decisionPoints.push(
        'Review steps for any conditional logic or user decisions during execution.',
      );
    }

    // Merge AI polished fields (if provided by Grok/etc) over the defaults; always keep captured procedure facts.
    const base = {
      title: `Standard Operating Procedure: ${workflowTitle}`,
      purpose: `To document the operational workflow captured from a real session for consistent execution, training, and process improvement. This SOP was generated from actual user activity to reflect how work is performed in practice.`,
      scope: `Applies to the process "${workflowTitle}". Covers the primary happy path and common variations observed in the captured session. Does not cover unrelated processes or future automation.`,
      prerequisites: [
        'Access to required applications and systems as used in the captured workflow.',
        'Necessary user permissions and credentials.',
        'Any supporting documents or data referenced in the steps.',
      ],
      procedure,
      decisionPoints,
      exceptions: [
        'If an application or window title changes unexpectedly, log the variation and follow the nearest matching step.',
        'For errors or unexpected screens, pause and escalate per team exception handling process.',
        'User notes captured during the session may indicate ad-hoc workarounds or exceptions.',
      ],
      checklist: [
        'Verify all prerequisites are met before starting.',
        'Complete each step in order; do not skip unless documented decision point allows.',
        'Record any deviations in the process log or notes.',
        'At end of procedure, confirm all outputs (files, updates, notifications) were produced as expected.',
        'If this is training use, have reviewer observe and sign off.',
      ],
    };

    if (aiPolished) {
      return {
        title: aiPolished.title || base.title,
        purpose: aiPolished.purpose || base.purpose,
        scope: aiPolished.scope || base.scope,
        prerequisites: aiPolished.prerequisites?.length ? aiPolished.prerequisites : base.prerequisites,
        procedure,
        decisionPoints: aiPolished.decisionPoints?.length ? aiPolished.decisionPoints : decisionPoints,
        exceptions: aiPolished.exceptions?.length ? aiPolished.exceptions : base.exceptions,
        checklist: aiPolished.checklist?.length ? aiPolished.checklist : base.checklist,
      };
    }

    return base;
  }

  /**
   * Heuristic polishing for better readability.
   * Replaces repetitive patterns, improves language for "Switched to".
   * In full version, this can call AIProvider.polishSOP(rawContent) for LLM refinement.
   */
  private polishSop(procedure: string[], steps: WorkflowStep[]): string[] {
    return procedure.map((step, idx) => {
      let polished = step
        .replace('Switched to ', 'Switch to and work in ')
        .replace(/Unknown Window/g, 'the active window');

      // Group note for consecutive similar switches (simple version)
      if (idx > 0 && steps[idx].title.split(' - ')[0] === steps[idx - 1].title.split(' - ')[0]) {
        polished = polished.replace(/^(\d+\. )/, '$1(continued) ');
      }

      return polished;
    });
  }

  // For full automatic AI polishing:
  // Integrate with @flowmind/ai-providers
  // e.g. after generating raw, call aiProvider.polishSOPDraft(this.rawToText(returnValue))
  // The provider can call LLM with prompt to refine language, group steps, improve structure while preserving captured facts.
}
