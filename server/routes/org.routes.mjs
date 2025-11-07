// server/routes/org.routes.mjs
import { Router } from "express";
import { z } from "zod";
import { db } from "../db.mjs";
import { requireAuth } from "../middleware/requireAuth.mjs";

const r = Router();

/** Get current org profile (id, name, slug, company_description) */
r.get("/api/org/profile", requireAuth(), async (req, res, next) => {
  try {
    const orgId = Number(req.auth.orgId);
    const org = await db("organizations")
      .select("id", "name", "slug", "company_description")
      .where({ id: orgId })
      .first();

    if (!org) return res.status(404).json({ error: "org_not_found" });
    return res.json({ org });
  } catch (e) {
    next(e);
  }
});

/** Update company_description (upsert-style update on the org row) */
const Body = z.object({
  company_description: z.string().trim().max(20000).optional().default(""),
});
r.post("/api/org/profile", requireAuth(), async (req, res, next) => {
  try {
    const orgId = Number(req.auth.orgId);
    const body = Body.parse(req.body);

    const updated = await db("organizations")
      .where({ id: orgId })
      .update(
        { company_description: body.company_description, updated_at: db.fn.now() },
        ["id", "name", "slug", "company_description"]
      );

    return res.json({ org: updated?.[0] || null, saved: true });
  } catch (e) {
    next(e);
  }
});

export default r;
