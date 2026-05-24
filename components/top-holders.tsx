"use client"

import { useState, useEffect } from "react"

interface Holder {
  wallet: string
  percentage: string
  totalEarned: string
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"

const trunc = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`

export default function TopHolders() {
  const [holders, setHolders] = useState<Holder[]>([])
  const [error, setError] = useState(false)

  useEffect(() => {
    let mounted = true

    async function fetchHolders() {
      try {
        const res = await fetch(`${API_BASE}/api/holders?limit=12`, { cache: "no-store" })
        if (!res.ok) throw new Error("API error")
        const data = await res.json()
        if (mounted) {
          setHolders(data.holders ?? [])
          setError(false)
        }
      } catch {
        if (mounted) setError(true)
      }
    }

    fetchHolders()
    const id = setInterval(fetchHolders, 30_000)
    return () => { mounted = false; clearInterval(id) }
  }, [])

  return (
    <div className="h-full rounded-xl bg-card border border-border p-5 flex flex-col">
      <h3 className="text-sm font-bold uppercase tracking-wide text-foreground mb-4 shrink-0">
        🏆 Top Earners
      </h3>

      <div className="flex-1 overflow-y-auto min-h-0 -mr-1 pr-1">
        {holders.length === 0 && !error && (
          <p className="text-sm text-muted-foreground text-center py-8">Waiting for holder data…</p>
        )}
        {error && holders.length === 0 && (
          <p className="text-sm text-muted-foreground/50 text-center py-8">Backend offline</p>
        )}
        {holders.map((h, i) => (
          <div
            key={h.wallet}
            className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-0"
          >
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-bold text-muted-foreground w-5 text-right tabular-nums">
                {i + 1}
              </span>
              <span className="font-mono text-sm text-foreground/70">{trunc(h.wallet)}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground tabular-nums">{h.percentage}</span>
              <span className="font-mono text-sm font-semibold text-primary tabular-nums w-16 text-right">
                {h.totalEarned}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
