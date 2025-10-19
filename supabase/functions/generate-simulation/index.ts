// supabase/functions/generate-simulation/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function extractJsonFrom(text: string) {
  const fence = text.match(/```json\s*([\s\S]*?)\s*```/i) || text.match(/```\s*([\s\S]*?)\s*```/i);
  return (fence ? fence[1] : text).trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { jobDescription, companyDescription } = await req.json();
    if (!jobDescription || !companyDescription) {
      return new Response(JSON.stringify({ error: "Job description and company description are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt =
      `You are an AI that generates realistic workplace simulation scenarios for hiring assessments.
The simulation should:
1) 3 channels total; 
2) Each channel has exactly 6 questions total (e.g., 3 main + 2 follow-ups each);
3) Include realistic team dialogue BEFORE each main question (2–3 short messages);
4) Distinct AI personas (Founder, Lead Engineer, PM, Designer, etc.);
5) Startup-feel authenticity;
6) 30–40% of questions include realistic stimulus (code/document/data) when referenced.
RULE: If any question text references external material, you MUST include that exact material in the "stimulus" object.
Return ONLY a JSON object with this shape:
{
  "agents": [{ "name": "...", "role": "...", "personality": "..." }],
  "channels": [{ "id": "channel-id", "name": "...", "description": "..." }],
  "questions": [{
    "id": "q1",
    "channel": "channel-id",
    "mainQuestion": "...",
    "stimulus": { "type": "code|document|data", "title": "...", "content": "..." } | null,
    "context": [{ "agent": "Name", "message": "..." }, ...],
    "followUps": [{ "id": "q1-f1", "agent": "Name", "question": "..." }, { "id": "q1-f2", ... }]
  }]
}`;

    const userPrompt =
`Create a hiring simulation for:

Job Description:
${jobDescription}

Company Description:
${companyDescription}

Remember: 3 channels; exactly 6 questions per channel (including follow-ups); provide stimulus wherever referenced; return ONLY JSON (no prose).`;

    // Gemini generateContent call
    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"
      + `?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    const payload = {
      systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
      contents: [
        { role: "user", parts: [{ text: userPrompt }] }
      ],
      generationConfig: {
        temperature: 0.8
      }
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("Gemini error:", resp.status, t);
      return new Response(JSON.stringify({ error: "Failed to generate simulation" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || "").join("") || "";

    let scenarioJson;
    try {
      const jsonText = extractJsonFrom(text)
        // safe cleanup for accidental ampersands in JSON strings
        .replace(/": "([^"]*?)&([^"]*?)"/g, (_m, a, b) => `": "${a}\\u0026${b}"`);
      scenarioJson = JSON.parse(jsonText);
    } catch (e) {
      console.error("JSON parse failed:", e, text.slice(0, 800));
      return new Response(JSON.stringify({ error: "Failed to parse generated scenario. Please try again." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ scenario: scenarioJson }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("generate-simulation error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
