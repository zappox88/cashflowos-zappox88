import Anthropic from '@anthropic-ai/sdk'

// üì£ The Content agent ‚Äî a DRAFT-ONLY AI-video post generator.
// Turns ONE idea into a platform-ready post package (generation prompt, caption,
// hashtags, schedule). It NEVER posts anywhere and never touches your records ‚Äî
// it only hands you copy-paste-ready text. Mirrors the /video-post skill.

// Trigger detection is deliberately NARROW so it doesn't steal ordinary
// "what content is scheduled?" questions from the Jarvis Q&A loop.
export function isContentRequest(text: string): boolean {
  const t = text.trim()
  if (/^\/(content|videopost|video-post)\b/i.test(t)) return true
  if (/\bvideo post\b/i.test(t)) return true
  if (/\bmake (me )?(a )?(reel|short|tiktok|video|ig|instagram)\b/i.test(t)) return true
  return false
}

// Strip the command word so the brief is just the idea.
export function extractBrief(text: string): string {
  return text.replace(/^\/(content|videopost|video-post)\b\s*/i, '').trim()
}

const SYSTEM =
  `You are the Content agent inside a business owner's Telegram assistant. You turn ONE ` +
  `idea into a platform-ready AI-video post PACKAGE they can copy-paste. You DRAFT only ‚Äî ` +
  `you never post anything and never claim to have posted.\n` +
  `From the brief, infer the idea, platform(s) and goal; if unstated, default to Instagram Reels / grow followers.\n` +
  `Produce, per platform, in this order:\n` +
  `1) üé• an AI-video generation prompt (shot-by-shot for Sora/Runway/Veo: style, pacing, on-screen text, a 3-second hook),\n` +
  `2) ‚úçÔ∏è a caption tailored to that platform with a clear call-to-action,\n` +
  `3) üè∑Ô∏è hashtags (broad + niche mix),\n` +
  `4) ‚è∞ a suggested posting time.\n` +
  `RULES: the hook's first line is ‚â§ 8 words; never invent fake stats, testimonials or claims; keep it skimmable; ` +
  `use Telegram HTML only (<b>,<i>,<code>) ‚Äî never Markdown asterisks; end by reminding them to review and that you won't post for them.`

export async function draftVideoPost(brief: string, apiKey: string): Promise<string> {
  if (!brief) {
    return (
      `üì£ <b>Content agent</b> ‚Äî give me three things: the <b>idea</b>, the <b>platform(s)</b>, and the <b>goal</b>.\n` +
      `Example: <code>/content how to clone yourself in 10 min ¬∑ Instagram ¬∑ grow followers</code>`
    )
  }
  try {
    const anthropic = new Anthropic({ apiKey })
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1600,
      system: SYSTEM,
      messages: [{ role: 'user', content: brief }],
    })
    const out = res.content
      .filter((c): c is Anthropic.TextBlock => c.type === 'text')
      .map(c => c.text)
      .join('\n')
      .trim()
    return out || 'I couldn\'t draft that ‚Äî try rephrasing your idea.'
  } catch (e) {
    console.error('[CFO] content agent error:', e)
    return '‚ö†Ô∏è I couldn\'t draft that right now ‚Äî check your ANTHROPIC_API_KEY has credit, then try again.'
  }
}
