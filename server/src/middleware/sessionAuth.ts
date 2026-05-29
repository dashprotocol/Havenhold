import { Request, Response, NextFunction } from 'express';
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

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

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
}

export async function requirePatientAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const patientId = (req.params.patientId ?? req.body?.patientId) as string | undefined;
  if (!patientId) {
    return res.status(400).json({ error: 'patientId is required' });
  }

  try {
    const membership = await prisma.patientMember.findUnique({
      where: { patientId_userId: { patientId, userId: req.user.id } },
      select: { id: true, patientId: true, role: true },
    });

    if (!membership) {
      return res.status(403).json({ error: 'Access denied' });
    }

    req.membership = membership;
    next();
  } catch (err) {
    next(err);
  }
}

// For route handlers that resolve patientId from an entity fetch (not a URL param)
export async function assertPatientMembership(
  userId: string,
  patientId: string,
): Promise<PatientMemberInfo | null> {
  return prisma.patientMember.findUnique({
    where: { patientId_userId: { patientId, userId } },
    select: { id: true, patientId: true, role: true },
  });
}
