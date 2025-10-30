// supabase/functions/generate-simulation/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type ScenarioStimulus =
  | {
      type: "code" | "document" | "data";
      title: string;
      content: string;
    }
  | null;

type ScenarioQuestion = {
  id: string;
  channel: string;
  mainQuestion: string;
  stimulus: ScenarioStimulus;
  context: Array<{ agent: string; message: string }>;
  followUps: Array<{ id: string; agent: string; question: string }>;
};

type GeneratedScenario = {
  agents: Array<{ name: string; role: string; personality: string }>;
  channels: Array<{ id: string; name: string; description?: string }>;
  questions: ScenarioQuestion[];
};

const SCENARIO_SCHEMA = {
  type: "object",
  properties: {
    agents: {
      type: "array",
      minItems: 3,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          role: { type: "string" },
          personality: { type: "string" },
        },
        required: ["name", "role", "personality"],
      },
    },
    channels: {
      type: "array",
      minItems: 3,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
        },
        required: ["id", "name"],
      },
    },
    questions: {
      type: "array",
      minItems: 6,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          channel: { type: "string" },
          mainQuestion: { type: "string" },
          stimulus: {
            anyOf: [
              { type: "null" },
              {
                type: "object",
                properties: {
                  type: {
                    type: "string",
                    enum: ["code", "document", "data"],
                  },
                  title: { type: "string" },
                  content: { type: "string" },
                },
                required: ["type", "title", "content"],
              },
            ],
          },
          context: {
            type: "array",
            minItems: 2,
            items: {
              type: "object",
              properties: {
                agent: { type: "string" },
                message: { type: "string" },
              },
              required: ["agent", "message"],
            },
          },
          followUps: {
            type: "array",
            minItems: 2,
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                agent: { type: "string" },
                question: { type: "string" },
              },
              required: ["id", "agent", "question"],
            },
          },
        },
        required: [
          "id",
          "channel",
          "mainQuestion",
          "stimulus",
          "context",
          "followUps",
        ],
      },
    },
  },
  required: ["agents", "channels", "questions"],
} satisfies Record<string, unknown>;

const sanitize = (value: string | undefined | null) =>
  (value ?? "").trim();

const normalizeScenario = (raw: GeneratedScenario): GeneratedScenario => {
  const agents = (raw.agents ?? []).slice(0, 4).map((agent) => ({
    name: sanitize(agent.name) || "Unnamed",
    role: sanitize(agent.role) || "Teammate",
    personality: sanitize(agent.personality),
  }));

  const channels = (raw.channels ?? []).slice(0, 3).map((channel, idx) => {
    const fallbackId = ["technical", "product", "ops"][idx] ?? `channel-${idx}`;
    const safeId =
      sanitize(channel.id)?.toLowerCase().replace(/\s+/g, "-") || fallbackId;
    return {
      id: safeId,
      name: sanitize(channel.name) || safeId,
      description: sanitize(channel.description),
    };
  });

  const questions = (raw.questions ?? []).map((question, idx) => {
    const normalizedChannel =
      sanitize(question.channel)?.toLowerCase().replace(/\s+/g, "-") ||
      channels[idx % Math.max(1, channels.length)]?.id ||
      "technical";

    const context = (question.context ?? [])
      .map((ctx) => ({
        agent: sanitize(ctx.agent),
        message: sanitize(ctx.message),
      }))
      .filter((ctx) => ctx.agent && ctx.message);

    const followUps = (question.followUps ?? [])
      .map((fu, fuIdx) => ({
        id: sanitize(fu.id) || `${question.id}-follow-${fuIdx + 1}`,
        agent: sanitize(fu.agent) || "Teammate",
        question: sanitize(fu.question),
      }))
      .filter((fu) => fu.question);

    let stimulus: ScenarioStimulus = null;
    if (question.stimulus) {
      const { type, title, content } = question.stimulus;
      if (type && title && content) {
        stimulus = {
          type: type as ScenarioStimulus["type"],
          title: title.trim(),
          content: content.trim(),
        };
      }
    }

    return {
      id: sanitize(question.id) || `q-${idx + 1}`,
      channel: normalizedChannel,
      mainQuestion: sanitize(question.mainQuestion),
      stimulus,
      context,
      followUps,
    };
  });

  const channelIds = new Set(channels.map((c) => c.id));
  channels.forEach((channel) => {
    const hasMatch = questions.some(
      (q) =>
        q.channel.trim().toLowerCase() === channel.id.trim().toLowerCase(),
    );
    if (!hasMatch) {
      const reassignment = questions.find(
        (q) =>
          !channelIds.has(q.channel.trim().toLowerCase()) ||
          !channelIds.has(q.channel),
      );
      if (reassignment) {
        reassignment.channel = channel.id;
      }
    }
  });

  return { agents, channels, questions };
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { jobDescription, companyDescription } = await req.json();
    if (!jobDescription || !companyDescription) {
      return new Response(
        JSON.stringify({
          error:
            "Job description and company description are required",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const systemPrompt = `You are an AI that generates realistic workplace simulation scenarios for hiring assessments.
The simulation should:
1) 3 channels total; 
2) Each channel has exactly 6 questions total (e.g., 3 main + 2 follow-ups each);
3) Include realistic team dialogue BEFORE each main question (2–3 short messages);
4) Distinct AI personas (Founder, Lead Engineer, PM, Designer, etc.);
5) Startup-feel authenticity;
6) 30–40% of questions include realistic stimulus (code/document/data) when referenced.
RULE: If any question text references external material, you MUST include that exact material in the "stimulus" object.`;

    const userPrompt = `Create a hiring simulation for the following role.

Job Description:
${jobDescription}

Company Description:
${companyDescription}

Return the scenario strictly as JSON that matches the provided schema.`;

    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent" +
      `?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    const payload = {
      systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.65,
        responseMimeType: "application/json",
        responseSchema: SCENARIO_SCHEMA,
      },
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("Gemini error:", resp.status, t);
      return new Response(
        JSON.stringify({ error: "Failed to generate simulation" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const data = await resp.json();
    const rawJson =
      data?.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part?.text ?? "")
        .join("")
        .trim() ?? "";

    if (!rawJson) {
      console.error("Gemini returned empty scenario payload", data);
      return new Response(
        JSON.stringify({ error: "Generation returned no content" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let scenarioJson: GeneratedScenario;
    try {
      scenarioJson = JSON.parse(rawJson);
    } catch (e) {
      console.error("JSON parse failed:", e, rawJson.slice(0, 800));
      return new Response(
        JSON.stringify({
          error: "Failed to parse generated scenario. Please try again.",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const normalizedScenario = normalizeScenario(scenarioJson);

    return new Response(JSON.stringify({ scenario: normalizedScenario }), {
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
