// server/index.mjs
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import morgan from "morgan";

import authRoutes from "./routes/auth.mjs";
import adminRoutes from "./routes/admin.mjs";
import orgRoutes from "./routes/org.routes.mjs";

// ATS APIs
import atsJobsRoutes from "./routes/ats/jobs.routes.mjs";
import atsApplicationsRoutes from "./routes/ats/applications.routes.mjs";

dotenv.config();

const app = express();
const isProd = process.env.NODE_ENV === "production";

app.disable("x-powered-by");
app.use(cors({ origin: true, credentials: false }));
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

app.use(orgRoutes); // routes already start with /api/...


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

/* 404 */
app.use((req, res) => {
  console.warn(`[SRV][404] No route matched ${req.method} ${req.originalUrl}`);
  return res.status(404).json({ error: "not_found", path: req.originalUrl });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`✅ API listening on http://localhost:${PORT}`));