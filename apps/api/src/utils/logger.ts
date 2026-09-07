import pino from 'pino';
import { config } from '../config/env';

const isPretty = !config.isProduction && process.stdout.isTTY;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (config.isTest ? 'silent' : 'info'),
  base: { service: 'faceproof-api' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'privateKey',
      'apiKey',
      'secretKey',
      '*.privateKey',
      '*.apiKey',
      '*.secretKey',
    ],
    censor: '[redacted]',
  },
  transport: isPretty
    ? {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,service' },
      }
    : undefined,
});

export type Logger = typeof logger;
