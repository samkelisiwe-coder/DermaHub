// This runs on Vercel's server, never in the browser — so the API key
// stored in your Vercel environment variables is never exposed publicly.

// ── RATE LIMITING ──
// Caps how many chat messages a single visitor (by IP address) can send
// per minute, to protect your Anthropic API budget from spam or abuse.
//
// Note: this uses simple in-memory storage, which resets whenever this
// function "cold starts" (e.g. after a period of no traffic) and is not
// perfectly shared across multiple concurrent server instances under
// heavy load. For a student project / early-stage app this is a solid,
// zero-cost first line of defence. If DermaHub grows significantly and
// you want airtight limits, the next step up is a shared store like
// Upstash Redis (works natively with Vercel) — ask if you want that added.

const RATE_LIMIT = 8;           // max messages
const RATE_WINDOW_MS = 60000;   // per 60 seconds
const requestLog = new Map();   // ip -> array of request timestamps

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (requestLog.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  timestamps.push(now);
  requestLog.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  if (isRateLimited(ip)) {
    return res.status(429).json({
      error: 'rate_limited',
      message: "You're sending messages a little too quickly. Please wait a moment and try again."
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'Server is missing the ANTHROPIC_API_KEY environment variable. Add it in your Vercel project settings.'
    });
  }

  try {
    const { messages, system } = req.body || {};

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Request must include a "messages" array.' });
    }

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1000,
        system: system || '',
        messages: messages
      })
    });

    const data = await anthropicRes.json();
    return res.status(anthropicRes.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reach Anthropic API', details: String(err) });
  }
};
