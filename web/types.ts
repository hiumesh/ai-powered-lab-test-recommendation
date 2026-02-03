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

type HistoryItem<T> = {
  id: string;
  timestamp: string;
  input: T;
  output: AnalysisResult;
};

type TestCase = {
  source_file: string;
  patient_name: string;
  api_input: {
    age: number;
    gender: string;
    abnormal_tests: string[];
    symptoms: string;
  };
};

type TestCasesData = {
  test_cases: TestCase[];
  total_cases: number;
};
