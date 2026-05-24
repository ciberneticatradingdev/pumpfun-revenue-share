"use client"

import { useState, useEffect } from "react"

interface Distribution {
  wallet: string
  amount: string
  timestamp: number
  txSignature?: string
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"

const trunc = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`

function timeAgo(ts: number) {
  const d = Math.floor((Date.now() - ts) / 1000)
  if (d < 60) return `${d}s ago`
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  return `${Math.floor(d / 3600)}h ago`
}

export default function LiveFeed() {
  const [feed, setFeed] = useState<Distribution[]>([])
  const [error, setError] = useState(false)
  const [, tick] = useState(0)

  useEffect(() => {
    let mounted = true

    async function fetchFeed() {
      try {
        const res = await fetch(`${API_BASE}/api/distributions?limit=12`, { cache: "no-store" })
        if (!res.ok) throw new Error("API error")
        const data = await res.json()
        if (mounted) {
          setFeed(data.distributions ?? [])
          setError(false)
        }
      } catch {
        if (mounted) setError(true)
      }
    }

    fetchFeed()
    const id = setInterval(fetchFeed, 10_000)
    return () => { mounted = false; clearInterval(id) }
  }, [])

  // Re-render timestamps
  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 5000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="h-full rounded-xl bg-card border border-border p-5 flex flex-col">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">🏧 Live Feed</h3>
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inset-0 rounded-full bg-primary animate-ping opacity-75" />
            <span className="relative block h-2 w-2 rounded-full bg-primary" />
          </span>
          <span className="text-[10px] text-primary font-bold uppercase tracking-wider">Live</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 -mr-1 pr-1 space-y-0">
        {feed.length === 0 && !error && (
          <p className="text-sm text-muted-foreground text-center py-8">Waiting for first distribution…</p>
        )}
        {error && feed.length === 0 && (
          <p className="text-sm text-muted-foreground/50 text-center py-8">Backend offline — feed will appear when connected</p>
        )}
        {feed.map((d, i) => (
          <div
            key={`${d.wallet}-${d.timestamp}-${i}`}
            className="flex items-center justify-between py-3 border-b border-border/50 last:border-0"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="shrink-0 w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                <span className="text-xs text-primary font-bold">{(process.env.NEXT_PUBLIC_REWARD_TOKEN || 'USDC') === 'SOL' ? '◎' : '$'}</span>
              </div>
              <div className="min-w-0">
                <p className="font-mono text-sm text-foreground/80 truncate">{trunc(d.wallet)}</p>
                <p className="text-xs text-muted-foreground">{timeAgo(d.timestamp)}</p>
              </div>
            </div>
            <span className="font-mono text-sm font-semibold text-primary shrink-0 ml-3">
              +{(process.env.NEXT_PUBLIC_REWARD_TOKEN || 'USDC') === 'SOL' ? '' : '$'}{d.amount}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
