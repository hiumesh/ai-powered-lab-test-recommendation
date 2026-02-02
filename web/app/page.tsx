"use client";

import { useState, useEffect, useRef } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowCounterClockwiseIcon,
  PlusIcon,
  SparkleIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";

const patientSchema = z.object({
  age: z.coerce
    .number()
    .min(0, "Age must be valid")
    .max(120, "Age must be valid"),
  gender: z.enum(["M", "F"]),
  abnormal_tests: z
    .array(z.object({ value: z.string().min(1, "Test result required") }))
    .min(1, "At least one abnormal test is required"),
  symptoms: z.array(
    z.object({ value: z.string().min(1, "Symptom description required") }),
  ),
});

type PatientFormValues = z.infer<typeof patientSchema>;

type Recommendation = {
  test_name: string;
  reasoning: string;
  confidence: number;
  priority: string;
  clinical_indication: string;
};

type AnalysisResult = {
  recommendations: Recommendation[];
  reasoning: string;
  error?: string;
};

type HistoryItem = {
  id: string;
  timestamp: string;
  input: PatientFormValues;
  output: AnalysisResult;
};

export default function Home() {
  const [streamData, setStreamData] = useState<AnalysisResult>({
    recommendations: [],
    reasoning: "",
  });
  const [isStreaming, setIsStreaming] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<string>("");

  const stepMessages: Record<string, string> = {
    validate_input: "Validating patient data...",
    retrieve_context: "Searching medical knowledge base...",
    generate_recommendations: "Generating recommendations...",
    format_output: "Finalizing result...",
    cached_result: "Result found in cache...",
  };

  // Ref for auto-scrolling the reasoning text
  const reasoningEndRef = useRef<HTMLDivElement>(null);

  const form = useForm({
    resolver: zodResolver(patientSchema),
    defaultValues: {
      age: 45,
      gender: "M",
      abnormal_tests: [{ value: "" }],
      symptoms: [{ value: "" }],
    },
  });

  const {
    fields: testFields,
    append: appendTest,
    remove: removeTest,
  } = useFieldArray({
    control: form.control,
    name: "abnormal_tests",
  });

  const {
    fields: symptomFields,
    append: appendSymptom,
    remove: removeSymptom,
  } = useFieldArray({
    control: form.control,
    name: "symptoms",
  });

  useEffect(() => {
    const savedHistory = localStorage.getItem("lab_recommendation_history");
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
  }, []);

  useEffect(() => {
    if (isStreaming && reasoningEndRef.current) {
      reasoningEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [streamData.reasoning, isStreaming]);

  const saveToHistory = (input: PatientFormValues, output: AnalysisResult) => {
    const newItem: HistoryItem = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      input,
      output,
    };
    const updatedHistory = [newItem, ...history];
    setHistory(updatedHistory);
    localStorage.setItem(
      "lab_recommendation_history",
      JSON.stringify(updatedHistory),
    );
  };

  const onSubmit = async (data: PatientFormValues) => {
    setIsStreaming(true);
    setError(null);
    setStreamData({ recommendations: [], reasoning: "" });
    setCurrentStep("Initializing...");

    // Format data for API
    const payload = {
      age: data.age,
      gender: data.gender,
      abnormal_tests: data.abnormal_tests.map((t) => t.value),
      symptoms: data.symptoms
        .map((s) => s.value)
        .filter(Boolean)
        .join(", "),
    };

    try {
      const apiBaseUrl =
        process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      const response = await fetch(`${apiBaseUrl}/recommend-tests/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error("Network response was not ok");
      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      let finalRecommendations: Recommendation[] = [];
      let finalReasoning = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const jsonStr = line.slice(6);
            if (jsonStr === "[DONE]") break;

            try {
              const parsed = JSON.parse(jsonStr);

              if (parsed.error) {
                setError(parsed.error);
                setIsStreaming(false);
                return;
              }

              if (parsed.step) {
                setCurrentStep(stepMessages[parsed.step] || parsed.step);

                if (
                  parsed.step === "generate_recommendations" ||
                  parsed.step === "format_output"
                ) {
                  const chunkData = parsed.data;
                  setStreamData((prev) => {
                    const newData = { ...prev };
                    if (chunkData.recommendations) {
                      newData.recommendations = chunkData.recommendations;
                      finalRecommendations = chunkData.recommendations;
                    }
                    if (chunkData.reasoning) {
                      newData.reasoning = chunkData.reasoning;
                      finalReasoning = chunkData.reasoning;
                    }
                    return newData;
                  });
                } else if (parsed.step === "cached_result") {
                  const chunkData = parsed.data;
                  setStreamData({
                    recommendations: chunkData.recommendations || [],
                    reasoning: chunkData.overall_reasoning || "",
                  });
                  finalRecommendations = chunkData.recommendations || [];
                  finalReasoning = chunkData.overall_reasoning || "";
                }
              }
            } catch (e) {
              console.error("Error parsing chunk", e, line);
            }
          }
        }
      }

      saveToHistory(data, {
        recommendations: finalRecommendations,
        reasoning: finalReasoning,
      });
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to fetch recommendations");
      }
    } finally {
      setIsStreaming(false);
      setCurrentStep("");
    }
  };

  const loadHistoryItem = (item: HistoryItem) => {
    form.reset({
      age: item.input.age,
      gender: item.input.gender,
      abnormal_tests: item.input.abnormal_tests,
      symptoms: item.input.symptoms,
    });
    setStreamData(item.output);
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem("lab_recommendation_history");
  };

  const startNewAnalysis = () => {
    form.reset({
      age: 45,
      gender: "M",
      abnormal_tests: [{ value: "" }],
      symptoms: [{ value: "" }],
    });
    setStreamData({ recommendations: [], reasoning: "" });
    setError(null);
    setIsStreaming(false);
    setCurrentStep("");
  };

  return (
    <div className="h-screen bg-slate-50 dark:bg-slate-950 p-2 md:p-4 font-sans">
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 lg:grid-rows-1 gap-2 h-[calc(100vh-2rem)]">
        <div className="lg:col-span-3 flex flex-col gap-2 h-full">
          <Card className="flex-1 flex flex-col border border-slate-200 dark:border-slate-800 ring-0 overflow-hidden">
            <CardHeader className="pb-4 bg-white dark:bg-slate-900 z-10">
              <CardTitle className="flex items-center justify-between text-xl text-primary">
                <div className="flex items-center gap-2">
                  <SparkleIcon className="w-5 h-5 text-indigo-500" />
                  AI Lab Consultant
                </div>
              </CardTitle>
              <CardDescription>
                Enter patient data to get localized lab test recommendations.
              </CardDescription>
              <Button
                size="sm"
                onClick={startNewAnalysis}
                className="h-8 text-xs font-normal"
              >
                <PlusIcon className="w-3 h-3 mr-1" />
                New Analysis
              </Button>
            </CardHeader>

            <ScrollArea className="flex-1 bg-white dark:bg-slate-900">
              <CardContent className="space-y-6 pt-2">
                <form
                  id="recommendation-form"
                  onSubmit={form.handleSubmit((data) => onSubmit(data))}
                  className="space-y-6"
                >
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="age">Age</Label>
                      <Input
                        id="age"
                        type="number"
                        {...form.register("age")}
                        className="bg-slate-50 border-slate-200"
                      />
                      {form.formState.errors.age && (
                        <p className="text-xs text-red-500">
                          {form.formState.errors.age.message}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="gender">Gender</Label>
                      <Select
                        onValueChange={(val) =>
                          form.setValue("gender", val as "M" | "F")
                        }
                        defaultValue={form.getValues("gender")}
                      >
                        <SelectTrigger className="bg-slate-50 border-slate-200">
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="M">Male</SelectItem>
                          <SelectItem value="F">Female</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                        Abnormal Tests
                      </Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => appendTest({ value: "" })}
                        className="h-7 text-xs"
                      >
                        <PlusIcon className="w-3 h-3 mr-1" /> Add
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {testFields.map((field, index) => (
                        <div key={field.id} className="flex gap-2">
                          <Input
                            {...form.register(
                              `abnormal_tests.${index}.value` as const,
                            )}
                            placeholder="e.g. Hemoglobin 8.5 g/dL"
                            className="bg-slate-50 border-slate-200 text-sm"
                          />
                          {testFields.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeTest(index)}
                              className="shrink-0 text-slate-400 hover:text-red-500"
                            >
                              <XIcon className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                      {form.formState.errors.abnormal_tests && (
                        <p className="text-xs text-red-500 flex items-center gap-1">
                          <WarningCircleIcon className="w-3 h-3" />
                          {form.formState.errors.abnormal_tests.message}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                        Symptoms
                      </Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => appendSymptom({ value: "" })}
                        className="h-7 text-xs"
                      >
                        <PlusIcon className="w-3 h-3 mr-1" /> Add
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {symptomFields.map((field, index) => (
                        <div key={field.id} className="flex gap-2">
                          <Input
                            {...form.register(
                              `symptoms.${index}.value` as const,
                            )}
                            placeholder="e.g. Fatigue, Dizziness"
                            className="bg-slate-50 border-slate-200 text-sm"
                          />
                          {symptomFields.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeSymptom(index)}
                              className="shrink-0 text-slate-400 hover:text-red-500"
                            >
                              <XIcon className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </form>
              </CardContent>
            </ScrollArea>

            <CardFooter className="pt-4 border-t bg-slate-50 dark:bg-slate-900">
              <Button
                form="recommendation-form"
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-md transition-all active:scale-[0.98]"
                disabled={isStreaming}
              >
                {isStreaming ? (
                  <span className="flex items-center gap-2">
                    <SparkleIcon className="w-4 h-4 animate-spin" />{" "}
                    {currentStep || "Analyzing..."}
                  </span>
                ) : (
                  "Generate Recommendations"
                )}
              </Button>
            </CardFooter>
          </Card>
        </div>

        <Card className="lg:col-span-6 flex-1 flex flex-col border border-slate-200 dark:border-slate-800 ring-0 overflow-hidden bg-white/50 backdrop-blur-sm h-full">
          <CardHeader className=" bg-white/80 dark:bg-slate-900/80 backdrop-blur">
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
                                  Confidence:{" "}
                                  {(rec.confidence * 100).toFixed(0)}%
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

        <Card className="lg:col-span-3 h-full flex flex-col border border-slate-200 dark:border-slate-800 ring-0 overflow-hidden bg-white dark:bg-slate-900">
          <CardHeader className="bg-white dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base text-slate-900 dark:text-slate-100">
                Session History
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-slate-400 hover:text-slate-600"
                onClick={clearHistory}
              >
                <ArrowCounterClockwiseIcon className="w-3 h-3 mr-1" /> Clear
              </Button>
            </div>
          </CardHeader>
          <div className="flex-1 p-0 min-h-0 overflow-y-auto">
            <div className="p-2 space-y-1">
              {history.length === 0 ? (
                <div className="text-center py-6 text-xs text-slate-400">
                  No recent history
                </div>
              ) : (
                history.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => loadHistoryItem(item)}
                    className="w-full text-left p-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors border border-transparent hover:border-slate-200 flex items-center justify-between group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                        <span>
                          {item.input.age}y / {item.input.gender}
                        </span>
                        <span className="text-slate-300">•</span>
                        <span className="truncate">
                          {new Date(item.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 truncate mt-0.5">
                        {item.input.abnormal_tests.length} tests,{" "}
                        {item.input.symptoms.length} symptoms
                      </div>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <Badge variant="outline" className="text-[10px]">
                        Load
                      </Badge>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
