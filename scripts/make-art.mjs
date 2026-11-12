// Generates the README art from the same block-character sprite the mod draws.
//   node scripts/make-art.mjs
// Writes assets/clawd-demo.svg (animated band, cycling through every mood)
// and assets/clawd-moods.svg (one card per mood).

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
mkdirSync(join(root, 'assets'), { recursive: true })

// ── Sprite → rectangles ─────────────────────────────────────────────────
// Each terminal cell is split into four quadrants (TL, TR, BL, BR).
const QUAD = {
  ' ': [0, 0, 0, 0], '█': [1, 1, 1, 1], '▀': [1, 1, 0, 0], '▄': [0, 0, 1, 1],
  '▌': [1, 0, 1, 0], '▐': [0, 1, 0, 1], '▘': [1, 0, 0, 0], '▝': [0, 1, 0, 0],
  '▖': [0, 0, 1, 0], '▗': [0, 0, 0, 1], '▛': [1, 1, 1, 0], '▜': [1, 1, 0, 1],
  '▙': [1, 0, 1, 1], '▟': [0, 1, 1, 1],
}

const HEAD = ' ▐▛███▜▌'
const HEAD_SLEEP = ' ▐▄███▄▌'
const BODY = '▝▜█████▛▘'
const BODY_ARMS_UP = '▗▟█████▙▖'
const LEGS = '  ▘▘ ▝▝'
const LEGS_APART = ' ▝▘   ▝▘'

function rects(rows, { x, y, qw, qh, color, dx = 0 }) {
  const out = []
  rows.forEach((row, r) => {
    Array.from(row).forEach((ch, c) => {
      const q = QUAD[ch] ?? [0, 0, 0, 0]
      q.forEach((on, i) => {
        if (!on) return
        const px = x + (c + dx) * qw * 2 + (i % 2) * qw
        const py = y + r * qh * 2 + Math.floor(i / 2) * qh
        out.push(`<rect x="${px}" y="${py}" width="${qw}" height="${qh}"/>`)
      })
    })
  })
  return `<g fill="${color}" shape-rendering="crispEdges">${out.join('')}</g>`
}

// ── Moods ────────────────────────────────────────────────────────────────
const ORANGE = '#D97757'
const MOODS = [
  { id: 'chill', name: 'Chill', range: '0–25%', color: ORANGE, prop: '♪', quip: 'fresh tokens, who dis', five: 12, week: 5, rows: [HEAD, BODY, LEGS] },
  { id: 'working', name: 'Working', range: '25–50%', color: ORANGE, prop: '⌨', quip: "in the zone, don't mind me", five: 38, week: 14, rows: [HEAD, BODY, LEGS] },
  { id: 'sweaty', name: 'Sweaty', range: '50–70%', color: '#eab308', prop: '💦', quip: 'pacing myself... mostly', five: 63, week: 21, rows: [HEAD, BODY, LEGS_APART] },
  { id: 'nervous', name: 'Nervous', range: '70–90%', color: '#ff6a00', prop: '‼', quip: 'maybe smaller prompts?', five: 81, week: 27, rows: [HEAD, BODY, LEGS], shake: 1 },
  { id: 'panic', name: 'Panic', range: '90–100%', color: '#ef4444', prop: '🔥', quip: 'SAVE ME A FEW TOKENS', five: 96, week: 33, rows: [HEAD, BODY, LEGS_APART], shake: 2 },
  { id: 'napping', name: 'Napping', range: '100%', color: '#a78bfa', prop: 'z Z', quip: 'zzz — back at 15:40', five: 100, week: 36, rows: [HEAD_SLEEP, BODY, LEGS] },
  { id: 'party', name: 'Party', range: 'just reset', color: '#ec4899', prop: '🎉', quip: 'limits refreshed!', five: 0, week: 36, rows: [HEAD, BODY_ARMS_UP, LEGS_APART], reset: true },
]

const MONO = `font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"`
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ── Animated demo band ───────────────────────────────────────────────────
function demo() {
  const W = 820, H = 250, STEP = 2.2
  const total = STEP * MOODS.length
  const barX = 250, barW = 250

  const stages = MOODS.map((m, i) => {
    const n = MOODS.length
    // Visible only during its own slot (discrete opacity).
    const keyTimes = [0]
    const values = [i === 0 ? 1 : 0]
    if (i > 0) { keyTimes.push(i / n); values.push(1) }
    if (i < n - 1) { keyTimes.push((i + 1) / n); values.push(0) }
    const show = `<animate attributeName="opacity" dur="${total}s" repeatCount="indefinite" calcMode="discrete" keyTimes="${keyTimes.map(k => k.toFixed(4)).join(';')}" values="${values.join(';')}"/>`

    const sprite = rects(m.rows, { x: 40, y: 78, qw: 8, qh: 14, color: m.color })
    const wiggle = m.shake
      ? `<animateTransform attributeName="transform" type="translate" dur="0.18s" repeatCount="indefinite" values="${-3 * m.shake} 0;${3 * m.shake} 0;${-3 * m.shake} 0"/>`
      : `<animateTransform attributeName="transform" type="translate" dur="1.1s" repeatCount="indefinite" values="0 0;0 -5;0 0"/>`
    const bar = (y, label, pct, tail) => `
      <text x="${barX - 52}" y="${y + 14}" fill="#8b93a7" font-size="15" ${MONO}>${label}</text>
      <rect x="${barX}" y="${y}" width="${barW}" height="18" rx="3" fill="#2b3040"/>
      <rect x="${barX}" y="${y}" width="${(barW * Math.min(pct, 100)) / 100}" height="18" rx="3" fill="${m.color}"/>
      <text x="${barX + barW + 14}" y="${y + 14}" fill="${m.color}" font-size="15" font-weight="700" ${MONO}>${String(pct).padStart(3, ' ')}%</text>
      <text x="${barX + barW + 64}" y="${y + 14}" fill="${tail.startsWith('↻ reset') ? '#ec4899' : '#8b93a7'}" font-size="14" ${MONO}>${esc(tail)}</text>`
    const sparkles = m.reset
      ? `<text x="34" y="70" fill="${m.color}" font-size="16" ${MONO}>✦ · ✧ · ✦ · ✧<animate attributeName="x" dur="0.8s" repeatCount="indefinite" values="30;44;30"/></text>`
      : ''
    const zzz = m.id === 'napping'
      ? `<text x="172" y="96" fill="${m.color}" font-size="18" ${MONO} font-weight="700">z<animate attributeName="y" dur="1.6s" repeatCount="indefinite" values="104;56"/><animate attributeName="opacity" dur="1.6s" repeatCount="indefinite" values="1;0"/></text>`
      : ''

    return `
    <g opacity="${i === 0 ? 1 : 0}">${show}
      <g>${wiggle}${sprite}</g>${sparkles}${zzz}
      ${bar(86, '5h', m.five, m.reset ? '↻ reset ✓' : '↻ 1h 12m · 15:40')}
      ${bar(146, 'week', m.week, '↻ 3d 19h · Mon 06:30')}
      <text x="40" y="214" fill="${m.color}" font-size="17" ${MONO}>${esc(m.prop)}</text>
      <text x="84" y="214" fill="#e6e9f0" font-size="16" font-style="italic" ${MONO}>"${esc(m.quip)}"</text>
      <text x="${W - 30}" y="214" text-anchor="end" fill="${m.color}" font-size="13" font-weight="700" ${MONO}>${m.name.toUpperCase()} · ${m.range}</text>
    </g>`
  }).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Animated preview: Clawd's mood and colour change as the 5-hour and weekly usage bars fill">
  <rect width="${W}" height="${H}" rx="14" fill="#151821"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="none" stroke="#2b3040"/>
  <circle cx="26" cy="24" r="6" fill="#ff5f57"/><circle cx="46" cy="24" r="6" fill="#febc2e"/><circle cx="66" cy="24" r="6" fill="#28c840"/>
  <text x="${W / 2}" y="29" text-anchor="middle" fill="#8b93a7" font-size="13" ${MONO}>claude · clawd-limits</text>
  ${stages}
</svg>
`
}

// ── Mood gallery ─────────────────────────────────────────────────────────
function gallery() {
  const cardW = 190, cardH = 200, gap = 18, perRow = 4
  const rowsN = Math.ceil(MOODS.length / perRow)
  const W = perRow * cardW + (perRow + 1) * gap
  const H = rowsN * cardH + (rowsN + 1) * gap

  const cards = MOODS.map((m, i) => {
    const col = i % perRow, row = Math.floor(i / perRow)
    // Center the last row.
    const inRow = row === rowsN - 1 ? MOODS.length - row * perRow : perRow
    const offset = ((perRow - inRow) * (cardW + gap)) / 2
    const x = gap + col * (cardW + gap) + offset
    const y = gap + row * (cardH + gap)
    const sprite = rects(m.rows, { x: x + 35, y: y + 34, qw: 6, qh: 11, color: m.color })
    return `
  <g>
    <rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="12" fill="#151821" stroke="${m.color}" stroke-opacity="0.55"/>
    ${m.reset ? `<text x="${x + 30}" y="${y + 28}" fill="${m.color}" font-size="13" ${MONO}>✦ · ✧ · ✦ · ✧</text>` : ''}
    ${sprite}
    ${m.shake ? `<text x="${x + 22}" y="${y + 72}" fill="${m.color}" font-size="${14 + m.shake * 4}" ${MONO}>(</text><text x="${x + 146}" y="${y + 72}" fill="${m.color}" font-size="${14 + m.shake * 4}" ${MONO}>)</text>` : ''}    <text x="${x + cardW - 26}" y="${y + 66}" text-anchor="middle" fill="${m.color}" font-size="20" ${MONO}>${esc(m.prop)}</text>
    <text x="${x + cardW / 2}" y="${y + 138}" text-anchor="middle" fill="${m.color}" font-size="17" font-weight="700" ${MONO}>${m.name}</text>
    <text x="${x + cardW / 2}" y="${y + 160}" text-anchor="middle" fill="#8b93a7" font-size="13" ${MONO}>${esc(m.range)}</text>
    <text x="${x + cardW / 2}" y="${y + 182}" text-anchor="middle" fill="#c9cfdb" font-size="11.5" font-style="italic" ${MONO}>"${esc(m.quip)}"</text>
  </g>`
  }).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Clawd's seven moods: chill, working, sweaty, nervous, panic, napping and party">
  ${cards}
</svg>
`
}

writeFileSync(join(root, 'assets', 'clawd-demo.svg'), demo())
writeFileSync(join(root, 'assets', 'clawd-moods.svg'), gallery())
console.log('wrote assets/clawd-demo.svg and assets/clawd-moods.svg')
