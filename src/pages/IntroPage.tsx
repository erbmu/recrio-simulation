// src/pages/IntroPage.tsx
import { useParams, useNavigate } from "react-router-dom";
import { useState } from "react";

export default function IntroPage() {
  const { token } = useParams<{ token?: string }>();
  const navigate = useNavigate();
  const [err, setErr] = useState<string>("");

  // OPTIONAL sanity: simple token shape guard (e.g., "10-86bc3757")
  const looksOk = /^[a-z0-9-]{6,}$/i.test(token || "");

  async function handleStart() {
    setErr("");

    // (Optional but recommended) ask for cam/mic up front so user sees browser prompt now.
    try {
      if (navigator?.mediaDevices?.getUserMedia) {
        await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      }
    } catch (e) {
      // Don’t block; just show a hint. Your simulation page can try again.
      setErr("We couldn't access your camera/microphone. You can still continue, but please allow access on the next screen.");
    }

    // (Optional) try full screen
    try { await document.documentElement.requestFullscreen?.(); } catch {}

    // Go to the real simulation
    if (token) {
      navigate(`/sim/${encodeURIComponent(token)}/run`, { replace: true });
    }
  }

  if (!looksOk) {
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <div className="max-w-xl w-full rounded-2xl border bg-white p-6">
          <h1 className="text-xl font-semibold">Invalid link</h1>
          <p className="mt-2 text-sm text-zinc-600">
            The simulation link seems malformed. Please use the link provided in your email.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50">
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-12 sm:px-10">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/10 text-sm font-semibold tracking-[0.35em] uppercase">
              R
            </div>
            <span className="text-sm uppercase tracking-[0.45em] text-white/60">Recrio</span>
          </div>
          <div className="text-xs uppercase tracking-[0.35em] text-white/40">Simulation Preview</div>
        </header>

        <main className="mt-16 flex flex-1 flex-col justify-center">
          <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.05] p-10 shadow-[0_30px_60px_-40px_rgba(15,23,42,0.9)] backdrop-blur">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.04),transparent_55%)]" />

            <div className="relative space-y-8">
              <div className="space-y-3">
                <p className="text-sm uppercase tracking-[0.5em] text-white/50">Simulation briefing</p>
                <h1 className="text-4xl font-semibold text-white sm:text-5xl">Ready when you are.</h1>
                <p className="max-w-xl text-base text-white/70">
                  Step into the team’s async workspace. Keep your camera ready, stay in the moment,
                  and respond as if you were already part of the crew.
                </p>
              </div>

              <ul className="grid gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-white/70">
                {[
                  [
                    "30-minute session",
                    "Move through founder, product, and ops threads in one guided flow.",
                  ],
                  [
                    "Presence matters",
                    "We’ll request camera & mic access to keep the experience authentic.",
                  ],
                  [
                    "Focus first",
                    "Stay in the window—tab switches and device checks count as violations.",
                  ],
                  [
                    "Be specific",
                    "Ground your responses in reasoning, metrics, and trade-offs you’d make.",
                  ],
                ].map(([title, copy]) => (
                  <li key={title} className="flex items-start gap-3">
                    <span className="mt-1 h-2 w-2 rounded-full bg-emerald-300" />
                    <div>
                      <p className="text-sm font-medium text-white">{title}</p>
                      <p className="mt-1 text-sm text-white/65">{copy}</p>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="space-y-4 text-sm text-white/60">
                <p>
                  By starting, you consent to Recrio capturing your responses and sharing the session
                  transcript and proctoring signals with the hiring team.
                </p>
                {err && (
                  <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-100">
                    {err}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <button
                  onClick={handleStart}
                  className="inline-flex h-12 items-center justify-center rounded-full bg-white px-8 text-sm font-semibold tracking-wide text-neutral-900 transition duration-150 ease-in-out hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
                >
                  I’m ready — start
                </button>
                <span className="text-xs uppercase tracking-[0.4em] text-white/40">
                  Estimated time • 30 min
                </span>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
