import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export const useVoiceRecorder = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>("audio/webm");
  const { toast } = useToast();

  const pickSupportedMimeType = () => {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/mp4;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ];

    for (const type of candidates) {
      // @ts-ignore MediaRecorder exists in supported browsers
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(type)) {
        return type;
      }
    }
    return undefined;
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const supportedType = pickSupportedMimeType();
      const options = supportedType ? { mimeType: supportedType } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      mimeTypeRef.current = mediaRecorder.mimeType || supportedType || "audio/webm";

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error("Error starting recording:", error);
      toast({
        title: "Error",
        description: "Failed to access microphone",
        variant: "destructive",
      });
    }
  };

  const stopRecording = async (): Promise<string | null> => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current) {
        resolve(null);
        return;
      }

      mediaRecorderRef.current.onstop = async () => {
        setIsRecording(false);
        setIsTranscribing(true);

        try {
          const blobType = mimeTypeRef.current || chunksRef.current[0]?.type || "audio/webm";
          const audioBlob = new Blob(chunksRef.current, { type: blobType });
          const reader = new FileReader();
          
          reader.onloadend = async () => {
            const base64Audio = reader.result?.toString().split(",")[1];
            
            if (!base64Audio) {
              toast({
                title: "Error",
                description: "Failed to process audio",
                variant: "destructive",
              });
              setIsTranscribing(false);
              resolve(null);
              return;
            }

            try {
              const { data, error } = await supabase.functions.invoke(
                "speech-to-text",
                {
                  body: { audio: base64Audio, mimeType: blobType },
                }
              );

              if (error) throw error;

              setIsTranscribing(false);
              resolve(data.text);
            } catch (error) {
              console.error("Transcription error:", error);
              toast({
                title: "Error",
                description: "Failed to transcribe audio",
                variant: "destructive",
              });
              setIsTranscribing(false);
              resolve(null);
            }
          };

          reader.readAsDataURL(audioBlob);
        } catch (error) {
          console.error("Error processing recording:", error);
          setIsTranscribing(false);
          resolve(null);
        }

        // Stop all tracks
        mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorderRef.current.stop();
    });
  };

  return {
    isRecording,
    isTranscribing,
    startRecording,
    stopRecording,
  };
};
