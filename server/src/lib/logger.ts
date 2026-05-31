import pino from 'pino';

const transport =
  process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'email', 'password', 'token', 'tokenHash',
      '*.email', '*.password', '*.token', '*.tokenHash',
    ],
    censor: '[REDACTED]',
  },
  ...(transport ? { transport } : {}),
});
