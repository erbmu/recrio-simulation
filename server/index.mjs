// server/index.mjs
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import morgan from "morgan";

import authRoutes from "./routes/auth.mjs";
import adminRoutes from "./routes/admin.mjs";
import simPublicRoutes from "./routes/sim.public.routes.mjs";
import simRoutes from "./routes/sim.routes.mjs";

// ATS APIs
import atsJobsRoutes from "./routes/ats/jobs.routes.mjs";
import atsApplicationsRoutes from "./routes/ats/applications.routes.mjs";
import orgRoutes from "./routes/org.routes.mjs";
import orgPublicRoutes from "./routes/org.public.routes.mjs";

dotenv.config();

const app = express();
app.use(cors({ origin: true, credentials: false }));
const isProd = process.env.NODE_ENV === "production";

app.disable("x-powered-by");
app.use("/api/orgs/public", orgPublicRoutes);  

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "50kb" }));
app.use(
  helmet({
    contentSecurityPolicy: false,
    referrerPolicy: { policy: "no-referrer" },
    frameguard: { action: "deny" },
    crossOriginResourcePolicy: { policy: "same-site" },
    hsts: isProd ? undefined : false,
  })
);
app.use(morgan(isProd ? "combined" : "tiny"));

app.use(orgRoutes);

app.use(simPublicRoutes);
app.use(simRoutes);


// VERY VERBOSE per-request logger
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[SRV][IN]  ${req.method} ${req.originalUrl}`);
  res.on("finish", () => {
    const ms = Date.now() - start;
    console.log(`[SRV][OUT] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// BigInt-safe JSON
app.use((req, res, next) => {
  const orig = res.json;
  res.json = function (data) {
    const safe = JSON.parse(
      JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
    );
    return orig.call(this, safe);
  };
  next();
});

// Simple probes
app.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
app.get("/api/ping", (_req, res) => res.json({ ok: true, where: "/api/ping" }));

/* ---- IMPORTANT: Specific ATS routes FIRST ---- */
app.use("/api/jobs", atsJobsRoutes);
app.use("/api/applications", atsApplicationsRoutes);

/* ---- Then generic /api routers ---- */
app.use("/api", authRoutes);
app.use("/api", adminRoutes);

// Central error handler (avoid leaking stack traces/HTML)
app.use((err, req, res, next) => {
  try {
    console.error("[SRV][ERR]", err);
  } catch {
    /* ignore logging failure */
  }
  if (res.headersSent) return next(err);
  const status = Number(err?.status || err?.statusCode || 500);
  const safeStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
  const message =
    err?.error ||
    err?.message ||
    (safeStatus === 404 ? "not_found" : safeStatus === 403 ? "forbidden" : "internal_error");
  const payload = { error: message };
  if (err?.details && typeof err.details === "object") payload.details = err.details;
  return res.status(safeStatus).json(payload);
});

/* 404 */
app.use((req, res) => {
  console.warn(`[SRV][404] No route matched ${req.method} ${req.originalUrl}`);
  return res.status(404).json({ error: "not_found", path: req.originalUrl });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`✅ API listening on http://localhost:${PORT}`));
