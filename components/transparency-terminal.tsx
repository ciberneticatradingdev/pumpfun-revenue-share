"use client"

import { useState, useEffect, useRef } from "react"

type EventType =
  | "CYCLE_START"
  | "BALANCE_CHECK"
  | "CLAIM_DETECTED"
  | "DISTRIBUTION_START"
  | "TRANSFER_SENT"
  | "TRANSFER_FAILED"
  | "CYCLE_COMPLETE"
  | "CYCLE_SKIP"

interface ATMEvent {
  id: number
  type: EventType
  message: string
  data: {
    round?: number
    balance?: number
    delta?: number
    wallet?: string
    amount?: number
    share?: string
    txSignature?: string
    solscanUrl?: string
    totalDistributed?: number
    holders?: number
    error?: string
  }
  timestamp: number
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"

const EVENT_COLORS: Record<EventType, string> = {
  CYCLE_START:        "text-primary",
  BALANCE_CHECK:      "text-muted-foreground",
  CLAIM_DETECTED:     "text-foreground",
  DISTRIBUTION_START: "text-primary",
  TRANSFER_SENT:      "text-foreground",
  TRANSFER_FAILED:    "text-red-400",
  CYCLE_COMPLETE:     "text-primary",
  CYCLE_SKIP:         "text-muted-foreground/50",
}

function formatTime(ts: number) {
  const d = new Date(ts)
  return d.toTimeString().slice(0, 8)
}

export default function TransparencyTerminal() {
  const [events, setEvents] = useState<ATMEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const seenIds = useRef<Set<number>>(new Set())

  function addEvents(incoming: ATMEvent[]) {
    const fresh = incoming.filter((e) => !seenIds.current.has(e.id))
    if (fresh.length === 0) return
    fresh.forEach((e) => seenIds.current.add(e.id))
    setEvents((prev) => [...prev, ...fresh].slice(-200))
  }

  // Load initial history
  useEffect(() => {
    fetch(`${API_BASE}/api/events?limit=50`)
      .then((r) => r.json())
      .then((data) => {
        const list: ATMEvent[] = Array.isArray(data) ? data : (data.events ?? [])
        addEvents([...list].reverse())
      })
      .catch(() => setError(true))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // SSE stream
  useEffect(() => {
    let es: EventSource | null = null
    let pollId: ReturnType<typeof setInterval> | null = null
    let mounted = true

    function startSSE() {
      es = new EventSource(`${API_BASE}/api/events/stream`)

      es.onopen = () => {
        if (mounted) { setConnected(true); setError(false) }
      }

      es.onmessage = (e) => {
        if (!mounted) return
        try {
          const evt: ATMEvent = JSON.parse(e.data)
          addEvents([evt])
        } catch { /* ignore malformed */ }
      }

      es.onerror = () => {
        if (!mounted) return
        setConnected(false)
        es?.close()
        es = null
        if (!pollId) {
          pollId = setInterval(() => {
            fetch(`${API_BASE}/api/events?limit=10`)
              .then((r) => r.json())
              .then((data) => {
                const list: ATMEvent[] = Array.isArray(data) ? data : (data.events ?? [])
                addEvents([...list].reverse())
              })
              .catch(() => { if (mounted) setError(true) })
          }, 30_000)
        }
      }
    }

    startSSE()

    return () => {
      mounted = false
      es?.close()
      if (pollId) clearInterval(pollId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [events])

  return (
    <div className="rounded-xl bg-card border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">
          🏧 Event Log
        </h3>
        <div className="flex items-center gap-1.5">
          {connected ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="absolute inset-0 rounded-full bg-primary animate-ping opacity-75" />
                <span className="relative block h-2 w-2 rounded-full bg-primary" />
              </span>
              <span className="text-[10px] text-primary font-bold uppercase tracking-wider">Live</span>
            </>
          ) : (
            <>
              <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                {error ? "Offline" : "Connecting…"}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Event list */}
      <div className="h-[420px] overflow-y-auto p-5 space-y-1 font-mono text-sm leading-relaxed">
        {events.length === 0 && (
          <p className="text-muted-foreground/50 py-8 text-center text-xs tracking-widest">
            {error ? "⚠ Backend offline — will reconnect automatically" : "Waiting for events…"}
          </p>
        )}

        {events.map((evt) => {
          const color = EVENT_COLORS[evt.type] ?? "text-muted-foreground"
          const hasLink = evt.type === "TRANSFER_SENT" && evt.data?.solscanUrl
          const isComplete = evt.type === "CYCLE_COMPLETE"
          const isSkip = evt.type === "CYCLE_SKIP"

          return (
            <div key={evt.id}>
              <div className={`flex items-start gap-3 py-1 ${isSkip ? "opacity-40" : ""}`}>
                <span className="text-muted-foreground/40 shrink-0 tabular-nums text-xs pt-0.5">
                  {formatTime(evt.timestamp)}
                </span>
                <span className={`${color} break-all`}>
                  {evt.message}
                  {hasLink && (
                    <>
                      {" "}
                      <a
                        href={evt.data.solscanUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline underline-offset-2 opacity-70 hover:opacity-100 transition-opacity"
                      >
                        [view tx ↗]
                      </a>
                    </>
                  )}
                </span>
              </div>
              {/* Divider after each complete cycle */}
              {(isComplete || isSkip) && (
                <div className="border-b border-border/50 my-2" />
              )}
            </div>
          )
        })}

        {/* Blinking cursor */}
        <div className="flex items-center gap-3 pt-1">
          <span className="text-primary animate-pulse">█</span>
        </div>

        <div ref={bottomRef} />
      </div>
    </div>
  )
}
