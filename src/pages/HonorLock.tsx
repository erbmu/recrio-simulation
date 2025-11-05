import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const captureFrame = (video: HTMLVideoElement) => {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
};

const BUCKET = "honor-lock";

const dataUrlToBlob = (dataUrl: string): Blob => {
  const arr = dataUrl.split(",");
  const mime = arr[0].match(/:(.*?);/)?.[1] || "image/png";
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
};

export default function HonorLock() {
  const { token } = useParams<{ token?: string }>();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [selfie, setSelfie] = useState<string | null>(null);
  const [idCapture, setIdCapture] = useState<string | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [externalSimulationId, setExternalSimulationId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    async function enableCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setLoading(false);
      } catch (err) {
        console.error("Camera access failed", err);
        setError("We couldn't access your camera. Please allow camera access to continue.");
        setLoading(false);
      }
    }

    enableCamera();

    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    let active = true;

    const fetchSession = async () => {
      if (!token) {
        setSessionLoading(false);
        return;
      }

      try {
        const path = `resolve/${encodeURIComponent(token)}`;
        const resp = await fetch(`${import.meta.env.VITE_API_URL || "http://localhost:4000"}/api/sim/public/${path}`, {
          headers: { Accept: "application/json" },
        });

        if (!resp.ok) {
          const msg = await resp.text();
          throw new Error(msg || `Failed to resolve simulation (${resp.status})`);
        }

        const data = await resp.json();
        const extId =
          data?.simulationId ??
          data?.simulation_id ??
          data?.simulation?.id ??
          data?.application?.simulation_id ??
          data?.application?.simulationId;
        if (active && extId) {
          setExternalSimulationId(String(extId));
        }
      } catch (err) {
        console.error("HonorLock resolve error", err);
        if (active) {
          setError("We couldn't verify your simulation link. Please try again or request a new link.");
        }
      } finally {
        if (active) setSessionLoading(false);
      }
    };

    fetchSession();

    return () => {
      active = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [token]);

  const handleCaptureSelfie = () => {
    if (!videoRef.current) return;
    const data = captureFrame(videoRef.current);
    if (data) setSelfie(data);
  };

  const handleCaptureId = () => {
    if (!videoRef.current) return;
    const data = captureFrame(videoRef.current);
    if (data) setIdCapture(data);
  };

  const uploadImage = async (dataUrl: string, kind: "selfie" | "id") => {
    const blob = dataUrlToBlob(dataUrl);
    const fileName = `${externalSimulationId ?? token}-${kind}-${Date.now()}.png`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(fileName, blob, { contentType: "image/png", upsert: true });

    if (uploadError) throw uploadError;

    return uploadData?.path ?? fileName;
  };

  const handleContinue = async () => {
    if (!token || !selfie || !idCapture) return;
    if (!externalSimulationId) {
      setError("We couldn’t resolve your simulation link. Please try again later.");
      return;
    }

    setUploading(true);
    setError("");

    try {
      const selfiePath = await uploadImage(selfie, "selfie");
      const idPath = await uploadImage(idCapture, "id");

      const { error: insertError } = await supabase.from("simulation_identity_checks").insert({
        external_simulation_id: externalSimulationId,
        selfie_path: selfiePath,
        id_path: idPath,
      });

      if (insertError) throw insertError;

      toast({
        title: "Identity verified",
        description: "Thank you. You can now begin the simulation.",
      });

      navigate(`/sim/${encodeURIComponent(token)}/run`, { replace: true });
    } catch (err) {
      console.error("HonorLock upload error", err);
      setError("We couldn't save your verification images. Please try again.");
    } finally {
      setUploading(false);
    }
  };

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
          <div className="text-xs uppercase tracking-[0.35em] text-white/40">Honor Lock</div>
        </header>

        <main className="mt-12 flex flex-1 flex-col gap-8">
          <div className="space-y-3">
            <h1 className="text-3xl font-semibold">Verify your presence</h1>
            <p className="text-sm text-white/70">
              We take attendance seriously. Please capture a quick headshot and your photo ID before
              joining the team workspace. This helps us confirm the right person is taking the
              simulation.
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {sessionLoading && (
            <Alert variant="outline" className="border-white/10 bg-white/[0.05] text-white/70">
              <AlertDescription>Verifying your simulation link…</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
            <Card className="relative overflow-hidden border-white/10 bg-white/[0.05] p-6 shadow-[0_30px_60px_-40px_rgba(15,23,42,0.9)] backdrop-blur">
              <div className="space-y-4">
                <h2 className="text-lg font-semibold">Live camera feed</h2>
                <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                  {loading ? (
                    <div className="flex h-full items-center justify-center text-sm text-white/50">
                      Initializing camera…
                    </div>
                  ) : (
                    <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
                  )}
                </div>
                <p className="text-xs text-white/50">
                  Make sure your face is well lit. We recommend removing hats, glasses, and anything that
                  obscures your features.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button onClick={handleCaptureSelfie} disabled={loading} variant="secondary">
                    Capture Headshot
                  </Button>
                  <Button onClick={handleCaptureId} disabled={loading} variant="outline">
                    Capture Photo ID
                  </Button>
                </div>
              </div>
            </Card>

            <div className="space-y-6">
              <Card className="border-white/10 bg-white/[0.04] p-6 backdrop-blur">
                <h3 className="text-sm uppercase tracking-[0.4em] text-white/50">Headshot</h3>
                <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                  {selfie ? (
                    <img src={selfie} alt="Captured selfie" className="w-full rounded-xl object-cover" />
                  ) : (
                    <p className="text-sm text-white/60">No capture yet. Take a photo to continue.</p>
                  )}
                </div>
                {selfie && (
                  <Button variant="ghost" size="sm" onClick={() => setSelfie(null)}>
                    Retake headshot
                  </Button>
                )}
              </Card>

              <Card className="border-white/10 bg-white/[0.04] p-6 backdrop-blur">
                <h3 className="text-sm uppercase tracking-[0.4em] text-white/50">Photo ID</h3>
                <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                  {idCapture ? (
                    <img src={idCapture} alt="Captured ID" className="w-full rounded-xl object-cover" />
                  ) : (
                    <p className="text-sm text-white/60">Capture the front of your government-issued ID.</p>
                  )}
                </div>
                {idCapture && (
                  <Button variant="ghost" size="sm" onClick={() => setIdCapture(null)}>
                    Retake ID photo
                  </Button>
                )}
              </Card>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-white/10 pt-6">
            <p className="text-xs text-white/50">
              This information is used solely to verify identity for the hiring team and won’t be shared outside the
              process.
            </p>
            <Button
              onClick={handleContinue}
              disabled={!selfie || !idCapture || sessionLoading || uploading}
              className="inline-flex h-12 items-center justify-center rounded-full bg-white px-8 text-sm font-semibold tracking-wide text-neutral-900 transition duration-150 ease-in-out hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
            >
              {uploading ? "Saving…" : "Verify & continue"}
            </Button>
          </div>
        </main>
      </div>
    </div>
  );
}
