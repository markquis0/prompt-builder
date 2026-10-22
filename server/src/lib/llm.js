import { callClaude } from "./anthropic.js";

// A tiny indirection over the model call, used by the routes whose behavior
// tests need to drive without a real Anthropic key (Improve). Node 20 can't
// mock ES module imports, so tests replace `llm.call` on this shared object
// instead. In production it is simply callClaude.
export const llm = { call: callClaude };
