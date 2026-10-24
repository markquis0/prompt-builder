import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";

// No database needed: this only exercises the model-call wrapper's logging.
const { anthropic, callClaude } = await import("../src/lib/anthropic.js");

async function logsFor(error) {
  const original = anthropic.messages.create;
  const lines = [];
  const originalLog = console.error;
  anthropic.messages.create = async () => {
    throw error;
  };
  console.error = (...args) => lines.push(args.join(" "));
  try {
    await assert.rejects(callClaude({ system: "s", userMessage: "u" }), (err) => err === error);
  } finally {
    anthropic.messages.create = original;
    console.error = originalLog;
  }
  return lines;
}

const apiError = (status, type, message) =>
  new Anthropic.APIError(status, { type: "error", error: { type, message } }, message, {});

test("a rejected API key is logged with its status, reason and what to do about it", async () => {
  const lines = await logsFor(apiError(401, "authentication_error", "invalid x-api-key"));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /status=401 type=authentication_error reason="invalid x-api-key"/);
  assert.match(lines[0], /ANTHROPIC_API_KEY/);
});

test("an empty credit balance (a 400) is flagged as needing an operator too", async () => {
  const lines = await logsFor(apiError(400, "invalid_request_error", "Your credit balance is too low to access the API."));
  assert.match(lines[0], /status=400/);
  assert.match(lines[0], /credit balance/);
});

test("a transient rate limit is logged but not flagged as permanent", async () => {
  const lines = await logsFor(apiError(429, "rate_limit_error", "Rate limited"));
  assert.match(lines[0], /status=429 type=rate_limit_error/);
  assert.doesNotMatch(lines[0], /will not fix itself/);
});

test("the original error still propagates so routes respond exactly as before", async () => {
  const err = apiError(401, "authentication_error", "invalid x-api-key");
  await logsFor(err); // asserts the same instance is rethrown
});
