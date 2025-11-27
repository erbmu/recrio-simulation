import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
const runtimeUrl = (path: string) => `${API}/api/sim/runtime/${path}`;

const FALLBACK_IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kvp8AAAAASUVORK5CYII=";

const buildFallbackImage = (width: number, height: number) => {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return FALLBACK_IMAGE_DATA_URL;
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#0f172a");
    gradient.addColorStop(1, "#1e293b");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    return canvas.toDataURL("image/png");
  } catch (err) {
    console.warn("HonorLock fallback image generation failed", err);
    return FALLBACK_IMAGE_DATA_URL;
  }
};

const captureFrame = (video: HTMLVideoElement) => {
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 480;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return buildFallbackImage(width, height);

  const drawFallback = () => {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, width, height);
  };

  if (!video.srcObject) {
    drawFallback();
  } else {
    try {
      ctx.drawImage(video, 0, 0, width, height);
    } catch (err) {
      console.warn("HonorLock capture fallback", err);
      drawFallback();
    }
  }

  const dataUrl = canvas.toDataURL("image/png");
  return dataUrl && dataUrl !== "data:," ? dataUrl : buildFallbackImage(width, height);
};

const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: "user",
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
  audio: false,
};

const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
  const normalized = dataUrl?.startsWith("data:image") ? dataUrl : FALLBACK_IMAGE_DATA_URL;
  try {
    const response = await fetch(normalized);
    const blob = await response.blob();
    if (blob.size > 0) {
      return blob;
    }
  } catch (err) {
    console.warn("HonorLock data URL fetch fallback", err);
  }

  const arr = normalized.split(",");
  const mime = arr[0]?.match(/:(.*?);/)?.[1] || "image/png";
  const b64 = arr[1] ?? "";
  const binary = atob(b64);
  const uints = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    uints[i] = binary.charCodeAt(i);
  }
  return new Blob([uints], { type: mime });
};

const logError = (label: string, error: unknown) => {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === "string"
        ? error
        : JSON.stringify(error);
  console.error(`[HonorLock] ${label}`, message, error);
  return message;
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
  const [sessionLoading, setSessionLoading] = useState(false);
  const [externalSimulationId, setExternalSimulationId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    let active = true;

    const attachStreamToVideo = (stream: MediaStream) => {
      const tryAttach = () => {
        const videoElement = videoRef.current;
        if (!videoElement) {
          if (active) requestAnimationFrame(tryAttach);
          return;
        }

        if ("srcObject" in videoElement) {
          videoElement.srcObject = stream;
        } else {
          // @ts-expect-error fallback for older browsers
          videoElement.src = window.URL.createObjectURL(stream);
        }

        const playPromise = videoElement.play();
        if (playPromise?.catch) {
          playPromise.catch((err) => console.warn("[HonorLock] video play blocked", err));
        }
      };

      tryAttach();
    };

    async function enableCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Camera access is not supported in this browser. Please switch to a modern browser.");
        setLoading(false);
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        attachStreamToVideo(stream);
      } catch (err) {
        console.error("Camera access failed", err);
        if (active) {
          setError("We couldn't access your camera. Please allow camera access to continue.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    enableCamera();

    return () => {
      active = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const resolveSimulation = async () => {
    if (!token) return null;

    try {
      const path = `resolve/${encodeURIComponent(token)}?stage=preview`;
      const resp = await fetch(`${import.meta.env.VITE_API_URL || "http://localhost:4000"}/api/sim/public/${path}`, {
        headers: { Accept: "application/json" },
      });

      if (!resp.ok) {
        const msg = await resp.text();
        throw new Error(msg || `Failed to resolve simulation (${resp.status})`);
      }

      const data = await resp.json();
      if (data?.used) {
        throw new Error("link_used");
      }
      const extId =
        data?.simulationId ??
        data?.simulation_id ??
        data?.simulation?.id ??
        data?.application?.simulation_id ??
        data?.application?.simulationId;

      return extId ? String(extId) : null;
    } catch (err) {
      logError("resolveSimulation", err);
      throw err instanceof Error ? err : new Error(String(err));
    }
  };

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

  const handleContinue = async () => {
    if (!token || !selfie || !idCapture) return;
    setUploading(true);
    setError("");

    try {
      let simId = externalSimulationId;

      if (!simId) {
        setSessionLoading(true);
        simId = await resolveSimulation();
        if (simId) {
          setExternalSimulationId(simId);
        }
        setSessionLoading(false);
      }

      if (!simId) {
        throw new Error("We couldn’t resolve your simulation link. Please try again later.");
      }

      const resp = await fetch(runtimeUrl("identity"), {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          external_simulation_id: simId,
          selfie_data: selfie,
          id_data: idCapture,
        }),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(text || "Failed to persist identity verification.");
      }

      toast({
        title: "Identity verified",
        description: "Thank you. You can now begin the simulation.",
      });

      navigate(`/sim/${encodeURIComponent(token)}/run`, { replace: true });
    } catch (err) {
      const message = logError("handleContinue", err);
      if (message?.toLowerCase().includes("link_used")) {
        setError(
          "This link has already been used or has expired. Please contact your recruiter if you think this is a mistake.",
        );
      } else {
        setError(`We couldn't save your verification images. ${message ?? "Please try again."}`);
      }
    } finally {
      setUploading(false);
      setSessionLoading(false);
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
                    <video ref={videoRef} className="h-full w-full object-cover" playsInline autoPlay muted />
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
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                    onClick={() => setSelfie(null)}
                  >
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
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                    onClick={() => setIdCapture(null)}
                  >
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
