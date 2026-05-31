import crypto from 'node:crypto';

export const generateToken = (): string => crypto.randomBytes(32).toString('base64url');

export const hashToken = (raw: string): string =>
  crypto.createHash('sha256').update(raw).digest('hex');

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
