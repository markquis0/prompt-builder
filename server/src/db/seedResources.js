import { pool } from "./pool.js";

// Starter set only — NOT the full ~72-row research inventory. Every entry
// here is a real, already-verified URL with a curation note grounded in
// content already published on /learn (Phase 1), not invented for this
// seed. Run server/scripts/seed-resources.mjs against the real
// sources-inventory.csv to replace/expand this once it's available.
const STARTER_RESOURCES = [
  {
    name: "Learn Prompting — Introduction",
    url: "https://learnprompting.org/docs/introduction",
    organization: "Learn Prompting",
    category: "tutorial",
    audience: "beginner",
    modelFamily: [],
    curationNote:
      "The most approachable starting point if you've never written a structured prompt before — no assumed background.",
  },
  {
    name: "Google Workspace with Gemini Prompt Guide",
    url: "https://workspace.google.com/learning/content/gemini-prompt-guide",
    organization: "Google",
    category: "official_docs",
    audience: "beginner",
    modelFamily: ["gemini"],
    isDownloadable: true,
    downloadUrl: "https://workspace.google.com/learning/content/gemini-prompt-guide",
    curationNote:
      "Organized by job role rather than by technique — useful if you want to see prompts for your actual day job, not abstract examples.",
  },
  {
    name: "Prompt Engineering Guide",
    url: "https://www.promptingguide.ai/",
    organization: "DAIR.AI",
    category: "community",
    audience: "practitioner",
    modelFamily: [],
    curationNote:
      "The most comprehensive single reference for prompting techniques across models — good for looking something up, less good for a first read start-to-finish.",
  },
  {
    name: "Prompt engineering overview",
    url: "https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview",
    organization: "Anthropic",
    category: "official_docs",
    audience: "practitioner",
    modelFamily: ["claude"],
    curationNote:
      "States the three preconditions for prompt engineering (success criteria, a way to test against them, a first draft) before anything else — worth reading even if you don't use Claude.",
  },
  {
    name: "Prompt guidance",
    url: "https://developers.openai.com/api/docs/guides/latest-model",
    organization: "OpenAI",
    category: "official_docs",
    audience: "practitioner",
    modelFamily: ["gpt"],
    curationNote:
      "Documents how prompting differs by GPT-5.x reasoning-effort setting — the one thing most other guides miss about current OpenAI models.",
  },
  {
    name: "Prompt design strategies",
    url: "https://ai.google.dev/gemini-api/docs/prompting-strategies",
    organization: "Google",
    category: "official_docs",
    audience: "practitioner",
    modelFamily: ["gemini"],
    curationNote:
      "Source of the instruction-placement rule (put your question after long context, not before) — the single most-overlooked piece of model-specific guidance we found.",
  },
  {
    name: "The Prompt Report",
    url: "https://arxiv.org/abs/2406.06608",
    organization: null,
    category: "research",
    audience: "builder",
    modelFamily: [],
    curationNote:
      "The field's canonical technique taxonomy — 58 techniques cataloged and named. Useful as a reference, not a page-turner.",
  },
  {
    name: "Prompting Science Reports",
    url: "https://gail.wharton.upenn.edu/research-and-insights/",
    organization: "Wharton GAIL",
    category: "research",
    audience: "builder",
    modelFamily: [],
    curationNote:
      "The source for most of what didn't survive testing on this site — persona prompting, chain-of-thought on reasoning models, politeness. Read this before trusting any prompting advice on social media.",
  },
  {
    name: 'When "A Helpful Assistant" Is Not Really Helpful',
    url: "https://aclanthology.org/2024.findings-emnlp.888/",
    organization: "EMNLP 2024",
    category: "research",
    audience: "builder",
    modelFamily: [],
    curationNote:
      "The peer-reviewed source for \"assigning a persona doesn't improve accuracy\" — 162 roles, 2,410 questions, tested directly.",
  },
  {
    name: "Structured Context Engineering for File-Native Agentic Systems",
    url: "https://arxiv.org/abs/2602.05447",
    organization: "McMillan (2026)",
    category: "research",
    audience: "builder",
    modelFamily: [],
    curationNote:
      "The source for \"format doesn't matter, model tier and context retrieval do\" — 9,649 experiments across 11 models and 4 formats.",
  },
  {
    name: "Simon Willison's Weblog",
    url: "https://simonwillison.net/",
    organization: null,
    category: "community",
    audience: "practitioner",
    modelFamily: [],
    curationNote:
      "The best ongoing, practitioner-level commentary on what's actually changing in this field week to week, not just what vendors announce.",
  },
  {
    name: "One Useful Thing",
    url: "https://www.oneusefulthing.org/",
    organization: null,
    category: "community",
    audience: "practitioner",
    modelFamily: [],
    curationNote:
      "Ethan Mollick's newsletter — a reliable second opinion on whether a new prompting claim is real or hype, from someone who runs the actual experiments.",
  },
];

// Idempotent, same reason applySchema() runs on every boot rather than as a
// one-time migration: Render's free tier has no Shell access, so there's no
// way to run a one-off script against production. Only inserts if the table
// is empty, so this is safe to leave in the boot sequence indefinitely —
// once the real CSV is seeded via seed-resources.mjs, this becomes a no-op.
export async function seedStarterResources() {
  if (!process.env.DATABASE_URL) return;
  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM resources");
  if (rows[0].count > 0) return;

  for (const r of STARTER_RESOURCES) {
    await pool.query(
      `INSERT INTO resources
        (name, url, organization, category, audience, model_family,
         is_downloadable, download_url, curation_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        r.name,
        r.url,
        r.organization,
        r.category,
        r.audience,
        r.modelFamily,
        Boolean(r.isDownloadable),
        r.downloadUrl || null,
        r.curationNote,
      ]
    );
  }
  console.log(`[prompt-builder] Seeded ${STARTER_RESOURCES.length} starter resources.`);
}
