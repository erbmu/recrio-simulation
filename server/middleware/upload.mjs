import multer from "multer";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { v4 as uuid } from "uuid";

/**
 * Accept: PDF, JSON, DOC, DOCX
 * Server limit: 10 MB (client is stricter at 8 MB)
 */
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXT = new Set(["pdf", "json", "doc", "docx"]);

// Keep uploads inside the server tree
const uploadDir = path.resolve(process.cwd(), "server", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

/* ------------ Magic-byte / content sniffers ------------ */
function isPDF(buf) {
  return buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
}
function isDOC(buf) {
  // OLE Compound File: D0 CF 11 E0 A1 B1 1A E1
  const s = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (buf.length < s.length) return false;
  for (let i = 0; i < s.length; i++) if (buf[i] !== s[i]) return false;
  return true;
}
function isZIP(buf) {
  // ZIP (PK\x03\x04) — DOCX is a zip container
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}
function looksLikeJSON(buf) {
  try {
    const text = buf.toString("utf8").trim();
    if (!text.startsWith("{") && !text.startsWith("[")) return false;
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/* ------------ Filename sanitization ------------ */
function sanitizeFilename(name) {
  const base = path.basename(name).replace(/\s+/g, "_");
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "");
  return cleaned || `file_${Date.now()}`;
}

/* ------------ Detect type by content + extension ------------ */
function detectType(file) {
  const buf = file.buffer || Buffer.alloc(0);
  const ext = (file.originalname.split(".").pop() || "").toLowerCase();

  if (isPDF(buf)) return { ok: true, type: "application/pdf", ext: "pdf" };
  if (looksLikeJSON(buf)) return { ok: true, type: "application/json", ext: "json" };
  if (isDOC(buf)) return { ok: true, type: "application/msword", ext: "doc" };
  if (isZIP(buf) && ext === "docx") {
    return {
      ok: true,
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ext: "docx",
    };
  }
  return { ok: false };
}

/* ------------ Persist memory file to disk ------------ */
async function persistToDisk(file, forcedExt) {
  const safeName = sanitizeFilename(file.originalname);
  const ext = forcedExt || (safeName.includes(".") ? safeName.split(".").pop().toLowerCase() : "");
  const baseNoExt = ext ? safeName.slice(0, -(ext.length + 1)) : safeName;
  const finalExt = forcedExt || ext || "bin";
  const stored = `${Date.now()}-${uuid()}-${baseNoExt}.${finalExt}`;
  const fullPath = path.join(uploadDir, stored);

  await fsp.writeFile(fullPath, file.buffer);

  // mimic Multer diskStorage fields
  file.destination = uploadDir;
  file.filename = stored;
  file.path = fullPath;
}

/* ------------ Multer (memory) + our validation/persist step ------------ */
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = (file.originalname.split(".").pop() || "").toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new Error("Invalid file type"));
    cb(null, true);
  },
});

/**
 * Export a drop-in compatible API:
 *   upload.fields([{ name: 'careerCard', maxCount: 1 }, { name: 'resume', maxCount: 1 }])
 */
export const upload = {
  fields(specs) {
    const m = memoryUpload.fields(specs);
    return async function uploadWithSniff(req, res, next) {
      m(req, res, async (err) => {
        if (err) return next(err);
        try {
          const all = [];
          for (const key of Object.keys(req.files || {})) {
            for (const f of req.files[key]) all.push(f);
          }
          for (const file of all) {
            const det = detectType(file);
            if (!det.ok) {
              const e = new Error("unsupported_media_type");
              e.status = 415;
              throw e;
            }
            await persistToDisk(file, det.ext);
            file.mimetype = det.type;
            file.buffer = undefined; // drop memory copy
          }
          next();
        } catch (e) {
          try {
            for (const key of Object.keys(req.files || {})) {
              for (const f of req.files[key]) {
                if (f?.path) await fsp.unlink(f.path).catch(() => {});
              }
            }
          } catch {}
          next(e);
        }
      });
    };
  },
};
