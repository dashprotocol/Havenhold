import * as Sentry from '@sentry/node';
import type { Request } from 'express';
import { logger } from './logger';

// Serialize only safe fields from an error for structured logging.
// Upstream SDK errors (Anthropic, Resend, etc.) can embed full request/response
// bodies in properties like .body, .request, .headers — which may contain
// sensitive text. We log only the message, name, and HTTP status if present.
// Sentry receives the full error object for debugging, under its own scrubbing.
export function safeErrorFields(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const safe: Record<string, unknown> = { name: err.name, message: err.message };
    const maybeStatus = (err as unknown as Record<string, unknown>).status;
    if (typeof maybeStatus === 'number') safe.status = maybeStatus;
    return safe;
  }
  return { error: String(err) };
}

export function captureError(err: unknown, req?: Request): void {
  logger.error({ requestId: req?.requestId, err: safeErrorFields(err) }, 'Request error');
  Sentry.captureException(err, {
    extra: { requestId: req?.requestId, path: req?.path, method: req?.method },
  });
}
