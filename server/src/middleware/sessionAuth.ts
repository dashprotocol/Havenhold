import { Request, Response, NextFunction } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../lib/auth';

export interface AuthUser {
  id: string;
  patientId: string;
  role: 'PRIMARY_CAREGIVER' | 'FAMILY_MEMBER';
}

// better-auth session.user base type extended with our additionalFields
interface BetterAuthSessionUser {
  id: string;
  patientId?: string | null;
  role?: string | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session?.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const sessionUser = session.user as unknown as BetterAuthSessionUser;
    req.user = {
      id: session.user.id,
      patientId: sessionUser.patientId ?? '',
      role: (sessionUser.role as AuthUser['role']) ?? 'FAMILY_MEMBER',
    };

    next();
  } catch (err) {
    next(err);
  }
}

export function requirePatientAccess(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const patientId = (req.params.patientId ?? req.body?.patientId) as string | undefined;
  if (!patientId || patientId !== req.user.patientId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
}
