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
    <div className="max-w-3xl mx-auto p-6">
      <div className="bg-white border border-zinc-200 rounded-2xl p-8 shadow-sm">
        <h1 className="text-2xl font-semibold">Before you begin</h1>

        <ul className="mt-4 space-y-3 text-[15px] text-zinc-700">
          <li>• You’ll have <b>30 minutes</b> to complete the simulation.</li>
          <li>• Your <b>camera</b> and <b>microphone</b> may be used to verify presence.</li>
          <li>• Please <b>don’t switch tabs</b> or copy/paste external content.</li>
          <li>• Violations (tab switches, mic/cam disabled) may be recorded and shared with the recruiter.</li>
          <li>• Be ready to discuss your <b>reasoning</b> and <b>tradeoffs</b>.</li>
        </ul>

        <div className="mt-6 text-sm text-zinc-600">
          By continuing, you consent to the above and to your responses being shared with the hiring team for evaluation.
        </div>

        {err && (
          <div className="mt-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
            {err}
          </div>
        )}

        <div className="mt-6">
          <button
            onClick={handleStart}
            className="inline-flex items-center justify-center rounded-xl bg-black text-white h-11 px-6"
          >
            I’m ready — start
          </button>
        </div>
      </div>
    </div>
  );
}
