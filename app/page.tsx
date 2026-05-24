import Image from "next/image"
import LiveStats from "@/components/live-stats"
import LiveFeed from "@/components/live-feed"
import TopHolders from "@/components/top-holders"
import Countdown from "@/components/countdown"
import TransparencyTerminal from "@/components/transparency-terminal"

const TOKEN_NAME = process.env.NEXT_PUBLIC_TOKEN_NAME || "TOKEN"
const TOKEN_SYMBOL = process.env.NEXT_PUBLIC_TOKEN_SYMBOL || "$TKN"
const TOKEN_TAGLINE = process.env.NEXT_PUBLIC_TOKEN_TAGLINE || `Hold ${TOKEN_SYMBOL}. Earn rewards.`
const TOKEN_DESCRIPTION = process.env.NEXT_PUBLIC_TOKEN_DESCRIPTION || `${TOKEN_SYMBOL} automatically redistributes rewards to all holders.`
const REWARD_TOKEN = process.env.NEXT_PUBLIC_REWARD_TOKEN || "USDC"
const CYCLE_SECONDS = process.env.NEXT_PUBLIC_CYCLE_SECONDS || "60"
const MIN_HOLDING = process.env.NEXT_PUBLIC_MIN_HOLDING || "10000"
const BUY_URL = process.env.NEXT_PUBLIC_BUY_URL || "#"
const CHART_URL = process.env.NEXT_PUBLIC_CHART_URL || "#"
const TWITTER_URL = process.env.NEXT_PUBLIC_TWITTER_URL || "#"
const TELEGRAM_URL = process.env.NEXT_PUBLIC_TELEGRAM_URL || "#"
const DISCORD_URL = process.env.NEXT_PUBLIC_DISCORD_URL || "#"

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Hero Section */}
      <section className="relative h-screen w-full overflow-hidden">
        <Image
          src="/hero.png"
          alt={`${TOKEN_SYMBOL} Hero`}
          fill
          className="object-cover object-center"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background" />
        <div className="absolute inset-0 bg-background/30" />
      </section>

      {/* Intro Section */}
      <section className="relative -mt-24 z-10 flex flex-col items-center px-4 pb-16 pt-8">
        <div className="flex flex-col items-center max-w-3xl mx-auto text-center">
          <div className="w-28 h-28 md:w-36 md:h-36 mb-6 rounded-full overflow-hidden border-4 border-primary/30 shadow-2xl shadow-primary/20">
            <Image
              src="/logo.png"
              alt={`${TOKEN_SYMBOL} Logo`}
              width={144}
              height={144}
              className="w-full h-full object-cover"
            />
          </div>

          <h1 className="text-5xl md:text-7xl font-bold text-foreground mb-4 tracking-tight">
            {TOKEN_SYMBOL}
          </h1>

          <p className="text-xl md:text-2xl text-muted-foreground mb-4 font-medium">
            {TOKEN_TAGLINE}
          </p>

          <p className="text-base md:text-lg text-muted-foreground/80 mb-8 max-w-xl leading-relaxed">
            {TOKEN_DESCRIPTION}
          </p>

          <div className="flex flex-col sm:flex-row gap-4">
            <a
              href={BUY_URL}
              className="px-8 py-4 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 transition-colors text-center"
            >
              Buy {TOKEN_SYMBOL}
            </a>
            <a
              href={CHART_URL}
              className="px-8 py-4 bg-muted text-foreground font-semibold rounded-xl hover:bg-muted/80 transition-colors border border-border text-center"
            >
              View Chart
            </a>
          </div>
        </div>
      </section>

      {/* Live Stats Section */}
      <section className="px-4 py-16 md:py-24">
        <div className="max-w-4xl mx-auto">
          <LiveStats />
        </div>
      </section>

      {/* Live Feed + Top Holders */}
      <section className="px-4 py-8 md:py-16">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground text-center mb-10">
            Live Distributions
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6" style={{ minHeight: 440 }}>
            <div className="lg:col-span-3">
              <LiveFeed />
            </div>
            <div className="lg:col-span-2">
              <TopHolders />
            </div>
          </div>
        </div>
      </section>

      {/* Transparency Terminal */}
      <section className="px-4 py-16 md:py-24">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground text-center mb-4">
            Transparency Terminal
          </h2>
          <p className="text-center text-muted-foreground mb-10">
            Every transaction. Every cycle. Fully on-chain, fully transparent.
          </p>
          <TransparencyTerminal />
        </div>
      </section>

      {/* Features Section */}
      <section className="px-4 py-16 md:py-24">
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="p-6 rounded-xl bg-card border border-border">
              <h3 className="text-xl font-bold text-foreground mb-6 flex items-center gap-3">
                <span className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary">
                  <ArrowDownIcon />
                </span>
                Deposit
              </h3>
              <ul className="space-y-4">
                <FeatureItem text={`Buy ${TOKEN_SYMBOL} on any Solana DEX`} />
                <FeatureItem text="No staking or locking required" />
                <FeatureItem text="Your wallet is automatically registered" />
                <FeatureItem text={`Minimum of ${parseInt(MIN_HOLDING).toLocaleString()} ${TOKEN_SYMBOL} to receive rewards`} />
              </ul>
            </div>

            <div className="p-6 rounded-xl bg-card border border-border">
              <h3 className="text-xl font-bold text-foreground mb-6 flex items-center gap-3">
                <span className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary">
                  <ArrowUpIcon />
                </span>
                Receive
              </h3>
              <ul className="space-y-4">
                <FeatureItem text={`${REWARD_TOKEN} directly to your wallet`} />
                <FeatureItem text={`Automatic distribution every ${CYCLE_SECONDS} seconds`} />
                <FeatureItem text={`Proportional to your ${TOKEN_SYMBOL} holdings`} />
                <FeatureItem text="No fees or hidden commissions" />
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="px-4 py-16 md:py-24">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground text-center mb-12">
            How It Works
          </h2>
          <div className="flex flex-col md:flex-row gap-6">
            <StepCard number={1} title={`Buy ${TOKEN_SYMBOL}`} description={`Purchase ${TOKEN_SYMBOL} on any Solana DEX. Your wallet is automatically registered.`} />
            <StepCard number={2} title="Hold" description={`Simply hold your ${TOKEN_SYMBOL} tokens. No staking, no locking, no complicated DeFi protocols.`} />
            <StepCard number={3} title={`Earn ${REWARD_TOKEN}`} description={`Receive ${REWARD_TOKEN} rewards directly to your wallet every ${CYCLE_SECONDS} seconds, proportional to your holdings.`} />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-4 py-12 border-t border-border">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt={TOKEN_SYMBOL} width={40} height={40} className="rounded-full" />
            <span className="font-bold text-foreground">{TOKEN_SYMBOL}</span>
          </div>
          <div className="flex gap-6">
            <a href={TWITTER_URL} className="text-muted-foreground hover:text-foreground transition-colors">Twitter</a>
            <a href={TELEGRAM_URL} className="text-muted-foreground hover:text-foreground transition-colors">Telegram</a>
            <a href={DISCORD_URL} className="text-muted-foreground hover:text-foreground transition-colors">Discord</a>
          </div>
          <p className="text-sm text-muted-foreground">© {new Date().getFullYear()} {TOKEN_SYMBOL}. All rights reserved.</p>
        </div>
      </footer>
    </main>
  )
}

function FeatureItem({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
        <CheckIcon />
      </span>
      <span className="text-muted-foreground">{text}</span>
    </li>
  )
}

function StepCard({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <div className="flex-1 p-6 rounded-xl bg-card border border-border text-center">
      <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xl font-bold mx-auto mb-4">{number}</div>
      <h3 className="text-lg font-bold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
    </div>
  )
}

function CheckIcon() {
  return <svg className="w-3 h-3 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
}
function ArrowDownIcon() {
  return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
}
function ArrowUpIcon() {
  return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
}
