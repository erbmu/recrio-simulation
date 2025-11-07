// server/routes/jobs.mjs
import express from "express";
import { PrismaClient } from "@prisma/client";
import { auth as requireAuth } from "../middleware/auth.mjs";

const prisma = new PrismaClient();
const router = express.Router();

const PUBLIC_APPLY_BASE = process.env.PUBLIC_APPLY_BASE || "http://localhost:5173";
const applyUrl = (orgSlug, jobSlug) =>
  `${PUBLIC_APPLY_BASE}/apply/${encodeURIComponent(orgSlug)}/${encodeURIComponent(jobSlug)}`;

// tiny slugify
function slugify(s = "") {
  return String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 80) || "job";
}

/** GET /api/jobs  */
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const orgId = BigInt(req.user.orgId || req.user.org_id || 0);

    const rows = await prisma.jobs.findMany({
      // your schema doesn't have deleted_at: use a simple org filter
      where: { organizations: { id: orgId } },
      orderBy: { created_at: "desc" },
      select: {
        id: true,
        org_id: true,
        slug: true,
        title: true,
        description: true,
        qualifications: true,
        work_type: true,
        employment_type: true,
        location: true,
        salary: true,
        applicants: true,
        created_at: true,
        is_published: true,
        organizations: { select: { slug: true } },
      },
    });

    const jobs = rows.map((j) => ({
      id: j.id?.toString?.() ?? j.id,
      org_id: j.org_id?.toString?.() ?? j.org_id,
      slug: j.slug,
      title: j.title,
      description: j.description,
      qualifications: j.qualifications,
      work_type: j.work_type,
      employment_type: j.employment_type,
      location: j.location,
      salary: j.salary,
      applicants: j.applicants ?? 0,
      created_at: j.created_at,
      is_published: j.is_published,
      apply_url: j.organizations?.slug ? applyUrl(j.organizations.slug, j.slug) : null,
    }));

    res.json({ jobs });
  } catch (e) {
    next(e);
  }
});

/** POST /api/jobs */
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const orgId = BigInt(req.user.orgId || req.user.org_id || 0);
    const {
      title = "",
      description = "",
      qualifications = "",
      workType = "",
      employmentType = "",
      location = "",
      salary = "",
    } = req.body || {};

    if (!title.trim() || !description.trim()) {
      return res.status(400).json({ error: "Title and description are required." });
    }

    // your schema requires NOT NULL for these two
    const employment = employmentType && employmentType.trim() ? employmentType.trim() : "Full-time";
    const loc = location && location.trim() ? location.trim() : "Remote";

    // org-unique slug
    const base = slugify(title);
    let slug = base;
    let n = 1;
    while (true) {
      const exists = await prisma.jobs.findFirst({
        where: { organizations: { id: orgId }, slug },
      });
      if (!exists) break;
      n += 1;
      slug = `${base}-${n}`;
    }

    const created = await prisma.jobs.create({
      data: {
        // connect the required relation (don't also pass org_id)
        organizations: { connect: { id: orgId } },
        slug,
        title: title.trim(),
        description: description.trim(),
        qualifications: qualifications?.trim() || null,
        work_type: workType || null,
        employment_type: employment, // NOT NULL
        location: loc,               // NOT NULL
        salary: salary || null,
        is_published: true,
        applicants: 0,
        published_at: new Date(),
      },
      select: {
        id: true,
        org_id: true,
        slug: true,
        title: true,
        description: true,
        qualifications: true,
        work_type: true,
        employment_type: true,
        location: true,
        salary: true,
        applicants: true,
        created_at: true,
        is_published: true,
        organizations: { select: { slug: true } },
      },
    });

    const job = {
      id: created.id?.toString?.() ?? created.id,
      org_id: created.org_id?.toString?.() ?? created.org_id,
      slug: created.slug,
      title: created.title,
      description: created.description,
      qualifications: created.qualifications,
      work_type: created.work_type,
      employment_type: created.employment_type,
      location: created.location,
      salary: created.salary,
      applicants: created.applicants ?? 0,
      created_at: created.created_at,
      is_published: created.is_published,
      apply_url: created.organizations?.slug ? applyUrl(created.organizations.slug, created.slug) : null,
    };

    res.json({ job });
  } catch (e) {
    next(e);
  }
});

export default router;
