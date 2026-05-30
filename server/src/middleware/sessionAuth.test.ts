import { describe, expect, it, vi } from 'vitest';
import { MemberRole } from '@prisma/client';
import {
  createRequireAuth,
  createRequirePatientAccess,
  createAssertPatientMembership,
  requireWriteAccess,
  canWrite,
  type PatientMemberInfo,
} from './sessionAuth';

type MockRes = { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn>; _status: number; _body: unknown };

function makeRes(): MockRes {
  const res = {} as MockRes;
  res.status = vi.fn((code: number) => { res._status = code; return res; });
  res.json   = vi.fn((body: unknown)  => { res._body  = body; return res; });
  return res;
}

function makeReq(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { headers: {}, params: {}, body: {}, ...overrides };
}

describe('canWrite', () => {
  it('OWNER can write', () => expect(canWrite(MemberRole.OWNER)).toBe(true));
  it('EDITOR can write', () => expect(canWrite(MemberRole.EDITOR)).toBe(true));
  it('VIEWER cannot write', () => expect(canWrite(MemberRole.VIEWER)).toBe(false));
});

describe('requireWriteAccess', () => {
  it('401 when req.user is absent', () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    requireWriteAccess(req, res, next);
    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: 'Authentication required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('403 when req.membership is absent', () => {
    const req = makeReq({ user: { id: 'u1', email: 'a@b.com', name: 'A' } });
    const res = makeRes();
    const next = vi.fn();
    requireWriteAccess(req, res, next);
    expect(res._status).toBe(403);
    expect(res._body).toEqual({ error: 'Access denied' });
    expect(next).not.toHaveBeenCalled();
  });

  it('403 when role is VIEWER', () => {
    const req = makeReq({
      user: { id: 'u1', email: 'a@b.com', name: 'A' },
      membership: { id: 'm1', patientId: 'p1', role: MemberRole.VIEWER },
    });
    const res = makeRes();
    const next = vi.fn();
    requireWriteAccess(req, res, next);
    expect(res._status).toBe(403);
    expect(res._body).toEqual({ error: 'Access denied' });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() for OWNER', () => {
    const req = makeReq({
      user: { id: 'u1', email: 'a@b.com', name: 'A' },
      membership: { id: 'm1', patientId: 'p1', role: MemberRole.OWNER },
    });
    const res = makeRes();
    const next = vi.fn();
    requireWriteAccess(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('calls next() for EDITOR', () => {
    const req = makeReq({
      user: { id: 'u1', email: 'a@b.com', name: 'A' },
      membership: { id: 'm1', patientId: 'p1', role: MemberRole.EDITOR },
    });
    const res = makeRes();
    const next = vi.fn();
    requireWriteAccess(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('requireAuth', () => {
  it('401 when getSession returns null', async () => {
    const getSession = vi.fn(async () => null);
    const mw = createRequireAuth(getSession);
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    await mw(req, res, next);
    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: 'Authentication required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('401 when session.user is null', async () => {
    const getSession = vi.fn(async () => ({ user: null as unknown as { id: string; email: string; name: string } }));
    const mw = createRequireAuth(getSession);
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    await mw(req, res, next);
    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('sets req.user and calls next() for valid session', async () => {
    const getSession = vi.fn(async () => ({
      user: { id: 'u1', email: 'a@b.com', name: 'Alice' },
    }));
    const mw = createRequireAuth(getSession);
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    await mw(req, res, next);
    expect(req.user).toEqual({ id: 'u1', email: 'a@b.com', name: 'Alice' });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('calls next(err) when getSession throws', async () => {
    const err = new Error('db down');
    const getSession = vi.fn(async () => {
      throw err;
    });
    const mw = createRequireAuth(getSession);
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    await mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBe(err);
  });
});

describe('requirePatientAccess', () => {
  it('401 when req.user is not set', async () => {
    const findMembership = vi.fn(async () => null);
    const mw = createRequirePatientAccess(findMembership);
    const req = makeReq({ params: { patientId: 'p1' } });
    const res = makeRes();
    const next = vi.fn();
    await mw(req, res, next);
    expect(res._status).toBe(401);
    expect(findMembership).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('400 when patientId absent from params and body', async () => {
    const findMembership = vi.fn(async () => null);
    const mw = createRequirePatientAccess(findMembership);
    const req = makeReq({ user: { id: 'u1', email: 'a@b.com', name: 'A' } });
    const res = makeRes();
    const next = vi.fn();
    await mw(req, res, next);
    expect(res._status).toBe(400);
    expect(findMembership).not.toHaveBeenCalled();
  });

  it('403 when membership not found', async () => {
    const findMembership = vi.fn(async () => null);
    const mw = createRequirePatientAccess(findMembership);
    const req = makeReq({
      user: { id: 'u1', email: 'a@b.com', name: 'A' },
      params: { patientId: 'p1' },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw(req, res, next);
    expect(res._status).toBe(403);
    expect(res._body).toEqual({ error: 'Access denied' });
    expect(next).not.toHaveBeenCalled();
  });

  it('sets req.membership and calls next() — patientId from param', async () => {
    const member: PatientMemberInfo = { id: 'm1', patientId: 'p1', role: MemberRole.OWNER };
    const findMembership = vi.fn(async () => member);
    const mw = createRequirePatientAccess(findMembership);
    const req = makeReq({
      user: { id: 'u1', email: 'a@b.com', name: 'A' },
      params: { patientId: 'p1' },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw(req, res, next);
    expect(req.membership).toEqual(member);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('sets req.membership and calls next() — patientId from body', async () => {
    const member: PatientMemberInfo = { id: 'm1', patientId: 'p1', role: MemberRole.EDITOR };
    const findMembership = vi.fn(async () => member);
    const mw = createRequirePatientAccess(findMembership);
    const req = makeReq({
      user: { id: 'u1', email: 'a@b.com', name: 'A' },
      body: { patientId: 'p1' },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw(req, res, next);
    expect(req.membership).toEqual(member);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('calls next(err) when findMembership throws', async () => {
    const err = new Error('db error');
    const findMembership = vi.fn(async () => {
      throw err;
    });
    const mw = createRequirePatientAccess(findMembership);
    const req = makeReq({
      user: { id: 'u1', email: 'a@b.com', name: 'A' },
      params: { patientId: 'p1' },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBe(err);
  });
});

describe('assertPatientMembership', () => {
  it('returns null when not a member', async () => {
    const findMembership = vi.fn(async () => null);
    const assertMembership = createAssertPatientMembership(findMembership);
    const result = await assertMembership('u1', 'p1');
    expect(result).toBeNull();
    expect(findMembership).toHaveBeenCalledWith('p1', 'u1');
  });

  it('returns PatientMemberInfo when membership exists', async () => {
    const member: PatientMemberInfo = { id: 'm1', patientId: 'p1', role: MemberRole.VIEWER };
    const findMembership = vi.fn(async () => member);
    const assertMembership = createAssertPatientMembership(findMembership);
    const result = await assertMembership('u1', 'p1');
    expect(result).toEqual(member);
  });
});
