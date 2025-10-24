// Supabase Edge Function (Deno runtime)
// Endpoint: https://<PROJECT>.functions.supabase.co/create-from-ats

type AtsPayload = {
  application_id: number;
  job_id: number;
  job_title: string;
  job_description: string;
  company_description: string;
  candidate?: {
    name?: string;
    email?: string;
    linkedin_url?: string | null;
  };
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  // 1) Simple auth via header
  const expected = Deno.env.get("SIM_WEBHOOK_SECRET") ?? "";
  const got = req.headers.get("x-sim-webhook-secret") ?? "";
  if (!expected || got !== expected) return json(401, { error: "unauthorized" });

  // 2) Parse body
  let body: AtsPayload;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "bad_json" });
  }
  if (!body?.application_id || !body?.job_title) {
    return json(400, { error: "missing_fields" });
  }

  // 3) Build (or actually generate) a simulation URL
  // For now we just mint a link you can open; replace this with your real generator later
  const publicBase = Deno.env.get("PUBLIC_SIM_BASE") ?? "https://recrio-ai-hire-sim.vercel.app";
  const short = crypto.randomUUID().slice(0, 8);
  const url = `${publicBase}/sim/${body.application_id}-${short}`;

  // TODO: you can also enqueue deeper work here if you want

  return json(200, { ok: true, url });
});
