import { Request, Response, NextFunction, RequestHandler } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { MemberRole } from '@prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface PatientMemberInfo {
  id: string;
  patientId: string;
  role: MemberRole;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
    membership?: PatientMemberInfo;
  }
}

// ── Dependency types (used by factory functions and tests) ────────────────────

type GetSessionFn = (
  headers: Headers,
) => Promise<{ user: { id: string; email: string; name: string } } | null>;

type FindMembershipFn = (
  patientId: string,
  userId: string,
) => Promise<PatientMemberInfo | null>;

// ── Role policy ───────────────────────────────────────────────────────────────

export function canWrite(role: MemberRole): boolean {
  return role === MemberRole.OWNER || role === MemberRole.EDITOR;
}

// ── Middleware factories (used by tests to inject mock dependencies) ──────────

export function createRequireAuth(getSession: GetSessionFn): RequestHandler {
  return async function requireAuth(req, res, next) {
    try {
      const session = await getSession(fromNodeHeaders(req.headers));
      if (!session?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      req.user = {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function createRequirePatientAccess(findMembership: FindMembershipFn): RequestHandler {
  return async function requirePatientAccess(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const patientId = (req.params.patientId ?? req.body?.patientId) as string | undefined;
    if (!patientId) {
      return res.status(400).json({ error: 'patientId is required' });
    }
    try {
      const membership = await findMembership(patientId, req.user.id);
      if (!membership) {
        return res.status(403).json({ error: 'Access denied' });
      }
      req.membership = membership;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function createAssertPatientMembership(
  findMembership: FindMembershipFn,
): (userId: string, patientId: string) => Promise<PatientMemberInfo | null> {
  // Use this after loading a resource by ID to derive patientId; use
  // requirePatientAccess when patientId is present in route params/body.
  return (userId, patientId) => findMembership(patientId, userId);
}

// ── requireWriteAccess — chains after requirePatientAccess on write routes ────

export function requireWriteAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.user)       return res.status(401).json({ error: 'Authentication required' });
  if (!req.membership) return res.status(403).json({ error: 'Access denied' });
  if (!canWrite(req.membership.role)) return res.status(403).json({ error: 'Access denied' });
  next();
}

// ── Production instances ──────────────────────────────────────────────────────

const _getSession: GetSessionFn = (headers) =>
  auth.api.getSession({ headers }) as Promise<{ user: { id: string; email: string; name: string } } | null>;

const _find: FindMembershipFn = (patientId, userId) =>
  prisma.patientMember.findUnique({
    where: { patientId_userId: { patientId, userId } },
    select: { id: true, patientId: true, role: true },
  });

export const requireAuth             = createRequireAuth(_getSession);
export const requirePatientAccess    = createRequirePatientAccess(_find);
export const assertPatientMembership = createAssertPatientMembership(_find);
