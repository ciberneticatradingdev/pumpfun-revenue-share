"use client"

import { useState, useEffect } from "react"
import Countdown from "./countdown"

interface StatsData {
  treasury: string
  totalDistributed: string
  holders: number
  totalRounds: number
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"

export default function LiveStats() {
  const [stats, setStats] = useState<StatsData | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let mounted = true

    async function fetchStats() {
      try {
        const res = await fetch(`${API_BASE}/api/stats`, { cache: "no-store" })
        if (!res.ok) throw new Error("API error")
        const data = await res.json()
        if (mounted) {
          setStats(data)
          setError(false)
        }
      } catch {
        if (mounted) setError(true)
      }
    }

    fetchStats()
    const id = setInterval(fetchStats, 15_000)
    return () => { mounted = false; clearInterval(id) }
  }, [])

  // Fallback when backend is offline
  const treasury = stats?.treasury ?? "—"
  const totalDistributed = stats?.totalDistributed ?? "—"
  const holders = stats?.holders ?? "—"

  return (
    <div className="grid grid-cols-2 gap-4 md:gap-6">
      <StatCard label="Treasury" value={treasury} sublabel={process.env.NEXT_PUBLIC_REWARD_TOKEN || 'USDC'} />
      <StatCard label="Next Payout">
        <Countdown />
      </StatCard>
      <StatCard label="Total Distributed" value={totalDistributed} sublabel={process.env.NEXT_PUBLIC_REWARD_TOKEN || 'USDC'} />
      <StatCard label="Holders" value={String(holders)} sublabel="wallets" />
      {error && (
        <div className="col-span-2 text-center">
          <p className="text-xs text-muted-foreground/50">Backend offline — stats will update when connected</p>
        </div>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  sublabel,
  children,
}: {
  label: string
  value?: string
  sublabel?: string
  children?: React.ReactNode
}) {
  return (
    <div className="p-6 rounded-xl bg-card border border-border flex flex-col items-center text-center">
      <p className="text-sm text-muted-foreground mb-2 uppercase tracking-wide">{label}</p>
      {children ? (
        children
      ) : (
        <>
          <p className="text-3xl md:text-4xl font-bold text-foreground font-mono mb-1">{value}</p>
          {sublabel && <p className="text-sm text-muted-foreground">{sublabel}</p>}
        </>
      )}
    </div>
  )
}
