// server/routes/ats/applications.routes.mjs
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db.mjs";
import { upload } from "../../middleware/upload.mjs";
import { requireAuth } from "../../middleware/requireAuth.mjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  fetchSimulationAnalyses,
  fetchSimulationAnalysis,
  fetchSimulationResponsesAndViolations,
  fetchIdentityCheck,
  computeOverallFromReport,
} from "../../lib/supabaseAnalysis.mjs";

/* ------------------------------------------------------------------------- */
/* Simulation Edge Function config                                            */
/* ------------------------------------------------------------------------- */
const SIM_FUNCTION_URL = process.env.SIM_FUNCTION_URL || "";            // e.g. https://<proj>.functions.supabase.co/create-from-ats
const SIM_ANON = process.env.SIM_SUPABASE_ANON_KEY || "";               // your VITE_SUPABASE_PUBLISHABLE_KEY
const SIM_SECRET = process.env.SIM_WEBHOOK_SECRET || "";                // same secret you used in curl test

/* Optional queue – safe to be missing locally */
let simQueue = null;
try {
  const maybe = await import("../../queue.mjs");
  simQueue = maybe?.simQueue || null;
} catch { /* optional */ }

const r = Router();

r.get("/__sim_env", (_req, res) => {
  res.json({
    SIM_FUNCTION_URL: !!process.env.SIM_FUNCTION_URL,
    SIM_SUPABASE_ANON_KEY: !!process.env.SIM_SUPABASE_ANON_KEY,
    SIM_WEBHOOK_SECRET: !!process.env.SIM_WEBHOOK_SECRET,
    function_url_preview: (process.env.SIM_FUNCTION_URL || "").slice(0, 80)
  });
});

/* ------------------------------------------------------------------------- */
/* best-effort rate-limit import with safe fallback                           */
/* ------------------------------------------------------------------------- */
let publicLimiter = (_req, _res, next) => next(); // no-op fallback
let _warnedLimiter = false;
try {
  const mod = await import("../../middleware/rateLimit.mjs");
  const maybe =
    (mod && mod.publicLimiter) ||
    (mod && mod.default && mod.default.publicLimiter);
  if (typeof maybe === "function") {
    publicLimiter = maybe;
  } else if (!_warnedLimiter) {
    _warnedLimiter = true;
    console.warn("[applications.routes] publicLimiter not found — continuing without rate limiting.");
  }
} catch (e) {
  if (!_warnedLimiter) {
    _warnedLimiter = true;
    console.warn("[applications.routes] failed to load rateLimit.mjs — continuing without rate limiting.", e?.message || e);
  }
}

/* ------------------------------------------------------------------------- */
/* helpers                                                                   */
/* ------------------------------------------------------------------------- */
function toPct(n) {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? v : null;
}
function cleanStr(v, max = 160) {
  if (typeof v !== "string") return v;
  let s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > max) s = s.slice(0, max);
  return s;
}
const emptyToUndef = (v) => (v === "" ? undefined : v);

const WorkAuthEnum = ["Authorized (no sponsorship)", "Requires sponsorship"];
const WorkPrefEnum = ["Remote", "Hybrid", "Onsite"];

const extractPublicToken = (urlValue) => {
  if (typeof urlValue !== "string") return null;
  let raw = urlValue.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    raw = parsed.pathname || "";
  } catch {
    // treat as relative URL
  }
  const qIdx = raw.indexOf("?");
  if (qIdx >= 0) raw = raw.slice(0, qIdx);
  raw = raw.replace(/[#?].*$/, "").replace(/\/+$/, "");
  if (!raw) return null;
  const parts = raw.split("/").filter(Boolean);
  if (!parts.length) return null;
  const token = parts[parts.length - 1];
  return token || null;
};

const httpUrlSchema = z
  .preprocess((v) => (typeof v === "string" ? cleanStr(v, 255) : v),
    z.union([z.string().max(255), z.literal(""), z.undefined()]))
  .transform((v) => (v ? v : null))
  .refine((v) => !v || /^https?:\/\//i.test(v), { message: "Invalid URL (http/https only)" })
  .refine((v) => !v || (() => { try { new URL(v); return true; } catch { return false; } })(), { message: "Invalid URL" });

const ApplicationSchema = z.object({
  candidate_name: z.preprocess((v) => (typeof v === "string" ? cleanStr(v, 160) : v),
    z.string().min(1, "Name required").max(160)),
  candidate_email: z.preprocess((v) => (typeof v === "string" ? cleanStr(v, 160) : v),
    z.string().email("Invalid email").max(160)),
  phone: z.preprocess((v) => (typeof v === "string" ? cleanStr(v, 24) : v),
    z.union([z.string().regex(/^[0-9+()\-\s]{7,24}$/, "Invalid phone"), z.literal(""), z.undefined()]))
    .transform((v) => (v ? v : null)),
  city: z.preprocess((v) => (typeof v === "string" ? cleanStr(v, 80) : v),
    z.union([z.string(), z.literal(""), z.undefined()])).transform((v) => (v ? v : null)),
  country: z.preprocess((v) => (typeof v === "string" ? cleanStr(v, 80) : v),
    z.union([z.string(), z.literal(""), z.undefined()])).transform((v) => (v ? v : null)),
  linkedin_url: httpUrlSchema,
  portfolio_url: httpUrlSchema,
  years_experience: z.preprocess((v) => (v === "" || v === undefined ? undefined : Number(v)),
    z.number().min(0).max(60).optional()),
  current_title: z.preprocess((v) => (typeof v === "string" ? cleanStr(v, 120) : v),
    z.union([z.string(), z.literal(""), z.undefined()])).transform((v) => (v ? v : null)),
  salary_expectation: z.preprocess((v) => (typeof v === "string" ? cleanStr(v, 60) : v),
    z.union([z.string(), z.literal(""), z.undefined()])).transform((v) => (v ? v : null)),

  work_auth: z.preprocess(emptyToUndef, z.enum(WorkAuthEnum, { required_error: "Work authorization is required." })),
  work_pref: z.preprocess(emptyToUndef, z.union([z.enum(WorkPrefEnum), z.undefined()])).transform((v) => v ?? null),

  dob: z.preprocess((v) => (typeof v === "string" ? v.trim() : v),
    z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid DOB format"), z.literal(""), z.undefined()]))
    .transform((v) => (v ? v : null))
    .refine((v) => !v || (() => {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return false;
      const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 16);
      return d <= cutoff;
    })(), { message: "Must be at least 16" }),

  relocate: z.union([z.literal("on"), z.literal("true"), z.literal("1"), z.undefined()]).transform((v) => !!v),

  website: z.string().optional().transform((v) => (v ?? "").trim()), // honeypot
});

/* ------------------------------------------------------------------------- */
/* Supabase Edge Function trigger helper                                     */
/* ------------------------------------------------------------------------- */
async function triggerSimulation({ application_id, job, company, candidate }) {
  if (!SIM_FUNCTION_URL || !SIM_ANON || !SIM_SECRET) {
    console.warn("[sim] missing SIM_* env, skipping trigger");
    return null;
  }

  const payload = {
    application_id,
    job_id: job.id,
    job_title: job.title,
    job_description: job.description || "",
    company_description: company.description || "",
    candidate: {
      name: candidate.name,
      email: candidate.email,
    },
  };

  const r = await fetch(SIM_FUNCTION_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Authorization": `Bearer ${SIM_ANON}`,
      "apikey": SIM_ANON,
      "x-sim-webhook-secret": SIM_SECRET,
    },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`[sim] ${r.status} ${text}`);
  }
  return r.json(); // { ok: true, url: "https://.../sim/..." }
}

/* ------------------------------------------------------------------------- */
/* POST /api/applications/public/:jobId                                      */
/* ------------------------------------------------------------------------- */
r.post(
  "/public/:jobId",
  publicLimiter,
  upload.fields([
    { name: "careerCard", maxCount: 1 },
    { name: "resume", maxCount: 1 },
  ]),
  async (req, res, next) => {
    try {
      const jobId = Number(req.params.jobId);
      if (!Number.isInteger(jobId) || jobId <= 0) {
        return res.status(400).json({ error: "bad_job_id" });
      }

      const job = await db("jobs").where({ id: jobId, is_published: true }).first();
      if (!job) return res.status(404).json({ error: "not_found_job" });

      const parsed = ApplicationSchema.safeParse(req.body);
      if (!parsed.success) {
        const issue = parsed.error.issues?.[0];
        const field = issue?.path?.[0] || "form";
        const message = issue?.message || "Invalid form submission";
        return res.status(400).json({ field, error: message });
      }
      const data = parsed.data;

      if (data.website) return res.status(400).json({ field: "website", error: "Rejected" });

      const cc = req.files?.careerCard?.[0] || null;
      const cv = req.files?.resume?.[0] || null;

      const email = data.candidate_email.toLowerCase();
      const ua = req.get("user-agent") || "";
      const ip = req.ip;

      // Insert application + files + event + simulations(pending)
      const applicationId = await db.transaction(async (trx) => {
        const [app] = await trx("applications")
          .insert({
            job_id: jobId,
            candidate_name: data.candidate_name,
            candidate_email: email,
            phone: data.phone,
            city: data.city,
            country: data.country,
            linkedin_url: data.linkedin_url,
            portfolio_url: data.portfolio_url,
            years_experience: data.years_experience ?? null,
            current_title: data.current_title,
            salary_expectation: data.salary_expectation,
            work_auth: data.work_auth,
            work_pref: data.work_pref,
            dob: data.dob,
            relocate: data.relocate ?? false,
            status: "applied",
            source: "public_apply",
            ai_scores: null,
            ai_summary: "AI report will appear here after parsing (mock).",
            career_card: null,
          })
          .returning(["id"]);
        const appId = app.id;

        const storagePath = (file) => `uploads/${file.filename}`;
        const rows = [];
        if (cc) {
          rows.push({
            application_id: appId,
            kind: "career_card",
            original_name: cc.originalname,
            mime: cc.mimetype,
            size_bytes: cc.size,
            storage_provider: "local",
            storage_path: storagePath(cc),
          });
        }
        if (cv) {
          rows.push({
            application_id: appId,
            kind: "resume",
            original_name: cv.originalname,
            mime: cv.mimetype,
            size_bytes: cv.size,
            storage_provider: "local",
            storage_path: storagePath(cv),
          });
        }
        if (rows.length) await trx("application_files").insert(rows);

        await trx("application_events").insert({
          application_id: appId,
          event_type: "status_change",
          data: { from: null, to: "applied", source: "public_apply", ip, ua },
        });

        // Ensure a pending simulations row exists
        await trx("simulations")
          .insert({ application_id: appId, status: "pending" })
          .onConflict("application_id")
          .ignore();

        return appId;
      });

      // Optional queue (if you keep a worker for other tasks)
      if (simQueue) {
        try {
          await simQueue.add(
            "generate",
            { applicationId },
            { attempts: 5, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 200, removeOnFail: 200 }
          );
        } catch (e) {
          try {
            await db("simulations")
              .where({ application_id: applicationId })
              .update({ status: "error", error: `queue_add_failed: ${e?.message || e}` });
          } catch {}
          console.error("[simQueue] add failed:", e?.message || e);
        }
      }

      // ---- Trigger the Supabase Edge Function (preferred) ----
      try {
        // Get org/company_description
        const meta = await db("jobs as j")
          .join("organizations as o", "o.id", "j.org_id")
          .where("j.id", jobId)
          .select(
            "j.id as job_id",
            "j.title as job_title",
            "j.description as job_description",
            "o.company_description as company_description"
          )
          .first();

        const resp = await triggerSimulation({
          application_id: applicationId,
          job: {
            id: meta?.job_id,
            title: meta?.job_title,
            description: meta?.job_description || "",
          },
          company: {
            description: meta?.company_description || "",
          },
          candidate: {
            name: data.candidate_name,
            email,
          },
        });

        if (resp?.ok && resp?.url) {
          const token = extractPublicToken(resp.url);
          const update = {
            status: "ready",
            url: resp.url,
            updated_at: db.fn.now(),
          };
          if (token) {
            update.public_token = token;
          } else {
            console.warn("[sim trigger] unable to parse public token from URL:", resp.url);
          }
          await db("simulations").where({ application_id: applicationId }).update(update);
        } else {
          // Leave as 'pending' - you can inspect logs if something odd came back
          await db("simulations")
            .where({ application_id: applicationId })
            .update({ updated_at: db.fn.now() });
        }
      } catch (err) {
        console.warn("[sim trigger] failed:", err?.message || err);
        await db("simulations")
          .where({ application_id: applicationId })
          .update({
            status: "error",
            error: String(err?.message || err),
            updated_at: db.fn.now(),
          });
      }

      return res.json({ ok: true, application_id: applicationId });
    } catch (e) {
      if (e && e.code === "23505") {
        return res.status(409).json({ field: "candidate_email", error: "duplicate_application" });
      }
      return next(e);
    }
  }
);

/* ------------------------------------------------------------------------- */
/* GET /api/applications/job/:jobId (recruiter list, ranked by AI)           */
/* ------------------------------------------------------------------------- */
r.get("/job/:jobId", requireAuth(), async (req, res, next) => {
  try {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      return res.status(400).json({ error: "bad_job_id" });
    }

    const job = await db("jobs").where({ id: jobId }).first();
    if (!job || Number(job.org_id) !== Number(req.auth.orgId)) {
      return res.status(404).json({ error: "not_found" });
    }

    // Subquery: average final score per application
    const avgFinalSub = db("simulation_analyses as sa")
      .select("sa.application_id")
      .avg({ overall: "sa.final_score" })
      .groupBy("sa.application_id")
      .as("fa");

    // Subquery: average rubric scores
    const avgRubricSub = db("simulation_analysis_scores as s")
      .join("simulation_analyses as a", "a.id", "s.analysis_id")
      .select(
        "a.application_id",
        db.raw(`AVG(s.score) FILTER (WHERE s.criterion_name = 'Business Impact')  AS business_impact`),
        db.raw(`AVG(s.score) FILTER (WHERE s.criterion_name = 'Technical Accuracy') AS technical_accuracy`),
        db.raw(`AVG(s.score) FILTER (WHERE s.criterion_name = 'Communication') AS communication`)
      )
      .groupBy("a.application_id")
      .as("rc");

    const selectFields = [
      "ap.id",
      "ap.job_id",
      "ap.candidate_name",
      "ap.candidate_email",
      "ap.status",
      "ap.ai_summary",
      "ap.created_at",
      "sim.id as simulation_id",
      "sim.status as sim_status",
      "sim.url as sim_url",
      db.raw(`
        jsonb_build_object(
          'business_impact', to_jsonb(rc.business_impact),
          'technical_accuracy', to_jsonb(rc.technical_accuracy),
          'communication', to_jsonb(rc.communication),
          'overall', to_jsonb(fa.overall)
        ) AS ai_scores
      `),
    ];

    const apps = await db("applications as ap")
      .where({ job_id: jobId })
      .orderBy("ap.id", "desc")
      .leftJoin("simulations as sim", "sim.application_id", "ap.id")
      .leftJoin(avgFinalSub, "ap.id", "fa.application_id")
      .leftJoin(avgRubricSub, "ap.id", "rc.application_id")
      .select(selectFields);

    const { bySimulationId } = await fetchSimulationAnalyses({
      simulationIds: apps.map((a) => a.simulation_id).filter((id) => id != null),
    });
    for (const app of apps) {
      const simKey = app.simulation_id != null ? String(app.simulation_id) : null;
      const sup =
        (simKey && bySimulationId.get(simKey)) ||
        null;
      app.analysis_overall_score = sup?.analysis_overall_score ?? null;
      app.analysis_generated_at = sup?.analysis_generated_at ?? null;
    }

    const parseOverall = (a) => {
      const analysisOverall = a?.analysis_overall_score;
      if (analysisOverall != null) {
        const nAnalysis = typeof analysisOverall === "number" ? analysisOverall : Number(analysisOverall);
        if (Number.isFinite(nAnalysis)) return nAnalysis;
      }
      const v = a?.ai_scores?.overall ?? a?.ai_scores?.score ?? null;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    };

    apps.sort((a, b) => {
      const sa = parseOverall(a);
      const sb = parseOverall(b);
      if (sa == null && sb == null) return new Date(b.created_at) - new Date(a.created_at);
      if (sa == null) return 1;
      if (sb == null) return -1;
      return sb - sa;
    });

    return res.json(apps);
  } catch (e) {
    return next(e);
  }
});

/* ------------------------------------------------------------------------- */
/* GET /api/applications/:id (recruiter details)                              */
/* ------------------------------------------------------------------------- */
r.get("/:id", requireAuth(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "bad_id" });
    }

    const detailFields = [
      "ap.*",
      "j.title as job_title",
      "j.slug as job_slug",
      "o.slug as org_slug",
      "j.org_id as job_org_id",
      "sf.final_score as final_score",
      "simdet.id as simulation_id",
    ];

    const a = await db("applications as ap")
      .join("jobs as j", "j.id", "ap.job_id")
      .join("organizations as o", "o.id", "j.org_id")
      .leftJoin("simulation_feedbacks as sf", "sf.application_id", "ap.id")
      .leftJoin("simulations as simdet", "simdet.application_id", "ap.id")
      .where("ap.id", id)
      .select(detailFields)
      .first();

    if (!a || Number(a.job_org_id) !== Number(req.auth.orgId)) {
      return res.status(404).json({ error: "not_found" });
    }

    const files = await db("application_files")
      .where({ application_id: id })
      .select("kind", "original_name", "mime", "size_bytes");

    const careerCard = files.find((f) => f.kind === "career_card") || null;
    const resume = files.find((f) => f.kind === "resume") || null;

    const events = await db("application_events")
      .where({ application_id: id })
      .orderBy("id", "desc")
      .limit(20)
      .select("event_type", "data", "created_at");

    // Latest run summary (optional)
    const latestRun = await db("simulation_runs")
      .where({ application_id: id })
      .orderBy("id", "desc")
      .first();

    // Per-question analyses
    const analyses = await db("simulation_analyses as sa")
      .leftJoin("simulation_questions as q", "q.id", "sa.question_id")
      .where("sa.application_id", id)
      .orderBy("sa.position", "asc")
      .orderBy("sa.id", "asc")
      .select(
        "sa.id",
        "sa.question_id",
        "sa.question_label",
        "sa.final_score",
        "sa.created_at",
        db.raw('COALESCE(q.question, sa.question_label) AS canonical_label')
      );

    // Aggregates for report cards
    const avgFinal = await db("simulation_analyses")
      .where({ application_id: id })
      .avg({ overall: "final_score" })
      .first();

    const rc = await db("simulation_analysis_scores as s")
      .join("simulation_analyses as sa", "sa.id", "s.analysis_id")
      .where("sa.application_id", id)
      .select(
        db.raw(`AVG(s.score) FILTER (WHERE s.criterion_name = 'Business Impact')    AS business_impact`),
        db.raw(`AVG(s.score) FILTER (WHERE s.criterion_name = 'Technical Accuracy') AS technical_accuracy`),
        db.raw(`AVG(s.score) FILTER (WHERE s.criterion_name = 'Communication')      AS communication`)
      )
      .first();

    const ai_scores = {
      business_impact: rc?.business_impact ?? null,
      technical_accuracy: rc?.technical_accuracy ?? null,
      communication: rc?.communication ?? null,
      overall: avgFinal?.overall ?? null,
    };

    const supAnalysis = await fetchSimulationAnalysis({
      simulationId: a.simulation_id,
    });
    const { responses: supResponses, violations: supViolations } =
      await fetchSimulationResponsesAndViolations(a.simulation_id);
    const identityCheck = await fetchIdentityCheck(a.simulation_id);
    const analysis_report = supAnalysis?.analysis_report ?? null;
    const analysis_generated_at = supAnalysis?.analysis_generated_at ?? null;
    const analysis_overall_score = supAnalysis?.analysis_overall_score ?? computeOverallFromReport(analysis_report);

    if (analysis_overall_score != null && Number.isFinite(Number(analysis_overall_score))) {
      ai_scores.overall = Number(analysis_overall_score);
    }

    return res.json({
      id: a.id,
      job_id: a.job_id,
      job_title: a.job_title,
      job_slug: a.job_slug,
      org_slug: a.org_slug,
      candidate_name: a.candidate_name,
      candidate_email: a.candidate_email,
      phone: a.phone,
      city: a.city,
      country: a.country,
      linkedin_url: a.linkedin_url,
      portfolio_url: a.portfolio_url,
      years_experience: a.years_experience,
      current_title: a.current_title,
      salary_expectation: a.salary_expectation,
      work_auth: a.work_auth,
      work_pref: a.work_pref,
      dob: a.dob,
      relocate: a.relocate,
      status: a.status,
      ai_summary: a.ai_summary,
      ai_scores,
      created_at: a.created_at,
      files: {
        career_card: careerCard
          ? { name: careerCard.original_name, mime: careerCard.mime, size: Number(careerCard.size_bytes) }
          : null,
        resume: resume
          ? { name: resume.original_name, mime: resume.mime, size: Number(resume.size_bytes) }
          : null,
      },
      events,
      simulation: {
        summary: latestRun?.summary_text || null,
        analyses: analyses.map(an => ({
          id: an.id,
          label: an.question_label || an.canonical_label || `Response #${an.id}`,
          final_score: toPct(an.final_score),
          created_at: an.created_at
        }))
      },
      simulation_responses: supResponses,
      simulation_violations: supViolations,
      simulation_identity: {
        selfie_url: identityCheck?.selfie_url ?? null,
        id_url: identityCheck?.id_url ?? null,
      },
      analysis_report,
      analysis_generated_at,
      analysis_overall_score: analysis_overall_score ?? null,
    });

  } catch (e) {
    return next(e);
  }
});

/* ------------------------------------------------------------------------- */
/* PATCH /api/applications/:id/status                                         */
/* ------------------------------------------------------------------------- */
r.patch("/:id/status", requireAuth(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const statusRaw = typeof req.body?.status === "string" ? req.body.status : "";
    const status = cleanStr(statusRaw, 16);
    const allowed = ["applied", "shortlisted", "interview", "rejected", "hired"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: "bad_status" });
    }

    const updated = await db.transaction(async (trx) => {
      const app = await trx("applications").where({ id }).first().forUpdate();
      if (!app) return null;

      const job = await trx("jobs").where({ id: app.job_id }).first();
      if (!job || Number(job.org_id) !== Number(req.auth.orgId)) {
        return "forbidden";
      }

      if (app.status !== status) {
        await trx("applications").where({ id }).update({ status, updated_at: trx.fn.now() });
        await trx("application_events").insert({
          application_id: id,
          event_type: "status_change",
          data: { from: app.status, to: status, actor_user_id: req.auth.userId },
        });
      }
      return true;
    });

    if (updated === "forbidden") return res.status(403).json({ error: "forbidden" });
    if (!updated) return res.status(404).json({ error: "not_found" });
    return res.json({ updated: true });
  } catch (e) {
    return next(e);
  }
});

/* ------------------------------------------------------------------------- */
/* GET /api/applications/metrics/overview  (org-wide AI metrics)             */
/* ------------------------------------------------------------------------- */
r.get("/metrics/overview", requireAuth(), async (req, res, next) => {
  try {
    const orgId = Number(req.auth.orgId);

    const simulations = await db("simulations as sim")
      .join("applications as ap", "ap.id", "sim.application_id")
      .join("jobs as j", "j.id", "ap.job_id")
      .where("j.org_id", orgId)
      .where("sim.status", "ready")
      .select(
        "sim.id as simulation_id",
        "sim.updated_at",
        "j.id as job_id",
        "j.title as job_title"
      );

    if (!simulations.length) {
      return res.json({
        avg_final_score: null,
        completed_count: 0,
        top_jobs_30d: [],
      });
    }

    const { bySimulationId } = await fetchSimulationAnalyses({
      simulationIds: simulations.map((s) => s.simulation_id),
    });

    let sumScores = 0;
    let countScores = 0;
    const perJob = new Map();
    const cutoff = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      return d;
    })();

    for (const sim of simulations) {
      const sup = bySimulationId.get(String(sim.simulation_id));
      const scoreRaw = sup?.analysis_overall_score;
      const score = typeof scoreRaw === "number" ? scoreRaw : Number(scoreRaw);
      if (!Number.isFinite(score) || score <= 0) continue;

      sumScores += score;
      countScores += 1;

      if (!perJob.has(sim.job_id)) {
        perJob.set(sim.job_id, {
          job_id: sim.job_id,
          job_title: sim.job_title,
          totalScore: 0,
          count: 0,
          recentScore: 0,
          recentCount: 0,
        });
      }
      const bucket = perJob.get(sim.job_id);
      bucket.totalScore += score;
      bucket.count += 1;

      const updatedAt = sim.updated_at ? new Date(sim.updated_at) : null;
      if (updatedAt && updatedAt >= cutoff) {
        bucket.recentScore += score;
        bucket.recentCount += 1;
      }
    }

    const avgScore = countScores ? sumScores / countScores : null;

    const top = Array.from(perJob.values())
      .map((job) => ({
        job_id: job.job_id,
        job_title: job.job_title,
        avg_score: job.recentCount ? job.recentScore / job.recentCount : job.count ? job.totalScore / job.count : 0,
        completed: job.recentCount || job.count,
      }))
      .filter((job) => job.avg_score > 0 && job.completed > 0)
      .sort((a, b) => b.avg_score - a.avg_score)
      .slice(0, 5);

    res.json({
      avg_final_score: avgScore,
      completed_count: countScores,
      top_jobs_30d: top,
    });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------------------- */
/* GET /api/applications/:id/file/:kind  (secure preview/download)           */
/* ------------------------------------------------------------------------- */
r.get("/:id/file/:kind", requireAuth(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const kind = String(req.params.kind || "").toLowerCase();

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "bad_id" });
    }
    if (!["resume", "career_card"].includes(kind)) {
      return res.status(400).json({ error: "bad_kind" });
    }

    const app = await db("applications as ap")
      .join("jobs as j", "j.id", "ap.job_id")
      .select("ap.id", "j.org_id")
      .where("ap.id", id)
      .first();

    if (!app || Number(app.org_id) !== Number(req.auth.orgId)) {
      return res.status(404).json({ error: "not_found" });
    }

    const file = await db("application_files")
      .where({ application_id: id, kind })
      .first();
    if (!file) return res.status(404).json({ error: "no_file" });

    const spRaw = String(file.storage_path || "");
    const sp = spRaw.replace(/^\/+/, "");

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [];

    if (path.isAbsolute(spRaw)) candidates.push(spRaw);
    candidates.push(path.resolve(process.cwd(), sp));
    candidates.push(path.resolve(process.cwd(), "server", sp));
    candidates.push(path.resolve(__dirname, "..", "..", sp));
    if (sp.startsWith("uploads/")) {
      candidates.push(path.resolve(process.cwd(), "server", "uploads", path.basename(sp)));
      candidates.push(path.resolve(__dirname, "..", "..", "uploads", path.basename(sp)));
    }

    let abs = null;
    for (const p of candidates) { try { if (fs.existsSync(p)) { abs = p; break; } } catch {} }
    if (!abs) {
      console.warn("[fileserve] file_missing", { id, kind, spRaw, tried: candidates });
      return res.status(404).json({ error: "file_missing" });
    }

    const forceDownload = String(req.query.download || "") === "1";
    const dispo = `${forceDownload ? "attachment" : "inline"}; filename="${encodeURIComponent(
      file.original_name || path.basename(abs)
    )}"`;

    res.setHeader("Content-Type", file.mime || "application/octet-stream");
    res.setHeader("Content-Disposition", dispo);

    fs.createReadStream(abs).on("error", next).pipe(res);
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------------------- */
/* GET /api/simulations/analysis/:analysisId  (recruiter view)               */
/* ------------------------------------------------------------------------- */
r.get("/../simulations/analysis/:analysisId", requireAuth(), async (req, res, next) => {
  try {
    const analysisId = Number(req.params.analysisId);
    if (!Number.isInteger(analysisId) || analysisId <= 0) {
      return res.status(400).json({ error: "bad_id" });
    }

    const row = await db("simulation_analyses as sa")
      .join("applications as ap", "ap.id", "sa.application_id")
      .join("jobs as j", "j.id", "ap.job_id")
      .leftJoin("simulation_questions as q", "q.id", "sa.question_id")
      .where("sa.id", analysisId)
      .select(
        "sa.id",
        "sa.application_id",
        "sa.question_label",
        "sa.final_score",
        "sa.created_at",
        "ap.candidate_name",
        "ap.candidate_email",
        "j.org_id",
        db.raw('COALESCE(q.label, q.question) AS canonical_label')
      )
      .first();

    if (!row || Number(row.org_id) !== Number(req.auth.orgId)) {
      return res.status(404).json({ error: "not_found" });
    }

    const scores = await db("simulation_analysis_scores")
      .where({ analysis_id: analysisId })
      .orderBy("suite", "asc")
      .orderBy("position", "asc")
      .select("suite", "criterion_name", "score", "rationale", "position");

    const criteria = scores.filter(s => s.suite === "core");
    const startup = scores.filter(s => s.suite === "startup");

    return res.json({
      id: row.id,
      application_id: row.application_id,
      label: row.question_label || row.canonical_label || `Response #${row.id}`,
      final_score: toPct(row.final_score),
      created_at: row.created_at,
      applicant: { name: row.candidate_name, email: row.candidate_email },
      tables: {
        criteria,
        startup
      }
    });
  } catch (e) {
    next(e);
  }
});

export default r;
