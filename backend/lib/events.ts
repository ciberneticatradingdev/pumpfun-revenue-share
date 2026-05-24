import { pool } from "./db.js"

export type EventType =
  | "CYCLE_START"
  | "BALANCE_CHECK"
  | "CLAIM_DETECTED"
  | "DISTRIBUTION_START"
  | "TRANSFER_SENT"
  | "TRANSFER_FAILED"
  | "CYCLE_COMPLETE"
  | "CYCLE_SKIP"

export interface AppEvent {
  id: number
  type: EventType
  message: string
  data: Record<string, any>
  timestamp: number
}

const subscribers = new Set<(event: AppEvent) => void>()

export function subscribeToEvents(cb: (event: AppEvent) => void): () => void {
  subscribers.add(cb)
  return () => subscribers.delete(cb)
}

export async function emitEvent(
  type: EventType,
  message: string,
  data: Record<string, any> = {}
): Promise<void> {
  try {
    const res = await pool.query(
      `INSERT INTO events (type, message, data) VALUES ($1, $2, $3) RETURNING id, created_at`,
      [type, message, JSON.stringify(data)]
    )
    const row = res.rows[0]
    const event: AppEvent = {
      id: row.id,
      type,
      message,
      data,
      timestamp: new Date(row.created_at).getTime(),
    }
    for (const cb of subscribers) {
      cb(event)
    }
  } catch (err) {
    console.error("[Events] Failed to emit event:", err)
  }
}
