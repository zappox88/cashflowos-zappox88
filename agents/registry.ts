// The agent registry \u2014 the ONE place the app learns which robots exist.
//
// Two exports:
//   \u2022 AGENTS    \u2014 metadata for the "AI Employees" tab (label, emoji, autonomy note).
//   \u2022 EXECUTORS \u2014 the deterministic run() for each agent. \ud83d\udd12 These are what
//                 actually write rows / file docs. The HITL engine (lib/actions.ts)
//                 calls EXECUTORS[agent_key] AFTER a proposal is approved (or on
//                 the \ud83d\udfe2 autopilot path). Right now they are safe stubs \u2014 Phase B
//                 (HITL) and Phase C (Vault/Expense) fill in the real bodies.
//
// \ud83d\udc49 To add YOUR OWN agent: copy agents/_template into agents/<name>, fill the 4
//    knobs, then add ONE line to AGENTS below (and one to EXECUTORS if it acts).

export type AgentMeta = {
  key: string
  label: string
  emoji: string
  autonomyNote: string   // one line describing where its \ud83d\udfe2/\ud83d\udfe1 dial sits
}

// Order here = order shown on the AI Employees tab.
export const AGENTS: AgentMeta[] = [
  // ---- Ships wired ----
  {
    key: 'vault',
    label: 'The Vault',
    emoji: '\ud83d\udcf8',
    autonomyNote: 'Photo in \u2192 files the receipt/doc. \ud83d\udfe2 auto-files small ones, \ud83d\udfe1 asks on big or unclear ones.',
  },
  {
    key: 'expense',
    label: 'Expense Filer',
    emoji: '\ud83e\uddfe',
    autonomyNote: '\ud83d\udfe2 auto-files spend at or under the threshold, \ud83d\udfe1 asks first above it (the autonomy dial).',
  },
  {
    key: 'jarvis',
    label: 'Jarvis',
    emoji: '\ud83e\udd16',
    autonomyNote: 'Read-only Q&A over your numbers on Telegram. Answers only \u2014 never acts on money.',
  },
  // ---- Gallery placeholders (fill from agents/gallery/*.md; all DRAFT-only) ----
  {
    key: 'overdue-invoice',
    label: 'Overdue-Invoice Chaser',
    emoji: '\ud83d\udcb8',
    autonomyNote: '\ud83d\udfe1 Daily: drafts a chase for invoices unpaid > 7 days. You send it.',
  },
  {
    key: 'cold-lead',
    label: 'Cold-Lead Follow-up',
    emoji: '\ud83c\udfaf',
    autonomyNote: '\ud83d\udfe1 Daily: drafts a nudge for leads quiet > 3 days. You send it.',
  },
  {
    key: 'content-approval',
    label: 'Content Approval',
    emoji: '\ud83d\udcc5',
    autonomyNote: '\ud83d\udfe1 On new draft: asks before anything is published.',
  },
  {
    key: 'leave-claim',
    label: 'Leave / Claim Approval',
    emoji: '\ud83d\uddc2\ufe0f',
    autonomyNote: '\ud83d\udfe1 On submit: always asks \u2014 HR sign-off never runs on its own.',
  },
  {
    key: 'renewal-nudge',
    label: 'Renewal Nudge',
    emoji: '\ud83d\udd01',
    autonomyNote: '\ud83d\udfe1 Daily: drafts a reminder for policies/subscriptions expiring within 30 days.',
  },
  {
    key: 'viewing-followup',
    label: 'Viewing Follow-up',
    emoji: '\ud83c\udfe0',
    autonomyNote: '\ud83d\udfe1 After a viewing: drafts the follow-up. You send it.',
  },
  {
    key: 'carousel',
    label: 'Carousel',
    emoji: '\ud83c\udfa0',
    autonomyNote: '\ud83d\udfe1 Daily: drafts an Instagram carousel from your content. You post it.',
  },
]

// ------------------------------------------------------------
// EXECUTORS \u2014 deterministic, idempotent action runners.
//
// \ud83d\udd12 Don't edit the CALL SHAPE \u2014 the HITL engine depends on it:
//    (payload) => Promise<any>   (the returned value is stored as the audit result)
//
// An executor is the ONLY thing that can actually "do" the action. It runs exactly
// ONCE, AFTER a YES or the \ud83d\udfe2 autopilot claim (the CAS in lib/actions.ts guarantees
// once-only). It is deterministic: same payload in \u2192 same rows out. Nothing in here
// sends to a customer, moves money, or deletes a row \u2014 the \ud83d\udd34 NEVER-zone code
// simply does not live here. That's the whole safety guarantee.
//
// Two executor shapes ship:
//   \u2022 fileReceipt \u2014 writes a records row (+ a vault_files row when a photo was
//     uploaded) for the Vault/Expense agents.
//   \u2022 draftOnly   \u2014 hands back a DRAFT for a human to send (the gallery agents).
//     Note: no network call, nothing leaves the building.
// ------------------------------------------------------------
import { supabase, supabaseConfigured } from '@/lib/supabase'
import { logRun } from '@/lib/runs'

export type Executor = (payload: any) => Promise<any>

// ---- fileReceipt: the Vault/Expense write ----------------------------------
// Files a receipt/doc into the ONE `records` table. A receipt with a real amount
// becomes a `cash_out` row (money going out); anything else becomes a `doc`. If the
// payload carries a photo's sha256, we also write the `vault_files` row and link it
// back \u2014 the sha256 UNIQUE constraint makes that write idempotent (same photo twice
// = same hash = no duplicate). The returned result includes `record_id` so /undo
// can post a reversal later.
async function fileReceipt(agentKey: string, payload: any): Promise<any> {
  if (!supabaseConfigured) throw new Error('Supabase not configured \u2014 cannot file this yet.')

  const kind = String(payload?.kind || 'receipt').toLowerCase()
  const rawAmount = Number(payload?.amount)
  const amount = Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : 0
  const isExpense = kind !== 'doc' && amount > 0
  const merchant = (payload?.merchant || '').toString().trim()
  const catCol = isExpense ? 'cash_out' : 'doc'
  const label = payload?.category || (isExpense ? 'expense' : 'document')
  const title = isExpense
    ? `${merchant || 'Receipt'} \u2014 ${label}`
    : `${merchant || payload?.title || 'Document'}`

  // 1) The business-spine row.
  const { data: recRows, error: recErr } = await supabase
    .from('records')
    .insert({
      title,
      status: 'filed',
      amount: isExpense ? amount : 0,
      category: catCol,
      due_date: payload?.date || null,
      notes: payload?.note || (payload?.auto ? 'Auto-filed by the Vault \ud83e\udd16' : 'Filed by the Vault \ud83e\udd16'),
      meta: {
        merchant: merchant || undefined,
        category: payload?.category || undefined,
        auto_filed: !!payload?.auto,
        source: 'vault',
        sha256: payload?.sha256 || undefined,
      },
    })
    .select()
  if (recErr) throw new Error(`could not file the record: ${recErr.message}`)
  const recordId = recRows?.[0]?.id ?? null

  // 2) The vault_files row (only when a photo/document was actually uploaded).
  //    Idempotent via the sha256 UNIQUE constraint \u2014 a replayed file is ignored.
  let vaultFiled = false
  if (payload?.sha256) {
    const { data: vfRows, error: vfErr } = await supabase
      .from('vault_files')
      .upsert(
        {
          sha256: payload.sha256,
          storage_path: payload.storage_path || null,
          mime: payload.mime || null,
          size_bytes: payload.size_bytes ?? null,
          uploaded_by_chat_id: payload.uploaded_by_chat_id ?? null,
          record_id: recordId,
        },
        { onConflict: 'sha256', ignoreDuplicates: true },
      )
      .select()
    if (vfErr) console.error('[CFO] vault_files write failed:', vfErr.message)
    vaultFiled = !!(vfRows && vfRows.length)
  }

  const result = {
    kind: catCol === 'cash_out' ? 'expense' : 'doc',
    record_id: recordId,
    title,
    amount: isExpense ? amount : 0,
    category: label,
    vault_filed: vaultFiled,
    filed_at: new Date().toISOString(),
  }
  await logRun(agentKey, 'ok', result)
  return result
}

// ---- writeRecord: the bot ACTION-tool write (V2) ---------------------------
// The Jarvis action tools (add task / add lead / log cash-in / mark invoice paid /
// update lead stage) all funnel through here \u2014 AFTER a \ud83d\udfe1 approval or a \ud83d\udfe2 autopilot
// claim (the CAS in lib/actions.ts guarantees once-only). Two shapes:
//   \u2022 op:'insert' \u2192 writes a new `records` row and returns record_id (so /undo can
//     post a reversal exactly like a filed receipt).
//   \u2022 op:'update' \u2192 flips a status (+ optional meta) on an existing row (mark paid,
//     move a lead stage). Idempotent: setting an already-'paid' row to 'paid' is a
//     no-op net change.
// Nothing here sends a message, moves money, or deletes \u2014 the \ud83d\udd34 NEVER zone does not
// live here, same guarantee as fileReceipt/draftOnly.
async function writeRecord(agentKey: string, payload: any): Promise<any> {
  if (!supabaseConfigured) throw new Error('Supabase not configured \u2014 cannot write this yet.')
  const op = String(payload?.op || 'insert')

  if (op === 'update') {
    const recordId = Number(payload?.record_id)
    if (!Number.isFinite(recordId)) throw new Error('update needs a numeric record_id')
    const patch: Record<string, any> = {}
    if (payload?.status != null) patch.status = String(payload.status)
    if (payload?.meta && typeof payload.meta === 'object') patch.meta = payload.meta
    if (Object.keys(patch).length === 0) throw new Error('nothing to update')
    const { data, error } = await supabase.from('records').update(patch).eq('id', recordId).select()
    if (error) throw new Error(`could not update the record: ${error.message}`)
    const row = data?.[0]
    if (!row) throw new Error(`no record #${recordId} to update`)
    const result = {
      kind: 'record_updated',
      record_id: recordId,
      title: row.title,
      status: row.status,
      category: row.category,
    }
    await logRun(agentKey, 'ok', result)
    return result
  }

  // op:'insert' \u2014 a new business row (task / lead / cash_in).
  const title = String(payload?.title || '').trim() || 'Untitled'
  const category = String(payload?.category || 'task')
  const rawAmount = Number(payload?.amount)
  const amount = Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : 0
  const { data, error } = await supabase
    .from('records')
    .insert({
      title,
      status: String(payload?.status || 'open'),
      amount,
      category,
      due_date: payload?.due_date || null,
      notes: payload?.note || 'Added via Jarvis \ud83e\udd16',
      meta: { ...(payload?.meta || {}), source: 'jarvis' },
    })
    .select()
  if (error) throw new Error(`could not add the ${category}: ${error.message}`)
  const recordId = data?.[0]?.id ?? null
  const result = { kind: 'record_created', record_id: recordId, title, category, amount }
  await logRun(agentKey, 'ok', result)
  return result
}

// ---- draftOnly: the gallery agents ----------------------------------------
// Produces a DRAFT the human reads and sends. There is deliberately no send here \u2014
// customer-facing messages are \ud83d\udd34 NEVER-zone. Returns the draft; logs the run.
async function draftOnly(agentKey: string, payload: any): Promise<any> {
  const result = {
    kind: 'draft' as const,
    channel: payload?.channel || 'manual',
    text: (payload?.text || '').toString().trim() || '(no draft text was provided)',
    ready_to_send: false as const, // always false \u2014 the robot never sends. You do.
    drafted_at: new Date().toISOString(),
  }
  await logRun(agentKey, 'ok', { drafted: true, channel: result.channel })
  return result
}

export const EXECUTORS: Record<string, Executor> = {
  // The two that write money/docs (Vault = the photo pipeline, Expense = its
  // threshold specialisation). Both file into the ONE records table.
  vault: (p) => fileReceipt('vault', p),
  expense: (p) => fileReceipt('expense', p),
  // The Jarvis bot ACTION tools (V2) \u2014 all write through writeRecord, all pass the
  // same CAS/approval funnel. \ud83d\udfe2 add-task/add-lead autopilot; \ud83d\udfe1 the rest ask first.
  'add-task': (p) => writeRecord('add-task', p),
  'add-lead': (p) => writeRecord('add-lead', p),
  'log-cash-in': (p) => writeRecord('log-cash-in', p),
  'mark-paid': (p) => writeRecord('mark-paid', p),
  'lead-status': (p) => writeRecord('lead-status', p),
  // The gallery agents \u2014 all DRAFT-only (a human sends).
  'overdue-invoice': (p) => draftOnly('overdue-invoice', p),
  'cold-lead': (p) => draftOnly('cold-lead', p),
  'content-approval': (p) => draftOnly('content-approval', p),
  'leave-claim': (p) => draftOnly('leave-claim', p),
  'renewal-nudge': (p) => draftOnly('renewal-nudge', p),
  'viewing-followup': (p) => draftOnly('viewing-followup', p),
  'carousel': (p) => draftOnly('carousel', p),
}

// ============================================================
// SCHEDULED CHECKS \u2014 the 'daily' agents the merged cron (/api/cron-daily) sweeps.
//
// \ud83d\udd12 Don't edit the SHAPE. A scheduled agent's check() reads today's rows and
// returns a list of proposals to CREATE \u2014 it NEVER executes anything itself
// (scheduled agents still pass through the \ud83d\udfe1 ASK zone; the human decides). The
// cron calls propose() for each, so a stable idempotency_key (keyed by row + day)
// means re-running the cron never duplicates a proposal.
//
// \ud83d\udc49 To make YOUR daily agent run in the cron: add ONE entry here whose `key`
//    matches an EXECUTORS key above. Everything else (create \u2192 surface \u2192 approve \u2192
//    execute-once \u2192 audit) is already wired.
// ============================================================
import type { Rec } from '@/lib/records'
import { rm } from '@/lib/records'

export type ProposalDraft = { idempotencyKey: string; payload: any; text: string }
export type ScheduledCheck = {
  key: string
  label: string
  check: (rows: Rec[], today: string) => ProposalDraft[]
}

// Whole days between a due date and today (positive = overdue).
function daysPast(due: string | null, today: string): number {
  if (!due) return 0
  return Math.floor((Date.parse(today) - Date.parse(due)) / 86_400_000)
}

// Finance \u00b7 Overdue-Invoice Chaser (the worked example): unpaid cash_in more than
// 7 days past due \u2192 draft a chase for the owner to send. DRAFT only \u2014 never sends.
const overdueInvoiceCheck: ScheduledCheck = {
  key: 'overdue-invoice',
  label: 'Overdue-Invoice Chaser',
  check: (rows, today) =>
    rows
      .filter(
        (r) =>
          r.category === 'cash_in' &&
          (r.status || '').toLowerCase() !== 'paid' &&
          r.due_date &&
          daysPast(r.due_date, today) > 7,
      )
      .map((r) => {
        const late = daysPast(r.due_date, today)
        const who = (r.meta?.customer as string) || r.title
        return {
          idempotencyKey: `overdue-invoice:${r.id}:${today}`,
          payload: {
            row_id: r.id,
            channel: 'whatsapp',
            text:
              `Hi ${who}, a friendly reminder that ${rm(r.amount)} for "${r.title}" is now ` +
              `${late} days past due. Could you let me know when it'll be settled? Thank you!`,
          },
          text: `\ud83d\udcb8 Overdue: <b>${r.title}</b> (${rm(r.amount)}, ${late}d late). Draft a chase for you to send?`,
        }
      }),
}

// Content \u00b7 Carousel: rotate the content library and draft ONE Instagram carousel
// per day for the owner to post. DRAFT only \u2014 never posts. Self-contained here.
function carouselDraft(r: Rec): string {
  const raw = r.title || 'your topic'
  const topic =
    raw.replace(/^(carousel|reel|post|ad|tiktok|video)\s*[-:\u2014]\s*/i, '').trim() || raw
  const platform = (r.meta?.platform as string) || 'Instagram'
  const tag = topic.split(/\s+/)[0].toUpperCase()
  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '')
  return [
    `Instagram carousel - ${topic}`, ``,
    `SLIDE 1 (hook): "${topic}" - save this for later.`,
    `SLIDE 2: The problem - what most people get wrong about ${topic.toLowerCase()}.`,
    `SLIDE 3: Tip 1 - [your first key point].`,
    `SLIDE 4: Tip 2 - [your second key point].`,
    `SLIDE 5: Tip 3 - [your third key point].`,
    `SLIDE 6 (CTA): Found this useful? Follow for more - and DM "${tag}" to go deeper.`, ``,
    `CAPTION:`,
    `${topic} - the quick version. Swipe through, then save it.`,
    `Which point hit hardest? Tell me below.`, ``,
    `HASHTAGS: #${slug} #smallbusiness #entrepreneurtips #contentcreator #marketingtips #reels #growyourbusiness #tipsandtricks`, ``,
    `(Draft only - review, then post it to ${platform} yourself.)`,
  ].join('\n')
}

const carouselCheck: ScheduledCheck = {
  key: 'carousel',
  label: 'Carousel',
  check: (rows, today) => {
    const items = rows.filter((r) => r.category === 'content')
    if (!items.length) return []
    const r = items[Math.floor(Date.parse(today) / 86_400_000) % items.length]
    return [
      {
        idempotencyKey: `carousel:${r.id}:${today}`,
        payload: { row_id: r.id, channel: 'instagram', text: carouselDraft(r) },
        text: `\ud83c\udfa0 Today's carousel: <b>${r.title}</b> \u2014 draft the slides + caption for you to post?`,
      },
    ]
  },
}

export const SCHEDULED: ScheduledCheck[] = [overdueInvoiceCheck, carouselCheck]
