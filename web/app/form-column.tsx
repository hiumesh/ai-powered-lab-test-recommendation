import { UseFormReturn, Controller, useFieldArray } from "react-hook-form";
import { z } from "zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PlusIcon,
  SparkleIcon,
  XIcon,
  FlaskIcon,
  UserIcon,
  CaretRightIcon,
} from "@phosphor-icons/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { patientSchema } from "./zod-schema";

type PatientFormValues = z.infer<typeof patientSchema>;

export default function FormColumn({
  form,
  isStreaming,
  currentStep,
  onSubmit,
  startNewAnalysis,
  activeMode,
  setActiveMode,
  testCases,
  loadingTestCases,
  selectTestCase,
  hasResults,
  onViewResults,
}: {
  form: UseFormReturn<PatientFormValues>;
  isStreaming: boolean;
  currentStep: string;
  onSubmit: (data: PatientFormValues) => Promise<void>;
  startNewAnalysis: () => void;
  activeMode: "form" | "testCases";
  setActiveMode: (mode: "form" | "testCases") => void;
  testCases: TestCase[];
  loadingTestCases: boolean;
  selectTestCase: (testCase: TestCase) => Promise<void>;
  hasResults: boolean;
  onViewResults: () => void;
}) {
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

  return (
    <Card className="lg:col-span-3 h-full flex flex-col border border-slate-200 dark:border-slate-800 ring-0 overflow-hidden">
      <CardHeader className="pb-3 bg-white dark:bg-slate-900 z-10 shrink-0">
        <CardTitle className="flex items-center justify-between text-xl text-primary">
          <div className="flex items-center gap-2">
            <SparkleIcon className="w-5 h-5 text-indigo-500" />
            AI Lab Consultant
          </div>
        </CardTitle>
        <CardDescription>
          Enter patient data or select a test case to get AI recommendations.
        </CardDescription>
      </CardHeader>

      <Tabs
        value={activeMode}
        onValueChange={(v) => setActiveMode(v as "form" | "testCases")}
        className="flex-1 flex flex-col min-h-0"
      >
        <div className="px-4 pt-2 shrink-0">
          <TabsList variant="line" className="w-full">
            <TabsTrigger value="form" className="text-xs flex-1">
              <UserIcon className="w-3 h-3 mr-1.5" />
              Manual Input
            </TabsTrigger>
            <TabsTrigger value="testCases" className="text-xs flex-1">
              <FlaskIcon className="w-3 h-3 mr-1.5" />
              Test Cases ({testCases.length})
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="form"
          className="flex-1 flex flex-col overflow-hidden mt-0"
        >
          <div className="px-4 py-2 space-y-2">
            {hasResults && (
              <Button
                size="sm"
                variant="outline"
                onClick={onViewResults}
                className="h-8 text-xs font-normal w-full border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-900/20 lg:hidden"
              >
                <CaretRightIcon className="w-3 h-3 mr-1" />
                View Last Result
              </Button>
            )}
            <Button
              size="sm"
              onClick={startNewAnalysis}
              className="h-8 text-xs font-normal w-full"
            >
              <PlusIcon className="w-3 h-3 mr-1" />
              New Analysis
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto bg-white dark:bg-slate-900">
            <CardContent className="space-y-6 pt-2">
              <form
                id="recommendation-form"
                onSubmit={form.handleSubmit((data: PatientFormValues) =>
                  onSubmit(data),
                )}
                className="space-y-6"
              >
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Controller
                      name="age"
                      control={form.control}
                      render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel htmlFor="age">Age</FieldLabel>
                          <Input
                            id="age"
                            type="number"
                            {...field}
                            aria-invalid={fieldState.invalid}
                          />
                          {fieldState.invalid && (
                            <FieldError errors={[fieldState.error]} />
                          )}
                        </Field>
                      )}
                    />
                  </div>
                  <div className="space-y-2">
                    <Controller
                      name="gender"
                      control={form.control}
                      render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel htmlFor="gender">Gender</FieldLabel>
                          <Select
                            onValueChange={(val) => field.onChange(val)}
                            value={field.value}
                            defaultValue={field.value}
                          >
                            <SelectTrigger
                              className={`bg-slate-50 ${fieldState.invalid ? "border-red-500" : "border-slate-200"}`}
                            >
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="M">Male</SelectItem>
                              <SelectItem value="F">Female</SelectItem>
                            </SelectContent>
                          </Select>
                          {fieldState.invalid && (
                            <FieldError errors={[fieldState.error]} />
                          )}
                        </Field>
                      )}
                    />
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
                      <div key={field.id} className="flex flex-col gap-1">
                        <div className="flex gap-2 flex-1">
                          <Controller
                            name={`abnormal_tests.${index}.value` as const}
                            control={form.control}
                            render={({ field: f, fieldState }) => (
                              <Field
                                className="flex-1"
                                data-invalid={fieldState.invalid}
                              >
                                <Input
                                  {...f}
                                  placeholder="e.g. Hemoglobin 8.5 g/dL"
                                  className={`bg-slate-50 text-sm ${fieldState.invalid ? "border-red-500 focus:border-red-500" : "border-slate-200"}`}
                                  aria-invalid={fieldState.invalid}
                                  aria-describedby={
                                    fieldState.invalid
                                      ? `abnormal_test_${index}_error`
                                      : undefined
                                  }
                                />
                                {fieldState.invalid && (
                                  <FieldError errors={[fieldState.error]} />
                                )}
                              </Field>
                            )}
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
                      </div>
                    ))}
                    {form.formState.errors.abnormal_tests && (
                      <p className="text-xs text-red-500 flex items-center gap-1">
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
                      <div key={field.id} className="flex flex-col gap-1">
                        <div className="flex gap-2 flex-1">
                          <Controller
                            name={`symptoms.${index}.value` as const}
                            control={form.control}
                            render={({ field: f, fieldState }) => (
                              <Field
                                className="flex-1"
                                data-invalid={fieldState.invalid}
                              >
                                <Input
                                  {...f}
                                  placeholder="e.g. Fatigue, Dizziness"
                                  className={`bg-slate-50 text-sm ${fieldState.invalid ? "border-red-500 focus:border-red-500" : "border-slate-200"}`}
                                  aria-invalid={fieldState.invalid}
                                  aria-describedby={
                                    fieldState.invalid
                                      ? `symptom_${index}_error`
                                      : undefined
                                  }
                                />
                                {fieldState.invalid && (
                                  <FieldError errors={[fieldState.error]} />
                                )}
                              </Field>
                            )}
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
                      </div>
                    ))}
                  </div>
                </div>
              </form>
            </CardContent>
          </div>

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
        </TabsContent>

        <TabsContent
          value="testCases"
          className="flex-1 flex flex-col overflow-hidden mt-0"
        >
          <div className="flex-1 overflow-y-auto bg-white dark:bg-slate-900">
            <div className="p-4 space-y-3">
              {loadingTestCases ? (
                <div className="flex items-center justify-center py-12 text-slate-400">
                  <SparkleIcon className="w-6 h-6 animate-spin" />
                </div>
              ) : testCases.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <FlaskIcon className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">No test cases available</p>
                </div>
              ) : (
                testCases.map((testCase, index) => (
                  <Card
                    key={index}
                    className="border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 transition-all hover:shadow-md overflow-hidden"
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                            {testCase.patient_name}
                          </CardTitle>
                          <CardDescription className="text-xs mt-1">
                            {testCase.source_file}
                          </CardDescription>
                        </div>
                        <Badge variant="outline" className="text-xs shrink-0">
                          Case {index + 1}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pb-3 space-y-2">
                      <div className="flex gap-4 text-xs text-slate-600 dark:text-slate-400">
                        <div>
                          <span className="font-medium">Age:</span>{" "}
                          {testCase.api_input.age}
                        </div>
                        <div>
                          <span className="font-medium">Gender:</span>{" "}
                          {testCase.api_input.gender === "male"
                            ? "Male"
                            : "Female"}
                        </div>
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-400">
                        <span className="font-medium">Tests:</span>{" "}
                        {testCase.api_input.abnormal_tests.length} abnormal
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-500 line-clamp-2">
                        {testCase.api_input.symptoms || "No symptoms reported"}
                      </div>
                      <Button
                        size="sm"
                        onClick={() => selectTestCase(testCase)}
                        disabled={isStreaming}
                        className="w-full mt-2 h-8 bg-indigo-600 hover:bg-indigo-700 text-white text-xs"
                      >
                        {isStreaming ? (
                          <>
                            <SparkleIcon className="w-3 h-3 mr-1 animate-spin" />
                            Processing...
                          </>
                        ) : (
                          <>
                            <SparkleIcon className="w-3 h-3 mr-1" />
                            Use This Case
                          </>
                        )}
                      </Button>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </Card>
  );
}
