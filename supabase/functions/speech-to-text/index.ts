import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const sanitizeBase64 = (value: string) => value.replace(/^data:[^;]+;base64,/, "").replace(/[\r\n\s]/g, "");

const decodeBase64ToUint8Array = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const extensionFromMime = (mime: string) => {
  if (mime.includes("mp4") || mime.includes("mpeg")) return "mp4";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("x-m4a")) return "m4a";
  return "webm";
};

async function transcribeWithGemini(apiKey: string, audioBase64: string, mimeType: string) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite-preview-02-05:generateContent" +
    `?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: "You are a precise transcription engine. Return the verbatim transcript of this audio.",
            },
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
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${errorText}`);
  }

  const json = await response.json();
  const candidate = json?.candidates?.find((c: unknown) => c?.content?.parts?.length);
  const text =
    candidate?.content?.parts
      ?.map((part: { text?: string }) => part?.text ?? "")
      .join("")
      .trim() ?? "";

  if (!text) {
    throw new Error("Gemini returned an empty transcript");
  }

  return text;
}

async function transcribeWithWhisper(apiKey: string, audioBase64: string, mimeType: string) {
  const binaryAudio = decodeBase64ToUint8Array(audioBase64);
  const ext = extensionFromMime(mimeType);

  const formData = new FormData();
  const blob = new Blob([binaryAudio], { type: mimeType });
  formData.append("file", blob, `audio.${ext}`);
  formData.append("model", "whisper-1");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${error}`);
  }

  const result = await response.json();
  if (!result?.text) {
    throw new Error("OpenAI returned an empty transcript");
  }
  return result.text as string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { audio, mimeType } = await req.json();

    if (!audio) {
      throw new Error("No audio data provided");
    }

    const cleanedAudio = sanitizeBase64(audio);
    const contentType = typeof mimeType === "string" && mimeType.trim().length > 0 ? mimeType : "audio/webm";

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

    if (!GEMINI_API_KEY && !OPENAI_API_KEY) {
      throw new Error("No transcription provider configured (set GEMINI_API_KEY or OPENAI_API_KEY).");
    }

    let transcript: string | null = null;
    let lastError: Error | null = null;

    if (GEMINI_API_KEY) {
      try {
        transcript = await transcribeWithGemini(GEMINI_API_KEY, cleanedAudio, contentType);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.error("Gemini transcription failed:", lastError.message);
      }
    }

    if (!transcript && OPENAI_API_KEY) {
      try {
        transcript = await transcribeWithWhisper(OPENAI_API_KEY, cleanedAudio, contentType);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.error("OpenAI transcription failed:", lastError.message);
      }
    }

    if (!transcript) {
      throw lastError ?? new Error("Unable to transcribe audio.");
    }

    return new Response(JSON.stringify({ text: transcript }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in speech-to-text:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
