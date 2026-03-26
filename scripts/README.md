# Test Input Generation Script

This directory contains scripts for working with the AI Lab Test Recommendation system.

## generate_test_input.py

A Python script that parses medical case files (lab reports in JSON format) and generates the appropriate JSON input format to test the AI Lab Test Recommender API.

### Features

- **Automatic abnormal test detection**: Identifies tests that fall outside normal reference ranges
- **Symptom inference**: Maps abnormal tests to common symptoms
- **Batch processing**: Can process single files or all case files at once
- **API-compatible output**: Generates JSON that matches the `PatientInput` schema

### Usage

#### Process a single case file

```bash
# Print to stdout
python scripts/generate_test_input.py data/inputs/case1.txt

# Save to file
python scripts/generate_test_input.py data/inputs/case1.txt --output test_case1.json
```

#### Process all case files

```bash
python scripts/generate_test_input.py --all --output test_all_cases.json
```

### Output Format

For a single case:

```json
{
  "source_file": "case1.txt",
  "patient_name": "JOHN DOE",
  "api_input": {
    "age": 69,
    "gender": "male",
    "abnormal_tests": [
      "HDL Cholesterol: 35.00 mg/dL (normal: 40.000-60.000)",
      "Absolute Neutrophil Count: 2.03 10^3/µL (normal: 2.000-7.000)"
    ],
    "symptoms": "chest discomfort, shortness of breath, fatigue, frequent infections"
  }
}
```

For all cases (using `--all`):

```json
{
  "test_cases": [
    {
      "source_file": "case1.txt",
      "patient_name": "...",
      "api_input": { ... }
    },
    ...
  ],
  "total_cases": 6
}
```

### Testing the API

Once you've generated the test input, you can use it to test your API:

#### Using curl (single case)

```bash
# Generate test input
python scripts/generate_test_input.py data/inputs/case1.txt --output test_case1.json

# Extract just the api_input portion for the API call
cat test_case1.json | jq '.api_input' > api_request.json

# Test the API
curl -X POST http://localhost:8000/recommend-tests \
  -H "Content-Type: application/json" \
  -d @api_request.json
```

#### Using Python

```python
import json
import requests

# Load generated test input
with open('test_case1.json', 'r') as f:
    data = json.load(f)

# Send to API
response = requests.post(
    'http://localhost:8000/recommend-tests',
    json=data['api_input']
)

print(json.dumps(response.json(), indent=2))
```

#### Using the streaming endpoint

```python
import json
import requests

with open('test_case1.json', 'r') as f:
    data = json.load(f)

response = requests.post(
    'http://localhost:8000/recommend-tests/stream',
    json=data['api_input'],
    stream=True
)

for line in response.iter_lines():
    if line:
        line_text = line.decode('utf-8')
        if line_text.startswith('data: '):
            event_data = line_text[6:]  # Remove 'data: ' prefix
            if event_data != '[DONE]':
                print(json.loads(event_data))
```

### Command-line Options

- `case_file` (positional): Path to a single case file to process
- `--all`: Process all case files in `data/inputs/`
- `--output`, `-o`: Output file path (if not specified, prints to stdout)
- `--pretty`: Pretty-print JSON output (default: True)

### How It Works

1. **Parse medical report**: Loads the JSON lab report
2. **Extract patient info**: Gets age, gender, and patient name
3. **Identify abnormalities**: Compares test values against reference ranges
4. **Check impression flags**: Looks for tests marked with clinical impressions
5. **Infer symptoms**: Maps abnormal tests to common clinical symptoms
6. **Format output**: Creates API-compatible JSON structure

### Abnormal Test Detection Logic

A test is considered abnormal if:

- The value falls outside the `MinValue`-`MaxValue` range
- The `impression` field is marked as `'Y'`

Special handling for:

- Non-numeric values (e.g., "Negative", "Adequate") are skipped
- Comparison operators (e.g., "<2.00", ">100") are parsed
- Zero ranges (0.000-0.000) are ignored as invalid

### Symptom Mapping

The script includes a basic symptom mapping for common abnormalities:

| Abnormal Test    | Inferred Symptoms                      |
| ---------------- | -------------------------------------- |
| HDL Cholesterol  | chest discomfort, shortness of breath  |
| Leucopenia       | fatigue, frequent infections, weakness |
| Neutrophil Count | fever, frequent infections             |
| Hemoglobin       | fatigue, weakness, pale skin           |
| Glucose          | increased thirst, frequent urination   |
| Creatinine       | decreased urine output, swelling       |
| Thyroid tests    | weight changes, fatigue, mood changes  |

> **Note**: In real-world scenarios, symptoms would come from actual patient complaints. This mapping is for testing purposes only.

### Requirements

- Python 3.7+
- No external dependencies (uses only standard library)

### Extending the Script

You can customize the script by:

1. **Adding more symptom mappings**: Edit the `symptom_mapping` dictionary in `extract_symptoms_from_tests()`
2. **Adjusting abnormality detection**: Modify the `is_abnormal()` function
3. **Changing output format**: Edit the `generate_api_input()` function

### Troubleshooting

**Issue**: "File not found" error

- **Solution**: Ensure the path to the case file is correct and the file exists

**Issue**: JSON parsing error

- **Solution**: Verify that the case file is valid JSON format

**Issue**: No abnormal tests detected

- **Solution**: Check that the case file has test results with valid reference ranges
