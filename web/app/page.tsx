"use client";

import { useState, useEffect, useRef } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ClockCounterClockwiseIcon,
  ArrowLeftIcon,
} from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { patientSchema } from "./zod-schema";
import SessionHistory from "./session-history";
import AnalysisResult from "./analysis-result";
import FormColumn from "./form-column";
import { useMediaQuery } from "@/hooks/useMediaQuery";

type PatientFormValues = z.infer<typeof patientSchema>;

export default function Home() {
  const [streamData, setStreamData] = useState<AnalysisResult>({
    recommendations: [],
    reasoning: "",
  });
  const [isStreaming, setIsStreaming] = useState(false);
  const [history, setHistory] = useState<HistoryItem<PatientFormValues>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<string>("");
  const [activeMode, setActiveMode] = useState<"form" | "testCases">("form");
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [loadingTestCases, setLoadingTestCases] = useState(true);
  const [mobileView, setMobileView] = useState<"form" | "results">("form");
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);

  const isMobile = useMediaQuery("(max-width: 1023px)");

  const stepMessages: Record<string, string> = {
    validate_input: "Validating patient data...",
    retrieve_context: "Searching medical knowledge base...",
    generate_recommendations: "Generating recommendations...",
    format_output: "Finalizing result...",
    cached_result: "Result found in cache...",
  };

  const reasoningEndRef = useRef<HTMLDivElement>(null);

  const form = useForm<PatientFormValues>({
    resolver: zodResolver(
      patientSchema,
    ) as unknown as Resolver<PatientFormValues>,
    defaultValues: {
      age: 45,
      gender: "M",
      abnormal_tests: [{ value: "" }],
      symptoms: [{ value: "" }],
    },
  });

  useEffect(() => {
    const loadTestCases = async () => {
      try {
        const response = await fetch("/test-data.json");
        if (response.ok) {
          const data: TestCasesData = await response.json();
          setTestCases(data.test_cases);
        } else {
          console.error("Failed to load test cases");
        }
      } catch (error) {
        console.error("Error loading test cases:", error);
      } finally {
        setLoadingTestCases(false);
      }
    };
    loadTestCases();
  }, []);

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
    const newItem: HistoryItem<PatientFormValues> = {
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

    if (isMobile) {
      setMobileView("results");
    }

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

              if (parsed.error && !parsed.step) {
                setError(parsed.error);
                setIsStreaming(false);
                return;
              }

              if (parsed.step) {
                if (parsed.step === "error_handler" && parsed.data?.error) {
                  setError(parsed.data.error);
                  setIsStreaming(false);
                  return;
                }

                setCurrentStep(stepMessages[parsed.step] || parsed.step);

                if (
                  parsed.step === "generate_recommendations" ||
                  parsed.step === "format_output"
                ) {
                  const chunkData = parsed.data;

                  if (chunkData?.error) {
                    console.warn("Skipping chunk with error:", chunkData.error);
                    continue;
                  }

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

  const loadHistoryItem = (item: HistoryItem<PatientFormValues>) => {
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

  const selectTestCase = async (testCase: TestCase) => {
    const formData: PatientFormValues = {
      age: testCase.api_input.age,
      gender: testCase.api_input.gender === "male" ? "M" : "F",
      abnormal_tests: testCase.api_input.abnormal_tests.map((test) => ({
        value: test,
      })),
      symptoms: testCase.api_input.symptoms
        ? testCase.api_input.symptoms
            .split(", ")
            .map((symptom) => ({ value: symptom.trim() }))
        : [{ value: "" }],
    };

    form.reset(formData);

    await onSubmit(formData);
  };

  return (
    <div className="h-screen bg-slate-50 dark:bg-slate-950 p-2 md:p-4 font-sans overflow-hidden">
      <div className="max-w-7xl mx-auto h-[calc(100vh-1rem)] md:h-[calc(100vh-2rem)]">
        {!isMobile ? (
          <div className="grid grid-cols-12 gap-2 h-full">
            <FormColumn
              form={form}
              isStreaming={isStreaming}
              currentStep={currentStep}
              onSubmit={onSubmit}
              startNewAnalysis={startNewAnalysis}
              activeMode={activeMode}
              setActiveMode={setActiveMode}
              testCases={testCases}
              loadingTestCases={loadingTestCases}
              selectTestCase={selectTestCase}
              hasResults={
                streamData.recommendations.length > 0 || !!streamData.reasoning
              }
              onViewResults={() => setMobileView("results")}
            />

            <AnalysisResult
              isStreaming={isStreaming}
              currentStep={currentStep}
              error={error}
              streamData={streamData}
              reasoningEndRef={reasoningEndRef}
            />

            <SessionHistory
              history={history}
              clearHistory={clearHistory}
              loadHistoryItem={loadHistoryItem}
            />
          </div>
        ) : (
          <div className="h-full relative">
            {mobileView === "form" ? (
              <FormColumn
                form={form}
                isStreaming={isStreaming}
                currentStep={currentStep}
                onSubmit={onSubmit}
                startNewAnalysis={startNewAnalysis}
                activeMode={activeMode}
                setActiveMode={setActiveMode}
                testCases={testCases}
                loadingTestCases={loadingTestCases}
                selectTestCase={selectTestCase}
                hasResults={
                  streamData.recommendations.length > 0 ||
                  !!streamData.reasoning
                }
                onViewResults={() => setMobileView("results")}
              />
            ) : (
              <div className="h-full flex flex-col">
                <div className="shrink-0 p-2 bg-white dark:bg-slate-900 border-b">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setMobileView("form")}
                    className="gap-2"
                  >
                    <ArrowLeftIcon className="w-4 h-4" />
                    Back to Form
                  </Button>
                </div>
                <div className="flex-1 min-h-0">
                  <AnalysisResult
                    isStreaming={isStreaming}
                    currentStep={currentStep}
                    error={error}
                    streamData={streamData}
                    reasoningEndRef={reasoningEndRef}
                  />
                </div>
              </div>
            )}

            <Button
              onClick={() => setHistoryDrawerOpen(true)}
              className="fixed bottom-4 right-4 h-14 w-14 rounded-full shadow-lg bg-indigo-600 hover:bg-indigo-700 z-50"
              size="icon"
            >
              <div className="relative">
                <ClockCounterClockwiseIcon className="w-6 h-6" />
                {history.length > 0 && (
                  <Badge className="absolute -top-6 -right-6 h-5 min-w-5 flex items-center justify-center p-1 bg-red-500 text-white text-xs">
                    {history.length}
                  </Badge>
                )}
              </div>
            </Button>
            <Sheet open={historyDrawerOpen} onOpenChange={setHistoryDrawerOpen}>
              <SheetContent side="bottom" className="h-[80vh]">
                <SheetHeader>
                  <SheetTitle>Session History</SheetTitle>
                </SheetHeader>
                <div className="mt-4 h-[calc(100%-4rem)] overflow-hidden">
                  <SessionHistory
                    history={history}
                    clearHistory={() => {
                      clearHistory();
                      setHistoryDrawerOpen(false);
                    }}
                    loadHistoryItem={(item) => {
                      loadHistoryItem(item);
                      setHistoryDrawerOpen(false);
                      setMobileView("results");
                    }}
                  />
                </div>
              </SheetContent>
            </Sheet>
          </div>
        )}
      </div>
    </div>
  );
}
