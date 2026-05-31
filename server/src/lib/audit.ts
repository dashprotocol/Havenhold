import type { PrismaClient, Prisma, AuditAction, AuditResource } from '@prisma/client';
import type { Request } from 'express';
import { logger } from './logger';

export interface AuditEntry {
  userId?: string;
  patientId?: string;
  action: AuditAction;
  resource?: AuditResource;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export async function createAuditLog(prisma: PrismaClient, entry: AuditEntry): Promise<void> {
  try {
    // Cast to unchecked input — AuditEntry uses scalar foreign key IDs rather than
    // Prisma's connect-relation syntax, which the unchecked variant accepts.
    await prisma.auditLog.create({ data: entry as Prisma.AuditLogUncheckedCreateInput });
  } catch (err) {
    logger.error({ err, action: entry.action }, 'Failed to write audit log');
  }
}

export function requestMeta(req: Request): { ipAddress: string | undefined; userAgent: string | undefined } {
  // CF-Connecting-IP is set by Cloudflare to the real client IP and cannot be spoofed
  // by the client (Cloudflare strips and replaces any client-provided value).
  // Fall back to req.ip (trusted via Nginx X-Forwarded-For) when not behind Cloudflare.
  const cfIp = req.headers['cf-connecting-ip'];
  return {
    ipAddress: (Array.isArray(cfIp) ? cfIp[0] : cfIp) ?? req.ip ?? req.socket.remoteAddress,
    userAgent: req.get('user-agent'),
  };
}
