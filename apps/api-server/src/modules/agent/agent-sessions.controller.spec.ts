import { Test, TestingModule } from '@nestjs/testing';
import { AgentSessionsController } from './agent-sessions.controller';
import { TimelineBuilder } from './timeline.builder';
import { SopDraftGenerator } from './sop.generator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ClientResolverGuard } from '../client-resolver/client-resolver.guard';

describe('AgentSessionsController', () => {
  let controller: AgentSessionsController;
  let timelineBuilder: TimelineBuilder;
  let sopDraftGenerator: SopDraftGenerator;

  const mockTimelineBuilder = {
    buildTimeline: jest.fn().mockReturnValue([
      { stepNo: 1, title: 'Test App', description: 'Did something' },
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

  const mockReq = {
    accessScope: { clientId: 'test-client' },
    clientPrisma: {
      event: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'e1', sequenceNo: 1, eventType: 'APP_CHANGED', appName: 'Test', windowTitle: 'Win' },
        ]),
      },
      workflow: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'w1' }),
        create: jest.fn().mockResolvedValue({ id: 'w1' }),
      },
      sopDocument: {
        create: jest.fn().mockResolvedValue({ id: 's1', status: 'DRAFT' }),
      },
      user: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      session: {
        create: jest.fn().mockResolvedValue({ id: 'sess1' }),
        update: jest.fn().mockResolvedValue({}),
      },
    },
  };

  beforeEach(async () => {
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

  it('should build timeline from events', async () => {
    const result = await controller.buildTimeline('sess1', mockReq as any);
    expect(result.stepCount).toBe(1);
    expect(timelineBuilder.buildTimeline).toHaveBeenCalled();
  });

  it('should generate SOP draft', async () => {
    const result = await controller.generateSopDraft('sess1', mockReq as any);
    expect(result.status).toBe('DRAFT');
    expect(sopDraftGenerator.generateSopDraft).toHaveBeenCalled();
  });

  it('should create session', async () => {
    const result = await controller.createSession(mockReq as any, {});
    expect(result.sessionId).toBeDefined();
  });

  it('should start and stop session', async () => {
    const startRes = await controller.startSession('sess1', mockReq as any);
    expect(startRes.status).toBe('RECORDING');

    const stopRes = await controller.stopSession('sess1', mockReq as any);
    expect(stopRes.status).toBe('STOPPED');
  });
});
