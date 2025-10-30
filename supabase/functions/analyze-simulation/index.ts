// supabase/functions/analyze-simulation/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "[analyze-simulation] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
  );
}

const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;

const SCORE_SCHEMA = {
  type: "object",
  properties: {
    businessImpactScore: { type: "number" },
    technicalAccuracy: { type: "number" },
    tradeOffAnalysis: { type: "number" },
    communicationClarity: { type: "number" },
    adaptability: { type: "number" },
    creativityInnovationIndex: { type: "number" },
    biasTowardExecution: { type: "number" },
    learningAgility: { type: "number" },
    founderFitIndex: { type: "number" },
    overallStartupReadinessIndex: { type: "number" },
    analysis: { type: "string" },
  },
  required: [
    "businessImpactScore",
    "technicalAccuracy",
    "tradeOffAnalysis",
    "communicationClarity",
    "adaptability",
    "creativityInnovationIndex",
    "biasTowardExecution",
    "learningAgility",
    "founderFitIndex",
    "overallStartupReadinessIndex",
    "analysis",
  ],
} satisfies Record<string, unknown>;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!supabaseAdmin) {
      throw new Error("Supabase admin client not configured");
    }
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    const { simulationId } = await req.json();

    if (!simulationId || typeof simulationId !== "string") {
      throw new Error("simulationId is required");
    }

    console.log("[analyze-simulation] start", simulationId);

    const { data: simulation, error: simulationError } = await supabaseAdmin
      .from("simulations")
      .select(
        "id, job_description, company_description, generated_scenario, analysis_report, analysis_generated_at",
      )
      .eq("id", simulationId)
      .single();

    if (simulationError) {
      throw simulationError;
    }

    if (!simulation) {
      throw new Error("Simulation not found");
    }

    if (simulation.analysis_report) {
      console.log("[analyze-simulation] returning cached report", simulationId);
      return new Response(
        JSON.stringify({
          report: simulation.analysis_report,
          analysis_generated_at: simulation.analysis_generated_at,
          cached: true,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    const { data: responses, error: responsesError } = await supabaseAdmin
      .from("simulation_responses")
      .select("question_id, response, timestamp")
      .eq("simulation_id", simulationId)
      .order("timestamp", { ascending: true });

    if (responsesError) {
      throw responsesError;
    }

    const responsesArray = Array.isArray(responses) ? responses : [];

    const responsesBlock =
      responsesArray.length > 0
        ? responsesArray
            .map((entry, idx) => {
              const questionId =
                typeof entry.question_id === "string"
                  ? entry.question_id
                  : `q-${idx + 1}`;
              const answer =
                typeof entry.response === "string" ? entry.response : "";
              return `Q${idx + 1} (${questionId}):\n${answer}`;
            })
            .join("\n\n")
        : "No responses were recorded.";

    const scenarioBlock = JSON.stringify(
      simulation.generated_scenario ?? {},
      null,
      2,
    );

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

    const aiResponse = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.15,
          responseMimeType: "application/json",
          responseSchema: SCORE_SCHEMA,
        },
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("[analyze-simulation] Gemini error", errorText);
      throw new Error("Failed to generate analysis report");
    }

    const aiJson = await aiResponse.json();
    const rawReport =
      aiJson?.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part?.text ?? "")
        .join("")
        .trim() ?? "";

    if (!rawReport) {
      throw new Error("Gemini returned empty analysis output");
    }

    let report;
    try {
      report = JSON.parse(rawReport);
    } catch (err) {
      console.error("[analyze-simulation] parse error", rawReport);
      throw new Error("Failed to parse analysis output");
    }

    const analysisGeneratedAt = new Date().toISOString();

    const { error: updateError } = await supabaseAdmin
      .from("simulations")
      .update({
        analysis_report: report,
        analysis_generated_at: analysisGeneratedAt,
      })
      .eq("id", simulationId);

    if (updateError) {
      console.error("[analyze-simulation] update error", updateError);
      throw updateError;
    }

    console.log("[analyze-simulation] stored report", simulationId);

    return new Response(
      JSON.stringify({
        report,
        analysis_generated_at: analysisGeneratedAt,
        cached: false,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    console.error("[analyze-simulation] error", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      },
    );
  }
});
