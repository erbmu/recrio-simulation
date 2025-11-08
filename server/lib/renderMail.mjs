// server/lib/renderMail.mjs
const PROVIDER = process.env.RENDER_API_KEY
  ? "render"
  : process.env.RESEND_API_KEY
    ? "resend"
    : null;
const API_KEY = process.env.RENDER_API_KEY || process.env.RESEND_API_KEY || "";
const DEFAULT_ENDPOINT =
  PROVIDER === "render" ? "https://api.render.com/v1/mail/send" : "https://api.resend.com/emails";
const MAIL_ENDPOINT = process.env.RENDER_MAIL_ENDPOINT || process.env.RESEND_MAIL_ENDPOINT || DEFAULT_ENDPOINT;
const DEFAULT_FROM =
  process.env.SIM_INVITE_FROM ||
  process.env.RENDER_MAIL_FROM ||
  "Recrio Hiring <notifications@recrio-mail.com>";
const SUPPORT_EMAIL = process.env.SIM_SUPPORT_EMAIL || "support@recr.io";

const hasMailProvider = Boolean(API_KEY);

const buildBody = ({ candidateName, candidateEmail, jobTitle, companyName, simulationUrl }) => {
  const name = candidateName?.trim() || "there";
  const role = jobTitle?.trim() || "your role";
  const company = companyName?.trim() || "our team";

  const subject = `Your Recrio Simulation Is Ready for ${company}`;

  const text = `Hi ${name},

Thank you for your interest in ${company} and for taking the next step with Recrio Simulations.
We’re excited to learn more about you through our short, role-specific simulation (${role}).

Simulation Link:
${simulationUrl}

Please complete the simulation at your earliest convenience so we can move your application forward. Once submitted, our team will review your responses and get back to you shortly.

If you have any questions or encounter any issues, simply reply to this email or contact us at ${SUPPORT_EMAIL} — we’re happy to help.

Best of luck,
Team Recrio`;

  const html = `<p>Hi ${name},</p>
<p>Thank you for your interest in ${company} and for taking the next step with Recrio Simulations. We’re excited to learn more about you through our short, role-specific simulation (${role}).</p>
<p><strong>Simulation Link:</strong></p>
<p><a href="${simulationUrl}" style="display:inline-block;padding:12px 24px;border-radius:999px;background:#111827;color:#f9fafb;text-decoration:none;font-weight:600;">Start Your Simulation</a></p>
<p>If the button doesn’t work, copy and paste this URL: <a href="${simulationUrl}">${simulationUrl}</a></p>
<p>Please complete the simulation at your earliest convenience so we can move your application forward. Once submitted, our team will review your responses and get back to you shortly.</p>
<p>If you have any questions or encounter any issues, simply reply to this email or contact us at <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> — we’re happy to help.</p>
<p>Best of luck,<br/>Team Recrio</p>`;

  return { subject, text, html, to: candidateEmail };
};

export async function sendSimulationInviteEmail(payload) {
  if (!hasMailProvider) {
    console.warn("[renderMail] Missing RENDER_API_KEY / RESEND_API_KEY – skipping email send.");
    return { skipped: true, reason: "missing_api_key" };
  }

  const { subject, text, html, to } = buildBody(payload);
  const body = {
    from: DEFAULT_FROM,
    to,
    subject,
    text,
    html,
  };

  const resp = await fetch(MAIL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const message = await resp.text();
    throw new Error(`Render mail failed (${resp.status}): ${message}`);
  }

  let json = null;
  try {
    json = await resp.json();
  } catch {
    json = { ok: true };
  }
  return json;
}

export const canSendSimulationEmail = hasMailProvider;
export const mailProvider = PROVIDER;
