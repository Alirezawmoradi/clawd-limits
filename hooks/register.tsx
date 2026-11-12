import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LimitWindow } from '../types'

// ── State ────────────────────────────────────────────────────────────────

const windowsAtom = atom({ plugin: 'clawd-limits', key: 'windows' } as const, [], { shape: 'windows-1' })
const hiddenAtom = atom({ plugin: 'clawd-limits', key: 'isHidden' } as const, false)
const tickAtom = atom({ plugin: 'clawd-limits', key: 'tick' } as const, 0)
const bounceAtom = atom({ plugin: 'clawd-limits', key: 'bounceUntil' } as const, 0)
const moodAtom = atom({ plugin: 'clawd-limits', key: 'mood' } as const, '')
const partyAtom = atom({ plugin: 'clawd-limits', key: 'partyUntil' } as const, 0)
const celebratedAtom = atom({ plugin: 'clawd-limits', key: 'celebrated' } as const, [])
const alertedAtom = atom({ plugin: 'clawd-limits', key: 'alerted' } as const, [])

const TICK_MS = 500
const PARTY_MS = 5 * 60_000
const KINDS = ['five_hour', 'seven_day']

// ── Moods ────────────────────────────────────────────────────────────────

type Mood = 'waiting' | 'chill' | 'working' | 'sweaty' | 'nervous' | 'panic' | 'napping' | 'party'

const MOOD: Record<Mood, { color: string; prop: [string, string]; quip: string }> = {
  waiting: { color: '#9ca3af', prop: ['…', ' '], quip: "send a message and I'll read your limits" },
  chill: { color: '#22c55e', prop: ['♪', '♫'], quip: 'fresh tokens, who dis' },
  working: { color: '#38bdf8', prop: ['⌨', '⌨'], quip: "in the zone, don't mind me" },
  sweaty: { color: '#eab308', prop: ['💦', '  '], quip: 'pacing myself... mostly' },
  nervous: { color: '#f97316', prop: ['‼', '!'], quip: 'maybe smaller prompts?' },
  panic: { color: '#ef4444', prop: ['🔥', '🔥'], quip: 'SAVE ME A FEW TOKENS' },
  napping: { color: '#a78bfa', prop: ['z', 'Z'], quip: 'zzz' },
  party: { color: '#ec4899', prop: ['🎉', '✨'], quip: 'limits refreshed!' },
}

function moodFor(pct: number): Mood {
  if (pct >= 100) return 'napping'
  if (pct >= 90) return 'panic'
  if (pct >= 70) return 'nervous'
  if (pct >= 50) return 'sweaty'
  if (pct >= 25) return 'working'
  return 'chill'
}

// ── Clawd sprite (3 rows, padded to 10 cells) ────────────────────────────

function sprite(mood: Mood, tick: number, isBouncing: boolean): [string, string, string] {
  const isBlink = tick % 10 === 0
  const eyesClosed = mood === 'napping' || isBlink
  const head = eyesClosed ? ' ▐▄███▄▌  ' : ' ▐▛███▜▌  '
  const body = mood === 'party' && tick % 2 === 0 ? '▗▟█████▙▖ ' : '▝▜█████▛▘ '
  const hop = isBouncing || mood === 'party'
  const legs = hop && tick % 2 === 0 ? ' ▝▘   ▝▘  ' : '  ▘▘ ▝▝   '

  return [head, body, legs]
}

// ── Time formatting ──────────────────────────────────────────────────────

function zoneLabel(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (zone) return (zone.split('/').pop() ?? zone).replace(/_/g, ' ')
  } catch {}
  const offset = -new Date().getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return `UTC${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, '0')}` : ''}`
}

const pad = (n: number) => String(n).padStart(2, '0')
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function clockAt(iso: string, withDay: boolean): string {
  const date = new Date(iso)
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      ...(withDay ? { weekday: 'short' } : {}),
    }).format(date).replace(',', '')
  } catch {
    const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`
    return withDay ? `${DAYS[date.getDay()]} ${hm}` : hm
  }
}

function countdown(ms: number): string {
  const mins = Math.max(0, Math.ceil(ms / 60_000))
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${pad(mins % 60)}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

// ── Readings ─────────────────────────────────────────────────────────────

type Shown = { label: string; pct: number; resetsAt?: string; hasReset: boolean }

/** A window whose reset time has passed reads as 0% until a new reading. */
function shown(windows: LimitWindow[], now: number): Shown[] {
  return KINDS.flatMap(kind => {
    const win = windows.find(one => one.kind === kind)
    if (!win) return []
    const hasReset = !!win.resetsAt && Date.parse(win.resetsAt) <= now
    return [{
      label: kind === 'five_hour' ? '5h  ' : 'week',
      pct: hasReset ? 0 : win.percentUsed,
      resetsAt: hasReset ? undefined : win.resetsAt,
      hasReset,
    }]
  })
}

const keyOf = (win: LimitWindow) => `${win.kind}@${win.resetsAt ?? ''}`
const nameOf = (kind: string) => (kind === 'five_hour' ? '5-hour' : 'weekly')

async function ingest($: EngineInterface, rateLimits: readonly LimitWindow[]) {
  const windows = rateLimits
    .filter(win => KINDS.includes(win.kind))
    .map(win => ({ kind: win.kind, percentUsed: win.percentUsed, resetsAt: win.resetsAt }))
  if (windows.length === 0) return
  await update($, windowsAtom, () => windows)

  const alerted = await read($, alertedAtom)
  for (const win of windows) {
    if (win.percentUsed >= 95 && !alerted.includes(keyOf(win))) {
      await update($, alertedAtom, list => [...list, keyOf(win)].slice(-20))
      $.ui.toast(`🔥 Clawd: ${nameOf(win.kind)} limit at ${Math.round(win.percentUsed)}% — go easy!`)
    }
  }
}

/** The mood follows whichever window is fuller; party for a while after a reset. */
function moodOf(rows: Shown[], isParty: boolean): { mood: Mood; fullest: Shown | null } {
  const fullest = rows.reduce<Shown | null>((top, row) => (!top || row.pct > top.pct ? row : top), null)
  const mood: Mood = !fullest ? 'waiting' : isParty && fullest.pct < 100 ? 'party' : moodFor(fullest.pct)
  return { mood, fullest }
}

/**
 * Runs every tick: advances the animation, makes Clawd bounce when the mood
 * changes, and toasts once when a reset time passes. Drawing stays pure.
 */
async function onTick($: EngineInterface) {
  const tick = await update($, tickAtom, n => n + 1)
  const now = await $.clock.now()
  const windows = await read($, windowsAtom)

  const { mood } = moodOf(shown(windows, now), (await read($, partyAtom)) > now)
  if ((await read($, moodAtom)) !== mood) {
    await update($, moodAtom, () => mood)
    await update($, bounceAtom, () => tick + 6)
  }

  if (tick % 4 !== 0) return
  const celebrated = await read($, celebratedAtom)
  for (const win of windows) {
    if (!win.resetsAt) continue
    const at = Date.parse(win.resetsAt)
    const isFreshReset = at <= now && now - at < 10 * 60_000
    if (isFreshReset && !celebrated.includes(keyOf(win))) {
      await update($, celebratedAtom, list => [...list, keyOf(win)].slice(-20))
      await update($, partyAtom, () => now + PARTY_MS)
      $.ui.toast(`🎉 Clawd: your ${nameOf(win.kind)} limit just refreshed!`)
    }
  }
}

// ── Hooks ────────────────────────────────────────────────────────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'limits',
      description: 'Show or hide Clawd and your 5h / weekly usage limits',
    })
    const usage = await $.session.usage()
    await ingest($, usage.rateLimits)
    $.clock.every(TICK_MS, () => void onTick($))

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await ingest($, e.rateLimits)

    return next(e)
  })

  on('command.run', { command: 'limits' }, async $ => {
    const isHidden = await update($, hiddenAtom, was => !was)

    return { text: isHidden ? 'Clawd is hiding. Run /limits to bring Clawd back.' : 'Clawd is back on duty.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, hiddenAtom))) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const tick = await read($, tickAtom)
    const rows = shown(await read($, windowsAtom), now)
    const isParty = (await read($, partyAtom)) > now

    const { mood, fullest } = moodOf(rows, isParty)
    const isBouncing = tick < (await read($, bounceAtom))

    const look = MOOD[mood]
    const art = sprite(mood, tick, isBouncing)
    const prop = look.prop[Math.floor(tick / 2) % 2]
    const zone = zoneLabel()
    const columns = e.viewport?.columns ?? 100
    const barWidth = Math.max(8, Math.min(20, columns - 58))

    const quip =
      mood === 'napping' && fullest?.resetsAt
        ? `zzz — back at ${clockAt(fullest.resetsAt, false)}`
        : look.quip

    const line = (row: Shown | undefined) => {
      if (!row) return <Text dimColor>no reading yet</Text>
      const filled = Math.round((Math.min(row.pct, 100) / 100) * barWidth)
      const left = row.resetsAt ? Date.parse(row.resetsAt) - now : 0
      const isFar = left > 20 * 3_600_000
      return (
        <Text>
          <Text dimColor>{row.label} </Text>
          <Text color={look.color}>{'█'.repeat(filled)}</Text>
          <Text dimColor>{'░'.repeat(barWidth - filled)}</Text>
          <Text weight="bold" color={look.color} tabular>
            {' '}{String(Math.round(row.pct)).padStart(3)}%
          </Text>
          {row.hasReset ? (
            <Text color={MOOD.party.color}>  ↻ reset ✓</Text>
          ) : row.resetsAt ? (
            <Text dimColor tabular>
              {'  '}↻ {countdown(left)} · {clockAt(row.resetsAt, isFar)} {zone}
            </Text>
          ) : null}
        </Text>
      )
    }

    return (
      <Box flexDirection="column">
        <Text>
          <Text color={look.color}>{art[0]}</Text>
          {line(rows[0])}
        </Text>
        <Text>
          <Text color={look.color}>{art[1]}</Text>
          {line(rows[1])}
        </Text>
        <Text>
          <Text color={look.color}>{art[2]}</Text>
          <Text color={look.color}>{prop} </Text>
          <Text italic>"{quip}"</Text>
        </Text>
      </Box>
    )
  })
}
