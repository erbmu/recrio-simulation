import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image } = await req.json();

    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not configured");
    }
    if (!image) {
      throw new Error("Missing image payload");
    }

    const systemPrompt = `You are a VERY STRICT proctoring system analyzing exam surveillance footage.
Analyze this image and detect ANY of these violations with HIGH sensitivity:

1. MULTIPLE PEOPLE: More than one person visible in the frame - IMMEDIATE VIOLATION

2. FACE NOT FULLY VISIBLE (CRITICAL): The person's ENTIRE face must be clearly visible and centered in frame. Flag as "looking_away" if:
   - Only partial face visible (missing forehead, chin, cheeks, etc.)
   - Face is cut off by frame edges
   - Face is turned to the side (not facing camera directly)
   - Face is looking down, up, or away from screen
   - Eyes are not clearly visible
   - Less than 80% of the face is in frame
   - Face is too far from camera or too close
   - Face is obscured by hands, objects, or hair

3. NO PERSON: No person detected in frame at all - IMMEDIATE VIOLATION

4. DEVICE USAGE: ANY handheld object that could be a phone, tablet, or electronic device:
   - Phones (smartphones, even partially visible)
   - Tablets or iPads
   - Smartwatches being looked at
   - Any rectangular handheld device
   - Objects being held near the face or in hands that could be devices

Be EXTREMELY STRICT. The person must be facing the camera directly with their FULL FACE clearly visible. Any deviation should be flagged.
Return high confidence scores (85-100) when detecting violations.`;

    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent" +
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
            parts: [
              { text: "Analyze this proctoring frame for violations and return JSON." },
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: image,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              violation: { type: "boolean" },
              violationType: {
                type: "string",
                enum: ["multiple_people", "looking_away", "no_person", "device_usage", "none"],
              },
              confidence: { type: "number" },
              details: { type: "string" },
            },
            required: ["violation", "violationType", "confidence", "details"],
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error("Failed to analyze proctoring frame");
    }

    const data = await response.json();
    const resultRaw =
      data?.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part?.text ?? "")
        .join("")
        .trim() ?? "";

    if (!resultRaw) {
      throw new Error("Gemini returned an empty response");
    }

    let result;
    try {
      result = JSON.parse(resultRaw);
    } catch (parseErr) {
      console.error("Failed to parse proctoring JSON:", parseErr, resultRaw);
      throw new Error("Failed to parse proctoring analysis output");
    }

    console.log("Proctoring analysis:", result);

    return new Response(
      JSON.stringify(result),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200 
      }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Unknown error",
        violation: false,
        violationType: "none"
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500 
      }
    );
  }
});
