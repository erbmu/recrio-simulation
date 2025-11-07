// simulation.worker.mjs (or wherever makeSimulationForApplication lives)
import crypto from "crypto";
import { db } from "./db.mjs";
import { sendSimulationInviteEmail } from "../lib/renderMail.mjs";

const SIM_PUBLIC_BASE = process.env.SIM_PUBLIC_BASE || "http://localhost:5173";
const SIM_TOKEN_SECRET = process.env.SIM_TOKEN_SECRET || "2TIODI8er8DejevRGe52F29Xj5vMDRc_ggO3ta-N1aAVA5TBxCT2b-7Bq3rB5dwr";

function sign(payload) {
  return crypto.createHmac("sha256", SIM_TOKEN_SECRET)
    .update(payload)
    .digest("base64url"); // url-safe
}

export async function makeSimulationForApplication(applicationId) {
  // 1) load what you need to build prompts (job + org)
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

  if (!row) throw new Error("application_not_found");

  // 2) build your prompt(s) here, run any AI generation you need (optional)
  //    For MVP, you can skip and just produce a URL.

  // 3) sign a short payload the sim frontend can present back for validation
  //    keep it minimal (only what you need to decrypt/lookup):
  const payload = String(row.application_id);
  const sig = sign(payload);
  const token = `${payload}.${sig}`;
  const url = `${SIM_PUBLIC_BASE.replace(/\/+$/, "")}/s/${token}`;

  // 4) persist in simulations table
  await db("simulations")
    .insert({
      application_id: row.application_id,
      status: "ready",
      url,
      public_token: token,
      attempts: 1,
      updated_at: db.fn.now(),
    })
    .onConflict("application_id")
    .merge({
      status: "ready",
      url,
      public_token: token,
      attempts: db.raw("attempts + 1"),
      access_count: 0,
      first_accessed_at: null,
      last_accessed_at: null,
      updated_at: db.fn.now(),
    });

  if (row.candidate_email) {
    try {
      await sendSimulationInviteEmail({
        candidateName: row.candidate_name,
        candidateEmail: row.candidate_email,
        jobTitle: row.job_title,
        companyName: row.company_description,
        simulationUrl: url,
      });
    } catch (err) {
      console.error("[simulation.worker] failed to send invite email", err);
    }
  } else {
    console.warn("[simulation.worker] Missing candidate email, skipping invite.", {
      applicationId: row.application_id,
    });
  }

  return url;
}
