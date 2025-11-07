// server/lib/supabaseAnalysis.mjs
// Helpers to pull simulation analysis metadata from Supabase using the service role key.

const SUPABASE_REST_BASE =
  (process.env.SUPABASE_URL ||
    process.env.SUPABASE_PROJECT_URL ||
    process.env.SUPABASE_REST_URL ||
    "")
    .trim()
    .replace(/\/+$/, "");

const SERVICE_KEY =
  (process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    "").trim();

const REST_ENDPOINT = SUPABASE_REST_BASE ? `${SUPABASE_REST_BASE}/rest/v1` : "";
const STORAGE_ENDPOINT = SUPABASE_REST_BASE ? `${SUPABASE_REST_BASE}/storage/v1` : "";

let missingConfigWarned = false;
let fetchErrorWarned = false;

const hasConfig = () => {
  const ok = Boolean(REST_ENDPOINT && SERVICE_KEY);
  if (!ok && !missingConfigWarned) {
    console.warn("[supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY – skipping analysis fetches.");
    missingConfigWarned = true;
  }
  return ok;
};

const baseHeaders = SERVICE_KEY
  ? {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: "application/json",
    }
  : {};

const computeOverallFromReport = (report) => {
  if (!report || typeof report !== "object") return null;
  const candidates = [
    report.overallStartupReadinessIndex,
    report.overallScore,
    report.overall,
    report.score,
    report?.scores?.overall,
    report?.scores?.overallScore,
  ];
  for (const candidate of candidates) {
    const n = typeof candidate === "number" ? candidate : Number(candidate);
    if (Number.isFinite(n)) return n;
  }
  return null;
};

const normalizeAnalysisRow = (row) => {
  if (!row || typeof row !== "object") return null;
  const externalRaw =
    row.external_simulation_id ??
    row.externalSimulationId ??
    row.external_simulationID ??
    null;
  const simulationKey = externalRaw != null ? String(externalRaw) : null;

  if (!simulationKey) return null;

  let analysis_report = row.analysis_report ?? row.analysisReport ?? null;
  if (typeof analysis_report === "string") {
    try {
      analysis_report = JSON.parse(analysis_report);
    } catch {
      // leave as string
    }
  }
  const analysis_generated_at = row.analysis_generated_at ?? row.analysisGeneratedAt ?? null;
  const analysis_overall_score = computeOverallFromReport(analysis_report);

  return {
    simulation_key: simulationKey,
    analysis_report,
    analysis_generated_at,
    analysis_overall_score,
  };
};

const buildEq = (value) => `eq.${String(value)}`;

const buildInValues = (values) => `in.(${values.map((v) => String(v)).join(",")})`;

const querySupabaseTable = async (table, { select = "*", filter = {}, order } = {}) => {
  const url = new URL(`${REST_ENDPOINT}/${table}`);
  url.searchParams.set("select", select);
  Object.entries(filter).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  if (order) url.searchParams.set("order", order);

  const resp = await fetch(url.toString(), {
    method: "GET",
    headers: baseHeaders,
  });
  if (!resp.ok) {
    let body = "";
    try {
      body = await resp.text();
    } catch (e) {
      body = e?.message || "";
    }
    const err = new Error(`supabase_fetch_failed ${resp.status}`);
    err.status = resp.status;
    err.body = body;
    err.url = url.toString();
    err.table = table;
    throw err;
  }
  return resp.json();
};

const uniqueStrings = (values = []) => [
  ...new Set(
    values
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter(Boolean)
  ),
];

export async function fetchSimulationAnalyses({ simulationIds = [] } = {}) {
  if (!hasConfig()) return { bySimulationId: new Map() };

  const simulationKeys = uniqueStrings(simulationIds.map((id) => String(id)));

  const bySimulationId = new Map();

  const ingestRows = (rows) => {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      const normalized = normalizeAnalysisRow(row);
      if (!normalized) continue;
      if (normalized.simulation_key) {
        bySimulationId.set(normalized.simulation_key, normalized);
      }
    }
  };

  try {
    if (simulationKeys.length) {
      const filter =
        simulationKeys.length === 1
          ? { external_simulation_id: buildEq(simulationKeys[0]) }
          : { external_simulation_id: buildInValues(simulationKeys) };
      const rows = await querySupabaseTable("simulations", {
        select: "id,analysis_report,analysis_generated_at,external_simulation_id",
        filter,
      });
      ingestRows(rows);
    }

  } catch (err) {
    if (!fetchErrorWarned) {
      fetchErrorWarned = true;
      console.warn(
        "[supabase] Error fetching simulations:",
        err?.message || err,
        err?.status ? `(status ${err.status})` : "",
        err?.body ? `body: ${err.body}` : "",
        err?.url ? `url: ${err.url}` : ""
      );
    }
  }

  return { bySimulationId };
}

export async function fetchSimulationAnalysis({ simulationId } = {}) {
  const { bySimulationId } = await fetchSimulationAnalyses({
    simulationIds: simulationId != null ? [simulationId] : [],
  });

  if (simulationId != null) {
    const key = String(simulationId);
    if (bySimulationId.has(key)) {
      return bySimulationId.get(key) || null;
    }
  }
  return null;
}

const encodeStoragePath = (path) =>
  path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

const signStoragePath = async (bucket, path, expiresIn = 3600) => {
  if (!STORAGE_ENDPOINT || !SERVICE_KEY) return null;
  if (!path) return null;
  try {
    const cleanPath = encodeStoragePath(path.replace(/^\/+/, ""));
    const url = `${STORAGE_ENDPOINT}/object/sign/${bucket}/${cleanPath}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ expiresIn }),
    });
    if (!resp.ok) {
      if (!fetchErrorWarned) {
        const text = await resp.text().catch(() => "");
        fetchErrorWarned = true;
        console.warn(
          "[supabase] Failed to sign storage path:",
          resp.status,
          text
        );
      }
      return null;
    }
    const data = await resp.json().catch(() => null);
    const signed = data?.signedURL || data?.signedUrl;
    if (!signed) return null;
    return `${STORAGE_ENDPOINT}${signed.startsWith("/") ? "" : "/"}${signed}`;
  } catch (err) {
    if (!fetchErrorWarned) {
      fetchErrorWarned = true;
      console.warn("[supabase] Error signing storage path:", err?.message || err);
    }
    return null;
  }
};

const RESPONSE_COLUMNS = [
  "content",
  "response",
  "response_text",
  "answer",
  "body",
  "value",
];

const normalizeResponseRow = (row, idx = 0) => {
  let contentRaw = null;
  for (const key of RESPONSE_COLUMNS) {
    const val = row?.[key];
    if (typeof val === "string" && val.trim()) {
      contentRaw = val;
      break;
    }
  }

  return {
    id: row?.id ?? idx,
    question_id: row?.question_id ?? row?.questionId ?? null,
    created_at: row?.timestamp ?? row?.created_at ?? row?.createdAt ?? null,
    content: contentRaw,
    meta: row?.metadata ?? row?.meta ?? null,
    raw: row,
  };
};

const normalizeViolationRow = (row, idx = 0) => ({
  id: row?.id ?? idx,
  type: (typeof row?.violation_type === "string" && row.violation_type) || null,
  created_at: row?.timestamp ?? row?.created_at ?? row?.createdAt ?? null,
  raw: row,
});

export async function fetchSimulationResponsesAndViolations(simulationId) {
  if (!hasConfig()) return { responses: [], violations: [] };
  if (simulationId == null) return { responses: [], violations: [] };
  const key = String(simulationId);

  const responses = [];
  const violations = [];

  try {
    const respRows = await querySupabaseTable("simulation_responses", {
      select: "id,question_id,timestamp,response",
      filter: { external_simulation_id: buildEq(key) },
      order: "timestamp.asc",
    });
    if (Array.isArray(respRows)) {
      respRows.forEach((row, idx) => {
        responses.push(normalizeResponseRow(row, idx));
      }
      );
    }
  } catch (err) {
    if (!fetchErrorWarned) {
      fetchErrorWarned = true;
      console.warn(
        "[supabase] Error fetching simulation_responses:",
        err?.message || err,
        err?.status ? `(status ${err.status})` : "",
        err?.body ? `body: ${err.body}` : "",
        err?.url ? `url: ${err.url}` : ""
      );
    }
  }

  try {
    const vioRows = await querySupabaseTable("simulation_violations", {
      select: "id,violation_type,timestamp",
      filter: { external_simulation_id: buildEq(key) },
      order: "timestamp.asc",
    });
    if (Array.isArray(vioRows)) {
      vioRows.forEach((row, idx) => {
        violations.push(normalizeViolationRow(row, idx));
      });
    }
  } catch (err) {
    if (!fetchErrorWarned) {
      fetchErrorWarned = true;
      console.warn(
        "[supabase] Error fetching simulation_violations:",
        err?.message || err,
        err?.status ? `(status ${err.status})` : "",
        err?.body ? `body: ${err.body}` : "",
        err?.url ? `url: ${err.url}` : ""
      );
    }
  }

  return { responses, violations };
}

export async function fetchIdentityCheck(simulationId) {
  if (!hasConfig()) return { selfie_url: null, id_url: null };
  if (simulationId == null) return { selfie_url: null, id_url: null };
  const key = String(simulationId);

  try {
    const rows = await querySupabaseTable("simulation_identity_checks", {
      select: "selfie_path,id_path",
      filter: { external_simulation_id: buildEq(key) },
      order: "id.desc",
    });

    if (!Array.isArray(rows) || rows.length === 0) {
      return { selfie_url: null, id_url: null };
    }

    const row = rows[0] || {};
    const selfiePath = typeof row.selfie_path === "string" ? row.selfie_path.trim() : "";
    const idPath = typeof row.id_path === "string" ? row.id_path.trim() : "";

    const [selfie_url, id_url] = await Promise.all([
      selfiePath ? signStoragePath("honor-lock", selfiePath) : Promise.resolve(null),
      idPath ? signStoragePath("honor-lock", idPath) : Promise.resolve(null),
    ]);

    return { selfie_url, id_url };
  } catch (err) {
    if (!fetchErrorWarned) {
      fetchErrorWarned = true;
      console.warn("[supabase] Error fetching identity check:", err?.message || err);
    }
    return { selfie_url: null, id_url: null };
  }
}

export { computeOverallFromReport };
