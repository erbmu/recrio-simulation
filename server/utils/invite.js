import crypto from "crypto";

// Fast, bias-free 6-char base36 (A–Z 0–9) in uppercase
export function genInviteCode() {
  // 6 chars from 36 symbols ~ 31 bits. Generate 8 bytes and map.
  const buf = crypto.randomBytes(8);
  // Use base36, keep letters+digits, take first 6
  return buf.toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase();
}

// Create a unique code with retry (max 5 tries)
export async function createUniqueInviteCode(prisma, { orgId = null, role = "recruiter", max_uses = 1, ttlMinutes = 1440, created_by_user_id = null } = {}) {
  const expires_at = ttlMinutes ? new Date(Date.now() + ttlMinutes * 60_000) : null;

  for (let i = 0; i < 5; i++) {
    const code = genInviteCode();
    try {
      const row = await prisma.invite_codes.create({
        data: {
          code,
          org_id: orgId ?? null,
          role,
          max_uses,
          uses: 0,
          expires_at,
          created_by_user_id,
        },
      });
      return row;
    } catch (e) {
      // unique violation → try again
      if (e?.code === "P2002" || /duplicate key/.test(e?.message || "")) {
        continue;
      }
      throw e;
    }
  }
  throw new Error("Failed to generate a unique invite code after several attempts");
}
