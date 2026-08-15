// Deliverable 6 v2.0 — vendor documentation change monitor.
// Single script, config-driven, no framework: fetch each vendor prompting-
// docs URL on its own poll interval, hash the content after stripping
// volatile page noise, and flag when the hash changes. Zero LLM cost —
// this is HTTP + node:crypto only. See
// docs/06-news-scraper-requirements.md for the full spec this implements
// (FR-1 through FR-15).
//
// Run from server/: node scripts/monitor.mjs
// Needs DATABASE_URL (+ DATABASE_SSL=true off-Render, see check-links.mjs)
// for FR-9, and GITHUB_TOKEN + GITHUB_REPOSITORY (both auto-provided by
// GitHub Actions) to open a notification issue. Both are optional — a
// local run without them still checks everything and prints a summary,
// it just can't write back to the DB or notify.
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { pool } from "../src/db/pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, "monitor-config.json");
const STATE_DIR = join(__dirname, "monitor-state");
const STATE_PATH = join(STATE_DIR, "state.json");
const CHANGES_PATH = join(STATE_DIR, "changes.json");

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
const state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, "utf8")) : {};
const changes = existsSync(CHANGES_PATH) ? JSON.parse(readFileSync(CHANGES_PATH, "utf8")) : [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// FR-2 — strip elements that change on every render without the actual
// documentation content changing. Verbatim from the spec; per-site tuning
// happens here once the 7-day false-positive trial surfaces real noise.
function stripVolatile(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\s+on\w+="[^"]*"/gi, "")
    .replace(/\s+nonce="[^"]*"/gi, "")
    .replace(/<meta[^>]*name=["'](csrf|token|session)[^>]*>/gi, "")
    .replace(/\.[a-f0-9]{8,}\.(js|css)/gi, ".HASH.$1")
    .replace(/\s+/g, " ")
    .trim();
}

function hashContent(entry, rawText) {
  // .md responses (see open question 4 — verified at build time for both
  // OpenAI URLs) are already clean; the HTML strip rules would just waste
  // time on text that has no <script> tags or nonces to remove.
  const cleaned = entry.contentType === "markdown" ? rawText.replace(/\s+/g, " ").trim() : stripVolatile(rawText);
  return createHash("sha256").update(cleaned).digest("hex");
}

// FR-12 — bounded manual redirect follow so an infinite/long chain gets
// flagged as a failure instead of hanging or silently following forever.
async function fetchWithRedirects(url, opts, maxRedirects) {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await fetch(current, { ...opts, redirect: "manual" });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location"), current).toString();
      continue;
    }
    return res;
  }
  throw new Error(`Exceeded ${maxRedirects} redirects`);
}

const lastRequestByDomain = {};
async function politeWait(url) {
  const domain = new URL(url).hostname;
  const last = lastRequestByDomain[domain] || 0;
  const wait = config.politenessDelayMs - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  lastRequestByDomain[domain] = Date.now();
}

function isDue(entry) {
  const s = state[entry.url];
  if (!s?.lastCheckedAt) return true;
  const dueAt = new Date(s.lastCheckedAt).getTime() + entry.pollIntervalHours * 3600 * 1000;
  return Date.now() >= dueAt;
}

async function checkOne(entry) {
  await politeWait(entry.url);
  const previousState = state[entry.url] || { consecutiveFailures: 0 };
  const headers = { "User-Agent": config.userAgent };
  if (previousState.etag) headers["If-None-Match"] = previousState.etag;
  if (previousState.lastModified) headers["If-Modified-Since"] = previousState.lastModified;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const res = await fetchWithRedirects(entry.url, { headers, signal: controller.signal }, config.maxRedirects);
    clearTimeout(timeout);

    if (res.status === 304) {
      return { ...previousState, lastCheckedAt: new Date().toISOString(), consecutiveFailures: 0, status: "ok" };
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const text = await res.text();
    const newHash = hashContent(entry, text);
    const changed = previousState.hash && previousState.hash !== newHash;

    if (changed) {
      changes.push({
        url: entry.url,
        vendor: entry.vendor,
        pageTitle: entry.pageTitle,
        detectedAt: new Date().toISOString(),
        oldHash: previousState.hash,
        newHash,
        reviewed: false,
        learnImpacting: Boolean(entry.learnImpacting),
      });
    }

    return {
      hash: newHash,
      etag: res.headers.get("etag") || undefined,
      lastModified: res.headers.get("last-modified") || undefined,
      lastCheckedAt: new Date().toISOString(),
      lastChangedAt: changed ? new Date().toISOString() : previousState.lastChangedAt,
      consecutiveFailures: 0,
      status: "ok",
      changedThisRun: changed,
    };
  } catch (err) {
    clearTimeout(timeout);
    const consecutiveFailures = (previousState.consecutiveFailures || 0) + 1;
    console.error(`[monitor] ${entry.url} failed (${consecutiveFailures}x): ${err.message}`);
    return {
      ...previousState,
      consecutiveFailures,
      lastCheckedAt: new Date().toISOString(),
      status: consecutiveFailures >= config.failureThreshold ? "possibly_broken" : "error",
    };
  }
}

// FR-9 — best-effort, same fire-and-forget spirit as the rest of this
// project's DB writes: a resources row that doesn't exist yet (not every
// monitored URL was in the Phase 3 seed — see server/calibration notes on
// skipped rows) shouldn't fail the whole run.
async function updateResourceRow(entry, result) {
  const matchUrl = entry.resourceMatchUrl || entry.url;
  const verificationStatus =
    result.status === "ok" ? "verified" : result.status === "possibly_broken" ? "broken" : "stale";
  try {
    await pool.query(
      "UPDATE resources SET verification_status = $1, last_verified_at = now() WHERE url = $2",
      [verificationStatus, matchUrl]
    );
  } catch (err) {
    console.error(`[monitor] Failed to update resources row for ${matchUrl}:`, err.message);
  }
}

async function notify(runChanges, brokenUrls) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) {
    console.log("[monitor] No GITHUB_TOKEN/GITHUB_REPOSITORY — skipping notification (local run).");
    return;
  }
  const lines = [];
  if (runChanges.length > 0) {
    lines.push("## Changed pages", "");
    for (const c of runChanges) {
      lines.push(`- ${c.learnImpacting ? "**[learn-impacting]** " : ""}${c.vendor} — [${c.pageTitle}](${c.url})`);
    }
    lines.push("");
  }
  if (brokenUrls.length > 0) {
    lines.push("## Possibly broken (3+ consecutive failures)", "");
    for (const u of brokenUrls) lines.push(`- ${u}`);
  }
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": config.userAgent,
    },
    body: JSON.stringify({
      title: `Vendor doc monitor: ${runChanges.length} change(s), ${brokenUrls.length} broken — ${new Date().toISOString().slice(0, 10)}`,
      body: lines.join("\n"),
      labels: ["vendor-doc-monitor"],
    }),
  });
  if (!res.ok) {
    console.error(`[monitor] Failed to create notification issue: HTTP ${res.status}`);
  }
}

async function main() {
  const start = Date.now();
  const dueEntries = config.urls.filter(isDue);
  console.log(`[monitor] ${dueEntries.length} of ${config.urls.length} URLs due this run.`);

  let checked = 0;
  let changedCount = 0;
  let failed = 0;
  const brokenUrls = [];
  const runChangeCountBefore = changes.length;

  for (const entry of dueEntries) {
    const result = await checkOne(entry);
    state[entry.url] = result;
    checked++;
    if (result.status !== "ok") failed++;
    if (result.status === "possibly_broken") brokenUrls.push(entry.url);
    if (result.changedThisRun) changedCount++;
    await updateResourceRow(entry, result);
  }

  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
  writeFileSync(CHANGES_PATH, JSON.stringify(changes, null, 2) + "\n");

  const runChanges = changes.slice(runChangeCountBefore);
  if (runChanges.length > 0 || brokenUrls.length > 0) {
    await notify(runChanges, brokenUrls);
  }

  const seconds = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `[monitor] Done in ${seconds}s — checked ${checked}, changed ${changedCount}, failed ${failed}, possibly_broken ${brokenUrls.length}.`
  );
  await pool.end();
}

main().catch((err) => {
  console.error("[monitor] Fatal error:", err);
  process.exit(1);
});
