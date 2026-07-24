# The 4-knob agent template 🧰

This folder is a **safe skeleton** for a new AI employee. An agent is just four knobs:

| Knob | Lives in | What it decides |
|---|---|---|
| 👉 **WHEN** | `definition.ts` | when it wakes up (`daily` / `on_new_record` / `on_photo`) |
| 👉 **LOOK AT** | `definition.ts` | which records it reads |
| 👉 **SUGGEST** | `prompt.ts` | the words it drafts (for YOU to send) |
| 👉 **ASK-BEFORE** | `definition.ts` | when it must stop and get your YES |

`executor.ts` is **🔒 locked** — it drafts, never sends. That's the safety guarantee:
you can tune the four knobs freely and still never make the robot message a customer or move money.

## How to make your own (the one prompt)

1. Fill in `my-agent.md` (one page of blanks).
2. Paste this to Claude Code, exactly as written:

```
Copy agents/_template into agents/<name>, fill it from my `my-agent.md` — change ONLY
the four 👉 knobs — and register it in `agents/registry.ts`: add one line to the AGENTS
array (and one line to EXECUTORS only if my agent actually acts, not just drafts).
Show me the diff before applying.
```

3. The line it adds to the `AGENTS` array looks like this:

```ts
{ key: '<name>', label: '<Your Agent>', emoji: '🤖', autonomyNote: '🟡 Daily: drafts X. You send it.' },
```

**Draft-only agents (the default, and the safe one) need just that.** If your agent is
one of the rare ones that *executes* something on approval, it also needs one line in
the `EXECUTORS` map right below — otherwise an approved proposal errors with
"no executor registered." registry.ts's own comment says the same.

That's it — nothing else in the repo moves. Review the diff, then say yes.
