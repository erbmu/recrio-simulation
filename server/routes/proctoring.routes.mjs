import { Router } from "express";
import { z } from "zod";

const r = Router();

const ProctoringSchema = z.object({
  image: z.string().min(10),
  simulationId: z.string().min(1),
});

r.post("/api/sim/runtime/analyze-proctoring", async (req, res) => {
  try {
    const parsed = ProctoringSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
    }
    return res.json({ violation: false });
  } catch (err) {
    console.error("[proctoring] analyze_failed", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default r;
