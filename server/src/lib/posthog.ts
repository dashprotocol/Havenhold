import { PostHog } from 'posthog-node';
import { logger } from './logger';

export const posthog = new PostHog(process.env.POSTHOG_API_KEY ?? '', {
  host: 'https://us.i.posthog.com',
  disabled: !process.env.POSTHOG_API_KEY,
});

export function captureEvent(
  userId: string,
  event: string,
  properties?: Record<string, unknown>,
): void {
  try {
    posthog.capture({ distinctId: userId, event, properties: properties ?? {} });
  } catch (err) {
    logger.error({ err, event }, 'PostHog captureEvent failed');
  }
}
