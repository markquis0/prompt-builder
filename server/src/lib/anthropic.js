import Anthropic from "@anthropic-ai/sdk";

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    "[prompt-builder] ANTHROPIC_API_KEY is not set — LLM calls will fail. Copy server/.env.example to server/.env and add your key."
  );
}

// Defaults are 10 minutes / 2 retries — way past this app's 3s p95 target
// on LLM-calling endpoints, so a slow Anthropic response would hang far
// longer than any caller is actually waiting around for instead of failing
// fast. 20s is a wide margin over the 8.65s worst case actually measured
// against production for a heavy /assemble payload (see the incident this
// was raised for) while still closing the original 10-minute-hang problem
// by a large factor. This is the default for callers that don't need
// more — see callClaude()'s optional timeoutMs param below for how a
// specific call site (like assemble.js, which requests longer output and
// showed that heavier tail) can ask for its own longer per-call timeout
// instead of loosening this for every caller.
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 20000,
  maxRetries: 1,
});

export const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";

// Every model-backed route turns a failure here into a generic "please try
// again" for the user — right for a transient blip, but it hid a dead API key
// behind the same message (Retry can never fix a revoked key or an empty
// credit balance). So the cause is logged here, once, in one greppable line
// with Anthropic's own status and reason, whatever route made the call.
function logUpstreamError(err) {
  if (!(err instanceof Anthropic.APIError)) return;
  const type = err.error?.error?.type || "unknown";
  const reason = err.error?.error?.message || err.message;
  const needsOperator =
    err.status === 401 || err.status === 403 || /credit balance|billing/i.test(String(reason));
  console.error(
    `[prompt-builder] Anthropic API error: status=${err.status} type=${type} reason="${reason}"` +
      (needsOperator
        ? " — this will not fix itself: check ANTHROPIC_API_KEY (valid, not revoked) and the account's credit balance."
        : "")
  );
}

export async function callClaude({ system, userMessage, maxTokens = 1024, timeoutMs }) {
  let response;
  try {
    response = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: userMessage }],
      },
      timeoutMs ? { timeout: timeoutMs } : undefined
    );
  } catch (err) {
    logUpstreamError(err);
    throw err;
  }

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock) {
    throw new Error("Claude response contained no text content");
  }
  return textBlock.text;
}
