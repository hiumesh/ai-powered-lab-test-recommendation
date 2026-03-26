#!/usr/bin/env python3
"""
Script to generate test input JSON from medical case files.

This script parses lab report JSON files from data/inputs/ and generates
the appropriate JSON body format to test the AI Lab Test Recommender API.

Usage:
    python scripts/generate_test_input.py data/inputs/case1.txt
    python scripts/generate_test_input.py data/inputs/case1.txt --output test_input.json
    python scripts/generate_test_input.py --all
"""

import json
import argparse
import sys
from pathlib import Path
from typing import Dict, List, Any


def parse_medical_report(file_path: Path) -> Dict[str, Any]:
    """Parse a medical report JSON file."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data
    except json.JSONDecodeError as e:
        print(f"Error parsing JSON from {file_path}: {e}")
        sys.exit(1)
    except FileNotFoundError:
        print(f"File not found: {file_path}")
        sys.exit(1)


def is_abnormal(observation: Dict[str, Any]) -> bool:
    """Determine if a test observation is abnormal based on reference ranges."""
    try:
        value = observation.get('value', '').strip()
        min_value = observation.get('MinValue', '')
        max_value = observation.get('MaxValue', '')
        
        # Skip non-numeric values or empty ranges
        if not value or not min_value or not max_value:
            return False
        
        # Handle special values like "<2.00", ">100", "Negative", "Adequate", etc.
        if not value[0].isdigit() and value[0] not in ['-', '+']:
            return False
        
        # Remove non-numeric characters for comparison
        value_clean = value.replace('<', '').replace('>', '').strip()
        
        try:
            val = float(value_clean)
            min_val = float(min_value)
            max_val = float(max_value)
            
            # Check if value is outside the normal range
            if min_val == 0 and max_val == 0:
                return False  # No valid range
            
            return val < min_val or val > max_val
        except ValueError:
            return False
    except Exception:
        return False


def extract_abnormal_tests(data: Dict[str, Any]) -> List[str]:
    """Extract abnormal test names from the medical report."""
    abnormal_tests = []
    
    for package in data.get('results', []):
        for investigation in package.get('investigation', []):
            for observation in investigation.get('observations', []):
                if is_abnormal(observation):
                    test_name = observation.get('name', '')
                    test_value = observation.get('value', '')
                    unit = observation.get('unit', '')
                    min_val = observation.get('MinValue', '')
                    max_val = observation.get('MaxValue', '')
                    
                    # Create a descriptive abnormal test entry
                    if test_name:
                        abnormal_entry = f"{test_name}: {test_value} {unit}"
                        if min_val and max_val:
                            abnormal_entry += f" (normal: {min_val}-{max_val})"
                        abnormal_tests.append(abnormal_entry)
                
                # Also check for tests with impression marked as 'Y'
                if observation.get('impression') == 'Y':
                    test_name = observation.get('name', '')
                    test_value = observation.get('value', '')
                    if test_name and test_name not in [t.split(':')[0] for t in abnormal_tests]:
                        abnormal_tests.append(f"{test_name}: {test_value}")
    
    return abnormal_tests


def extract_symptoms_from_tests(abnormal_tests: List[str]) -> List[str]:
    """
    Generate potential symptoms based on abnormal tests.
    In a real scenario, this would come from patient complaints.
    """
    # Map common abnormal tests to typical symptoms
    symptom_mapping = {
        'HDL Cholesterol': ['chest discomfort', 'shortness of breath'],
        'Leucopenia': ['fatigue', 'frequent infections', 'weakness'],
        'Absolute Neutrophil Count': ['fever', 'frequent infections'],
        'Hemoglobin': ['fatigue', 'weakness', 'pale skin'],
        'Glucose': ['increased thirst', 'frequent urination', 'fatigue'],
        'Creatinine': ['decreased urine output', 'swelling in legs'],
        'Thyroid': ['weight changes', 'fatigue', 'mood changes'],
    }
    
    symptoms = set()
    for test in abnormal_tests:
        for key, symptom_list in symptom_mapping.items():
            if key.lower() in test.lower():
                symptoms.update(symptom_list)
    
    # If no specific symptoms found, return generic ones
    if not symptoms:
        symptoms = {'routine checkup follow-up'}
    
    return list(symptoms)


def generate_api_input(file_path: Path) -> Dict[str, Any]:
    """Generate API input JSON from a medical case file."""
    data = parse_medical_report(file_path)
    
    # Extract patient information
    age = data.get('Age', '').strip()
    gender = data.get('Gender', '').strip()
    patient_name = data.get('PName', '')
    
    # Convert gender to full form
    gender_map = {'M': 'male', 'F': 'female'}
    gender = gender_map.get(gender, gender.lower())
    
    # Extract abnormal tests
    abnormal_tests = extract_abnormal_tests(data)
    
    # Generate symptoms (in real world, this comes from patient)
    symptoms = extract_symptoms_from_tests(abnormal_tests)
    
    # If no abnormal tests found, use a sample for demonstration
    if not abnormal_tests:
        abnormal_tests = ["No significant abnormalities detected"]
        symptoms = ["routine health checkup"]
    
    # Create the API input format
    api_input = {
        "age": int(age) if age.isdigit() else 0,
        "gender": gender,
        "abnormal_tests": abnormal_tests,
        "symptoms": ", ".join(symptoms)  # Join symptoms into a comma-separated string
    }
    
    return {
        "source_file": str(file_path.name),
        "patient_name": patient_name,
        "api_input": api_input
    }


def main():
    parser = argparse.ArgumentParser(
        description="Generate API test input from medical case files"
    )
    parser.add_argument(
        'case_file',
        nargs='?',
        type=Path,
        help='Path to the case file (e.g., data/inputs/case1.txt)'
    )
    parser.add_argument(
        '--output', '-o',
        type=Path,
        help='Output JSON file path (default: print to stdout)'
    )
    parser.add_argument(
        '--all',
        action='store_true',
        help='Process all case files in data/inputs/'
    )
    parser.add_argument(
        '--pretty',
        action='store_true',
        default=True,
        help='Pretty print JSON output (default: True)'
    )
    
    args = parser.parse_args()
    
    # Determine which files to process
    if args.all:
        input_dir = Path(__file__).parent.parent / 'data' / 'inputs'
        case_files = sorted(input_dir.glob('case*.txt'))
        if not case_files:
            print(f"No case files found in {input_dir}")
            sys.exit(1)
        
        results = []
        for case_file in case_files:
            print(f"Processing {case_file.name}...", file=sys.stderr)
            result = generate_api_input(case_file)
            results.append(result)
        
        output_data = {
            "test_cases": results,
            "total_cases": len(results)
        }
    elif args.case_file:
        if not args.case_file.exists():
            print(f"File not found: {args.case_file}")
            sys.exit(1)
        output_data = generate_api_input(args.case_file)
    else:
        parser.print_help()
        sys.exit(1)
    
    # Format output
    json_output = json.dumps(
        output_data,
        indent=2 if args.pretty else None,
        ensure_ascii=False
    )
    
    # Write or print output
    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(json_output)
        print(f"Output written to {args.output}", file=sys.stderr)
    else:
        print(json_output)


if __name__ == '__main__':
    main()
