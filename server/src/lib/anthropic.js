import Anthropic from "@anthropic-ai/sdk";

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    "[prompt-builder] ANTHROPIC_API_KEY is not set — LLM calls will fail. Copy server/.env.example to server/.env and add your key."
  );
}

// Defaults are 10 minutes / 2 retries — way past this app's 3s p95 target
// on LLM-calling endpoints, so a slow Anthropic response would hang far
// longer than any caller is actually waiting around for instead of failing
// fast. timeout is generous headroom over 3s, not a tight budget.
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 9000,
  maxRetries: 1,
});

export const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";

export async function callClaude({ system, userMessage, maxTokens = 1024 }) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock) {
    throw new Error("Claude response contained no text content");
  }
  return textBlock.text;
}
