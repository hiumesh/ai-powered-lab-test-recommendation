import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SparkleIcon, WarningCircleIcon } from "@phosphor-icons/react";

export default function AnalysisResult({
  isStreaming,
  currentStep,
  error,
  streamData,
  reasoningEndRef,
}: {
  isStreaming: boolean;
  currentStep: string;
  error: string | null;
  streamData: AnalysisResult;
  reasoningEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <Card className="lg:col-span-6 flex flex-col border border-slate-200 dark:border-slate-800 ring-0 overflow-hidden bg-white/50 backdrop-blur-sm h-full">
      <CardHeader className="bg-white/80 dark:bg-slate-900/80 backdrop-blur shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg text-slate-900 dark:text-slate-100">
              Analysis Results
            </CardTitle>
            <CardDescription>
              {isStreaming ? (
                <span className="flex items-center gap-2 text-indigo-600 font-medium">
                  <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse" />
                  {currentStep}
                </span>
              ) : (
                "AI-driven insights and test recommendations"
              )}
            </CardDescription>
          </div>
          {isStreaming && (
            <Badge
              variant="secondary"
              className="animate-pulse bg-indigo-100 text-indigo-700"
            >
              Live Streaming
            </Badge>
          )}
        </div>
      </CardHeader>

      <div className="flex-1 p-0 min-h-0 overflow-y-auto">
        <div className="p-6 space-y-8">
          {error && (
            <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-600 flex items-start gap-3">
              <WarningCircleIcon className="w-5 h-5 mt-0.5 shrink-0" />
              <div className="text-sm font-medium">{error}</div>
            </div>
          )}

          {!streamData.reasoning &&
            !streamData.recommendations.length &&
            !error && (
              <div className="h-64 flex flex-col items-center justify-center text-slate-400 gap-4">
                <SparkleIcon className="w-12 h-12 opacity-20" />
                <p className="text-sm font-medium">
                  Results will appear here...
                </p>
              </div>
            )}

          {streamData.reasoning && (
            <div className="space-y-3 animate-in fade-in duration-500">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-500"></span>{" "}
                Clinical Reasoning
              </h3>
              <div className="text-sm md:text-base leading-relaxed text-slate-700 dark:text-slate-300 bg-indigo-50/50 p-4 rounded-xl border border-indigo-100 dark:bg-indigo-950/20 dark:border-indigo-900/50">
                {streamData.reasoning}
                <div ref={reasoningEndRef} />
              </div>
            </div>
          )}

          {streamData.recommendations.length > 0 && (
            <div className="space-y-4 animate-in slide-in-from-bottom-5 duration-700 delay-200">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>{" "}
                Recommended Tests
              </h3>
              <div className="grid grid-cols-1 gap-4">
                {streamData.recommendations.map((rec, i) => (
                  <Card
                    key={i}
                    className="border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow group"
                  >
                    <CardHeader className="pb-3 pt-5">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <CardTitle className="text-lg font-semibold text-slate-900 dark:text-white group-hover:text-indigo-600 transition-colors">
                            {rec.test_name}
                          </CardTitle>
                          <div className="flex gap-2 mt-2">
                            <Badge
                              variant={
                                rec.priority.toLowerCase() === "high"
                                  ? "destructive"
                                  : "secondary"
                              }
                              className="uppercase text-[10px] tracking-wider font-bold"
                            >
                              {rec.priority} Priority
                            </Badge>
                            <Badge
                              variant="outline"
                              className="text-[10px] text-slate-500"
                            >
                              Confidence: {(rec.confidence * 100).toFixed(0)}%
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pb-4 text-sm text-slate-600 dark:text-slate-400 space-y-2">
                      <p className="font-medium text-slate-900 dark:text-slate-200">
                        {rec.clinical_indication}
                      </p>
                      <p className="border-l-2 border-slate-200 pl-3 italic text-slate-500">
                        {rec.reasoning}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
