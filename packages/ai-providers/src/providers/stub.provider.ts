import { AIProvider, SopContent } from '../index';

export class StubProvider implements AIProvider {
  async polishSOPDraft(raw: SopContent, context?: Record<string, any>): Promise<SopContent> {
    // Basic heuristic polish (same as before for backward)
    const polishedProcedure = raw.procedure.map((step, idx) => {
      let p = step
        .replace('Switched to ', 'Switch to and work in ')
        .replace(/Unknown Window/g, 'the active window');
      // simple continuation note
      if (idx > 0) {
        const prevApp = raw.procedure[idx-1].split(':')[0].split(' - ')[0];
        const currApp = step.split(':')[0].split(' - ')[0];
        if (prevApp === currApp) {
          p = p.replace(/^\d+\. /, `$& (continued in ${currApp}) `);
        }
      }
      return p;
    });

    return {
      ...raw,
      procedure: polishedProcedure,
      // could enhance other fields too
    };
  }
}
