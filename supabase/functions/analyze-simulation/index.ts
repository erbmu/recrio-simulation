import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const scenario = simulation.generated_scenario;
    
    // Build context from responses
    const responsesContext = responses.map((r: any, idx: number) => 
      `Q${idx + 1}: ${r.question_id}\nA: ${r.response}`
    ).join("\n\n");

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

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Analyze the responses and provide scores." }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "provide_scores",
              description: "Return scoring analysis for all dimensions",
              parameters: {
                type: "object",
                properties: {
                  businessImpactScore: { type: "number", description: "Score 0-100" },
                  technicalAccuracy: { type: "number", description: "Score 0-100" },
                  tradeOffAnalysis: { type: "number", description: "Score 0-100" },
                  communicationClarity: { type: "number", description: "Score 0-100" },
                  adaptability: { type: "number", description: "Score 0-100" },
                  creativityInnovationIndex: { type: "number", description: "Score 0-100" },
                  biasTowardExecution: { type: "number", description: "Score 0-100" },
                  learningAgility: { type: "number", description: "Score 0-100" },
                  founderFitIndex: { type: "number", description: "Score 0-100" },
                  overallStartupReadinessIndex: { type: "number", description: "Weighted composite score 0-100" },
                  analysis: { type: "string", description: "Detailed explanation of scores" }
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
                  "analysis"
                ],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "provide_scores" } }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error("Failed to analyze simulation");
    }

    const data = await response.json();
    const toolCall = data.choices[0].message.tool_calls[0];
    const scores = JSON.parse(toolCall.function.arguments);

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
