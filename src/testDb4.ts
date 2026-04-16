import { config } from 'dotenv';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '../../.env');
config({ path: envPath });

const prisma = new PrismaClient();

async function run() {
  console.log("Checking Prisma Client Native...");
  const res = await prisma.$queryRaw`SELECT 1`;
  console.log("Prisma Client query executed successfully!", res);
  process.exit(0);
}

run().catch(console.error);
