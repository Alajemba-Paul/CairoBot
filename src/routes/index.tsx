import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  Lock,
  Radio,
  Shield,
  Terminal,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { marksFn, positionsFn, previewFn, privacyFn } from "@/core/api";
import { REPO_BRANCH, REPO_URL } from "@/core/constants";
import { MARKETS, type Market, type Position, type Preview, type PrivacyStatus, type TradeIntent, type WalletSession } from "@/core/types";
import { tryParse } from "@/core/intent";
import type { MarkSnapshot } from "@/core/venues/extended";
import {
  confirmWithWallet,
  connectWallet,
  hasInjectedWallet,
  helperAddress,
  isEmbeddedPreview,
  telegramUrl,
} from "@/lib/wallet";

export const Route = createFileRoute("/")({ component: Home });

const EXAMPLES = [
  "long sol 10x 50 usdc tp @ 200 sl @ 85",
  "short btc 5x 100 usdc sl @ 90000",
  "long eth 20x 250 usdc tp @ 5000 sl @ 2800",
];

const LEVS = [5, 10, 20, 50];
const MARGINS = [50, 100, 500, 1000];

const CLI_SNIPPET = `git clone ${REPO_URL}.git
cd CairoBot && git checkout ${REPO_BRANCH}
npm install
npm run cli -- parse "long sol 10x 50 usdc tp @ 200 sl @ 85"
npm run cli -- preview "long sol 10x 50 usdc tp @ 200 sl @ 85"`;

const MCP_SNIPPET = `{
  "mcpServers": {
    "cairobot": {
      "command": "node",
      "args": ["--experimental-strip-types", "src/adapters/mcp.ts"],
      "cwd": "./CairoBot"
    }
  }
}`;

function Home() {
  const [text, setText] = useState("long sol 10x 50 usdc tp @ 200 sl @ 85");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  const [marks, setMarks] = useState<MarkSnapshot[]>([]);
  const [marksError, setMarksError] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState<PrivacyStatus | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [side, setSide] = useState<"LONG" | "SHORT">("LONG");
  const [market, setMarket] = useState<Market>("SOL-USD");
  const [leverage, setLeverage] = useState(10);
  const [margin, setMargin] = useState(50);
  const [tp, setTp] = useState("200");
  const [sl, setSl] = useState("85");
  const [session, setSession] = useState<WalletSession | null>(null);
  const [embedded, setEmbedded] = useState(false);
  const [injected, setInjected] = useState(false);

  const loadMarks = useCallback(async () => {
    const res = await marksFn();
    if (res.ok) {
      setMarks(res.marks);
      setMarksError(null);
    } else {
      setMarksError(res.error);
    }
  }, []);

  useEffect(() => {
    setEmbedded(isEmbeddedPreview());
    setInjected(hasInjectedWallet());
  }, []);

  useEffect(() => {
    void loadMarks();
    const id = setInterval(() => void loadMarks(), 10_000);
    void privacyFn({ data: { owner: "web" } }).then(setPrivacy);
    void positionsFn({ data: { owner: "web" } }).then(setPositions);
    return () => clearInterval(id);
  }, [loadMarks]);

  useEffect(() => {
    void runPreview(text);
    // First paint: live fat-finger card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const composed = useMemo(
    () => composeLine(side, market, leverage, margin, tp, sl),
    [side, market, leverage, margin, tp, sl],
  );

  function applyDraft(patch: {
    side?: "LONG" | "SHORT";
    market?: Market;
    leverage?: number;
    margin?: number;
    tp?: string;
    sl?: string;
  }) {
    const nextSide = patch.side ?? side;
    const nextMarket = patch.market ?? market;
    const nextLev = patch.leverage ?? leverage;
    const nextMargin = patch.margin ?? margin;
    const nextTp = patch.tp ?? tp;
    const nextSl = patch.sl ?? sl;
    if (patch.side !== undefined) setSide(patch.side);
    if (patch.market !== undefined) setMarket(patch.market);
    if (patch.leverage !== undefined) setLeverage(patch.leverage);
    if (patch.margin !== undefined) setMargin(patch.margin);
    if (patch.tp !== undefined) setTp(patch.tp);
    if (patch.sl !== undefined) setSl(patch.sl);
    setText(composeLine(nextSide, nextMarket, nextLev, nextMargin, nextTp, nextSl));
  }

  function applyIntent(intent: TradeIntent, raw?: string) {
    setSide(intent.side);
    setMarket(intent.market);
    setLeverage(intent.leverage);
    setMargin(intent.marginUsdc);
    setTp(intent.tpPrice !== undefined ? String(intent.tpPrice) : "");
    setSl(intent.slPrice !== undefined ? String(intent.slPrice) : "");
    if (raw !== undefined) setText(raw);
  }

  async function runPreview(raw: string) {
    setBusy(true);
    setError(null);
    setConfirmMsg(null);
    try {
      const parsed = tryParse(raw);
      if (parsed?.kind === "trade") applyIntent(parsed.intent);
      const res = await previewFn({ data: { text: raw, owner: session?.address ?? "web" } });
      if (!res.ok) {
        setPreview(null);
        setError(res.error);
        return;
      }
      setPreview(res.preview);
    } finally {
      setBusy(false);
    }
  }

  async function runConnect() {
    setConfirmMsg(null);
    try {
      const next = await connectWallet();
      setSession(next);
    } catch (err) {
      setConfirmMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function runConfirm() {
    if (!preview) return;
    setBusy(true);
    setConfirmMsg(null);
    try {
      let current = session;
      if (!current) {
        current = await connectWallet();
        setSession(current);
      }
      const receipt = await confirmWithWallet(preview, current);
      setConfirmMsg(`funded ${receipt.fundTxHash}`);
    } catch (err) {
      setConfirmMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh bg-bg text-fg">
      <Header session={session} embedded={embedded} injected={injected} onConnect={() => void runConnect()} />
      <div className="mx-auto max-w-6xl px-4 pb-20 pt-6 sm:px-6 sm:pt-8">
        <Hero />
        <section className="mt-8 grid gap-5 lg:grid-cols-2">
          <CommandPanel
            text={text}
            setText={setText}
            busy={busy}
            onPreview={() => void runPreview(text)}
            onExample={(ex) => void runPreview(ex)}
            side={side}
            setSide={(s) => applyDraft({ side: s })}
            market={market}
            setMarket={(m) => applyDraft({ market: m })}
            leverage={leverage}
            setLeverage={(x) => applyDraft({ leverage: x })}
            margin={margin}
            setMargin={(n) => applyDraft({ margin: n })}
            tp={tp}
            sl={sl}
            setTp={(v) => applyDraft({ tp: v })}
            setSl={(v) => applyDraft({ sl: v })}
            composed={composed}
          />
          <PreviewPanel
            preview={preview}
            error={error}
            confirmMsg={confirmMsg}
            busy={busy}
            session={session}
            embedded={embedded}
            injected={injected}
            onConfirm={() => void runConfirm()}
            onConnect={() => void runConnect()}
          />
        </section>
        <section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
          <Tape marks={marks} error={marksError} />
          <PrivacyPanel privacy={privacy} />
          <PositionsPanel positions={positions} />
        </section>
        <Skins />
        <Claims />
      </div>
    </main>
  );
}

function Header(props: {
  session: WalletSession | null;
  embedded: boolean;
  injected: boolean;
  onConnect: () => void;
}) {
  const tg = telegramUrl();
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/90 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="font-display text-lg font-semibold tracking-tight">CairoBot</span>
          <Badge tone="accent">v2</Badge>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-2 text-xs text-muted sm:flex">
            <Radio className="size-3.5 text-long" />
            <span className="font-mono text-fg">SN_MAIN</span>
          </span>
          {props.session ? (
            <Badge className="font-mono normal-case">{shorten(props.session.address)}</Badge>
          ) : props.embedded && !props.injected ? (
            tg ? (
              <Button asChild size="sm" variant="secondary">
                <a href={tg} target="_blank" rel="noreferrer">
                  <Bot /> Telegram
                </a>
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={props.onConnect}>
                <Wallet /> Connect
              </Button>
            )
          ) : (
            <Button size="sm" variant="secondary" onClick={props.onConnect}>
              <Wallet /> Connect Ready
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="max-w-3xl">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">
        IDEA-02 · STRK20 Privacy Sprint
      </p>
      <h1 className="mt-3 font-display text-3xl font-semibold leading-[1.08] tracking-[-0.03em] text-fg sm:text-4xl lg:text-[2.75rem]">
        Private perps on Extended, from chat, CLI, or an agent.
      </h1>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
        Collateral moves through the STRK20 pool. Identity stays off the book. Connect Ready or
        Xverse to sign. This desk never holds a key.
      </p>
    </section>
  );
}

function CommandPanel(props: {
  text: string;
  setText: (v: string) => void;
  busy: boolean;
  onPreview: () => void;
  onExample: (ex: string) => void;
  side: "LONG" | "SHORT";
  setSide: (s: "LONG" | "SHORT") => void;
  market: Market;
  setMarket: (m: Market) => void;
  leverage: number;
  setLeverage: (n: number) => void;
  margin: number;
  setMargin: (n: number) => void;
  tp: string;
  sl: string;
  setTp: (v: string) => void;
  setSl: (v: string) => void;
  composed: string;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">Desk</h2>
        <span className="font-mono text-[11px] text-faint">CLI · TG · MCP</span>
      </div>
      <form
        className="mt-3 flex flex-col gap-3 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          props.onPreview();
        }}
      >
        <Input
          aria-label="Order command"
          value={props.text}
          onChange={(e) => props.setText(e.target.value)}
          placeholder="long sol 10x 50 usdc tp @ 200 sl @ 85"
        />
        <Button type="submit" disabled={props.busy} size="lg" className="shrink-0 sm:w-32">
          {props.busy ? "Pricing…" : "Preview"}
        </Button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => props.onExample(ex)}
            className="h-9 rounded-sm border border-border px-2.5 font-mono text-[11px] text-muted hover:text-fg"
          >
            {ex}
          </button>
        ))}
      </div>
      <div className="mt-4 grid gap-2">
        <Row label="Side">
          <Button
            type="button"
            variant={props.side === "LONG" ? "long" : "secondary"}
            size="sm"
            onClick={() => props.setSide("LONG")}
          >
            <ArrowUpRight /> Long
          </Button>
          <Button
            type="button"
            variant={props.side === "SHORT" ? "short" : "secondary"}
            size="sm"
            onClick={() => props.setSide("SHORT")}
          >
            <ArrowDownRight /> Short
          </Button>
        </Row>
        <Row label="Market">
          {MARKETS.map((m) => (
            <Button
              key={m}
              type="button"
              variant={props.market === m ? "primary" : "secondary"}
              size="sm"
              onClick={() => props.setMarket(m)}
            >
              {m.replace("-USD", "")}
            </Button>
          ))}
        </Row>
        <Row label="Lev / USDC">
          {LEVS.map((x) => (
            <Button
              key={x}
              type="button"
              variant={props.leverage === x ? "primary" : "secondary"}
              size="sm"
              onClick={() => props.setLeverage(x)}
            >
              {x}x
            </Button>
          ))}
          {MARGINS.map((n) => (
            <Button
              key={n}
              type="button"
              variant={props.margin === n ? "primary" : "secondary"}
              size="sm"
              onClick={() => props.setMargin(n)}
            >
              {n}
            </Button>
          ))}
        </Row>
        <Row label="TP / SL">
          <Input
            aria-label="Take profit price"
            inputMode="decimal"
            placeholder="tp"
            value={props.tp}
            onChange={(e) => props.setTp(e.target.value)}
            className="h-9 w-28 px-2.5"
          />
          <Input
            aria-label="Stop loss price"
            inputMode="decimal"
            placeholder="sl"
            value={props.sl}
            onChange={(e) => props.setSl(e.target.value)}
            className="h-9 w-28 px-2.5"
          />
        </Row>
      </div>
      <p className="mt-3 font-mono text-xs text-faint">{props.composed}</p>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <span className="w-20 shrink-0 font-mono text-[11px] uppercase tracking-wider text-faint">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function PreviewPanel(props: {
  preview: Preview | null;
  error: string | null;
  confirmMsg: string | null;
  busy: boolean;
  session: WalletSession | null;
  embedded: boolean;
  injected: boolean;
  onConfirm: () => void;
  onConnect: () => void;
}) {
  const p = props.preview;
  const tg = telegramUrl();
  const helper = helperAddress();
  const canSign = Boolean(props.session) || (props.injected && !props.embedded);

  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">Fat-finger preview</h2>
        {p ? <Badge>{Math.max(0, Math.ceil((p.expiresAt - Date.now()) / 1000))}s</Badge> : null}
      </div>
      {props.error ? <p className="mt-4 text-sm text-short">{props.error}</p> : null}
      {!p && !props.error ? (
        <p className="mt-4 text-sm text-muted">
          Parse an order to see notional, estimated liquidation, and the privacy note. Nothing
          moves until Ready or Xverse signs.
        </p>
      ) : null}
      {p ? (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={p.intent.side === "LONG" ? "long" : "short"}>{p.intent.side}</Badge>
            <span className="font-display text-xl font-semibold">{p.intent.market}</span>
            <span className="font-mono text-sm text-muted">{p.intent.leverage}x</span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Margin" value={`${p.intent.marginUsdc} USDC`} />
            <Stat label="Notional" value={`$${p.notionalUsdc.toFixed(2)}`} />
            <Stat label="Mark" value={`$${fmt(p.markPrice)}`} />
            <Stat label="Est. liq" value={`~$${fmt(p.estLiqPrice)}`} />
            <Stat
              label="Take profit"
              value={p.intent.tpPrice !== undefined ? `$${fmt(p.intent.tpPrice)}` : "UNSET"}
            />
            <Stat
              label="Stop loss"
              value={p.intent.slPrice !== undefined ? `$${fmt(p.intent.slPrice)}` : "UNSET"}
            />
          </dl>
          {p.warnings.map((w) => (
            <p key={w} className="mt-3 text-sm text-warn">
              {w}
            </p>
          ))}
          <p className="mt-4 font-mono text-[11px] text-faint">id {p.id}</p>
          {canSign ? (
            <Button className="mt-5 w-full" size="lg" disabled={props.busy} onClick={props.onConfirm}>
              {props.session ? "Confirm with wallet" : "Connect and confirm"}
            </Button>
          ) : (
            <div className="mt-5 grid gap-2">
              {tg ? (
                <Button asChild className="w-full" size="lg">
                  <a href={tg} target="_blank" rel="noreferrer">
                    <Bot /> Open Telegram
                  </a>
                </Button>
              ) : null}
              <Button className="w-full" size="lg" variant="secondary" onClick={props.onConnect}>
                <Wallet /> Connect Ready / Xverse
              </Button>
            </div>
          )}
          <p className="mt-2 text-xs text-muted">
            {helper
              ? "Wallet API signs privacy_invoke. Viewing key stays in the wallet."
              : "Helper undeployed — connect still works; confirm waits on MarginRouter."}
          </p>
          {props.embedded && !props.injected ? (
            <p className="mt-2 text-xs text-muted">
              Wallet extensions cannot see this embedded preview. Open the deployed desk, Telegram,
              or the CLI snippet below.
            </p>
          ) : null}
          {props.confirmMsg ? (
            <p className="mt-3 rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-short">
              {props.confirmMsg}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface-2 px-3 py-2">
      <dt className="font-mono text-[10px] uppercase tracking-wider text-faint">{label}</dt>
      <dd className="mt-1 font-mono text-sm tabular text-fg">{value}</dd>
    </div>
  );
}

function Tape({ marks, error }: { marks: MarkSnapshot[]; error: string | null }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">Extended marks</h2>
        <Badge tone="accent">mainnet</Badge>
      </div>
      {error ? <p className="mt-3 text-sm text-short">{error}</p> : null}
      <ul className="mt-4 divide-y divide-border">
        {(marks.length ? marks : MARKETS.map((market) => ({ market }) as MarkSnapshot)).map(
          (row) => {
            const up = (row.dailyChangePct ?? 0) >= 0;
            return (
              <li key={row.market} className="flex items-center justify-between py-2.5">
                <span className="font-medium">{row.market}</span>
                <span className="flex items-center gap-3 font-mono text-sm tabular">
                  <span>{row.markPrice ? `$${fmt(row.markPrice)}` : "—"}</span>
                  {row.dailyChangePct !== undefined ? (
                    <span className={up ? "text-long" : "text-short"}>
                      {up ? "+" : ""}
                      {(row.dailyChangePct * 100).toFixed(2)}%
                    </span>
                  ) : null}
                </span>
              </li>
            );
          },
        )}
      </ul>
    </section>
  );
}

function PrivacyPanel({ privacy }: { privacy: PrivacyStatus | null }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Shield className="size-4 text-accent" />
        <h2 className="font-display text-lg font-semibold">Privacy</h2>
      </div>
      <p className="mt-2 font-mono text-[11px] text-faint">
        pool {shorten(privacy?.pool)} · helper {privacy?.helper ?? "undeployed"}
      </p>
      <div className="mt-4 grid gap-3">
        <Claim
          icon={<Eye className="size-3.5" />}
          title="Public"
          items={
            privacy?.claims.public ?? [
              "Shield depositor, token, amount",
              "Helper size and timing",
              "Extended fill once it hits the book",
            ]
          }
        />
        <Claim
          icon={<EyeOff className="size-3.5" />}
          title="Private"
          items={
            privacy?.claims.private ?? [
              "Note-to-note parties and amounts",
              "Which note funded the helper",
              "Who initiated pool → helper",
            ]
          }
        />
        <p className="flex items-start gap-2 text-sm text-muted">
          <Lock className="mt-0.5 size-3.5 shrink-0" />
          Never amount-private perps. Extended fills are public.
        </p>
      </div>
    </section>
  );
}

function Claim({ icon, title, items }: { icon: ReactNode; title: string; items: string[] }) {
  return (
    <div>
      <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-muted">
        {icon}
        {title}
      </p>
      <ul className="mt-1 space-y-1 text-sm text-fg">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function PositionsPanel({ positions }: { positions: Position[] }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <h2 className="font-display text-lg font-semibold">Positions</h2>
      {positions.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No open positions for this desk.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {positions.map((p) => (
            <li
              key={`${p.market}-${p.side}`}
              className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2 font-mono text-sm"
            >
              <span>
                {p.market} {p.side}
              </span>
              <span className="tabular">{p.size}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CopyBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[11px] uppercase tracking-wider text-faint">{label}</p>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1 text-xs text-muted hover:text-fg"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          <Copy className="size-3.5" />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="mt-2 overflow-x-auto rounded-md bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-fg">
        {value}
      </pre>
    </div>
  );
}

function Skins() {
  const tg = telegramUrl();
  return (
    <section className="mt-16">
      <h2 className="font-display text-2xl font-semibold">One engine. Three skins.</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Web signs with Ready/Xverse. Telegram never caches a key. CLI and MCP are the agent path —
        copy the snippets.
      </p>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <article className="rounded-lg border border-border bg-surface p-4">
          <Bot className="size-4 text-accent" />
          <h3 className="mt-3 font-display text-base font-semibold">Telegram</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Natural language plus buttons that only fill TradeIntent. Reply CONFIRM.
          </p>
          {tg ? (
            <Button asChild className="mt-4 w-full" variant="secondary" size="sm">
              <a href={tg} target="_blank" rel="noreferrer">
                <ExternalLink /> {tg.replace("https://", "")}
              </a>
            </Button>
          ) : (
            <CopyBlock
              label="Start the bot"
              value={"npm run telegram\n# BotFather → BOT_TOKEN\n# VITE_TELEGRAM_BOT=YourBot"}
            />
          )}
        </article>
        <article className="rounded-lg border border-border bg-surface p-4">
          <Terminal className="size-4 text-accent" />
          <h3 className="mt-3 font-display text-base font-semibold">CLI</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            parse works with no env. preview hits Extended mainnet. confirm fails closed without a
            session.
          </p>
          <div className="mt-4">
            <CopyBlock label="Paste in a terminal" value={CLI_SNIPPET} />
          </div>
        </article>
        <article className="rounded-lg border border-border bg-surface p-4">
          <Radio className="size-4 text-accent" />
          <h3 className="mt-3 font-display text-base font-semibold">MCP / agents</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            OpenClaw and Hermes. Five tools. Leverage ≥ 20 needs confirmHighLeverage.
          </p>
          <div className="mt-4">
            <CopyBlock label="mcp.json" value={MCP_SNIPPET} />
          </div>
        </article>
      </div>
    </section>
  );
}

function Claims() {
  return (
    <section className="mt-16 border-t border-border pt-10">
      <h2 className="font-display text-2xl font-semibold">Mainnet, not a mock.</h2>
      <ul className="mt-4 max-w-2xl space-y-2 text-sm leading-relaxed text-muted">
        <li>STRK20 pool, shield, note-to-note, one privacy_invoke helper (MarginRouter).</li>
        <li>Extended CLOB on SN_MAIN for BTC-USD, ETH-USD, SOL-USD, STRK-USD.</li>
        <li>confirm() throws “no wallet session” if Ready/Xverse is not attached. Never a fake hash.</li>
        <li>MIT. IDEA-02. No second Cairo router.</li>
      </ul>
    </section>
  );
}

function composeLine(
  side: "LONG" | "SHORT",
  market: Market,
  leverage: number,
  margin: number,
  tp: string,
  sl: string,
): string {
  const bits = [
    side.toLowerCase(),
    market.replace("-USD", "").toLowerCase(),
    `${leverage}x`,
    `${margin} usdc`,
  ];
  const tpN = Number(String(tp).replace(/,/g, ""));
  const slN = Number(String(sl).replace(/,/g, ""));
  if (Number.isFinite(tpN) && tpN > 0) bits.push(`tp @ ${tpN}`);
  if (Number.isFinite(slN) && slN > 0) bits.push(`sl @ ${slN}`);
  return bits.join(" ");
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

function shorten(addr?: string): string {
  if (!addr) return "—";
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
