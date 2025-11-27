import { db } from "../db.mjs";

function computeOverallFromReport(report) {
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
}

function normalizeAnalysisRow(row) {
  if (!row || typeof row !== "object") return null;
  const simulationKey = row.external_simulation_id ? String(row.external_simulation_id) : null;
  if (!simulationKey) return null;

  let analysisReport = row.analysis_report ?? null;
  if (typeof analysisReport === "string" && analysisReport.trim()) {
    try {
      analysisReport = JSON.parse(analysisReport);
    } catch {
      /* keep string */
    }
  }

  return {
    simulation_key: simulationKey,
    analysis_report: analysisReport,
    analysis_generated_at: row.analysis_generated_at ?? null,
    analysis_overall_score: computeOverallFromReport(analysisReport),
  };
}

export async function fetchSimulationAnalyses({ simulationIds = [] } = {}) {
  const uniqueKeys = [
    ...new Set(simulationIds.map((id) => (id != null ? String(id).trim() : "")).filter(Boolean)),
  ];

  const bySimulationId = new Map();
  if (!uniqueKeys.length) return { bySimulationId };

  const rows = await db("simulation_runs")
    .select("external_simulation_id", "analysis_report", "analysis_generated_at")
    .whereIn("external_simulation_id", uniqueKeys);

  for (const row of rows) {
    const normalized = normalizeAnalysisRow(row);
    if (normalized?.simulation_key) {
      bySimulationId.set(normalized.simulation_key, normalized);
    }
  }
  return { bySimulationId };
}

export async function fetchSimulationAnalysis({ simulationId } = {}) {
  if (simulationId == null) return null;
  const key = String(simulationId);
  const row = await db("simulation_runs")
    .select("external_simulation_id", "analysis_report", "analysis_generated_at")
    .where({ external_simulation_id: key })
    .first();
  return row ? normalizeAnalysisRow(row) : null;
}

export async function fetchSimulationResponsesAndViolations(simulationId) {
  if (simulationId == null) return { responses: [], violations: [] };
  const key = String(simulationId);

  const responses = await db("simulation_responses")
    .select("id", "question_id", "response", "timestamp")
    .where({ external_simulation_id: key })
    .orderBy("timestamp", "asc");

  const violations = await db("simulation_violations")
    .select("id", "violation_type", "created_at")
    .where({ external_simulation_id: key })
    .orderBy("created_at", "asc");

  return {
    responses: responses.map((row, idx) => ({
      id: row.id ?? idx,
      question_id: row.question_id ?? null,
      created_at: row.timestamp ?? null,
      content: row.response ?? null,
      raw: row,
    })),
    violations: violations.map((row, idx) => ({
      id: row.id ?? idx,
      type: row.violation_type ?? null,
      created_at: row.created_at ?? null,
      raw: row,
    })),
  };
}

const buildAssetUrl = (path) => {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const base = process.env.HONOR_LOCK_BASE_URL || "";
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
};

export async function fetchIdentityCheck(simulationId) {
  if (simulationId == null) return { selfie_url: null, id_url: null };
  const key = String(simulationId);

  const row = await db("simulation_identity_checks")
    .select("selfie_path", "id_path")
    .where({ external_simulation_id: key })
    .orderBy("created_at", "desc")
    .first();

  if (!row) return { selfie_url: null, id_url: null };
  return {
    selfie_url: buildAssetUrl(row.selfie_path),
    id_url: buildAssetUrl(row.id_path),
  };
}

export { computeOverallFromReport };
