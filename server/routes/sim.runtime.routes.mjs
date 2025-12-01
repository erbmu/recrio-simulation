import { Router } from "express";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "../db.mjs";

const r = Router();

console.log("[sim.runtime] Module loaded");

r.use((req, res, next) => {
  console.log(`[sim.runtime] Router hit: ${req.method} ${req.url}`);
  next();
});

r.get("/ping", (req, res) => res.send("pong"));

const optionalString = z.union([z.string(), z.undefined(), z.null()]).transform((v) => (typeof v === "string" ? v : null));

const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || "").trim();
const HONOR_LOCK_DIR = process.env.HONOR_LOCK_DIR || path.resolve(process.cwd(), "server/uploads/honor-lock");
const HONOR_LOCK_RELATIVE_PREFIX = process.env.HONOR_LOCK_RELATIVE_PREFIX || "honor-lock";

const RunUpsertSchema = z.object({
  external_simulation_id: z.string().min(1),
  job_description: optionalString,
  company_description: optionalString,
  generated_scenario: z.any().optional(),
  status: z.string().min(1).optional(),
  user_id: z.union([z.number(), z.null()]).optional(),
  violations_count: z.number().int().optional(),
  analysis_report: z.any().optional(),
  analysis_generated_at: z.union([z.string(), z.null()]).optional(),
  completed_at: z.union([z.string(), z.null()]).optional(),
});

const ensureRun = async (externalId) => {
  const existing = await db("simulation_runs").where({ external_simulation_id: externalId }).first("id");
  if (!existing) {
    const [created] = await db("simulation_runs")
      .insert({
        external_simulation_id: externalId,
        job_description: "",
        company_description: "",
        generated_scenario: {},
        status: "in_progress",
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning(["id"]);
    return created;
  }
  return existing;
};

const sanitize = (value) => (typeof value === "string" ? value.trim() : "");

const normalizeScenario = (raw) => {
  const agents = Array.isArray(raw?.agents)
    ? raw.agents.slice(0, 4).map((agent) => ({
      name: sanitize(agent?.name) || "Unnamed",
      role: sanitize(agent?.role) || "Teammate",
      personality: sanitize(agent?.personality),
    }))
    : [];

  const channels = Array.isArray(raw?.channels)
    ? raw.channels.slice(0, 3).map((channel, idx) => {
      const fallbackId = ["technical", "product", "ops"][idx] ?? `channel-${idx}`;
      const safeId = sanitize(channel?.id)?.toLowerCase().replace(/\s+/g, "-") || fallbackId;
      return {
        id: safeId,
        name: sanitize(channel?.name) || safeId,
        description: sanitize(channel?.description),
      };
    })
    : [];

  const questions = Array.isArray(raw?.questions)
    ? raw.questions.map((question, idx) => {
      const normalizedChannel =
        sanitize(question?.channel)?.toLowerCase().replace(/\s+/g, "-") ||
        channels[idx % Math.max(1, channels.length)]?.id ||
        "technical";

      const context = Array.isArray(question?.context)
        ? question.context
          .map((ctx) => ({
            agent: sanitize(ctx?.agent),
            message: sanitize(ctx?.message),
          }))
          .filter((ctx) => ctx.agent && ctx.message)
        : [];

      const followUps = Array.isArray(question?.followUps)
        ? question.followUps
          .map((fu, fuIdx) => ({
            id: sanitize(fu?.id) || `${question?.id || "q"}-follow-${fuIdx + 1}`,
            agent: sanitize(fu?.agent) || "Teammate",
            question: sanitize(fu?.question),
          }))
          .filter((fu) => fu.question)
        : [];

      let stimulus = null;
      if (question?.stimulus) {
        const { type, title, content } = question.stimulus;
        if (type && title && content) {
          stimulus = {
            type,
            title: title.trim(),
            content: content.trim(),
          };
        }
      }

      return {
        id: sanitize(question?.id) || `q-${idx + 1}`,
        channel: normalizedChannel,
        mainQuestion: sanitize(question?.mainQuestion),
        stimulus,
        context,
        followUps,
      };
    })
    : [];

  const channelIds = new Set(channels.map((c) => c.id));
  channels.forEach((channel) => {
    const hasMatch = questions.some(
      (q) => q.channel?.trim().toLowerCase() === channel.id.trim().toLowerCase()
    );
    if (!hasMatch) {
      const reassignment = questions.find(
        (q) =>
          !channelIds.has(q.channel?.trim().toLowerCase()) ||
          !channelIds.has(q.channel)
      );
      if (reassignment) {
        reassignment.channel = channel.id;
      }
    }
  });

  return { agents, channels, questions };
};

const persistDataUrl = async (dataUrl, kind, externalId) => {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image")) return null;
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+./-]+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1] || "image/png";
  const base64 = match[2] || "";
  const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "png";
  const filename = `${externalId}-${kind}-${Date.now()}-${randomUUID()}.${ext}`;
  await fs.mkdir(HONOR_LOCK_DIR, { recursive: true }).catch(() => { });
  const absolutePath = path.join(HONOR_LOCK_DIR, filename);
  await fs.writeFile(absolutePath, Buffer.from(base64, "base64"));
  return path.posix.join(HONOR_LOCK_RELATIVE_PREFIX, filename);
};

r.post("/run", async (req, res) => runUpsertHandler(req, res));
r.post("/api/sim/runtime/run", async (req, res) => runUpsertHandler(req, res));

async function runUpsertHandler(req, res) {
  try {
    const parsed = RunUpsertSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
    }
    const data = parsed.data;
    const externalId = data.external_simulation_id.trim();

    const payload = {
      updated_at: db.fn.now(),
    };

    const assignIfDefined = (key, value) => {
      if (value !== undefined) payload[key] = value;
    };

    assignIfDefined("job_description", data.job_description ?? "");
    assignIfDefined("company_description", data.company_description ?? "");
    assignIfDefined("generated_scenario", data.generated_scenario ?? {});
    assignIfDefined("status", data.status ?? "in_progress");
    assignIfDefined("user_id", data.user_id ?? null);
    assignIfDefined("violations_count", data.violations_count);
    assignIfDefined("analysis_report", data.analysis_report ?? null);
    assignIfDefined("analysis_generated_at", data.analysis_generated_at ?? null);
    assignIfDefined("completed_at", data.completed_at ?? null);

    const [row] = await db("simulation_runs")
      .insert({
        external_simulation_id: externalId,
        ...payload,
        created_at: db.fn.now(),
      })
      .onConflict("external_simulation_id")
      .merge(payload)
      .returning([
        "id",
        "external_simulation_id",
        "status",
        "job_description",
        "company_description",
        "violations_count",
        "analysis_generated_at",
        "completed_at",
        "updated_at",
      ]);

    return res.json({ ok: true, run: row });
  } catch (err) {
    console.error("[sim.runtime] run_upsert_failed", err);
    return res.status(500).json({ error: "internal_error" });
  }
}

r.get("/run/:id", async (req, res) => runFetchHandler(req, res));
r.get("/api/sim/runtime/run/:id", async (req, res) => runFetchHandler(req, res));

async function runFetchHandler(req, res) {
  try {
    const key = String(req.params.id || "").trim();
    if (!key) return res.status(400).json({ error: "bad_id" });

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
    let query = db("simulation_runs");

    if (isUuid) {
      query = query.where({ id: key }).orWhere({ external_simulation_id: key });
    } else {
      query = query.where({ external_simulation_id: key });
    }

    const row = await query.first();
    if (!row) {
      return res.status(404).json({ error: "not_found" });
    }
    return res.json({ run: row });
  } catch (err) {
    console.error("[sim.runtime] run_fetch_failed", err);
    return res.status(500).json({ error: "internal_error" });
  }
}

const ResponseSchema = z.object({
  external_simulation_id: z.string().min(1),
  question_id: z.string().min(1),
  response: z.string().min(1),
});

r.post("/response", async (req, res) => responseHandler(req, res));
r.post("/api/sim/runtime/response", async (req, res) => responseHandler(req, res));

async function responseHandler(req, res) {
  try {
    const parsed = ResponseSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
    }
    const data = parsed.data;
    const externalId = data.external_simulation_id.trim();
    const run = await ensureRun(externalId);
    if (!run) return res.status(500).json({ error: "run_create_failed" });

    await db("simulation_responses").insert({
      simulation_id: run.id,
      external_simulation_id: externalId,
      question_id: data.question_id,
      response: data.response,
      timestamp: db.fn.now(),
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("[sim.runtime] response_insert_failed", err);
    return res.status(500).json({ error: "internal_error" });
  }
}

const ScenarioSchema = z.object({
  jobDescription: z.string().min(1),
  companyDescription: z.string().min(1),
});

r.post("/scenario", async (req, res) => scenarioHandler(req, res));
r.post("/api/sim/runtime/scenario", async (req, res) => scenarioHandler(req, res));

async function scenarioHandler(req, res) {
  try {
    const parsed = ScenarioSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
    }
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: "missing_gemini_key" });
    }

    const systemPrompt = `You are an AI that generates realistic workplace simulation scenarios for hiring assessments.
The simulation should:
1) 3 channels total;
2) Each channel has exactly 6 questions total (e.g., 3 main + 2 follow-ups each);
3) Include realistic team dialogue BEFORE each main question (2–3 short messages);
4) Distinct AI personas (Founder, Lead Engineer, PM, Designer, etc.);
5) Startup-feel authenticity;
6) 30–40% of questions include realistic stimulus (code/document/data) when referenced.

CRITICAL INSTRUCTION:
- The scenario MUST be deeply customized to the specific Job Description and Company Description provided.
- Do NOT use generic questions. Every question should feel like it could only be asked at THIS company for THIS role.
- Reference specific technologies, responsibilities, or company values mentioned in the descriptions.

RULE: If any question text references external material, you MUST include that exact material in the "stimulus" object.`;

    const userPrompt = `Create a hiring simulation for the following role.

Job Description:
${parsed.data.jobDescription}

Company Description:
${parsed.data.companyDescription}

Return the scenario strictly as JSON.`;

    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent" +
      `?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.65,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return res.status(500).json({ error: "scenario_generation_failed", details: text });
    }

    const data = await response.json();
    const rawJson =
      data?.candidates?.[0]?.content?.parts
        ?.map((part) => part?.text ?? "")
        .join("")
        .trim() ?? "";

    console.log(`[sim.runtime] Gemini response length: ${rawJson.length}`);
    if (rawJson.length < 500) console.log(`[sim.runtime] Gemini raw: ${rawJson}`);

    if (!rawJson) {
      return res.status(500).json({ error: "scenario_empty" });
    }
    let scenario;
    try {
      scenario = JSON.parse(rawJson);
    } catch (err) {
      console.error("[sim.runtime] scenario_parse_failed", err);
      console.log(`[sim.runtime] Failed JSON: ${rawJson.slice(0, 1000)}...`);
      return res.status(500).json({ error: "scenario_parse_failed" });
    }

    const normalized = normalizeScenario(scenario);
    console.log(`[sim.runtime] Normalized scenario: agents=${normalized.agents.length}, channels=${normalized.channels.length}, questions=${normalized.questions.length}`);
    return res.json({ scenario: normalized });
  } catch (err) {
    console.error("[sim.runtime] scenario_generate_failed", err);
    return res.status(500).json({ error: "internal_error" });
  }
}

const ViolationSchema = z.object({
  external_simulation_id: z.string().min(1),
  violation_type: z.string().min(1),
});

r.post("/violation", async (req, res) => violationHandler(req, res));
r.post("/api/sim/runtime/violation", async (req, res) => violationHandler(req, res));

async function violationHandler(req, res) {
  try {
    const parsed = ViolationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
    }
    const data = parsed.data;
    const externalId = data.external_simulation_id.trim();
    const run = await ensureRun(externalId);
    if (!run) return res.status(500).json({ error: "run_create_failed" });

    await db("simulation_violations").insert({
      simulation_id: run.id,
      external_simulation_id: externalId,
      violation_type: data.violation_type,
      created_at: db.fn.now(),
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("[sim.runtime] violation_insert_failed", err);
    return res.status(500).json({ error: "internal_error" });
  }
}

const IdentitySchema = z.object({
  external_simulation_id: z.string().min(1),
  selfie_path: optionalString.optional(),
  id_path: optionalString.optional(),
  selfie_data: optionalString.optional(),
  id_data: optionalString.optional(),
});

export async function identityHandler(req, res) {
  try {
    const parsed = IdentitySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
    }
    const data = parsed.data;
    const externalId = data.external_simulation_id.trim();
    console.log("[runtime.identity] incoming request", {
      externalId,
      selfieDataBytes: data.selfie_data?.length || 0,
      idDataBytes: data.id_data?.length || 0,
    });
    await ensureRun(externalId);

    // Store directly in DB as requested by user ("save to neon database")
    await db("simulation_identity_checks").insert({
      external_simulation_id: externalId,
      selfie_data: data.selfie_data || null,
      id_data: data.id_data || null,
      created_at: db.fn.now(),
    });

    console.log("[runtime.identity] stored identity data in DB", { externalId });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[sim.runtime] identity_insert_failed", err);
    return res.status(500).json({ error: "internal_error" });
  }
}

r.post("/identity", identityHandler);
r.post("/api/sim/runtime/identity", identityHandler);

const AnalyzeSchema = z.object({
  simulationId: z.string().min(1),
});

r.post("/analyze", async (req, res) => analyzeHandler(req, res));
r.post("/api/sim/runtime/analyze", async (req, res) => analyzeHandler(req, res));

async function analyzeHandler(req, res) {
  const start = Date.now();
  try {
    if (!GEMINI_API_KEY) {
      console.error("[sim.runtime] analyze: missing_gemini_key");
      return res.status(500).json({ error: "missing_gemini_key" });
    }
    const parsed = AnalyzeSchema.safeParse(req.body);
    if (!parsed.success) {
      console.error("[sim.runtime] analyze: bad_request", parsed.error.flatten());
      return res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
    }
    const key = parsed.data.simulationId.trim();
    console.log(`[sim.runtime] analyze: starting for ${key}`);

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
    let query = db("simulation_runs");

    if (isUuid) {
      query = query.where({ id: key }).orWhere({ external_simulation_id: key });
    } else {
      query = query.where({ external_simulation_id: key });
    }

    const run = await query.first();

    if (!run) {
      console.warn(`[sim.runtime] analyze: run not found for ${key}`);
      return res.status(404).json({ error: "simulation_not_found" });
    }

    if (run.analysis_report) {
      console.log(`[sim.runtime] analyze: returning cached report for ${key}`);
      return res.json({
        report: run.analysis_report,
        analysis_generated_at: run.analysis_generated_at,
        cached: true,
      });
    }

    const responses = await db("simulation_responses")
      .select("question_id", "response", "timestamp")
      .where({ external_simulation_id: run.external_simulation_id })
      .orderBy("timestamp", "asc");

    console.log(`[sim.runtime] analyze: found ${responses.length} responses for ${key}`);

    const responsesBlock = responses.length
      ? responses
        .map((entry, idx) => {
          const questionId = entry.question_id || `q-${idx + 1}`;
          const answer = entry.response || "";
          return `Q${idx + 1} (${questionId}):\n${answer}`;
        })
        .join("\n\n")
      : "No responses were recorded.";

    const scenarioBlock = JSON.stringify(run.generated_scenario ?? {}, null, 2);

    const systemPrompt = `You are an exceptionally strict expert evaluator for top-tier startup founders and early-stage employees.
Your standards are extremely high—you evaluate candidates as if they are applying to YC, Sequoia, or FAANG.

EVALUATION PHILOSOPHY:
- Be HIGHLY CRITICAL and set the bar very high
- Scores above 80 should be reserved ONLY for exceptional, standout responses
- Average or mediocre responses should score 40-60
- Weak responses should score below 40
- Look for depth of reasoning, not just surface-level answers
- Penalize vague, generic, or unactionable responses heavily
- Reward specific, data-driven, innovative thinking with concrete execution plans`;

    const userPrompt = `SCENARIO CONTEXT:
${scenarioBlock}

CANDIDATE RESPONSES:
${responsesBlock}

Provide strict hiring scores (0-100) across each dimension. Return JSON, no prose.`;

    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent" +
      `?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    console.log(`[sim.runtime] analyze: calling Gemini for ${key}`);
    const aiResponse = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.15,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!aiResponse.ok) {
      const text = await aiResponse.text().catch(() => "");
      console.error(`[sim.runtime] analyze: Gemini failed status=${aiResponse.status} text=${text}`);
      throw new Error(`Gemini analysis failed (${aiResponse.status}): ${text}`);
    }

    const aiJson = await aiResponse.json();
    const rawReport =
      aiJson?.candidates?.[0]?.content?.parts
        ?.map((part) => part?.text ?? "")
        .join("")
        .trim() ?? "";

    console.log(`[sim.runtime] analyze: Gemini response length=${rawReport.length}`);
    if (!rawReport) throw new Error("Gemini returned empty analysis output");

    let report = null;
    try {
      report = JSON.parse(rawReport);
    } catch (err) {
      console.error(`[sim.runtime] analyze: JSON parse failed. Raw: ${rawReport.slice(0, 500)}...`);
      throw new Error(`Failed to parse analysis JSON: ${err?.message || err}`);
    }

    const sanitizedReport = {
      businessImpactScore: report?.businessImpactScore,
      technicalAccuracy: report?.technicalAccuracy,
      tradeOffAnalysis: report?.tradeOffAnalysis,
      communicationClarity: report?.communicationClarity,
      adaptability: report?.adaptability,
      creativityInnovationIndex: report?.creativityInnovationIndex,
      biasTowardExecution: report?.biasTowardExecution,
      learningAgility: report?.learningAgility,
      founderFitIndex: report?.founderFitIndex,
      overallStartupReadinessIndex: report?.overallStartupReadinessIndex,
      analysis: report?.analysis,
    };

    const generatedAt = new Date().toISOString();
    await db("simulation_runs")
      .where({ external_simulation_id: run.external_simulation_id })
      .update({
        analysis_report: sanitizedReport,
        analysis_generated_at: generatedAt,
        updated_at: db.fn.now(),
      });

    console.log(`[sim.runtime] analyze: success for ${key} in ${Date.now() - start}ms`);
    return res.json({ report: sanitizedReport, analysis_generated_at: generatedAt });
  } catch (err) {
    console.error("[sim.runtime] analyze_failed", err);
    return res.status(500).json({ error: "internal_error" });
  }
}

const TextToSpeechSchema = z.object({
  text: z.string().min(1),
  voice: z.string().optional(),
});

r.post("/text-to-speech", async (_req, res) => res.status(501).json({ error: "tts_not_configured" }));
r.post("/api/sim/runtime/text-to-speech", async (_req, res) => res.status(501).json({ error: "tts_not_configured" }));

const SpeechToTextSchema = z.object({
  audio: z.string().min(1),
  mimeType: z.string().optional(),
});

const sanitizeBase64 = (value) =>
  typeof value === "string" ? value.replace(/^data:[^;]+;base64,/, "").replace(/[\r\n\s]/g, "") : "";

r.post("/speech-to-text", async (req, res) => speechToTextHandler(req, res));
r.post("/api/sim/runtime/speech-to-text", async (req, res) => speechToTextHandler(req, res));

async function speechToTextHandler(req, res) {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: "missing_gemini_key" });
    }
    const parsed = SpeechToTextSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
    }

    const audioBase64 = sanitizeBase64(parsed.data.audio);
    const mimeType = parsed.data.mimeType || "audio/webm";

    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent" +
      `?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: "You are a precise transcription engine. Return the verbatim transcript of this audio." },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: audioBase64,
                },
              },
            ],
          },
        ],
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(text || "Gemini STT failed");
    }
    const json = await response.json();
    const candidate = json?.candidates?.find((c) => c?.content?.parts?.length);
    const text =
      candidate?.content?.parts
        ?.map((part) => part?.text ?? "")
        .join("")
        .trim() ?? "";
    if (!text) throw new Error("Gemini returned empty transcript");
    return res.json({ text });
  } catch (err) {
    console.error("[sim.runtime] stt_failed", err);
    return res.status(500).json({ error: "internal_error" });
  }
}

const ProctoringSchema = z.object({
  image: z.string().min(10),
  simulationId: z.string().min(1),
});

r.post("/analyze-proctoring", async (req, res) => proctoringHandler(req, res));
r.post("/api/sim/runtime/analyze-proctoring", async (req, res) => proctoringHandler(req, res));

async function proctoringHandler(req, res) {
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
}

export default r;
