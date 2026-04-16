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
console.log("Loaded connection string:", connectionString);

const pool1 = new Pool({ connectionString });
console.log("Pool initialized");

pool1.query('SELECT 1').then(res => {
  console.log("Query success", res.rows);
  process.exit(0);
}).catch(err => {
  console.error("Query failed", err);
  process.exit(1);
});
