/**
 * Integration tests: HTTP API surface for the agent spine.
 *
 * Boots the real Nest AppModule (Auth, JWT, ClientResolver, Timeline, SOP)
 * with in-memory control + client data-plane doubles — no Docker required.
 *
 * Covers:
 *  - login
 *  - client isolation (missing header / wrong client)
 *  - session lifecycle
 *  - event batch (accept + keylog rejection)
 *  - timeline build
 *  - SOP draft generation
 *  - SOP read + review (submit / approve)
 */

// Must match JwtAuthGuard hardcoded verify secret + AuthService/Config JWT_SECRET
process.env.ALLOW_DEV_CLIENT_HEADER = 'true';
process.env.JWT_SECRET = 'dev-super-secret-change-in-real-env';
process.env.JWT_EXPIRES_IN = '1h';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { ControlPrismaService } from '../src/common/prisma/control-prisma.service';
import { ClientPrismaFactory } from '../src/common/prisma/client-prisma.factory';

/** Hardcoded demo client id from AuthService (must match JWT.client_id). */
const ACME_CLIENT_ID = '82b84d1d-1708-42cf-b9af-d175c1acc84d';

type Store = {
  users: Map<string, Record<string, unknown>>;
  sessions: Map<string, Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  workflows: Map<string, Record<string, unknown>>;
  sopDocuments: Map<string, Record<string, unknown>>;
};

function createInMemoryClientPrisma() {
  const store: Store = {
    users: new Map(),
    sessions: new Map(),
    events: [],
    workflows: new Map(),
    sopDocuments: new Map(),
  };

  let idSeq = 0;
  const id = (p: string) => `${p}-${++idSeq}`;

  const client = {
    user: {
      upsert: jest.fn(async ({ where, create }: any) => {
        const existing = store.users.get(where.id);
        if (existing) return existing;
        const row = { ...create };
        store.users.set(create.id, row);
        return row;
      }),
    },
    session: {
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: id('sess'),
          userId: data.userId,
          status: data.status || 'CREATED',
          startedAt: data.startedAt || new Date(),
          endedAt: data.endedAt || null,
        };
        store.sessions.set(row.id, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = store.sessions.get(where.id);
        if (!row) throw new Error('Session not found');
        Object.assign(row, data);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: any) => store.sessions.get(where.id) || null),
    },
    event: {
      createMany: jest.fn(async ({ data }: any) => {
        const rows = Array.isArray(data) ? data : [data];
        for (const r of rows) {
          store.events.push({
            id: id('evt'),
            ...r,
            timestamp: r.timestamp instanceof Date ? r.timestamp : new Date(r.timestamp),
          });
        }
        return { count: rows.length };
      }),
      findMany: jest.fn(async ({ where, orderBy }: any) => {
        let rows = store.events.filter((e) => e.sessionId === where.sessionId);
        if (orderBy?.sequenceNo === 'asc') {
          rows = [...rows].sort(
            (a, b) => Number(a.sequenceNo || 0) - Number(b.sequenceNo || 0),
          );
        }
        return rows;
      }),
    },
    workflow: {
      findFirst: jest.fn(async ({ where }: any) => {
        for (const w of store.workflows.values()) {
          if (w.sourceSessionId === where.sourceSessionId) return w;
        }
        return null;
      }),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        for (const [k, w] of store.workflows) {
          if (w.sourceSessionId === where.sourceSessionId) {
            Object.assign(w, update);
            store.workflows.set(k, w);
            return w;
          }
        }
        const row = { id: id('wf'), ...create };
        store.workflows.set(row.id as string, row);
        return row;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: id('wf'), ...data };
        store.workflows.set(row.id, row);
        return row;
      }),
    },
    sopDocument: {
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: id('sop'),
          ...data,
          status: data.status || 'DRAFT',
          updatedAt: new Date(),
        };
        store.sopDocuments.set(row.id, row);
        return row;
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        for (const s of store.sopDocuments.values()) {
          if (where.workflowId && s.workflowId === where.workflowId) return s;
        }
        return null;
      }),
      findUnique: jest.fn(async ({ where }: any) => store.sopDocuments.get(where.id) || null),
      update: jest.fn(async ({ where, data }: any) => {
        const row = store.sopDocuments.get(where.id);
        if (!row) throw new Error('SOP not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      }),
    },
    $disconnect: jest.fn(),
  };

  return { client, store };
}

describe('Agent flow (integration)', () => {
  let app: INestApplication<App>;
  let clientPrisma: ReturnType<typeof createInMemoryClientPrisma>['client'];
  let store: Store;

  beforeAll(async () => {
    const mem = createInMemoryClientPrisma();
    clientPrisma = mem.client;
    store = mem.store;

    const mockControlPrisma = {
      client: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.slug === 'acme') {
            return {
              id: ACME_CLIENT_ID,
              slug: 'acme',
              status: 'active',
              routes: [
                {
                  dbConnectionRef:
                    'postgresql://client_a:client_a_dev@localhost:5433/client_a_db',
                  s3BucketRef: 'client-a-artifacts',
                  vectorNamespace: 'client_a',
                  aiConfigRef: JSON.stringify({ provider: 'stub' }),
                },
              ],
            };
          }
          return null;
        }),
      },
      $connect: jest.fn(),
      $disconnect: jest.fn(),
    };

    const mockFactory = {
      getPrismaClient: jest.fn(() => clientPrisma),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ControlPrismaService)
      .useValue(mockControlPrisma)
      .overrideProvider(ClientPrismaFactory)
      .useValue(mockFactory)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function authHeader(token: string) {
    return {
      Authorization: `Bearer ${token}`,
      'X-Client-Id': 'acme',
    };
  }

  async function loginAs(email: string, password: string) {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    expect(res.body.accessToken).toBeDefined();
    return res.body.accessToken as string;
  }

  describe('Auth', () => {
    it('POST /auth/login returns JWT for demo contributor', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'contributor@acme.test', password: 'demo123' })
        .expect(201);

      expect(res.body).toMatchObject({
        accessToken: expect.any(String),
        user: {
          email: 'contributor@acme.test',
          role: 'CONTRIBUTOR',
          clientId: ACME_CLIENT_ID,
        },
      });
    });

    it('POST /auth/login rejects bad password', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'contributor@acme.test', password: 'wrong' })
        .expect(401);
    });

    it('GET /auth/me returns profile with valid token', async () => {
      const token = await loginAs('contributor@acme.test', 'demo123');
      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.email).toBe('contributor@acme.test');
      expect(res.body.clientId).toBe(ACME_CLIENT_ID);
    });
  });

  describe('Client isolation', () => {
    it('rejects agent routes without JWT', async () => {
      await request(app.getHttpServer())
        .post('/agent/sessions')
        .set('X-Client-Id', 'acme')
        .send({})
        .expect(401);
    });

    it('rejects agent routes without X-Client-Id in dev', async () => {
      const token = await loginAs('contributor@acme.test', 'demo123');
      await request(app.getHttpServer())
        .post('/agent/sessions')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(400);
    });

    it('rejects unknown client slug', async () => {
      const token = await loginAs('contributor@acme.test', 'demo123');
      await request(app.getHttpServer())
        .post('/agent/sessions')
        .set({
          Authorization: `Bearer ${token}`,
          'X-Client-Id': 'not-a-real-client',
        })
        .send({})
        .expect(403);
    });
  });

  describe('End-to-end agent spine', () => {
    let token: string;
    let sessionId: string;
    let sopDocumentId: string;

    it('creates, starts, and stops a session', async () => {
      token = await loginAs('contributor@acme.test', 'demo123');

      const created = await request(app.getHttpServer())
        .post('/agent/sessions')
        .set(authHeader(token))
        .send({})
        .expect(201);

      expect(created.body.sessionId).toBeDefined();
      sessionId = created.body.sessionId;
      expect(created.body.status).toBe('CREATED');

      const started = await request(app.getHttpServer())
        .post(`/agent/sessions/${sessionId}/start`)
        .set(authHeader(token))
        .expect(201);

      expect(started.body.status).toBe('RECORDING');

      const stopped = await request(app.getHttpServer())
        .post(`/agent/sessions/${sessionId}/stop`)
        .set(authHeader(token))
        .expect(201);

      expect(stopped.body.status).toBe('STOPPED');
    });

    it('accepts safe event batch and rejects keylogging payloads', async () => {
      // reopen recording context for events (controller does not re-check status strictly)
      await request(app.getHttpServer())
        .post('/agent/events/batch')
        .set(authHeader(token))
        .send({
          sessionId,
          events: [
            {
              sequenceNo: 1,
              eventType: 'APP_CHANGED',
              timestamp: new Date().toISOString(),
              appName: 'Google Chrome',
              windowTitle: 'Clinic',
              metadata: { url: 'http://127.0.0.1:5173/#gallery', actionHint: 'open gallery' },
            },
            {
              sequenceNo: 2,
              eventType: 'TEXT_INPUT',
              timestamp: new Date().toISOString(),
              appName: 'ChatGPT',
              windowTitle: 'ChatGPT',
              metadata: {
                text: 'Rewrite homepage hero for SEO',
                actionHint: 'enter text for SEO hero',
              },
            },
            {
              sequenceNo: 3,
              eventType: 'URL_CHANGED',
              timestamp: new Date().toISOString(),
              appName: 'Google Chrome',
              windowTitle: 'Booking',
              metadata: { url: 'http://127.0.0.1:5173/#booking' },
            },
          ],
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.status).toBe('ACCEPTED');
          expect(res.body.received).toBe(3);
        });

      expect(store.events.length).toBeGreaterThanOrEqual(3);

      // Keylogging fields must be rejected (controller throws → 500 in Nest default)
      const forbidden = await request(app.getHttpServer())
        .post('/agent/events/batch')
        .set(authHeader(token))
        .send({
          sessionId,
          events: [
            {
              sequenceNo: 99,
              eventType: 'KEY_ACTION',
              timestamp: new Date().toISOString(),
              metadata: { typedText: 'secret keystream' },
            },
          ],
        });

      expect(forbidden.status).toBeGreaterThanOrEqual(400);
      expect(store.events.some((e) => (e.metadata as any)?.typedText)).toBe(false);
    });

    it('builds timeline from stored events', async () => {
      const res = await request(app.getHttpServer())
        .post(`/agent/sessions/${sessionId}/build-timeline`)
        .set(authHeader(token))
        .expect(201);

      expect(res.body.persisted).toBe(true);
      expect(res.body.workflowId).toBeDefined();
      expect(res.body.stepCount).toBeGreaterThan(0);
      expect(Array.isArray(res.body.steps)).toBe(true);

      // TEXT_INPUT should surface in actions
      const blob = JSON.stringify(res.body.steps);
      expect(blob).toMatch(/SEO|gallery|booking|Chrome|ChatGPT/i);
    });

    it('generates SOP draft from timeline', async () => {
      const res = await request(app.getHttpServer())
        .post(`/agent/sessions/${sessionId}/generate-sop-draft`)
        .set(authHeader(token))
        .expect(201);

      expect(res.body.status).toBe('DRAFT');
      expect(res.body.persisted).toBe(true);
      expect(res.body.sopDocumentId).toBeDefined();
      expect(res.body.sop).toMatchObject({
        title: expect.any(String),
        purpose: expect.any(String),
        procedure: expect.any(Array),
      });
      expect(res.body.sop.procedure.length).toBeGreaterThan(0);

      sopDocumentId = res.body.sopDocumentId;
    });

    it('reads timeline and SOP for the session', async () => {
      const tl = await request(app.getHttpServer())
        .get(`/agent/sessions/${sessionId}/timeline`)
        .set(authHeader(token))
        .expect(200);

      expect(tl.body.workflowId).toBeDefined();
      expect(tl.body.steps).toBeDefined();

      const sop = await request(app.getHttpServer())
        .get(`/agent/sessions/${sessionId}/sop`)
        .set(authHeader(token))
        .expect(200);

      expect(sop.body.sopDocumentId).toBe(sopDocumentId);
      expect(sop.body.status).toBe('DRAFT');
      expect(sop.body.sop.procedure.length).toBeGreaterThan(0);
    });

    it('reviewer can submit and approve SOP', async () => {
      const reviewerToken = await loginAs('reviewer@acme.test', 'demo123');

      const submitted = await request(app.getHttpServer())
        .post(`/agent/sop-documents/${sopDocumentId}/submit-review`)
        .set(authHeader(reviewerToken))
        .expect(201);

      expect(submitted.body.status).toBe('IN_REVIEW');

      const approved = await request(app.getHttpServer())
        .post(`/agent/sop-documents/${sopDocumentId}/approve`)
        .set(authHeader(reviewerToken))
        .expect(201);

      expect(approved.body.status).toBe('APPROVED');

      const read = await request(app.getHttpServer())
        .get(`/agent/sessions/${sessionId}/sop`)
        .set(authHeader(reviewerToken))
        .expect(200);

      expect(read.body.status).toBe('APPROVED');
    });
  });

  describe('GET /health', () => {
    it('returns ok without auth', async () => {
      await request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe('ok');
        });
    });
  });
});
