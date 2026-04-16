import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Get file-relative directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Use environment variables directly (injected by host or loaded by process)
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Please ensure you have configured it in your environment."
  );
}

const globalForPrisma = global as unknown as { prisma: PrismaClient };

const adapter = new PrismaPg(connectionString);

export const prisma =
  globalForPrisma.prisma || new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
