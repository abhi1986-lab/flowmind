import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello() {
    return {
      name: 'FlowMind AI API',
      description: 'Operational Workflow Intelligence Platform (consent-based)',
      version: '0.1.0-mvp',
      constraints: 'See root README.md and docs-pack for non-negotiable rules.',
    };
  }
}
