import { expect, test } from 'claude-code/testing'

const NOW = Date.parse('2026-11-12T10:00:00Z')
const BAND = {
  plugin: 'clawd-limits',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10 },
} as const

function seed(on: any, fiveHour: number, weekly: number) {
  on('command.register', () => ({ value: { command: 'limits' } }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: {},
      rateLimits: [
        { kind: 'five_hour', percentUsed: fiveHour, resetsAt: '2026-11-12T11:12:00Z' },
        { kind: 'seven_day', percentUsed: weekly, resetsAt: '2026-11-16T05:30:00Z' },
      ],
    },
  }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
}

async function drawn($: any) {
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return texts.map((t: any) => t.text).join('\n')
}

test('a working session draws both bars and a working Clawd', async ($, on) => {
  seed(on, 40, 21)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const text = await drawn($)
  expect(text).toContain(' 40%')
  expect(text).toContain(' 21%')
  expect(text).toContain("in the zone, don't mind me")
  expect(text).toContain('1h 12m')
})

test('at 100% Clawd naps until the reset', async ($, on) => {
  seed(on, 100, 40)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(await drawn($)).toContain('zzz — back at')
})

test('no reading yet asks for a message', async ($, on) => {
  on('command.register', () => ({ value: { command: 'limits' } }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: {}, rateLimits: [] } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(await drawn($)).toContain("send a message and I'll read your limits")
})

test('times show in the local zone', async ($, on) => {
  seed(on, 63, 21)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const text = await drawn($)
  expect(text).toContain('pacing myself... mostly')
  expect(text).toMatch(/Mon \d\d:\d\d \S/)
})

test('a task burning fast makes Clawd thirsty, with the burn rate', async ($, on) => {
  let now = NOW
  on('command.register', () => ({ value: { command: 'limits' } }))
  on('clock.now', () => ({ value: now }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: {},
      rateLimits: [{ kind: 'five_hour', percentUsed: 40, resetsAt: '2026-11-12T13:00:00Z' }],
    },
  }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }) as any)
  on('turn.complete', () => ({ text: '' }) as any)
  on('session.measure', (_: unknown, e: any) => ({ changed: e.changed }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'refactor everything', turnId: 't1' } as any)

  // Three minutes later the 5h window went 40% → 46%: 2%/min, +6% this task.
  now = NOW + 3 * 60_000
  await $.session.measure({
    context: {},
    rateLimits: [{ kind: 'five_hour', percentUsed: 46, resetsAt: '2026-11-12T13:00:00Z' }],
    changed: ['rateLimits'],
  } as any)

  const busy = await drawn($)
  expect(busy).toContain('so... thirsty...')
  expect(busy).toContain('2.0%/min')
  expect(busy).toMatch(/empty in ~|lasts till reset/)

  // The task ends: Clawd is back to its usage mood.
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  expect(await drawn($)).toContain("in the zone, don't mind me")
})
