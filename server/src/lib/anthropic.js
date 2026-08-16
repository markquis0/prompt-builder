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

export async function callClaude({ system, userMessage, maxTokens = 1024, timeoutMs }) {
  const response = await anthropic.messages.create(
    {
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userMessage }],
    },
    timeoutMs ? { timeout: timeoutMs } : undefined
  );

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock) {
    throw new Error("Claude response contained no text content");
  }
  return textBlock.text;
}
