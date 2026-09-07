import { PrismaClient } from '@prisma/client';
import { config } from './env';
import { logger } from '../utils/logger';

/**
 * Prisma client singleton.
 *
 * `tsx watch` re-evaluates modules on every change, which would otherwise leak
 * a new connection pool per reload, so the instance is stashed on globalThis in
 * development.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: config.isProduction ? ['warn', 'error'] : ['warn', 'error'],
  });

if (!config.isProduction) globalForPrisma.prisma = prisma;

export async function connectDatabase(): Promise<void> {
  try {
    await prisma.$connect();
    logger.info('Database connected');
  } catch (error) {
    logger.error({ err: error }, 'Database connection failed');
    throw new Error(
      `Could not connect to PostgreSQL using DATABASE_URL. Start it with "npm run db:up" and apply migrations with "npm run prisma:migrate". Original error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
