/**
 * PostgreSQL-backed store for distribution data.
 */
import { pool } from "./db.js"

interface Distribution {
  wallet: string
  amount: string
  timestamp: number
  txSignature: string
}

class Store {
  /** Run migrations then verify readiness */
  async init() {
    await this.migrate()
    const stats = await this.getStats()
    console.log(`[Store] DB ready: ${stats.totalRounds} rounds, ${stats.totalDistributed} distributed`)
  }

  /** Idempotent schema migration — safe to run on every boot */
  private async migrate() {
    console.log("[Store] Running auto-migration...")
    await pool.query(`
      CREATE TABLE IF NOT EXISTS stats (
        id INTEGER PRIMARY KEY DEFAULT 1,
        total_distributed NUMERIC(20, 6) NOT NULL DEFAULT 0,
        total_rounds INTEGER NOT NULL DEFAULT 0,
        pending_balance NUMERIC(20, 6) NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT stats_singleton CHECK (id = 1)
      );

      INSERT INTO stats (id, total_distributed, total_rounds)
      VALUES (1, 0, 0)
      ON CONFLICT (id) DO NOTHING;

      -- Add pending_balance column if missing (existing installs)
      DO $$ BEGIN
        ALTER TABLE stats ADD COLUMN pending_balance NUMERIC(20, 6) NOT NULL DEFAULT 0;
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;

      CREATE TABLE IF NOT EXISTS distributions (
        id SERIAL PRIMARY KEY,
        round INTEGER NOT NULL,
        amount NUMERIC(20, 6) NOT NULL DEFAULT 0,
        holders INTEGER NOT NULL DEFAULT 0,
        tx_signature TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS distribution_details (
        id SERIAL PRIMARY KEY,
        distribution_id INTEGER NOT NULL REFERENCES distributions(id),
        wallet TEXT NOT NULL,
        amount NUMERIC(20, 6) NOT NULL DEFAULT 0,
        tx_signature TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_distributions_created ON distributions(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_dist_details_created ON distribution_details(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_dist_details_dist_id ON distribution_details(distribution_id);

      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);

      CREATE TABLE IF NOT EXISTS balance_snapshots (
        id SERIAL PRIMARY KEY,
        balance NUMERIC(20, 6) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_balance_snapshots_created ON balance_snapshots(created_at DESC);
    `)
    console.log("[Store] Migration complete ✓")
  }

  /** Get pending (claimed but undistributed) balance */
  async getPendingBalance(): Promise<number> {
    const res = await pool.query("SELECT pending_balance FROM stats WHERE id = 1")
    if (res.rows.length === 0) return 0
    return parseFloat(res.rows[0].pending_balance) || 0
  }

  /** Add to pending balance (claimed but couldn't distribute) */
  async addPendingBalance(amount: number) {
    await pool.query(
      "UPDATE stats SET pending_balance = pending_balance + $1, updated_at = NOW() WHERE id = 1",
      [amount]
    )
  }

  /** Reset pending balance after successful distribution */
  async clearPendingBalance() {
    await pool.query(
      "UPDATE stats SET pending_balance = 0, updated_at = NOW() WHERE id = 1"
    )
  }

  /** Get events with pagination */
  async getEvents(limit = 50, offset = 0) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200))
    const safeOffset = Math.max(0, Number(offset) || 0)
    const res = await pool.query(
      `SELECT id, type, message, data, created_at
       FROM events ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [safeLimit, safeOffset]
    )
    return res.rows.map((r: any) => ({
      id: r.id,
      type: r.type,
      message: r.message,
      data: r.data,
      timestamp: new Date(r.created_at).getTime(),
    }))
  }

  /** Get events for a specific distribution round */
  async getEventsByCycle(round: number) {
    const res = await pool.query(
      `SELECT id, type, message, data, created_at
       FROM events
       WHERE data->>'round' = $1
       ORDER BY created_at ASC`,
      [String(round)]
    )
    return res.rows.map((r: any) => ({
      id: r.id,
      type: r.type,
      message: r.message,
      data: r.data,
      timestamp: new Date(r.created_at).getTime(),
    }))
  }

  async addDistributions(dists: Distribution[]) {
    if (dists.length === 0) return

    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      for (const d of dists) {
        // Get current round id
        const roundRes = await client.query(
          "SELECT id FROM distributions ORDER BY id DESC LIMIT 1"
        )
        const distId = roundRes.rows[0]?.id || null
        if (distId) {
          await client.query(
            `INSERT INTO distribution_details (distribution_id, wallet, amount, tx_signature)
             VALUES ($1, $2, $3, $4)`,
            [distId, d.wallet, parseFloat(d.amount), d.txSignature]
          )
        }
      }
      await client.query("COMMIT")
    } catch (err) {
      await client.query("ROLLBACK")
      console.error("[Store] Failed to add distributions:", err)
    } finally {
      client.release()
    }
  }

  async addRound(amount: number, holders: number, txSignature?: string) {
    const client = await pool.connect()
    try {
      await client.query("BEGIN")

      // Get next round number
      const roundRes = await client.query("SELECT COALESCE(MAX(round), 0) + 1 AS next FROM distributions")
      const nextRound = roundRes.rows[0].next

      // Insert round
      await client.query(
        `INSERT INTO distributions (round, amount, holders, tx_signature)
         VALUES ($1, $2, $3, $4)`,
        [nextRound, amount, holders, txSignature || null]
      )

      // Update stats
      await client.query(
        `UPDATE stats SET
           total_distributed = total_distributed + $1,
           total_rounds = total_rounds + 1,
           updated_at = NOW()
         WHERE id = 1`,
        [amount]
      )

      await client.query("COMMIT")
    } catch (err) {
      await client.query("ROLLBACK")
      console.error("[Store] Failed to add round:", err)
    } finally {
      client.release()
    }
  }

  async getDistributions(limit = 12) {
    const res = await pool.query(
      `SELECT dd.wallet, dd.amount::text, dd.tx_signature AS "txSignature", dd.created_at
       FROM distribution_details dd
       ORDER BY dd.created_at DESC
       LIMIT $1`,
      [limit]
    )
    return res.rows.map((r: any) => ({
      wallet: r.wallet,
      amount: parseFloat(r.amount).toFixed(4),
      txSignature: r.txSignature,
      timestamp: new Date(r.created_at).getTime(),
    }))
  }

  async getStats() {
    const res = await pool.query("SELECT total_distributed, total_rounds FROM stats WHERE id = 1")
    if (res.rows.length === 0) {
      return { totalDistributed: "$0.00", totalRounds: 0 }
    }
    const row = res.rows[0]
    return {
      totalDistributed: `$${parseFloat(row.total_distributed).toFixed(2)}`,
      totalRounds: parseInt(row.total_rounds),
    }
  }

  async getRounds(limit = 20) {
    const res = await pool.query(
      `SELECT round, amount::text AS "totalDistributed", holders, created_at
       FROM distributions
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    )
    return res.rows.map((r: any) => ({
      totalDistributed: parseFloat(r.totalDistributed),
      holders: r.holders,
      timestamp: new Date(r.created_at).getTime(),
    }))
  }
}

export const store = new Store()
