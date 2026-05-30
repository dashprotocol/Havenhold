import fs from 'fs';
import path from 'path';
import express, { type Express } from 'express';
import request from 'supertest';
import { MemberRole } from '@prisma/client';
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const ctx = {
    user: null as null | { id: string; email: string; name: string },
    membership: null as null | { id: string; patientId: string; role: MemberRole },
    entity: null as null | {
      id: string;
      patientId: string;
      title?: string;
      datetime?: Date;
      location?: string | null;
      notes?: string | null;
    },
    entitiesById: {} as Record<string, {
      id: string;
      patientId: string;
      title?: string;
      datetime?: Date;
      location?: string | null;
      notes?: string | null;
    }>,
  };

  const getEntityById = (args: unknown) => {
    const id = (args as { where?: { id?: string } })?.where?.id;
    if (id && ctx.entitiesById[id]) return ctx.entitiesById[id];
    return ctx.entity;
  };

  const prisma = {
    patientMember: {
      findUnique: vi.fn(async () => ctx.membership),
      findMany: vi.fn(async () => []),
    },
    appointment: {
      findUnique: vi.fn(async (args: unknown) => getEntityById(args)),
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({
        id: 'a1',
        patientId: 'p1',
        title: 'T',
        datetime: new Date(),
        reviewStatus: 'CONFIRMED',
        comments: [],
      })),
      update: vi.fn(async () => ({ id: 'a1', reviewStatus: 'CONFIRMED' })),
    },
    medication: {
      findUnique: vi.fn(async (args: unknown) => getEntityById(args)),
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({
        id: 'm1',
        patientId: 'p1',
        name: 'Drug',
        comments: [],
        interactionsA: [],
        interactionsB: [],
      })),
      update: vi.fn(async () => ({ id: 'm1', reviewStatus: 'CONFIRMED' })),
    },
    document: {
      findUnique: vi.fn(async (args: unknown) => getEntityById(args)),
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: 'd1', patientId: 'p1' })),
    },
    comment: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: 'c1', author: { id: 'u1', email: 'test@test.com', name: 'Test User' } })),
    },
  };

  const getSession = vi.fn(async () => (ctx.user ? ({ user: ctx.user } as const) : null));
  const runPipeline = vi.fn(async () => undefined);

  return { ctx, prisma, getSession, runPipeline };
});

vi.mock('../config/flags', () => ({
  flags: {
    PIPELINE_ENABLED: true,
  },
}));

vi.mock('../lib/auth', () => ({
  auth: { api: { getSession: state.getSession } },
}));

vi.mock('../lib/prisma', () => ({
  prisma: state.prisma,
}));

vi.mock('../lib/pipeline', () => ({
  runPipeline: state.runPipeline,
}));

import { requireAuth } from '../middleware/sessionAuth';
import { appointmentsRouter } from './appointments';
import { medicationsRouter } from './medications';
import { documentsRouter } from './documents';
import { commentsRouter } from './comments';
import { feedRouter } from './feed';
import { familyRouter } from './family';

const U = { id: 'u1', email: 'test@test.com', name: 'Test User' };
const M = (role: MemberRole) => ({ id: 'm1', patientId: 'p1', role });
const E = {
  id: 'x1',
  patientId: 'p1',
  title: 'Checkup',
  datetime: new Date('2026-01-01T12:00:00.000Z'),
  location: 'Clinic',
  notes: 'Bring labs',
};
const uploadDir = path.join(process.cwd(), 'uploads');

let app: Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/appointments', requireAuth, appointmentsRouter);
  app.use('/api/medications', requireAuth, medicationsRouter);
  app.use('/api/documents', requireAuth, documentsRouter);
  app.use('/api/comments', requireAuth, commentsRouter);
  app.use('/api/feed', requireAuth, feedRouter);
  app.use('/api/family', requireAuth, familyRouter);
});

afterAll(async () => {
  const files = await fs.promises.readdir(uploadDir).catch(() => [] as string[]);
  await Promise.all(
    files
      .filter((file) => file.includes('authz-test-'))
      .map((file) => fs.promises.unlink(path.join(uploadDir, file)).catch(() => {})),
  );
});

beforeEach(() => {
  vi.clearAllMocks();
  state.ctx.user = null;
  state.ctx.membership = null;
  state.ctx.entity = null;
  state.ctx.entitiesById = {};
});

async function jsonReq(method: string, targetPath: string, body?: object) {
  switch (method) {
    case 'GET':
      return request(app).get(targetPath);
    case 'POST':
      return request(app).post(targetPath).send(body ?? {});
    case 'PATCH':
      return request(app).patch(targetPath).send(body ?? {});
    default:
      throw new Error(`Unsupported method: ${method}`);
  }
}

async function uploadReq(targetPath: string) {
  const filename = `authz-test-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`;
  return request(app)
    .post(targetPath)
    .field('patientId', 'p1')
    .field('analysisType', 'GENERAL')
    .attach('file', Buffer.from('test content'), { filename, contentType: 'text/plain' });
}

describe('unauthenticated -> 401', () => {
  const routes: [string, string, object?][] = [
    ['GET', '/api/appointments/p1'],
    ['POST', '/api/appointments/', { patientId: 'p1', title: 'T', datetime: new Date().toISOString() }],
    ['PATCH', '/api/appointments/x1', { title: 'T' }],
    ['PATCH', '/api/appointments/x1/review', { action: 'confirm' }],
    ['GET', '/api/appointments/x1/ical'],
    ['GET', '/api/medications/p1'],
    ['POST', '/api/medications/', { patientId: 'p1', name: 'Drug' }],
    ['PATCH', '/api/medications/x1', { name: 'Drug' }],
    ['PATCH', '/api/medications/x1/review', { action: 'confirm' }],
    ['GET', '/api/documents/list/p1'],
    ['GET', '/api/documents/x1'],
    ['POST', '/api/documents/upload'],
    ['POST', '/api/comments/', { appointmentId: 'x1', body: 'hi' }],
    ['GET', '/api/comments/appointment/x1'],
    ['GET', '/api/feed/p1'],
    ['GET', '/api/feed/events/p1'],
    ['GET', '/api/family/p1'],
  ];

  for (const [method, targetPath, body] of routes) {
    it(`${method} ${targetPath}`, async () => {
      const res = targetPath === '/api/documents/upload'
        ? await uploadReq(targetPath)
        : await jsonReq(method, targetPath, body);
      expect(res.status).toBe(401);
    });
  }
});

describe('non-member -> 403', () => {
  beforeEach(() => {
    state.ctx.user = U;
    state.ctx.membership = null;
    state.ctx.entity = E;
  });

  const routes: [string, string, object?][] = [
    ['GET', '/api/appointments/p1'],
    ['POST', '/api/appointments/', { patientId: 'p1', title: 'T', datetime: new Date().toISOString() }],
    ['PATCH', '/api/appointments/x1', { title: 'T' }],
    ['PATCH', '/api/appointments/x1/review', { action: 'confirm' }],
    ['GET', '/api/appointments/x1/ical'],
    ['GET', '/api/medications/p1'],
    ['POST', '/api/medications/', { patientId: 'p1', name: 'Drug' }],
    ['PATCH', '/api/medications/x1', { name: 'Drug' }],
    ['PATCH', '/api/medications/x1/review', { action: 'confirm' }],
    ['GET', '/api/documents/list/p1'],
    ['GET', '/api/documents/x1'],
    ['POST', '/api/documents/upload'],
    ['POST', '/api/comments/', { appointmentId: 'x1', body: 'hi' }],
    ['GET', '/api/comments/appointment/x1'],
    ['GET', '/api/feed/p1'],
    ['GET', '/api/feed/events/p1'],
    ['GET', '/api/family/p1'],
  ];

  for (const [method, targetPath, body] of routes) {
    it(`${method} ${targetPath}`, async () => {
      const res = targetPath === '/api/documents/upload'
        ? await uploadReq(targetPath)
        : await jsonReq(method, targetPath, body);
      expect(res.status).toBe(403);
    });
  }
});

describe('VIEWER -> 403 on writes', () => {
  beforeEach(() => {
    state.ctx.user = U;
    state.ctx.membership = M(MemberRole.VIEWER);
    state.ctx.entity = E;
  });

  const writes: [string, string, object?][] = [
    ['POST', '/api/appointments/', { patientId: 'p1', title: 'T', datetime: new Date().toISOString() }],
    ['PATCH', '/api/appointments/x1', { title: 'T' }],
    ['PATCH', '/api/appointments/x1/review', { action: 'confirm' }],
    ['POST', '/api/medications/', { patientId: 'p1', name: 'Drug' }],
    ['PATCH', '/api/medications/x1', { name: 'Drug' }],
    ['PATCH', '/api/medications/x1/review', { action: 'confirm' }],
    ['POST', '/api/comments/', { appointmentId: 'x1', body: 'hi' }],
    ['POST', '/api/documents/upload'],
  ];

  for (const [method, targetPath, body] of writes) {
    it(`${method} ${targetPath}`, async () => {
      const res = targetPath === '/api/documents/upload'
        ? await uploadReq(targetPath)
        : await jsonReq(method, targetPath, body);
      expect(res.status).toBe(403);
    });
  }
});

describe.each([MemberRole.EDITOR, MemberRole.OWNER])('%s -> write succeeds', (role) => {
  beforeEach(() => {
    state.ctx.user = U;
    state.ctx.membership = M(role);
    state.ctx.entity = E;
  });

  it('POST /api/appointments -> 201', async () => {
    const res = await jsonReq('POST', '/api/appointments/', {
      patientId: 'p1',
      title: 'Checkup',
      datetime: new Date().toISOString(),
    });
    expect(res.status).toBe(201);
  });

  it('PATCH /api/appointments/:id -> 200', async () => {
    const res = await jsonReq('PATCH', '/api/appointments/x1', { title: 'Updated' });
    expect(res.status).toBe(200);
  });

  it('PATCH /api/appointments/:id/review -> 200', async () => {
    const res = await jsonReq('PATCH', '/api/appointments/x1/review', { action: 'confirm' });
    expect(res.status).toBe(200);
  });

  it('POST /api/medications -> 201', async () => {
    const res = await jsonReq('POST', '/api/medications/', { patientId: 'p1', name: 'Aspirin' });
    expect(res.status).toBe(201);
  });

  it('PATCH /api/medications/:id -> 200', async () => {
    const res = await jsonReq('PATCH', '/api/medications/x1', { name: 'Aspirin 200mg' });
    expect(res.status).toBe(200);
  });

  it('PATCH /api/medications/:id/review -> 200', async () => {
    const res = await jsonReq('PATCH', '/api/medications/x1/review', { action: 'confirm' });
    expect(res.status).toBe(200);
  });

  it('POST /api/comments -> 201', async () => {
    const res = await jsonReq('POST', '/api/comments/', { appointmentId: 'x1', body: 'Noted.' });
    expect(res.status).toBe(201);
  });

  it('POST /api/documents/upload -> 201', async () => {
    const res = await uploadReq('/api/documents/upload');
    expect(res.status).toBe(201);
    expect(state.runPipeline).toHaveBeenCalledTimes(1);
  });
});

describe('comment entity ownership invariant', () => {
  it('POST /api/comments rejects cross-patient entity linking with 400', async () => {
    state.ctx.user = U;
    state.ctx.membership = M(MemberRole.EDITOR);
    state.ctx.entitiesById = {
      appt1: { id: 'appt1', patientId: 'p1' },
      doc2: { id: 'doc2', patientId: 'p2' },
    };

    const res = await jsonReq('POST', '/api/comments/', {
      appointmentId: 'appt1',
      documentId: 'doc2',
      body: 'This should fail',
    });

    expect(res.status).toBe(400);
    expect(res.body?.error).toBe('All entities must belong to the same patient');
  });
});

describe('VIEWER -> reads succeed', () => {
  beforeEach(() => {
    state.ctx.user = U;
    state.ctx.membership = M(MemberRole.VIEWER);
    state.ctx.entity = E;
  });

  const reads = [
    '/api/appointments/p1',
    '/api/appointments/x1/ical',
    '/api/medications/p1',
    '/api/documents/list/p1',
    '/api/documents/x1',
    '/api/comments/appointment/x1',
    '/api/feed/p1',
    '/api/family/p1',
  ];

  for (const targetPath of reads) {
    it(`GET ${targetPath}`, async () => {
      const res = await jsonReq('GET', targetPath);
      expect(res.status).toBe(200);
    });
  }
});
