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
import { TimelineBuilder } from './timeline.builder';
import { SopDraftGenerator } from './sop.generator';

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
  constructor(
    private readonly timelineBuilder: TimelineBuilder,
    private readonly sopDraftGenerator: SopDraftGenerator,
  ) {}

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
  async createSession(
    @Req() req: AuthenticatedRequest,
    @Body() _body: unknown,
  ) {
    const scope = req.accessScope;
    const clientPrisma = req.clientPrisma!;
    const actorUserId = scope?.actorUserId || req.user?.sub || 'demo-user';

    // Ensure demo user exists in this client DB (backbone slice; full users later)
    await clientPrisma.user.upsert({
      where: { id: actorUserId },
      update: {},
      create: {
        id: actorUserId,
        email: req.user?.email || `${actorUserId}@local.test`,
        role: scope?.role || 'CONTRIBUTOR',
      },
    });

    const session = await clientPrisma.session.create({
      data: {
        userId: actorUserId,
        status: 'CREATED',
      },
    });

    void _body;
    return {
      sessionId: session.id,
      status: session.status,
      clientId: scope?.clientId,
    };
  }

  @Post('sessions/:id/start')
  async startSession(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = req.accessScope;
    const clientPrisma = req.clientPrisma!;

    await clientPrisma.session.update({
      where: { id },
      data: {
        status: 'RECORDING',
        startedAt: new Date(),
      },
    });

    return { sessionId: id, status: 'RECORDING', scopeClient: scope?.clientId };
  }

  @Post('sessions/:id/stop')
  async stopSession(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const scope = req.accessScope;
    const clientPrisma = req.clientPrisma!;

    await clientPrisma.session.update({
      where: { id },
      data: {
        status: 'STOPPED',
        endedAt: new Date(),
      },
    });

    return {
      sessionId: id,
      status: 'STOPPED',
      scopeClient: scope?.clientId,
    };
  }

  @Post('events/batch')
  async uploadEvents(
    @Req() req: AuthenticatedRequest,
    @Body() body: { sessionId?: string; events?: any[] },
  ) {
    const scope = req.accessScope;
    const clientPrisma = req.clientPrisma!;
    const sessionId = body.sessionId;
    let events = body.events || [];

    // Strict MVP rule: Reject any typedText or raw keystroke fields (keylogging prohibition)
    const forbidden = events.some((e: any) => 
      e.typedText !== undefined || 
      e.rawKeystrokes !== undefined || 
      (e.metadata && (e.metadata.typedText || e.metadata.keystrokes || e.metadata.raw))
    );
    if (forbidden) {
      throw new Error('Forbidden: typedText or raw keystroke data is not allowed in event ingestion (keylogging prohibition).');
    }

    if (sessionId && events.length > 0) {
      // Basic batch insert for backbone
      await clientPrisma.event.createMany({
        data: events.map((e: any, idx: number) => ({
          sessionId,
          sequenceNo: e.sequenceNo ?? idx + 1,
          eventType: e.eventType,
          timestamp: e.timestamp ? new Date(e.timestamp) : new Date(),
          appName: e.appName,
          windowTitle: e.windowTitle,
          metadata: e.metadata || {},
        })),
      });
    }

    return {
      received: events.length,
      clientId: scope?.clientId,
      status: 'ACCEPTED',
    };
  }

  @Post('sessions/:id/build-timeline')
  async buildTimeline(@Param('id') sessionId: string, @Req() req: AuthenticatedRequest) {
    const scope = req.accessScope;
    const clientPrisma = req.clientPrisma!;

    const events = await clientPrisma.event.findMany({
      where: { sessionId },
      orderBy: { sequenceNo: 'asc' },
    });

    const steps = this.timelineBuilder.buildTimeline(events as any);

    // Store or upsert workflow draft in client DB (unique on sourceSessionId)
    const workflow = await clientPrisma.workflow.upsert({
      where: { sourceSessionId: sessionId },
      update: {
        title: `Workflow from session ${sessionId}`,
        steps: steps as any,
      },
      create: {
        sourceSessionId: sessionId,
        title: `Workflow from session ${sessionId}`,
        steps: steps as any,
      },
    });

    return {
      workflowId: workflow.id,
      sessionId,
      stepCount: steps.length,
      steps,
      clientId: scope?.clientId,
    };
  }

  @Post('sessions/:id/generate-sop-draft')
  async generateSopDraft(@Param('id') sessionId: string, @Req() req: AuthenticatedRequest) {
    const scope = req.accessScope;
    const clientPrisma = req.clientPrisma!;

    // Get or build the workflow for this session
    let workflow = await clientPrisma.workflow.findFirst({
      where: { sourceSessionId: sessionId },
    });

    if (!workflow) {
      // Auto-build timeline if not present (for lean validation flow)
      const events = await clientPrisma.event.findMany({
        where: { sessionId },
        orderBy: { sequenceNo: 'asc' },
      });
      const steps = this.timelineBuilder.buildTimeline(events as any);

      workflow = await clientPrisma.workflow.create({
        data: {
          sourceSessionId: sessionId,
          title: `Workflow from session ${sessionId}`,
          steps: steps as any,
        },
      });
    }

    const steps = (workflow.steps as any[]) || [];
    const sopContent = this.sopDraftGenerator.generateSopDraft(workflow.title, steps);

    const sop = await clientPrisma.sopDocument.create({
      data: {
        workflowId: workflow.id,
        title: sopContent.title,
        status: 'DRAFT',
        content: sopContent as any,
      },
    });

    return {
      sopDocumentId: sop.id,
      workflowId: workflow.id,
      sessionId,
      status: sop.status,
      sop: sopContent,
      clientId: scope?.clientId,
    };
  }
}
