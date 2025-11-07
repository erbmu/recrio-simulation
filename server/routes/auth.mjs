import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { auth } from "../middleware/auth.mjs";

const router = express.Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";

/**
 * POST /api/login
 * body: { email, password }
 * returns: { token }
 */
router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  const emailNorm = String(email).trim().toLowerCase();
  const user = await prisma.users.findFirst({ where: { email: emailNorm } });
  if (!user || !user.password_hash) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  // Coerce BigInts to strings so jsonwebtoken can serialize cleanly
  const payload = {
    id: user.id != null ? String(user.id) : null,
    orgId: user.org_id != null ? String(user.org_id) : null,
    role: user.role || "recruiter",
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "12h" });
  return res.json({ token });
});

/**
 * GET /api/me
 * returns: { id, name, email, role }
 */
router.get("/me", auth, async (req, res) => {
  // ids in JWT are strings — convert for DB
  const id = BigInt(req.user.id);
  const u = await prisma.users.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!u) return res.status(404).json({ error: "User not found" });
  res.json(u);
});

export default router;
