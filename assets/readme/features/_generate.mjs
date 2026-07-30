#!/usr/bin/env node
/**
 * Pane README feature animations — product-window mockups with subtle motion.
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
const BAR = 40;
const BODY_Y = WY + BAR; // 76
const DIV = WX + 580; // 620 — main | agent
const MAIN_W = DIV - WX; // 580
const PANEL_W = WX + WW - DIV; // 300
const PANEL_X = DIV;

const FONT =
  "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

const baseCss = `
  text, .font { font-family: ${FONT}; }
  @media (prefers-reduced-motion: reduce) {
    * { animation: none !important; }
  }
`;

function defs(extraCss = "") {
  return `
  <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#f4f1ee"/>
    <stop offset="50%" stop-color="#ebe7e2"/>
    <stop offset="100%" stop-color="#e4dfd8"/>
  </linearGradient>
  <radialGradient id="glow" cx="70%" cy="40%" r="45%">
    <stop offset="0%" stop-color="#94B316" stop-opacity="0.16"/>
    <stop offset="55%" stop-color="#94B316" stop-opacity="0.05"/>
    <stop offset="100%" stop-color="#94B316" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#C8E832"/>
    <stop offset="100%" stop-color="#94B316"/>
  </linearGradient>
  <pattern id="grid" width="56" height="56" patternUnits="userSpaceOnUse">
    <path d="M56 0H0V56" fill="none" stroke="#1c1814" stroke-opacity="0.05"/>
  </pattern>
  <filter id="shadow" x="-25%" y="-25%" width="150%" height="150%">
    <feDropShadow dx="0" dy="22" stdDeviation="28" flood-color="#1c1814" flood-opacity="0.12"/>
  </filter>
  <clipPath id="win">
    <rect x="${WX}" y="${WY}" width="${WW}" height="${WH}" rx="16"/>
  </clipPath>
  <style><![CDATA[
${baseCss}
${extraCss}
  ]]></style>`;
}

function chrome(url) {
  return `
  <g filter="url(#shadow)">
    <rect x="${WX}" y="${WY}" width="${WW}" height="${WH}" rx="16" fill="#ffffff"/>
  </g>
  <g clip-path="url(#win)">
    <rect x="${WX}" y="${WY}" width="${WW}" height="${WH}" fill="#ffffff"/>
    <rect x="${WX}" y="${WY}" width="${WW}" height="${BAR}" fill="#f5f2ef"/>
    <line x1="${WX}" y1="${BODY_Y}" x2="${WX + WW}" y2="${BODY_Y}" stroke="#1c1814" stroke-opacity="0.05"/>
    <circle cx="${WX + 22}" cy="${WY + 20}" r="5" fill="#ff5f57"/>
    <circle cx="${WX + 40}" cy="${WY + 20}" r="5" fill="#febc2e"/>
    <circle cx="${WX + 58}" cy="${WY + 20}" r="5" fill="#28c840"/>
    <g transform="translate(${WX + 84} ${WY + 12})" stroke="#7a7268" stroke-opacity="0.85" stroke-width="1.4" stroke-linecap="round">
      <rect x="0" y="0" width="16" height="16" rx="4.5" fill="none"/>
      <line x1="6" y1="2" x2="6" y2="14"/>
    </g>
    <path d="M${WX + 124} ${WY + 12} l-8 8 8 8" fill="none" stroke="#7a7268" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M${WX + 144} ${WY + 12} l8 8 -8 8" fill="none" stroke="#c4bbb2" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="${WX + 168}" y="${WY + 8}" width="520" height="24" rx="12" fill="#faf9f7" stroke="#1c1814" stroke-opacity="0.05"/>
    <text x="${WX + 184}" y="${WY + 24}" fill="#7a7268" font-size="12">${esc(url)}</text>
    <line x1="${DIV}" y1="${BODY_Y}" x2="${DIV}" y2="${WY + WH}" stroke="#1c1814" stroke-opacity="0.06"/>
`;
}

function panelHeader(subtitle = "on this tab") {
  return `
    <rect x="${PANEL_X}" y="${BODY_Y}" width="${PANEL_W}" height="${WH - BAR}" fill="#f3f0ec"/>
    <g transform="translate(${PANEL_X + 18} ${BODY_Y + 20}) scale(0.14)">
      <path fill="#94B316" fill-rule="evenodd" clip-rule="evenodd" d="M0 0h100v100H0V0zm66 66h24v24H66V66z"/>
    </g>
    <text x="${PANEL_X + 40}" y="${BODY_Y + 32}" fill="#3d3731" font-size="13" font-weight="600">Pane</text>
    <circle cx="${PANEL_X + PANEL_W - 20}" cy="${BODY_Y + 26}" r="4" fill="#5fb872"/>
    <text x="${PANEL_X + PANEL_W - 32}" y="${BODY_Y + 31}" text-anchor="end" fill="#8a8278" font-size="11">${esc(subtitle)}</text>
`;
}

function composer() {
  const y = WY + WH - 52;
  return `
    <rect x="${PANEL_X + 16}" y="${y}" width="${PANEL_W - 32}" height="36" rx="18" fill="#ffffff" stroke="#1c1814" stroke-opacity="0.07"/>
    <text x="${PANEL_X + 32}" y="${y + 22}" fill="#8a8278" font-size="12">Ask Pane anything</text>
    <circle cx="${PANEL_X + PANEL_W - 34}" cy="${y + 18}" r="12" fill="url(#accent)"/>
    <path d="M${PANEL_X + PANEL_W - 39} ${y + 18}h10M${PANEL_X + PANEL_W - 33} ${y + 14}l4 4-4 4" fill="none" stroke="#2a1606" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
`;
}

function closeChrome() {
  return `  </g>`;
}

function wrap(aria, css, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">
  <defs>${defs(css)}</defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#grid)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
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

function card(x, y, w, h, accent) {
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="#ffffff" stroke="#1c1814" stroke-opacity="0.05"/>
    ${accent ? `<rect x="${x}" y="${y}" width="3" height="${h}" rx="1.5" fill="${accent}"/>` : ""}`;
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
      const mx = WX + 28;
      const my = BODY_Y + 28;
      const px = PANEL_X + 16;
      return `
${chrome("meet.google.com/abc-defg-hij")}
    <!-- main: call -->
    <rect x="${WX}" y="${BODY_Y}" width="${MAIN_W}" height="${WH - BAR}" fill="#faf9f7"/>
    <g class="rec-dot">
      <circle cx="${mx + 8}" cy="${my + 6}" r="5" fill="#e05a4f"/>
    </g>
    <text x="${mx + 22}" y="${my + 10}" fill="#4a433c" font-size="12" font-weight="600">Recording locally</text>
    <rect x="${mx + 340}" y="${my - 6}" width="148" height="28" rx="14" fill="#f5f2ef" stroke="#5fb872" stroke-opacity="0.4"/>
    <text x="${mx + 414}" y="${my + 12}" text-anchor="middle" fill="#1f8f4e" font-size="11">No bot joined</text>

    <circle cx="${WX + MAIN_W / 2}" cy="${BODY_Y + 168}" r="52" fill="#F4F7E0" stroke="#1c1814" stroke-opacity="0.06"/>
    <circle cx="${WX + MAIN_W / 2}" cy="${BODY_Y + 160}" r="20" fill="#cfc8c0"/>
    <ellipse cx="${WX + MAIN_W / 2}" cy="${BODY_Y + 196}" rx="28" ry="14" fill="#cfc8c0"/>
    <text x="${WX + MAIN_W / 2}" y="${BODY_Y + 250}" text-anchor="middle" fill="#1c1814" font-size="15" font-weight="600">Vendor pricing call</text>
    <text x="${WX + MAIN_W / 2}" y="${BODY_Y + 272}" text-anchor="middle" fill="#6b6258" font-size="12">You · Priya · Marcus</text>

    <g transform="translate(${WX + MAIN_W / 2 - 66} ${BODY_Y + 300})">
      <rect class="bar b1" x="0" y="8" width="7" height="28" rx="3.5" fill="#94B316"/>
      <rect class="bar b2" x="14" y="2" width="7" height="40" rx="3.5" fill="#C8E832"/>
      <rect class="bar b3" x="28" y="10" width="7" height="24" rx="3.5" fill="#94B316"/>
      <rect class="bar b4" x="42" y="0" width="7" height="44" rx="3.5" fill="#C8E832"/>
      <rect class="bar b5" x="56" y="6" width="7" height="32" rx="3.5" fill="#94B316"/>
      <rect class="bar b2" x="70" y="4" width="7" height="36" rx="3.5" fill="#C8E832"/>
      <rect class="bar b3" x="84" y="12" width="7" height="20" rx="3.5" fill="#94B316"/>
      <rect class="bar b1" x="98" y="3" width="7" height="38" rx="3.5" fill="#C8E832"/>
      <rect class="bar b4" x="112" y="9" width="7" height="26" rx="3.5" fill="#94B316"/>
      <rect class="bar b5" x="126" y="1" width="7" height="42" rx="3.5" fill="#C8E832"/>
    </g>

${panelHeader("Meetings")}
    <text x="${px}" y="${BODY_Y + 68}" fill="#6b6258" font-size="11">Transcript · kept on device</text>
    <text x="${px}" y="${BODY_Y + 100}" fill="#6b6258" font-size="11.5">0:42  Priya — annual is fine</text>
    <text x="${px}" y="${BODY_Y + 122}" fill="#4a433c" font-size="11.5">1:08  You — flag the SLA</text>
    <text x="${px}" y="${BODY_Y + 144}" fill="#6b6258" font-size="11.5">1:31  Marcus — legal by Wed</text>
    <text x="${px}" y="${BODY_Y + 166}" fill="#4a433c" font-size="11.5">2:04  You — ship Friday</text>

    <g transform="translate(${px} ${BODY_Y + 196})">
      <rect width="${PANEL_W - 32}" height="44" rx="12" fill="url(#accent)" fill-opacity="0.92"/>
      <text x="14" y="18" fill="#2a1606" font-size="11.5">What did we decide</text>
      <text x="14" y="34" fill="#2a1606" font-size="11.5">on pricing?</text>
    </g>
    <g transform="translate(${px} ${BODY_Y + 254})">
      <rect width="${PANEL_W - 32}" height="96" rx="12" fill="#F4F7E0"/>
      <text x="14" y="24" fill="#4a433c" font-size="11.5">Annual plan. Flag SLA.</text>
      <text x="14" y="42" fill="#4a433c" font-size="11.5">Legal reviews by Wed.</text>
      <text x="14" y="60" fill="#4a433c" font-size="11.5">Update ships Friday.</text>
      <text x="14" y="82" fill="#8a8278" font-size="10.5">From this call tab</text>
    </g>
${composer()}
${closeChrome()}`;
    })(),
  },

  "02-job-applicant": {
    aria: "Job applicant — Pane fills the application form, submits it, and tracks follow-up",
    css: `
  .score-fill {
    transform-box: fill-box;
    transform-origin: left center;
    animation: fillBar 7s ease-out infinite;
  }
  @keyframes fillBar {
    0%,5% { transform: scaleX(0.08); }
    18%,90% { transform: scaleX(1); }
    100% { transform: scaleX(0.08); }
  }
  .fld-name, .fld-email, .fld-resume, .fld-cover {
    opacity: 0;
    animation: typeIn 7s ease-in-out infinite both;
  }
  .fld-email { animation-delay: 0.7s; }
  .fld-resume { animation-delay: 1.4s; }
  .fld-cover { animation-delay: 2.1s; }
  @keyframes typeIn {
    0%,8% { opacity: 0; }
    18%,78% { opacity: 1; }
    90%,100% { opacity: 0; }
  }
  .focus1, .focus2, .focus3, .focus4 {
    animation: focusRing 7s ease-in-out infinite both;
  }
  .focus2 { animation-delay: 0.7s; }
  .focus3 { animation-delay: 1.4s; }
  .focus4 { animation-delay: 2.1s; }
  @keyframes focusRing {
    0%,6% { stroke-opacity: 0; }
    10%,18% { stroke-opacity: 0.7; }
    26%,100% { stroke-opacity: 0; }
  }
  .submit-btn { animation: submitPress 7s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
  @keyframes submitPress {
    0%,48% { transform: scale(1); }
    52% { transform: scale(0.96); }
    58%,100% { transform: scale(1); }
  }
  .form-dim { animation: dimForm 7s ease-in-out infinite; }
  @keyframes dimForm {
    0%,58% { opacity: 1; }
    68%,88% { opacity: 0.35; }
    96%,100% { opacity: 1; }
  }
  .success-inner { animation: successIn 7s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
  @keyframes successIn {
    0%,58% { opacity: 0; transform: scale(0.86); }
    68%,88% { opacity: 1; transform: scale(1); }
    96%,100% { opacity: 0; transform: scale(0.92); }
  }
  .tick-circle {
    fill: none;
    stroke: #5fb872;
    stroke-width: 3;
    stroke-linecap: round;
    stroke-dasharray: 180;
    stroke-dashoffset: 180;
    animation: drawCircle 7s ease-in-out infinite;
  }
  @keyframes drawCircle {
    0%,60% { stroke-dashoffset: 180; }
    70%,88% { stroke-dashoffset: 0; }
    96%,100% { stroke-dashoffset: 180; }
  }
  .tick-mark {
    fill: none;
    stroke: #5fb872;
    stroke-width: 3.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 40;
    stroke-dashoffset: 40;
    animation: drawTick 7s ease-in-out infinite;
  }
  @keyframes drawTick {
    0%,68% { stroke-dashoffset: 40; }
    76%,88% { stroke-dashoffset: 0; }
    96%,100% { stroke-dashoffset: 40; }
  }
  .agent-step1 { animation: stepOn 7s ease-in-out infinite; }
  .agent-step2 { animation: stepOn 7s ease-in-out infinite; animation-delay: 1.2s; }
  .agent-step3 { animation: stepOn 7s ease-in-out infinite; animation-delay: 2.8s; }
  @keyframes stepOn {
    0%,10% { opacity: 0.35; }
    20%,78% { opacity: 1; }
    90%,100% { opacity: 0.35; }
  }
`,
    body: (() => {
      const mx = WX + 28;
      const my = BODY_Y + 24;
      const px = PANEL_X + 16;
      const fw = MAIN_W - 56;
      return `
${chrome("boards.greenhouse.io/acme/jobs/senior-pm/apply")}
    <rect x="${WX}" y="${BODY_Y}" width="${MAIN_W}" height="${WH - BAR}" fill="#faf9f7"/>

    <g class="form-dim">
      <text x="${mx}" y="${my + 6}" fill="#1c1814" font-size="18" font-weight="600" letter-spacing="-0.02em">Apply · Senior Product Manager</text>

      <text x="${mx}" y="${my + 36}" fill="#6b6258" font-size="11">Full name</text>
      <rect class="focus1" x="${mx}" y="${my + 44}" width="${fw}" height="40" rx="10" fill="#ffffff" stroke="#94B316" stroke-width="1.5" stroke-opacity="0"/>
      <text class="fld-name" x="${mx + 14}" y="${my + 69}" fill="#1c1814" font-size="13">Alex Rivera</text>

      <text x="${mx}" y="${my + 108}" fill="#6b6258" font-size="11">Email</text>
      <rect class="focus2" x="${mx}" y="${my + 116}" width="${fw}" height="40" rx="10" fill="#ffffff" stroke="#94B316" stroke-width="1.5" stroke-opacity="0"/>
      <text class="fld-email" x="${mx + 14}" y="${my + 141}" fill="#1c1814" font-size="13">alex@example.com</text>

      <text x="${mx}" y="${my + 180}" fill="#6b6258" font-size="11">Resume</text>
      <rect class="focus3" x="${mx}" y="${my + 188}" width="${fw}" height="40" rx="10" fill="#ffffff" stroke="#94B316" stroke-width="1.5" stroke-opacity="0"/>
      <text class="fld-resume" x="${mx + 14}" y="${my + 213}" fill="#1c1814" font-size="13">Alex_Rivera_Resume.pdf</text>

      <text x="${mx}" y="${my + 252}" fill="#6b6258" font-size="11">Cover note</text>
      <rect class="focus4" x="${mx}" y="${my + 260}" width="${fw}" height="56" rx="10" fill="#ffffff" stroke="#94B316" stroke-width="1.5" stroke-opacity="0"/>
      <text class="fld-cover" x="${mx + 14}" y="${my + 284}" fill="#1c1814" font-size="12">Led 0→1 analytics · pricing experiments…</text>
      <text class="fld-cover" x="${mx + 14}" y="${my + 302}" fill="#6b6258" font-size="11">From your resume + this listing</text>

      <g transform="translate(${mx} ${my + 336})">
        <g class="submit-btn">
          <rect width="160" height="40" rx="10" fill="url(#accent)"/>
          <text x="80" y="25" text-anchor="middle" fill="#2a1606" font-size="13" font-weight="600">Submit application</text>
        </g>
      </g>
    </g>

    <g transform="translate(${WX + MAIN_W / 2} ${BODY_Y + 210})">
      <g class="success-inner">
        <circle class="tick-circle" cx="0" cy="0" r="28"/>
        <path class="tick-mark" d="M-12 1 l8 8 16-18"/>
        <text x="0" y="56" text-anchor="middle" fill="#1c1814" font-size="15" font-weight="600">Application submitted</text>
        <text x="0" y="78" text-anchor="middle" fill="#6b6258" font-size="12">Follow-up task created</text>
      </g>
    </g>

${panelHeader("Agent")}
    <g class="agent-step1" transform="translate(${px} ${BODY_Y + 60})">
      <rect width="${PANEL_W - 32}" height="64" rx="12" fill="#F4F7E0" stroke="#94B316" stroke-opacity="0.35"/>
      <text x="14" y="24" fill="#1c1814" font-size="13" font-weight="600">Fit score 86%</text>
      <text x="14" y="44" fill="#6b6258" font-size="11">Matches your PM + B2B background</text>
      <rect x="14" y="52" width="214" height="5" rx="2.5" fill="#e6e1db"/>
      <rect class="score-fill" x="14" y="52" width="214" height="5" rx="2.5" fill="url(#accent)"/>
    </g>
    <g class="agent-step2" transform="translate(${px} ${BODY_Y + 140})">
      <rect width="${PANEL_W - 32}" height="88" rx="12" fill="#ffffff"/>
      <text x="14" y="24" fill="#4a433c" font-size="12" font-weight="600">Filling application</text>
      <text x="14" y="46" fill="#6b6258" font-size="11">Name · email · resume</text>
      <text x="14" y="64" fill="#6b6258" font-size="11">Cover note from your background</text>
      <text x="14" y="78" fill="#8a8278" font-size="10.5">Typing into the live form</text>
    </g>
    <g class="agent-step3" transform="translate(${px} ${BODY_Y + 244})">
      <rect width="${PANEL_W - 32}" height="64" rx="12" fill="#f5f2ef" stroke="#5fb872" stroke-opacity="0.4"/>
      <circle cx="26" cy="32" r="9" fill="none" stroke="#5fb872" stroke-width="1.8"/>
      <path d="M21 32l3.2 3.2 6.5-6.5" fill="none" stroke="#5fb872" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="46" y="28" fill="#1c1814" font-size="12" font-weight="600">Submitted · follow up Friday</text>
      <text x="46" y="46" fill="#6b6258" font-size="11">Task · Job hunt profile</text>
    </g>
${composer()}
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
      const mx = WX + 28;
      const my = BODY_Y + 28;
      const px = PANEL_X + 16;
      return `
${chrome("pane://research/customer-pain")}
    <rect x="${WX}" y="${BODY_Y}" width="${MAIN_W}" height="${WH - BAR}" fill="#faf9f7"/>
    <!-- tab strip -->
    <rect x="${WX}" y="${BODY_Y}" width="52" height="${WH - BAR}" fill="#ece8e3"/>
    <rect x="${WX + 8}" y="${BODY_Y + 16}" width="36" height="36" rx="8" fill="#e6e1db" stroke="#94B316" stroke-opacity="0.55"/>
    <text x="${WX + 26}" y="${BODY_Y + 38}" text-anchor="middle" fill="#1c1814" font-size="9">G2</text>
    <rect x="${WX + 8}" y="${BODY_Y + 64}" width="36" height="36" rx="8" fill="#ffffff"/>
    <text x="${WX + 26}" y="${BODY_Y + 86}" text-anchor="middle" fill="#6b6258" font-size="8">Reddit</text>
    <rect x="${WX + 8}" y="${BODY_Y + 112}" width="36" height="36" rx="8" fill="#ffffff"/>
    <text x="${WX + 26}" y="${BODY_Y + 134}" text-anchor="middle" fill="#6b6258" font-size="8">Blog</text>
    <rect x="${WX + 8}" y="${BODY_Y + 160}" width="36" height="36" rx="8" fill="#ffffff"/>
    <text x="${WX + 26}" y="${BODY_Y + 182}" text-anchor="middle" fill="#6b6258" font-size="9">X</text>

    <text x="${mx + 44}" y="${my + 8}" fill="#1c1814" font-size="17" font-weight="600">“Setup took forever”</text>
    <text x="${mx + 44}" y="${my + 30}" fill="#6b6258" font-size="12">G2 · Acme Analytics · ★★★★☆</text>
    <rect x="${mx + 44}" y="${my + 52}" width="400" height="8" rx="4" fill="#e6e1db"/>
    <rect x="${mx + 44}" y="${my + 70}" width="360" height="8" rx="4" fill="#e6e1db"/>
    <rect x="${mx + 44}" y="${my + 88}" width="380" height="8" rx="4" fill="#e6e1db"/>
    <rect x="${mx + 44}" y="${my + 106}" width="300" height="8" rx="4" fill="#e6e1db"/>

    <g transform="translate(${mx + 44} ${my + 140})">
      <rect width="400" height="72" rx="12" fill="#ffffff" stroke="#94B316" stroke-opacity="0.3"/>
      <text x="18" y="30" fill="#1c1814" font-size="13" font-weight="600">Quoted into research thread</text>
      <text x="18" y="52" fill="#6b6258" font-size="12">Onboarding friction · source kept</text>
    </g>

${panelHeader("Research")}
    <text x="${px}" y="${BODY_Y + 58}" fill="#6b6258" font-size="11">Why do teams churn in month 1?</text>

    <g class="research-step" transform="translate(${px} ${BODY_Y + 72})">
      <rect width="${PANEL_W - 32}" height="48" rx="12" fill="#F4F7E0" stroke="#94B316" stroke-width="1.4"/>
      <circle class="step-dot" cx="18" cy="24" r="4" fill="#94B316"/>
      <text x="32" y="20" fill="#1c1814" font-size="12" font-weight="600">Researching open tabs</text>
      <text x="32" y="38" fill="#6b6258" font-size="10.5">G2 · Reddit · Blog · threading</text>
    </g>

    <line class="spine" x1="${px + 10}" y1="${BODY_Y + 136}" x2="${px + 10}" y2="${BODY_Y + 292}" stroke="#94B316" stroke-opacity="0.35" stroke-width="1.5"/>

    <g class="node" transform="translate(${px} ${BODY_Y + 128})">
      <circle cx="10" cy="16" r="5" fill="#94B316"/>
      <rect x="28" y="0" width="${PANEL_W - 60}" height="40" rx="10" fill="#F4F7E0"/>
      <text x="40" y="16" fill="#1c1814" font-size="11">Setup took forever</text>
      <text x="40" y="30" fill="#8a8278" font-size="10">G2 · cite</text>
    </g>
    <g class="node n2" transform="translate(${px} ${BODY_Y + 180})">
      <circle cx="10" cy="16" r="5" fill="#C8E832"/>
      <rect x="28" y="0" width="${PANEL_W - 60}" height="40" rx="10" fill="#F4F7E0"/>
      <text x="40" y="16" fill="#1c1814" font-size="11">Docs assume enterprise SSO</text>
      <text x="40" y="30" fill="#8a8278" font-size="10">Reddit · cite</text>
    </g>
    <g class="node n3" transform="translate(${px} ${BODY_Y + 232})">
      <circle cx="10" cy="16" r="5" fill="#94B316"/>
      <rect x="28" y="0" width="${PANEL_W - 60}" height="40" rx="10" fill="#F4F7E0"/>
      <text x="40" y="16" fill="#1c1814" font-size="11">No guided first project</text>
      <text x="40" y="30" fill="#8a8278" font-size="10">Blog · cite</text>
    </g>
    <g transform="translate(${px} ${BODY_Y + 290})">
      <rect width="${PANEL_W - 32}" height="52" rx="12" fill="#f5f2ef" stroke="#94B316" stroke-opacity="0.35"/>
      <text x="14" y="22" fill="#1c1814" font-size="12" font-weight="600">Outline ready</text>
      <text x="14" y="40" fill="#6b6258" font-size="11">3 themes · 11 sources</text>
    </g>
${composer()}
${closeChrome()}`;
    })(),
  },

  "04-morning-briefing": {
    aria: "Monday morning briefing on Pane home from a scheduled weekday run",
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
      const mx = WX + 28;
      const my = BODY_Y + 28;
      const px = PANEL_X + 16;
      return `
${chrome("pane://home")}
    <rect x="${WX}" y="${BODY_Y}" width="${MAIN_W}" height="${WH - BAR}" fill="#faf9f7"/>
    <text x="${mx}" y="${my + 8}" fill="#1c1814" font-size="22" font-weight="600" letter-spacing="-0.02em">Good morning</text>
    <text x="${mx}" y="${my + 32}" fill="#6b6258" font-size="13">Monday briefing · from your week in tabs</text>

    ${card(mx, my + 56, MAIN_W - 56, 64, "url(#accent)")}
    <text x="${mx + 20}" y="${my + 84}" fill="#1c1814" font-size="14" font-weight="600">3 decisions from last week’s calls</text>
    <text x="${mx + 20}" y="${my + 104}" fill="#6b6258" font-size="12">Pricing, SLA, Friday ship — ready to paste</text>

    ${card(mx, my + 136, MAIN_W - 56, 64, "#5fb872")}
    <text x="${mx + 20}" y="${my + 164}" fill="#1c1814" font-size="14" font-weight="600">Investor update draft</text>
    <text x="${mx + 20}" y="${my + 184}" fill="#6b6258" font-size="12">Built from meetings + shipped PRs</text>

    ${card(mx, my + 216, MAIN_W - 56, 64, "#6f9fe0")}
    <text x="${mx + 20}" y="${my + 244}" fill="#1c1814" font-size="14" font-weight="600">2 follow-ups due today</text>
    <text x="${mx + 20}" y="${my + 264}" fill="#6b6258" font-size="12">Legal review · customer intro</text>

${panelHeader("Scheduled")}
    <g transform="translate(${px} ${BODY_Y + 60})">
      <rect class="live" width="${PANEL_W - 32}" height="92" rx="12" fill="#f5f2ef" stroke="#94B316" stroke-width="1.5"/>
      <circle class="dot" cx="22" cy="28" r="4" fill="#94B316"/>
      <text x="36" y="32" fill="#1c1814" font-size="13" font-weight="600">Morning briefing</text>
      <text x="16" y="56" fill="#6b6258" font-size="12">Every weekday · 8:00 AM</text>
      <text x="16" y="76" fill="#8a8278" font-size="11">Last run · 2 min ago</text>
    </g>
    <g transform="translate(${px} ${BODY_Y + 172})">
      <rect width="${PANEL_W - 32}" height="56" rx="12" fill="#ffffff"/>
      <text x="16" y="24" fill="#4a433c" font-size="12">Competitor scan</text>
      <text x="16" y="42" fill="#8a8278" font-size="11">Fridays · 4:00 PM</text>
    </g>
    <g transform="translate(${px} ${BODY_Y + 244})">
      <rect width="${PANEL_W - 32}" height="56" rx="12" fill="#ffffff"/>
      <text x="16" y="24" fill="#4a433c" font-size="12">Inbox triage</text>
      <text x="16" y="42" fill="#8a8278" font-size="11">Daily · 9:30 AM</text>
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
      const mx = WX + 28;
      const my = BODY_Y + 24;
      const px = PANEL_X + 16;
      return `
${chrome("localhost:3000/checkout")}
    <rect x="${WX}" y="${BODY_Y}" width="${MAIN_W}" height="${WH - BAR}" fill="#faf9f7"/>
    <rect class="glow" x="${mx}" y="${my}" width="${MAIN_W - 56}" height="220" rx="12" fill="#ffffff" stroke="#94B316" stroke-width="1.5"/>
    <text x="${mx + 20}" y="${my + 32}" fill="#1c1814" font-size="16" font-weight="600">Checkout</text>
    <rect x="${mx + 20}" y="${my + 52}" width="220" height="34" rx="8" fill="#ffffff" stroke="#1c1814" stroke-opacity="0.06"/>
    <text x="${mx + 34}" y="${my + 74}" fill="#6b6258" font-size="12">Card number</text>
    <rect x="${mx + 20}" y="${my + 98}" width="100" height="34" rx="8" fill="#ffffff"/>
    <rect x="${mx + 132}" y="${my + 98}" width="100" height="34" rx="8" fill="#ffffff"/>
    <rect x="${mx + 20}" y="${my + 150}" width="132" height="38" rx="10" fill="url(#accent)"/>
    <text x="${mx + 86}" y="${my + 174}" text-anchor="middle" fill="#2a1606" font-size="13" font-weight="600">Pay now</text>
    <text x="${mx + 180}" y="${my + 172}" fill="#c44a3a" font-size="11">TypeError · line 84</text>

    <rect x="${mx}" y="${my + 240}" width="${MAIN_W - 56}" height="120" rx="12" fill="#1c1814"/>
    <text x="${mx + 18}" y="${my + 268}" fill="#5fb872" font-size="11">~/acme-web · cowork folder granted</text>
    <text x="${mx + 18}" y="${my + 294}" fill="#8a8278" font-size="12">$ </text>
    <text x="${mx + 30}" y="${my + 294}" fill="#f3efe9" font-size="12">wrote src/checkout/validate.ts</text>
    <rect class="caret" x="${mx + 248}" y="${my + 283}" width="7" height="14" fill="#94B316"/>
    <rect x="${mx + 18}" y="${my + 312}" width="200" height="28" rx="8" fill="#2a241f" stroke="#5fb872" stroke-opacity="0.45"/>
    <text x="${mx + 32}" y="${my + 330}" fill="#8dcea0" font-size="11">validate.ts updated</text>

${panelHeader("Cowork")}
    <g transform="translate(${px} ${BODY_Y + 60})">
      <rect width="${PANEL_W - 32}" height="32" rx="8" fill="#ffffff"/>
      <text x="12" y="21" fill="#6b6258" font-size="11">click · Pay now</text>
    </g>
    <g transform="translate(${px} ${BODY_Y + 102})">
      <rect width="${PANEL_W - 32}" height="32" rx="8" fill="#ffffff"/>
      <text x="12" y="21" fill="#6b6258" font-size="11">read console · TypeError:84</text>
    </g>
    <g transform="translate(${px} ${BODY_Y + 144})">
      <rect width="${PANEL_W - 32}" height="32" rx="8" fill="#ffffff"/>
      <text x="12" y="21" fill="#6b6258" font-size="11">cowork write · validate.ts</text>
    </g>
    <g transform="translate(${px} ${BODY_Y + 196})">
      <rect width="${PANEL_W - 32}" height="100" rx="12" fill="#F4F7E0"/>
      <text x="14" y="26" fill="#1c1814" font-size="12" font-weight="600">Fix ready for review</text>
      <text x="14" y="48" fill="#6b6258" font-size="11">Null guard on card brand</text>
      <text x="14" y="66" fill="#6b6258" font-size="11">before submit.</text>
      <text x="14" y="88" fill="#8a8278" font-size="10.5">Same session · tabs + files</text>
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
      const mx = WX + 28;
      const my = BODY_Y + 28;
      const px = PANEL_X + 16;
      return `
${chrome("pane://skills/staged")}
    <rect x="${WX}" y="${BODY_Y}" width="${MAIN_W}" height="${WH - BAR}" fill="#faf9f7"/>
    <text x="${mx}" y="${my + 8}" fill="#1c1814" font-size="18" font-weight="600">Weekly metrics ritual</text>
    <text x="${mx}" y="${my + 32}" fill="#6b6258" font-size="13">You’ve done this 3 times this month</text>

    <g transform="translate(${mx} ${my + 60})">
      <rect class="step-accent" width="${MAIN_W - 56}" height="56" rx="12" fill="#ffffff" stroke="#94B316" stroke-width="1.2"/>
      <circle cx="28" cy="28" r="14" fill="#e6e1db"/>
      <text x="28" y="33" text-anchor="middle" fill="#C8E832" font-size="13" font-weight="600">1</text>
      <text x="56" y="33" fill="#1c1814" font-size="14">Pull dashboard metrics</text>
    </g>
    <g transform="translate(${mx} ${my + 132})">
      <rect width="${MAIN_W - 56}" height="56" rx="12" fill="#ffffff"/>
      <circle cx="28" cy="28" r="14" fill="#e6e1db"/>
      <text x="28" y="33" text-anchor="middle" fill="#6b6258" font-size="13" font-weight="600">2</text>
      <text x="56" y="33" fill="#1c1814" font-size="14">Paste into the Notion doc</text>
    </g>
    <g transform="translate(${mx} ${my + 204})">
      <rect width="${MAIN_W - 56}" height="56" rx="12" fill="#ffffff"/>
      <circle cx="28" cy="28" r="14" fill="#e6e1db"/>
      <text x="28" y="33" text-anchor="middle" fill="#6b6258" font-size="13" font-weight="600">3</text>
      <text x="56" y="33" fill="#1c1814" font-size="14">Ping #growth on Slack</text>
    </g>
    <text x="${mx}" y="${my + 300}" fill="#6b6258" font-size="12">Pane noticed the pattern — skill staged for you.</text>

${panelHeader("Skills")}
    <g transform="translate(${px} ${BODY_Y + 60})">
      <rect width="${PANEL_W - 32}" height="240" rx="14" fill="#F4F7E0" stroke="#94B316" stroke-opacity="0.35"/>
      <text x="16" y="32" fill="#1c1814" font-size="13" font-weight="600">Weekly metrics → Notion</text>
      <text x="16" y="54" fill="#6b6258" font-size="11">Written from your last 3 runs</text>
      <rect x="16" y="76" width="220" height="7" rx="3.5" fill="#e6e1db"/>
      <rect x="16" y="94" width="180" height="7" rx="3.5" fill="#e6e1db"/>
      <rect x="16" y="112" width="200" height="7" rx="3.5" fill="#e6e1db"/>
      <text x="16" y="148" fill="#8a8278" font-size="11">Runs only after you approve</text>
      <g class="approve" transform="translate(16 172)">
        <rect width="112" height="36" rx="10" fill="url(#accent)"/>
        <text x="56" y="23" text-anchor="middle" fill="#2a1606" font-size="12" font-weight="600">Approve</text>
      </g>
      <g transform="translate(140 172)">
        <rect width="92" height="36" rx="10" fill="#f5f2ef" stroke="#1c1814" stroke-opacity="0.08"/>
        <text x="46" y="23" text-anchor="middle" fill="#6b6258" font-size="12">Dismiss</text>
      </g>
    </g>
${composer()}
${closeChrome()}`;
    })(),
  },

  "07-profiles": {
    aria: "Chrome profiles keep Work, Job hunt, and Personal separate",
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
    0%,26% { fill: #2a1606; }
    34%,100% { fill: #6b6258; }
  }
  @keyframes lab2 {
    0%,32% { fill: #6b6258; }
    38%,60% { fill: #2a1606; }
    68%,100% { fill: #6b6258; }
  }
  @keyframes lab3 {
    0%,66% { fill: #6b6258; }
    72%,94% { fill: #2a1606; }
    100% { fill: #6b6258; }
  }
`,
    body: (() => {
      const mx = WX + 28;
      const my = BODY_Y + 28;
      // Full-width scene — profiles segregate workstreams today
      return `
  <g filter="url(#shadow)">
    <rect x="${WX}" y="${WY}" width="${WW}" height="${WH}" rx="16" fill="#ffffff"/>
  </g>
  <g clip-path="url(#win)">
    <rect x="${WX}" y="${WY}" width="${WW}" height="${WH}" fill="#ffffff"/>
    <rect x="${WX}" y="${WY}" width="${WW}" height="${BAR}" fill="#f5f2ef"/>
    <line x1="${WX}" y1="${BODY_Y}" x2="${WX + WW}" y2="${BODY_Y}" stroke="#1c1814" stroke-opacity="0.05"/>
    <circle cx="${WX + 22}" cy="${WY + 20}" r="5" fill="#ff5f57"/>
    <circle cx="${WX + 40}" cy="${WY + 20}" r="5" fill="#febc2e"/>
    <circle cx="${WX + 58}" cy="${WY + 20}" r="5" fill="#28c840"/>
    <rect x="${WX + 168}" y="${WY + 8}" width="520" height="24" rx="12" fill="#faf9f7" stroke="#1c1814" stroke-opacity="0.05"/>
    <text x="${WX + 184}" y="${WY + 24}" fill="#7a7268" font-size="12">pane://home</text>

    <rect x="${WX}" y="${BODY_Y}" width="${WW}" height="${WH - BAR}" fill="#faf9f7"/>
    <text x="${mx}" y="${my + 8}" fill="#1c1814" font-size="20" font-weight="600" letter-spacing="-0.02em">Same browser. Separate lives.</text>
    <text x="${mx}" y="${my + 32}" fill="#6b6258" font-size="13">Chrome profiles keep memory, skills, and home scoped</text>

    <!-- segmented control -->
    <g transform="translate(${mx} ${my + 60})">
      <rect width="348" height="40" rx="20" fill="#f5f2ef"/>
      <rect class="slider" x="4" y="4" width="104" height="32" rx="16" fill="url(#accent)"/>
      <text class="t1" x="56" y="25" text-anchor="middle" font-size="12" font-weight="600">Work</text>
      <text class="t2" x="168" y="25" text-anchor="middle" font-size="12" font-weight="600">Job hunt</text>
      <text class="t3" x="286" y="25" text-anchor="middle" font-size="12" font-weight="600">Personal</text>
    </g>

    <!-- stacked content panels -->
    <g class="p1" transform="translate(${mx} ${my + 128})">
      <rect width="400" height="80" rx="12" fill="#ffffff" stroke="#1c1814" stroke-opacity="0.05"/>
      <text x="20" y="34" fill="#1c1814" font-size="14" font-weight="600">Investor update · Q2 narrative</text>
      <text x="20" y="56" fill="#6b6258" font-size="12">From vendor call + shipped PRs</text>
      <rect x="420" y="0" width="400" height="80" rx="12" fill="#ffffff"/>
      <text x="440" y="34" fill="#1c1814" font-size="14" font-weight="600">Pricing decision log</text>
      <text x="440" y="56" fill="#6b6258" font-size="12">Annual plan · SLA flagged</text>
    </g>
    <g class="p2" transform="translate(${mx} ${my + 128})">
      <rect width="400" height="80" rx="12" fill="#ffffff" stroke="#1c1814" stroke-opacity="0.05"/>
      <text x="20" y="34" fill="#1c1814" font-size="14" font-weight="600">Acme PM · fit 86%</text>
      <text x="20" y="56" fill="#6b6258" font-size="12">Follow up Friday · draft ready</text>
      <rect x="420" y="0" width="400" height="80" rx="12" fill="#ffffff"/>
      <text x="440" y="34" fill="#1c1814" font-size="14" font-weight="600">Interview prep · systems</text>
      <text x="440" y="56" fill="#6b6258" font-size="12">From pages you already read</text>
    </g>
    <g class="p3" transform="translate(${mx} ${my + 128})">
      <rect width="400" height="80" rx="12" fill="#ffffff" stroke="#1c1814" stroke-opacity="0.05"/>
      <text x="20" y="34" fill="#1c1814" font-size="14" font-weight="600">Lisbon trip · restaurant shortlist</text>
      <text x="20" y="56" fill="#6b6258" font-size="12">Threaded from travel tabs</text>
      <rect x="420" y="0" width="400" height="80" rx="12" fill="#ffffff"/>
      <text x="440" y="34" fill="#1c1814" font-size="14" font-weight="600">Family calendar nudge</text>
      <text x="440" y="56" fill="#6b6258" font-size="12">Weekend plans · not in Work</text>
    </g>

    <g transform="translate(${mx} ${my + 240})">
      <rect width="820" height="72" rx="12" fill="#f5f2ef" stroke="#94B316" stroke-opacity="0.3"/>
      <text x="24" y="30" fill="#1c1814" font-size="14" font-weight="600">Switch the profile — each keeps its own memory</text>
      <text x="24" y="52" fill="#6b6258" font-size="12">Work never sees interview prep. Personal never sees investor notes.</text>
    </g>
  </g>`;
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
      return `
  <g filter="url(#shadow)">
    <rect x="${WX}" y="${WY}" width="${WW}" height="${WH}" rx="16" fill="#ffffff"/>
  </g>
  <g clip-path="url(#win)">
    <rect x="${WX}" y="${WY}" width="${WW}" height="${WH}" fill="#ffffff"/>
    <rect x="${WX}" y="${WY}" width="${WW}" height="${BAR}" fill="#f5f2ef"/>
    <line x1="${WX}" y1="${BODY_Y}" x2="${WX + WW}" y2="${BODY_Y}" stroke="#1c1814" stroke-opacity="0.05"/>
    <circle cx="${WX + 22}" cy="${WY + 20}" r="5" fill="#ff5f57"/>
    <circle cx="${WX + 40}" cy="${WY + 20}" r="5" fill="#febc2e"/>
    <circle cx="${WX + 58}" cy="${WY + 20}" r="5" fill="#28c840"/>
    <rect x="${WX + 168}" y="${WY + 8}" width="520" height="24" rx="12" fill="#faf9f7" stroke="#1c1814" stroke-opacity="0.05"/>
    <text x="${WX + 184}" y="${WY + 24}" fill="#7a7268" font-size="12">pane · MCP session</text>

    <!-- left: terminal -->
    <rect x="${WX}" y="${BODY_Y}" width="400" height="${WH - BAR}" fill="#1c1814"/>
    <text x="${WX + 24}" y="${BODY_Y + 36}" fill="#a89a8c" font-size="12">claude · connected to Pane MCP</text>
    <text x="${WX + 24}" y="${BODY_Y + 72}" fill="#5fb872" font-size="12">$</text>
    <text x="${WX + 40}" y="${BODY_Y + 72}" fill="#f3efe9" font-size="12">list_tabs</text>
    <text x="${WX + 24}" y="${BODY_Y + 96}" fill="#8a8278" font-size="11">→ 4 tabs · active: docs.acme.dev</text>
    <text x="${WX + 24}" y="${BODY_Y + 128}" fill="#5fb872" font-size="12">$</text>
    <text x="${WX + 40}" y="${BODY_Y + 128}" fill="#f3efe9" font-size="12">navigate /api/auth#oauth</text>
    <text x="${WX + 24}" y="${BODY_Y + 152}" fill="#8a8278" font-size="11">→ ok · scrolled to OAuth</text>
    <text x="${WX + 24}" y="${BODY_Y + 184}" fill="#5fb872" font-size="12">$</text>
    <text x="${WX + 40}" y="${BODY_Y + 184}" fill="#f3efe9" font-size="12">extract_text pre.code</text>

    <g transform="translate(${WX + 24} ${BODY_Y + 216})">
      <rect width="352" height="120" rx="12" fill="#2a241f" stroke="#94B316" stroke-opacity="0.45"/>
      <text x="16" y="28" fill="#f3efe9" font-size="12" font-weight="600">Extracted into context</text>
      <text x="16" y="54" fill="#c2b4a4" font-size="12">POST /oauth/token</text>
      <text x="16" y="76" fill="#c2b4a4" font-size="12">grant_type=authorization_code</text>
      <text x="16" y="100" fill="#8a8278" font-size="11">Real browser · your logins · local</text>
    </g>

    <!-- beam -->
    <path class="beam" d="M${WX + 400} ${BODY_Y + 200} H${WX + 480}" fill="none" stroke="#94B316" stroke-width="2" stroke-opacity="0.7"/>
    <circle class="pulse" cx="${mid}" cy="${BODY_Y + 200}" r="5" fill="#C8E832"/>

    <!-- right: browser tabs -->
    <rect x="${WX + 480}" y="${BODY_Y}" width="400" height="${WH - BAR}" fill="#f3f0ec"/>
    <text x="${WX + 504}" y="${BODY_Y + 36}" fill="#3d3731" font-size="13" font-weight="600">Pane window</text>
    <text x="${WX + 504}" y="${BODY_Y + 56}" fill="#8a8278" font-size="11">Driven by your coding agent</text>

    <rect class="active-tab" x="${WX + 504}" y="${BODY_Y + 84}" width="352" height="48" rx="10" fill="#ffffff" stroke="#94B316" stroke-width="1.5"/>
    <text x="${WX + 524}" y="${BODY_Y + 113}" fill="#1c1814" font-size="12">docs.acme.dev/api/auth</text>

    <rect x="${WX + 504}" y="${BODY_Y + 148}" width="352" height="48" rx="10" fill="#f5f2ef"/>
    <text x="${WX + 524}" y="${BODY_Y + 177}" fill="#6b6258" font-size="12">github.com/acme/web</text>
    <rect x="${WX + 504}" y="${BODY_Y + 212}" width="352" height="48" rx="10" fill="#f5f2ef"/>
    <text x="${WX + 524}" y="${BODY_Y + 241}" fill="#6b6258" font-size="12">localhost:3000</text>

    <g transform="translate(${WX + 504} ${BODY_Y + 292})">
      <rect width="352" height="64" rx="12" fill="#F4F7E0"/>
      <text x="16" y="28" fill="#1c1814" font-size="13" font-weight="600">Pane as MCP</text>
      <text x="16" y="48" fill="#6b6258" font-size="11">Claude Code · Cursor · Gemini CLI</text>
    </g>
  </g>`;
    })(),
  },
};

for (const [slug, scene] of Object.entries(scenes)) {
  const svg = wrap(scene.aria, scene.css, scene.body);
  const path = join(__dirname, `${slug}.svg`);
  writeFileSync(path, svg, "utf8");
  console.log("wrote", path);
}
