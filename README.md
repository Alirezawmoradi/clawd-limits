# Clawd Limits

A Claude Code mod that puts **Clawd** above your prompt to show your **5-hour** and **weekly** usage limits. Clawd's mood and colour change as the windows fill: chill, working, sweaty, nervous, panic, then napping until the reset.

```
 ▐▛███▜▌  5h   █████████████░░░░░░░  63%  ↻ 1h 12m · 12:12 Berlin
▝▜█████▛▘
  ▘▘ ▝▝   week ████░░░░░░░░░░░░░░░░  21%  ↻ 3d 19h · Mon 06:30 Berlin
          💦 "pacing myself... mostly"
```

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install clawd-limits --marketplace Alirezawmoradi/clawd-limits
```

Or from a shell:

```
claude plugin install clawd-limits --marketplace Alirezawmoradi/clawd-limits
```

Requires a recent Claude Code with mods (function hooks) support, and a Claude subscription: API-key sessions have no 5h or weekly windows to show.

## What it shows

| Usage (fuller window) | Clawd | Colour | Says |
|---|---|---|---|
| 0–25% | chill ♪ | Clawd orange | "fresh tokens, who dis" |
| 25–50% | working ⌨ | Clawd orange | "in the zone, don't mind me" |
| 50–70% | sweaty 💦 | yellow | "pacing myself... mostly" |
| 70–90% | nervous ‼ | bright orange | "maybe smaller prompts?" |
| 90–100% | panic 🔥 | red | "SAVE ME A FEW TOKENS" |
| 100% | napping zZ | purple | "zzz — back at 15:40" |
| just reset | party 🎉 | pink | "limits refreshed!" (5 min) |

- Each window shows its percent used, a countdown to reset, and the reset time (24h) in your local time zone.
- Clawd blinks, its prop animates, and it bounces when its mood changes.
- A toast warns once when a window passes 95%, and another celebrates a reset.
- The numbers arrive with each Claude response, so a new session shows a waiting Clawd until your first message.

## Commands

- `/limits` hides or shows the band.

## Develop

```
claude --plugin-dir .          # run a session with the mod loaded from this folder
claude plugin validate .       # check the manifest and hooks module
claude plugin test .           # run tests/*.test.tsx
```

## License

MIT
