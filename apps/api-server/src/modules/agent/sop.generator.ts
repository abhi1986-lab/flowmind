import { Injectable } from '@nestjs/common';

export interface WorkflowStep {
  stepNo: number;
  title: string;
  description: string;
}

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

@Injectable()
export class SopDraftGenerator {
  /**
   * Deterministic / template-based SOP generator for MVP.
   * No LLM. Pure logic from workflow steps + fixed sections.
   * Output is structured for human review (status DRAFT).
   */
  generateSopDraft(workflowTitle: string, steps: WorkflowStep[]): SopContent {
    const procedure = steps.map(
      (step) => `${step.stepNo}. ${step.title}: ${step.description}`,
    );

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

    return {
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
  }
}
