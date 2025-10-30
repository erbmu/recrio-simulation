import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";

const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { simulation, responses } = await req.json();
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    if (!simulation?.generated_scenario) {
      throw new Error("Simulation payload missing generated scenario");
    }

    const scenario = simulation.generated_scenario;
    const responsesArray = Array.isArray(responses) ? responses : [];

    const responsesContext = responsesArray
      .map((r: Record<string, unknown>, idx: number) => {
        const questionId = typeof r.question_id === "string" ? r.question_id : `unknown-${idx + 1}`;
        const answer = typeof r.response === "string" ? r.response : "";
        return `Q${idx + 1} (${questionId}):\n${answer}`;
      })
      .join("\n\n");

    const systemPrompt = `You are an exceptionally strict expert evaluator for top-tier startup founders and early-stage employees. 
Your standards are extremely high - you're evaluating candidates as if they're applying to YC, Sequoia, or a FAANG company.

EVALUATION PHILOSOPHY:
- Be HIGHLY CRITICAL and set the bar very high
- Scores above 80 should be reserved ONLY for exceptional, standout responses
- Average or mediocre responses should score 40-60
- Weak responses should score below 40
- Look for depth of reasoning, not just surface-level answers
- Penalize vague, generic, or unactionable responses heavily
- Reward specific, data-driven, innovative thinking with concrete execution plans

SCENARIO CONTEXT:
${JSON.stringify(scenario, null, 2)}

CANDIDATE RESPONSES:
${responsesContext}

Provide scores (0-100) for each dimension with STRICT evaluation. Most candidates should score in the 30-70 range. Be brutally honest in your analysis.`;

    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent" +
      `?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
        contents: [
          {
            role: "user",
            parts: [{ text: "Analyze the responses and return strict hiring scores." }],
          },
        ],
        generationConfig: {
          candidateCount: 1,
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: {
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
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error("Failed to analyze simulation");
    }

    const data = await response.json();
    const scoresRaw =
      data?.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part?.text ?? "")
        .join("")
        .trim() ?? "";

    if (!scoresRaw) {
      throw new Error("Gemini returned an empty response");
    }

    let scores;
    try {
      scores = JSON.parse(scoresRaw);
    } catch (parseErr) {
      console.error("Failed to parse Gemini analysis JSON:", parseErr, scoresRaw);
      throw new Error("Failed to parse analysis output");
    }

    if (supabaseAdmin && simulation?.id) {
      const { error: updateError } = await supabaseAdmin
        .from("simulations")
        .update({
          analysis_report: scores,
          analysis_generated_at: new Date().toISOString(),
        })
        .eq("id", simulation.id);

      if (updateError) {
        console.error("Failed to persist analysis report:", updateError);
      }
    } else if (!supabaseAdmin) {
      console.warn("Supabase admin client not configured; skipping report persistence");
    }

    return new Response(
      JSON.stringify({ scores }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200 
      }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500 
      }
    );
  }
});
