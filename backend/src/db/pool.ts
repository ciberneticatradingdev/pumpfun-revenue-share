import { Pool } from 'pg';
import { config } from '../config';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: {
    rejectUnauthorized: false,
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err: Error) => {
  console.error(`[${new Date().toISOString()}] [ERROR] Unexpected PostgreSQL pool error:`, err.message);
});
