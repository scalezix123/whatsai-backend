import { config } from 'dotenv';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '../../.env');
const result = config({ path: envPath });

neonConfig.webSocketConstructor = ws;

const connectionString = result.parsed?.DATABASE_URL || process.env.DATABASE_URL;

const pool = new Pool({ connectionString });

async function run() {
  const client = await pool.connect();
  console.log("Connected using pool.connect()");
  await client.query('BEGIN');
  console.log("Started transaction");
  await client.query('COMMIT');
  client.release();
  process.exit(0);
}

run().catch(err => {
  console.error("Error", err);
  process.exit(1);
});
