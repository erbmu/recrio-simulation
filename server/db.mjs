import "dotenv/config";
import knex from "knex";

const isProd = process.env.NODE_ENV === "production";

function isValidPgUrl(v) {
  if (!v || typeof v !== "string") return false;
  try {
    const u = new URL(v.trim());
    return u.protocol === "postgres:" || u.protocol === "postgresql:";
  } catch {
    return false;
  }
}

function buildConnection() {
  const url = process.env.DATABASE_URL;
  if (isValidPgUrl(url)) {
    return {
      connectionString: url.trim(),
      ssl: isProd ? { rejectUnauthorized: false } : false,
    };
  }
  return {
    host: "127.0.0.1",
    port: 5432,
    user: "recrio",
    password: "recrio",
    database: "recrio",
    ssl: false,
  };
}

export const db = knex({
  client: "pg",
  connection: buildConnection(),
  pool: { min: 2, max: 10 },
});

export async function closeDb() {
  try {
    await db.destroy();
  } catch {
    /* ignore */
  }
}
