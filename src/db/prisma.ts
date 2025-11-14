import { PrismaClient } from '@src/db/prisma/clients'

// Ensure a single PrismaClient instance across hot reloads in dev
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
