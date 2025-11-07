import { db } from "../../server/db.mjs";
// If you’re on Node 18+, global fetch exists; otherwise: import fetch from "node-fetch";

export async function makeSimulationForApplication(applicationId) {
  const ctx = await db("applications as ap")
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

  if (!ctx) throw new Error("application_not_found");

  const SIM_API = process.env.SIM_API_BASE; // e.g. http://localhost:5200
  if (!SIM_API) throw new Error("missing_SIM_API_BASE");

  const resp = await fetch(`${SIM_API}/api/simulations/create-from-ats`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      applicationId: ctx.application_id,
      candidate: { name: ctx.candidate_name, email: ctx.candidate_email },
      job: {
        id: ctx.job_id,
        title: ctx.job_title,
        description: ctx.job_description || "",
        qualifications: ctx.qualifications || "",
        company_description: ctx.company_description || ""
      }
    })
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`sim_api_failed ${resp.status} ${txt}`);
  }

  const json = await resp.json();
  if (!json?.url) throw new Error("sim_api_no_url");

  return { url: json.url };
}
