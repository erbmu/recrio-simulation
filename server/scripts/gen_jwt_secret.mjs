// server/scripts/gen_jwt_secret.mjs
// Generates a URL-safe Base64 secret suitable for JWT signing (recommended).
import { randomBytes } from "crypto";

const BYTES = 48; // 48 bytes -> 64+ characters in base64url (strong)
const secret = randomBytes(BYTES).toString("base64url");
console.log(secret);
