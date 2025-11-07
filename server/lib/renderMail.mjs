// server/lib/renderMail.mjs
const RENDER_API_KEY = process.env.RENDER_API_KEY || "";
const RENDER_MAIL_ENDPOINT = process.env.RENDER_MAIL_ENDPOINT || "https://api.render.com/v1/mail/send";
const DEFAULT_FROM =
  process.env.SIM_INVITE_FROM ||
  process.env.RENDER_MAIL_FROM ||
  "Recrio Hiring <notifications@recrio-mail.com>";
const SUPPORT_EMAIL = process.env.SIM_SUPPORT_EMAIL || "support@recr.io";

const hasRenderMail = Boolean(RENDER_API_KEY);

const buildBody = ({ candidateName, candidateEmail, jobTitle, companyName, simulationUrl }) => {
  const name = candidateName?.trim() || "there";
  const role = jobTitle?.trim() || "the open role";
  const company = companyName?.trim() || "our team";

  const subject = `Recrio simulation for ${company} (${role})`;

  const text = `Hi ${name},

Thanks for your interest in ${company}! Please complete your Recrio simulation so we can keep things moving.

Simulation link: ${simulationUrl}

If you run into any issues, reply to this email or contact ${SUPPORT_EMAIL}.

— Recrio`;

  const html = `<p>Hi ${name},</p>
<p>Thanks for your interest in ${company}! Please complete your Recrio simulation so we can keep things moving.</p>
<p><strong>Simulation link:</strong> <a href="${simulationUrl}">${simulationUrl}</a></p>
<p>If you run into any issues, reply to this email or contact <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
<p>— Recrio</p>`;

  return { subject, text, html, to: candidateEmail };
};

export async function sendSimulationInviteEmail(payload) {
  if (!hasRenderMail) {
    console.warn("[renderMail] Missing RENDER_API_KEY – skipping email send.");
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

  const resp = await fetch(RENDER_MAIL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RENDER_API_KEY}`,
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

export const canSendSimulationEmail = hasRenderMail;
