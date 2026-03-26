# Quick Start: Testing with Real-World Case Data

This guide shows you how to use the medical case files to test your AI Lab Test Recommendation API.

## Step 1: Generate Test Input

Generate API-compatible JSON from your case files:

```bash
# Single case
python scripts/generate_test_input.py data/inputs/case1.txt --output test_case1.json

# All cases
python scripts/generate_test_input.py --all --output test_all_cases.json
```

## Step 2: Review Generated Input

Check what was generated:

```bash
cat test_case1.json
```

Example output:

```json
{
  "source_file": "case1.txt",
  "patient_name": "HAMDAN SAIF AL RUBAIE",
  "api_input": {
    "age": 69,
    "gender": "male",
    "abnormal_tests": [
      "Abnormalities of WBCs: Leucopenia noted.",
      "HDL Cholesterol: 35.00 mg/dL (normal: 40.000-60.000)",
      "Fasting Blood Sugar: 120.00 mg/dL (normal: 70.000-110.000)"
    ],
    "symptoms": "chest discomfort, fatigue, weakness"
  }
}
```

## Step 3: Test the API

### Option A: Quick Test (Automated Script)

```bash
# Make sure your API is running first
# Then run the test script
python scripts/test_api_with_cases.py test_case1.json
```

### Option B: Manual Testing with curl

```bash
# Extract just the api_input
cat test_case1.json | jq '.api_input' > api_request.json

# Test non-streaming endpoint
curl -X POST http://localhost:8000/recommend-tests \
  -H "Content-Type: application/json" \
  -d @api_request.json | jq

# Test streaming endpoint
curl -X POST http://localhost:8000/recommend-tests/stream \
  -H "Content-Type: application/json" \
  -d @api_request.json
```

### Option C: Python Script

```python
import json
import requests

# Load test data
with open('test_case1.json') as f:
    data = json.load(f)

# Call API
response = requests.post(
    'http://localhost:8000/recommend-tests',
    json=data['api_input']
)

# Print results
result = response.json()
print(f"Recommendations: {len(result['recommendations'])}")
for rec in result['recommendations']:
    print(f"- {rec['test_name']} ({rec['priority']} priority)")
```

## Step 4: Test All Cases

Process all your case files at once:

```bash
# Generate all test inputs
python scripts/generate_test_input.py --all --output test_all_cases.json

# The output will have a test_cases array
cat test_all_cases.json | jq '.total_cases'  # See how many cases

# Test each case (manual loop)
cat test_all_cases.json | jq -c '.test_cases[]' | while read case; do
  echo "$case" | jq '.api_input' > temp_case.json
  echo "Testing case: $(echo "$case" | jq -r '.patient_name')"
  curl -X POST http://localhost:8000/recommend-tests \
    -H "Content-Type: application/json" \
    -d @temp_case.json
  sleep 2  # Rate limiting
done
```

## Understanding the Output

The API returns recommendations in this format:

```json
{
  "recommendations": [
    {
      "test_name": "Lipid Panel with Advanced Markers",
      "reasoning": "Patient has low HDL cholesterol...",
      "confidence": 0.92,
      "priority": "high",
      "clinical_indication": "Cardiovascular risk assessment"
    }
  ],
  "overall_reasoning": "Based on the abnormal findings..."
}
```

### Key Fields:

- **test_name**: Recommended laboratory test
- **reasoning**: Medical rationale for the recommendation
- **confidence**: AI confidence score (0.0 - 1.0)
- **priority**: Urgency level (high/medium/low)
- **clinical_indication**: Why this test is relevant to the patient

## Advanced: Batch Testing

Create a batch testing script:

```python
import json
import requests
import time
from pathlib import Path

# Load all test cases
with open('test_all_cases.json') as f:
    data = json.load(f)

results = []

for i, test_case in enumerate(data['test_cases'], 1):
    print(f"Testing {i}/{data['total_cases']}: {test_case['patient_name']}")

    try:
        response = requests.post(
            'http://localhost:8000/recommend-tests',
            json=test_case['api_input'],
            timeout=30
        )

        result = {
            'patient': test_case['patient_name'],
            'source': test_case['source_file'],
            'success': response.status_code == 200,
            'num_recommendations': len(response.json().get('recommendations', []))
        }
        results.append(result)

    except Exception as e:
        results.append({
            'patient': test_case['patient_name'],
            'success': False,
            'error': str(e)
        })

    time.sleep(1)  # Rate limiting

# Save results
with open('batch_test_results.json', 'w') as f:
    json.dump(results, f, indent=2)

print(f"\nCompleted: {sum(r['success'] for r in results)}/{len(results)} successful")
```

## Tips

1. **Start your API first**: Make sure the FastAPI server is running before testing
2. **Check health**: Visit `http://localhost:8000/health` to verify the API is initialized
3. **Rate limiting**: The API has rate limiting, add delays between requests
4. **Caching**: Second request with same input will be cached (faster response)
5. **Streaming**: Use the `/stream` endpoint to see real-time progress

## Troubleshooting

**"Connection refused"**

- Make sure your API is running: `cd backend && uvicorn main:app --reload`

**"AI Service not initialized"**

- Wait a few seconds after starting the API for it to initialize
- Check the API logs for any errors during startup

**"Rate limit exceeded"**

- You're making too many requests too quickly
- Add delays between requests (e.g., `time.sleep(2)`)

**Validation errors**

- Check that the generated JSON has all required fields
- Verify `age` is an integer and `gender` is "male" or "female"
- Ensure `abnormal_tests` is a non-empty array
