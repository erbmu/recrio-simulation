// server/routes/ats/jobs.routes.mjs
import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import { db } from "../../db.mjs";
import { requireAuth } from "../../middleware/requireAuth.mjs";

/* utils */
function cleanStr(v, max = 4000) {
  if (typeof v !== "string") return v;
  let s = v.replace(/\s+/g, " ").trim();
  if (s.length > max) s = s.slice(0, max);
  return s;
}
function baseSlug(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 80) || "job";
}
async function makeUniqueSlugGlobal(title) {
  const root = baseSlug(title);
  const rows = await db("jobs").select("slug").whereRaw(`slug ILIKE ?`, [`${root}%`]);
  const have = new Set(rows.map((r) => r.slug));
  if (!have.has(root)) return root;
  for (let n = 2; n <= 9999; n++) {
    const s = `${root}-${n}`;
    if (!have.has(s)) return s;
  }
  return `${root}-${Date.now()}`;
}
function newToken() {
  return crypto.randomBytes(16).toString("base64url");
}
function buildApplyUrl(job, orgSlug) {
  const base = process.env.PUBLIC_BASE_URL || "";
  if (!base) return null;
  const origin = base.replace(/\/+$/, "");
  if (job?.public_url_token) return `${origin}/apply/t/${job.public_url_token}`;
  if (orgSlug && job?.slug) return `${origin}/apply/${orgSlug}/${job.slug}`;
  return null;
}

const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contract", "Internship", "Other"];
const CreateSchema = z.object({
  title: z.preprocess((v) => cleanStr(v, 120), z.string().min(1, "Title required")),
  description: z.preprocess((v) => cleanStr(v, 4000), z.string().min(1, "Description required")),
  qualifications: z.preprocess((v) => cleanStr(v, 3000), z.string().optional().default("")),
  workType: z.preprocess((v) => cleanStr(v, 32), z.string().optional().default("")),
  employmentType: z.enum(EMPLOYMENT_TYPES, { required_error: "Employment type required" }),
  location: z.preprocess((v) => cleanStr(v, 160), z.string().min(1, "Location required")),
  salary: z.preprocess((v) => cleanStr(v, 160), z.string().optional().default("")),
});

const r = Router();

/* ------------------------------------------------------------------------- */
/* List jobs (recruiter) — includes live applicant count                      */
/* ------------------------------------------------------------------------- */
r.get("/", requireAuth(), async (req, res, next) => {
  try {
    const orgId = req.auth.orgId;

    // Count applications per job, tolerant to either job_id or jobId schema.
    // Postgres: quote "jobId" for camel column; COALESCE picks whichever exists per row.
    // subquery: count applications per job (Postgres)
    const countsSub = db("applications as a")
    .whereNotNull("a.job_id")
    .select("a.job_id")
    .count("* as c")
    .groupBy("a.job_id")
    .as("ac");

    const rows = await db("jobs as j")
      .join("organizations as o", "o.id", "j.org_id")
      .leftJoin(countsSub, "j.id", "ac.job_id")
      .where("j.org_id", orgId)
      .orderBy("j.id", "desc")
      .select(
        "j.id",
        "j.org_id",
        "j.title",
        "j.slug",
        "j.public_url_token",
        "j.description",
        "j.qualifications",
        "j.work_type",
        "j.employment_type",
        "j.location",
        "j.salary",
        "j.applicants",
        "j.created_at",
        "j.is_published",
        "o.slug as org_slug",
        db.raw("COALESCE(ac.c, 0)::int as app_count")
      );

    const jobs = rows.map((j) => ({
      id: j.id,
      org_id: j.org_id,
      title: j.title,
      slug: j.slug,
      description: j.description,
      qualifications: j.qualifications || "",
      work_type: j.work_type || "",
      employment_type: j.employment_type || "",
      location: j.location || "",
      salary: j.salary || "",
      // prefer live count; fall back to denormalized column
      applicants: Number(j.app_count ?? j.applicants ?? 0),
      created_at: j.created_at,
      is_published: j.is_published,
      apply_url: buildApplyUrl(j, j.org_slug),
    }));

    res.json({ jobs });
  } catch (e) {
    next(e);
  }
});

/* Tiny meta */
r.get("/:id/meta", requireAuth(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "bad_id" });
    const row = await db("jobs").where({ id, org_id: req.auth.orgId }).select("id", "title", "slug").first();
    if (!row) return res.status(404).json({ error: "not_found" });
    res.json({ id: row.id, title: row.title, slug: row.slug });
  } catch (e) {
    next(e);
  }
});

/* Create job */
r.post("/", requireAuth(), async (req, res, next) => {
  try {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues?.[0]?.message || "Invalid payload";
      return res.status(400).json({ error: msg });
    }
    const { title, description, qualifications, workType, employmentType, location, salary } = parsed.data;

    const orgId = req.auth.orgId;
    const org = await db("organizations").where({ id: orgId }).select("slug").first();

    let slug = await makeUniqueSlugGlobal(title);
    let tok = newToken();
    const MAX_RETRIES = 4;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const [inserted] = await db("jobs")
          .insert({
            org_id: orgId,
            title,
            slug,
            public_url_token: tok,
            description,
            qualifications,
            work_type: workType || null,
            employment_type: employmentType,
            location,
            salary: salary || null,
            is_published: true,
            published_at: db.fn.now(),
            applicants: 0,
          })
          .returning([
            "id",
            "org_id",
            "title",
            "slug",
            "public_url_token",
            "description",
            "qualifications",
            "work_type",
            "employment_type",
            "location",
            "salary",
            "created_at",
          ]);

        return res.json({
          job: {
            ...inserted,
            apply_url: buildApplyUrl(inserted, org?.slug),
          },
        });
      } catch (e) {
        const isUnique = e?.code === "23505";
        if (!isUnique) throw e;

        if (/jobs_slug_key|jobs_org_id_slug_unique/i.test(e.message || "")) {
          slug = await makeUniqueSlugGlobal(title);
        } else if (/public_url_token/i.test(e.message || "")) {
          tok = newToken();
        } else {
          tok = newToken();
          slug = await makeUniqueSlugGlobal(title);
        }

        if (attempt === MAX_RETRIES) {
          return res.status(409).json({ error: "duplicate_identifiers" });
        }
      }
    }
  } catch (e) {
    next(e);
  }
});

/* Public by token */
r.get("/public/by-token/:token", async (req, res, next) => {
  try {
    const tok = String(req.params.token || "").trim();
    if (!tok) return res.status(400).json({ error: "bad_token" });

    const row = await db("jobs as j")
      .join("organizations as o", "o.id", "j.org_id")
      .where("j.public_url_token", tok)
      .andWhere("j.is_published", true)
      .select(
        "j.org_id",
        "j.id",
        "j.title",
        "j.slug",
        "j.description",
        "j.qualifications",
        "j.work_type",
        "j.employment_type",
        "j.location",
        "j.salary",
        "o.slug as org_slug"
      )
      .first();

    if (!row) return res.status(404).json({ error: "not_found" });
    res.json({ job: row });
  } catch (e) {
    next(e);
  }
});

/* Public by org/job slug */
r.get("/public/:orgSlug/:jobSlug", async (req, res, next) => {
  try {
    const { orgSlug, jobSlug } = req.params;
    const row = await db("jobs as j")
      .join("organizations as o", "o.id", "j.org_id")
      .where("o.slug", orgSlug)
      .andWhere("j.slug", jobSlug)
      .andWhere("j.is_published", true)
      .select(
        "j.org_id",
        "j.id",
        "j.title",
        "j.slug",
        "j.description",
        "j.qualifications",
        "j.work_type",
        "j.employment_type",
        "j.location",
        "j.salary",
        "o.slug as org_slug"
      )
      .first();

    if (!row) return res.status(404).json({ error: "not_found" });
    res.json({ job: row });
  } catch (e) {
    next(e);
  }
});

/* DELETE job (recruiter) */
r.delete("/:id", requireAuth(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "bad_id" });
    }

    const deleted = await db.transaction(async (trx) => {
      const job = await trx("jobs").where({ id }).first().forUpdate();
      if (!job) return "not_found";
      if (Number(job.org_id) !== Number(req.auth.orgId)) return "forbidden";
      await trx("jobs").where({ id }).del();
      return true;
    });

    if (deleted === "not_found") return res.status(404).json({ error: "not_found" });
    if (deleted === "forbidden") return res.status(403).json({ error: "forbidden" });

    return res.json({ deleted: true });
  } catch (e) {
    return next(e);
  }
});

export default r;
