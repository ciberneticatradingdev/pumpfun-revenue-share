import pg from "pg"
import { config } from "./config.js"

const { Pool } = pg

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: false,
  max: 5,
})

pool.on("error", (err) => {
  console.error("[DB] Unexpected error:", err.message)
})

export async function testConnection() {
  try {
    const res = await pool.query("SELECT 1 AS ok")
    console.log("[DB] Connected to PostgreSQL ✓")
    return true
  } catch (err: any) {
    console.error("[DB] Connection failed:", err.message)
    return false
  }
}
