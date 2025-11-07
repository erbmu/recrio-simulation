// server/middleware/requireAuth.mjs
import jwt from "jsonwebtoken";
import { db } from "../db.mjs";

const HEADER = "authorization";
const PREFIX = "bearer ";

function getToken(req) {
  const h = req.get(HEADER);
  if (!h) return "";
  const v = h.trim();
  return v.toLowerCase().startsWith(PREFIX) ? v.slice(PREFIX.length).trim() : v;
}

export function requireAuth() {
  return async (req, res, next) => {
    try {
      const token = getToken(req);
      if (!token) return res.status(401).json({ error: "unauthorized" });

      const secret = process.env.JWT_SECRET;
      if (!secret) return res.status(500).json({ error: "server_misconfigured" });

      let payload;
      try {
        payload = jwt.verify(token, secret);
      } catch {
        return res.status(401).json({ error: "unauthorized" });
      }

      // Normalize shapes:
      // dashboard token might be: { id, org_id, email }
      // ATS token is: { userId, orgId, email }
      let userId = payload.userId ?? payload.id ?? null;
      let orgId = payload.orgId ?? payload.org_id ?? null;
      const email = payload.email ?? null;

      if (!userId) return res.status(401).json({ error: "unauthorized" });

      // If orgId missing, fetch from DB
      if (!orgId) {
        const u = await db("users").where({ id: userId }).first();
        if (!u) return res.status(401).json({ error: "unauthorized" });
        orgId = u.org_id;
        if (!orgId) return res.status(401).json({ error: "auth_incomplete" });
      }

      req.auth = { userId: Number(userId), orgId: Number(orgId), email };
      return next();
    } catch (e) {
      return res.status(500).json({ error: "internal_error" });
    }
  };
}

export default requireAuth;
