const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Clamps rather than rejects — a client asking for a huge page (or an
// invalid one) just gets capped/defaulted, same as a normal pagination API,
// not treated as a validation error the way oversized content is elsewhere
// in this codebase.
export function parsePagination(query) {
  const rawLimit = Number.parseInt(query.limit, 10);
  const rawOffset = Number.parseInt(query.offset, 10);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT;
  const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  return { limit, offset };
}
