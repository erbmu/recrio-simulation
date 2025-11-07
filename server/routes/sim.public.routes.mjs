// server/routes/sim.public.routes.mjs
import { Router } from "express";
import crypto from "crypto";
import { db } from "../db.mjs";

const r = Router();
const SIM_TOKEN_SECRET = process.env.SIM_TOKEN_SECRET || "dev-secret-change-me";

function sign(payload) {
  return crypto.createHmac("sha256", SIM_TOKEN_SECRET).update(payload).digest("base64url");
}

// GET /api/sim/public/resolve/:token
r.get("/api/sim/public/resolve/:token", async (req, res, next) => {
  try {
    const token = String(req.params.token || "").trim();
    if (!token || token.length < 6) return res.status(400).json({ error: "bad_token" });

    let responsePayload = null;
    let errorResult = null;
    const stage = String(req.query.stage || "preview").toLowerCase();
    const markFinal = stage === "finalize";

    await db.transaction(async (trx) => {
      const row = await trx("simulations as sim")
        .forUpdate()
        .join("applications as ap", "ap.id", "sim.application_id")
        .join("jobs as j", "j.id", "ap.job_id")
        .join("organizations as o", "o.id", "j.org_id")
        .where("sim.public_token", token)
        .select(
          "sim.id as sim_id",
          "sim.public_token",
          "sim.external_simulation_id",
          "sim.status",
          "sim.access_count",
          "ap.id as application_id",
          "ap.candidate_name",
          "ap.candidate_email",
          "j.id as job_id",
          "j.title as job_title",
          "j.description as job_description",
          "j.qualifications",
          "o.company_description"
        )
        .first();

      if (!row) {
        errorResult = { status: 404, body: { error: "not_found" } };
        return;
      }

      if (row.status !== "ready") {
        if (row.status === "pending") {
          errorResult = { status: 409, body: { error: "pending" } };
        } else if (row.status === "error") {
          errorResult = { status: 404, body: { error: "error" } };
        } else {
          errorResult = { status: 409, body: { error: row.status } };
        }
        return;
      }

      const alreadyUsed = Number(row.access_count || 0) > 0;

      if (markFinal && alreadyUsed) {
        errorResult = { status: 410, body: { error: "used" } };
        return;
      }

      if (markFinal) {
        const now = trx.fn.now();
        const updated = await trx("simulations")
          .where({ id: row.sim_id })
          .andWhere("access_count", 0)
          .update({
            first_accessed_at: now,
            last_accessed_at: now,
            access_count: 1,
          });

        if (!updated) {
          errorResult = { status: 410, body: { error: "used" } };
          return;
        }
      }

      responsePayload = {
        simulationId: row.external_simulation_id || row.sim_id,
        application: {
          id: row.application_id,
          candidate_name: row.candidate_name,
          candidate_email: row.candidate_email,
        },
        job: {
          id: row.job_id,
          title: row.job_title,
          description: row.job_description,
          qualifications: row.qualifications,
        },
        org: {
          company_description: row.company_description,
        },
      };
      if (alreadyUsed || markFinal) {
        responsePayload.used = true;
      }
    });

    if (errorResult) {
      return res.status(errorResult.status).json(errorResult.body);
    }
    if (!responsePayload) {
      return res.status(500).json({ error: "resolve_failed" });
    }
    return res.json(responsePayload);
  } catch (e) {
    next(e);
  }
});

// GET /api/sim/public/verify/:payload
// payload looks like: "<applicationId>.<sig>"
r.get("/api/sim/public/verify/:payload", async (req, res, next) => {
  try {
    const raw = String(req.params.payload || "");
    const [idStr, sig] = raw.split(".");
    const applicationId = Number(idStr);
    if (!applicationId || !sig) return res.status(400).json({ error: "bad_token" });

    const expected = sign(String(applicationId));
    if (sig !== expected) return res.status(401).json({ error: "invalid_token" });

    // Return only what the sim needs (no private recruiter-only fields)
    const row = await db("applications as ap")
      .join("jobs as j", "j.id", "ap.job_id")
      .join("organizations as o", "o.id", "j.org_id")
      .where("ap.id", applicationId)
      .select(
        "ap.id as application_id",
        "ap.candidate_name",
        "ap.candidate_email",
        "j.id as job_id",
        "j.title as job_title",
        "j.description as job_description",
        "j.qualifications",
        "o.company_description"
      )
      .first();

    if (!row) return res.status(404).json({ error: "not_found" });

    res.json({
      application: {
        id: row.application_id,
        candidate_name: row.candidate_name,
        candidate_email: row.candidate_email,
      },
      job: {
        id: row.job_id,
        title: row.job_title,
        description: row.job_description,
        qualifications: row.qualifications,
      },
      org: {
        company_description: row.company_description,
      },
    });
  } catch (e) {
    next(e);
  }
});

export default r;
