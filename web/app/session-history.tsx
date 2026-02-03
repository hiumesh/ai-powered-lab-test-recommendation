import { z } from "zod";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { patientSchema } from "./zod-schema";

type PatientFormValues = z.infer<typeof patientSchema>;

export default function SessionHistory({
  history,
  clearHistory,
  loadHistoryItem,
}: {
  history: HistoryItem<PatientFormValues>[];
  clearHistory: () => void;
  loadHistoryItem: (item: HistoryItem<PatientFormValues>) => void;
}) {
  return (
    <Card className="lg:col-span-3 flex flex-col border border-slate-200 dark:border-slate-800 ring-0 overflow-hidden bg-white dark:bg-slate-900 h-full">
      <CardHeader className="bg-white dark:bg-slate-900 shrink-0">
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
  );
}
