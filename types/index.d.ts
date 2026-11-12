/** One usage window as last reported: `five_hour` or `seven_day`. */
export type LimitWindow = {
  kind: string
  percentUsed: number
  /** ISO 8601 reset time, when reported. */
  resetsAt?: string
}

/** One reading of the 5-hour window, for the burn rate. */
export type BurnSample = { at: number; pct: number }

/** The main-thread task (turn) running now, and the 5h % when it began. */
export type TaskInfo = { turnId: string; startPct: number | null }

declare module 'claude-code' {
  interface PluginState {
    'clawd-limits': {
      /** The latest reading of the 5h and weekly windows. */
      windows: Shaped<LimitWindow[]>
      /** Band hidden with /limits. */
      isHidden: boolean
      /** Animation tick, advanced every 500 ms. */
      tick: number
      /** Tick until which Clawd bounces (after a mood change). */
      bounceUntil: number
      /** The mood drawn last, to spot a change. */
      mood: string
      /** Epoch ms until which the party mood shows after a reset. */
      partyUntil: number
      /** `kind@resetsAt` keys already celebrated with a reset toast. */
      celebrated: string[]
      /** `kind@resetsAt` keys already warned with the 95% toast. */
      alerted: string[]
      /** Recent 5h readings (last 10 minutes), for the burn rate. */
      samples: Shaped<BurnSample[]>
      /** The task running now, or null between tasks. */
      task: Shaped<TaskInfo | null>
      /** Turn ids already given the "burning fast" tip. */
      tipped: string[]
    }
  }
}
