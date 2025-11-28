import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Camera, CameraOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildApiUrl } from "@/lib/api";

interface CameraProctoringProps {
  onViolation: (type: string) => void;
  simulationId: string;
}

export const CameraProctoring = ({ onViolation, simulationId }: CameraProctoringProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, []);

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: false,
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
      
      setStream(mediaStream);
      setCameraEnabled(true);

      // Start periodic frame capture for analysis
      intervalRef.current = window.setInterval(() => {
        captureAndAnalyzeFrame();
      }, 5000); // Analyze every 5 seconds
    } catch (error) {
      console.error("Error accessing camera:", error);
      onViolation("camera_access_denied");
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    setCameraEnabled(false);
  };

  const captureAndAnalyzeFrame = async () => {
    if (!videoRef.current || !cameraEnabled) return;

    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext("2d");
    
    if (!ctx) return;

    ctx.drawImage(videoRef.current, 0, 0);
    
    // Convert to base64
    const imageData = canvas.toDataURL("image/jpeg", 0.8);
    
    // Send to backend for analysis
    try {
      const response = await fetch(buildApiUrl("/api/sim/runtime/analyze-proctoring"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          image: imageData.split(",")[1],
          simulationId,
        }),
      });

      if (!response.ok) {
        console.error("Proctoring analysis failed");
        return;
      }

      const result = await response.json();
      
      if (result.violation) {
        onViolation(result.violationType);
      }
    } catch (error) {
      console.error("Error analyzing frame:", error);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {cameraEnabled ? (
            <Camera className="h-4 w-4 text-green-500" />
          ) : (
            <CameraOff className="h-4 w-4 text-destructive" />
          )}
          <span className="text-sm font-medium text-white">Proctoring</span>
        </div>
        {cameraEnabled && (
          <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
        )}
      </div>
      
      <div className="relative bg-black/20 rounded-md overflow-hidden aspect-video">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
        />
      </div>
      
      <p className="text-xs text-white/60">
        Stay in frame and alone during the simulation
      </p>
    </div>
  );
};
