import { Request, Response, NextFunction } from 'express';

/**
 * Demo-only auth middleware.
 * Hardcodes a single user context so all requests are scoped to one patient.
 *
 * Production replacement: verify JWT, load user from DB, enforce
 * that req.user.patientId matches the requested patientId on every route.
 */

export interface AuthUser {
  id: string;
  patientId: string;
  role: 'PRIMARY_CAREGIVER' | 'FAMILY_MEMBER';
}

// Populated by the seed script — update if you re-seed
const DEMO_USER: AuthUser = {
  id: process.env.DEMO_USER_ID ?? 'demo-user',
  patientId: process.env.DEMO_PATIENT_ID ?? 'demo-patient',
  role: 'PRIMARY_CAREGIVER',
};

declare global {
  namespace Express {
    interface Request {
      user: AuthUser;
    }
  }
}

export function demoAuth(req: Request, _res: Response, next: NextFunction) {
  req.user = DEMO_USER;
  next();
}

/**
 * Guards a route so only requests for the demo patient's data are allowed.
 * Prevents IDOR: a patientId in the URL that doesn't match the session is rejected.
 */
export function requirePatientAccess(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const patientId = req.params.patientId ?? req.body?.patientId;
  if (patientId && patientId !== req.user.patientId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
}
