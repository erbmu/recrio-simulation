import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ScoreCard } from "@/components/analytics/ScoreCard";
import { OverallScore } from "@/components/analytics/OverallScore";
import { useMemo } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
const runtimeUrl = (path: string) => `${API}/api/sim/runtime/${path}`;

interface AnalyticsScores {
  overallStartupReadinessIndex: number;
  businessImpactScore: number;
  technicalAccuracy: number;
  tradeOffAnalysis: number;
  communicationClarity: number;
  adaptability: number;
  creativityInnovationIndex: number;
  biasTowardExecution: number;
  learningAgility: number;
  founderFitIndex: number;
  analysis: string;
}

const Analytics = () => {
  const { simulationId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [scores, setScores] = useState<AnalyticsScores | null>(null);
  const [simulation, setSimulation] = useState<any>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    fetchAnalytics();
  }, [simulationId]);

  const fetchAnalytics = async () => {
    if (!simulationId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // Fetch simulation data
      const runResp = await fetch(runtimeUrl(`run/${encodeURIComponent(simulationId)}`), {
        headers: { Accept: "application/json" },
      });
      if (!runResp.ok) {
        const text = await runResp.text().catch(() => "");
        throw new Error(text || "Failed to load simulation");
      }
      const runJson = await runResp.json();
      const runData = runJson?.run;
      setSimulation(runData);

      let report = (runData?.analysis_report || null) as AnalyticsScores | null;

      if (!report) {
        setGenerating(true);
        const analyzeResp = await fetch(runtimeUrl("analyze"), {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ simulationId }),
        });
        if (!analyzeResp.ok) {
          const text = await analyzeResp.text().catch(() => "");
          throw new Error(text || "Failed to generate analysis");
        }
        const analyticsData = await analyzeResp.json();
        report = (analyticsData?.report || null) as AnalyticsScores | null;
        if (report) {
          setSimulation((prev: any) =>
            prev
              ? {
                  ...prev,
                  analysis_report: report,
                  analysis_generated_at: analyticsData?.analysis_generated_at ?? null,
                }
              : prev,
          );
        }
        setGenerating(false);
      }

      if (report) {
        setScores(report);
      }
    } catch (error: any) {
      console.error("Error fetching analytics:", error);
      toast.error("Failed to load analytics");
    } finally {
      setGenerating(false);
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(`/simulation/${simulationId}`)}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Simulation Analytics</h1>
            <p className="text-muted-foreground mt-1">
              Performance metrics and scoring analysis
            </p>
          </div>
        </div>

        {generating && !scores && (
          <Card className="p-6 flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Generating analysis report…</span>
          </Card>
        )}

        {scores && (
          <>
            <OverallScore score={scores.overallStartupReadinessIndex} />

            <Card className="p-6 border-2 border-destructive/20">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-muted-foreground">Violations Detected</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Rule violations during simulation
                  </p>
                </div>
                <div className="text-4xl font-bold text-destructive">
                  {simulation?.violations_count || 0}
                </div>
              </div>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <ScoreCard
                title="Business Impact Score"
                score={scores.businessImpactScore}
                description="How effectively decisions create measurable business value"
              />
              <ScoreCard
                title="Technical Accuracy"
                score={scores.technicalAccuracy}
                description="Correctness and feasibility of technical reasoning"
              />
              <ScoreCard
                title="Trade-Off Analysis"
                score={scores.tradeOffAnalysis}
                description="Ability to reason through alternatives and constraints"
              />
              <ScoreCard
                title="Communication Clarity"
                score={scores.communicationClarity}
                description="Coherence and ability to explain ideas clearly"
              />
              <ScoreCard
                title="Adaptability"
                score={scores.adaptability}
                description="How quickly you adjust to changing requirements"
              />
              <ScoreCard
                title="Creativity / Innovation"
                score={scores.creativityInnovationIndex}
                description="Originality and novelty in proposed ideas"
              />
              <ScoreCard
                title="Bias Toward Execution"
                score={scores.biasTowardExecution}
                description="Proportion of answers that translate to concrete actions"
              />
              <ScoreCard
                title="Learning Agility"
                score={scores.learningAgility}
                description="How effectively you integrate new context or feedback"
              />
              <ScoreCard
                title="Founder-Fit Index"
                score={scores.founderFitIndex}
                description="Composite of creativity, action bias, and ambiguity tolerance"
              />
            </div>

            {scores.analysis && (
              <Card className="p-6">
                <h2 className="text-xl font-semibold mb-4">Detailed Analysis</h2>
                <p className="text-muted-foreground whitespace-pre-wrap">{scores.analysis}</p>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Analytics;
