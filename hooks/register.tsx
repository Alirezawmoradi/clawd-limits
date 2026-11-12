import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BurnSample, LimitWindow, TaskInfo } from '../types'

// ── State ────────────────────────────────────────────────────────────────

const windowsAtom = atom({ plugin: 'clawd-limits', key: 'windows' } as const, [], { shape: 'windows-1' })
const hiddenAtom = atom({ plugin: 'clawd-limits', key: 'isHidden' } as const, false)
const tickAtom = atom({ plugin: 'clawd-limits', key: 'tick' } as const, 0)
const bounceAtom = atom({ plugin: 'clawd-limits', key: 'bounceUntil' } as const, 0)
const moodAtom = atom({ plugin: 'clawd-limits', key: 'mood' } as const, '')
const partyAtom = atom({ plugin: 'clawd-limits', key: 'partyUntil' } as const, 0)
const celebratedAtom = atom({ plugin: 'clawd-limits', key: 'celebrated' } as const, [])
const alertedAtom = atom({ plugin: 'clawd-limits', key: 'alerted' } as const, [])
const samplesAtom = atom({ plugin: 'clawd-limits', key: 'samples' } as const, [], { shape: 'samples-1' })
const taskAtom = atom({ plugin: 'clawd-limits', key: 'task' } as const, null, { shape: 'task-1' })
const tippedAtom = atom({ plugin: 'clawd-limits', key: 'tipped' } as const, [])

const TICK_MS = 500
const PARTY_MS = 5 * 60_000
const KINDS = ['five_hour', 'seven_day']

// Thirst: a task burning the 5h window fast, or eating a lot of it.
const THIRSTY_RATE = 1 // % of the 5h window per minute
const THIRSTY_TASK = 5 // % of the 5h window used by one task
const RATE_WINDOW_MS = 5 * 60_000 // the burn rate looks back this far
const MIN_RATE_SPAN_MIN = 2 // never divide by less than 2 minutes (no spikes)
const TONGUE_COLOR = '#f472b6'

// ── Moods ────────────────────────────────────────────────────────────────

type Mood =
  | 'waiting' | 'chill' | 'working' | 'sweaty' | 'nervous' | 'panic' | 'napping' | 'party' | 'thirsty'

const MOOD: Record<Mood, { color: string; prop: [string, string]; quip: string }> = {
  waiting: { color: '#D97757', prop: ['…', ' '], quip: "send a message and I'll read your limits" },
  chill: { color: '#D97757', prop: ['♪', '♫'], quip: 'fresh tokens, who dis' },
  working: { color: '#D97757', prop: ['⌨', '⌨'], quip: "in the zone, don't mind me" },
  sweaty: { color: '#eab308', prop: ['💦', '  '], quip: 'pacing myself... mostly' },
  nervous: { color: '#ff6a00', prop: ['‼', '!'], quip: 'maybe smaller prompts?' },
  panic: { color: '#ef4444', prop: ['🔥', '🔥'], quip: 'SAVE ME A FEW TOKENS' },
  napping: { color: '#a78bfa', prop: ['z', 'Z'], quip: 'zzz' },
  party: { color: '#ec4899', prop: ['🎉', '✨'], quip: 'limits refreshed!' },
  // Thirsty keeps the colour of the usage level it sits on; this one is unused.
  thirsty: { color: '#D97757', prop: ['💧', '  '], quip: 'so... thirsty...' },
}

/** Moods that thirst never overrides: they say something more urgent. */
const OUTRANKS_THIRST: Mood[] = ['waiting', 'panic', 'napping', 'party']

function moodFor(pct: number): Mood {
  if (pct >= 100) return 'napping'
  if (pct >= 90) return 'panic'
  if (pct >= 70) return 'nervous'
  if (pct >= 50) return 'sweaty'
  if (pct >= 25) return 'working'
  return 'chill'
}

// ── Clawd sprite (4 rows × 12 cells: sky, head, body, legs) ──────────────
//
// Calm pacing at a 500 ms tick: an idle dance every 10 s that lasts 3 s,
// walking while Claude works, and stronger per-mood effects (panic shakes,
// nervous trembles, Zzz floats up while napping, party sparkles).

const SPRITE_WIDTH = 12
const DANCE_EVERY = 20 // ticks (10 s)
const DANCE_STEPS = [2, 1, 0, 1, 2, 1] // x offsets: sway right, center, left...
const SPARKLES = '✦ · ✧ · '

type Pose = { isBouncing: boolean; isWorking: boolean }

function sprite(mood: Mood, tick: number, pose: Pose): [string, string, string, string] {
  const isBlink = tick % 10 === 0
  const eyesClosed = mood === 'napping' || isBlink

  let x = 1
  let legs = '  ▘▘ ▝▝'
  let body = '▝▜█████▛▘'

  const step = tick % DANCE_EVERY
  const canDance = ['waiting', 'chill', 'working', 'sweaty', 'party'].includes(mood)

  if (mood === 'thirsty') {
    // Panting: mouth wide open with the tongue out, then closed, every tick.
    if (tick % 2 === 0) {
      body = '▝▜█▄ ▄█▛▘'
      legs = '  ▘▘▌▝▝'
    }
  } else if (pose.isWorking && mood !== 'napping') {
    legs = tick % 2 === 0 ? '  ▘▘ ▝▝' : '  ▝▘ ▘▝' // walk in place
  } else if (mood === 'panic') {
    if (tick % 8 < 4) x = tick % 2 === 0 ? 0 : 2 // shake in bursts
  } else if (mood === 'nervous') {
    if (tick % 8 < 2) x = tick % 2 === 0 ? 1 : 2 // tremble
  } else if (canDance && step < DANCE_STEPS.length) {
    x = DANCE_STEPS[step] ?? 1
    if (x !== 1) legs = ' ▝▘   ▝▘'
  }

  if (mood === 'party') {
    body = tick % 2 === 0 ? '▗▟█████▙▖' : '▝▜█████▛▘'
  }
  if (pose.isBouncing && tick % 2 === 0 && !pose.isWorking && mood !== 'thirsty') legs = ' ▝▘   ▝▘'

  const head = eyesClosed ? ' ▐▄███▄▌' : ' ▐▛███▜▌'
  const shift = (s: string) => (' '.repeat(x) + s).padEnd(SPRITE_WIDTH).slice(0, SPRITE_WIDTH)
  const rows = [' '.repeat(SPRITE_WIDTH), shift(head), shift(body), shift(legs)]

  if (mood === 'napping') {
    // One z drifts up and to the right, then starts again.
    const drift: [number, number, string][] = [[2, 10, 'z'], [1, 11, 'z'], [0, 11, 'Z']]
    const at = drift[Math.floor(tick / 2) % 4]
    if (at) {
      const [row, col, ch] = at
      const line = rows[row] ?? ''
      rows[row] = line.slice(0, col) + ch + line.slice(col + 1)
    }
  }

  if (mood === 'thirsty') {
    // Sweat on the head the whole time; fire flickers around Clawd: the top
    // corners while the mouth is open, beside the feet while it is closed.
    // (🔥 and 💦 are two cells wide, and two UTF-16 units long, so the 12-cell
    // rows stay 12 cells.)
    const isOpen = tick % 2 === 0
    rows[0] = isOpen ? '🔥     💦 🔥' : '      💦    '
    if (!isOpen) {
      const feet = rows[3] ?? ''
      rows[3] = '🔥' + feet.slice(2, 9) + '🔥' + feet.slice(11)
    }
  }

  if (mood === 'party') {
    const offset = tick % SPARKLES.length
    rows[0] = (SPARKLES.slice(offset) + SPARKLES + SPARKLES).slice(0, SPRITE_WIDTH - 2) + '  '
  }

  return rows as [string, string, string, string]
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

// ── Thirst (burn rate) ───────────────────────────────────────────────────

/** The 5h window's % as shown now (0 once its reset time passed), or null. */
function fivePct(windows: LimitWindow[], now: number): number | null {
  const five = shown(windows, now).find(row => row.label.trim() === '5h')
  return five ? five.pct : null
}

type Thirst = { isThirsty: boolean; rate: number; taskDelta: number }

/**
 * How fast the 5h window is burning (% per minute over the last 5 minutes,
 * measured up to now so it cools down by itself) and how much the running
 * task has used. Thirsty only while a task runs.
 */
function thirstOf(samples: BurnSample[], task: TaskInfo | null, pct: number | null, now: number): Thirst {
  if (!task || pct === null) return { isThirsty: false, rate: 0, taskDelta: 0 }
  const first = samples.find(s => now - s.at <= RATE_WINDOW_MS)
  const minutes = first ? Math.max(MIN_RATE_SPAN_MIN, (now - first.at) / 60_000) : 1
  const rate = first ? Math.max(0, (pct - first.pct) / minutes) : 0
  const taskDelta = task.startPct === null ? 0 : Math.max(0, pct - task.startPct)
  return { isThirsty: rate >= THIRSTY_RATE || taskDelta >= THIRSTY_TASK, rate, taskDelta }
}

async function addSample($: EngineInterface, at: number, pct: number) {
  await update($, samplesAtom, list => {
    const last = list[list.length - 1]
    // The window reset under us: old readings would read as negative burn.
    const kept = last && pct < last.pct - 1 ? [] : list
    return [...kept.filter(s => at - s.at <= 2 * RATE_WINDOW_MS), { at, pct }].slice(-60)
  })
}

async function ingest($: EngineInterface, rateLimits: readonly LimitWindow[]) {
  const windows = rateLimits
    .filter(win => KINDS.includes(win.kind))
    .map(win => ({ kind: win.kind, percentUsed: win.percentUsed, resetsAt: win.resetsAt }))
  if (windows.length === 0) return
  await update($, windowsAtom, () => windows)

  const now = await $.clock.now()
  const pct = fivePct(windows, now)
  if (pct !== null) {
    await addSample($, now, pct)
    // A task that began before any reading takes its first one as its start.
    const task = await read($, taskAtom)
    if (task && task.startPct === null) await update($, taskAtom, () => ({ ...task, startPct: pct }))
  }

  const alerted = await read($, alertedAtom)
  for (const win of windows) {
    if (win.percentUsed >= 95 && !alerted.includes(keyOf(win))) {
      await update($, alertedAtom, list => [...list, keyOf(win)].slice(-20))
      $.ui.toast(`🔥 Clawd: ${nameOf(win.kind)} limit at ${Math.round(win.percentUsed)}% — go easy!`)
    }
  }
}

/**
 * The mood follows whichever window is fuller; party for a while after a
 * reset; thirsty while a task burns fast, unless something more urgent shows.
 * `base` is the usage level's mood, whose colour Clawd keeps when thirsty.
 */
function moodOf(rows: Shown[], isParty: boolean, isThirsty: boolean): { mood: Mood; base: Mood; fullest: Shown | null } {
  const fullest = rows.reduce<Shown | null>((top, row) => (!top || row.pct > top.pct ? row : top), null)
  const base: Mood = !fullest ? 'waiting' : isParty && fullest.pct < 100 ? 'party' : moodFor(fullest.pct)
  const mood: Mood = isThirsty && !OUTRANKS_THIRST.includes(base) ? 'thirsty' : base
  return { mood, base, fullest }
}

/** Everything a tick or a drawing needs to pick the mood, read in one place. */
async function readMood($: EngineInterface, now: number) {
  const windows = await read($, windowsAtom)
  const thirst = thirstOf(await read($, samplesAtom), await read($, taskAtom), fivePct(windows, now), now)
  const rows = shown(windows, now)
  return { windows, rows, thirst, ...moodOf(rows, (await read($, partyAtom)) > now, thirst.isThirsty) }
}

/**
 * Runs every tick: advances the animation, makes Clawd bounce when the mood
 * changes, and toasts once when a reset time passes. Drawing stays pure.
 */
async function onTick($: EngineInterface) {
  const tick = await update($, tickAtom, n => n + 1)
  const now = await $.clock.now()
  const { windows, mood, thirst } = await readMood($, now)
  if ((await read($, moodAtom)) !== mood) {
    await update($, moodAtom, () => mood)
    await update($, bounceAtom, () => tick + 6)
  }

  if (tick % 4 !== 0) return

  // One tip per task once it gets thirsty.
  const task = await read($, taskAtom)
  if (mood === 'thirsty' && task && !(await read($, tippedAtom)).includes(task.turnId)) {
    await update($, tippedAtom, list => [...list, task.turnId].slice(-20))
    $.ui.toast(
      `🌵 Clawd: this task is burning fast (${thirst.rate.toFixed(1)}%/min, +${Math.round(thirst.taskDelta)}% so far) — consider /compact or a smaller model.`,
    )
  }

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

  // A task is one main-thread turn: from your prompt to Claude's answer.
  // Subagent turns (agentId set) belong to the task already running.
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      const now = await $.clock.now()
      const pct = fivePct(await read($, windowsAtom), now)
      const task: TaskInfo = { turnId: e.turnId, startPct: pct }
      await update($, taskAtom, () => task)
      if (pct !== null) await addSample($, now, pct)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) await update($, taskAtom, () => null)

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
    const { rows, mood, base, fullest, thirst } = await readMood($, now)
    const isBouncing = tick < (await read($, bounceAtom))

    // Thirsty Clawd keeps the colour of the usage level underneath.
    const look = { ...MOOD[mood], color: MOOD[base].color }
    const art = sprite(mood, tick, { isBouncing, isWorking: e.props.isWorking })
    const prop = look.prop[Math.floor(tick / 2) % 2]
    const zone = zoneLabel()
    const columns = e.viewport?.columns ?? 100
    const barWidth = Math.max(8, Math.min(20, columns - 58))

    const quip =
      mood === 'napping' && fullest?.resetsAt
        ? `zzz — back at ${clockAt(fullest.resetsAt, false)}`
        : look.quip

    // While thirsty: burn speed, and when the 5h window would run dry at it.
    let burn = ''
    if (mood === 'thirsty') {
      const five = rows.find(row => row.label.trim() === '5h')
      if (thirst.rate >= 0.1 && five) {
        const msLeft = ((100 - five.pct) / thirst.rate) * 60_000
        const resetIn = five.resetsAt ? Date.parse(five.resetsAt) - now : Infinity
        const forecast = msLeft >= resetIn ? 'lasts till reset ✓' : `empty in ~${countdown(msLeft)}`
        burn = `🔥 ${thirst.rate.toFixed(1)}%/min · ${forecast}`
      } else {
        burn = `🔥 this task: +${Math.round(thirst.taskDelta)}%`
      }
    }

    // The tongue (▌ on the legs row while panting) is drawn pink.
    const legsRow = (text: string) => {
      const at = mood === 'thirsty' ? text.indexOf('▌') : -1
      if (at < 0) return <Text color={look.color}>{text}</Text>
      return (
        <Text>
          <Text color={look.color}>{text.slice(0, at)}</Text>
          <Text color={TONGUE_COLOR}>▌</Text>
          <Text color={look.color}>{text.slice(at + 1)}</Text>
        </Text>
      )
    }

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
        <Text color={look.color}>{art[0]}</Text>
        <Text>
          <Text color={look.color}>{art[1]}</Text>
          {line(rows[0])}
        </Text>
        <Text color={look.color}>{art[2]}</Text>
        <Text>
          {legsRow(art[3])}
          {line(rows[1])}
        </Text>
        <Text>
          <Text>{' '.repeat(SPRITE_WIDTH)}</Text>
          <Text color={look.color}>{prop} </Text>
          <Text italic>"{quip}"</Text>
          {burn ? <Text color={look.color}>  {burn}</Text> : null}
        </Text>
      </Box>
    )
  })
}
