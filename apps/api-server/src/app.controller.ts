import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello() {
    if (!this.appService) {
      // Fallback if DI fails under tsx (should not happen with nest start --watch)
      return {
        name: 'FlowMind AI API',
        description: 'Operational Workflow Intelligence Platform (consent-based)',
        version: '0.1.0-mvp',
        constraints: 'See root README.md and docs-pack for non-negotiable rules.',
      };
    }
    return this.appService.getHello();
  }

  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'flowmind-api',
      timestamp: new Date().toISOString(),
      // Never expose client data plane details or secrets here
    };
  }
}
