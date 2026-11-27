"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Bell, CheckCircle2, Clock3, Database, Radio, RefreshCw, ShieldCheck, Trophy, Wifi, WifiOff } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { demoAlerts, demoParticipants, demoTrades } from "@/lib/demo-data";
import type { Participant, TradeFeedItem, ArenaAlert } from "@/lib/types";

type Tab = "Overview" | "Trades" | "Alerts" | "Rules";
const money = (v: number | null | undefined) => "$" + Number(v ?? 0).toFixed(2);
const ago = (v: string | null) => v ? new Date(v).toLocaleString() : "Never connected";

export default function Home() {
  const [tab, setTab] = useState<Tab>("Overview");
  const [participants, setParticipants] = useState<Participant[]>(demoParticipants);
  const [trades, setTrades] = useState<TradeFeedItem[]>(demoTrades);
  const [alerts, setAlerts] = useState<ArenaAlert[]>(demoAlerts);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!supabase) { setConnected(false); return; }
    setLoading(true);
    const [p, t, a] = await Promise.all([
      supabase.from("leaderboard_public").select("*").order("last_balance", { ascending: false }),
      supabase.from("trade_feed_public").select("*").order("deal_time", { ascending: false }).limit(30),
      supabase.from("notifications_public").select("*").order("created_at", { ascending: false }).limit(30)
    ]);
    if (p.error) setError(p.error.message);
    else if (p.data?.length) setParticipants(p.data as Participant[]);
    if (!t.error && t.data) setTrades(t.data as TradeFeedItem[]);
    if (!a.error && a.data) setAlerts(a.data as ArenaAlert[]);
    setConnected(!p.error);
    setLastRefresh(new Date().toISOString());
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const ranked = useMemo(() => [...participants].sort((a, b) => Number(b.last_balance ?? b.starting_balance) - Number(a.last_balance ?? a.starting_balance)), [participants]);
  const leader = ranked[0];
  const totalTrades = trades.length;
  const unread = alerts.filter(a => !a.acknowledged).length;
  const nav: Tab[] = ["Overview", "Trades", "Alerts", "Rules"];

  return <main className="min-h-screen">
    <header className="sticky top-0 z-20 border-b border-[#1b3653] bg-[#071426]/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-sky-400/10 p-2 text-sky-300"><Trophy size={24}/></div>
          <div><div className="font-bold tracking-wide">ZUPERIOR <span className="text-sky-300">TRADING ARENA</span></div><div className="text-[11px] tracking-widest text-slate-400">PRIVATE 1v1 DEMO CHALLENGE</div></div>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-xs text-sky-200">
          <span className={connected ? "h-2 w-2 rounded-full bg-emerald-400" : "h-2 w-2 rounded-full bg-amber-400"}/>
          {connected ? "DATABASE CONNECTED" : "PREVIEW / NOT CONNECTED"}
        </div>
      </div>
    </header>

    <div className="mx-auto grid max-w-7xl gap-6 px-5 py-7 lg:grid-cols-[220px_1fr]">
      <aside className="panel h-fit p-3">
        <div className="px-3 py-3 text-xs font-semibold uppercase tracking-widest text-slate-500">Challenge menu</div>
        {nav.map(item => <button key={item} onClick={() => setTab(item)} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm ${tab === item ? "bg-sky-400/10 text-sky-300" : "text-slate-300 hover:bg-white/5"}`}>
          {item === "Overview" ? <Activity size={17}/> : item === "Trades" ? <Database size={17}/> : item === "Alerts" ? <Bell size={17}/> : <ShieldCheck size={17}/>}
          {item}{item === "Alerts" && unread > 0 ? <span className="ml-auto rounded-full bg-amber-400/15 px-2 py-0.5 text-xs text-amber-300">{unread}</span> : null}
        </button>)}
        <div className="mt-5 rounded-xl border border-[#1b3653] bg-[#08182b] p-3">
          <div className="flex items-center gap-2 text-xs text-sky-300"><Radio size={14}/> MT5 CONNECTORS</div>
          {ranked.map(p => <div key={p.id} className="mt-3 flex items-center justify-between gap-2 text-xs"><span className="text-slate-300">{p.display_name}</span><span className={p.is_connected ? "text-emerald-300" : "text-amber-300"}>{p.is_connected ? "Online" : "Offline"}</span></div>)}
        </div>
      </aside>

      <section className="min-w-0">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div><div className="text-sm text-slate-400">Competition / {tab}</div><h1 className="mt-1 text-3xl font-bold">{tab}</h1><p className="mt-1 text-sm text-slate-400">Two $50 demo accounts · 48-hour maximum · highest final balance wins</p></div>
          <button onClick={() => void refresh()} className="flex items-center gap-2 rounded-xl border border-[#244361] px-3 py-2 text-sm text-slate-200 hover:bg-white/5"><RefreshCw size={15} className={loading ? "animate-spin" : ""}/> Refresh</button>
        </div>

        {error && <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">Data connection issue: {error}. Showing the last available preview until Supabase permissions are configured.</div>}

        {tab === "Overview" && <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric icon={<Trophy/>} label="Current leader" value={leader?.display_name ?? "Waiting"} sub={money(leader?.last_balance ?? 50) + " balance"}/>
            <Metric icon={<Activity/>} label="Leader profit" value={money(Number(leader?.last_balance ?? 50) - 50)} sub="Compared with $50 start"/>
            <Metric icon={<Database/>} label="Recent deals" value={String(totalTrades)} sub="Latest 30 received deals"/>
            <Metric icon={<Clock3/>} label="Challenge duration" value="48 hours" sub="Maximum duration"/>
          </div>
          <div className="panel mt-5 overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#1b3653] px-5 py-4"><div><h2 className="font-semibold">Live leaderboard</h2><p className="text-xs text-slate-400">Ranked by account balance, not floating equity</p></div><span className="rounded-full bg-sky-400/10 px-3 py-1 text-xs text-sky-200">2 TRADERS</span></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><thead className="text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-4">Rank</th><th className="px-5 py-4">Trader</th><th className="px-5 py-4">Balance</th><th className="px-5 py-4">Equity</th><th className="px-5 py-4">Profit</th><th className="px-5 py-4">MT5 status</th></tr></thead><tbody>{ranked.map((p, i) => { const balance = Number(p.last_balance ?? p.starting_balance); return <tr key={p.id} className="border-t border-[#1b3653]/70"><td className="px-5 py-4">{i === 0 ? "🥇" : "🥈"} {i + 1}</td><td className="px-5 py-4 font-semibold">{p.display_name}</td><td className="px-5 py-4 font-semibold">{money(balance)}</td><td className="px-5 py-4">{money(p.last_equity ?? balance)}</td><td className={`px-5 py-4 ${balance >= 50 ? "text-emerald-300" : "text-rose-300"}`}>{balance >= 50 ? "+" : ""}{money(balance - 50)}</td><td className="px-5 py-4"><span className={p.is_connected ? "inline-flex items-center gap-2 text-emerald-300" : "inline-flex items-center gap-2 text-amber-300"}>{p.is_connected ? <Wifi size={14}/> : <WifiOff size={14}/>} {p.is_connected ? "Online" : "Offline"}</span><div className="mt-1 text-[10px] text-slate-500">{ago(p.last_seen)}</div></td></tr>; })}</tbody></table></div>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="panel p-5"><h3 className="font-semibold">Competition setup</h3><div className="mt-4 space-y-3 text-sm">{[["Starting balance","$50 each"],["Duration","48 hours maximum"],["Participants","2"],["Winner","Highest final balance"],["Open positions","Must be closed at the finish"]].map(([k,v]) => <div key={k} className="flex justify-between gap-3 border-b border-[#1b3653] pb-2"><span className="text-slate-400">{k}</span><span>{v}</span></div>)}</div></div>
            <div className="panel p-5"><h3 className="font-semibold">Monitoring status</h3><div className="mt-4 space-y-3 text-sm"><StatusLine label="Supabase data" ok={connected}/><StatusLine label="Your MT5 connector" ok={Boolean(ranked[0]?.is_connected)}/><StatusLine label="Friend MT5 connector" ok={Boolean(ranked[1]?.is_connected)}/><p className="pt-2 text-xs text-slate-500">Last dashboard refresh: {lastRefresh ? new Date(lastRefresh).toLocaleTimeString() : "Not yet refreshed"}</p></div></div>
          </div>
        </>}

        {tab === "Trades" && <div className="panel overflow-hidden"><div className="border-b border-[#1b3653] px-5 py-4"><h2 className="font-semibold">Trade and deal history</h2><p className="text-xs text-slate-400">Closed deals reported by MT5. Preview is empty until connectors send data.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="text-xs text-slate-500"><tr>{["Trader","Symbol","Type","Entry","Volume","Price","Profit","Time"].map(x => <th key={x} className="px-4 py-3">{x}</th>)}</tr></thead><tbody>{trades.map(t => <tr key={t.id} className="border-t border-[#1b3653]/70"><td className="px-4 py-3">{t.display_name}</td><td className="px-4 py-3">{t.symbol ?? "—"}</td><td className="px-4 py-3">{t.deal_type ?? "—"}</td><td className="px-4 py-3">{t.entry_type ?? "—"}</td><td className="px-4 py-3">{t.volume ?? "—"}</td><td className="px-4 py-3">{t.price ?? "—"}</td><td className={`px-4 py-3 ${Number(t.profit ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{money(t.profit)}</td><td className="px-4 py-3">{t.deal_time ? new Date(t.deal_time).toLocaleString() : "—"}</td></tr>)}</tbody></table>{trades.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No MT5 deals received yet.</p>}</div></div>}

        {tab === "Alerts" && <div className="space-y-3">{alerts.map(a => <div key={a.id} className="panel flex items-start gap-3 p-4"><div className={a.severity === "violation" ? "rounded-lg bg-rose-400/10 p-2 text-rose-300" : "rounded-lg bg-amber-400/10 p-2 text-amber-300"}><AlertTriangle size={18}/></div><div className="min-w-0"><div className="font-semibold">{a.title}</div><p className="mt-1 text-sm text-slate-400">{a.display_name}: {a.message}</p><p className="mt-2 text-xs text-slate-500">{new Date(a.created_at).toLocaleString()}</p></div></div>)}{alerts.length === 0 && <div className="panel p-8 text-center text-sm text-slate-500">No alerts yet.</div>}</div>}

        {tab === "Rules" && <div className="panel p-5"><h2 className="font-semibold">Challenge rules</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{[["Starting balance","$50 per participant"],["Duration","Maximum 48 hours"],["Deposits / withdrawals","Prohibited; automatically flagged when reported by MT5"],["Account resets","Suspicious history/balance changes flagged for review"],["Trading after deadline","Flagged if a deal is received after the server deadline"],["Winner","Highest final account balance"],["Positions","Both accounts must be flat before final result"],["Connection loss","Offline warning only; not an automatic disqualification"]].map(([k,v]) => <div key={k} className="rounded-xl border border-[#1b3653] bg-[#08182b] p-3"><div className="text-xs text-slate-500">{k}</div><div className="mt-1 text-sm">{v}</div></div>)}</div><p className="mt-4 text-xs text-amber-200">Important: MT5 history and broker-side records are the evidence source. A disconnected terminal cannot report events until it reconnects; missing data must be reviewed rather than treated as proof of cheating.</p></div>}

        <div className="mt-5 flex flex-wrap justify-between gap-2 text-xs text-slate-500"><span>© Zuperior Trading Arena</span><span>MT5 monitoring only · No trade execution permissions</span></div>
      </section>
    </div>
  </main>;
}

function Metric({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return <div className="panel p-4"><div className="flex items-center justify-between text-sky-300"><span className="text-xs text-slate-400">{label}</span>{icon}</div><div className="mt-3 text-2xl font-bold">{value}</div><div className="mt-1 text-xs text-slate-500">{sub}</div></div>;
}
function StatusLine({ label, ok }: { label: string; ok: boolean }) {
  return <div className="flex items-center justify-between"><span className="text-slate-400">{label}</span><span className={ok ? "inline-flex items-center gap-2 text-emerald-300" : "inline-flex items-center gap-2 text-amber-300"}>{ok ? <CheckCircle2 size={15}/> : <AlertTriangle size={15}/>} {ok ? "Ready" : "Waiting"}</span></div>;
}
