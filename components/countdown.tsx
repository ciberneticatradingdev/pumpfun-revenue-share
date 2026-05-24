"use client"

import { useState, useEffect, useCallback, useRef } from "react"

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"

type CycleState =
  | { status: "loading" }
  | { status: "offline" }
  | { status: "synced"; remainingMs: number; cycleMs: number }
  | { status: "dispensing" }

export default function Countdown() {
  const [state, setState] = useState<CycleState>({ status: "loading" })
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchCycle = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/cycle`, { cache: "no-store" })
      if (!res.ok) throw new Error("API error")
      const data = await res.json()

      // Calculate remaining using server's own clock to avoid client/server drift
      const serverRemaining = data.nextDistributionAt - data.serverNow
      const remaining = Math.max(0, serverRemaining)

      if (remaining <= 0) {
        setState({ status: "dispensing" })
        // Re-check after a few seconds
        setTimeout(fetchCycle, 3000)
      } else {
        setState({ status: "synced", remainingMs: remaining, cycleMs: data.cycleMs })
      }
    } catch {
      setState({ status: "offline" })
    }
  }, [])

  // Initial fetch + periodic re-sync every 30s
  useEffect(() => {
    fetchCycle()
    const syncId = setInterval(fetchCycle, 30_000)
    return () => clearInterval(syncId)
  }, [fetchCycle])

  // Local tick for smooth countdown (only when synced)
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    if (state.status !== "synced") return

    intervalRef.current = setInterval(() => {
      setState((prev) => {
        if (prev.status !== "synced") return prev
        const next = prev.remainingMs - 1000
        if (next <= 0) {
          // Trigger re-sync from server instead of faking a new cycle
          fetchCycle()
          return { status: "dispensing" }
        }
        return { ...prev, remainingMs: next }
      })
    }, 1000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [state.status, fetchCycle])

  // ── Render states ──

  if (state.status === "loading") {
    return (
      <div className="flex flex-col items-center">
        <p className="text-3xl md:text-4xl font-bold text-muted-foreground font-mono">
          --:--
        </p>
        <p className="text-xs text-muted-foreground/50 mt-1">Connecting...</p>
      </div>
    )
  }

  if (state.status === "offline") {
    return (
      <div className="flex flex-col items-center">
        <p className="text-3xl md:text-4xl font-bold text-muted-foreground/40 font-mono">
          --:--
        </p>
        <p className="text-xs text-destructive/60 mt-1">Backend offline</p>
      </div>
    )
  }

  if (state.status === "dispensing") {
    return (
      <div className="flex flex-col items-center">
        <p className="text-3xl md:text-4xl font-bold text-primary font-mono animate-pulse">
          DISPENSING...
        </p>
        <p className="text-sm text-primary/60 mt-1">🏧 Processing round</p>
      </div>
    )
  }

  // synced
  const totalSec = Math.floor(state.remainingMs / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  const display = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  const isUrgent = totalSec <= 15

  return (
    <p className={`text-3xl md:text-4xl font-bold font-mono ${isUrgent ? "text-primary animate-pulse" : "text-foreground"}`}>
      {display}
    </p>
  )
}
