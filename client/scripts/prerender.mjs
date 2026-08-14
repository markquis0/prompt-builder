import handler from "serve-handler";
import http from "node:http";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "..", "dist");
const PORT = 4888;

// Routes to prerender. Add new /learn sub-pages here as they're added.
// "/" overwrites dist/index.html in place with the prerendered homepage —
// still the same hydratable SPA shell underneath, just with real content
// baked in instead of an empty <div id="root">.
const ROUTES = [
  "/",
  "/learn",
  "/learn/what-works",
  "/learn/what-doesnt",
  "/learn/by-model",
  "/learn/checklist",
  "/learn/context-engineering",
  "/learn/resources",
  "/pro",
  "/resources",
];

// Vercel's build container is missing the shared libraries plain `puppeteer`'s
// downloaded Chromium needs (e.g. libnspr4.so — Puppeteer/Chromium in
// serverless/minimal-Linux fails with "error while loading shared libraries").
// @sparticuz/chromium ships a Chromium build made for exactly that environment.
// Its binary is Linux-only though, so local dev (macOS) keeps using plain
// puppeteer, which already works fine there.
async function launchBrowser() {
  if (process.env.VERCEL) {
    const [{ default: chromium }, { default: puppeteerCore }] = await Promise.all([
      import("@sparticuz/chromium"),
      import("puppeteer-core"),
    ]);
    return puppeteerCore.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  const { default: puppeteer } = await import("puppeteer");
  return puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
}

async function prerender() {
  const server = http.createServer((req, res) =>
    handler(req, res, {
      public: DIST,
      rewrites: [{ source: "**", destination: "/index.html" }],
    })
  );
  await new Promise((resolve) => server.listen(PORT, resolve));

  const browser = await launchBrowser();

  try {
    for (const route of ROUTES) {
      const page = await browser.newPage();
      await page.goto(`http://localhost:${PORT}${route}`, { waitUntil: "networkidle0" });

      // Give react-helmet-async a beat to inject <head> tags on top of Vite's
      // default index.html title before we snapshot the DOM.
      await page
        .waitForFunction(() => document.title !== "" && !document.title.includes("Vite"), {
          timeout: 5000,
        })
        .catch(() => {
          console.warn(`⚠ Title not set for ${route} — prerendering anyway`);
        });

      const html = await page.content();
      const outDir = join(DIST, route);
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, "index.html"), html);
      console.log(`✓ Prerendered ${route}`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

prerender().catch((err) => {
  console.error("Prerender failed:", err);
  process.exit(1);
});
