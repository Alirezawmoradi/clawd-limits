# clawd-limits — context for Claude

A Claude Code **mod** (function-hooks plugin) that draws pixel Clawd in the `AbovePrompt` band with the 5-hour and weekly usage limits. Built in an earlier session; this file carries its decisions forward. The goal is to publish it on GitHub as `Alirezawmoradi/clawd-limits` so others can install it.

## Files

- `.claude-plugin/plugin.json` — manifest; `types` points at the state contract.
- `.claude-plugin/marketplace.json` — makes this repo its own marketplace (`source: "./"`).
- `hooks/hooks.json` — `{ "modules": ["./register.tsx"] }`.
- `hooks/register.tsx` — the whole mod.
- `types/index.d.ts` — `PluginState['clawd-limits']` contract (windows is `Shaped<...>`, atom uses `shape: 'windows-1'`).
- `tests/band.test.tsx` — `claude plugin test .` (4 tests).

## How it works

- Data: `$.session.usage()` at `session.start`, then `session.measure` (`e.rateLimits`, kinds `five_hour` / `seven_day`, `percentUsed`, `resetsAt` ISO). Only after a response; empty off a subscription.
- A `$.clock.every(500)` tick advances animation, detects mood changes (sets bounce) and fires the reset toast. **Render hooks must be pure**: never write state inside `ui.render` (the engine denies it).
- Atom refs need the plugin name as a string literal (`{ plugin: 'clawd-limits', key }`), not a variable, or validation fails.
- Time zone via `Intl` (the runtime reports the OS zone, e.g. Europe/Berlin), with a UTC-offset fallback.

## Design decisions (from the user's answers)

1. Placement: band above the prompt (6 rows: blank spacer row so it does not touch the spinner/Claude text above, 5h bar, blank row, week bar, faint dotted divider (dim ┈), quip + fuel gauge — the user asked for a gap between the two bars).
2. Mascot: pixel Clawd in the original Clawd orange (#D97757) while all is good (waiting, chill, working: under 50%); the colour changes from sweaty on (yellow, bright orange, red, purple napping, pink party).
3. Moods: chill <25, working <50, sweaty <70, nervous <90, panic <100, napping =100, party for 5 min after a reset. Mood follows the fuller window.
4. Per window: percent, countdown, reset clock time + time zone label.
5. Bars: solid blocks `█░` in Clawd's current colour.
6. Alerts: toast at 95% (once per window period) and on reset. No 80% toast.
7. Visibility: always; `/limits` toggles.
8. Clock: 24h.
9. Animation: subtle (blink every 5 s, prop flicker, bounce on mood change).
10. replay-theater was uninstalled so the band is Clawd's alone.

## Workflow

- Develop with `claude --plugin-dir .` (hot-reloads on save), check with `claude plugin validate .` and `claude plugin test .`.
- Publishing: follow the plugin-authoring skill's "Sharing a mod" steps (secret scan, then `git init`, commit, push). `gh` CLI was not installed when this was written.

## Thirsty mood (v0.3 work)

- Thirsty while a main-thread task runs (`turn.start`/`turn.complete` without `agentId`) and either the 5h window burns >= 1 %/min (over the last 5 min, measured up to now, min 2-minute span) or the task used >= 5 % of it.
- Look: panting (mouth open `▝▜█▄ ▄█▛▘` + pink tongue `▌` on the legs row, alternating with the normal face), 💦 on the head (sky row) and 🔥 flickering around it (top corners while the mouth is open, beside the feet while closed; each emoji is 2 cells and 2 UTF-16 units, so rows stay 12 cells), prop 💧, quip "so... thirsty...", plus `🔥 x.x%/min · empty in ~Nm` (or "lasts till reset ✓").
- Keeps the colour of the usage-level mood underneath; waiting, panic, napping and party outrank it.
- One toast per task suggesting /compact or a smaller model.

## Context fuel gauge and preview (v0.3 work)

- ctx: `context.percent` from `$.session.usage()` at start and `session.measure` (changed `context`), kept in `ctxUsed` (-1 = none yet). Drawn on the quip row as a car fuel strip showing what is LEFT (`⛽ ctx E ▰▰▰▱▱▱▱▱ F 38% left`), 8 segments, red with ⚠ at 20% left or less. The thirsty tip mentions the context when it is 60%+ used.
- `/limits preview` tours all 8 moods (3 s each); `/limits preview <mood>` shows one for 15 s. Fake numbers live in `FAKE`; `readMood` swaps them in while a preview runs, tagged "preview ·". Previews never toast, tip or start a real party. The command is registered `immediate` with an `argumentHint`.
