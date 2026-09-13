import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  InternalServerErrorException,
  NotFoundException,
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
import {
  EventMetadataSanitizerError,
  sanitizeEventBatch,
} from './event-metadata.sanitizer';
import { AIConfig } from '@flowmind/ai-providers';
import type { Prisma } from '@prisma/client-data';

/**
 * Agent-facing endpoints (MVP).
 * All protected by JwtAuthGuard + ClientResolverGuard (the isolation boundary).
 *
 * Client ops persistence uses req.clientPrisma (@prisma/client-data) only.
 * Control plane models are not reachable from this client.
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
    // Gate 0.3: reject metadata.value (+ cousins) except TEXT_INPUT/PASTE_INPUT/USER_NOTE
    // Fail-closed as 400 Bad Request (not 500) when the batch violates text policy.
    let events: Array<Record<string, unknown>>;
    try {
      events = sanitizeEventBatch(body.events || []);
    } catch (err) {
      if (err instanceof EventMetadataSanitizerError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    if (sessionId && events.length > 0) {
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

    const session = await clientPrisma.session.findUnique({ where: { id: sessionId } });
    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    const events = await clientPrisma.event.findMany({
      where: { sessionId },
      orderBy: { sequenceNo: 'asc' },
    });

    const steps = this.timelineBuilder.buildTimeline(events);

    let workflow: { id: string };
    try {
      workflow = await clientPrisma.workflow.upsert({
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
    } catch (err) {
      console.error('[AgentSessionsController] workflow upsert failed for session', sessionId, err);
      throw new InternalServerErrorException(
        `Failed to persist timeline for session ${sessionId}`,
      );
    }

    return {
      workflowId: workflow.id,
      sessionId,
      stepCount: steps.length,
      steps,
      clientId: scope?.clientId,
      persisted: true,
    };
  }

  @Post('sessions/:id/generate-sop-draft')
  async generateSopDraft(
    @Param('id') sessionId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = req.accessScope;
    const clientPrisma = req.clientPrisma!;

    const session = await clientPrisma.session.findUnique({ where: { id: sessionId } });
    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    let workflow = await clientPrisma.workflow.findFirst({
      where: { sourceSessionId: sessionId },
    });

    let stepsForSop: WorkflowStep[] = [];
    if (!workflow) {
      const events = await clientPrisma.event.findMany({
        where: { sessionId },
        orderBy: { sequenceNo: 'asc' },
      });
      stepsForSop = this.timelineBuilder.buildTimeline(events);

      try {
        workflow = await clientPrisma.workflow.create({
          data: {
            sourceSessionId: sessionId,
            title: `Workflow from session ${sessionId}`,
            steps: stepsForSop as unknown as Prisma.InputJsonValue,
          },
        });
      } catch (err) {
        console.error('[AgentSessionsController] auto workflow create failed for', sessionId, err);
        throw new InternalServerErrorException(
          `Failed to persist timeline before SOP draft for session ${sessionId}`,
        );
      }
    } else {
      stepsForSop = (workflow.steps as unknown as WorkflowStep[]) || [];
    }

    const steps = stepsForSop;
    const wfTitle = workflow.title || `Workflow from session ${sessionId}`;
    const aiConfig = scope?.aiConfig as AIConfig | undefined;
    const sopContent = await this.sopDraftGenerator.generateSopDraft(
      wfTitle,
      steps,
      aiConfig,
    );

    let sop: { id: string; status: string };
    try {
      sop = await clientPrisma.sopDocument.create({
        data: {
          workflowId: workflow.id,
          title: sopContent.title,
          status: 'DRAFT',
          content: sopContent as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      console.error('[AgentSessionsController] sopDocument create failed for session', sessionId, err);
      throw new InternalServerErrorException(
        `Failed to persist SOP DRAFT for session ${sessionId}`,
      );
    }

    return {
      sopDocumentId: sop.id,
      workflowId: workflow.id,
      sessionId,
      status: sop.status,
      sop: sopContent,
      clientId: scope?.clientId,
      persisted: true,
    };
  }

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
      throw new NotFoundException(`No timeline found for session ${sessionId}`);
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
      throw new NotFoundException(`No SOP found for session ${sessionId}`);
    }

    const sop = await clientPrisma.sopDocument.findFirst({
      where: { workflowId: workflow.id },
    });

    if (!sop) {
      throw new NotFoundException(`No SOP draft for session ${sessionId}`);
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

  /** Draft edit / submit: CONTRIBUTOR+ or RECORD_WORKFLOW / REVIEW_SOP. VIEWER denied. */
  private assertCanEditOrSubmitSop(scope: AuthenticatedRequest['accessScope']): void {
    const perms = scope?.permissions || [];
    const role = scope?.role || '';
    if (
      !perms.includes('RECORD_WORKFLOW') &&
      !perms.includes('REVIEW_SOP') &&
      !['CONTRIBUTOR', 'REVIEWER', 'CLIENT_ADMIN'].includes(role)
    ) {
      throw new ForbiddenException('Insufficient permissions to edit or submit SOP');
    }
  }

  @Patch('sop-documents/:id')
  async updateSopDraft(
    @Param('id') id: string,
    @Body() body: { title?: string; content?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = req.accessScope;
    this.assertCanEditOrSubmitSop(scope);
    const clientPrisma = req.clientPrisma!;

    const sop = await clientPrisma.sopDocument.findUnique({ where: { id } });
    if (!sop) throw new NotFoundException('SOP not found');
    if (sop.status !== 'DRAFT' && sop.status !== 'IN_REVIEW') {
      throw new BadRequestException('Can only edit SOPs in DRAFT or IN_REVIEW status');
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
    this.assertCanEditOrSubmitSop(scope);
    const clientPrisma = req.clientPrisma!;

    const sop = await clientPrisma.sopDocument.findUnique({ where: { id } });
    if (!sop) throw new NotFoundException('SOP not found');
    if (sop.status !== 'DRAFT') {
      throw new BadRequestException('Can only submit SOPs that are in DRAFT status');
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
      throw new ForbiddenException('Insufficient permissions to approve SOP');
    }

    const sop = await clientPrisma.sopDocument.findUnique({ where: { id } });
    if (!sop) throw new NotFoundException('SOP not found');
    if (sop.status !== 'IN_REVIEW') {
      throw new BadRequestException('Can only approve SOPs that are IN_REVIEW');
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
      throw new ForbiddenException('Insufficient permissions to reject SOP');
    }

    const sop = await clientPrisma.sopDocument.findUnique({ where: { id } });
    if (!sop) throw new NotFoundException('SOP not found');
    if (sop.status !== 'IN_REVIEW' && sop.status !== 'DRAFT') {
      throw new BadRequestException('Can only reject SOPs that are IN_REVIEW or DRAFT');
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
