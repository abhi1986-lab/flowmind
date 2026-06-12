import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ClientResolverGuard } from '../client-resolver/client-resolver.guard';
import type { AuthenticatedRequest } from '../client-resolver/client-resolver.guard';

/**
 * Agent-facing endpoints (MVP).
 * All protected by JwtAuthGuard + ClientResolverGuard (the isolation boundary).
 *
 * These are stubs at foundation stage. Real logic (validation, storage to client DB,
 * artifact pre-signed URLs, etc.) comes after desktop agent + ingestion phases.
 */
@Controller('agent')
@UseGuards(JwtAuthGuard, ClientResolverGuard)
export class AgentSessionsController {
  @Get('config')
  getConfig(@Req() req: AuthenticatedRequest) {
    const scope = req.accessScope;
    return {
      clientId: scope?.clientId,
      // In real: return capture policy from client DB (screenshots enabled, blocklists)
      capturePolicy: {
        screenshotsEnabled: true,
        appBlocklist: ['1Password', 'Bitwarden'],
        windowBlocklist: [],
      },
      message:
        'Agent config (stub). Real policies loaded from client data plane in later phase.',
    };
  }

  @Post('sessions')
  createSession(@Req() req: AuthenticatedRequest, @Body() _body: unknown) {
    const scope = req.accessScope;
    const sessionId = 'sess_' + Date.now();
    void _body; // mark param as used for lint (stub handler)

    // TODO (next): persist to client-scoped DB using scope.clientDbUrl or injected client prisma
    return {
      sessionId,
      status: 'CREATED',
      clientId: scope?.clientId,
      note: 'Session created (stub). Full lifecycle + client DB persistence in Phase 3.',
    };
  }

  @Post('sessions/:id/start')
  startSession(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const scope = req.accessScope;
    return { sessionId: id, status: 'RECORDING', scopeClient: scope?.clientId };
  }

  @Post('sessions/:id/stop')
  stopSession(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const scope = req.accessScope;
    return {
      sessionId: id,
      status: 'STOPPED',
      scopeClient: scope?.clientId,
      note: 'Ready for processing / timeline build (future worker job).',
    };
  }

  @Post('events/batch')
  uploadEvents(
    @Req() req: AuthenticatedRequest,
    @Body() body: { events?: unknown[] },
  ) {
    const scope = req.accessScope;
    // In real: validate, dedupe using sequence, store in client DB scoped to session
    return {
      received: body?.events?.length ?? 0,
      clientId: scope?.clientId,
      status: 'ACCEPTED (stub)',
    };
  }
}
