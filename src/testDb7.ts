import { config } from 'dotenv';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '../../.env');
config({ path: envPath });

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({ 
  connectionString,
  ssl: { rejectUnauthorized: false } 
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function run() {
  console.log("Checking Prisma Client with @prisma/adapter-pg...");
  const res = await prisma.$queryRaw`SELECT 1`;
  console.log("Prisma Client query executed successfully!", res);
  process.exit(0);
}

run().catch(console.error);
