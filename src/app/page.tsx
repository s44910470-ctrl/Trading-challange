"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowDownRight, ArrowUpRight, BarChart3, Bell, Check, ChevronDown,
  CircleHelp, Clock3, Copy, Crown, Download, History, LayoutDashboard, LineChart,
  LogOut, Moon, MoreHorizontal, Pause, Play, RefreshCw, RotateCcw, Settings,
  Shield, Sun, TrendingDown, TrendingUp, Trophy, Wallet, X, Zap
} from "lucide-react";

type Quote = { mid:number; bid:number; ask:number; spread:number; source:string; price_as_of:string; is_stale:boolean; received_at:string };
type Trader = { id:string; display_name:string; balance:number; equity:number; return_pct:number; drawdown_pct:number; margin_used:number };
type PaperTrade = {
  id:string; side:"BUY"|"SELL"; order_type:"MARKET"|"LIMIT"|"STOP"; status:"pending"|"open"|"closed"|"cancelled";
  lots:number; trigger_price:number|null; entry_price:number|null; exit_price:number|null;
  stop_loss:number|null; take_profit:number|null; realized_profit:number|null; opened_at:string|null; closed_at:string|null; created_at:string;
};
type ArenaState = {
  role:"participant"|"admin"; me:Trader|null; leaderboard:Trader[]; myTrades:PaperTrade[]; quote:Quote|null;
  competition:{id:string;name:string;status:"draft"|"running"|"completed";is_paused:boolean;starts_at:string|null;ends_at:string|null;max_duration_minutes:number;completed_at:string|null;winner_metric:string;contract_size_oz:number;leverage:number};
  server_time:string;
};
type Candle = {time:string;open:number;high:number;low:number;close:number;volume?:number};
type Tab = "Terminal"|"Positions"|"History"|"Competition"|"Settings";
const endpoint = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/,"") + "/functions/v1/arena-api";
const apiKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const fmt = (v:number|undefined|null,d=2) => v == null || !Number.isFinite(Number(v)) ? "—" : Number(v).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
const cash = (v:number|undefined|null) => (Number(v ?? 0) < 0 ? "-$" : "$") + fmt(Math.abs(Number(v ?? 0)));
const stamp = (v:string|null|undefined) => v ? new Date(v).toLocaleString([], {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}) : "—";
const remaining = (ends:string|null, now:string, paused:boolean) => !ends ? 0 : paused ? Math.max(0,Date.parse(ends)-Date.parse(now)) : Math.max(0,Date.parse(ends)-Date.now());
const cls = (...x:(string|false|undefined|null)[]) => x.filter(Boolean).join(" ");

async function request<T=any>(code:string, body:Record<string,unknown>):Promise<T>{
  if(!endpoint.startsWith("https://") || !apiKey) throw new Error("Backend configuration is missing. Check GitHub Pages Actions variables.");
  const res = await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","apikey":apiKey,"x-arena-code":code},body:JSON.stringify(body),cache:"no-store"});
  const data = await res.json().catch(()=>({error:"Invalid server response"}));
  if(!res.ok) throw new Error(data.error || "Request failed ("+res.status+")");
  return data as T;
}

function IconButton({children,onClick,label}:{children:React.ReactNode;onClick:()=>void;label:string}){
  return <button aria-label={label} title={label} onClick={onClick} className="icon-btn">{children}</button>;
}
function Metric({label,value,detail,positive,icon}:{label:string;value:string;detail:string;positive?:boolean;icon:React.ReactNode}){
  return <div className="metric-card"><div className="metric-top"><span>{label}</span><span className="metric-icon">{icon}</span></div><div className="metric-value">{value}</div><div className={cls("metric-detail",positive===undefined?"":positive?"positive":"negative")}>{detail}</div></div>;
}
function CandleChart({candles,quote}:{candles:Candle[];quote:Quote|null}){
  const W=900,H=315, top=18,bottom=28,left=8,right=76;
  const useful=candles.slice(-95);
  if(!useful.length) return <div className="chart-empty"><LineChart size={28}/><span>Waiting for gold price history…</span><small>Price data loads from the configured reference source.</small></div>;
  const hi=Math.max(...useful.map(x=>x.high),quote?.ask||0), lo=Math.min(...useful.map(x=>x.low),quote?.bid||Infinity);
  const range=Math.max(0.01,hi-lo), xStep=(W-left-right)/useful.length, candleW=Math.max(2,Math.min(8,xStep*.55));
  const y=(p:number)=>top+(hi-p)/range*(H-top-bottom);
  const tickValues=[hi,lo+(range*.75),lo+range*.5,lo+range*.25,lo];
  return <svg viewBox={"0 0 "+W+" "+H} className="chart-svg" role="img" aria-label="XAUUSD candlestick chart">
    {tickValues.map((v,i)=><g key={i}><line x1={left} y1={y(v)} x2={W-right} y2={y(v)} stroke="var(--chart-grid)" strokeDasharray="4 5"/><text x={W-68} y={y(v)+4} fill="var(--muted)" fontSize="11">{fmt(v,2)}</text></g>)}
    {useful.map((c,i)=>{const cx=left+i*xStep+xStep/2,up=c.close>=c.open,color=up?"var(--green)":"var(--red)",bodyY=y(Math.max(c.open,c.close)),bodyH=Math.max(1.3,Math.abs(y(c.open)-y(c.close)));return <g key={c.time+i}><line x1={cx} y1={y(c.high)} x2={cx} y2={y(c.low)} stroke={color} strokeWidth="1.2"/><rect x={cx-candleW/2} y={bodyY} width={candleW} height={bodyH} rx="0.8" fill={color}/></g>})}
    {quote&&<g><line x1={left} x2={W-right} y1={y(quote.mid)} y2={y(quote.mid)} stroke="var(--gold)" strokeDasharray="5 4"/><rect x={W-right+5} y={y(quote.mid)-10} width="67" height="20" rx="5" fill="var(--gold)"/><text x={W-right+38} y={y(quote.mid)+4} textAnchor="middle" fontSize="11" fill="#18130a">{fmt(quote.mid,2)}</text></g>}
    <text x={left} y={H-7} fill="var(--muted)" fontSize="11">{stamp(useful[0].time)}</text><text x={W-right} y={H-7} textAnchor="end" fill="var(--muted)" fontSize="11">{stamp(useful[useful.length-1].time)}</text>
  </svg>;
}

export default function Home(){
  const [code,setCode]=useState("");
  const [inputCode,setInputCode]=useState("");
  const [state,setState]=useState<ArenaState|null>(null);
  const [candles,setCandles]=useState<Candle[]>([]);
  const [chartSource,setChartSource]=useState("");
  const [timeframe,setTimeframe]=useState("5m");
  const [tab,setTab]=useState<Tab>("Terminal");
  const [theme,setTheme]=useState<"dark"|"light">("dark");
  const [busy,setBusy]=useState(false);
  const [refreshing,setRefreshing]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [lots,setLots]=useState("0.01");
  const [side,setSide]=useState<"BUY"|"SELL">("BUY");
  const [orderType,setOrderType]=useState<"MARKET"|"LIMIT"|"STOP">("MARKET");
  const [trigger,setTrigger]=useState("");
  const [sl,setSl]=useState("");
  const [tp,setTp]=useState("");
  const [filter,setFilter]=useState<"all"|"open"|"pending"|"closed">("all");
  const [tick,setTick]=useState(Date.now());
  const [installPrompt,setInstallPrompt]=useState<any>(null);
  const [mobileMenu,setMobileMenu]=useState(false);

  const refresh=useCallback(async(currentCode=code)=>{
    if(!currentCode)return;
    setRefreshing(true);
    try{const data=await request<ArenaState>(currentCode,{action:"state"});setState(data);setError("");setTick(Date.now());}
    catch(e){setError(e instanceof Error?e.message:"Could not load arena");}
    finally{setRefreshing(false);}
  },[code]);

  const loadChart=useCallback(async(currentCode=code,tf=timeframe)=>{
    if(!currentCode)return;
    try{const data=await request<{candles:Candle[];source:string}>(currentCode,{action:"chart",timeframe:tf});setCandles(data.candles||[]);setChartSource(data.source||"");}
    catch(e){setCandles([]);setChartSource(e instanceof Error?e.message:"Chart unavailable");}
  },[code,timeframe]);

  useEffect(()=>{
    const saved=sessionStorage.getItem("zuperior-arena-code");
    if(saved){setCode(saved);}
    const handler=(event:Event)=>{event.preventDefault();setInstallPrompt(event as any);};
    window.addEventListener("beforeinstallprompt",handler);
    if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(()=>{});
    return()=>{window.removeEventListener("beforeinstallprompt",handler);};
  },[]);
  useEffect(()=>{if(code)void refresh(code);},[code,refresh]);
  useEffect(()=>{if(!code||!state)return;void loadChart(code,timeframe);const chartTimer=window.setInterval(()=>void loadChart(code,timeframe),60000);return()=>window.clearInterval(chartTimer);},[code,state?.competition.id,timeframe,loadChart]);
  useEffect(()=>{if(!code)return;const timer=window.setInterval(()=>void refresh(code),15000);return()=>window.clearInterval(timer);},[code,refresh]);
  useEffect(()=>{const t=window.setInterval(()=>setTick(Date.now()),1000);return()=>window.clearInterval(t);},[]);

  const me=state?.me;
  const leaderboard=state?.leaderboard||[];
  const active=useMemo(()=>state?.myTrades.filter(t=>t.status==="open"||t.status==="pending")||[],[state]);
  const closed=useMemo(()=>state?.myTrades.filter(t=>t.status==="closed")||[],[state]);
  const filtered=useMemo(()=>state?.myTrades.filter(t=>filter==="all"||t.status===filter)||[],[state,filter]);
  const floating=useMemo(()=>active.reduce((sum,t)=>{if(t.status!=="open"||!state?.quote||t.entry_price==null)return sum;const exit=t.side==="BUY"?state.quote.bid:state.quote.ask;return sum+(exit-t.entry_price)*100*Number(t.lots)*(t.side==="BUY"?1:-1);},0),[active,state?.quote]);
  const secondsLeft=state?.competition.ends_at?Math.max(0,Math.floor((Date.parse(state.competition.ends_at)-(state.competition.is_paused?Date.parse(state.server_time):tick))/1000)):0;
  const clock=String(Math.floor(secondsLeft/3600)).padStart(2,"0")+":"+String(Math.floor(secondsLeft%3600/60)).padStart(2,"0")+":"+String(secondsLeft%60).padStart(2,"0");
  const challengeRunning=state?.competition.status==="running"&&!state.competition.is_paused;
  const isAdmin=state?.role==="admin";
  const nav: {name:Tab;icon:React.ReactNode}[]=[{name:"Terminal",icon:<LayoutDashboard size={18}/>},{name:"Positions",icon:<Activity size={18}/>},{name:"History",icon:<History size={18}/>},{name:"Competition",icon:<Trophy size={18}/>},{name:"Settings",icon:<Settings size={18}/>}] ;

  const login=async(e:React.FormEvent)=>{e.preventDefault();const value=inputCode.trim();if(!value)return;setBusy(true);setError("");try{const data=await request<ArenaState>(value,{action:"state"});sessionStorage.setItem("zuperior-arena-code",value);setCode(value);setState(data);setInputCode("");setTab("Terminal");setNotice("Secure invite accepted.");}catch(err){setError(err instanceof Error?err.message:"Invalid invite code");}finally{setBusy(false);}};
  const logout=()=>{sessionStorage.removeItem("zuperior-arena-code");setCode("");setState(null);setCandles([]);setNotice("");setError("");};
  const doAction=async(body:Record<string,unknown>,success:string)=>{
    if(!code)return;setBusy(true);setError("");setNotice("");
    try{const data=await request<any>(code,body);if(data.state)setState(data.state);else if(data.role)setState(data as ArenaState);else await refresh(code);setNotice(success);}
    catch(e){setError(e instanceof Error?e.message:"Action failed");}
    finally{setBusy(false);}
  };
  const placeOrder=async(e:React.FormEvent)=>{
    e.preventDefault();if(!state?.quote)return;
    await doAction({action:"place_order",side,order_type:orderType,lots:Number(lots),trigger_price:trigger||null,stop_loss:sl||null,take_profit:tp||null},orderType==="MARKET"?"Paper position opened.": "Pending order placed.");
    setSl("");setTp("");setTrigger("");
  };
  const adminAction=(command:string)=>{
    const text:Record<string,string>={start:"Start the 48-hour competition now? The clock cannot be reversed except by pause.",pause:"Pause the competition timer and trading?",resume:"Resume the timer and trading?",end:"End the competition and settle open positions using the latest price?",reset:"Archive all current paper trades and reset both virtual balances to $50? This cannot be undone."};
    if(!window.confirm(text[command]||"Continue?"))return;
    void doAction({action:"admin",command},"Admin action completed: "+command+".");
  };
  const doInstall=async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice;setInstallPrompt(null);};

  if(!state)return <main className="login-screen" data-theme={theme}>
    <div className="login-orb orb-one"/><div className="login-orb orb-two"/>
    <div className="login-card">
      <div className="brand-mark"><Trophy size={24}/></div>
      <div className="eyebrow">PRIVATE XAUUSD PAPER TRADING</div>
      <h1>ZUPERIOR <span>ARENA</span></h1>
      <p className="login-copy">A private 1v1 gold trading challenge. No broker. No real funds. Just your strategy.</p>
      <div className="login-stats"><div><b>$50</b><small>Virtual balance</small></div><div><b>48H</b><small>Challenge limit</small></div><div><b>1v1</b><small>Private arena</small></div></div>
      <form onSubmit={login} className="login-form">
        <label htmlFor="invite">Your private invite code</label>
        <input id="invite" value={inputCode} onChange={e=>setInputCode(e.target.value)} placeholder="Paste your invite code" autoComplete="off" spellCheck={false}/>
        <button className="btn btn-primary btn-wide" disabled={busy||!inputCode.trim()}>{busy?<RefreshCw className="spin" size={17}/>:<Shield size={17}/>} Enter arena</button>
      </form>
      {error&&<div className="alert error">{error}</div>}
      <div className="login-foot"><Shield size={13}/> Invite-only access · Virtual funds only · Private trades</div>
    </div>
  </main>;

  return <main className="app-shell" data-theme={theme}>
    <header className="topbar">
      <div className="brand-lockup"><div className="brand-mark small"><Trophy size={19}/></div><div><div className="brand-name">ZUPERIOR <span>ARENA</span></div><div className="brand-caption">XAUUSD PAPER TRADING</div></div></div>
      <div className="topbar-right">
        <div className={cls("market-chip",state.quote&&!state.quote.is_stale?"live":"stale")}><i/> {state.quote&&!state.quote.is_stale?"GOLD PRICE LIVE":"PRICE DELAYED"}</div>
        <button className="icon-btn theme-btn" onClick={()=>setTheme(theme==="dark"?"light":"dark")} aria-label="Toggle theme">{theme==="dark"?<Sun size={18}/>:<Moon size={18}/>}</button>
        <button className="profile-chip" onClick={logout}><span className="avatar">{isAdmin?"A":me?.display_name.slice(0,1)||"T"}</span><span>{isAdmin?"Administrator":me?.display_name||"Trader"}</span><LogOut size={14}/></button>
      </div>
    </header>

    <div className="app-body">
      <aside className="sidebar">
        <div className="side-label">WORKSPACE</div>
        {nav.map(n=><button key={n.name} onClick={()=>setTab(n.name)} className={cls("side-link",tab===n.name&&"selected")}>{n.icon}<span>{n.name}</span>{n.name==="Positions"&&active.length>0&&<b>{active.length}</b>}</button>)}
        <div className="sidebar-bottom"><div className="challenge-badge"><span className="pulse-dot"/><div><b>{state.competition.status==="draft"?"WAITING TO START":state.competition.status==="completed"?"CHALLENGE ENDED":state.competition.is_paused?"PAUSED":"CHALLENGE LIVE"}</b><small>48-hour private challenge</small></div></div><div className="sidebar-footer">SECURE PAPER ENVIRONMENT<br/>© ZUPERIOR ARENA</div></div>
      </aside>

      <section className="main-content">
        <div className="page-heading">
          <div><div className="breadcrumb">ARENA <span>/</span> {tab.toUpperCase()}</div><h1>{tab==="Terminal"?"Trading terminal":tab==="Positions"?"Your positions":tab==="History"?"Trade history":tab==="Competition"?"Competition control":"Preferences"}</h1><p>{isAdmin?"Administrator access · private competition controls": "Trade XAUUSD with a $50 virtual account"}</p></div>
          <div className="heading-actions"><button className="btn btn-quiet" onClick={()=>void refresh()} disabled={refreshing}><RefreshCw size={15} className={refreshing?"spin":""}/> <span>Refresh</span></button>{installPrompt&&<button className="btn btn-primary" onClick={()=>void doInstall()}><Download size={15}/> Install app</button>}</div>
        </div>
        {(error||notice)&&<div className={cls("alert",error?"error":"success")}>{error?<><X size={16}/>{error}</>:<><Check size={16}/>{notice}</>}<button onClick={()=>{setError("");setNotice("");}}><X size={15}/></button></div>}

        <div className="quote-strip">
          <div className="quote-main"><div className="symbol-line"><b>XAUUSD</b><span>Gold / US Dollar</span><span className="asset-tag">SPOT REFERENCE</span></div><div className="quote-price">{state.quote?fmt(state.quote.mid,2):"—"} <span>USD / oz</span></div><div className="quote-source">{state.quote?.source||"Waiting for price source"} · Updated {state.quote?stamp(state.quote.price_as_of):"—"}</div></div>
          <div className="quote-side"><div><small>BID</small><b>{state.quote?fmt(state.quote.bid,2):"—"}</b></div><div><small>ASK</small><b>{state.quote?fmt(state.quote.ask,2):"—"}</b></div><div><small>SPREAD</small><b>{state.quote?fmt(state.quote.spread,2):"—"}</b></div></div>
        </div>
        {state.quote?.is_stale&&<div className="alert warning"><CircleHelp size={16}/> Price feed is stale. New orders and manual closes are disabled until a fresh quote is available.</div>}

        {tab==="Terminal"&&<div className="terminal-grid">
          <div className="terminal-main">
            <div className="metrics-grid">
              <Metric label="ACCOUNT EQUITY" value={cash(me?.equity??50)} detail={"Balance "+cash(me?.balance??50)} icon={<Wallet size={17}/>}/>
              <Metric label="FLOATING P&L" value={cash(floating)} detail={active.filter(t=>t.status==="open").length+" open positions"} positive={floating>=0} icon={floating>=0?<TrendingUp size={17}/>:<TrendingDown size={17}/>}/>
              <Metric label="RETURN" value={(me?.return_pct??0)>=0?"+":""+fmt(me?.return_pct??0)+"%"} detail={"Max drawdown "+fmt(me?.drawdown_pct??0)+"%"} positive={(me?.return_pct??0)>=0} icon={<Activity size={17}/>}/>
              <Metric label="USED MARGIN" value={cash(me?.margin_used??0)} detail={"Leverage 1:"+state.competition.leverage} icon={<BarChart3 size={17}/>}/>
            </div>
            <div className="surface chart-panel">
              <div className="panel-heading"><div><h2>Gold market chart</h2><p>XAUUSD · reference feed candles</p></div><div className="timeframes">{["1m","5m","15m","1h","4h"].map(tf=><button key={tf} onClick={()=>setTimeframe(tf)} className={timeframe===tf?"active":""}>{tf.toUpperCase()}</button>)}</div></div>
              <div className="chart-wrap"><CandleChart candles={candles} quote={state.quote}/></div>
              <div className="chart-footer"><span><i className="legend-dot gold-dot"/> MID PRICE</span><span>{chartSource||"Loading chart history"}</span></div>
            </div>
            <div className="surface board-panel">
              <div className="panel-heading"><div><h2>Live leaderboard</h2><p>Ranked by return percentage, drawdown as tie-breaker</p></div><span className="count-pill">2 TRADERS</span></div>
              <div className="leader-list">{leaderboard.map((trader,i)=><div className={cls("leader-row",trader.id===me?.id&&"my-row")} key={trader.id}><div className="rank">{i===0?<Crown size={16}/>:<span>02</span>}</div><div className="leader-avatar">{trader.display_name.slice(0,1)}</div><div className="leader-id"><b>{trader.display_name} {trader.id===me?.id&&<small>YOU</small>}</b><span>Equity {cash(trader.equity)} · DD {fmt(trader.drawdown_pct)}%</span></div><div className="leader-pnl"><b className={trader.return_pct>=0?"positive":"negative"}>{trader.return_pct>=0?"+":""}{fmt(trader.return_pct)}%</b><span>{cash(trader.equity)}</span></div></div>)}</div>
            </div>
          </div>
          <aside className="terminal-side">
            <div className="surface order-panel">
              <div className="panel-heading compact"><div><h2>Place paper order</h2><p>Virtual execution only</p></div><Zap size={17} className="gold-text"/></div>
              <form onSubmit={placeOrder}>
                <div className="side-switch"><button type="button" className={side==="BUY"?"buy-selected":""} onClick={()=>setSide("BUY")}><ArrowUpRight size={16}/> BUY</button><button type="button" className={side==="SELL"?"sell-selected":""} onClick={()=>setSide("SELL")}><ArrowDownRight size={16}/> SELL</button></div>
                <label>ORDER TYPE</label><select value={orderType} onChange={e=>setOrderType(e.target.value as any)}><option value="MARKET">Market execution</option><option value="LIMIT">Limit order</option><option value="STOP">Stop order</option></select>
                <div className="form-label-row"><label>VOLUME (LOTS)</label><span>Min 0.01</span></div>
                <div className="lot-control"><button type="button" onClick={()=>setLots(v=>String(Math.max(.01,Number(v)-.01).toFixed(2)))}>−</button><input type="number" inputMode="decimal" min="0.01" max="5" step="0.01" value={lots} onChange={e=>setLots(e.target.value)}/><button type="button" onClick={()=>setLots(v=>String(Math.min(5,Number(v)+.01).toFixed(2)))}>+</button></div>
                {orderType!=="MARKET"&&<><label>TRIGGER PRICE</label><input type="number" inputMode="decimal" step="0.01" placeholder="Enter pending price" value={trigger} onChange={e=>setTrigger(e.target.value)} required/></>}
                <div className="two-fields"><div><label>STOP LOSS <span>OPTIONAL</span></label><input type="number" inputMode="decimal" step="0.01" placeholder="—" value={sl} onChange={e=>setSl(e.target.value)}/></div><div><label>TAKE PROFIT <span>OPTIONAL</span></label><input type="number" inputMode="decimal" step="0.01" placeholder="—" value={tp} onChange={e=>setTp(e.target.value)}/></div></div>
                <div className="order-estimate"><span>Contract size</span><b>100 oz / lot</b><span>Margin estimate</span><b>{state.quote?cash(state.quote.mid*100*Number(lots||0)/state.competition.leverage):"—"}</b><span>Estimated spread</span><b>{state.quote?fmt(state.quote.spread,2)+" USD":"—"}</b></div>
                <button className={cls("btn","btn-wide","order-submit",side==="BUY"?"btn-buy":"btn-sell")} disabled={busy||!challengeRunning||!state.quote||state.quote.is_stale}>{busy?<RefreshCw className="spin" size={17}/>:side==="BUY"?<ArrowUpRight size={17}/>:<ArrowDownRight size={17}/>} {side==="BUY"?"BUY GOLD":"SELL GOLD"}</button>
                {!challengeRunning&&<div className="order-hint">{state.competition.status==="draft"?"Waiting for admin to start the challenge.":state.competition.is_paused?"Trading is paused.":"Challenge completed."}</div>}
                <div className="order-disclaimer">Simulation only. Quote and spread are reference estimates, not broker execution prices.</div>
              </form>
            </div>
            <div className="surface timer-panel"><div className="timer-top"><Clock3 size={16}/><span>CHALLENGE TIMER</span></div><div className="timer-value">{state.competition.status==="draft"?"48:00:00":state.competition.status==="completed"?"00:00:00":clock}</div><div className="timer-bottom"><span className={cls("status-dot",challengeRunning?"green":state.competition.is_paused?"amber":"gray")}/>{state.competition.status==="draft"?"Not started":state.competition.status==="completed"?"Completed":state.competition.is_paused?"Paused":"Time remaining"}</div></div>
          </aside>
        </div>}

        {tab==="Positions"&&<div className="surface table-surface"><div className="panel-heading"><div><h2>Open positions & pending orders</h2><p>Only your own trades are visible to you</p></div><span className="count-pill">{active.length} ACTIVE</span></div><TradeTable trades={active} quote={state.quote} onClose={id=>void doAction({action:"close_trade",trade_id:id},"Position closed.")} onCancel={id=>void doAction({action:"cancel_order",trade_id:id},"Pending order cancelled.")} busy={busy}/></div>}

        {tab==="History"&&<div className="surface table-surface"><div className="panel-heading"><div><h2>Your trade history</h2><p>Private record of your paper account</p></div><select className="filter-select" value={filter} onChange={e=>setFilter(e.target.value as any)}><option value="all">All trades</option><option value="open">Open</option><option value="pending">Pending</option><option value="closed">Closed</option></select></div><TradeTable trades={filtered} quote={state.quote} onClose={id=>void doAction({action:"close_trade",trade_id:id},"Position closed.")} onCancel={id=>void doAction({action:"cancel_order",trade_id:id},"Pending order cancelled.")} busy={busy}/><div className="history-footer">Closed trades: {closed.length} · Realized P&L: {cash(closed.reduce((a,t)=>a+Number(t.realized_profit||0),0))}</div></div>}

        {tab==="Competition"&&<div className="competition-layout">
          <div className="surface competition-card"><div className="panel-heading"><div><h2>1v1 competition</h2><p>{state.competition.name}</p></div><span className={cls("state-pill",state.competition.status)}>{state.competition.status==="running"?(state.competition.is_paused?"PAUSED":"LIVE"):state.competition.status.toUpperCase()}</span></div><div className="competition-stats"><div><small>STARTING CAPITAL</small><b>$50.00</b></div><div><small>DURATION</small><b>48 HOURS</b></div><div><small>TRADERS</small><b>02</b></div><div><small>RANKING</small><b>RETURN %</b></div></div><div className="competition-note"><Shield size={18}/><div><b>Private trading records</b><p>Each participant sees their own positions and trade history. Both participants can view the shared leaderboard and their equity performance.</p></div></div><div className="leader-list">{leaderboard.map((p,i)=><div className="leader-row" key={p.id}><div className="rank">{i+1}</div><div className="leader-avatar">{p.display_name[0]}</div><div className="leader-id"><b>{p.display_name}</b><span>Max drawdown {fmt(p.drawdown_pct)}%</span></div><div className="leader-pnl"><b className={p.return_pct>=0?"positive":"negative"}>{p.return_pct>=0?"+":""}{fmt(p.return_pct)}%</b><span>Equity {cash(p.equity)}</span></div></div>)}</div></div>
          {isAdmin&&<div className="surface admin-card"><div className="panel-heading"><div><h2>Admin controls</h2><p>Only the administrator invite can control this challenge</p></div><Shield size={17} className="gold-text"/></div><div className="admin-actions">{state.competition.status==="draft"&&<button className="btn btn-primary btn-wide" onClick={()=>adminAction("start")} disabled={busy}><Play size={16}/> Start 48-hour challenge</button>}{state.competition.status==="running"&&!state.competition.is_paused&&<button className="btn btn-secondary btn-wide" onClick={()=>adminAction("pause")} disabled={busy}><Pause size={16}/> Pause challenge</button>}{state.competition.status==="running"&&state.competition.is_paused&&<button className="btn btn-primary btn-wide" onClick={()=>adminAction("resume")} disabled={busy}><Play size={16}/> Resume challenge</button>}{state.competition.status==="running"&&<button className="btn btn-danger btn-wide" onClick={()=>adminAction("end")} disabled={busy}><X size={16}/> End challenge</button>}<button className="btn btn-quiet btn-wide" onClick={()=>adminAction("reset")} disabled={busy}><RotateCcw size={16}/> Reset / new round</button></div><div className="admin-warning">Starting the challenge begins the 48-hour clock. Reset archives the current round's records but does not erase the historical database rows.</div></div>}
        </div>}

        {tab==="Settings"&&<div className="settings-layout"><div className="surface settings-card"><div className="panel-heading"><div><h2>Appearance</h2><p>Choose your trading workspace theme</p></div></div><div className="theme-options"><button className={theme==="dark"?"theme-option chosen":"theme-option"} onClick={()=>setTheme("dark")}><Moon/><span><b>Dark graphite</b><small>Black and gold terminal</small></span>{theme==="dark"&&<Check size={16}/>}</button><button className={theme==="light"?"theme-option chosen":"theme-option"} onClick={()=>setTheme("light")}><Sun/><span><b>Light minimal</b><small>Clean bright workspace</small></span>{theme==="light"&&<Check size={16}/>}</button></div></div><div className="surface settings-card"><div className="panel-heading"><div><h2>Account & platform</h2><p>Private access and app installation</p></div></div><div className="setting-line"><span>Account role</span><b>{isAdmin?"Administrator":"Participant"}</b></div><div className="setting-line"><span>Starting virtual balance</span><b>$50.00</b></div><div className="setting-line"><span>Trading instrument</span><b>XAUUSD</b></div><div className="setting-line"><span>Leverage</span><b>1:1,000</b></div><div className="setting-line"><span>Price source</span><b>{state.quote?.source||"Unavailable"}</b></div><button className="btn btn-quiet btn-wide" onClick={()=>void refresh()}><RefreshCw size={15}/> Refresh account state</button>{installPrompt&&<button className="btn btn-primary btn-wide" onClick={()=>void doInstall()}><Download size={15}/> Install Zuperior Arena</button>}</div><div className="surface settings-card"><div className="panel-heading"><div><h2>Platform notes</h2><p>Price, fills and simulation limitations</p></div><CircleHelp size={17}/></div><ul className="notes-list"><li>All balances and orders are virtual. No broker account is connected.</li><li>Price execution uses the bid/ask quote supplied by the configured price source and the simulator spread.</li><li>XAUS spot is cached at roughly 60 seconds; TradingView chart libraries do not provide market prices themselves.</li><li>OANDA API pricing can be used only after an authorized API token and account ID are configured securely on the server.</li><li>Stop loss, take profit and pending orders are evaluated when the server receives a fresh quote; this is not an exchange-grade tick engine.</li></ul></div></div>}

        <footer className="main-footer"><span>© 2026 ZUPERIOR TRADING ARENA</span><span>SIMULATED TRADING · NO REAL FUNDS</span></footer>
      </section>
    </div>
    <nav className="mobile-nav">{nav.map(n=><button key={n.name} onClick={()=>setTab(n.name)} className={tab===n.name?"active":""}>{n.icon}<span>{n.name==="Competition"?"Arena":n.name==="Settings"?"More":n.name}</span></button>)}</nav>
    <div className="floating-refresh"><button onClick={()=>void refresh()} aria-label="Refresh data" disabled={refreshing}><RefreshCw size={17} className={refreshing?"spin":""}/></button></div>
  </main>;
}

function TradeTable({trades,quote,onClose,onCancel,busy}:{trades:PaperTrade[];quote:Quote|null;onClose:(id:string)=>void;onCancel:(id:string)=>void;busy:boolean}){
  if(!trades.length)return <div className="table-empty"><Activity size={25}/><b>No trades to display</b><span>Paper positions and pending orders will appear here.</span></div>;
  return <div className="trade-list">{trades.map(t=>{const live=t.status==="open"&&quote&&t.entry_price!=null?(quote.bid-t.entry_price)*100*Number(t.lots)*(t.side==="BUY"?1:-1):null;const pnl=t.status==="closed"?Number(t.realized_profit||0):live;return <div className="trade-row" key={t.id}><div className={cls("trade-side",t.side==="BUY"?"buy":"sell")}>{t.side==="BUY"?<ArrowUpRight size={15}/>:<ArrowDownRight size={15}/>}<b>{t.side}</b></div><div className="trade-detail"><b>XAUUSD · {fmt(t.lots,2)} lots</b><span>{t.order_type} · {t.status.toUpperCase()} · {t.status==="pending"?"Trigger "+fmt(t.trigger_price):"Entry "+fmt(t.entry_price)}</span><small>{stamp(t.opened_at||t.created_at)} {t.stop_loss?"· SL "+fmt(t.stop_loss):""} {t.take_profit?"· TP "+fmt(t.take_profit):""}</small></div><div className="trade-pnl"><b className={pnl==null?"":pnl>=0?"positive":"negative"}>{pnl==null?"—":cash(pnl)}</b><span>{t.status==="closed"?"Realized":t.status==="pending"?"Waiting":"Floating"}</span></div><div className="trade-action">{t.status==="open"&&<button onClick={()=>onClose(t.id)} disabled={busy}>Close</button>}{t.status==="pending"&&<button onClick={()=>onCancel(t.id)} disabled={busy}>Cancel</button>}</div></div>})}</div>;
}
