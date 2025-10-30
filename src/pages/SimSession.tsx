// src/pages/SimSession.tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Sidebar } from "@/components/simulation/Sidebar";
import { ChatArea, Message } from "@/components/simulation/ChatArea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

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
  qualifications?: string;
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
  completed?: boolean;
}

interface ScenarioAgent {
  name: string;
  role: string;
  personality: string;
}

interface ScenarioChannel {
  id: string;
  name: string;
  description?: string;
}

interface Question {
  id: string;
  channel: string;
  mainQuestion: string;
  context: Array<{ agent: string; message: string }>;
  interstitialDialogue?: Array<{ agent: string; message: string; delayAfterResponse?: number }>;
  followUps: Array<{ id: string; agent: string; question: string }>;
  stimulus?: {
    type: "code" | "document" | "data";
    title: string;
    content: string;
  };
}

interface Scenario {
  agents?: ScenarioAgent[];
  channels?: ScenarioChannel[];
  questions: Question[];
}

const FALLBACK_SCENARIO: Scenario = {
  agents: [
    {
      name: "Ari (Founder/PM)",
      role: "Founder/PM",
      personality: "High-energy pragmatist focused on shipping impact quickly",
    },
    {
      name: "Baa (Lead Engineer)",
      role: "Lead Engineer",
      personality: "Calm systems thinker who values observability and clean rollouts",
    },
    {
      name: "Mira (Design Lead)",
      role: "Design Lead",
      personality: "Research-driven collaborator who champions user empathy",
    },
    {
      name: "Zee (Operations Lead)",
      role: "Operations Lead",
      personality: "Detail-oriented operator who keeps the org compliant and calm",
    },
  ],
  channels: [
    { id: "technical", name: "technical" },
    { id: "product", name: "product" },
    { id: "ops", name: "ops" },
  ],
  questions: [
    {
      id: "tech-q1",
      channel: "technical",
      mainQuestion:
        "Our checkout API is throwing intermittent 500s during peak load. Walk us through how you would stabilize it over the next 48 hours.",
      context: [
        {
          agent: "Ari (Founder/PM)",
          message: "Appreciate you hopping in on short notice—the launch team is on edge.",
        },
        {
          agent: "Baa (Lead Engineer)",
          message:
            "We rolled out a feature flag for the new pricing engine last night. Error rate spiked right after.",
        },
        { agent: "Baa (Lead Engineer)", message: "Mind kicking things off with your plan?" },
      ],
      followUps: [
        {
          id: "tech-q1-f1",
          agent: "Baa (Lead Engineer)",
          question: "Which telemetry or logs would you inspect first and why?",
        },
        {
          id: "tech-q1-f2",
          agent: "Ari (Founder/PM)",
          question: "How do you keep stakeholders calm while you triage?",
        },
      ],
      stimulus: {
        type: "code",
        title: "checkout-controller.ts (excerpt)",
        content:
          "try {\n  await PaymentService.charge(payload);\n} catch (err) {\n  logger.error({ err, payload }, 'charge failed');\n  metrics.increment('payments.failed');\n  throw err;\n}",
      },
    },
    {
      id: "product-q1",
      channel: "product",
      mainQuestion:
        "We promised a partner demo of the analytics dashboard next Friday, but design wants to fix accessibility gaps first. How would you realign the team without blowing the deadline?",
      context: [
        {
          agent: "Mira (Design Lead)",
          message: "Audit flagged contrast issues and missing keyboard states. I'd prefer we fix them pre-demo.",
        },
        {
          agent: "Ari (Founder/PM)",
          message:
            "Sales already invited twelve design partners. We can't slip the date without damaging trust.",
        },
      ],
      followUps: [
        {
          id: "product-q1-f1",
          agent: "Mira (Design Lead)",
          question: "What criteria would you use to decide what ships in the demo versus GA?",
        },
        {
          id: "product-q1-f2",
          agent: "Ari (Founder/PM)",
          question: "How do you communicate the trade-offs to partners so expectations stay aligned?",
        },
      ],
      stimulus: {
        type: "document",
        title: "Demo Milestones",
        content:
          "- Friday: internal design review\n- Monday: engineering polish window\n- Next Friday: partner demo (12 invitees)\n- GA target: 14 days post-demo",
      },
    },
    {
      id: "ops-q1",
      channel: "ops",
      mainQuestion:
        "Support escalated that 12% of enterprise invoices failed to send overnight. Outline the steps you'd take in the next two hours.",
      context: [
        {
          agent: "Zee (Operations Lead)",
          message:
            "Finance is asking whether we should pause invoicing entirely until we understand the blast radius.",
        },
        {
          agent: "Baa (Lead Engineer)",
          message:
            "We deployed a new worker for invoice batching yesterday evening—could be related, not sure yet.",
        },
      ],
      followUps: [
        {
          id: "ops-q1-f1",
          agent: "Zee (Operations Lead)",
          question: "What signals tell you it's safe to resume sending invoices?",
        },
        {
          id: "ops-q1-f2",
          agent: "Ari (Founder/PM)",
          question: "Who do you keep in the loop while you triage, and how often?",
        },
      ],
      stimulus: {
        type: "data",
        title: "Failed Invoice Trend",
        content: "Hour,Failure Rate\n00:00,0.4%\n01:00,0.6%\n02:00,11.8%\n03:00,12.2%\n04:00,12.6%",
      },
    },
  ],
};

const cloneFallbackScenario = (): Scenario =>
  JSON.parse(JSON.stringify(FALLBACK_SCENARIO)) as Scenario;

const isValidScenario = (value: unknown): value is Scenario => {
  if (!value || typeof value !== "object") return false;
  const maybe = value as Partial<Scenario>;
  return Array.isArray(maybe.questions) && maybe.questions.length > 0;
};

type ChannelProgress = Record<string, { questionIndex: number; followUpIndex: number; completed: boolean }>;

export default function SimSession() {
  const { token, payload } = useParams<{ token?: string; payload?: string }>();
  const { toast } = useToast();

  const [session, setSession] = useState<SessionResponse | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [scenarioLoading, setScenarioLoading] = useState(false);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [simulationId, setSimulationId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannel, setActiveChannel] = useState<string>("");
  const [channelMessages, setChannelMessages] = useState<Record<string, Message[]>>({});
  const [channelProgress, setChannelProgress] = useState<ChannelProgress>({});
  const [violations, setViolations] = useState<number>(0);
  const [timeRemaining, setTimeRemaining] = useState<string>("30:00");

  const bootstrapScenario = async (
    scenarioPayload: Scenario,
    sessionData: SessionResponse,
  ): Promise<void> => {
    const persistencePayload = {
      job_description: sessionData.job?.description ?? "",
      company_description: sessionData.org?.company_description ?? "",
      generated_scenario: scenarioPayload,
      status: "in_progress",
      user_id: null,
    };

    try {
      if (!simulationId) {
        const insertResult = await supabase
          .from("simulations")
          .insert(persistencePayload)
          .select("id")
          .single();

        if (insertResult.error) throw insertResult.error;
        if (!insertResult.data?.id) throw new Error("Missing simulation id from Supabase response");
        setSimulationId(String(insertResult.data.id));
      } else {
        const { error: updateError } = await supabase
          .from("simulations")
          .update(persistencePayload)
          .eq("id", simulationId);
        if (updateError) throw updateError;
      }
    } catch (dbErr) {
      throw dbErr;
    }

    applyScenario(scenarioPayload);
  };

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

        const response = await fetch(`${API}/api/sim/public/${path}`, {
          headers: {
            Accept: "application/json",
          },
        });
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

  const scenarioKey = useMemo(
    () => simulationId ?? String(session?.application?.id ?? token ?? payload ?? "public"),
    [simulationId, session?.application?.id, token, payload],
  );

const loadChannelQuestions = useCallback(
  (channelId: string, questions: Question[], force = false) => {
    setChannelMessages((prev) => {
      if (!force && prev[channelId]?.length) {
        return prev;
      }

      const normalizedTarget = channelId.trim().toLowerCase();
      const channelQuestions = questions.filter((q) => {
        const source = (q.channel ?? "").trim().toLowerCase();
        return source === normalizedTarget;
      });
      if (channelQuestions.length === 0) {
        console.warn("No questions found for channel", channelId);
        return prev;
      }

        const firstQuestion = channelQuestions[0];
        const questionMessages: Message[] = [];

        firstQuestion.context.forEach((ctx, idx) => {
          questionMessages.push({
            id: `${channelId}-context-${idx}`,
            role: "agent",
            author: ctx.agent,
            content: ctx.message,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          });
        });

        questionMessages.push({
          id: `${channelId}-${firstQuestion.id}`,
          role: "agent",
          author: firstQuestion.context[0]?.agent || "Team",
          content: firstQuestion.mainQuestion,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          stimulus: firstQuestion.stimulus,
        });

        return { ...prev, [channelId]: questionMessages };
      });
    },
    [],
  );

const applyScenario = useCallback(
  (scenarioPayload: Scenario) => {
    const scenarioChannels =
      (scenarioPayload.channels && scenarioPayload.channels.length > 0
        ? scenarioPayload.channels
        : FALLBACK_SCENARIO.channels) ?? [];

    const normalizedChannels = scenarioChannels.map((ch, idx) => ({
        id: ch.id,
        name: ch.name,
        unread: 0,
        locked: idx !== 0,
        completed: false,
      }));

    const initialProgress: ChannelProgress = {};
    normalizedChannels.forEach((ch) => {
      initialProgress[ch.id] = { questionIndex: 0, followUpIndex: 0, completed: false };
    });

    setScenario(scenarioPayload);
    setChannels(normalizedChannels);
    setChannelProgress(initialProgress);
      setChannelMessages({});

    const firstChannelId = normalizedChannels[0]?.id ?? "";
    if (firstChannelId) {
      loadChannelQuestions(firstChannelId, scenarioPayload.questions, true);
      setActiveChannel(firstChannelId);
      } else {
        setActiveChannel("");
      }
    },
    [loadChannelQuestions],
  );

  const initializeScenario = async (sessionData: SessionResponse) => {
    if (!sessionData?.job) {
      setError("Simulation metadata is incomplete. Please contact support.");
      return;
    }

    setScenarioLoading(true);
    try {
      const { data: functionData, error: functionError } = await supabase.functions.invoke(
        "generate-simulation",
        {
          body: {
            jobDescription: sessionData.job?.description ?? "",
            companyDescription: sessionData.org?.company_description ?? "",
          },
        },
      );

      if (functionError) throw functionError;

      const rawScenario = functionData?.scenario ?? functionData;
      if (!isValidScenario(rawScenario)) {
        throw new Error("Simulation generator returned an unexpected response.");
      }

      await bootstrapScenario(rawScenario, sessionData);
    } catch (err) {
      console.error("[SimSession] scenario generation failed:", err);
      const fallbackScenario = cloneFallbackScenario();
      try {
        await bootstrapScenario(fallbackScenario, sessionData);
        toast({
          title: "Generator unavailable",
          description:
            "We loaded a fallback scenario so you can keep going. Your responses will still be recorded.",
          variant: "destructive",
        });
      } catch (fallbackErr) {
        console.error("[SimSession] fallback scenario bootstrap failed:", fallbackErr);
        setError(
          "We couldn't start the simulation. Please contact your recruiter to request a new link.",
        );
      }
    } finally {
      setScenarioLoading(false);
    }
  };

  useEffect(() => {
    if (!session || scenario || scenarioLoading || error) return;
    void initializeScenario(session);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, scenario, scenarioLoading, error]);

  useEffect(() => {
    if (!scenario || submitted) return;

    const timer = setInterval(() => {
      setTimeRemaining((prev) => {
        const [minutes, seconds] = prev.split(":").map(Number);
        const totalSeconds = minutes * 60 + seconds - 1;

        if (totalSeconds <= 0) {
          clearInterval(timer);
          void handleAutoSubmit();
          return "0:00";
        }

        const newMinutes = Math.floor(totalSeconds / 60);
        const newSeconds = totalSeconds % 60;
        return `${newMinutes}:${newSeconds.toString().padStart(2, "0")}`;
      });
    }, 1000);

    const handleVisibilityChange = () => {
      if (document.hidden) {
        void handleViolation("tab_switch");
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario, submitted]);

  useEffect(() => {
    if (!activeChannel || !scenario) return;
    loadChannelQuestions(activeChannel, scenario.questions);
  }, [activeChannel, scenario, loadChannelQuestions]);

  const handleViolation = async (type: string) => {
    setViolations((prev) => prev + 1);

    if (simulationId) {
      try {
        await supabase.from("simulation_violations").insert({
          simulation_id: simulationId,
          violation_type: type,
        });
      } catch (err) {
        console.error("Error logging violation:", err);
      }
    }

    toast({
      title: "Violation detected",
      description:
        type === "tab_switch"
          ? "Tab switching detected. Please stay focused on the simulation."
          : "Proctoring detected an issue.",
      variant: "destructive",
    });
  };

  const handleChannelSelect = useCallback(
    (channelId: string) => {
      const channelMeta = channels.find((ch) => ch.id === channelId);
      if (!channelMeta || channelMeta.locked) {
        return;
      }

      if (scenario) {
        loadChannelQuestions(channelId, scenario.questions, true);
      }

      setActiveChannel(channelId);
    },
    [channels, loadChannelQuestions, scenario],
  );

  const handleSendResponse = async (rawResponse: string) => {
    if (!scenario || !activeChannel || submitted) return;

    const progress = channelProgress[activeChannel];
    if (!progress) return;

    const response = rawResponse.trim();
    if (!response) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      role: "candidate",
      content: response,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setChannelMessages((prev) => ({
      ...prev,
      [activeChannel]: [...(prev[activeChannel] || []), newMessage],
    }));

    const channelQuestions = scenario.questions.filter((q: Question) => q.channel === activeChannel);
    const currentQuestion = channelQuestions[progress.questionIndex];
    if (!currentQuestion) return;

    const questionId =
      progress.followUpIndex === 0
        ? currentQuestion.id
        : currentQuestion.followUps?.[progress.followUpIndex - 1]?.id;

    if (simulationId) {
      try {
        await supabase.from("simulation_responses").insert({
          simulation_id: simulationId,
          question_id: questionId,
          response,
        });
      } catch (err) {
        console.error("Error saving response:", err);
        toast({
          title: "Error",
          description: "Failed to save response. Please continue and we'll retry.",
          variant: "destructive",
        });
      }
    }

    if (currentQuestion.followUps && progress.followUpIndex < currentQuestion.followUps.length) {
      const followUp = currentQuestion.followUps[progress.followUpIndex];
      setTimeout(() => {
        const followUpMessage: Message = {
          id: `${activeChannel}-${followUp.id}`,
          role: "agent",
          author: followUp.agent,
          content: followUp.question,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };

        setChannelMessages((prev) => ({
          ...prev,
          [activeChannel]: [...(prev[activeChannel] || []), followUpMessage],
        }));

        setChannelProgress((prev) => ({
          ...prev,
          [activeChannel]: {
            ...prev[activeChannel],
            followUpIndex: prev[activeChannel].followUpIndex + 1,
          },
        }));
      }, 1000);
      return;
    }

    if (progress.questionIndex < channelQuestions.length - 1) {
      setTimeout(() => {
        const nextQuestion = channelQuestions[progress.questionIndex + 1];
        let cumulativeDelay = 0;

        nextQuestion.context.forEach((ctx, idx) => {
          setTimeout(() => {
            const contextMessage: Message = {
              id: `${activeChannel}-context-${progress.questionIndex + 1}-${idx}`,
              role: "agent",
              author: ctx.agent,
              content: ctx.message,
              timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            };

            setChannelMessages((prev) => ({
              ...prev,
              [activeChannel]: [...(prev[activeChannel] || []), contextMessage],
            }));
          }, cumulativeDelay);

          cumulativeDelay += 1500;
        });

        setTimeout(() => {
          const questionMessage: Message = {
            id: `${activeChannel}-${nextQuestion.id}`,
            role: "agent",
            author: nextQuestion.context[0]?.agent || "Team",
            content: nextQuestion.mainQuestion,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            stimulus: nextQuestion.stimulus,
          };

          setChannelMessages((prev) => ({
            ...prev,
            [activeChannel]: [...(prev[activeChannel] || []), questionMessage],
          }));

          setChannelProgress((prev) => ({
            ...prev,
            [activeChannel]: {
              questionIndex: prev[activeChannel].questionIndex + 1,
              followUpIndex: 0,
              completed: false,
            },
          }));
        }, cumulativeDelay + 1000);
      }, 1000);
      return;
    }

    setTimeout(() => {
      const completionMessage: Message = {
        id: `${activeChannel}-completion`,
        role: "agent",
        author: "System",
        content: "🎉 Escalation resolved! Great work. Please proceed to the next channel.",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      setChannelMessages((prev) => ({
        ...prev,
        [activeChannel]: [...(prev[activeChannel] || []), completionMessage],
      }));

      let upcomingChannelId: string | null = null;

      setChannels((prev) => {
        const currentIndex = prev.findIndex((ch) => ch.id === activeChannel);
        return prev.map((ch, idx) => {
          if (idx === currentIndex) {
            return { ...ch, locked: false, completed: true };
          }
          if (idx === currentIndex + 1) {
            upcomingChannelId = ch.id;
            return { ...ch, locked: false };
          }
          return ch;
        });
      });

      if (upcomingChannelId && scenario) {
        loadChannelQuestions(upcomingChannelId, scenario.questions, true);
        setActiveChannel(upcomingChannelId);
      }
    }, 1000);
  };

  const handleSubmitSimulation = async () => {
    if (submitted) return;

    if (simulationId) {
      try {
        await supabase
          .from("simulations")
          .update({ status: "submitted", completed_at: new Date().toISOString() })
          .eq("id", simulationId);
      } catch (err) {
        console.error("Error submitting simulation:", err);
      }
    }

    setSubmitted(true);
    toast({
      title: "Simulation submitted",
      description: "Thank you! Your responses are now with the recruiting team.",
    });
  };

  const handleAutoSubmit = async () => {
    await handleSubmitSimulation();
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

  if (loading || scenarioLoading || !session || !scenario || !activeChannel) {
    return (
      <div className="min-h-screen grid place-items-center bg-background p-6">
        <div className="flex items-center gap-3 text-sm text-zinc-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Preparing your simulation…</span>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen grid place-items-center bg-background p-6">
        <div className="max-w-xl w-full rounded-2xl border bg-white p-6 shadow-sm text-center space-y-4">
          <h1 className="text-2xl font-semibold">Simulation submitted</h1>
          <p className="text-sm text-zinc-700">
            Thanks for completing the simulation. Your responses and signals are now being shared
            with the recruiting team. You can close this window.
          </p>
        </div>
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
        onChannelSelect={handleChannelSelect}
        timeRemaining={timeRemaining}
        violations={violations}
        onViolation={handleViolation}
        simulationId={scenarioKey}
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
          messages={channelMessages[activeChannel] || []}
          onSendResponse={handleSendResponse}
          onSubmitSimulation={handleSubmitSimulation}
          violations={violations}
        />
      </div>
    </div>
  );
}
