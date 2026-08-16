// No APM/metrics service in this app - this is the entire observability
// layer for now. Structured JSON to stdout so Render's existing log stream
// captures it with no new infrastructure; enough to compute p95/p99
// latency and a 4xx/5xx error-rate split after the fact by grepping/
// piping the logs, which is what's actually needed to verify this app's
// SLOs (see the scalability review - there was previously no way to
// measure any of them at all).
export function requestLogger(req, res, next) {
  const startedAt = Date.now();
  res.on("finish", () => {
    console.log(
      JSON.stringify({
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
      })
    );
  });
  next();
}
