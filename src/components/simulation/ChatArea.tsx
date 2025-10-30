import { useEffect, useRef, useState } from "react";
import { ChatMessage, MessageRole } from "./ChatMessage";
import { ResponseInput } from "./ResponseInput";
import { Button } from "@/components/ui/button";
import { VoiceParticipants } from "./VoiceParticipants";
import { useTextToSpeech } from "@/hooks/useTextToSpeech";

export interface Message {
  id: string;
  role: MessageRole;
  author?: string;
  content: string;
  timestamp?: string;
  stimulus?: {
    type: "code" | "document" | "data";
    title: string;
    content: string;
  };
}

interface ChatAreaProps {
  channelName: string;
  messages: Message[];
  onSendResponse: (response: string) => void;
  onSubmitSimulation: () => void;
  violations: number;
  inputDisabled?: boolean;
}

export const ChatArea = ({
  channelName,
  messages,
  onSendResponse,
  onSubmitSimulation,
  violations,
  inputDisabled = false,
}: ChatAreaProps) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { speak, stop, currentSpeaker } = useTextToSpeech();
  const [speakers, setSpeakers] = useState<Array<{ name: string; isSpeaking: boolean }>>([]);
  const lastMessageIdRef = useRef<string | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Handle TTS for new messages
  useEffect(() => {
    if (messages.length === 0) return;
    
    const lastMessage = messages[messages.length - 1];
    
    // Only speak agent messages and only new ones
    if (lastMessage.role === "agent" && lastMessage.id !== lastMessageIdRef.current) {
      lastMessageIdRef.current = lastMessage.id;
      const author = lastMessage.author || "System";
      speak(lastMessage.content, author);
    }
  }, [messages, speak]);

  // Update speakers list based on current speaker
  useEffect(() => {
    const uniqueAuthors = Array.from(
      new Set(messages.filter(m => m.role === "agent").map(m => m.author || "System"))
    );
    
    setSpeakers(
      uniqueAuthors.map(name => ({
        name,
        isSpeaking: name === currentSpeaker,
      }))
    );
  }, [messages, currentSpeaker]);

  const handleRecordingStart = () => {
    // Stop any ongoing TTS when user starts recording
    stop();
  };

  return (
    <div className="flex-1 flex flex-col h-screen">
      {/* Voice Participants */}
      {speakers.length > 0 && <VoiceParticipants speakers={speakers} />}
      
      {/* Channel Header */}
      <div className="border-b border-border bg-background px-6 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="text-muted-foreground">#</span>
            {channelName}
          </h2>
          {violations > 0 && (
            <p className="text-xs text-destructive mt-1">
              Violations detected: {violations}
            </p>
          )}
        </div>
        <Button onClick={onSubmitSimulation} size="lg">
          Submit Simulation
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto bg-recrio-chat">
        <div className="max-w-5xl mx-auto">
          {messages.map((message, index) => (
            <ChatMessage
              key={`${message.id}-${index}`}
              role={message.role}
              author={message.author}
              content={message.content}
              timestamp={message.timestamp}
              stimulus={message.stimulus}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Response Input */}
      <ResponseInput 
        onSubmit={onSendResponse} 
        onRecordingStart={handleRecordingStart}
        disabled={inputDisabled}
      />
    </div>
  );
};
