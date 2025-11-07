import { Router } from "express";
import { db } from "../db.mjs";

const r = Router();

// Tiny middleware to prove this router is being hit
r.use((req, _res, next) => {
  console.log(`[ORG-PUBLIC] ${req.method} ${req.originalUrl}`);
  next();
});

// GET /api/orgs/public/:orgId (mounted base adds the prefix)
r.get("/:orgId", async (req, res, next) => {
  try {
    const orgId = Number(req.params.orgId);
    if (!Number.isInteger(orgId) || orgId <= 0) {
      return res.status(400).json({ error: "bad_org_id" });
    }

    const org = await db("organizations")
      .select("id", "name", "slug", "company_description", "is_active")
      .where({ id: orgId })
      .first();

    if (!org || org.is_active === false) return res.status(404).json({ error: "not_found_org" });
    const { is_active, ...safe } = org;
    return res.json({ org: safe });
  } catch (e) { next(e); }
});

// GET /api/orgs/public/by-slug/:slug
r.get("/by-slug/:slug", async (req, res, next) => {
  try {
    const slug = String(req.params.slug || "").trim();
    if (!slug) return res.status(400).json({ error: "bad_slug" });

    const org = await db("organizations")
      .select("id", "name", "slug", "company_description", "is_active")
      .whereRaw("lower(slug) = lower(?)", [slug])
      .first();

    if (!org || org.is_active === false) return res.status(404).json({ error: "not_found_org" });
    const { is_active, ...safe } = org;
    return res.json({ org: safe });
  } catch (e) { next(e); }
});

export default r;
