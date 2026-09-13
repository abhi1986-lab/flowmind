import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { AgentSessionsController } from './agent-sessions.controller';
import { TimelineBuilder } from './timeline.builder';
import { SopDraftGenerator } from './sop.generator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ClientResolverGuard } from '../client-resolver/client-resolver.guard';

describe('AgentSessionsController (M1 thin spine)', () => {
  let controller: AgentSessionsController;
  let timelineBuilder: TimelineBuilder;
  let sopDraftGenerator: SopDraftGenerator;

  const mockTimelineBuilder = {
    buildTimeline: jest.fn().mockReturnValue([
      { stepNo: 1, title: 'Test App', description: 'Did something', action: 'Open Test App' },
    ]),
  };

  const mockSopDraftGenerator = {
    generateSopDraft: jest.fn().mockResolvedValue({
      title: 'Test SOP',
      purpose: 'Test',
      scope: 'Test',
      prerequisites: [],
      procedure: ['1. Do test'],
      decisionPoints: [],
      exceptions: [],
      checklist: [],
    }),
  };

  const mockReq: any = {
    accessScope: { clientId: 'test-client', role: 'CONTRIBUTOR', permissions: [] },
    user: { sub: 'u1', email: 'contributor@acme.test' },
    clientPrisma: {
      event: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'e1',
            sequenceNo: 1,
            eventType: 'APP_CHANGED',
            appName: 'Test',
            windowTitle: 'Win',
          },
        ]),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      workflow: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'w1' }),
        create: jest.fn().mockResolvedValue({ id: 'w1', title: 'Workflow from session sess1' }),
      },
      sopDocument: {
        create: jest.fn().mockResolvedValue({ id: 's1', status: 'DRAFT' }),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      user: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      session: {
        create: jest.fn().mockResolvedValue({ id: 'sess1', status: 'CREATED' }),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({ id: 'sess1', status: 'STOPPED' }),
      },
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockReq.accessScope = { clientId: 'test-client', role: 'CONTRIBUTOR', permissions: [] };
    mockReq.clientPrisma.session.findUnique.mockResolvedValue({
      id: 'sess1',
      status: 'STOPPED',
    });
    mockReq.clientPrisma.workflow.findFirst.mockResolvedValue(null);
    mockReq.clientPrisma.workflow.upsert.mockResolvedValue({ id: 'w1' });
    mockReq.clientPrisma.workflow.create.mockResolvedValue({
      id: 'w1',
      title: 'Workflow from session sess1',
    });
    mockReq.clientPrisma.sopDocument.create.mockResolvedValue({ id: 's1', status: 'DRAFT' });
    mockTimelineBuilder.buildTimeline.mockReturnValue([
      { stepNo: 1, title: 'Test App', description: 'Did something', action: 'Open Test App' },
    ]);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentSessionsController],
      providers: [
        { provide: TimelineBuilder, useValue: mockTimelineBuilder },
        { provide: SopDraftGenerator, useValue: mockSopDraftGenerator },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ClientResolverGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AgentSessionsController>(AgentSessionsController);
    timelineBuilder = module.get<TimelineBuilder>(TimelineBuilder);
    sopDraftGenerator = module.get<SopDraftGenerator>(SopDraftGenerator);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should create session', async () => {
    const result = await controller.createSession(mockReq, {});
    expect(result.sessionId).toBe('sess1');
    expect(mockReq.clientPrisma.session.create).toHaveBeenCalled();
  });

  it('should start and stop session', async () => {
    const startRes = await controller.startSession('sess1', mockReq);
    expect(startRes.status).toBe('RECORDING');

    const stopRes = await controller.stopSession('sess1', mockReq);
    expect(stopRes.status).toBe('STOPPED');
  });

  it('uploadEvents rejects metadata.value on APP_CHANGED as 400 BadRequest (Gate 0.3)', async () => {
    await expect(
      controller.uploadEvents(mockReq, {
        sessionId: 'sess1',
        events: [
          {
            sequenceNo: 1,
            eventType: 'APP_CHANGED',
            metadata: { value: 'smuggled keystrokes' },
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockReq.clientPrisma.event.createMany).not.toHaveBeenCalled();
  });

  it('uploadEvents rejects metadata.focusedValue on APP_CHANGED as 400 BadRequest', async () => {
    await expect(
      controller.uploadEvents(mockReq, {
        sessionId: 'sess1',
        events: [
          {
            sequenceNo: 1,
            eventType: 'APP_CHANGED',
            metadata: { focusedValue: 'smuggled field' },
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockReq.clientPrisma.event.createMany).not.toHaveBeenCalled();
  });

  it('uploadEvents allows TEXT_INPUT / PASTE_INPUT / USER_NOTE declared text', async () => {
    const res = await controller.uploadEvents(mockReq, {
      sessionId: 'sess1',
      events: [
        {
          sequenceNo: 1,
          eventType: 'TEXT_INPUT',
          metadata: { text: 'hello intent' },
        },
        {
          sequenceNo: 2,
          eventType: 'PASTE_INPUT',
          metadata: { value: 'pasted' },
        },
        {
          sequenceNo: 3,
          eventType: 'USER_NOTE',
          metadata: { note: 'operator note' },
        },
        {
          sequenceNo: 4,
          eventType: 'APP_CHANGED',
          metadata: { url: 'https://ok.example', actionHint: 'open' },
        },
      ],
    });
    expect(res.status).toBe('ACCEPTED');
    expect(res.received).toBe(4);
    expect(mockReq.clientPrisma.event.createMany).toHaveBeenCalled();
  });

  describe('record → timeline reliability', () => {
    it('builds timeline and persists workflow in client DB', async () => {
      const result = await controller.buildTimeline('sess1', mockReq);
      expect(result.stepCount).toBe(1);
      expect(result.persisted).toBe(true);
      expect(result.workflowId).toBe('w1');
      expect(timelineBuilder.buildTimeline).toHaveBeenCalled();
      expect(mockReq.clientPrisma.workflow.upsert).toHaveBeenCalled();
    });

    it('404 when session missing for build-timeline', async () => {
      mockReq.clientPrisma.session.findUnique.mockResolvedValue(null);
      await expect(controller.buildTimeline('missing', mockReq)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockReq.clientPrisma.workflow.upsert).not.toHaveBeenCalled();
    });

    it('500 when workflow upsert fails', async () => {
      mockReq.clientPrisma.workflow.upsert.mockRejectedValue(new Error('db down'));
      await expect(controller.buildTimeline('sess1', mockReq)).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });

    it('getTimeline returns persisted steps', async () => {
      mockReq.clientPrisma.workflow.findFirst.mockResolvedValue({
        id: 'w1',
        title: 'WF',
        steps: [{ stepNo: 1, title: 'A', description: 'B' }],
      });
      const result = await controller.getTimeline('sess1', mockReq);
      expect(result.workflowId).toBe('w1');
      expect(result.steps).toHaveLength(1);
    });

    it('getTimeline 404 when no workflow', async () => {
      mockReq.clientPrisma.workflow.findFirst.mockResolvedValue(null);
      await expect(controller.getTimeline('sess1', mockReq)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('SOP DRAFT + human approve', () => {
    it('generates SOP as DRAFT only and persists', async () => {
      const result = await controller.generateSopDraft('sess1', mockReq);
      expect(result.status).toBe('DRAFT');
      expect(result.persisted).toBe(true);
      expect(result.sopDocumentId).toBe('s1');
      expect(sopDraftGenerator.generateSopDraft).toHaveBeenCalled();
      expect(mockReq.clientPrisma.sopDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'DRAFT' }),
        }),
      );
    });

    it('404 when session missing for generate-sop-draft', async () => {
      mockReq.clientPrisma.session.findUnique.mockResolvedValue(null);
      await expect(controller.generateSopDraft('missing', mockReq)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('500 when SOP create fails', async () => {
      mockReq.clientPrisma.workflow.findFirst.mockResolvedValue({
        id: 'w1',
        title: 'WF',
        steps: [],
      });
      mockReq.clientPrisma.sopDocument.create.mockRejectedValue(new Error('db'));
      await expect(controller.generateSopDraft('sess1', mockReq)).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });

    it('getSop returns DRAFT content', async () => {
      mockReq.clientPrisma.workflow.findFirst.mockResolvedValue({ id: 'w1' });
      mockReq.clientPrisma.sopDocument.findFirst.mockResolvedValue({
        id: 's1',
        status: 'DRAFT',
        content: { title: 'T' },
      });
      const result = await controller.getSop('sess1', mockReq);
      expect(result.status).toBe('DRAFT');
      expect(result.sopDocumentId).toBe('s1');
    });

    it('submit-review transitions DRAFT → IN_REVIEW', async () => {
      mockReq.clientPrisma.sopDocument.findUnique.mockResolvedValue({
        id: 's1',
        status: 'DRAFT',
      });
      mockReq.clientPrisma.sopDocument.update.mockResolvedValue({
        id: 's1',
        status: 'IN_REVIEW',
      });
      const result = await controller.submitForReview('s1', mockReq);
      expect(result.status).toBe('IN_REVIEW');
    });

    it('submit-review rejects non-DRAFT', async () => {
      mockReq.clientPrisma.sopDocument.findUnique.mockResolvedValue({
        id: 's1',
        status: 'APPROVED',
      });
      await expect(controller.submitForReview('s1', mockReq)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('approve requires reviewer permission and IN_REVIEW', async () => {
      mockReq.accessScope = {
        clientId: 'test-client',
        role: 'REVIEWER',
        permissions: ['REVIEW_SOP'],
      };
      mockReq.clientPrisma.sopDocument.findUnique.mockResolvedValue({
        id: 's1',
        status: 'IN_REVIEW',
      });
      mockReq.clientPrisma.sopDocument.update.mockResolvedValue({
        id: 's1',
        status: 'APPROVED',
      });
      const result = await controller.approveSop('s1', mockReq);
      expect(result.status).toBe('APPROVED');
    });

    it('approve forbids contributor without REVIEW_SOP', async () => {
      mockReq.accessScope = {
        clientId: 'test-client',
        role: 'CONTRIBUTOR',
        permissions: [],
      };
      await expect(controller.approveSop('s1', mockReq)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('reject stores reason and REJECTED status', async () => {
      mockReq.accessScope = {
        clientId: 'test-client',
        role: 'CLIENT_ADMIN',
        permissions: [],
      };
      mockReq.clientPrisma.sopDocument.findUnique.mockResolvedValue({
        id: 's1',
        status: 'IN_REVIEW',
        content: { title: 'T' },
      });
      mockReq.clientPrisma.sopDocument.update.mockResolvedValue({
        id: 's1',
        status: 'REJECTED',
      });
      const result = await controller.rejectSop('s1', { reason: 'needs edits' }, mockReq);
      expect(result.status).toBe('REJECTED');
      expect(result.rejectionReason).toBe('needs edits');
    });

    it('updateSopDraft only while DRAFT/IN_REVIEW', async () => {
      mockReq.clientPrisma.sopDocument.findUnique.mockResolvedValue({
        id: 's1',
        status: 'APPROVED',
        title: 'Old',
        content: {},
      });
      await expect(
        controller.updateSopDraft('s1', { title: 'New' }, mockReq),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('updateSopDraft forbids VIEWER without write perms', async () => {
      mockReq.accessScope = {
        clientId: 'test-client',
        role: 'VIEWER',
        permissions: ['VIEW_SESSIONS'],
      };
      await expect(
        controller.updateSopDraft('s1', { title: 'New' }, mockReq),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockReq.clientPrisma.sopDocument.findUnique).not.toHaveBeenCalled();
    });

    it('updateSopDraft allows CONTRIBUTOR', async () => {
      mockReq.accessScope = {
        clientId: 'test-client',
        role: 'CONTRIBUTOR',
        permissions: ['RECORD_WORKFLOW'],
      };
      mockReq.clientPrisma.sopDocument.findUnique.mockResolvedValue({
        id: 's1',
        status: 'DRAFT',
        title: 'Old',
        content: {},
      });
      mockReq.clientPrisma.sopDocument.update.mockResolvedValue({
        id: 's1',
        status: 'DRAFT',
        title: 'New',
        content: {},
      });
      const result = await controller.updateSopDraft('s1', { title: 'New' }, mockReq);
      expect(result.status).toBe('DRAFT');
    });

    it('submitForReview forbids VIEWER', async () => {
      mockReq.accessScope = {
        clientId: 'test-client',
        role: 'VIEWER',
        permissions: ['VIEW_SESSIONS'],
      };
      await expect(controller.submitForReview('s1', mockReq)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mockReq.clientPrisma.sopDocument.findUnique).not.toHaveBeenCalled();
    });

    it('submitForReview allows CLIENT_ADMIN via role gate', async () => {
      mockReq.accessScope = {
        clientId: 'test-client',
        role: 'CLIENT_ADMIN',
        permissions: [],
      };
      mockReq.clientPrisma.sopDocument.findUnique.mockResolvedValue({
        id: 's1',
        status: 'DRAFT',
      });
      mockReq.clientPrisma.sopDocument.update.mockResolvedValue({
        id: 's1',
        status: 'IN_REVIEW',
      });
      const result = await controller.submitForReview('s1', mockReq);
      expect(result.status).toBe('IN_REVIEW');
    });
  });
});
