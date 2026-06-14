import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ClientResolverGuard } from '../client-resolver/client-resolver.guard';
import type { AuthenticatedRequest } from '../client-resolver/client-resolver.guard';
import { TimelineBuilder, type WorkflowStep } from './timeline.builder';
import { SopDraftGenerator } from './sop.generator';
import type { Prisma } from '@prisma/client';

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
    @Body()
    body: { sessionId?: string; events?: Array<Record<string, unknown>> },
  ) {
    const scope = req.accessScope;
    const clientPrisma = req.clientPrisma!;
    const sessionId = body.sessionId;
    const events = body.events || [];

    // Strict MVP rule: Reject any typedText or raw keystroke fields (keylogging prohibition)
    const forbidden = events.some((e: Record<string, unknown>) => {
      const meta = e['metadata'] as Record<string, unknown> | undefined;
      return (
        e['typedText'] !== undefined ||
        e['rawKeystrokes'] !== undefined ||
        (meta && (meta['typedText'] || meta['keystrokes'] || meta['raw']))
      );
    });
    if (forbidden) {
      throw new Error(
        'Forbidden: typedText or raw keystroke data is not allowed in event ingestion (keylogging prohibition).',
      );
    }

    if (sessionId && events.length > 0) {
      // Basic batch insert for backbone
      await clientPrisma.event.createMany({
        data: events.map((e: Record<string, unknown>, idx: number) => ({
          sessionId,
          sequenceNo: (e['sequenceNo'] as number) ?? idx + 1,
          eventType: e['eventType'] as string,
          timestamp: e['timestamp']
            ? new Date(e['timestamp'] as string)
            : new Date(),
          appName: e['appName'] as string | undefined,
          windowTitle: e['windowTitle'] as string | undefined,
          metadata: (e['metadata'] as Prisma.InputJsonValue) || undefined,
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
  async buildTimeline(
    @Param('id') sessionId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = req.accessScope;
    const clientPrisma = req.clientPrisma!;

    const events = await clientPrisma.event.findMany({
      where: { sessionId },
      orderBy: { sequenceNo: 'asc' },
    });

    const steps = this.timelineBuilder.buildTimeline(events);

    // Store or upsert workflow draft in client DB (unique on sourceSessionId)
    const workflow = await clientPrisma.workflow.upsert({
      where: { sourceSessionId: sessionId },
      update: {
        title: `Workflow from session ${sessionId}`,
        steps: steps as unknown as Prisma.InputJsonValue,
      },
      create: {
        sourceSessionId: sessionId,
        title: `Workflow from session ${sessionId}`,
        steps: steps as unknown as Prisma.InputJsonValue,
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
  async generateSopDraft(
    @Param('id') sessionId: string,
    @Req() req: AuthenticatedRequest,
  ) {
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
      const steps = this.timelineBuilder.buildTimeline(events);

      workflow = await clientPrisma.workflow.create({
        data: {
          sourceSessionId: sessionId,
          title: `Workflow from session ${sessionId}`,
          steps: steps as unknown as Prisma.InputJsonValue,
        },
      });
    }

    const steps = (workflow.steps as unknown as WorkflowStep[]) || [];
    const sopContent = this.sopDraftGenerator.generateSopDraft(
      workflow.title,
      steps,
    );

    const sop = await clientPrisma.sopDocument.create({
      data: {
        workflowId: workflow.id,
        title: sopContent.title,
        status: 'DRAFT',
        content: sopContent as unknown as Prisma.InputJsonValue,
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

  // A. SOP read APIs (lean)
  @Get('sessions/:id/timeline')
  async getTimeline(
    @Param('id') sessionId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = req.accessScope;
    const clientPrisma = req.clientPrisma!;

    const workflow = await clientPrisma.workflow.findFirst({
      where: { sourceSessionId: sessionId },
    });

    if (!workflow) {
      return { sessionId, message: 'No timeline found for session' };
    }

    return {
      workflowId: workflow.id,
      sessionId,
      title: workflow.title,
      steps: workflow.steps,
      clientId: scope?.clientId,
    };
  }

  @Get('sessions/:id/sop')
  async getSop(
    @Param('id') sessionId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = req.accessScope;
    const clientPrisma = req.clientPrisma!;

    const workflow = await clientPrisma.workflow.findFirst({
      where: { sourceSessionId: sessionId },
    });

    if (!workflow) {
      return { sessionId, message: 'No SOP found for session' };
    }

    const sop = await clientPrisma.sopDocument.findFirst({
      where: { workflowId: workflow.id },
    });

    if (!sop) {
      return { sessionId, workflowId: workflow.id, message: 'No SOP draft' };
    }

    return {
      sopDocumentId: sop.id,
      workflowId: workflow.id,
      sessionId,
      status: sop.status,
      sop: sop.content,
      clientId: scope?.clientId,
    };
  }

  // B. SOP review APIs (lean, require basic reviewer role/permission for approve/reject)
  @Patch('sop-documents/:id')
  async updateSopDraft(
    @Param('id') id: string,
    @Body() body: { title?: string; content?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = req.accessScope;
    const clientPrisma = req.clientPrisma!;

    const sop = await clientPrisma.sopDocument.findUnique({ where: { id } });
    if (!sop) throw new Error('SOP not found');
    if (sop.status !== 'DRAFT' && sop.status !== 'IN_REVIEW') {
      throw new Error('Can only edit SOPs in DRAFT or IN_REVIEW status');
    }

    const updated = await clientPrisma.sopDocument.update({
      where: { id },
      data: {
        title: body.title ?? sop.title,
        content: (body.content as Prisma.InputJsonValue) ?? sop.content,
        updatedAt: new Date(),
      },
    });

    return {
      sopDocumentId: updated.id,
      status: updated.status,
      sop: updated.content,
      clientId: scope?.clientId,
    };
  }

  @Post('sop-documents/:id/submit-review')
  async submitForReview(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = req.accessScope;
    const clientPrisma = req.clientPrisma!;

    const sop = await clientPrisma.sopDocument.findUnique({ where: { id } });
    if (!sop) throw new Error('SOP not found');
    if (sop.status !== 'DRAFT') {
      throw new Error('Can only submit SOPs that are in DRAFT status');
    }

    const updated = await clientPrisma.sopDocument.update({
      where: { id },
      data: { status: 'IN_REVIEW', updatedAt: new Date() },
    });

    return {
      sopDocumentId: updated.id,
      status: updated.status,
      clientId: scope?.clientId,
    };
  }

  @Post('sop-documents/:id/approve')
  async approveSop(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const scope = req.accessScope;
    const clientPrisma = req.clientPrisma!;

    const perms = scope?.permissions || [];
    const role = scope?.role || '';
    if (
      !perms.includes('REVIEW_SOP') &&
      !['REVIEWER', 'CLIENT_ADMIN'].includes(role)
    ) {
      throw new Error('Insufficient permissions to approve SOP');
    }

    const sop = await clientPrisma.sopDocument.findUnique({ where: { id } });
    if (!sop) throw new Error('SOP not found');
    if (sop.status !== 'IN_REVIEW') {
      throw new Error('Can only approve SOPs that are IN_REVIEW');
    }

    const updated = await clientPrisma.sopDocument.update({
      where: { id },
      data: { status: 'APPROVED', updatedAt: new Date() },
    });

    return {
      sopDocumentId: updated.id,
      status: updated.status,
      clientId: scope?.clientId,
    };
  }

  @Post('sop-documents/:id/reject')
  async rejectSop(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = req.accessScope;
    const clientPrisma = req.clientPrisma!;

    const perms = scope?.permissions || [];
    const role = scope?.role || '';
    if (
      !perms.includes('REVIEW_SOP') &&
      !['REVIEWER', 'CLIENT_ADMIN'].includes(role)
    ) {
      throw new Error('Insufficient permissions to reject SOP');
    }

    const sop = await clientPrisma.sopDocument.findUnique({ where: { id } });
    if (!sop) throw new Error('SOP not found');
    if (sop.status !== 'IN_REVIEW' && sop.status !== 'DRAFT') {
      throw new Error('Can only reject SOPs that are IN_REVIEW or DRAFT');
    }

    const currentContent =
      (sop.content as unknown as Record<string, unknown>) || {};
    const updatedContent = body.reason
      ? { ...currentContent, rejectionReason: body.reason }
      : currentContent;

    const updated = await clientPrisma.sopDocument.update({
      where: { id },
      data: {
        status: 'REJECTED',
        content: updatedContent as unknown as Prisma.InputJsonValue,
        updatedAt: new Date(),
      },
    });

    return {
      sopDocumentId: updated.id,
      status: updated.status,
      rejectionReason: body.reason,
      clientId: scope?.clientId,
    };
  }
}
