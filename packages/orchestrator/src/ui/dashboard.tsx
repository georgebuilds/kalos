/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment, render } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

type TaskStatus = 'pending' | 'running' | 'completed' | 'failed'

interface Task {
  id: string
  repo: string
  description: string
  status: TaskStatus
  branch: string | null
  prUrl: string | null
  createdAt: number
  completedAt: number | null
  error: string | null
}

interface EnvCheck {
  key: string
  ok: boolean
  detail: string | null
}

interface DashboardData {
  tasks: Task[]
  env: EnvCheck[]
  stats: {
    tasksToday: number
    successRate: number | null
    avgDurationSec: number | null
    activeAgents: number
    queueDepth: number
  }
  version: string
  provider: string
  now: string
}

const CSS = `
:root {
  --bg:       #f8f2e8;
  --paper:    #f2e8d8;
  --vellum:   #ebe0cc;
  --line:     #ddd2bc;
  --line-hi:  #c8baa6;
  --ink-0:    #1d1118;
  --ink-1:    #44263a;
  --ink-2:    #7a5467;
  --ink-3:    #7d5a6b;
  --ink-4:    #7d5a6b;
  --wine:     #7b2d42;
  --wine-dk:  #5a1e31;
  --wine-md:  #9d4260;
  --wine-lt:  #d38ea0;
  --wine-ws:  #f7ecf0;
  --ok:       #3a6836;  --ok-bg:   #edf4ec;
  --warn:     #795210;  --warn-bg: #f6f0e5;
  --err:      #8a1f1f;  --err-bg:  #f6ecec;
  --info:     #28587e;  --info-bg: #ecf2f8;
  --serif: 'Fraunces', Georgia, serif;
  --sans:  'DM Sans', ui-sans-serif, sans-serif;
  --mono:  'DM Mono', ui-monospace, 'SF Mono', Menlo, monospace;
}
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
html { color-scheme: light; }
body {
  background: var(--bg);
  background-image:
    radial-gradient(ellipse 80% 55% at 88% 0%,  rgba(123,45,66,.055) 0%, transparent 55%),
    radial-gradient(ellipse 55% 45% at  8% 98%, rgba(123,45,66,.030) 0%, transparent 55%);
  background-attachment: fixed;
  color: var(--ink-0);
  font-family: var(--sans);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  min-height: 100vh;
  overflow-x: hidden;
}
body::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 200;
  opacity: 0.032;
  mix-blend-mode: multiply;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.72' numOctaves='4' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.3  0 0 0 0 0.15  0 0 0 0 0.1  0 0 0 1.2 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
}
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: var(--bg); }
::-webkit-scrollbar-thumb { background: var(--line-hi); border: 2px solid var(--bg); border-radius: 5px; }
::-webkit-scrollbar-thumb:hover { background: var(--ink-3); }
::selection { background: var(--wine); color: var(--bg); }
a { color: var(--wine); text-decoration: none; border-bottom: 1px solid var(--wine-lt); transition: border-color .2s, color .2s; }
a:hover { color: var(--wine-dk); border-bottom-color: var(--wine-dk); }
.wrap { max-width: 1480px; margin: 0 auto; padding: 56px 64px 96px; }
@media (max-width: 880px) { .wrap { padding: 32px 24px 64px; } }
.masthead { display: grid; grid-template-columns: 1fr auto; gap: 48px; align-items: end; padding-bottom: 36px; margin-bottom: 56px; border-bottom: 1px solid var(--line); position: relative; animation: rise .9s cubic-bezier(.2,.8,.2,1) .05s both; }
.masthead::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 1px; background: linear-gradient(90deg, var(--wine) 0%, var(--wine) 88px, transparent 88px); }
.wordmark { font-family: var(--serif); font-style: italic; font-weight: 400; font-size: clamp(64px,10vw,112px); line-height: .85; letter-spacing: -.03em; color: var(--wine-dk); margin: 0; }
.subtitle { display: flex; align-items: center; gap: 14px; margin-top: 18px; font-family: var(--mono); font-size: 11px; letter-spacing: .18em; text-transform: uppercase; color: var(--ink-2); }
.subtitle .greek { font-family: var(--serif); font-style: italic; font-size: 16px; letter-spacing: 0; text-transform: none; color: var(--ink-1); }
.subtitle .sep { color: var(--line-hi); }
.meta { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; font-family: var(--mono); font-size: 12px; color: var(--ink-2); }
.meta-row { display: inline-flex; align-items: center; gap: 10px; }
.pulse { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); animation: pulse-ok 2.4s infinite cubic-bezier(.66,0,0,1); }
.pulse.bad  { background: var(--err);  animation-name: pulse-bad; }
.pulse.warn { background: var(--warn); animation-name: pulse-warn; }
@keyframes pulse-ok  { 0%,100%{ box-shadow:0 0 0 0 rgba(58,104,54,.45) } 70%{ box-shadow:0 0 0 8px rgba(58,104,54,0) } }
@keyframes pulse-bad { 0%,100%{ box-shadow:0 0 0 0 rgba(138,31,31,.45) } 70%{ box-shadow:0 0 0 8px rgba(138,31,31,0) } }
@keyframes pulse-warn{ 0%,100%{ box-shadow:0 0 0 0 rgba(121,82,16,.45) } 70%{ box-shadow:0 0 0 8px rgba(121,82,16,0) } }
.section-label { display: flex; align-items: center; gap: 14px; margin-bottom: 24px; font-family: var(--mono); font-size: 10.5px; letter-spacing: .22em; text-transform: uppercase; color: var(--ink-2); }
.section-label .num { color: var(--wine); font-feature-settings: 'tnum'; }
.section-label .rule { flex: 1; height: 1px; background: var(--line); }
.section-label .extra { color: var(--ink-3); font-size: 10.5px; }
.stats { display: grid; grid-template-columns: repeat(4,1fr); margin-bottom: 64px; border: 1px solid var(--line); border-radius: 3px; overflow: hidden; background: var(--paper); animation: rise .9s cubic-bezier(.2,.8,.2,1) .15s both; }
@media (max-width: 880px) { .stats { grid-template-columns: repeat(2,1fr); } }
.stat { padding: 28px 32px 30px; border-right: 1px solid var(--line); position: relative; }
.stat:last-child { border-right: none; }
.stat::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; }
.stat:first-child::before { background: var(--wine); }
@media (max-width: 880px) { .stat:nth-child(2){ border-right:none } .stat:nth-child(1),.stat:nth-child(2){ border-bottom:1px solid var(--line) } }
.stat-label { font-family: var(--mono); font-size: 10px; letter-spacing: .2em; text-transform: uppercase; color: var(--ink-2); margin-bottom: 14px; }
.stat-value { font-family: var(--serif); font-style: italic; font-size: 56px; line-height: 1; letter-spacing: -.03em; color: var(--wine-dk); font-feature-settings: 'tnum'; }
.stat-value .unit { font-family: var(--sans); font-style: normal; font-size: 14px; color: var(--ink-2); margin-left: 6px; vertical-align: 6px; }
.stat-foot { margin-top: 14px; font-family: var(--mono); font-size: 11px; color: var(--ink-3); display: flex; align-items: center; gap: 8px; }
.stat-foot .accent { color: var(--wine-md); }
.ledger { margin-bottom: 64px; animation: rise .9s cubic-bezier(.2,.8,.2,1) .25s both; }
.ledger-head, .ledger-row { display: grid; grid-template-columns: 140px minmax(180px,1.1fr) minmax(220px,2fr) 120px minmax(140px,1fr) 72px 96px; gap: 24px; }
.ledger-head { padding: 0 8px 14px; font-family: var(--mono); font-size: 10px; letter-spacing: .22em; text-transform: uppercase; color: var(--ink-2); border-bottom: 1px solid var(--line); }
.ledger-row { padding: 18px 8px; border-bottom: 1px solid var(--line); align-items: center; transition: background-color .2s; cursor: default; animation: row-rise .5s ease both; }
.ledger-row:hover { background: var(--wine-ws); }
.cell-id   { font-family: var(--mono); font-size: 11.5px; color: var(--ink-2); letter-spacing: .04em; white-space: nowrap; }
.cell-repo { font-family: var(--mono); font-size: 13px; color: var(--ink-0); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cell-desc { font-family: var(--sans); font-size: 13.5px; color: var(--ink-1); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.cell-branch { font-family: var(--mono); font-size: 12px; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cell-branch::before { content: '⌥ '; color: var(--ink-3); }
.cell-pr { font-family: var(--mono); font-size: 13px; }
.cell-pr a { border: none; color: var(--wine); display: inline-flex; align-items: center; gap: 4px; transition: color .15s, transform .15s; font-weight: 500; }
.cell-pr a:hover { color: var(--wine-dk); transform: translateX(2px); }
.cell-age { font-family: var(--mono); font-size: 11.5px; color: var(--ink-3); text-align: right; font-feature-settings: 'tnum'; }
.status { display: inline-flex; align-items: center; gap: 7px; padding: 4px 10px 4px 8px; border-radius: 999px; font-family: var(--mono); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; white-space: nowrap; width: fit-content; border: 1px solid var(--line); color: var(--ink-2); background: var(--vellum); }
.status .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ink-3); flex-shrink: 0; }
.status[data-s='running']   { color: var(--wine-dk); background: var(--wine-ws); border-color: var(--wine-lt); }
.status[data-s='running'] .dot { background: var(--wine); animation: blink 1.2s infinite; }
.status[data-s='pending']   { color: var(--info); background: var(--info-bg); border-color: rgba(40,88,126,.2); }
.status[data-s='pending'] .dot { background: var(--info); }
.status[data-s='completed'] { color: var(--ok); background: var(--ok-bg); border-color: rgba(58,104,54,.2); }
.status[data-s='completed'] .dot { background: var(--ok); }
.status[data-s='failed']    { color: var(--err); background: var(--err-bg); border-color: rgba(138,31,31,.2); }
.status[data-s='failed'] .dot { background: var(--err); }
@keyframes blink { 0%,100%{ opacity:1 } 50%{ opacity:.3 } }
.error-row { margin-top: -8px; padding: 10px 14px; background: var(--err-bg); border-left: 2px solid var(--err); font-family: var(--mono); font-size: 12px; color: var(--err); white-space: pre-wrap; word-break: break-word; }
.error-cell { display: block; }
.empty { padding: 80px 24px; text-align: center; font-family: var(--serif); font-style: italic; font-size: 24px; color: var(--ink-3); border-bottom: 1px solid var(--line); }
.empty .hint { display: block; margin-top: 16px; font-family: var(--mono); font-style: normal; font-size: 11px; letter-spacing: .16em; text-transform: uppercase; color: var(--ink-4); }
.foot { display: grid; grid-template-columns: 1fr 1fr; gap: 56px; animation: rise .9s cubic-bezier(.2,.8,.2,1) .35s both; }
@media (max-width: 1100px) { .foot { grid-template-columns: 1fr; gap: 48px; } }
.env-list { list-style: none; margin: 0; padding: 0; }
.env-row { display: grid; grid-template-columns: 14px 1fr auto; gap: 14px; align-items: center; padding: 14px 0; border-bottom: 1px solid var(--line); font-family: var(--mono); font-size: 13px; }
.env-row:last-child { border-bottom: none; }
.env-row .mark { width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; }
.env-row.ok  .mark { color: var(--ok); }
.env-row.bad .mark { color: var(--err); }
.env-row .key    { color: var(--ink-0); letter-spacing: .02em; }
.env-row .detail { color: var(--ink-3); font-size: 11.5px; text-align: right; }
.activity { border: 1px solid var(--line); background: var(--paper); height: 320px; overflow: hidden; position: relative; border-radius: 2px; }
.activity::before { content: ''; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(180deg, var(--paper) 0%, transparent 9%, transparent 91%, var(--paper) 100%); z-index: 2; }
.activity-inner { padding: 18px 20px; height: 100%; overflow-y: auto; font-family: var(--mono); font-size: 12px; line-height: 1.65; }
.activity-line { display: grid; grid-template-columns: 64px 1fr; gap: 14px; padding: 3px 0; color: var(--ink-1); }
.activity-line .ts { color: var(--ink-3); font-feature-settings: 'tnum'; }
.activity-line .msg .id   { color: var(--wine); font-weight: 500; }
.activity-line .msg .verb { color: var(--ink-0); }
.activity-line .msg .verb.bad { color: var(--err); }
.activity-line .msg .verb.ok  { color: var(--ok); }
.foot-meta { margin-top: 80px; padding-top: 28px; border-top: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; font-family: var(--mono); font-size: 10.5px; letter-spacing: .2em; text-transform: uppercase; color: var(--ink-3); }
.foot-meta .caret { color: var(--wine); animation: blink 1s steps(2) infinite; }
.loader { font-family: var(--serif); font-style: italic; font-size: 24px; color: var(--ink-3); text-align: center; padding: 120px 0; }
.loader::after { content: ''; display: inline-block; width: 8px; height: 8px; background: var(--wine); margin-left: 12px; animation: blink 1s steps(2) infinite; }
.fail { margin: 24px 0; padding: 18px 22px; border: 1px solid rgba(138,31,31,.2); background: var(--err-bg); color: var(--err); font-family: var(--mono); font-size: 12px; }
@keyframes rise     { from{ opacity:0; transform:translateY(8px) } to{ opacity:1; transform:translateY(0) } }
@keyframes row-rise { from{ opacity:0; transform:translateY(4px) } to{ opacity:1; transform:translateY(0) } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration:.01ms!important; transition-duration:.01ms!important; } }
`

function shortId(id: string): string {
  return id.length <= 12 ? id : id.slice(0, 6) + '…' + id.slice(-4)
}
function relativeAge(tsMs: number): string {
  const s = Math.max(0, Math.round((Date.now() - tsMs) / 1000))
  if (s < 5)   return 'just now'
  if (s < 60)  return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60)  return `${m}m ago`
  const hr = Math.floor(m / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.floor(hr / 24)
  return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`
}
function formatClock(isoNow: string): string {
  const d = new Date(isoNow)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}
function formatDuration(sec: number | null): string {
  if (sec == null) return '—'
  if (sec < 60)   return `${Math.round(sec)}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}
function formatPct(n: number | null): string { return n == null ? '—' : `${Math.round(n * 100)}` }
function prShortRef(url: string | null): string {
  if (!url) return ''
  const m = url.match(/\/pull\/(\d+)/)
  return m ? `#${m[1]!}` : '↗'
}
function tsToTime(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

function Masthead({ data }: { data: DashboardData }) {
  const allOk = data.env.every((e) => e.ok)
  return (
    <header class="masthead">
      <div>
        <h1 class="wordmark">Kalos</h1>
        <div class="subtitle">
          <span class="greek">καλός</span>
          <span class="sep" aria-hidden="true">/</span>
          <span>orchestrator</span>
          <span class="sep" aria-hidden="true">/</span>
          <span>{data.provider}</span>
        </div>
      </div>
      <div class="meta">
        <div class="meta-row">
          <span class={`pulse ${allOk ? '' : 'warn'}`} aria-hidden="true" />
          <span>{allOk ? 'operational' : 'degraded'}</span>
        </div>
        <div class="meta-row">v{data.version}</div>
        <div class="meta-row">{formatClock(data.now)}</div>
      </div>
    </header>
  )
}

function Stats({ data }: { data: DashboardData }) {
  return (
    <Fragment>
      <div class="section-label">
        <span class="num" aria-hidden="true">01</span><span>Today</span>
        <span class="rule" aria-hidden="true" /><span class="extra">live · refreshes every 5s</span>
      </div>
      <section class="stats" aria-label="Statistics">
        <div class="stat">
          <div class="stat-label">Tasks · 24h</div>
          <div class="stat-value">{data.stats.tasksToday}</div>
          <div class="stat-foot"><span class="accent" aria-hidden="true">●</span> dispatched</div>
        </div>
        <div class="stat">
          <div class="stat-label">Success rate</div>
          <div class="stat-value">{formatPct(data.stats.successRate)}<span class="unit">%</span></div>
          <div class="stat-foot">last 100 tasks</div>
        </div>
        <div class="stat">
          <div class="stat-label">Avg duration</div>
          <div class="stat-value">{formatDuration(data.stats.avgDurationSec)}</div>
          <div class="stat-foot">clone → PR</div>
        </div>
        <div class="stat">
          <div class="stat-label">Active agents</div>
          <div class="stat-value">
            {data.stats.activeAgents}<span class="unit">/ {data.stats.activeAgents + data.stats.queueDepth} q</span>
          </div>
          <div class="stat-foot">containers in flight</div>
        </div>
      </section>
    </Fragment>
  )
}

function Ledger({ data }: { data: DashboardData }) {
  return (
    <section class="ledger" aria-label="Task Ledger">
      <div class="section-label">
        <span class="num" aria-hidden="true">02</span><span>Ledger</span>
        <span class="rule" aria-hidden="true" />
        <span class="extra">{data.tasks.length} task{data.tasks.length === 1 ? '' : 's'}</span>
      </div>
      {data.tasks.length === 0 ? (
        <div class="empty">
          The ledger is empty.
          <span class="hint">POST /tasks — to begin —</span>
        </div>
      ) : (
        <div role="table" aria-label="Tasks">
          <div role="rowgroup">
            <div class="ledger-head" role="row">
              <span role="columnheader">id</span>
              <span role="columnheader">repo</span>
              <span role="columnheader">description</span>
              <span role="columnheader">status</span>
              <span role="columnheader">branch</span>
              <span role="columnheader">pr</span>
              <span role="columnheader" style="text-align:right">age</span>
            </div>
          </div>
          <div role="rowgroup">
            {data.tasks.map((t) => (
              <Fragment key={t.id}>
                <div class="ledger-row" role="row">
                  <span class="cell-id" role="cell" title={t.id}>{shortId(t.id)}</span>
                  <span class="cell-repo" role="cell" title={t.repo}>{t.repo}</span>
                  <span class="cell-desc" role="cell" title={t.description}>{t.description}</span>
                  <span role="cell">
                    <span class="status" data-s={t.status}>
                      <span class="dot" aria-hidden="true" />{t.status}
                    </span>
                  </span>
                  <span class="cell-branch" role="cell" title={t.branch ?? ''}>{t.branch ?? '—'}</span>
                  <span class="cell-pr" role="cell">
                    {t.prUrl
                      ? <a href={t.prUrl} target="_blank" rel="noopener noreferrer" aria-label={`Pull request ${prShortRef(t.prUrl)}`}>{prShortRef(t.prUrl)}</a>
                      : <span style="color:var(--ink-3)" aria-label="no pull request">—</span>}
                  </span>
                  <span class="cell-age" role="cell">{relativeAge(t.createdAt)}</span>
                </div>
                {t.error && t.status === 'failed' && (
                  <div role="row" class="error-row">
                    <span role="cell" aria-colspan={7} class="error-cell">{t.error}</span>
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function Activity({ tasks }: { tasks: Task[] }) {
  const events = useMemo(() => {
    const out: { ts: string; verb: string; cls: '' | 'ok' | 'bad'; id: string; rest: string }[] = []
    for (const t of tasks.slice(0, 50)) {
      out.push({ ts: tsToTime(t.createdAt), verb: 'queued', cls: '', id: shortId(t.id), rest: t.repo })
      if (t.status === 'running')   out.push({ ts: '—', verb: 'running', cls: '', id: shortId(t.id), rest: t.branch ?? '' })
      if (t.status === 'completed') out.push({ ts: tsToTime(t.completedAt), verb: t.prUrl ? 'opened pr' : 'completed', cls: 'ok', id: shortId(t.id), rest: t.prUrl ? prShortRef(t.prUrl) : '' })
      if (t.status === 'failed')    out.push({ ts: tsToTime(t.completedAt), verb: 'failed', cls: 'bad', id: shortId(t.id), rest: '' })
    }
    return out.slice(0, 60)
  }, [tasks])
  return (
    <div>
      <div class="section-label">
        <span class="num" aria-hidden="true">04</span><span>Activity</span>
        <span class="rule" aria-hidden="true" /><span class="extra">tail</span>
      </div>
      <div class="activity" aria-label="Activity log">
        <div class="activity-inner">
          {events.length === 0
            ? <div style="color:var(--ink-3)">— silence —</div>
            : events.map((e, i) => (
              <div class="activity-line" key={i}>
                <span class="ts">{e.ts}</span>
                <span class="msg">
                  <span class="id">{e.id}</span>{' '}
                  <span class={`verb ${e.cls}`}>{e.verb}</span>{' '}
                  {e.rest}
                </span>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  )
}

function System({ env }: { env: EnvCheck[] }) {
  return (
    <div>
      <div class="section-label">
        <span class="num" aria-hidden="true">03</span><span>System</span>
        <span class="rule" aria-hidden="true" />
        <span class="extra">{env.filter((e) => e.ok).length} / {env.length} ok</span>
      </div>
      <ul class="env-list">
        {env.map((e) => (
          <li class={`env-row ${e.ok ? 'ok' : 'bad'}`} key={e.key}>
            <span class="mark" aria-label={e.ok ? 'pass' : 'fail'}>{e.ok ? '✓' : '✕'}</span>
            <span class="key">{e.key}</span>
            <span class="detail">{e.detail ?? (e.ok ? 'set' : 'missing')}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const REFRESH_MS = 5_000

function App() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const aborter = useRef<AbortController | null>(null)

  async function load() {
    aborter.current?.abort()
    aborter.current = new AbortController()
    try {
      const r = await fetch('/ui/data', { signal: aborter.current.signal, credentials: 'same-origin' })
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
      setData(await r.json() as DashboardData)
      setError(null)
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    load()
    const id = setInterval(load, REFRESH_MS)
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); aborter.current?.abort() }
  }, [])

  return (
    <Fragment>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main class="wrap">
        {!data && !error && <div class="loader" role="status">loading the ledger</div>}
        {error && <div class="fail" role="alert">failed to load · {error}<br />(retrying every {REFRESH_MS / 1000}s)</div>}
        {data && (
          <Fragment>
            <Masthead data={data} />
            <Stats data={data} />
            <Ledger data={data} />
            <section class="foot" aria-label="System and Activity">
              <System env={data.env} />
              <Activity tasks={data.tasks} />
            </section>
            <div class="foot-meta">
              <span>Kalos · self-hosted · open source</span>
              <span>ready<span class="caret" aria-hidden="true">▍</span></span>
            </div>
          </Fragment>
        )}
      </main>
    </Fragment>
  )
}

const root = document.getElementById('app')
if (root) render(<App />, root)
