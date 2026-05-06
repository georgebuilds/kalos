// Pure JS dashboard — served as <script type="module">, no build step.

const REFRESH_MS = 5_000

// ─── CSS ─────────────────────────────────────────────────────────────────────

const CSS = `
:root {
  --bg:      #050715;
  --paper:   #0a0f24;
  --vellum:  #131a36;
  --line:    rgba(239,231,215,.10);
  --line-hi: rgba(239,231,215,.22);
  --ink-0:   #efe7d7;
  --ink-1:   rgba(239,231,215,.85);
  --ink-2:   #8e8675;
  --ink-3:   #5a5448;
  --ink-4:   #3a3430;
  --wine:    #d4a24c;
  --wine-dk: #c49040;
  --wine-md: #e0b866;
  --wine-lt: rgba(212,162,76,.35);
  --wine-ws: rgba(212,162,76,.07);
  --ok:    #4a9c58; --ok-bg:   rgba(74,156,88,.14);
  --warn:  #c99a3a; --warn-bg: rgba(201,154,58,.14);
  --err:   #c0503a; --err-bg:  rgba(192,80,58,.14);
  --info:  #5888b8; --info-bg: rgba(88,136,184,.14);
  --serif: 'Fraunces', Georgia, serif;
  --sans:  'DM Sans', ui-sans-serif, sans-serif;
  --mono:  'JetBrains Mono', 'DM Mono', ui-monospace, 'SF Mono', Menlo, monospace;
}
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
html { color-scheme: dark; }
body {
  background: var(--bg);
  background-image:
    radial-gradient(ellipse 130% 55% at 50% 108%, #1a1714 0%, transparent 55%),
    radial-gradient(ellipse 70%  45% at 80% 18%,  rgba(64,80,160,.18) 0%, transparent 60%),
    radial-gradient(ellipse 60%  40% at 18% 28%,  rgba(140,100,180,.12) 0%, transparent 60%),
    radial-gradient(ellipse 140% 90% at 50% -20%, var(--vellum) 0%, var(--paper) 38%, var(--bg) 100%);
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
  position: fixed; inset: 0;
  pointer-events: none; z-index: 200;
  background-image:
    radial-gradient(circle at 50% 50%, rgba(255,255,255,.012) 1px, transparent 1.5px),
    radial-gradient(circle at 25% 75%, rgba(255,255,255,.012) 1px, transparent 1.5px);
  background-size: 3px 3px, 5px 5px;
  background-position: 0 0, 1px 2px;
  mix-blend-mode: screen; opacity: 0.5;
}
::-webkit-scrollbar { width:10px; height:10px; }
::-webkit-scrollbar-track { background: var(--bg); }
::-webkit-scrollbar-thumb { background: rgba(239,231,215,.18); border: 2px solid var(--bg); border-radius:5px; }
::-webkit-scrollbar-thumb:hover { background: rgba(239,231,215,.32); }
::selection { background: var(--wine); color: var(--bg); }
a { color: var(--wine); text-decoration: none; border-bottom: 1px solid var(--wine-lt); transition: border-color .2s, color .2s; }
a:hover { color: var(--wine-md); border-bottom-color: var(--wine-md); }
.wrap { max-width: 1480px; margin: 0 auto; padding: 56px 64px 96px; }
@media (max-width: 880px) { .wrap { padding: 32px 24px 64px; } }
.masthead { display: grid; grid-template-columns: 1fr auto; gap: 48px; align-items: end; padding-bottom: 36px; margin-bottom: 56px; border-bottom: 1px solid var(--line); position: relative; animation: rise .9s cubic-bezier(.2,.8,.2,1) .05s both; }
.masthead::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 1px; background: linear-gradient(90deg, var(--wine) 0%, var(--wine) 88px, transparent 88px); }
.wordmark { font-family: var(--serif); font-style: italic; font-weight: 400; font-size: clamp(64px,10vw,112px); line-height: .85; letter-spacing: -.03em; color: var(--wine); margin: 0; }
.subtitle { display: flex; align-items: center; gap: 14px; margin-top: 18px; font-family: var(--mono); font-size: 11px; letter-spacing: .18em; text-transform: uppercase; color: var(--ink-2); }
.subtitle .greek { font-family: var(--serif); font-style: italic; font-size: 16px; letter-spacing: 0; text-transform: none; color: var(--ink-1); }
.subtitle .sep { color: var(--line-hi); }
.meta { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; font-family: var(--mono); font-size: 12px; color: var(--ink-2); }
.meta-row { display: inline-flex; align-items: center; gap: 10px; }
.pulse { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); animation: pulse-ok 2.4s infinite cubic-bezier(.66,0,0,1); }
.pulse.bad  { background: var(--err);  animation-name: pulse-bad; }
.pulse.warn { background: var(--warn); animation-name: pulse-warn; }
@keyframes pulse-ok  { 0%,100%{ box-shadow:0 0 0 0 rgba(74,156,88,.5) }  70%{ box-shadow:0 0 0 8px rgba(74,156,88,0) } }
@keyframes pulse-bad { 0%,100%{ box-shadow:0 0 0 0 rgba(192,80,58,.5) }  70%{ box-shadow:0 0 0 8px rgba(192,80,58,0) } }
@keyframes pulse-warn{ 0%,100%{ box-shadow:0 0 0 0 rgba(201,154,58,.5) } 70%{ box-shadow:0 0 0 8px rgba(201,154,58,0) } }
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
.stat-value { font-family: var(--serif); font-style: italic; font-size: 56px; line-height: 1; letter-spacing: -.03em; color: var(--wine); font-feature-settings: 'tnum'; }
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
.cell-pr a:hover { color: var(--wine-md); transform: translateX(2px); }
.cell-age { font-family: var(--mono); font-size: 11.5px; color: var(--ink-3); text-align: right; font-feature-settings: 'tnum'; }
.status { display: inline-flex; align-items: center; gap: 7px; padding: 4px 10px 4px 8px; border-radius: 999px; font-family: var(--mono); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; white-space: nowrap; width: fit-content; border: 1px solid var(--line); color: var(--ink-2); background: var(--vellum); }
.status .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ink-3); flex-shrink: 0; }
.status[data-s='running']   { color: var(--wine-md); background: var(--wine-ws); border-color: var(--wine-lt); }
.status[data-s='running'] .dot { background: var(--wine); animation: blink 1.2s infinite; }
.status[data-s='pending']   { color: var(--info); background: var(--info-bg); border-color: rgba(88,136,184,.25); }
.status[data-s='pending'] .dot { background: var(--info); }
.status[data-s='completed'] { color: var(--ok); background: var(--ok-bg); border-color: rgba(74,156,88,.25); }
.status[data-s='completed'] .dot { background: var(--ok); }
.status[data-s='failed']    { color: var(--err); background: var(--err-bg); border-color: rgba(192,80,58,.25); }
.status[data-s='failed'] .dot { background: var(--err); }
@keyframes blink { 0%,100%{ opacity:1 } 50%{ opacity:.3 } }
.error-row { margin-top: -8px; padding: 10px 14px; background: var(--err-bg); border-left: 2px solid var(--err); font-family: var(--mono); font-size: 12px; color: var(--err); white-space: pre-wrap; word-break: break-word; }
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
.activity-line .ts   { color: var(--ink-3); font-feature-settings: 'tnum'; }
.activity-line .id   { color: var(--wine); font-weight: 500; }
.activity-line .verb { color: var(--ink-0); }
.activity-line .verb.bad { color: var(--err); }
.activity-line .verb.ok  { color: var(--ok); }
.foot-meta { margin-top: 80px; padding-top: 28px; border-top: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; font-family: var(--mono); font-size: 10.5px; letter-spacing: .2em; text-transform: uppercase; color: var(--ink-3); }
.foot-meta .caret { color: var(--wine); animation: blink 1s steps(2) infinite; }
.loader { font-family: var(--serif); font-style: italic; font-size: 24px; color: var(--ink-3); text-align: center; padding: 120px 0; }
.loader::after { content: ''; display: inline-block; width: 8px; height: 8px; background: var(--wine); margin-left: 12px; animation: blink 1s steps(2) infinite; }
.fail { padding: 18px 22px; border: 1px solid rgba(192,80,58,.2); background: var(--err-bg); color: var(--err); font-family: var(--mono); font-size: 12px; }
@keyframes rise     { from{ opacity:0; transform:translateY(8px) } to{ opacity:1; transform:translateY(0) } }
@keyframes row-rise { from{ opacity:0; transform:translateY(4px) } to{ opacity:1; transform:translateY(0) } }
.bird-corner { position: fixed; bottom: 0; right: 40px; height: clamp(110px,14vh,152px); aspect-ratio: 220/240; pointer-events: none; z-index: 100; opacity: .52; filter: drop-shadow(0 8px 28px rgba(0,0,0,.7)); }
.bird-corner svg { width: 100%; height: 100%; overflow: visible; }
.bird-corner svg > * { transform-box: fill-box; transform-origin: center; }
.smoke { animation: smoke-drift 7s ease-in-out infinite alternate; transform-origin: 190px 132px; }
@keyframes smoke-drift { from { transform: translate(0,0); opacity: .55; } to { transform: translate(2px,-3px); opacity: .85; } }
.ember { animation: ember-pulse 2.6s ease-in-out infinite; }
@keyframes ember-pulse { 0%,100%{ opacity:.95; filter: drop-shadow(0 0 1.5px #ff7a3a) } 50%{ opacity:1; filter: drop-shadow(0 0 4px #ff8a3a) } }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration:.01ms!important; transition-duration:.01ms!important; }
  .smoke, .ember { animation: none !important; }
}
`

// ─── Bird ─────────────────────────────────────────────────────────────────────

const BIRD_SVG = `<svg viewBox="0 0 220 240" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" role="presentation">
  <ellipse cx="110" cy="234" rx="64" ry="3" fill="#1a1714" opacity="0.4"/>
  <path d="M 60 140 L 64 140 L 14 66 Z" fill="#3a3e44"/><path d="M 60 140 L 14 66 L 10 66 Z" fill="#5a6066"/>
  <path d="M 66 144 L 70 144 L 22 88 Z" fill="#3a3e44"/><path d="M 66 144 L 22 88 L 18 88 Z" fill="#5a6066"/>
  <path d="M 72 148 L 76 148 L 32 110 Z" fill="#3a3e44"/><path d="M 72 148 L 32 110 L 28 110 Z" fill="#5a6066"/>
  <path d="M 30 232 L 38 156 L 60 130 L 92 120 L 96 140 L 96 232 Z" fill="#5a6b50"/>
  <path d="M 190 232 L 182 156 L 160 130 L 128 120 L 124 140 L 124 232 Z" fill="#5a6b50"/>
  <path d="M 38 156 L 60 130 L 92 120 L 84 160 L 50 188 Z" fill="#3a4030"/>
  <path d="M 50 188 L 84 160 L 80 198 L 56 210 Z" fill="#4a5440"/>
  <path d="M 60 130 L 80 138 L 84 160 L 64 158 Z" fill="#4a5440"/>
  <path d="M 182 156 L 160 130 L 128 120 L 136 160 L 170 188 Z" fill="#3a4030"/>
  <path d="M 170 188 L 136 160 L 140 198 L 164 210 Z" fill="#4a5440"/>
  <path d="M 160 130 L 140 138 L 136 160 L 156 158 Z" fill="#4a5440"/>
  <path d="M 52 168 L 64 162 L 68 178 L 56 188 Z" fill="#7a8868"/>
  <path d="M 76 200 L 88 196 L 90 218 L 78 222 Z" fill="#3a4030"/>
  <path d="M 42 210 L 54 204 L 58 222 L 46 228 Z" fill="#7a8868"/>
  <path d="M 70 144 L 80 142 L 82 154 L 72 156 Z" fill="#3a4030"/>
  <path d="M 60 184 L 70 178 L 72 192 L 62 196 Z" fill="#5a6b50"/>
  <path d="M 90 168 L 88 158 L 92 156 L 94 168 Z" fill="#3a4030"/>
  <path d="M 88 220 L 92 204 L 96 220 L 92 230 Z" fill="#4a5440"/>
  <path d="M 168 168 L 156 162 L 152 178 L 164 188 Z" fill="#7a8868"/>
  <path d="M 144 200 L 132 196 L 130 218 L 142 222 Z" fill="#3a4030"/>
  <path d="M 178 210 L 166 204 L 162 222 L 174 228 Z" fill="#7a8868"/>
  <path d="M 150 144 L 140 142 L 138 154 L 148 156 Z" fill="#3a4030"/>
  <path d="M 160 184 L 150 178 L 148 192 L 158 196 Z" fill="#5a6b50"/>
  <path d="M 130 168 L 132 158 L 128 156 L 126 168 Z" fill="#3a4030"/>
  <path d="M 132 220 L 128 204 L 124 220 L 128 230 Z" fill="#4a5440"/>
  <path d="M 56 196 L 76 196 L 76 210 L 56 210 Z" fill="#3a4030" opacity="0.55"/>
  <path d="M 144 196 L 164 196 L 164 210 L 144 210 Z" fill="#3a4030" opacity="0.55"/>
  <path d="M 96 140 L 110 156 L 124 140 L 124 168 L 96 168 Z" fill="#4a5440"/>
  <path d="M 96 168 L 124 168 L 124 232 L 96 232 Z" fill="#2a2d30"/>
  <path d="M 96 168 L 100 168 L 100 230 L 96 232 Z" fill="#6a7858"/>
  <path d="M 120 168 L 124 168 L 124 232 L 120 230 Z" fill="#6a7858"/>
  <path d="M 102 178 L 110 182 L 104 192 Z" fill="#3a3e44"/>
  <path d="M 118 178 L 110 182 L 116 192 Z" fill="#3a3e44"/>
  <path d="M 102 200 L 118 200 L 110 215 Z" fill="#3a3e44" opacity="0.65"/>
  <path d="M 104 218 L 116 218 L 114 228 L 106 228 Z" fill="#3a3e44" opacity="0.5"/>
  <path d="M 84 120 L 136 120 L 138 132 L 82 132 Z" fill="#6e1c14"/>
  <path d="M 96 122 L 100 116 L 120 116 L 124 122 Z" fill="#3a3e44"/>
  <path d="M 86 130 L 134 130 L 140 154 L 110 168 L 80 154 Z" fill="#9c2e22"/>
  <path d="M 86 130 L 110 138 L 134 130 L 130 142 L 110 145 L 90 142 Z" fill="#c44a3a"/>
  <path d="M 92 144 L 128 144 L 124 158 L 110 164 L 96 158 Z" fill="#6e1c14"/>
  <path d="M 96 146 L 124 146 L 122 154 L 110 158 L 98 154 Z" fill="#9c2e22"/>
  <path d="M 90 158 L 130 158 L 124 168 L 110 168 L 96 168 Z" fill="#7e2418"/>
  <path d="M 76 130 L 86 124 L 92 138 L 84 146 Z" fill="#c44a3a"/>
  <path d="M 76 130 L 84 146 L 80 152 L 70 142 Z" fill="#9c2e22"/>
  <path d="M 70 142 L 64 156 L 70 162 L 78 152 Z" fill="#9c2e22"/>
  <path d="M 70 142 L 64 156 L 68 152 L 70 148 Z" fill="#6e1c14"/>
  <path d="M 80 130 L 86 128 L 88 138 L 82 138 Z" fill="#c44a3a"/>
  <path d="M 100 168 L 105 184 L 110 188" fill="none" stroke="#9a9a92" stroke-width="0.7" stroke-linecap="round" opacity="0.9"/>
  <path d="M 120 168 L 115 184 L 110 188" fill="none" stroke="#9a9a92" stroke-width="0.7" stroke-linecap="round" opacity="0.9"/>
  <path d="M 99 192 L 106 192 L 106 208 L 99 208 Z" fill="#7e7e76" opacity="0.9"/>
  <path d="M 99 192 L 106 192 L 105 194 L 100 194 Z" fill="#9a9a92" opacity="0.9"/>
  <line x1="101" y1="198" x2="104" y2="198" stroke="#3a3a36" stroke-width="0.4" opacity="0.6"/>
  <line x1="101" y1="201" x2="104" y2="201" stroke="#3a3a36" stroke-width="0.4" opacity="0.6"/>
  <path d="M 104 188 L 116 188 L 116 204 L 104 204 Z" fill="#9a9a92"/>
  <path d="M 104 188 L 116 188 L 115 190 L 105 190 Z" fill="#c0c0b8"/>
  <path d="M 104 188 L 104 204 L 106 202 L 106 190 Z" fill="#b0b0a8"/>
  <path d="M 116 188 L 116 204 L 114 202 L 114 190 Z" fill="#6e6e66"/>
  <path d="M 104 204 L 116 204 L 114 202 L 106 202 Z" fill="#6e6e66"/>
  <circle cx="110" cy="190.4" r="0.7" fill="#1a1a18"/>
  <line x1="107" y1="194" x2="113" y2="194" stroke="#3a3a36" stroke-width="0.45"/>
  <line x1="107" y1="197" x2="113" y2="197" stroke="#3a3a36" stroke-width="0.45"/>
  <line x1="107" y1="200" x2="111" y2="200" stroke="#3a3a36" stroke-width="0.45"/>
  <path d="M 56 92 L 60 58 L 70 36 L 86 22 L 112 22 L 128 28 L 138 42 L 142 64 L 140 80 L 134 94 L 128 108 L 118 120 L 96 124 L 72 120 L 60 106 Z" fill="#5a6066"/>
  <path d="M 70 36 L 86 22 L 112 22 L 128 28 L 124 38 L 102 32 L 80 42 Z" fill="#828890"/>
  <path d="M 84 30 L 96 22 L 112 24 L 120 32 L 110 32 L 96 34 Z" fill="#a0a6ad"/>
  <path d="M 56 92 L 60 58 L 66 70 L 64 92 Z" fill="#3a3e44"/>
  <path d="M 64 80 L 76 74 L 82 92 L 70 96 Z" fill="#828890"/>
  <path d="M 60 106 L 72 120 L 88 120 L 84 108 L 74 100 Z" fill="#3a3e44"/>
  <path d="M 84 108 L 96 124 L 116 122 L 122 110 L 104 106 Z" fill="#25282c"/>
  <path d="M 128 28 L 138 42 L 142 64 L 134 56 L 132 40 Z" fill="#3a3e44"/>
  <path d="M 134 56 L 142 64 L 140 80 L 132 76 Z" fill="#25282c"/>
  <path d="M 134 94 L 140 80 L 132 86 L 130 96 Z" fill="#3a3e44"/>
  <path d="M 70 92 L 78 94 L 74 104 Z" fill="#5a6066"/>
  <path d="M 84 102 L 92 104 L 88 114 Z" fill="#3a3e44"/>
  <path d="M 100 96 L 110 98 L 104 108 Z" fill="#3a3e44"/>
  <path d="M 70 56 L 88 50 L 92 60 L 80 62 Z" fill="#3a3e44"/>
  <path d="M 68 90 L 70 100" stroke="#1c1f22" stroke-width="0.6" stroke-linecap="round" fill="none" opacity="0.75"/>
  <path d="M 74 92 L 76 104" stroke="#1c1f22" stroke-width="0.6" stroke-linecap="round" fill="none" opacity="0.75"/>
  <path d="M 80 96 L 82 108" stroke="#1c1f22" stroke-width="0.6" stroke-linecap="round" fill="none" opacity="0.7"/>
  <path d="M 86 98 L 88 110" stroke="#1c1f22" stroke-width="0.6" stroke-linecap="round" fill="none" opacity="0.7"/>
  <path d="M 96 100 L 98 112" stroke="#1c1f22" stroke-width="0.5" stroke-linecap="round" fill="none" opacity="0.6"/>
  <path d="M 86 116 L 88 122" stroke="#1c1f22" stroke-width="0.5" stroke-linecap="round" fill="none" opacity="0.55"/>
  <path d="M 94 118 L 96 124" stroke="#1c1f22" stroke-width="0.5" stroke-linecap="round" fill="none" opacity="0.55"/>
  <path d="M 102 118 L 104 124" stroke="#1c1f22" stroke-width="0.5" stroke-linecap="round" fill="none" opacity="0.55"/>
  <path d="M 110 118 L 112 124" stroke="#1c1f22" stroke-width="0.5" stroke-linecap="round" fill="none" opacity="0.55"/>
  <path d="M 78 42 L 80 50" stroke="#1c1f22" stroke-width="0.4" stroke-linecap="round" fill="none" opacity="0.55"/>
  <path d="M 90 32 L 92 42" stroke="#1c1f22" stroke-width="0.4" stroke-linecap="round" fill="none" opacity="0.55"/>
  <path d="M 104 30 L 106 42" stroke="#1c1f22" stroke-width="0.4" stroke-linecap="round" fill="none" opacity="0.55"/>
  <path d="M 116 36 L 118 46" stroke="#1c1f22" stroke-width="0.4" stroke-linecap="round" fill="none" opacity="0.55"/>
  <path d="M 56 92 L 52 96 L 56 100 Z" fill="#3a3e44"/>
  <path d="M 60 106 L 56 110 L 62 112 Z" fill="#3a3e44"/>
  <path d="M 60 58 L 64 36 L 70 56 Z" fill="#3a3e44"/>
  <path d="M 68 40 L 76 18 L 84 40 Z" fill="#5a6066"/>
  <path d="M 76 18 L 78 28 L 74 30 Z" fill="#828890"/>
  <path d="M 82 26 L 92 6 L 100 26 Z" fill="#828890"/>
  <path d="M 92 6 L 94 18 L 90 20 Z" fill="#a0a6ad"/>
  <path d="M 100 22 L 110 8 L 118 24 Z" fill="#5a6066"/>
  <path d="M 110 8 L 112 18 L 108 20 Z" fill="#828890"/>
  <path d="M 118 30 L 126 18 L 130 34 Z" fill="#3a3e44"/>
  <path d="M 126 18 L 128 26 L 124 28 Z" fill="#5a6066"/>
  <path d="M 72 66 L 92 58 L 108 68 L 100 74 L 82 76 Z" fill="#1c1f22"/>
  <path d="M 76 72 L 96 68 L 102 82 L 88 86 L 76 80 Z" fill="#0d0f12"/>
  <ellipse cx="90" cy="77" rx="4.8" ry="4.8" fill="#b88e58"/>
  <ellipse cx="90" cy="77" rx="3.2" ry="3.8" fill="#3a2810"/>
  <ellipse cx="90" cy="77" rx="1.7" ry="2.4" fill="#060403"/>
  <circle cx="91.4" cy="75.6" r="0.9" fill="#efe7d7"/>
  <path d="M 86 38 L 90 46 L 94 38 L 92 48 L 90 52 L 88 48 Z" fill="#9c2e22"/>
  <path d="M 88 40 L 90 48 L 92 40 Z" fill="#c44a3a"/>
  <path d="M 116 70 L 132 70 L 138 82 L 130 88 L 118 82 Z" fill="#3e3e38"/>
  <path d="M 118 82 L 138 82 L 168 110 L 162 116 L 134 102 L 118 92 Z" fill="#5e5e58"/>
  <path d="M 118 82 L 138 82 L 158 100 L 138 90 L 124 88 Z" fill="#8a8a82"/>
  <path d="M 134 102 L 162 116 L 156 118 L 134 108 Z" fill="#3a3a36"/>
  <path d="M 158 110 L 168 110 L 174 120 L 168 124 L 158 118 Z" fill="#3e3e38"/>
  <path d="M 158 110 L 168 110 L 166 114 L 160 113 Z" fill="#6a6a64"/>
  <path d="M 158 118 L 174 120 L 168 124 L 158 122 Z" fill="#1c1c18"/>
  <path d="M 122 100 L 152 110 L 156 116 L 148 120 L 128 114 L 120 108 Z" fill="#2a2a26"/>
  <path d="M 152 110 L 156 116 L 152 116 L 150 112 Z" fill="#4a4a44"/>
  <path d="M 122 96 L 158 108" stroke="#0a0a08" stroke-width="0.9" stroke-linecap="round"/>
  <ellipse cx="128" cy="86" rx="1.4" ry="0.9" fill="#0a0a08" transform="rotate(20 128 86)"/>
  <line x1="156" y1="116" x2="164" y2="120" stroke="#c9a880" stroke-width="3" stroke-linecap="round"/>
  <line x1="162" y1="119" x2="190" y2="132" stroke="#efe7d7" stroke-width="3" stroke-linecap="round"/>
  <line x1="182" y1="128.5" x2="188" y2="131.5" stroke="#a89e8a" stroke-width="2.6" stroke-linecap="round" opacity="0.7"/>
  <g class="ember">
    <circle cx="190" cy="132" r="2.3" fill="#c97443"/>
    <circle cx="190" cy="132" r="1" fill="#efe7d7" opacity="0.75"/>
    <circle cx="190.6" cy="131.5" r="0.4" fill="#fff4d0"/>
  </g>
  <g class="smoke">
    <path d="M 190 129 Q 200 114 196 96 Q 188 78 200 64 Q 210 50 204 32" fill="none" stroke="#a89e8a" stroke-width="1.6" stroke-linecap="round" opacity="0.5"/>
    <path d="M 192 124 Q 196 116 194 106" fill="none" stroke="#a89e8a" stroke-width="0.8" stroke-linecap="round" opacity="0.32"/>
    <path d="M 198 96 Q 206 88 202 76" fill="none" stroke="#a89e8a" stroke-width="0.6" stroke-linecap="round" opacity="0.25"/>
    <path d="M 204 66 Q 210 56 206 46" fill="none" stroke="#a89e8a" stroke-width="0.5" stroke-linecap="round" opacity="0.22"/>
  </g>
  <path d="M 96 224 L 124 224 L 122 232 L 98 232 Z" fill="#3a4030" opacity="0.5"/>
</svg>`

// ─── DOM helpers ─────────────────────────────────────────────────────────────

/**
 * Minimal element factory. Attrs are set as attributes (use 'class', not 'className').
 * Children may be strings, Nodes, or nested arrays — all are flattened.
 */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (k === 'class') el.className = v
    else               el.setAttribute(k, v)
  }
  for (const child of children.flat(Infinity)) {
    if (child == null) continue
    el.append(child instanceof Node ? child : String(child))
  }
  return el
}

/** Returns a live text node. Update its content with node.data = newValue. */
const txt = (s) => document.createTextNode(String(s))

// ─── Formatters ──────────────────────────────────────────────────────────────

function shortId(id) {
  return id.length <= 12 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`
}

function relativeAge(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s <   5) return 'just now'
  if (s <  60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m <  60) return `${m}m ago`
  const hr = Math.floor(m / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.floor(hr / 24)
  return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`
}

function formatClock(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
         ' · ' +
         d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatDuration(sec) {
  if (sec == null) return '—'
  if (sec < 60)    return `${Math.round(sec)}s`
  if (sec < 3600)  return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}

const formatPct  = (n)   => n == null ? '—' : String(Math.round(n * 100))
const prShortRef = (url) => { const m = url?.match(/\/pull\/(\d+)/); return m ? `#${m[1]}` : (url ? '↗' : '') }

function tsToTime(ms) {
  return ms
    ? new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    : '—'
}

// ─── State ───────────────────────────────────────────────────────────────────

let booted = false
// id → { el, errorEl, ageNode, statusBadge, statusLabel, branchEl, prEl,
//         lastStatus, lastBranch, lastPrUrl }
const taskRows = new Map()

// Mutable DOM node references touched on every update cycle
const r = {}

// ─── Shared builders ─────────────────────────────────────────────────────────

function sectionLabel(num, title, extra) {
  return h('div', { class: 'section-label' },
    h('span', { class: 'num', 'aria-hidden': 'true' }, num),
    title,
    h('span', { class: 'rule', 'aria-hidden': 'true' }),
    extra,
  )
}

// ─── Builders ────────────────────────────────────────────────────────────────

function buildMasthead(data) {
  r.pulse      = h('span', { class: 'pulse', 'aria-hidden': 'true' })
  r.statusText = txt('operational')
  r.clock      = txt(formatClock(data.now))

  return h('header', { class: 'masthead' },
    h('div', {},
      h('h1', { class: 'wordmark' }, 'Kalos'),
      h('div', { class: 'subtitle' },
        h('span', { class: 'greek' }, 'καλός'),
        h('span', { class: 'sep', 'aria-hidden': 'true' }, '/'),
        'orchestrator',
        h('span', { class: 'sep', 'aria-hidden': 'true' }, '/'),
        data.defaultModel?.label ?? 'claude code',
      ),
    ),
    h('div', { class: 'meta' },
      h('div', { class: 'meta-row' }, r.pulse, r.statusText),
      h('div', { class: 'meta-row' }, `v${data.version}`),
      h('div', { class: 'meta-row' }, r.clock),
    ),
  )
}

function buildStats(data) {
  const { tasksToday, successRate, avgDurationSec, activeAgents, queueDepth } = data.stats
  r.tasksToday   = txt(tasksToday)
  r.successRate  = txt(formatPct(successRate))
  r.avgDuration  = txt(formatDuration(avgDurationSec))
  r.activeAgents = txt(activeAgents)
  r.queueUnit    = txt(`/ ${activeAgents + queueDepth} q`)

  return h('section', { class: 'stats', 'aria-label': 'Statistics' },
    h('div', { class: 'stat' },
      h('div', { class: 'stat-label' }, 'Tasks · 24h'),
      h('div', { class: 'stat-value' }, r.tasksToday),
      h('div', { class: 'stat-foot' }, h('span', { class: 'accent', 'aria-hidden': 'true' }, '●'), ' dispatched'),
    ),
    h('div', { class: 'stat' },
      h('div', { class: 'stat-label' }, 'Success rate'),
      h('div', { class: 'stat-value' }, r.successRate, h('span', { class: 'unit' }, '%')),
      h('div', { class: 'stat-foot' }, 'last 100 tasks'),
    ),
    h('div', { class: 'stat' },
      h('div', { class: 'stat-label' }, 'Avg duration'),
      h('div', { class: 'stat-value' }, r.avgDuration),
      h('div', { class: 'stat-foot' }, 'clone → PR'),
    ),
    h('div', { class: 'stat' },
      h('div', { class: 'stat-label' }, 'Active agents'),
      h('div', { class: 'stat-value' }, r.activeAgents, h('span', { class: 'unit' }, r.queueUnit)),
      h('div', { class: 'stat-foot' }, 'containers in flight'),
    ),
  )
}

function buildLedger(tasks) {
  r.taskCount  = txt(`${tasks.length} task${tasks.length === 1 ? '' : 's'}`)
  r.emptyState = h('div', { class: 'empty' },
    'The ledger is empty.',
    h('span', { class: 'hint' }, 'POST /tasks — to begin —'),
  )
  r.tbody = h('div', { role: 'rowgroup' })

  for (const task of tasks) {
    const entry = buildTaskRow(task)
    taskRows.set(task.id, entry)
    r.tbody.append(entry.el)
    if (entry.errorEl) r.tbody.append(entry.errorEl)
  }

  r.tableWrap = h('div', { role: 'table', 'aria-label': 'Tasks' },
    h('div', { role: 'rowgroup' },
      h('div', { class: 'ledger-head', role: 'row' },
        h('span', { role: 'columnheader' }, 'id'),
        h('span', { role: 'columnheader' }, 'repo'),
        h('span', { role: 'columnheader' }, 'description'),
        h('span', { role: 'columnheader' }, 'status'),
        h('span', { role: 'columnheader' }, 'branch'),
        h('span', { role: 'columnheader' }, 'pr'),
        h('span', { role: 'columnheader', style: 'text-align:right' }, 'age'),
      ),
    ),
    r.tbody,
  )

  r.emptyState.hidden = tasks.length > 0
  r.tableWrap.hidden  = tasks.length === 0

  return h('section', { class: 'ledger', 'aria-label': 'Task Ledger' },
    sectionLabel('02', 'Ledger', r.taskCount),
    r.emptyState,
    r.tableWrap,
  )
}

function buildTaskRow(task) {
  const ageNode     = txt(relativeAge(task.createdAt))
  const statusDot   = h('span', { class: 'dot', 'aria-hidden': 'true' })
  const statusLabel = txt(task.status)
  const statusBadge = h('span', { class: 'status', 'data-s': task.status }, statusDot, statusLabel)
  const branchEl    = h('span', { class: 'cell-branch', role: 'cell', title: task.branch ?? '' }, task.branch ?? '—')
  const prEl        = buildPrCell(task.prUrl)
  const errorEl     = (task.error && task.status === 'failed') ? buildErrorRow(task.error) : null

  const el = h('div', { class: 'ledger-row', role: 'row' },
    h('span', { class: 'cell-id',   role: 'cell', title: task.id          }, shortId(task.id)),
    h('span', { class: 'cell-repo', role: 'cell', title: task.repo        }, task.repo),
    h('span', { class: 'cell-desc', role: 'cell', title: task.description }, task.description),
    h('span', { role: 'cell' }, statusBadge),
    branchEl,
    prEl,
    h('span', { class: 'cell-age', role: 'cell' }, ageNode),
  )

  return {
    el, errorEl, ageNode, statusBadge, statusDot, statusLabel, branchEl, prEl,
    lastStatus: task.status, lastBranch: task.branch, lastPrUrl: task.prUrl,
  }
}

function buildPrCell(prUrl) {
  const cell = h('span', { class: 'cell-pr', role: 'cell' })
  cell.append(
    prUrl
      ? h('a', { href: prUrl, target: '_blank', rel: 'noopener noreferrer',
                 'aria-label': `Pull request ${prShortRef(prUrl)}` }, prShortRef(prUrl))
      : h('span', { style: 'color:var(--ink-3)', 'aria-label': 'no pull request' }, '—'),
  )
  return cell
}

const buildErrorRow = (error) =>
  h('div', { class: 'error-row', role: 'row' },
    h('span', { role: 'cell', 'aria-colspan': '7' }, error),
  )

function buildSystem(env) {
  return h('div', {},
    sectionLabel('03', 'System',
      h('span', { class: 'extra' }, `${env.filter(e => e.ok).length} / ${env.length} ok`),
    ),
    h('ul', { class: 'env-list' },
      ...env.map(e =>
        h('li', { class: `env-row ${e.ok ? 'ok' : 'bad'}` },
          h('span', { class: 'mark', 'aria-label': e.ok ? 'pass' : 'fail' }, e.ok ? '✓' : '✕'),
          h('span', { class: 'key' }, e.key),
          h('span', { class: 'detail' }, e.detail ?? (e.ok ? 'set' : 'missing')),
        ),
      ),
    ),
  )
}

function buildActivity(tasks) {
  r.activityInner = h('div', { class: 'activity-inner' })
  fillActivity(tasks)
  return h('div', {},
    sectionLabel('04', 'Activity', h('span', { class: 'extra' }, 'tail')),
    h('div', { class: 'activity', 'aria-label': 'Activity log' }, r.activityInner),
  )
}

function fillActivity(tasks) {
  const events = []
  for (const t of tasks.slice(0, 50)) {
    events.push({ ts: tsToTime(t.createdAt), verb: 'queued',    cls: '',    id: shortId(t.id), rest: t.repo })
    if (t.status === 'running')
      events.push({ ts: '—',                    verb: 'running',   cls: '',    id: shortId(t.id), rest: t.branch ?? '' })
    if (t.status === 'completed')
      events.push({ ts: tsToTime(t.completedAt), verb: t.prUrl ? 'opened pr' : 'completed', cls: 'ok',  id: shortId(t.id), rest: prShortRef(t.prUrl) })
    if (t.status === 'failed')
      events.push({ ts: tsToTime(t.completedAt), verb: 'failed',   cls: 'bad', id: shortId(t.id), rest: '' })
  }

  const frag = document.createDocumentFragment()
  if (events.length === 0) {
    frag.append(h('div', { style: 'color:var(--ink-3)' }, '— silence —'))
  } else {
    for (const e of events.slice(0, 60)) {
      frag.append(h('div', { class: 'activity-line' },
        h('span', { class: 'ts' }, e.ts),
        h('span', {},
          h('span', { class: 'id' }, e.id), ' ',
          h('span', { class: `verb${e.cls ? ' ' + e.cls : ''}` }, e.verb),
          e.rest ? ` ${e.rest}` : '',
        ),
      ))
    }
  }
  r.activityInner.replaceChildren(frag)
}

// ─── Patchers ────────────────────────────────────────────────────────────────

function patchMasthead(data) {
  const allOk    = data.env.every(e => e.ok)
  r.pulse.className = `pulse${allOk ? '' : ' warn'}`
  r.statusText.data = allOk ? 'operational' : 'degraded'
  r.clock.data      = formatClock(data.now)
}

function patchStats({ tasksToday, successRate, avgDurationSec, activeAgents, queueDepth }) {
  r.tasksToday.data   = tasksToday
  r.successRate.data  = formatPct(successRate)
  r.avgDuration.data  = formatDuration(avgDurationSec)
  r.activeAgents.data = activeAgents
  r.queueUnit.data    = `/ ${activeAgents + queueDepth} q`
}

function patchLedger(tasks) {
  r.taskCount.data    = `${tasks.length} task${tasks.length === 1 ? '' : 's'}`
  r.emptyState.hidden = tasks.length > 0
  r.tableWrap.hidden  = tasks.length === 0

  // Keyed reconciliation — walk tasks in data order, update or insert, then prune removed.
  const seen   = new Set()
  let   cursor = r.tbody.firstChild  // insertion point advances as we process each task

  for (const task of tasks) {
    seen.add(task.id)
    const entry = taskRows.get(task.id)

    if (entry) {
      patchTaskRow(entry, task)
      if (entry.el !== cursor) r.tbody.insertBefore(entry.el, cursor ?? null)
      const afterRow = entry.el.nextSibling
      if (entry.errorEl) {
        if (entry.errorEl !== afterRow) r.tbody.insertBefore(entry.errorEl, afterRow ?? null)
        cursor = entry.errorEl.nextSibling
      } else {
        cursor = afterRow
      }
    } else {
      const newEntry = buildTaskRow(task)
      taskRows.set(task.id, newEntry)
      r.tbody.insertBefore(newEntry.el, cursor ?? null)
      if (newEntry.errorEl) r.tbody.insertBefore(newEntry.errorEl, cursor ?? null)
    }
  }

  for (const [id, entry] of taskRows) {
    if (!seen.has(id)) {
      entry.el.remove()
      entry.errorEl?.remove()
      taskRows.delete(id)
    }
  }
}

function patchTaskRow(entry, task) {
  entry.ageNode.data = relativeAge(task.createdAt)

  if (entry.lastStatus !== task.status) {
    entry.statusBadge.dataset.s = task.status
    entry.statusLabel.data      = task.status
    entry.lastStatus            = task.status
  }

  if (entry.lastBranch !== task.branch) {
    entry.branchEl.title       = task.branch ?? ''
    entry.branchEl.textContent = task.branch ?? '—'
    entry.lastBranch           = task.branch
  }

  if (entry.lastPrUrl !== task.prUrl) {
    patchPrCell(entry.prEl, task.prUrl)
    entry.lastPrUrl = task.prUrl
  }

  if (task.error && task.status === 'failed' && !entry.errorEl) {
    entry.errorEl = buildErrorRow(task.error)
    entry.el.after(entry.errorEl)
  } else if (entry.errorEl && task.status !== 'failed') {
    entry.errorEl.remove()
    entry.errorEl = null
  }
}

function patchPrCell(cell, prUrl) {
  cell.replaceChildren(
    prUrl
      ? h('a', { href: prUrl, target: '_blank', rel: 'noopener noreferrer',
                 'aria-label': `Pull request ${prShortRef(prUrl)}` }, prShortRef(prUrl))
      : h('span', { style: 'color:var(--ink-3)', 'aria-label': 'no pull request' }, '—'),
  )
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

function boot(data) {
  const app  = document.getElementById('app')
  const wrap = h('main', { class: 'wrap' })

  wrap.append(
    buildMasthead(data),
    sectionLabel('01', 'Today', h('span', { class: 'extra' }, 'live · refreshes every 5s')),
    buildStats(data),
    buildLedger(data.tasks),
    h('section', { class: 'foot', 'aria-label': 'System and Activity' },
      buildSystem(data.env),
      buildActivity(data.tasks),
    ),
    h('div', { class: 'foot-meta' },
      h('span', {}, 'Kalos · self-hosted · open source'),
      h('span', {}, 'ready', h('span', { class: 'caret', 'aria-hidden': 'true' }, '▍')),
    ),
  )

  app.replaceChildren(wrap)
  booted = true
}

function patch(data) {
  patchMasthead(data)
  patchStats(data.stats)
  patchLedger(data.tasks)
  fillActivity(data.tasks)
}

// ─── Data fetching ───────────────────────────────────────────────────────────

let controller = null

async function load() {
  controller?.abort()
  controller = new AbortController()
  try {
    const res  = await fetch('/ui/data', { signal: controller.signal, credentials: 'same-origin' })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    const data = await res.json()
    booted ? patch(data) : boot(data)
  } catch (e) {
    if (e.name === 'AbortError') return
    if (!booted) {
      const fail = h('div', { class: 'fail wrap', role: 'alert' })
      fail.textContent = `failed to load · ${e.message} · retrying every ${REFRESH_MS / 1000}s`
      document.getElementById('app').replaceChildren(fail)
    }
  }
}

// ─── Startup ─────────────────────────────────────────────────────────────────

// Inject CSS and bird immediately so the loader is styled before the first fetch.
const _style = document.createElement('style')
_style.textContent = CSS
document.head.appendChild(_style)

const _bird = h('div', { class: 'bird-corner' })
_bird.innerHTML = BIRD_SVG
document.body.appendChild(_bird)

load()
setInterval(load, REFRESH_MS)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') load()
})
