import { Router } from "express";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "../db.mjs";

const router = Router();

const HONOR_LOCK_DIR = process.env.HONOR_LOCK_DIR || path.resolve(process.cwd(), "server/uploads/honor-lock");
const HONOR_LOCK_RELATIVE_PREFIX = process.env.HONOR_LOCK_RELATIVE_PREFIX || "honor-lock";

const IdentitySchema = z.object({
  external_simulation_id: z.string().min(1),
  selfie_data: z.string().optional(),
  id_data: z.string().optional(),
});

const ensureRun = async (externalId) => {
  const existing = await db("simulation_runs").where({ external_simulation_id: externalId }).first("id");
  if (existing) return existing;
  const [created] = await db("simulation_runs")
    .insert({
      external_simulation_id: externalId,
      status: "in_progress",
      job_description: "",
      company_description: "",
      generated_scenario: {},
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning(["id"]);
  return created;
};

const persistDataUrl = async (dataUrl, kind, externalId) => {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image")) return null;
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+./-]+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1] || "image/png";
  const base64 = match[2] || "";
  const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "png";
  await fs.mkdir(HONOR_LOCK_DIR, { recursive: true }).catch(() => { });
  const filename = `${externalId}-${kind}-${Date.now()}-${randomUUID()}.${ext}`;
  const absolutePath = path.join(HONOR_LOCK_DIR, filename);
  await fs.writeFile(absolutePath, Buffer.from(base64, "base64"));
  return path.posix.join(HONOR_LOCK_RELATIVE_PREFIX, filename);
};

router.post("/identity", async (req, res) => {
  console.log(`[honorLock] HIT /identity with body keys: ${Object.keys(req.body)}`);
  try {
    const parsed = IdentitySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
    }
    const data = parsed.data;
    const externalId = data.external_simulation_id.trim();
    console.log("[honorLock] incoming identity payload", {
      externalId,
      hasSelfie: !!data.selfie_data,
      hasId: !!data.id_data,
    });

    await ensureRun(externalId);

    const selfiePath = await persistDataUrl(data.selfie_data, "selfie", externalId);
    const idPath = await persistDataUrl(data.id_data, "id", externalId);

    await db("simulation_identity_checks").insert({
      external_simulation_id: externalId,
      selfie_path: selfiePath,
      id_path: idPath,
      created_at: db.fn.now(),
    });

    console.log("[honorLock] stored identity paths", { externalId, selfiePath, idPath });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[honorLock] identity_failed", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
