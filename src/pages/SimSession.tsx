// src/pages/SimSession.tsx
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Sidebar } from "@/components/simulation/Sidebar";
import { ChatArea, Message } from "@/components/simulation/ChatArea";
import { useToast } from "@/hooks/use-toast";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
const USED_LINK_MESSAGE =
  "This link has already been used or has expired. Please contact your recruiter if you think this is a mistake.";

interface Candidate {
  name?: string;
  email?: string;
}

interface Application {
  id?: string | number;
  candidate?: Candidate;
  candidate_name?: string;
  candidate_email?: string;
}

interface Job {
  title?: string;
  description?: string;
}

interface Org {
  company_description?: string;
  [key: string]: unknown;
}

interface SessionResponse {
  application?: Application;
  job?: Job;
  org?: Org;
  error?: string;
}

interface Channel {
  id: string;
  name: string;
  unread?: number;
  locked?: boolean;
}

const DEFAULT_CHANNELS: Channel[] = [
  { id: "technical", name: "technical", unread: 21 },
  { id: "cross-functional", name: "cross-functional", unread: 0 },
  { id: "exec-debrief", name: "exec-debrief", locked: true },
];

const DEFAULT_MESSAGES: Message[] = [
  {
    id: "intro-1",
    role: "system",
    content:
      "As a Software Engineer Intern, you need to enhance the reliability of transactions and improve dashboard performance.",
    timestamp: "9:00 AM",
  },
  {
    id: "intro-2",
    role: "agent",
    author: "Ari (Founder/PM)",
    content: "We need to ensure our transaction system is rock solid.",
    timestamp: "9:01 AM",
  },
  {
    id: "intro-3",
    role: "agent",
    author: "Baa (Lead Engineer)",
    content: "Remember, we have strict uptime requirements and data compliance.",
    timestamp: "9:02 AM",
  },
  {
    id: "intro-4",
    role: "agent",
    author: "Baa (Lead Engineer)",
    content: "How would you approach optimizing SQL queries for transaction reliability?",
    timestamp: "9:02 AM",
  },
  {
    id: "intro-5",
    role: "candidate",
    content:
      "I would start by analyzing query execution plans and adding appropriate indexes...",
    timestamp: "9:05 AM",
  },
  {
    id: "intro-6",
    role: "agent",
    author: "Founder",
    content: "What specific metrics would you track?",
    timestamp: "9:06 AM",
  },
];

export default function SimSession() {
  const { token, payload } = useParams<{ token?: string; payload?: string }>();
  const { toast } = useToast();

  const [session, setSession] = useState<SessionResponse | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const [channels] = useState<Channel[]>(DEFAULT_CHANNELS);
  const [activeChannel, setActiveChannel] = useState<string>(DEFAULT_CHANNELS[0].id);
  const [messages, setMessages] = useState<Message[]>(DEFAULT_MESSAGES);
  const [violations, setViolations] = useState<number>(0);
  const [timeRemaining, setTimeRemaining] = useState<string>("30:00");

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeRemaining((prev) => {
        const [minutes, seconds] = prev.split(":").map(Number);
        const totalSeconds = minutes * 60 + seconds - 1;

        if (totalSeconds <= 0) {
          clearInterval(timer);
          return "0:00";
        }

        const newMinutes = Math.floor(totalSeconds / 60);
        const newSeconds = totalSeconds % 60;
        return `${newMinutes}:${newSeconds.toString().padStart(2, "0")}`;
      });
    }, 1000);

    const handleVisibilityChange = () => {
      if (document.hidden) {
        handleViolation("tab_switch");
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let isMounted = true;
    const key = token ?? payload;

    if (!key) {
      setError("Invalid simulation link");
      setLoading(false);
      return () => {
        isMounted = false;
      };
    }

    setLoading(true);
    setError("");
    setSession(null);

    const fetchSession = async () => {
      try {
        const path = token
          ? `resolve/${encodeURIComponent(token)}`
          : `verify/${encodeURIComponent(payload ?? "")}`;

        const response = await fetch(`${API}/api/sim/public/${path}`);
        const contentType = response.headers.get("content-type") ?? "";
        let body: SessionResponse | null = null;
        let rawText: string | null = null;

        if (contentType.includes("application/json")) {
          body = (await response.json()) as SessionResponse;
        } else {
          rawText = await response.text();
          if (rawText) {
            try {
              body = JSON.parse(rawText) as SessionResponse;
            } catch (parseErr) {
              console.warn("Unexpected non-JSON response:", parseErr, rawText);
            }
          }
        }

        const used =
          response.status === 403 ||
          response.status === 410 ||
          (typeof body?.error === "string" && body.error.toLowerCase() === "used");

        if (!response.ok || used) {
          if (!isMounted) return;
          const msg =
            used
              ? USED_LINK_MESSAGE
              : body?.error ||
                rawText ||
                `Failed to load simulation (${response.status})`;
          setError(msg);
          setLoading(false);
          return;
        }

        if (!body) {
          if (!isMounted) return;
          setError(
            rawText
              ? `Received an unexpected response from the server: ${rawText.slice(0, 160)}`
              : "Received an unexpected response from the server.",
          );
          setLoading(false);
          return;
        }

        if (isMounted) {
          setSession(body);
          setLoading(false);
        }
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : "Failed to load simulation");
        setLoading(false);
      }
    };

    void fetchSession();

    return () => {
      isMounted = false;
    };
  }, [token, payload]);

  const sessionId = useMemo(
    () => String(session?.application?.id ?? token ?? payload ?? "public"),
    [session?.application?.id, token, payload],
  );

  const handleViolation = (type: string) => {
    setViolations((prev) => prev + 1);
    toast({
      title: "Violation detected",
      description:
        type === "tab_switch"
          ? "Tab switching detected. Please stay focused on the simulation."
          : "Proctoring detected an issue.",
      variant: "destructive",
    });
  };

  const handleSendResponse = (response: string) => {
    const newMessage: Message = {
      id: Date.now().toString(),
      role: "candidate",
      content: response,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages((prev) => [...prev, newMessage]);
  };

  const handleSubmitSimulation = () => {
    toast({
      title: "Simulation submitted",
      description: "Your responses are being analyzed. Results will be available shortly.",
    });
  };

  if (error) {
    return (
      <div className="min-h-screen grid place-items-center bg-background p-6">
        <div className="max-w-xl w-full rounded-2xl border bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-red-600">Unable to start simulation</h1>
          <p className="mt-3 text-sm text-zinc-700 whitespace-pre-line">{error}</p>
        </div>
      </div>
    );
  }

  if (loading || !session) {
    return (
      <div className="min-h-screen grid place-items-center bg-background p-6">
        <div className="text-sm text-zinc-600">Loading simulation…</div>
      </div>
    );
  }

  const { job, org, application } = session;
  const candidateName =
    application?.candidate?.name ?? application?.candidate_name ?? undefined;
  const candidateEmail =
    application?.candidate?.email ?? application?.candidate_email ?? undefined;

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar
        channels={channels}
        activeChannel={activeChannel}
        onChannelSelect={setActiveChannel}
        timeRemaining={timeRemaining}
        violations={violations}
        onViolation={handleViolation}
        simulationId={sessionId}
      />

      <div className="flex-1 flex flex-col">
        <div className="border-b border-border bg-white/80 backdrop-blur px-8 py-6">
          <h1 className="text-2xl font-semibold">{job?.title ?? "Simulation"}</h1>
          {job?.description && (
            <p className="mt-2 text-sm text-zinc-700 whitespace-pre-wrap">{job.description}</p>
          )}

          {org?.company_description && (
            <p className="mt-4 text-sm text-zinc-600 whitespace-pre-wrap">
              {org.company_description}
            </p>
          )}

          {(candidateName || candidateEmail) && (
            <div className="mt-4 rounded-xl border border-border bg-white px-4 py-3 text-sm text-zinc-700">
              <div className="font-medium text-zinc-900">Candidate</div>
              {candidateName && <div className="mt-1">Name: {candidateName}</div>}
              {candidateEmail && <div className="mt-1">Email: {candidateEmail}</div>}
            </div>
          )}
        </div>

        <ChatArea
          channelName={activeChannel}
          messages={messages}
          onSendResponse={handleSendResponse}
          onSubmitSimulation={handleSubmitSimulation}
          violations={violations}
        />
      </div>
    </div>
  );
}
