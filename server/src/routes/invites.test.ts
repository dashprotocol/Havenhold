import express, { type Express } from 'express';
import request from 'supertest';
import { MemberRole, InviteStatus } from '@prisma/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const ctx = {
    user: null as null | { id: string; email: string; name: string },
    membership: null as null | { id: string; patientId: string; role: MemberRole },
  };

  const now = new Date();
  const future = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const makeInvite = (overrides: Partial<{
    id: string;
    patientId: string;
    invitedById: string;
    email: string;
    role: MemberRole;
    tokenHash: string;
    expiresAt: Date;
    status: InviteStatus;
  }> = {}) => ({
    id: 'inv1',
    patientId: 'p1',
    invitedById: 'u1',
    email: 'invitee@test.com',
    role: MemberRole.VIEWER,
    tokenHash: 'hash-of-valid-token',
    expiresAt: future,
    status: InviteStatus.PENDING,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });

  const prisma = {
    patientMember: {
      findUnique: vi.fn(async () => ctx.membership),
      findMany:   vi.fn(async () => []),
      create:     vi.fn(async () => ({ id: 'member1', patientId: 'p1', role: MemberRole.VIEWER })),
    },
    patientInvite: {
      create:     vi.fn(async () => makeInvite()),
      findFirst:  vi.fn(async () => null),
      findUnique: vi.fn(async () => null),
      findMany:   vi.fn(async () => []),
      update:     vi.fn(async () => makeInvite()),
      updateMany: vi.fn(async () => ({ count: 0 })),
      delete:     vi.fn(async () => makeInvite()),
      count:      vi.fn(async () => 0),
    },
    user: {
      findUnique: vi.fn(async () => null),
      delete:     vi.fn(async () => ({ id: 'u2' })),
    },
    $transaction: vi.fn(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)),
  };

  const getSession  = vi.fn(async () => (ctx.user ? ({ user: ctx.user } as const) : null));
  const createUser  = vi.fn(async () => ({ user: { id: 'u2' } }));
  const signInEmail = vi.fn(async () => ({
    headers: {
      getSetCookie: () => ['session=abc; Path=/; HttpOnly'],
      get: (name: string) => (name === 'set-cookie' ? 'session=abc; Path=/; HttpOnly' : null),
    },
  }));

  return { ctx, prisma, getSession, createUser, signInEmail, makeInvite };
});

vi.mock('../lib/auth', () => ({
  auth: {
    api: {
      getSession:  state.getSession,
      createUser:  state.createUser,
      signInEmail: state.signInEmail,
    },
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: state.prisma }));

vi.mock('../lib/email', () => ({
  sendInviteEmail: vi.fn(async () => undefined),
}));

import { sendInviteEmail } from '../lib/email';
import { invitesRouter } from './invites';

const U        = { id: 'u1', email: 'owner@test.com', name: 'Owner User' };
const OWNER_M  = { id: 'm1', patientId: 'p1', role: MemberRole.OWNER };
const EDITOR_M = { id: 'm1', patientId: 'p1', role: MemberRole.EDITOR };
const VIEWER_M = { id: 'm1', patientId: 'p1', role: MemberRole.VIEWER };

let app: Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/invites', invitesRouter);
});

beforeEach(() => {
  // resetAllMocks clears call history AND drains mockResolvedValueOnce queues,
  // preventing unconsumed one-time mocks from leaking between tests.
  vi.resetAllMocks();
  state.ctx.user       = null;
  state.ctx.membership = null;

  // Re-establish all default behaviours after reset.
  state.prisma.patientInvite.create.mockResolvedValue(state.makeInvite() as never);
  state.prisma.patientInvite.findFirst.mockResolvedValue(null);
  state.prisma.patientInvite.findUnique.mockResolvedValue(null);
  state.prisma.patientInvite.findMany.mockResolvedValue([]);
  state.prisma.patientInvite.update.mockResolvedValue(state.makeInvite() as never);
  state.prisma.patientInvite.updateMany.mockResolvedValue({ count: 0 });
  state.prisma.patientInvite.delete.mockResolvedValue(state.makeInvite() as never);
  state.prisma.patientInvite.count.mockResolvedValue(0);
  state.prisma.patientMember.findUnique.mockImplementation(async () => state.ctx.membership);
  state.prisma.patientMember.findMany.mockResolvedValue([]);
  state.prisma.patientMember.create.mockResolvedValue(
    { id: 'member1', patientId: 'p1', role: MemberRole.VIEWER } as never,
  );
  state.prisma.user.findUnique.mockResolvedValue(null);
  state.prisma.user.delete.mockResolvedValue({ id: 'u2' } as never);
  state.prisma.$transaction.mockImplementation(
    async (fn: (tx: typeof state.prisma) => Promise<unknown>) => fn(state.prisma),
  );
  state.getSession.mockImplementation(async () =>
    state.ctx.user ? ({ user: state.ctx.user } as const) : null,
  );
  state.createUser.mockResolvedValue({ user: { id: 'u2' } });
  state.signInEmail.mockResolvedValue({
    headers: {
      getSetCookie: () => ['session=abc; Path=/; HttpOnly'],
      get: (name: string) => (name === 'set-cookie' ? 'session=abc; Path=/; HttpOnly' : null),
    },
  });
  vi.mocked(sendInviteEmail).mockResolvedValue(undefined);
});

// ── POST /api/invites ──────────────────────────────────────────────────────────

describe('POST /api/invites', () => {
  const body = { patientId: 'p1', email: 'invitee@test.com', role: 'VIEWER' };

  it('unauthenticated -> 401', async () => {
    const res = await request(app).post('/api/invites').send(body);
    expect(res.status).toBe(401);
  });

  it('non-member -> 403', async () => {
    state.ctx.user = U;
    // ctx.membership stays null -> requirePatientAccess returns 403
    const res = await request(app).post('/api/invites').send(body);
    expect(res.status).toBe(403);
  });

  it('EDITOR -> 403', async () => {
    state.ctx.user = U;
    state.ctx.membership = EDITOR_M;
    const res = await request(app).post('/api/invites').send(body);
    expect(res.status).toBe(403);
  });

  it('VIEWER -> 403', async () => {
    state.ctx.user = U;
    state.ctx.membership = VIEWER_M;
    const res = await request(app).post('/api/invites').send(body);
    expect(res.status).toBe(403);
  });

  it('OWNER, role=VIEWER -> 201; sendInviteEmail called; no token in body', async () => {
    state.ctx.user = U;
    state.ctx.membership = OWNER_M;
    state.prisma.patientInvite.create.mockResolvedValueOnce(
      state.makeInvite({ email: 'invitee@test.com', role: MemberRole.VIEWER }) as never,
    );
    const res = await request(app).post('/api/invites').send(body);
    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty('token');
    expect(res.body).toHaveProperty('id');
    expect(sendInviteEmail).toHaveBeenCalledOnce();
  });

  it('OWNER, role=EDITOR -> 201', async () => {
    state.ctx.user = U;
    state.ctx.membership = OWNER_M;
    state.prisma.patientInvite.create.mockResolvedValueOnce(
      state.makeInvite({ role: MemberRole.EDITOR }) as never,
    );
    const res = await request(app).post('/api/invites').send({ ...body, role: 'EDITOR' });
    expect(res.status).toBe(201);
  });

  it('OWNER, role=OWNER -> 400 INVALID_INPUT', async () => {
    state.ctx.user = U;
    state.ctx.membership = OWNER_M;
    const res = await request(app).post('/api/invites').send({ ...body, role: 'OWNER' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_INPUT');
  });

  it('missing email -> 400 INVALID_INPUT', async () => {
    state.ctx.user = U;
    state.ctx.membership = OWNER_M;
    const res = await request(app).post('/api/invites').send({ patientId: 'p1', role: 'VIEWER' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_INPUT');
  });

  it('missing patientId -> 400 (requirePatientAccess rejects)', async () => {
    state.ctx.user = U;
    state.ctx.membership = null;
    const res = await request(app).post('/api/invites').send({ email: 'x@x.com', role: 'VIEWER' });
    // requirePatientAccess returns 400 if patientId missing from body
    expect(res.status).toBe(400);
  });

  it('duplicate PENDING invite -> 409 ALREADY_PENDING', async () => {
    state.ctx.user = U;
    state.ctx.membership = OWNER_M;
    state.prisma.patientInvite.findFirst.mockResolvedValueOnce(state.makeInvite());
    const res = await request(app).post('/api/invites').send(body);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_PENDING');
  });

  it('invitee already a member -> 409 ALREADY_MEMBER', async () => {
    state.ctx.user = U;
    state.ctx.membership = OWNER_M;
    // user exists → patientMember.findUnique (default mockImplementation) returns OWNER_M (truthy)
    state.prisma.user.findUnique.mockResolvedValueOnce({ id: 'u2' });
    const res = await request(app).post('/api/invites').send(body);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_MEMBER');
  });

  it('sendInviteEmail throws -> row deleted (primary cleanup) -> 500', async () => {
    state.ctx.user = U;
    state.ctx.membership = OWNER_M;
    state.prisma.patientInvite.create.mockResolvedValueOnce(state.makeInvite() as never);
    vi.mocked(sendInviteEmail).mockRejectedValueOnce(new Error('SMTP down'));
    const res = await request(app).post('/api/invites').send(body);
    expect(res.status).toBe(500);
    expect(state.prisma.patientInvite.delete).toHaveBeenCalledOnce();
  });

  it('sendInviteEmail throws AND delete fails -> row marked REVOKED (fallback) -> 500', async () => {
    state.ctx.user = U;
    state.ctx.membership = OWNER_M;
    state.prisma.patientInvite.create.mockResolvedValueOnce(state.makeInvite() as never);
    vi.mocked(sendInviteEmail).mockRejectedValueOnce(new Error('SMTP down'));
    state.prisma.patientInvite.delete.mockRejectedValueOnce(new Error('delete failed'));
    const res = await request(app).post('/api/invites').send(body);
    expect(res.status).toBe(500);
    expect(state.prisma.patientInvite.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: InviteStatus.REVOKED } }),
    );
  });

  it('expired PENDING invite exists -> expiry sweep runs -> 201 on re-invite', async () => {
    state.ctx.user = U;
    state.ctx.membership = OWNER_M;
    state.prisma.patientInvite.updateMany.mockResolvedValueOnce({ count: 1 }); // sweep reports 1 swept
    state.prisma.patientInvite.create.mockResolvedValueOnce(state.makeInvite() as never);
    const res = await request(app).post('/api/invites').send(body);
    expect(res.status).toBe(201);
    expect(state.prisma.patientInvite.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: InviteStatus.REVOKED } }),
    );
  });
});

// ── GET /api/invites/token/:token — preview (public) ─────────────────────────

describe('GET /api/invites/token/:token', () => {
  const validToken = 'valid-raw-token-32bytes-base64url';

  const makePreviewInvite = (overrides: Partial<{
    status: InviteStatus;
    expiresAt: Date;
  }> = {}) => ({
    status: InviteStatus.PENDING,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    email: 'invitee@test.com',
    role: MemberRole.VIEWER,
    patient: { name: 'Test Patient' },
    ...overrides,
  });

  it('unknown token -> 404 NOT_FOUND', async () => {
    // findUnique default returns null
    const res = await request(app).get(`/api/invites/token/${validToken}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('already accepted -> 409 ALREADY_ACCEPTED', async () => {
    state.prisma.patientInvite.findUnique.mockResolvedValueOnce(
      makePreviewInvite({ status: InviteStatus.ACCEPTED }) as never,
    );
    const res = await request(app).get(`/api/invites/token/${validToken}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_ACCEPTED');
  });

  it('revoked -> 410 REVOKED', async () => {
    state.prisma.patientInvite.findUnique.mockResolvedValueOnce(
      makePreviewInvite({ status: InviteStatus.REVOKED }) as never,
    );
    const res = await request(app).get(`/api/invites/token/${validToken}`);
    expect(res.status).toBe(410);
    expect(res.body.code).toBe('REVOKED');
  });

  it('expired -> 410 EXPIRED', async () => {
    state.prisma.patientInvite.findUnique.mockResolvedValueOnce(
      makePreviewInvite({ expiresAt: new Date(Date.now() - 1000) }) as never,
    );
    const res = await request(app).get(`/api/invites/token/${validToken}`);
    expect(res.status).toBe(410);
    expect(res.body.code).toBe('EXPIRED');
  });

  it('valid pending token -> 200 with email/role/patientName/expiresAt; no tokenHash', async () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    state.prisma.patientInvite.findUnique.mockResolvedValueOnce(
      makePreviewInvite({ expiresAt: future }) as never,
    );
    const res = await request(app).get(`/api/invites/token/${validToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      email: 'invitee@test.com',
      role: MemberRole.VIEWER,
      patientName: 'Test Patient',
    });
    expect(res.body).toHaveProperty('expiresAt');
    expect(res.body).not.toHaveProperty('tokenHash');
    expect(res.body).not.toHaveProperty('token');
  });
});

// ── GET /api/invites/:patientId ────────────────────────────────────────────────

describe('GET /api/invites/:patientId', () => {
  it('unauthenticated -> 401', async () => {
    const res = await request(app).get('/api/invites/p1');
    expect(res.status).toBe(401);
  });

  it('non-member -> 403', async () => {
    state.ctx.user = U;
    const res = await request(app).get('/api/invites/p1');
    expect(res.status).toBe(403);
  });

  it('VIEWER -> 403 FORBIDDEN', async () => {
    state.ctx.user = U;
    state.ctx.membership = VIEWER_M;
    const res = await request(app).get('/api/invites/p1');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('EDITOR -> 403 FORBIDDEN', async () => {
    state.ctx.user = U;
    state.ctx.membership = EDITOR_M;
    const res = await request(app).get('/api/invites/p1');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('OWNER -> 200; items have no token field', async () => {
    state.ctx.user = U;
    state.ctx.membership = OWNER_M;
    state.prisma.patientInvite.findMany.mockResolvedValueOnce([
      {
        id: 'inv1',
        email: 'x@x.com',
        role: MemberRole.VIEWER,
        createdAt: new Date(),
        expiresAt: new Date(),
        invitedBy: { id: 'u1', name: 'Owner' },
      },
    ]);
    const res = await request(app).get('/api/invites/p1');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    if (res.body.length > 0) {
      expect(res.body[0]).not.toHaveProperty('tokenHash');
      expect(res.body[0]).not.toHaveProperty('token');
    }
  });
});

// ── POST /api/invites/:token/register ─────────────────────────────────────────

describe('POST /api/invites/:token/register', () => {
  const registerBody = { name: 'New User', password: 'password123' };
  const validToken   = 'valid-raw-token-32bytes-base64url';

  it('unknown token -> 404 NOT_FOUND', async () => {
    const res = await request(app).post(`/api/invites/${validToken}/register`).send(registerBody);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('expired token -> 410 EXPIRED', async () => {
    state.prisma.patientInvite.findUnique.mockResolvedValueOnce(
      state.makeInvite({ expiresAt: new Date(Date.now() - 1000) }),
    );
    const res = await request(app).post(`/api/invites/${validToken}/register`).send(registerBody);
    expect(res.status).toBe(410);
    expect(res.body.code).toBe('EXPIRED');
  });

  it('revoked token -> 410 REVOKED', async () => {
    state.prisma.patientInvite.findUnique.mockResolvedValueOnce(
      state.makeInvite({ status: InviteStatus.REVOKED }),
    );
    const res = await request(app).post(`/api/invites/${validToken}/register`).send(registerBody);
    expect(res.status).toBe(410);
    expect(res.body.code).toBe('REVOKED');
  });

  it('already accepted -> 409 ALREADY_ACCEPTED', async () => {
    state.prisma.patientInvite.findUnique.mockResolvedValueOnce(
      state.makeInvite({ status: InviteStatus.ACCEPTED }),
    );
    const res = await request(app).post(`/api/invites/${validToken}/register`).send(registerBody);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_ACCEPTED');
  });

  it('email already has account -> 409 ACCOUNT_EXISTS', async () => {
    state.prisma.patientInvite.findUnique.mockResolvedValueOnce(state.makeInvite());
    state.prisma.user.findUnique.mockResolvedValueOnce({ id: 'existing-user' });
    const res = await request(app).post(`/api/invites/${validToken}/register`).send(registerBody);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ACCOUNT_EXISTS');
  });

  it('missing name -> 400 INVALID_INPUT', async () => {
    state.prisma.patientInvite.findUnique.mockResolvedValueOnce(state.makeInvite());
    const res = await request(app)
      .post(`/api/invites/${validToken}/register`)
      .send({ password: 'password123' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_INPUT');
  });

  it('missing password -> 400 INVALID_INPUT', async () => {
    state.prisma.patientInvite.findUnique.mockResolvedValueOnce(state.makeInvite());
    const res = await request(app)
      .post(`/api/invites/${validToken}/register`)
      .send({ name: 'New User' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_INPUT');
  });

  it('valid token + new user -> 201; invite ACCEPTED; sessionCreated: true', async () => {
    const invite = state.makeInvite();
    state.prisma.patientInvite.findUnique.mockResolvedValueOnce(invite);
    state.prisma.patientInvite.updateMany.mockResolvedValueOnce({ count: 1 });
    // Final membership lookup after transaction
    state.prisma.patientMember.findUnique.mockResolvedValueOnce({ id: 'member1' } as never);
    const res = await request(app)
      .post(`/api/invites/${validToken}/register`)
      .send(registerBody);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      membershipId: 'member1',
      patientId: invite.patientId,
      role: invite.role,
      sessionCreated: true,
    });
    expect(state.createUser).toHaveBeenCalledOnce();
  });

  it('valid token + new user but signInEmail fails -> 201; sessionCreated: false', async () => {
    const invite = state.makeInvite();
    state.prisma.patientInvite.findUnique.mockResolvedValueOnce(invite);
    state.prisma.patientInvite.updateMany.mockResolvedValueOnce({ count: 1 });
    state.prisma.patientMember.findUnique.mockResolvedValueOnce({ id: 'member1' } as never);
    state.signInEmail.mockRejectedValueOnce(new Error('sign-in failed'));
    const res = await request(app)
      .post(`/api/invites/${validToken}/register`)
      .send(registerBody);
    expect(res.status).toBe(201);
    expect(res.body.sessionCreated).toBe(false);
  });

  it('createUser succeeds but TX fails -> user deleted (compensation) -> 500', async () => {
    state.prisma.patientInvite.findUnique.mockResolvedValueOnce(state.makeInvite());
    state.prisma.$transaction.mockRejectedValueOnce(new Error('DB error'));
    const res = await request(app)
      .post(`/api/invites/${validToken}/register`)
      .send(registerBody);
    expect(res.status).toBe(500);
    expect(state.prisma.user.delete).toHaveBeenCalledOnce();
  });
});

// ── POST /api/invites/:token/accept ───────────────────────────────────────────

describe('POST /api/invites/:token/accept', () => {
  const validToken = 'valid-raw-token-32bytes-base64url';

  it('unauthenticated -> 401', async () => {
    const res = await request(app).post(`/api/invites/${validToken}/accept`);
    expect(res.status).toBe(401);
  });

  it('unknown token -> 404 NOT_FOUND', async () => {
    state.ctx.user = U;
    const res = await request(app).post(`/api/invites/${validToken}/accept`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('expired token -> 410 EXPIRED', async () => {
    state.ctx.user = U;
    state.prisma.patientInvite.findUnique.mockResolvedValueOnce(
      state.makeInvite({ expiresAt: new Date(Date.now() - 1000) }),
    );
    const res = await request(app).post(`/api/invites/${validToken}/accept`);
    expect(res.status).toBe(410);
    expect(res.body.code).toBe('EXPIRED');
  });

  it('revoked token -> 410 REVOKED', async () => {
    state.ctx.user = U;
    state.prisma.patientInvite.findUnique.mockResolvedValueOnce(
      state.makeInvite({ status: InviteStatus.REVOKED }),
    );
    const res = await request(app).post(`/api/invites/${validToken}/accept`);
    expect(res.status).toBe(410);
    expect(res.body.code).toBe('REVOKED');
  });

  it('already accepted -> 409 ALREADY_ACCEPTED', async () => {
    state.ctx.user = U;
    state.prisma.patientInvite.findUnique.mockResolvedValueOnce(
      state.makeInvite({ status: InviteStatus.ACCEPTED }),
    );
    const res = await request(app).post(`/api/invites/${validToken}/accept`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_ACCEPTED');
  });

  it('email mismatch -> 403 EMAIL_MISMATCH', async () => {
    state.ctx.user = { ...U, email: 'other@test.com' };
    state.prisma.patientInvite.findUnique.mockResolvedValueOnce(
      state.makeInvite({ email: 'invitee@test.com' }),
    );
    const res = await request(app).post(`/api/invites/${validToken}/accept`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_MISMATCH');
  });

  it('valid token + correct email -> 201', async () => {
    state.ctx.user = { ...U, email: 'invitee@test.com' };
    const invite = state.makeInvite({ email: 'invitee@test.com' });
    state.prisma.patientInvite.findUnique.mockResolvedValueOnce(invite);
    // existingMember check: default returns null (ctx.membership = null) -> proceed
    state.prisma.patientInvite.updateMany.mockResolvedValueOnce({ count: 1 });
    const res = await request(app).post(`/api/invites/${validToken}/accept`);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ patientId: invite.patientId, role: invite.role });
  });

  it('already a PatientMember -> 409 ALREADY_MEMBER', async () => {
    state.ctx.user = { ...U, email: 'invitee@test.com' };
    state.prisma.patientInvite.findUnique.mockResolvedValueOnce(
      state.makeInvite({ email: 'invitee@test.com' }),
    );
    // First findUnique call in handler = existingMember check; return truthy -> 409
    state.prisma.patientMember.findUnique.mockResolvedValueOnce({ id: 'existing-m' } as never);
    const res = await request(app).post(`/api/invites/${validToken}/accept`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_MEMBER');
  });

  it('race: TX updateMany count=0 -> 409 STATUS_CHANGED', async () => {
    state.ctx.user = { ...U, email: 'invitee@test.com' };
    state.prisma.patientInvite.findUnique.mockResolvedValueOnce(
      state.makeInvite({ email: 'invitee@test.com' }),
    );
    // existingMember = null (default), updateMany = { count: 0 } (default) -> ConflictError -> 409
    const res = await request(app).post(`/api/invites/${validToken}/accept`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('STATUS_CHANGED');
  });
});

// ── DELETE /api/invites/:id ────────────────────────────────────────────────────

describe('DELETE /api/invites/:id', () => {
  it('unauthenticated -> 401', async () => {
    const res = await request(app).delete('/api/invites/inv1');
    expect(res.status).toBe(401);
  });

  it('non-member with valid invite ID -> 404 NOT_FOUND (enumeration-safe)', async () => {
    state.ctx.user = U;
    state.prisma.patientInvite.findUnique.mockResolvedValueOnce(state.makeInvite());
    // assertPatientMembership: default returns null (ctx.membership=null) -> 404
    const res = await request(app).delete('/api/invites/inv1');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('VIEWER with valid invite ID -> 404 NOT_FOUND (enumeration-safe)', async () => {
    state.ctx.user = U;
    state.prisma.patientInvite.findUnique.mockResolvedValueOnce(state.makeInvite());
    state.prisma.patientMember.findUnique.mockResolvedValueOnce(VIEWER_M as never);
    const res = await request(app).delete('/api/invites/inv1');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('EDITOR with valid invite ID -> 404 NOT_FOUND (enumeration-safe)', async () => {
    state.ctx.user = U;
    state.prisma.patientInvite.findUnique.mockResolvedValueOnce(state.makeInvite());
    state.prisma.patientMember.findUnique.mockResolvedValueOnce(EDITOR_M as never);
    const res = await request(app).delete('/api/invites/inv1');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('invite not found -> 404 NOT_FOUND', async () => {
    state.ctx.user = U;
    // findUnique default returns null
    const res = await request(app).delete('/api/invites/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('invite already ACCEPTED -> 409 ALREADY_ACCEPTED', async () => {
    state.ctx.user = U;
    state.prisma.patientInvite.findUnique.mockResolvedValueOnce(
      state.makeInvite({ status: InviteStatus.ACCEPTED }),
    );
    state.prisma.patientMember.findUnique.mockResolvedValueOnce(OWNER_M as never);
    const res = await request(app).delete('/api/invites/inv1');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_ACCEPTED');
  });

  it('race: updateMany count=0 -> 409 STATUS_CHANGED', async () => {
    state.ctx.user = U;
    state.prisma.patientInvite.findUnique.mockResolvedValueOnce(state.makeInvite());
    state.prisma.patientMember.findUnique.mockResolvedValueOnce(OWNER_M as never);
    // updateMany default returns { count: 0 } -> 409
    const res = await request(app).delete('/api/invites/inv1');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('STATUS_CHANGED');
  });

  it('OWNER, PENDING invite -> 204', async () => {
    state.ctx.user = U;
    state.prisma.patientInvite.findUnique.mockResolvedValueOnce(state.makeInvite());
    state.prisma.patientMember.findUnique.mockResolvedValueOnce(OWNER_M as never);
    state.prisma.patientInvite.updateMany.mockResolvedValueOnce({ count: 1 });
    const res = await request(app).delete('/api/invites/inv1');
    expect(res.status).toBe(204);
  });
});
