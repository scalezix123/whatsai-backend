import { config } from 'dotenv';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@prisma/client';
import ws from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '../../.env');
const result = config({ path: envPath });

neonConfig.webSocketConstructor = ws;

const connectionString = result.parsed?.DATABASE_URL || process.env.DATABASE_URL;

const pool = new Pool({ connectionString: connectionString as string });
const adapter = new PrismaNeon(pool);
const prisma = new PrismaClient({ adapter });

async function run() {
  console.log("Checking Prisma Client...");
  await prisma.$queryRaw`SELECT 1`;
  console.log("Prisma Client query executed successfully!");
  process.exit(0);
}

run().catch(console.error);
