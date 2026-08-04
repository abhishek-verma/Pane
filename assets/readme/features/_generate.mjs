#!/usr/bin/env node
/**
 * Pane README feature animations — Living Grid product mocks with subtle motion.
 * Run: node assets/readme/features/_generate.mjs
 * Then: node assets/readme/features/export-gifs.mjs  (needs ffmpeg + local playwright)
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Window geometry (shared across all scenes)
const W = 960;
const H = 540;
const WX = 40;
const WY = 36;
const WW = 880;
const WH = 468;
const BAR = 32;
const BODY_Y = WY + BAR; // 68
const DIV = WX + 580; // 620 — main | agent
const MAIN_W = DIV - WX; // 580
const PANEL_W = WX + WW - DIV; // 300
const PANEL_X = DIV;
const RX = 5; // consoles / regions — Living Grid max ~6px

// Living Grid tokens
const WHITE = "#FFFFFF";
const CHARCOAL = "#1A1B22";
const CITRON = "#C8E832";
const CITRON_DEEP = "#94B316";
const BORDER = "#E2E2E2";
const BORDER_DARK = "#2E2E33";
const INK = "#111113";
const MUTED = "#6B6B72";
const COMPOSER_BG = "#FAFAFA";
const SEND_ARROW = "#1A1F0A";
const PANEL_BG = "#FFFFFF";

/** Rich paper fields — match living-grid tokens (higher chroma, not pale wash). */
const FIELD = {
  rust: "#E8B8AE",
  ember: "#E8C49A",
  amber: "#E5D478",
  clay: "#DCC9A0",
  moss: "#B8D48A",
  petrol: "#8FCFC0",
  dust: "#A8C0E8",
  iris: "#C0B0E8",
  plum: "#E0A8C8",
  slate: "#C4C8D4",
};

const SANS =
  "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const MONO =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

const baseCss = `
  .sans, text:not(.mono) { font-family: ${SANS}; }
  .mono { font-family: ${MONO}; letter-spacing: 0.04em; }
  @media (prefers-reduced-motion: reduce) {
    * { animation: none !important; }
  }
`;

function defs(extraCss = "") {
  // 12-column grid across the 960 canvas (~80px columns)
  const col = W / 12;
  return `
  <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="${CITRON}"/>
    <stop offset="100%" stop-color="${CITRON_DEEP}"/>
  </linearGradient>
  <pattern id="grid" width="${col}" height="${col}" patternUnits="userSpaceOnUse">
    <path d="M${col} 0H0V${col}" fill="none" stroke="${INK}" stroke-opacity="0.04"/>
  </pattern>
  <clipPath id="win">
    <rect x="${WX}" y="${WY}" width="${WW}" height="${WH}" rx="${RX}"/>
  </clipPath>
  <style><![CDATA[
${baseCss}
${extraCss}
  ]]></style>`;
}

/** Thin top rail: mono breadcrumb left, live state + citron dot right. No traffic lights. */
function chrome(breadcrumb, state = "AGENT IDLE", opts = {}) {
  const { showDivider = true, mainFill = WHITE } = opts;
  const stateX = WX + WW - 18;
  return `
  <g clip-path="url(#win)">
    <rect x="${WX}" y="${WY}" width="${WW}" height="${WH}" fill="${WHITE}" stroke="${BORDER}" stroke-width="1"/>
    <rect x="${WX}" y="${WY}" width="${WW}" height="${BAR}" fill="${WHITE}"/>
    <line x1="${WX}" y1="${BODY_Y}" x2="${WX + WW}" y2="${BODY_Y}" stroke="${BORDER}"/>
    <text class="mono" x="${WX + 16}" y="${WY + 21}" fill="${MUTED}" font-size="10">${esc(breadcrumb)}</text>
    <circle cx="${stateX - 72}" cy="${WY + 16}" r="3.5" fill="${CITRON}"/>
    <text class="mono" x="${stateX}" y="${WY + 21}" text-anchor="end" fill="${MUTED}" font-size="10">${esc(state)}</text>
    <rect x="${WX}" y="${BODY_Y}" width="${MAIN_W}" height="${WH - BAR}" fill="${mainFill}"/>
    ${showDivider ? `<line x1="${DIV}" y1="${BODY_Y}" x2="${DIV}" y2="${WY + WH}" stroke="${BORDER}"/>` : ""}
`;
}

/** Full-width chrome (no side panel). */
function chromeFull(breadcrumb, state = "AGENT IDLE", opts = {}) {
  const { mainFill = WHITE } = opts;
  const stateX = WX + WW - 18;
  return `
  <g clip-path="url(#win)">
    <rect x="${WX}" y="${WY}" width="${WW}" height="${WH}" fill="${WHITE}" stroke="${BORDER}" stroke-width="1"/>
    <rect x="${WX}" y="${WY}" width="${WW}" height="${BAR}" fill="${WHITE}"/>
    <line x1="${WX}" y1="${BODY_Y}" x2="${WX + WW}" y2="${BODY_Y}" stroke="${BORDER}"/>
    <text class="mono" x="${WX + 16}" y="${WY + 21}" fill="${MUTED}" font-size="10">${esc(breadcrumb)}</text>
    <circle cx="${stateX - 72}" cy="${WY + 16}" r="3.5" fill="${CITRON}"/>
    <text class="mono" x="${stateX}" y="${WY + 21}" text-anchor="end" fill="${MUTED}" font-size="10">${esc(state)}</text>
    <rect x="${WX}" y="${BODY_Y}" width="${WW}" height="${WH - BAR}" fill="${mainFill}"/>
`;
}

function panelHeader(label = "AGENT") {
  return `
    <rect x="${PANEL_X}" y="${BODY_Y}" width="${PANEL_W}" height="${WH - BAR}" fill="${PANEL_BG}"/>
    <text class="mono" x="${PANEL_X + 16}" y="${BODY_Y + 28}" fill="${MUTED}" font-size="10">${esc(label)}</text>
    <line x1="${PANEL_X}" y1="${BODY_Y + 40}" x2="${PANEL_X + PANEL_W}" y2="${BODY_Y + 40}" stroke="${BORDER}"/>
`;
}

/** Living Grid composer: bordered console, compact input, circular citron send. */
function composer() {
  const pad = 12;
  const x = PANEL_X + pad;
  const w = PANEL_W - pad * 2;
  const h = 56;
  const y = WY + WH - h - pad;
  const sendCx = x + w - 22;
  const sendCy = y + h / 2;
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${RX}" fill="${COMPOSER_BG}" stroke="${BORDER}"/>
    <text x="${x + 12}" y="${y + 22}" fill="${MUTED}" font-size="11">Ask Pane anything</text>
    <line x1="${x + 10}" y1="${y + 32}" x2="${x + w - 48}" y2="${y + 32}" stroke="${BORDER}"/>
    <text class="mono" x="${x + 12}" y="${y + 46}" fill="${MUTED}" font-size="9">PANE</text>
    <circle cx="${sendCx}" cy="${sendCy}" r="11" fill="${CITRON}"/>
    <path d="M${sendCx - 5} ${sendCy}h10M${sendCx + 1} ${sendCy - 4}l4 4-4 4" fill="none" stroke="${SEND_ARROW}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
`;
}

/** Home composer (wider, in main column). */
function homeComposer(x, y, w) {
  const h = 64;
  const sendCx = x + w - 24;
  const sendCy = y + h / 2;
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${RX}" fill="${COMPOSER_BG}" stroke="${BORDER}"/>
    <text x="${x + 14}" y="${y + 24}" fill="${MUTED}" font-size="12">Ask Pane to start living work…</text>
    <line x1="${x + 12}" y1="${y + 36}" x2="${x + w - 52}" y2="${y + 36}" stroke="${BORDER}"/>
    <text class="mono" x="${x + 14}" y="${y + 52}" fill="${MUTED}" font-size="9">PANE</text>
    <text class="mono" x="${x + 96}" y="${y + 52}" fill="${MUTED}" font-size="9">WORKSPACE</text>
    <circle cx="${sendCx}" cy="${sendCy}" r="12" fill="${CITRON}"/>
    <path d="M${sendCx - 5} ${sendCy}h10M${sendCx + 1} ${sendCy - 4}l4 4-4 4" fill="none" stroke="${SEND_ARROW}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
`;
}

function closeChrome() {
  return `  </g>`;
}

function wrap(aria, css, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">
  <defs>${defs(css)}</defs>
  <rect width="${W}" height="${H}" fill="${WHITE}"/>
  <rect width="${W}" height="${H}" fill="url(#grid)"/>
${body}
</svg>
`;
}

function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Hairline region — optional 2px citron left rail (tool traces). */
function card(x, y, w, h, { rail = false, fill = WHITE } = {}) {
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${RX}" fill="${fill}" stroke="${BORDER}"/>
    ${rail ? `<rect x="${x}" y="${y + 4}" width="2" height="${h - 8}" fill="${CITRON}"/>` : ""}`;
}

function toolTrace(x, y, w, h, name, lines) {
  // Compact single-line traces put the detail on the same row as the mono label.
  if (lines.length === 1 && h <= 40) {
    return `
    ${card(x, y, w, h, { rail: true })}
    <text class="mono" x="${x + 14}" y="${y + h / 2 + 4}" fill="${MUTED}" font-size="9">${esc(name)}</text>
    <text x="${x + 14 + name.length * 6.2 + 10}" y="${y + h / 2 + 4}" fill="${INK}" font-size="11">${esc(lines[0])}</text>`;
  }
  const lineEls = lines
    .map(
      (t, i) =>
        `<text x="${x + 14}" y="${y + 36 + i * 16}" fill="${i === 0 ? INK : MUTED}" font-size="11">${esc(t)}</text>`,
    )
    .join("\n");
  return `
    ${card(x, y, w, h, { rail: true })}
    <text class="mono" x="${x + 14}" y="${y + 18}" fill="${MUTED}" font-size="9">${esc(name)}</text>
    ${lineEls}`;
}

function msgRow(x, y, w, text, { user = false } = {}) {
  return `
    <text x="${x}" y="${y}" fill="${user ? INK : MUTED}" font-size="${user ? 12 : 11.5}"${user ? ' font-weight="500"' : ""}>${esc(text)}</text>`;
}

// ─── Scenes ───────────────────────────────────────────────────────────

const scenes = {
  "01-meetings": {
    aria: "Meeting notes without a bot — Pane records a call tab and answers from the transcript",
    css: `
  .rec-dot { animation: blink 1.4s steps(1) infinite; }
  @keyframes blink { 0%,55% { opacity: 1; } 56%,100% { opacity: 0.2; } }
  .bar { transform-box: fill-box; transform-origin: center bottom; }
  .b1 { animation: wave 1.1s ease-in-out infinite; }
  .b2 { animation: wave 1.1s ease-in-out 0.15s infinite; }
  .b3 { animation: wave 1.1s ease-in-out 0.3s infinite; }
  .b4 { animation: wave 1.1s ease-in-out 0.08s infinite; }
  .b5 { animation: wave 1.1s ease-in-out 0.22s infinite; }
  @keyframes wave {
    0%,100% { transform: scaleY(0.45); opacity: 0.55; }
    50% { transform: scaleY(1); opacity: 1; }
  }
`,
    body: (() => {
      const mx = WX + 24;
      const my = BODY_Y + 24;
      const px = PANEL_X + 16;
      const pw = PANEL_W - 32;
      return `
${chrome("PANE / HOME / MEETINGS", "RECORDING")}
    <!-- main: call -->
    <g class="rec-dot">
      <circle cx="${mx + 6}" cy="${my + 4}" r="4" fill="#C44A3A"/>
    </g>
    <text class="mono" x="${mx + 18}" y="${my + 8}" fill="${MUTED}" font-size="10">RECORDING LOCALLY</text>
    <rect x="${mx + 340}" y="${my - 8}" width="148" height="24" rx="${RX}" fill="${WHITE}" stroke="${BORDER}"/>
    <text class="mono" x="${mx + 414}" y="${my + 8}" text-anchor="middle" fill="${MUTED}" font-size="9">NO BOT JOINED</text>

    <circle cx="${WX + MAIN_W / 2}" cy="${BODY_Y + 160}" r="44" fill="${WHITE}" stroke="${BORDER}"/>
    <circle cx="${WX + MAIN_W / 2}" cy="${BODY_Y + 152}" r="16" fill="#D4D4D8"/>
    <ellipse cx="${WX + MAIN_W / 2}" cy="${BODY_Y + 184}" rx="24" ry="12" fill="#D4D4D8"/>
    <text x="${WX + MAIN_W / 2}" y="${BODY_Y + 236}" text-anchor="middle" fill="${INK}" font-size="15" font-weight="600">Vendor pricing call</text>
    <text class="mono" x="${WX + MAIN_W / 2}" y="${BODY_Y + 256}" text-anchor="middle" fill="${MUTED}" font-size="10">YOU · PRIYA · MARCUS</text>

    <g transform="translate(${WX + MAIN_W / 2 - 66} ${BODY_Y + 280})">
      <rect class="bar b1" x="0" y="8" width="7" height="28" rx="2" fill="${CITRON_DEEP}"/>
      <rect class="bar b2" x="14" y="2" width="7" height="40" rx="2" fill="${CITRON}"/>
      <rect class="bar b3" x="28" y="10" width="7" height="24" rx="2" fill="${CITRON_DEEP}"/>
      <rect class="bar b4" x="42" y="0" width="7" height="44" rx="2" fill="${CITRON}"/>
      <rect class="bar b5" x="56" y="6" width="7" height="32" rx="2" fill="${CITRON_DEEP}"/>
      <rect class="bar b2" x="70" y="4" width="7" height="36" rx="2" fill="${CITRON}"/>
      <rect class="bar b3" x="84" y="12" width="7" height="20" rx="2" fill="${CITRON_DEEP}"/>
      <rect class="bar b1" x="98" y="3" width="7" height="38" rx="2" fill="${CITRON}"/>
      <rect class="bar b4" x="112" y="9" width="7" height="26" rx="2" fill="${CITRON_DEEP}"/>
      <rect class="bar b5" x="126" y="1" width="7" height="42" rx="2" fill="${CITRON}"/>
    </g>

${panelHeader("AGENT · MEETINGS")}
    <text class="mono" x="${px}" y="${BODY_Y + 60}" fill="${MUTED}" font-size="9">TRANSCRIPT · ON DEVICE</text>
    ${msgRow(px, BODY_Y + 88, pw, "0:42  Priya — annual is fine")}
    ${msgRow(px, BODY_Y + 108, pw, "1:08  You — flag the SLA", { user: true })}
    ${msgRow(px, BODY_Y + 128, pw, "1:31  Marcus — legal by Wed")}
    ${msgRow(px, BODY_Y + 148, pw, "2:04  You — ship Friday", { user: true })}

    <g transform="translate(${px} ${BODY_Y + 172})">
      <rect width="${pw}" height="40" rx="${RX}" fill="${COMPOSER_BG}" stroke="${BORDER}"/>
      <text x="12" y="16" fill="${INK}" font-size="11">What did we decide</text>
      <text x="12" y="32" fill="${INK}" font-size="11">on pricing?</text>
    </g>
    <g transform="translate(${px} ${BODY_Y + 224})">
      <rect width="${pw}" height="88" rx="${RX}" fill="${WHITE}" stroke="${BORDER}"/>
      <rect x="0" y="4" width="2" height="80" fill="${CITRON}"/>
      <text x="14" y="22" fill="${INK}" font-size="11.5">Annual plan. Flag SLA.</text>
      <text x="14" y="40" fill="${INK}" font-size="11.5">Legal reviews by Wed.</text>
      <text x="14" y="58" fill="${INK}" font-size="11.5">Update ships Friday.</text>
      <text class="mono" x="14" y="78" fill="${MUTED}" font-size="9">FROM THIS CALL TAB</text>
    </g>
${composer()}
${closeChrome()}`;
    })(),
  },

  "02-personalised-internet": {
    aria: "Personalised Internet — your work becomes a living web of private sites",
    css: `
  /* 9s loop — 3 full-screen phases with crossfade */
  .ph1 { animation: ph1 9s ease-in-out infinite; }
  .ph2 { animation: ph2 9s ease-in-out infinite; }
  .ph3 { animation: ph3 9s ease-in-out infinite; }
  @keyframes ph1 { 0%,28% { opacity:1 } 32%,100% { opacity:0 } }
  @keyframes ph2 { 0%,30% { opacity:0 } 34%,62% { opacity:1 } 66%,100% { opacity:0 } }
  @keyframes ph3 { 0%,64% { opacity:0 } 68%,94% { opacity:1 } 98%,100% { opacity:0 } }
  .field-bg { animation: fBg 9s ease-in-out infinite; }
  @keyframes fBg {
    0%,28% { fill: #FFFFFF }
    34%,62% { fill: #EFE3C8 }
    68%,94% { fill: #E6DFF0 }
    98%,100% { fill: #FFFFFF }
  }
  /* Click-flash on the element being opened, just before each transition */
  .click-doorway { animation: clickDoorway 9s ease-in-out infinite; }
  @keyframes clickDoorway {
    0%,24% { fill-opacity:0 } 25.5% { fill-opacity:0.07 } 27.5% { fill-opacity:0 } 100% { fill-opacity:0 }
  }
  .click-card { animation: clickCard 9s ease-in-out infinite; }
  @keyframes clickCard {
    0%,58.5% { fill-opacity:0 } 60% { fill-opacity:0.1 } 62% { fill-opacity:0 } 100% { fill-opacity:0 }
  }
  .pulse-dot { animation: pDot 2s ease-in-out infinite; }
  @keyframes pDot { 0%,100% { opacity:.4 } 50% { opacity:1 } }
`,
    body: (() => {
      const mx = WX + 24;
      const my = BODY_Y + 20;
      const bw = WW - 48;
      const stateX = WX + WW - 18;

      // Actual field tokens derived from OKLCH → hex approximations
      // ember: oklch(0.93 0.06 58)
      const eBg     = "#EFE3C8"; // field bg
      const eCard   = "#F5EDDA"; // card (field +0.025 L)
      const eBorder = "#CBA85A"; // border (field -0.1L, 2x chroma)
      const eInk    = "#2A1E08"; // foreground (L=0.16)
      const eMuted  = "#7A5820"; // muted-fg (L=0.47, 2.5x chroma)

      // iris: oklch(0.92 0.065 295)
      const iBg     = "#E6DFF0"; // field bg
      const iCard   = "#EDE8F5"; // card
      const iBorder = "#A898D8"; // border
      const iInk    = "#160F2E"; // foreground
      const iMuted  = "#52407A"; // muted-fg

      // Shell (white): border = oklch(0.9 0 0) = #E5E5E5
      const RAIL_BORDER = "#E5E5E5";

      // Board: w-56 = 224px columns, px-3, border-b dividers, NO radius
      const colW = 216;
      const colGap = 0; // columns share borders

      return `
${chromeFull("", "", { mainFill: WHITE })}
    <rect class="field-bg" x="${WX}" y="${BODY_Y}" width="${WW}" height="${WH - BAR}"/>

    <!-- PHASE 1: Home — white shell, doorways, continuity -->
    <g class="ph1">
      <text class="mono" x="${WX + 16}" y="${WY + 21}" fill="${MUTED}" font-size="10">PANE / HOME</text>
      <circle cx="${stateX - 72}" cy="${WY + 16}" r="3.5" fill="${CITRON}"/>
      <text class="mono" x="${stateX}" y="${WY + 21}" text-anchor="end" fill="${MUTED}" font-size="10">PANE IDLE</text>

      ${homeComposer(mx, my, bw)}

      <text class="mono" x="${mx}" y="${my + 100}" fill="${MUTED}" font-size="9">DOORWAYS</text>
      <line x1="${mx}" y1="${my + 110}" x2="${mx + bw}" y2="${my + 110}" stroke="${RAIL_BORDER}"/>

      <!-- Job Search doorway row — 68px tall -->
      <circle cx="${mx + 14}" cy="${my + 144}" r="8" fill="${eBg}"/>
      <text x="${mx + 32}" y="${my + 138}" fill="${INK}" font-size="13" font-weight="550">Job Search</text>
      <text class="mono" x="${mx + 32}" y="${my + 156}" fill="${MUTED}" font-size="9">3 ACTIVE \xb7 1 OFFER \xb7 UPDATED 2H AGO</text>
      <text x="${mx + bw - 14}" y="${my + 147}" text-anchor="end" fill="${MUTED}" font-size="14">\u2192</text>
      <!-- Click flash just before transition to board -->
      <rect class="click-doorway" x="${mx}" y="${my + 110}" width="${bw}" height="68" fill="${INK}"/>
      <line x1="${mx}" y1="${my + 178}" x2="${mx + bw}" y2="${my + 178}" stroke="${RAIL_BORDER}"/>

      <!-- Research Hub doorway row — 68px tall -->
      <circle cx="${mx + 14}" cy="${my + 212}" r="8" fill="${FIELD.dust}"/>
      <text x="${mx + 32}" y="${my + 206}" fill="${INK}" font-size="13" font-weight="550">Research Hub</text>
      <text class="mono" x="${mx + 32}" y="${my + 224}" fill="${MUTED}" font-size="9">12 FINDINGS \xb7 3 NEW SINCE MONDAY</text>
      <text x="${mx + bw - 14}" y="${my + 215}" text-anchor="end" fill="${MUTED}" font-size="14">\u2192</text>
      <line x1="${mx}" y1="${my + 246}" x2="${mx + bw}" y2="${my + 246}" stroke="${RAIL_BORDER}"/>

      <text class="mono" x="${mx}" y="${my + 278}" fill="${MUTED}" font-size="9">CONTINUITY</text>
      <line x1="${mx}" y1="${my + 288}" x2="${mx + bw}" y2="${my + 288}" stroke="${RAIL_BORDER}"/>
      <!-- Continuity item — citron left-rail trace (2px), 52px tall -->
      <rect x="${mx}" y="${my + 288}" width="2" height="52" fill="${CITRON}"/>
      <text x="${mx + 14}" y="${my + 310}" fill="${INK}" font-size="12">Follow up with Meridian \u2014 applied 5 days ago</text>
      <text class="mono" x="${mx + 14}" y="${my + 328}" fill="${MUTED}" font-size="9">JOB SEARCH \xb7 SUGGESTED</text>
      <line x1="${mx}" y1="${my + 340}" x2="${mx + bw}" y2="${my + 340}" stroke="${RAIL_BORDER}"/>
    </g>

    <!-- PHASE 2: Board — ember field, flat kanban, no card radii -->
    <g class="ph2">
      <text class="mono" x="${WX + 16}" y="${WY + 21}" fill="${eMuted}" font-size="10">PANE / JOB SEARCH</text>
      <circle cx="${stateX - 72}" cy="${WY + 16}" r="3.5" fill="${CITRON}"/>
      <text class="mono" x="${stateX}" y="${WY + 21}" text-anchor="end" fill="${eMuted}" font-size="10">SITE READY</text>

      <!-- Page title row -->
      <text x="${mx}" y="${my + 14}" fill="${eInk}" font-size="19" font-weight="580" letter-spacing="-0.025em">Job Search</text>
      <text class="mono" x="${mx + bw}" y="${my + 14}" text-anchor="end" fill="${eMuted}" font-size="9">pi://job-search</text>

      <!-- Pulse line (match real UI: "8 applied · 3 active · 1 offer") -->
      <text class="mono" x="${mx}" y="${my + 32}" fill="${eMuted}" font-size="9">8 applied \xb7 3 interviewing \xb7 5 ghosted \xb7 1 offer</text>
      <line x1="${mx}" y1="${my + 42}" x2="${mx + bw}" y2="${my + 42}" stroke="${eBorder}" stroke-opacity=".4"/>

      <!-- 4 columns — flat, border-l dividers, w-56 each -->
      ${["APPLIED", "ACTIVE", "OFFER", "GHOSTED"].map((col, i) => `
      <line x1="${mx + i * colW}" y1="${my + 42}" x2="${mx + i * colW}" y2="${WY + WH - 2}" stroke="${eBorder}" stroke-opacity="${i === 0 ? 0 : 0.4}"/>
      <text class="mono" x="${mx + i * colW + 12}" y="${my + 60}" fill="${eMuted}" font-size="9">${col}</text>
      <text class="mono" x="${mx + i * colW + colW - 12}" y="${my + 60}" text-anchor="end" fill="${eMuted}" font-size="9">${[3, 2, 1, 2][i]}</text>
      <line x1="${mx + i * colW}" y1="${my + 68}" x2="${mx + i * colW + colW}" y2="${my + 68}" stroke="${eBorder}" stroke-opacity=".4"/>`).join("")}

      <!-- Col 0: Applied cards — 64px rows, PREP + DETAILS on each -->
      ${[
        { title: "Meridian \xb7 PM",   sub: "Applied 5 days ago" },
        { title: "Helix \xb7 Product", sub: "Applied 2 days ago" },
        { title: "Canopy \xb7 Sr PM",  sub: "Applied today" },
      ].map((c, i) => {
        const ry = my + 68 + i * 64;
        return `
      <line x1="${mx}" y1="${ry + 64}" x2="${mx + colW}" y2="${ry + 64}" stroke="${eBorder}" stroke-opacity=".3"/>
      <text x="${mx + 12}" y="${ry + 20}" fill="${eInk}" font-size="11" font-weight="500">${c.title}</text>
      <text x="${mx + 12}" y="${ry + 35}" fill="${eMuted}" font-size="10">${c.sub}</text>
      <rect x="${mx + 12}" y="${ry + 44}" width="32" height="13" fill="none" stroke="${eBorder}"/>
      <text class="mono" x="${mx + 28}" y="${ry + 53}" text-anchor="middle" fill="${eMuted}" font-size="7">PREP</text>
      <rect x="${mx + 50}" y="${ry + 44}" width="40" height="13" fill="none" stroke="${eBorder}"/>
      <text class="mono" x="${mx + 70}" y="${ry + 53}" text-anchor="middle" fill="${eMuted}" font-size="7">DETAILS</text>`;
      }).join("")}

      <!-- Col 1: Active — Wavefront (citron highlight) + Strata -->
      ${(() => {
        const cx = mx + colW;
        const cards = [
          { title: "Wavefront \xb7 PM", sub: "Round 2 \xb7 Thursday", highlight: true },
          { title: "Strata \xb7 Sr Eng",  sub: "Take home \xb7 Due Friday", highlight: false },
        ];
        return cards.map((c, i) => {
          const ry = my + 68 + i * 64;
          const bord = c.highlight ? CITRON_DEEP : eBorder;
          const bop = c.highlight ? "1" : ".3";
          const prepFill = c.highlight ? `fill="${CITRON}" fill-opacity=".25"` : `fill="none"`;
          const prepBord = c.highlight ? CITRON_DEEP : eBorder;
          const prepText = c.highlight ? eInk : eMuted;
          return `
      ${c.highlight ? `<!-- Click flash on Wavefront before entity transition -->
      <rect class="click-card" x="${cx}" y="${ry}" width="${colW}" height="64" fill="${eInk}"/>` : ""}
      <rect x="${cx}" y="${ry}" width="2" height="${c.highlight ? 64 : 0}" fill="${c.highlight ? CITRON : "none"}"/>
      <line x1="${cx}" y1="${ry + 64}" x2="${cx + colW}" y2="${ry + 64}" stroke="${bord}" stroke-opacity="${bop}"/>
      <text x="${cx + 14}" y="${ry + 20}" fill="${eInk}" font-size="11" font-weight="${c.highlight ? "600" : "500"}">${c.title}</text>
      <text x="${cx + 14}" y="${ry + 35}" fill="${eMuted}" font-size="10">${c.sub}</text>
      <rect x="${cx + 14}" y="${ry + 44}" width="32" height="13" ${prepFill} stroke="${prepBord}" stroke-opacity=".6"/>
      <text class="mono" x="${cx + 30}" y="${ry + 53}" text-anchor="middle" fill="${prepText}" font-size="7">PREP</text>
      <rect x="${cx + 52}" y="${ry + 44}" width="40" height="13" fill="none" stroke="${eBorder}" stroke-opacity=".5"/>
      <text class="mono" x="${cx + 72}" y="${ry + 53}" text-anchor="middle" fill="${eMuted}" font-size="7">DETAILS</text>`;
        }).join("");
      })()}

      <!-- Col 2: Offer -->
      ${(() => {
        const cx = mx + colW * 2;
        const ry = my + 68;
        return `
      <line x1="${cx}" y1="${ry + 64}" x2="${cx + colW}" y2="${ry + 64}" stroke="${eBorder}" stroke-opacity=".3"/>
      <text x="${cx + 12}" y="${ry + 20}" fill="${eInk}" font-size="11" font-weight="500">Nimbus \xb7 PM Lead</text>
      <text x="${cx + 12}" y="${ry + 35}" fill="${CITRON_DEEP}" font-size="10">Offer received</text>
      <rect x="${cx + 12}" y="${ry + 44}" width="32" height="13" fill="none" stroke="${eBorder}"/>
      <text class="mono" x="${cx + 28}" y="${ry + 53}" text-anchor="middle" fill="${eMuted}" font-size="7">PREP</text>
      <rect x="${cx + 50}" y="${ry + 44}" width="40" height="13" fill="none" stroke="${eBorder}"/>
      <text class="mono" x="${cx + 70}" y="${ry + 53}" text-anchor="middle" fill="${eMuted}" font-size="7">DETAILS</text>`;
      })()}

      <!-- Col 3: Ghosted (muted, no buttons — ghosted = no action needed) -->
      ${[
        { title: "Prism \xb7 PM",        sub: "14D \xb7 NO REPLY" },
        { title: "Lattice \xb7 Product", sub: "21D \xb7 NO REPLY" },
      ].map((c, i) => {
        const cx = mx + colW * 3;
        const ry = my + 68 + i * 64;
        return `
      <line x1="${cx}" y1="${ry + 64}" x2="${cx + colW}" y2="${ry + 64}" stroke="${eBorder}" stroke-opacity=".2"/>
      <text x="${cx + 12}" y="${ry + 20}" fill="${eMuted}" font-size="11">${c.title}</text>
      <text class="mono" x="${cx + 12}" y="${ry + 35}" fill="${eMuted}" font-size="9">${c.sub}</text>`;
      }).join("")}
    </g>

    <!-- PHASE 3: Entity — iris field, company name + badges + timeline -->
    <g class="ph3">
      <text class="mono" x="${WX + 16}" y="${WY + 21}" fill="${iMuted}" font-size="10">PANE / JOB SEARCH / WAVEFRONT</text>
      <circle cx="${stateX - 72}" cy="${WY + 16}" r="3.5" fill="${CITRON}"/>
      <text class="mono" x="${stateX}" y="${WY + 21}" text-anchor="end" fill="${iMuted}" font-size="10">READY</text>

      <!-- Company header row -->
      <text x="${mx}" y="${my + 24}" fill="${iInk}" font-size="22" font-weight="580" letter-spacing="-0.03em">Wavefront</text>
      <rect x="${mx + 154}" y="${my + 7}" width="82" height="20" fill="none" stroke="${iBorder}"/>
      <text class="mono" x="${mx + 195}" y="${my + 20}" text-anchor="middle" fill="${iInk}" font-size="8">INTERVIEWING</text>
      <rect x="${mx + 244}" y="${my + 7}" width="130" height="20" fill="none" stroke="${iBorder}"/>
      <text class="mono" x="${mx + 309}" y="${my + 20}" text-anchor="middle" fill="${iInk}" font-size="8">PRINCIPAL PM / DIRECTOR</text>
      <rect x="${mx + bw - 90}" y="${my + 7}" width="90" height="20" fill="none" stroke="${iBorder}"/>
      <text class="mono" x="${mx + bw - 45}" y="${my + 20}" text-anchor="middle" fill="${iMuted}" font-size="8">\u2190 BACK TO SITE</text>

      <line x1="${mx}" y1="${my + 36}" x2="${mx + bw}" y2="${my + 36}" stroke="${iBorder}" stroke-opacity=".4"/>

      <!-- Next action + follow up -->
      <text class="mono" x="${mx}" y="${my + 58}" fill="${iMuted}" font-size="9">NEXT</text>
      <text x="${mx + 40}" y="${my + 58}" fill="${iInk}" font-size="12">\u007e3 more rounds, then joint Alex + Priya discussion</text>
      <rect x="${mx}" y="${my + 66}" width="70" height="20" fill="${CITRON}" fill-opacity=".25" stroke="${CITRON_DEEP}" stroke-opacity=".6"/>
      <text class="mono" x="${mx + 35}" y="${my + 79}" text-anchor="middle" fill="${iInk}" font-size="8">FOLLOW UP</text>

      <line x1="${mx}" y1="${my + 100}" x2="${mx + bw}" y2="${my + 100}" stroke="${iBorder}" stroke-opacity=".4"/>

      <!-- Section: 01 Timeline — more vertical breathing room between items -->
      <text class="mono" x="${mx}" y="${my + 120}" fill="${iMuted}" font-size="9">01</text>
      <text x="${mx + 20}" y="${my + 120}" fill="${iInk}" font-size="13" font-weight="550">Timeline</text>
      <line x1="${mx}" y1="${my + 130}" x2="${mx + bw}" y2="${my + 130}" stroke="${iBorder}" stroke-opacity=".35"/>

      <circle cx="${mx + 6}" cy="${my + 154}" r="3.5" fill="${CITRON_DEEP}"/>
      <text class="mono" x="${mx + 18}" y="${my + 150}" fill="${iMuted}" font-size="9">AUG 3</text>
      <text x="${mx + 18}" y="${my + 165}" fill="${iInk}" font-size="12" font-weight="500">Met Alex + Priya in person \u2014 short, positive \u2714</text>

      <circle cx="${mx + 6}" cy="${my + 193}" r="3" fill="${iBorder}"/>
      <text class="mono" x="${mx + 18}" y="${my + 189}" fill="${iMuted}" font-size="9">JUL 17</text>
      <text x="${mx + 18}" y="${my + 204}" fill="${iInk}" font-size="12">HR screen with Priya \u2192 moved to in-person with Alex</text>

      <circle cx="${mx + 6}" cy="${my + 232}" r="3" fill="${iBorder}"/>
      <text class="mono" x="${mx + 18}" y="${my + 228}" fill="${iMuted}" font-size="9">JUL 10</text>
      <text x="${mx + 18}" y="${my + 243}" fill="${iInk}" font-size="12">Applied via referral \u2014 cover letter sent</text>

      <line x1="${mx}" y1="${my + 258}" x2="${mx + bw}" y2="${my + 258}" stroke="${iBorder}" stroke-opacity=".35"/>

      <!-- Section: 02 Company -->
      <text class="mono" x="${mx}" y="${my + 278}" fill="${iMuted}" font-size="9">02</text>
      <text x="${mx + 20}" y="${my + 278}" fill="${iInk}" font-size="13" font-weight="550">Company</text>
      <line x1="${mx}" y1="${my + 288}" x2="${mx + bw}" y2="${my + 288}" stroke="${iBorder}" stroke-opacity=".35"/>

      <text x="${mx}" y="${my + 312}" fill="${iInk}" font-size="12">Series C \xb7 $80M raised \xb7 Remote-first \xb7 200 eng \xb7 Product-led growth</text>
      <text x="${mx}" y="${my + 330}" fill="${iMuted}" font-size="11">Hiring 3 PM roles \xb7 Glassdoor 4.2 \xb7 Founded 2018</text>

      <line x1="${mx}" y1="${my + 346}" x2="${mx + bw}" y2="${my + 346}" stroke="${iBorder}" stroke-opacity=".35"/>

      <!-- Section: 03 Interview outcome -->
      <text class="mono" x="${mx}" y="${my + 366}" fill="${iMuted}" font-size="9">03</text>
      <text x="${mx + 20}" y="${my + 366}" fill="${iInk}" font-size="13" font-weight="550">Interview outcome \u2014 Aug 3</text>
    </g>
${closeChrome()}`;
    })(),
  },

  "03-research": {
    aria: "Customer research threaded across tabs into a citable outline",
    css: `
  .node { animation: softPulse 3.2s ease-in-out infinite; }
  .n2 { animation-delay: 0.4s; }
  .n3 { animation-delay: 0.8s; }
  @keyframes softPulse {
    0%,100% { opacity: 0.7; }
    50% { opacity: 1; }
  }
  .spine { stroke-dasharray: 3 5; animation: dash 1.4s linear infinite; }
  @keyframes dash { to { stroke-dashoffset: -16; } }
  .research-step { animation: stepGlow 2.8s ease-in-out infinite; }
  @keyframes stepGlow {
    0%,100% { stroke-opacity: 0.35; }
    50% { stroke-opacity: 0.85; }
  }
  .step-dot { animation: blink 1.4s steps(1) infinite; }
  @keyframes blink { 0%,55% { opacity: 1; } 56%,100% { opacity: 0.25; } }
`,
    body: (() => {
      const mx = WX + 24;
      const my = BODY_Y + 24;
      const px = PANEL_X + 16;
      const pw = PANEL_W - 32;
      const field = FIELD.dust;
      const fieldInk = "#1A2236";
      const fieldMuted = "#5A6680";
      const fieldBorder = "#C8D0E0";
      return `
${chrome("PANE / RESEARCH / CUSTOMER PAIN", "AGENT RUNNING", { mainFill: field })}
    <!-- source rail -->
    <rect x="${WX}" y="${BODY_Y}" width="48" height="${WH - BAR}" fill="${field}" stroke="none"/>
    <line x1="${WX + 48}" y1="${BODY_Y}" x2="${WX + 48}" y2="${WY + WH}" stroke="${fieldBorder}"/>
    <rect x="${WX + 8}" y="${BODY_Y + 16}" width="32" height="32" rx="${RX}" fill="${WHITE}" stroke="${CITRON_DEEP}"/>
    <text class="mono" x="${WX + 24}" y="${BODY_Y + 36}" text-anchor="middle" fill="${fieldInk}" font-size="8">G2</text>
    <rect x="${WX + 8}" y="${BODY_Y + 58}" width="32" height="32" rx="${RX}" fill="${WHITE}" stroke="${fieldBorder}"/>
    <text class="mono" x="${WX + 24}" y="${BODY_Y + 78}" text-anchor="middle" fill="${fieldMuted}" font-size="7">RDDT</text>
    <rect x="${WX + 8}" y="${BODY_Y + 100}" width="32" height="32" rx="${RX}" fill="${WHITE}" stroke="${fieldBorder}"/>
    <text class="mono" x="${WX + 24}" y="${BODY_Y + 120}" text-anchor="middle" fill="${fieldMuted}" font-size="7">BLOG</text>
    <rect x="${WX + 8}" y="${BODY_Y + 142}" width="32" height="32" rx="${RX}" fill="${WHITE}" stroke="${fieldBorder}"/>
    <text class="mono" x="${WX + 24}" y="${BODY_Y + 162}" text-anchor="middle" fill="${fieldMuted}" font-size="8">X</text>

    <text class="mono" x="${mx + 40}" y="${my + 4}" fill="${fieldMuted}" font-size="9">01 SOURCE</text>
    <text x="${mx + 40}" y="${my + 28}" fill="${fieldInk}" font-size="16" font-weight="600">“Setup took forever”</text>
    <text class="mono" x="${mx + 40}" y="${my + 48}" fill="${fieldMuted}" font-size="10">G2 · ACME ANALYTICS</text>
    <rect x="${mx + 40}" y="${my + 64}" width="380" height="6" rx="1" fill="${fieldBorder}" fill-opacity="0.55"/>
    <rect x="${mx + 40}" y="${my + 80}" width="340" height="6" rx="1" fill="${fieldBorder}" fill-opacity="0.55"/>
    <rect x="${mx + 40}" y="${my + 96}" width="360" height="6" rx="1" fill="${fieldBorder}" fill-opacity="0.55"/>
    <rect x="${mx + 40}" y="${my + 112}" width="280" height="6" rx="1" fill="${fieldBorder}" fill-opacity="0.55"/>

    <g transform="translate(${mx + 40} ${my + 140})">
      <rect width="380" height="64" rx="${RX}" fill="${WHITE}" stroke="${CITRON_DEEP}" stroke-opacity="0.55"/>
      <text x="14" y="26" fill="${fieldInk}" font-size="13" font-weight="600">Quoted into research thread</text>
      <text class="mono" x="14" y="46" fill="${fieldMuted}" font-size="10">ONBOARDING FRICTION · SOURCE KEPT</text>
    </g>

${panelHeader("AGENT · RESEARCH")}
    <text class="mono" x="${px}" y="${BODY_Y + 58}" fill="${MUTED}" font-size="9">WHY TEAMS CHURN IN MONTH 1</text>

    <g class="research-step" transform="translate(${px} ${BODY_Y + 70})">
      <rect width="${pw}" height="44" rx="${RX}" fill="${WHITE}" stroke="${CITRON}" stroke-width="1.4"/>
      <circle class="step-dot" cx="16" cy="22" r="3.5" fill="${CITRON}"/>
      <text x="28" y="18" fill="${INK}" font-size="12" font-weight="500">Researching open tabs</text>
      <text class="mono" x="28" y="34" fill="${MUTED}" font-size="9">G2 · REDDIT · BLOG</text>
    </g>

    <line class="spine" x1="${px + 10}" y1="${BODY_Y + 128}" x2="${px + 10}" y2="${BODY_Y + 278}" stroke="${CITRON_DEEP}" stroke-opacity="0.4" stroke-width="1.5"/>

    <g class="node" transform="translate(${px} ${BODY_Y + 122})">
      <circle cx="10" cy="16" r="4" fill="${CITRON_DEEP}"/>
      <rect x="24" y="0" width="${pw - 24}" height="38" rx="${RX}" fill="${WHITE}" stroke="${BORDER}"/>
      <text x="36" y="16" fill="${INK}" font-size="11">Setup took forever</text>
      <text class="mono" x="36" y="30" fill="${MUTED}" font-size="8">G2 · CITE</text>
    </g>
    <g class="node n2" transform="translate(${px} ${BODY_Y + 172})">
      <circle cx="10" cy="16" r="4" fill="${CITRON}"/>
      <rect x="24" y="0" width="${pw - 24}" height="38" rx="${RX}" fill="${WHITE}" stroke="${BORDER}"/>
      <text x="36" y="16" fill="${INK}" font-size="11">Docs assume enterprise SSO</text>
      <text class="mono" x="36" y="30" fill="${MUTED}" font-size="8">REDDIT · CITE</text>
    </g>
    <g class="node n3" transform="translate(${px} ${BODY_Y + 222})">
      <circle cx="10" cy="16" r="4" fill="${CITRON_DEEP}"/>
      <rect x="24" y="0" width="${pw - 24}" height="38" rx="${RX}" fill="${WHITE}" stroke="${BORDER}"/>
      <text x="36" y="16" fill="${INK}" font-size="11">No guided first project</text>
      <text class="mono" x="36" y="30" fill="${MUTED}" font-size="8">BLOG · CITE</text>
    </g>
    <g transform="translate(${px} ${BODY_Y + 278})">
      <rect width="${pw}" height="44" rx="${RX}" fill="${WHITE}" stroke="${BORDER}"/>
      <text x="12" y="18" fill="${INK}" font-size="12" font-weight="500">Outline ready</text>
      <text class="mono" x="12" y="34" fill="${MUTED}" font-size="9">3 THEMES · 11 SOURCES</text>
    </g>
${composer()}
${closeChrome()}`;
    })(),
  },

  "04-work-in-motion": {
    aria: "Work in motion — a scheduled Pane task finishes while the user is away and surfaces its result",
    css: `
  .live { animation: livePulse 2.4s ease-in-out infinite; }
  @keyframes livePulse {
    0%,100% { stroke-opacity: 0.3; }
    50% { stroke-opacity: 0.75; }
  }
  .dot { animation: blink 1.6s steps(1) infinite; }
  @keyframes blink { 0%,55% { opacity: 1; } 56%,100% { opacity: 0.25; } }
`,
    body: (() => {
      const mx = WX + 24;
      const my = BODY_Y + 20;
      const px = PANEL_X + 16;
      const pw = PANEL_W - 32;
      const cw = MAIN_W - 48;
      return `
${chrome("PANE / HOME", "PANE RUNNING")}
    <text x="${mx}" y="${my + 8}" fill="${INK}" font-size="20" font-weight="600" letter-spacing="-0.02em">While you were away</text>
    <text class="mono" x="${mx}" y="${my + 28}" fill="${MUTED}" font-size="10">LOCAL RUNS · COMPLETED WHILE PANE WAS OPEN</text>

    ${homeComposer(mx, my + 44, cw)}

    <text class="mono" x="${mx}" y="${my + 136}" fill="${MUTED}" font-size="9">TODAY · CONTINUITY</text>
    <line x1="${mx}" y1="${my + 146}" x2="${mx + cw}" y2="${my + 146}" stroke="${BORDER}"/>

    <g transform="translate(${mx} ${my + 164})">
      <line x1="0" y1="0" x2="${cw}" y2="0" stroke="${BORDER}"/>
      <circle cx="8" cy="24" r="4" fill="${CITRON_DEEP}"/>
      <text x="24" y="22" fill="${INK}" font-size="13" font-weight="600">Competitor scan finished</text>
      <text x="24" y="42" fill="${MUTED}" font-size="11">12 changes grouped in your Research site</text>
      <text class="mono" x="${cw}" y="22" text-anchor="end" fill="${MUTED}" font-size="8">2 MIN AGO</text>
      <line x1="0" y1="58" x2="${cw}" y2="58" stroke="${BORDER}"/>
    </g>

    <g transform="translate(${mx} ${my + 238})">
      <circle cx="8" cy="24" r="4" fill="${CITRON}"/>
      <text x="24" y="22" fill="${INK}" font-size="13" font-weight="600">Reply draft needs approval</text>
      <text x="24" y="42" fill="${MUTED}" font-size="11">Pane stopped before sending it</text>
      <text class="mono" x="${cw}" y="22" text-anchor="end" fill="${MUTED}" font-size="8">WAITING</text>
      <line x1="0" y1="58" x2="${cw}" y2="58" stroke="${BORDER}"/>
    </g>

    <g transform="translate(${mx} ${my + 312})">
      <text class="mono" x="0" y="0" fill="${MUTED}" font-size="9">DOORWAY</text>
      <text x="0" y="24" fill="${INK}" font-size="13" font-weight="500">Research Hub → 12 new findings</text>
      <text x="${cw}" y="24" text-anchor="end" fill="${MUTED}" font-size="12">Open site →</text>
    </g>

${panelHeader("RUN HISTORY")}
    <g transform="translate(${px} ${BODY_Y + 56})">
      <rect class="live" width="${pw}" height="104" rx="${RX}" fill="${WHITE}" stroke="${CITRON}" stroke-width="1.5"/>
      <circle class="dot" cx="16" cy="22" r="3.5" fill="${CITRON}"/>
      <text x="28" y="26" fill="${INK}" font-size="13" font-weight="600">Weekly competitor scan</text>
      <text class="mono" x="12" y="52" fill="${MUTED}" font-size="9">FRIDAYS · 4:00 PM</text>
      <text class="mono" x="12" y="72" fill="${MUTED}" font-size="9">STATUS · COMPLETE</text>
      <text class="mono" x="12" y="92" fill="${MUTED}" font-size="9">BROWSER AVAILABLE · LOCAL</text>
    </g>
    <g transform="translate(${px} ${BODY_Y + 176})">
      <rect width="${pw}" height="100" rx="${RX}" fill="${WHITE}" stroke="${BORDER}"/>
      <rect x="0" y="5" width="2" height="90" fill="${CITRON}"/>
      <text class="mono" x="14" y="22" fill="${MUTED}" font-size="9">APPROVAL REQUIRED</text>
      <text x="14" y="46" fill="${INK}" font-size="12" font-weight="500">Send the drafted reply?</text>
      <rect x="14" y="60" width="86" height="28" rx="${RX}" fill="${CITRON}"/>
      <text x="57" y="79" text-anchor="middle" fill="${SEND_ARROW}" font-size="11" font-weight="600">Review</text>
      <text class="mono" x="116" y="78" fill="${MUTED}" font-size="8">NOT SENT</text>
    </g>
${composer()}
${closeChrome()}`;
    })(),
  },

  "05-developer-cowork": {
    aria: "Developer — Pane agent on localhost with Cowork writing a fix",
    css: `
  .glow { animation: glowPulse 2.2s ease-in-out infinite; }
  @keyframes glowPulse {
    0%,100% { stroke-opacity: 0.25; }
    50% { stroke-opacity: 0.7; }
  }
  .caret { animation: blink 1s steps(1) infinite; }
  @keyframes blink { 0%,50% { opacity: 1; } 51%,100% { opacity: 0; } }
`,
    body: (() => {
      const mx = WX + 24;
      const my = BODY_Y + 20;
      const px = PANEL_X + 16;
      const pw = PANEL_W - 32;
      return `
${chrome("PANE / LOCALHOST / CHECKOUT", "AGENT RUNNING")}
    <rect class="glow" x="${mx}" y="${my}" width="${MAIN_W - 48}" height="200" rx="${RX}" fill="${WHITE}" stroke="${CITRON}" stroke-width="1.5"/>
    <text x="${mx + 16}" y="${my + 28}" fill="${INK}" font-size="15" font-weight="600">Checkout</text>
    <rect x="${mx + 16}" y="${my + 44}" width="200" height="32" rx="${RX}" fill="${COMPOSER_BG}" stroke="${BORDER}"/>
    <text x="${mx + 28}" y="${my + 64}" fill="${MUTED}" font-size="12">Card number</text>
    <rect x="${mx + 16}" y="${my + 86}" width="92" height="32" rx="${RX}" fill="${COMPOSER_BG}" stroke="${BORDER}"/>
    <rect x="${mx + 120}" y="${my + 86}" width="92" height="32" rx="${RX}" fill="${COMPOSER_BG}" stroke="${BORDER}"/>
    <rect x="${mx + 16}" y="${my + 136}" width="120" height="34" rx="${RX}" fill="${CITRON}"/>
    <text x="${mx + 76}" y="${my + 158}" text-anchor="middle" fill="${SEND_ARROW}" font-size="12" font-weight="600">Pay now</text>
    <text class="mono" x="${mx + 152}" y="${my + 156}" fill="#C44A3A" font-size="10">TYPEERROR · LINE 84</text>

    <rect x="${mx}" y="${my + 220}" width="${MAIN_W - 48}" height="112" rx="${RX}" fill="${CHARCOAL}"/>
    <text class="mono" x="${mx + 14}" y="${my + 244}" fill="${CITRON}" font-size="10">~/ACME-WEB · COWORK GRANTED</text>
    <text x="${mx + 14}" y="${my + 268}" fill="${MUTED}" font-size="12">$ </text>
    <text x="${mx + 26}" y="${my + 268}" fill="#F3F3F5" font-size="12">wrote src/checkout/validate.ts</text>
    <rect class="caret" x="${mx + 248}" y="${my + 256}" width="6" height="14" fill="${CITRON}"/>
    <rect x="${mx + 14}" y="${my + 284}" width="180" height="28" rx="${RX}" fill="#24252C" stroke="${BORDER_DARK}"/>
    <text class="mono" x="${mx + 26}" y="${my + 302}" fill="${CITRON}" font-size="10">VALIDATE.TS UPDATED</text>

${panelHeader("AGENT · COWORK")}
    ${toolTrace(px, BODY_Y + 56, pw, 36, "CLICK", ["Pay now"])}
    ${toolTrace(px, BODY_Y + 102, pw, 36, "READ_CONSOLE", ["TypeError:84"])}
    ${toolTrace(px, BODY_Y + 148, pw, 36, "COWORK_WRITE", ["validate.ts"])}
    <g transform="translate(${px} ${BODY_Y + 200})">
      <rect width="${pw}" height="88" rx="${RX}" fill="${WHITE}" stroke="${BORDER}"/>
      <rect x="0" y="4" width="2" height="80" fill="${CITRON}"/>
      <text x="14" y="24" fill="${INK}" font-size="12" font-weight="500">Fix ready for review</text>
      <text x="14" y="44" fill="${MUTED}" font-size="11">Null guard on card brand</text>
      <text x="14" y="60" fill="${MUTED}" font-size="11">before submit.</text>
      <text class="mono" x="14" y="78" fill="${MUTED}" font-size="9">SAME SESSION · TABS + FILES</text>
    </g>
${composer()}
${closeChrome()}`;
    })(),
  },

  "06-skills": {
    aria: "Repeated workflow staged as a Pane skill awaiting approval",
    css: `
  .approve { animation: glowBtn 2s ease-in-out infinite; }
  @keyframes glowBtn {
    0%,100% { opacity: 0.88; }
    50% { opacity: 1; }
  }
  .step-accent { animation: stepGlow 3s ease-in-out infinite; }
  @keyframes stepGlow {
    0%,100% { stroke-opacity: 0.35; }
    50% { stroke-opacity: 0.8; }
  }
`,
    body: (() => {
      const mx = WX + 24;
      const my = BODY_Y + 24;
      const px = PANEL_X + 16;
      const pw = PANEL_W - 32;
      return `
${chrome("PANE / SKILLS / STAGED", "AGENT IDLE")}
    <text x="${mx}" y="${my + 8}" fill="${INK}" font-size="17" font-weight="600">Draft skill: weekly metrics</text>
    <text class="mono" x="${mx}" y="${my + 28}" fill="${MUTED}" font-size="10">REPEATED SUCCESSFUL TOOL RUNS DETECTED</text>

    <g transform="translate(${mx} ${my + 52})">
      <rect class="step-accent" width="${MAIN_W - 48}" height="48" rx="${RX}" fill="${WHITE}" stroke="${CITRON}" stroke-width="1.2"/>
      <text class="mono" x="16" y="28" fill="${CITRON_DEEP}" font-size="12" font-weight="600">01</text>
      <text x="48" y="28" fill="${INK}" font-size="13">Pull dashboard metrics</text>
    </g>
    <g transform="translate(${mx} ${my + 112})">
      <rect width="${MAIN_W - 48}" height="48" rx="${RX}" fill="${WHITE}" stroke="${BORDER}"/>
      <text class="mono" x="16" y="28" fill="${MUTED}" font-size="12" font-weight="600">02</text>
      <text x="48" y="28" fill="${INK}" font-size="13">Paste into the Notion doc</text>
    </g>
    <g transform="translate(${mx} ${my + 172})">
      <rect width="${MAIN_W - 48}" height="48" rx="${RX}" fill="${WHITE}" stroke="${BORDER}"/>
      <text class="mono" x="16" y="28" fill="${MUTED}" font-size="12" font-weight="600">03</text>
      <text x="48" y="28" fill="${INK}" font-size="13">Ping #growth on Slack</text>
    </g>
    <text class="mono" x="${mx}" y="${my + 252}" fill="${MUTED}" font-size="10">HEURISTIC MATCH · DRAFT STAGED FOR REVIEW</text>

${panelHeader("SKILLS")}
    <g transform="translate(${px} ${BODY_Y + 56})">
      <rect width="${pw}" height="220" rx="${RX}" fill="${WHITE}" stroke="${BORDER}"/>
      <text x="14" y="28" fill="${INK}" font-size="13" font-weight="500">Weekly metrics → Notion</text>
      <text class="mono" x="14" y="48" fill="${MUTED}" font-size="9">DRAFTED FROM REPEATED TOOL RUNS</text>
      <rect x="14" y="68" width="220" height="5" rx="1" fill="${BORDER}"/>
      <rect x="14" y="84" width="180" height="5" rx="1" fill="${BORDER}"/>
      <rect x="14" y="100" width="200" height="5" rx="1" fill="${BORDER}"/>
      <text class="mono" x="14" y="132" fill="${MUTED}" font-size="9">RUNS ONLY AFTER YOU APPROVE</text>
      <g class="approve" transform="translate(14 152)">
        <rect width="108" height="32" rx="${RX}" fill="${CITRON}"/>
        <text x="54" y="21" text-anchor="middle" fill="${SEND_ARROW}" font-size="12" font-weight="600">Approve</text>
      </g>
      <g transform="translate(132 152)">
        <rect width="88" height="32" rx="${RX}" fill="${WHITE}" stroke="${BORDER}"/>
        <text x="44" y="21" text-anchor="middle" fill="${MUTED}" font-size="12">Dismiss</text>
      </g>
    </g>
${composer()}
${closeChrome()}`;
    })(),
  },

  "07-scoped-context": {
    aria: "Scoped context — browser profiles, context buckets, and personas provide different kinds of separation",
    css: `
  .slider { animation: slide 7s cubic-bezier(0.4, 0, 0.2, 1) infinite; }
  @keyframes slide {
    0%,26% { transform: translateX(0); }
    34%,60% { transform: translateX(112px); }
    68%,94% { transform: translateX(230px); }
    100% { transform: translateX(0); }
  }
  .p1 { animation: show1 7s ease-in-out infinite; }
  .p2 { animation: show2 7s ease-in-out infinite; }
  .p3 { animation: show3 7s ease-in-out infinite; }
  @keyframes show1 {
    0%,26% { opacity: 1; }
    34%,100% { opacity: 0; }
  }
  @keyframes show2 {
    0%,32% { opacity: 0; }
    38%,60% { opacity: 1; }
    68%,100% { opacity: 0; }
  }
  @keyframes show3 {
    0%,66% { opacity: 0; }
    72%,94% { opacity: 1; }
    100% { opacity: 0; }
  }
  .t1 { animation: lab1 7s ease-in-out infinite; }
  .t2 { animation: lab2 7s ease-in-out infinite; }
  .t3 { animation: lab3 7s ease-in-out infinite; }
  @keyframes lab1 {
    0%,26% { fill: ${SEND_ARROW}; }
    34%,100% { fill: ${MUTED}; }
  }
  @keyframes lab2 {
    0%,32% { fill: ${MUTED}; }
    38%,60% { fill: ${SEND_ARROW}; }
    68%,100% { fill: ${MUTED}; }
  }
  @keyframes lab3 {
    0%,66% { fill: ${MUTED}; }
    72%,94% { fill: ${SEND_ARROW}; }
    100% { fill: ${MUTED}; }
  }
`,
    body: (() => {
      const mx = WX + 28;
      const my = BODY_Y + 28;
      return `
${chromeFull("PANE / CONTEXT / SCOPES", "AGENT IDLE")}
    <text x="${mx}" y="${my + 8}" fill="${INK}" font-size="20" font-weight="600" letter-spacing="-0.02em">Choose what Pane can carry forward.</text>
    <text class="mono" x="${mx}" y="${my + 30}" fill="${MUTED}" font-size="10">THREE CONTROLS · THREE DIFFERENT JOBS</text>

    <!-- segmented control — hairline, not pill -->
    <g transform="translate(${mx} ${my + 56})">
      <rect width="348" height="36" rx="${RX}" fill="${COMPOSER_BG}" stroke="${BORDER}"/>
      <rect class="slider" x="3" y="3" width="108" height="30" rx="3" fill="${CITRON}"/>
      <text class="t1 mono" x="57" y="23" text-anchor="middle" font-size="10" font-weight="600">PROFILE</text>
      <text class="t2 mono" x="168" y="23" text-anchor="middle" font-size="10" font-weight="600">BUCKET</text>
      <text class="t3 mono" x="286" y="23" text-anchor="middle" font-size="10" font-weight="600">PERSONA</text>
    </g>

    <g class="p1" transform="translate(${mx} ${my + 116})">
      <rect width="392" height="72" rx="${RX}" fill="${WHITE}" stroke="${BORDER}"/>
      <text class="mono" x="14" y="22" fill="${MUTED}" font-size="9">HARD SEPARATION</text>
      <text x="14" y="42" fill="${INK}" font-size="13" font-weight="500">Browser profile</text>
      <text x="14" y="60" fill="${MUTED}" font-size="11">Separate cookies, history, sites, memory</text>
      <rect x="408" y="0" width="392" height="72" rx="${RX}" fill="${WHITE}" stroke="${BORDER}"/>
      <text class="mono" x="422" y="22" fill="${MUTED}" font-size="9">WHEN TO USE IT</text>
      <text x="422" y="42" fill="${INK}" font-size="13" font-weight="500">Work and personal accounts</text>
      <text x="422" y="60" fill="${MUTED}" font-size="11">Nothing crosses the profile boundary</text>
    </g>
    <g class="p2" transform="translate(${mx} ${my + 116})">
      <rect width="392" height="72" rx="${RX}" fill="${WHITE}" stroke="${BORDER}"/>
      <text class="mono" x="14" y="22" fill="${MUTED}" font-size="9">RETRIEVAL SCOPE</text>
      <text x="14" y="42" fill="${INK}" font-size="13" font-weight="500">Context bucket</text>
      <text x="14" y="60" fill="${MUTED}" font-size="11">Research, meetings, or one project</text>
      <rect x="408" y="0" width="392" height="72" rx="${RX}" fill="${WHITE}" stroke="${BORDER}"/>
      <text class="mono" x="422" y="22" fill="${MUTED}" font-size="9">WHEN TO USE IT</text>
      <text x="422" y="42" fill="${INK}" font-size="13" font-weight="500">Keep the answer on-topic</text>
      <text x="422" y="60" fill="${MUTED}" font-size="11">Pane states which bucket it read</text>
    </g>
    <g class="p3" transform="translate(${mx} ${my + 116})">
      <rect width="392" height="72" rx="${RX}" fill="${WHITE}" stroke="${BORDER}"/>
      <text class="mono" x="14" y="22" fill="${MUTED}" font-size="9">ROLE AND VOICE</text>
      <text x="14" y="42" fill="${INK}" font-size="13" font-weight="500">Persona</text>
      <text x="14" y="60" fill="${MUTED}" font-size="11">Chief of staff, research buddy, custom</text>
      <rect x="408" y="0" width="392" height="72" rx="${RX}" fill="${WHITE}" stroke="${BORDER}"/>
      <text class="mono" x="422" y="22" fill="${MUTED}" font-size="9">WHEN TO USE IT</text>
      <text x="422" y="42" fill="${INK}" font-size="13" font-weight="500">Change how Pane helps</text>
      <text x="422" y="60" fill="${MUTED}" font-size="11">Does not replace privacy boundaries</text>
    </g>

    <g transform="translate(${mx} ${my + 216})">
      <rect width="820" height="64" rx="${RX}" fill="${WHITE}" stroke="${BORDER}"/>
      <rect x="0" y="6" width="2" height="52" fill="${CITRON}"/>
      <text x="18" y="28" fill="${INK}" font-size="13" font-weight="500">Separation, retrieval, and personality are different controls.</text>
      <text class="mono" x="18" y="48" fill="${MUTED}" font-size="10">PROFILE ≠ BUCKET ≠ PERSONA · ALL LOCAL AND EDITABLE</text>
    </g>
${closeChrome()}`;
    })(),
  },

  "08-pane-as-mcp": {
    aria: "Claude Code driving Pane tabs over MCP",
    css: `
  .beam { stroke-dasharray: 5 7; animation: move 1.2s linear infinite; }
  @keyframes move { to { stroke-dashoffset: -24; } }
  .pulse { animation: nodePulse 1.6s ease-in-out infinite; }
  @keyframes nodePulse {
    0%,100% { opacity: 0.5; }
    50% { opacity: 1; }
  }
  .active-tab { animation: tabGlow 2.4s ease-in-out infinite; }
  @keyframes tabGlow {
    0%,100% { stroke-opacity: 0.25; }
    50% { stroke-opacity: 0.7; }
  }
`,
    body: (() => {
      const mid = WX + WW / 2;
      const termW = 400;
      return `
${chromeFull("PANE / MCP SESSION", "CONNECTED")}
    <!-- left: terminal (charcoal region) -->
    <rect x="${WX}" y="${BODY_Y}" width="${termW}" height="${WH - BAR}" fill="${CHARCOAL}"/>
    <text class="mono" x="${WX + 20}" y="${BODY_Y + 32}" fill="${MUTED}" font-size="10">CLAUDE · CONNECTED TO PANE MCP</text>
    <text x="${WX + 20}" y="${BODY_Y + 64}" fill="${CITRON}" font-size="12">$</text>
    <text x="${WX + 36}" y="${BODY_Y + 64}" fill="#F3F3F5" font-size="12">list_tabs</text>
    <text class="mono" x="${WX + 20}" y="${BODY_Y + 86}" fill="${MUTED}" font-size="10">→ 4 TABS · ACTIVE: DOCS.ACME.DEV</text>
    <text x="${WX + 20}" y="${BODY_Y + 116}" fill="${CITRON}" font-size="12">$</text>
    <text x="${WX + 36}" y="${BODY_Y + 116}" fill="#F3F3F5" font-size="12">navigate /api/auth#oauth</text>
    <text class="mono" x="${WX + 20}" y="${BODY_Y + 138}" fill="${MUTED}" font-size="10">→ OK · SCROLLED TO OAUTH</text>
    <text x="${WX + 20}" y="${BODY_Y + 168}" fill="${CITRON}" font-size="12">$</text>
    <text x="${WX + 36}" y="${BODY_Y + 168}" fill="#F3F3F5" font-size="12">extract_text pre.code</text>

    <g transform="translate(${WX + 20} ${BODY_Y + 196})">
      <rect width="360" height="112" rx="${RX}" fill="#24252C" stroke="${BORDER_DARK}"/>
      <text x="14" y="26" fill="#F3F3F5" font-size="12" font-weight="500">Extracted into context</text>
      <text class="mono" x="14" y="50" fill="${MUTED}" font-size="11">POST /OAUTH/TOKEN</text>
      <text class="mono" x="14" y="70" fill="${MUTED}" font-size="11">GRANT_TYPE=AUTHORIZATION_CODE</text>
      <text class="mono" x="14" y="94" fill="${MUTED}" font-size="9">REAL BROWSER · YOUR LOGINS · LOCAL</text>
    </g>

    <!-- beam -->
    <path class="beam" d="M${WX + termW} ${BODY_Y + 188} H${WX + 480}" fill="none" stroke="${CITRON_DEEP}" stroke-width="1.5" stroke-opacity="0.7"/>
    <circle class="pulse" cx="${mid}" cy="${BODY_Y + 188}" r="4" fill="${CITRON}"/>

    <!-- right: Pane tabs (white shell) -->
    <rect x="${WX + 480}" y="${BODY_Y}" width="400" height="${WH - BAR}" fill="${WHITE}"/>
    <line x1="${WX + 480}" y1="${BODY_Y}" x2="${WX + 480}" y2="${WY + WH}" stroke="${BORDER}"/>
    <text class="mono" x="${WX + 500}" y="${BODY_Y + 28}" fill="${MUTED}" font-size="10">PANE WINDOW</text>
    <text x="${WX + 500}" y="${BODY_Y + 48}" fill="${MUTED}" font-size="11">Driven by your coding agent</text>

    <rect class="active-tab" x="${WX + 500}" y="${BODY_Y + 72}" width="360" height="44" rx="${RX}" fill="${WHITE}" stroke="${CITRON}" stroke-width="1.5"/>
    <text x="${WX + 516}" y="${BODY_Y + 98}" fill="${INK}" font-size="12">docs.acme.dev/api/auth</text>

    <rect x="${WX + 500}" y="${BODY_Y + 128}" width="360" height="44" rx="${RX}" fill="${WHITE}" stroke="${BORDER}"/>
    <text x="${WX + 516}" y="${BODY_Y + 154}" fill="${MUTED}" font-size="12">github.com/acme/web</text>
    <rect x="${WX + 500}" y="${BODY_Y + 184}" width="360" height="44" rx="${RX}" fill="${WHITE}" stroke="${BORDER}"/>
    <text x="${WX + 516}" y="${BODY_Y + 210}" fill="${MUTED}" font-size="12">localhost:3000</text>

    <g transform="translate(${WX + 500} ${BODY_Y + 252})">
      <rect width="360" height="56" rx="${RX}" fill="${WHITE}" stroke="${BORDER}"/>
      <rect x="0" y="6" width="2" height="44" fill="${CITRON}"/>
      <text x="14" y="24" fill="${INK}" font-size="13" font-weight="500">Pane as MCP</text>
      <text class="mono" x="14" y="42" fill="${MUTED}" font-size="9">CLAUDE CODE · CURSOR · GEMINI CLI</text>
    </g>
${closeChrome()}`;
    })(),
  },
};

for (const [slug, scene] of Object.entries(scenes)) {
  const svg = wrap(scene.aria, scene.css, scene.body).replace(/[ \t]+$/gm, "");
  const path = join(__dirname, `${slug}.svg`);
  writeFileSync(path, svg, "utf8");
  console.log("wrote", path);
}
