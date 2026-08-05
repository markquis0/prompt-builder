import Anthropic from "@anthropic-ai/sdk";

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    "[prompt-builder] ANTHROPIC_API_KEY is not set — LLM calls will fail. Copy server/.env.example to server/.env and add your key."
  );
}

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
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
