// Illustrations for the demo library, drawn as SVG so the README screenshots never ship
// anyone else's photos. Rendered to PNG by capture.mjs (Playwright) before seeding.

const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

const grain = `<filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .07 0"/></filter><rect width="100%" height="100%" filter="url(#g)"/>`;

export const IMAGES = {
  // Product: a red lounge chair (colour search: "red chair").
  chair: svg(
    800,
    800,
    `<rect width="800" height="800" fill="#efe7dc"/>
     <rect y="560" width="800" height="240" fill="#e2d6c6"/>
     <ellipse cx="410" cy="640" rx="250" ry="28" fill="#cdbba6"/>
     <path d="M250 300 Q250 220 330 220 L500 220 Q580 220 580 300 L580 470 L250 470 Z" fill="#c8372d"/>
     <path d="M210 420 Q210 380 250 380 L580 380 Q620 380 620 420 L620 520 Q620 550 590 550 L240 550 Q210 550 210 520 Z" fill="#d9443a"/>
     <rect x="250" y="440" width="330" height="60" rx="18" fill="#b52f26"/>
     <path d="M260 550 L240 640" stroke="#3a2a20" stroke-width="12" stroke-linecap="round"/>
     <path d="M570 550 L590 640" stroke="#3a2a20" stroke-width="12" stroke-linecap="round"/>
     <path d="M330 550 L322 625" stroke="#3a2a20" stroke-width="10" stroke-linecap="round"/>
     <path d="M500 550 L508 625" stroke="#3a2a20" stroke-width="10" stroke-linecap="round"/>
     <rect x="640" y="250" width="16" height="330" fill="#3a2a20"/>
     <path d="M600 250 L700 250 L680 190 L620 190 Z" fill="#f2c14e"/>
     ${grain}`,
  ),
  // Product: a teal ceramic mug.
  mug: svg(
    800,
    800,
    `<rect width="800" height="800" fill="#dfe8e6"/>
     <ellipse cx="400" cy="600" rx="190" ry="26" fill="#c3d2cf"/>
     <path d="M560 360 Q660 360 660 450 Q660 540 560 540" fill="none" stroke="#2f7f7a" stroke-width="34"/>
     <path d="M240 280 L560 280 L545 580 Q540 610 510 610 L290 610 Q260 610 255 580 Z" fill="#2f7f7a"/>
     <ellipse cx="400" cy="280" rx="160" ry="30" fill="#3b958f"/>
     <ellipse cx="400" cy="284" rx="140" ry="22" fill="#5a3a26"/>
     <path d="M250 330 L550 330" stroke="#276b67" stroke-width="6"/>
     <path d="M360 200 Q340 160 370 130 Q400 100 380 60" fill="none" stroke="#ffffff" stroke-opacity=".6" stroke-width="8" stroke-linecap="round"/>
     <path d="M430 210 Q410 170 440 140" fill="none" stroke="#ffffff" stroke-opacity=".5" stroke-width="8" stroke-linecap="round"/>
     ${grain}`,
  ),
  // Product: a yellow desk lamp.
  lamp: svg(
    800,
    800,
    `<rect width="800" height="800" fill="#2b2d33"/>
     <path d="M470 330 L760 800 L180 800 Z" fill="#f6d365" fill-opacity=".12"/>
     <rect x="260" y="640" width="260" height="36" rx="18" fill="#f2b705"/>
     <path d="M390 640 L330 420 L500 260" fill="none" stroke="#f2b705" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>
     <circle cx="330" cy="420" r="20" fill="#d99e00"/>
     <path d="M440 200 L600 250 L560 360 L420 290 Z" fill="#f2b705"/>
     <ellipse cx="582" cy="306" rx="30" ry="58" transform="rotate(-62 582 306)" fill="#fff3c4"/>
     ${grain}`,
  ),
  // Recipe: tomato pasta from above.
  pasta: svg(
    800,
    600,
    `<rect width="800" height="600" fill="#d8cbb8"/>
     <rect x="0" y="0" width="800" height="600" fill="url(#wood)"/>
     <defs><pattern id="wood" width="800" height="40" patternUnits="userSpaceOnUse"><rect width="800" height="40" fill="#cdb89c"/><path d="M0 20 Q200 10 400 22 T800 18" stroke="#bea583" stroke-width="3" fill="none"/></pattern></defs>
     <circle cx="400" cy="300" r="230" fill="#f7f4ee"/>
     <circle cx="400" cy="300" r="190" fill="#ece6db"/>
     ${Array.from({ length: 18 }, (_, i) => {
       const a = (i / 18) * Math.PI * 2;
       const r = 60 + (i % 5) * 18;
       return `<path d="M${400 + Math.cos(a) * r} ${300 + Math.sin(a) * r} q40 -30 80 0 t80 0" transform="rotate(${i * 23} ${400} ${300})" stroke="#e9c46a" stroke-width="12" fill="none" stroke-linecap="round"/>`;
     }).join("")}
     <circle cx="360" cy="280" r="46" fill="#d1495b" opacity=".9"/>
     <circle cx="450" cy="330" r="38" fill="#c0392b" opacity=".9"/>
     <circle cx="420" cy="250" r="26" fill="#d1495b" opacity=".85"/>
     <path d="M380 330 q20 -30 45 -10 q-15 25 -45 10z" fill="#3a7d44"/>
     <path d="M440 270 q25 -20 40 5 q-20 15 -40 -5z" fill="#4a9a52"/>
     <rect x="650" y="80" width="18" height="300" rx="9" fill="#b0b5bb" transform="rotate(18 659 230)"/>
     ${grain}`,
  ),
  // Recipe: lemon tart.
  tart: svg(
    800,
    600,
    `<rect width="800" height="600" fill="#f3efe6"/>
     <circle cx="400" cy="300" r="220" fill="#e7dfcf"/>
     <circle cx="400" cy="300" r="190" fill="#d9a55b"/>
     <circle cx="400" cy="300" r="165" fill="#f4d35e"/>
     <circle cx="400" cy="300" r="165" fill="url(#shine)"/>
     <defs><radialGradient id="shine" cx=".35" cy=".35"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
     <circle cx="660" cy="130" r="56" fill="#f6e05e"/>
     <circle cx="660" cy="130" r="44" fill="#faf089"/>
     ${Array.from({ length: 8 }, (_, i) => `<path d="M660 130 L${660 + Math.cos((i * Math.PI) / 4) * 44} ${130 + Math.sin((i * Math.PI) / 4) * 44}" stroke="#f6e05e" stroke-width="3"/>`).join("")}
     <path d="M120 470 q30 -40 70 -10 q-30 40 -70 10z" fill="#6a994e"/>
     ${grain}`,
  ),
  // Book cover.
  bookQuiet: svg(
    600,
    900,
    `<rect width="600" height="900" fill="#1f3a5f"/>
     <circle cx="300" cy="380" r="170" fill="#f4a261"/>
     <rect y="470" width="600" height="430" fill="#16304f"/>
     ${Array.from({ length: 9 }, (_, i) => `<rect x="${60 + i * 56}" y="${500 + (i % 3) * 14}" width="30" height="${320 - (i % 4) * 30}" fill="#244a75"/>`).join("")}
     <text x="300" y="130" text-anchor="middle" font-family="Georgia, serif" font-size="62" fill="#f1faee">The Quiet</text>
     <text x="300" y="200" text-anchor="middle" font-family="Georgia, serif" font-size="62" fill="#f1faee">Internet</text>
     <text x="300" y="840" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="24" letter-spacing="6" fill="#a8dadc">MARA LINDQVIST</text>
     ${grain}`,
  ),
  bookTools: svg(
    600,
    900,
    `<rect width="600" height="900" fill="#f1e3c8"/>
     <rect x="60" y="60" width="480" height="780" fill="none" stroke="#2d2a26" stroke-width="3"/>
     <circle cx="220" cy="430" r="90" fill="#e76f51"/>
     <rect x="260" y="360" width="150" height="150" fill="#2a9d8f"/>
     <path d="M300 560 L420 560 L360 460 Z" fill="#264653"/>
     <text x="300" y="190" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="74" fill="#2d2a26">SMALL</text>
     <text x="300" y="265" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="74" fill="#2d2a26">TOOLS</text>
     <text x="300" y="760" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="28" fill="#2d2a26">on making software by hand</text>
     ${grain}`,
  ),
  // Film poster.
  poster: svg(
    600,
    900,
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1026"/><stop offset=".6" stop-color="#1b2a4a"/><stop offset="1" stop-color="#27425e"/></linearGradient>
     <linearGradient id="au" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#43e97b" stop-opacity="0"/><stop offset=".5" stop-color="#38f9d7" stop-opacity=".75"/><stop offset="1" stop-color="#a18cd1" stop-opacity="0"/></linearGradient></defs>
     <rect width="600" height="900" fill="url(#sky)"/>
     <path d="M-50 330 Q150 180 300 300 T650 250 L650 330 Q450 360 300 380 T-50 420 Z" fill="url(#au)"/>
     <path d="M-50 260 Q200 120 350 240 T650 170 L650 220 Q450 260 330 290 T-50 320 Z" fill="url(#au)" opacity=".6"/>
     ${Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 137) % 600}" cy="${(i * 71) % 260}" r="${1 + (i % 3) * 0.6}" fill="#fff" opacity=".8"/>`).join("")}
     <path d="M0 700 L120 600 L200 660 L320 540 L430 650 L520 590 L600 640 L600 900 L0 900 Z" fill="#0a1422"/>
     <text x="300" y="780" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="54" letter-spacing="8" fill="#e8f1ff">NORTHERN</text>
     <text x="300" y="840" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="30" letter-spacing="18" fill="#9fb8d9">LIGHTS</text>`,
  ),
  // Photo: mountains at sunset.
  mountains: svg(
    1200,
    800,
    `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6a192"/><stop offset=".55" stop-color="#f9c58d"/><stop offset="1" stop-color="#fbe3b5"/></linearGradient></defs>
     <rect width="1200" height="800" fill="url(#s)"/>
     <circle cx="820" cy="360" r="90" fill="#fff4d6"/>
     <path d="M0 520 L220 300 L380 460 L560 250 L760 470 L920 330 L1200 540 L1200 800 L0 800 Z" fill="#8e6c8a"/>
     <path d="M560 250 L610 300 L585 310 L560 290 L535 312 L510 300 Z" fill="#f7eee8"/>
     <path d="M0 610 L260 470 L480 590 L700 450 L960 600 L1200 500 L1200 800 L0 800 Z" fill="#5f4b6b"/>
     <path d="M0 700 L300 610 L600 690 L900 620 L1200 700 L1200 800 L0 800 Z" fill="#3a3150"/>
     ${grain}`,
  ),
  // Photo: a red gate at dusk (travel).
  gate: svg(
    1000,
    1250,
    `<defs><linearGradient id="d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2e3a59"/><stop offset=".7" stop-color="#8e7cc3"/><stop offset="1" stop-color="#f3b391"/></linearGradient></defs>
     <rect width="1000" height="1250" fill="url(#d)"/>
     <path d="M120 330 Q500 280 880 330 L880 380 Q500 335 120 380 Z" fill="#c1272d"/>
     <rect x="170" y="440" width="660" height="40" fill="#c1272d"/>
     <rect x="240" y="360" width="60" height="820" fill="#b0222a"/>
     <rect x="700" y="360" width="60" height="820" fill="#b0222a"/>
     <rect x="470" y="380" width="60" height="60" fill="#2d2d2d"/>
     <rect x="0" y="1150" width="1000" height="100" fill="#3b3a47"/>
     <circle cx="820" cy="170" r="40" fill="#fdf1d6" opacity=".85"/>
     ${grain}`,
  ),
  // Article hero: local-first.
  heroLocal: svg(
    1200,
    630,
    `<rect width="1200" height="630" fill="#101418"/>
     ${Array.from({ length: 12 }, (_, r) => Array.from({ length: 20 }, (_, c) => `<circle cx="${60 + c * 57}" cy="${40 + r * 50}" r="${(r + c) % 7 === 0 ? 7 : 2.4}" fill="${(r + c) % 7 === 0 ? "#7c9cff" : "#2c3440"}"/>`).join("")).join("")}
     <rect x="470" y="200" width="260" height="230" rx="28" fill="#7c9cff"/>
     <rect x="505" y="240" width="190" height="24" rx="12" fill="#101418" opacity=".85"/>
     <rect x="505" y="285" width="140" height="24" rx="12" fill="#101418" opacity=".6"/>
     <rect x="505" y="330" width="170" height="24" rx="12" fill="#101418" opacity=".4"/>`,
  ),
  // Article hero: calm interfaces.
  heroCalm: svg(
    1200,
    630,
    `<rect width="1200" height="630" fill="#e9edf2"/>
     <circle cx="300" cy="330" r="220" fill="#b8c7dc"/>
     <circle cx="520" cy="300" r="170" fill="#d7c4e6" opacity=".9"/>
     <circle cx="760" cy="350" r="240" fill="#f2d0c4" opacity=".85"/>
     <circle cx="980" cy="260" r="120" fill="#c9e4d6" opacity=".9"/>
     ${grain}`,
  ),
  // Screenshot: a terminal.
  terminal: svg(
    1200,
    760,
    `<rect width="1200" height="760" rx="18" fill="#1d1f24"/>
     <rect width="1200" height="48" rx="18" fill="#2a2d33"/><rect y="30" width="1200" height="18" fill="#2a2d33"/>
     <circle cx="30" cy="24" r="8" fill="#ff5f57"/><circle cx="56" cy="24" r="8" fill="#febc2e"/><circle cx="82" cy="24" r="8" fill="#28c840"/>
     <g font-family="Menlo, Consolas, monospace" font-size="26">
       <text x="40" y="120" fill="#7ee787">$ <tspan fill="#e6edf3">sqlite3 tymo.db</tspan></text>
       <text x="40" y="170" fill="#8b949e">sqlite&gt; <tspan fill="#e6edf3">SELECT title FROM saves_fts</tspan></text>
       <text x="40" y="210" fill="#8b949e">   ...&gt; <tspan fill="#e6edf3">WHERE saves_fts MATCH 'local first'</tspan></text>
       <text x="40" y="250" fill="#8b949e">   ...&gt; <tspan fill="#e6edf3">ORDER BY rank LIMIT 3;</tspan></text>
       <text x="40" y="310" fill="#79c0ff">Local-first software, five years on</text>
       <text x="40" y="350" fill="#79c0ff">SQLite is a great application file format</text>
       <text x="40" y="390" fill="#79c0ff">Offline-first sync without the server</text>
       <text x="40" y="450" fill="#8b949e">Run Time: real 0.002</text>
       <text x="40" y="510" fill="#8b949e">sqlite&gt; <tspan fill="#e6edf3">▍</tspan></text>
     </g>`,
  ),
  // Design moodboard.
  palette: svg(
    900,
    900,
    `<rect width="900" height="900" fill="#faf7f2"/>
     <rect x="60" y="60" width="370" height="480" rx="10" fill="#264653"/>
     <rect x="470" y="60" width="370" height="230" rx="10" fill="#e9c46a"/>
     <rect x="470" y="310" width="175" height="230" rx="10" fill="#f4a261"/>
     <rect x="665" y="310" width="175" height="230" rx="10" fill="#e76f51"/>
     <rect x="60" y="580" width="780" height="260" rx="10" fill="#2a9d8f"/>
     <text x="90" y="800" font-family="Helvetica, Arial, sans-serif" font-size="30" fill="#faf7f2">Aa — Terracotta / Sea / Sand</text>
     ${grain}`,
  ),
};
