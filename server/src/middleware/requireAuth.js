import jwt from "jsonwebtoken";

export function requireAuth(req, res, next) {
  const token = req.cookies?.session;
  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    req.userId = payload.user_id;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid session" });
  }
}
