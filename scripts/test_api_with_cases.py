#!/usr/bin/env python3
"""
Example script demonstrating how to test the API with generated test inputs.

This script shows how to:
1. Load generated test input
2. Send requests to the API
3. Handle both streaming and non-streaming responses
"""

import json
import sys
import requests
from pathlib import Path


def test_recommend_endpoint(api_url: str, test_input_file: Path):
    """Test the /recommend-tests endpoint (non-streaming)."""
    print(f"\n{'='*60}")
    print("Testing /recommend-tests (non-streaming)")
    print(f"{'='*60}\n")
    
    # Load test input
    with open(test_input_file, 'r') as f:
        data = json.load(f)
    
    patient_name = data.get('patient_name', 'Unknown')
    api_input = data['api_input']
    
    print(f"Patient: {patient_name}")
    print(f"Age: {api_input['age']}, Gender: {api_input['gender']}")
    print(f"Abnormal tests: {len(api_input['abnormal_tests'])}")
    print(f"Symptoms: {api_input['symptoms']}\n")
    
    # Send request
    print("Sending request to API...")
    try:
        response = requests.post(
            f"{api_url}/recommend-tests",
            json=api_input,
            timeout=30
        )
        response.raise_for_status()
        
        result = response.json()
        
        print("\n✓ Request successful!\n")
        print(f"Overall Reasoning:\n{result.get('overall_reasoning', 'N/A')}\n")
        
        print(f"Recommendations ({len(result.get('recommendations', []))}):")
        print("-" * 60)
        
        for i, rec in enumerate(result.get('recommendations', []), 1):
            print(f"\n{i}. {rec.get('test_name', 'N/A')}")
            print(f"   Priority: {rec.get('priority', 'N/A').upper()}")
            print(f"   Confidence: {rec.get('confidence', 0):.2%}")
            print(f"   Clinical Indication: {rec.get('clinical_indication', 'N/A')}")
            print(f"   Reasoning: {rec.get('reasoning', 'N/A')[:200]}...")
        
        return True
        
    except requests.exceptions.RequestException as e:
        print(f"\n✗ Request failed: {e}")
        return False


def test_stream_endpoint(api_url: str, test_input_file: Path):
    """Test the /recommend-tests/stream endpoint (streaming)."""
    print(f"\n{'='*60}")
    print("Testing /recommend-tests/stream (streaming)")
    print(f"{'='*60}\n")
    
    # Load test input
    with open(test_input_file, 'r') as f:
        data = json.load(f)
    
    patient_name = data.get('patient_name', 'Unknown')
    api_input = data['api_input']
    
    print(f"Patient: {patient_name}")
    print(f"Processing stream...\n")
    
    try:
        response = requests.post(
            f"{api_url}/recommend-tests/stream",
            json=api_input,
            stream=True,
            timeout=30
        )
        response.raise_for_status()
        
        print("Streaming events:")
        print("-" * 60)
        
        for line in response.iter_lines():
            if line:
                line_text = line.decode('utf-8')
                if line_text.startswith('data: '):
                    event_data = line_text[6:]  # Remove 'data: ' prefix
                    
                    if event_data == '[DONE]':
                        print("\n✓ Stream completed!")
                        break
                    
                    try:
                        event = json.loads(event_data)
                        
                        # Handle different event types
                        if 'step' in event:
                            step = event['step']
                            print(f"\nStep: {step}")
                            
                            if step == 'cached_result':
                                print("  (from cache)")
                            
                            event_data = event.get('data', {})
                            if 'reasoning' in event_data:
                                print(f"  Reasoning available")
                            if 'recommendations' in event_data:
                                recs = event_data['recommendations']
                                print(f"  {len(recs)} recommendations")
                            if 'error' in event_data:
                                print(f"  Error: {event_data['error']}")
                        
                        elif 'error' in event:
                            print(f"\n✗ Error: {event['error']}")
                            return False
                            
                    except json.JSONDecodeError:
                        print(f"Could not parse: {event_data}")
        
        return True
        
    except requests.exceptions.RequestException as e:
        print(f"\n✗ Stream failed: {e}")
        return False


def main():
    """Main test runner."""
    # Configuration
    API_URL = "http://localhost:8000"  # Default API URL
    
    if len(sys.argv) < 2:
        print("Usage: python test_api_with_cases.py <test_input_file.json> [api_url]")
        print("\nExample:")
        print("  python scripts/test_api_with_cases.py test_case1.json")
        print("  python scripts/test_api_with_cases.py test_case1.json http://localhost:8000")
        sys.exit(1)
    
    test_input_file = Path(sys.argv[1])
    if len(sys.argv) > 2:
        API_URL = sys.argv[2]
    
    if not test_input_file.exists():
        print(f"Error: Test input file not found: {test_input_file}")
        sys.exit(1)
    
    print(f"\nAPI URL: {API_URL}")
    print(f"Test Input: {test_input_file}")
    
    # Check API health
    try:
        health = requests.get(f"{API_URL}/health", timeout=5)
        health_data = health.json()
        if not health_data.get('initialized'):
            print("\n⚠ Warning: API reports it is not fully initialized")
    except Exception as e:
        print(f"\n⚠ Warning: Could not check API health: {e}")
    
    # Run tests
    results = []
    
    # Test non-streaming endpoint
    results.append(test_recommend_endpoint(API_URL, test_input_file))
    
    # Wait a moment between tests
    import time
    time.sleep(2)
    
    # Test streaming endpoint
    results.append(test_stream_endpoint(API_URL, test_input_file))
    
    # Summary
    print(f"\n{'='*60}")
    print("Test Summary")
    print(f"{'='*60}")
    print(f"Non-streaming: {'✓ PASS' if results[0] else '✗ FAIL'}")
    print(f"Streaming:     {'✓ PASS' if results[1] else '✗ FAIL'}")
    
    if all(results):
        print("\n✓ All tests passed!")
        sys.exit(0)
    else:
        print("\n✗ Some tests failed")
        sys.exit(1)


if __name__ == '__main__':
    main()
