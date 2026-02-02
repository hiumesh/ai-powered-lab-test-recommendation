import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch
from src.app import app


client = TestClient(app)

MOCK_PATIENT_DATA = {
    "age": 30,
    "gender": "male",
    "abnormal_tests": ["Elevated WBC: 15000/μL", "High CRP: 50 mg/L"],
    "symptoms": "fever and cough",
}

MOCK_RECOMMENDATION_OUTPUT = {
    "recommendations": [
        {
            "test_name": "CBC",
            "reasoning": "Check for infection",
            "confidence": 0.9,
            "priority": "high",
            "clinical_indication": "Elevated WBC suggests possible infection",
        },
        {
            "test_name": "Blood Culture",
            "reasoning": "Identify causative organism",
            "confidence": 0.85,
            "priority": "high",
            "clinical_indication": "Fever and elevated inflammatory markers",
        },
        {
            "test_name": "Chest X-ray",
            "reasoning": "Rule out pneumonia",
            "confidence": 0.8,
            "priority": "medium",
            "clinical_indication": "Cough with systemic symptoms",
        },
    ],
    "overall_reasoning": "Patient presents with fever and cough along with elevated WBC and CRP, suggesting an infectious process that requires further investigation.",
}


@pytest.fixture(scope="function", autouse=True)
def reset_slowapi_limiter():
    from src.app import limiter

    if hasattr(limiter, "_storage"):
        limiter._storage.storage.clear()  # type: ignore
    elif hasattr(limiter, "limiter") and hasattr(limiter.limiter, "_storage"):
        limiter.limiter._storage.clear()  # type: ignore

    yield

    if hasattr(limiter, "_storage"):
        limiter._storage.storage.clear()  # type: ignore
    elif hasattr(limiter, "limiter") and hasattr(limiter.limiter, "_storage"):
        limiter.limiter._storage.clear()  # type: ignore


@pytest.fixture
def mock_app_dependencies():

    with patch("src.app.app_graph") as mock_graph, patch(
        "src.app.recommendation_cache"
    ) as mock_cache:

        mock_graph.ainvoke = MagicMock()
        mock_graph.stream = MagicMock()

        mock_cache.get.return_value = None

        yield mock_graph, mock_cache


@pytest.fixture
def initialized_app():

    import src.app as app_module
    from src.graph import LabTestRecommendationGraphBuilder
    from src.utils.chroma_vector_db import ChromaVectorDB
    from src.utils.cache_manager import RecommendationCache
    from src.config import config

    vector_db = ChromaVectorDB(config)
    vector_store = vector_db.build()

    builder = LabTestRecommendationGraphBuilder(
        vector_store=vector_store, config=config
    )
    app_module.app_graph = builder.build()

    app_module.recommendation_cache = RecommendationCache(config)

    yield

    app_module.app_graph = None
    app_module.recommendation_cache = None


def test_health_check():

    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_request_id_in_response():
   
    response = client.get("/health")
    assert response.status_code == 200
    assert "X-Request-ID" in response.headers
    request_id = response.headers["X-Request-ID"]
   
    import uuid
    try:
        uuid.UUID(request_id)
    except ValueError:
        pytest.fail(f"X-Request-ID is not a valid UUID: {request_id}")


@pytest.mark.asyncio
async def test_recommend_tests_success(initialized_app):

    response = client.post("/recommend-tests", json=MOCK_PATIENT_DATA)

    assert response.status_code == 200
    data = response.json()

    assert "recommendations" in data
    assert isinstance(data["recommendations"], list)
    assert len(data["recommendations"]) >= 3
    assert len(data["recommendations"]) <= 10

    assert "overall_reasoning" in data
    assert isinstance(data["overall_reasoning"], str)
    assert len(data["overall_reasoning"]) > 0

    for rec in data["recommendations"]:
        required_fields = [
            "test_name",
            "reasoning",
            "confidence",
            "priority",
            "clinical_indication",
        ]
        for field in required_fields:
            assert field in rec, f"Missing field: {field}"

        assert isinstance(rec["test_name"], str)
        assert len(rec["test_name"]) > 0

        assert isinstance(rec["reasoning"], str)
        assert len(rec["reasoning"]) > 0

        assert isinstance(rec["confidence"], (int, float))
        assert 0.0 <= rec["confidence"] <= 1.0

        assert isinstance(rec["priority"], str)
        assert rec["priority"] in ["high", "medium", "low"]

        assert isinstance(rec["clinical_indication"], str)
        assert len(rec["clinical_indication"]) > 0


@pytest.mark.asyncio
async def test_recommend_tests_cache_hit(initialized_app):
    response1 = client.post("/recommend-tests", json=MOCK_PATIENT_DATA)
    assert response1.status_code == 200
    first_data = response1.json()

    assert "recommendations" in first_data
    assert isinstance(first_data["recommendations"], list)
    assert len(first_data["recommendations"]) >= 3

    response2 = client.post("/recommend-tests", json=MOCK_PATIENT_DATA)
    assert response2.status_code == 200
    second_data = response2.json()

    assert second_data["recommendations"] == first_data["recommendations"]
    assert second_data["overall_reasoning"] == first_data["overall_reasoning"]

    for rec in second_data["recommendations"]:
        required_fields = [
            "test_name",
            "reasoning",
            "confidence",
            "priority",
            "clinical_indication",
        ]
        for field in required_fields:
            assert field in rec, f"Missing field: {field}"

        assert isinstance(rec["confidence"], (int, float))
        assert 0.0 <= rec["confidence"] <= 1.0
        assert rec["priority"] in ["high", "medium", "low"]


@pytest.mark.asyncio
async def test_recommend_tests_stream(initialized_app):

    with client.stream(
        "POST", "/recommend-tests/stream", json=MOCK_PATIENT_DATA
    ) as response:
        assert response.status_code == 200

        count = 0
        import json

        final_recommendations = None
        final_reasoning = None

        for line in response.iter_lines():
            line = line.strip()
            if not line:
                continue

            if line.startswith("data: "):
                data_str = line[6:]
                if data_str == "[DONE]":
                    break

                try:
                    payload = json.loads(data_str)
                    assert "step" in payload, f"Missing 'step' in payload: {payload}"
                    assert "data" in payload, f"Missing 'data' in payload: {payload}"

                    # Track final recommendations and reasoning
                    if "recommendations" in payload["data"]:
                        final_recommendations = payload["data"]["recommendations"]
                    if "reasoning" in payload["data"]:
                        final_reasoning = payload["data"]["reasoning"]

                    count += 1
                except json.JSONDecodeError:
                    pytest.fail(f"Failed to decode JSON from stream: {data_str}")

        assert count > 0, "Should have received at least one data event"

        assert final_recommendations is not None, "Should have received recommendations"
        assert isinstance(final_recommendations, list)
        assert len(final_recommendations) >= 3, "Should have at least 3 recommendations"

        for rec in final_recommendations:
            required_fields = [
                "test_name",
                "reasoning",
                "confidence",
                "priority",
                "clinical_indication",
            ]
            for field in required_fields:
                assert field in rec, f"Missing field: {field}"

            assert isinstance(rec["confidence"], (int, float))
            assert 0.0 <= rec["confidence"] <= 1.0
            assert rec["priority"] in ["high", "medium", "low"]

        assert final_reasoning is not None, "Should have received reasoning"
        assert isinstance(final_reasoning, str)
        assert len(final_reasoning) > 0


@pytest.mark.asyncio
async def test_rate_limiting(mock_app_dependencies):

    mock_graph, _ = mock_app_dependencies

    graph_output = {
        "recommendations": MOCK_RECOMMENDATION_OUTPUT["recommendations"],
        "reasoning": MOCK_RECOMMENDATION_OUTPUT["overall_reasoning"],
    }
    from unittest.mock import AsyncMock

    mock_graph.ainvoke = AsyncMock(return_value=graph_output)

    limit_hit = False

    for _ in range(20):
        response = client.post("/recommend-tests", json=MOCK_PATIENT_DATA)
        if response.status_code == 429:
            limit_hit = True
            assert "Rate limit exceeded" in response.json()["detail"]
            break
        assert response.status_code == 200

    assert limit_hit, "Rate limit was not reached within 20 requests"


def test_invalid_input_validation():

    invalid_data_1 = {"age": 30, "gender": "male", "symptoms": "fever and cough"}
    response = client.post("/recommend-tests", json=invalid_data_1)
    assert response.status_code == 422
    invalid_data_2 = {
        "age": -5,
        "gender": "male",
        "abnormal_tests": ["Elevated WBC: 15000/μL"],
        "symptoms": "fever",
    }
    response = client.post("/recommend-tests", json=invalid_data_2)
    assert response.status_code == 422

    invalid_data_3 = {
        "age": 150,
        "gender": "male",
        "abnormal_tests": ["Elevated WBC: 15000/μL"],
        "symptoms": "fever",
    }
    response = client.post("/recommend-tests", json=invalid_data_3)
    assert response.status_code == 422

    invalid_data_4 = {
        "age": 30,
        "gender": "unknown",
        "abnormal_tests": ["Elevated WBC: 15000/μL"],
        "symptoms": "fever",
    }
    response = client.post("/recommend-tests", json=invalid_data_4)
    assert response.status_code == 422

    invalid_data_5 = {
        "age": 30,
        "gender": "male",
        "abnormal_tests": [],
        "symptoms": "fever",
    }
    response = client.post("/recommend-tests", json=invalid_data_5)
    assert response.status_code == 422

    invalid_data_6 = {
        "age": "thirty",
        "gender": "male",
        "abnormal_tests": ["Elevated WBC: 15000/μL"],
        "symptoms": "fever",
    }
    response = client.post("/recommend-tests", json=invalid_data_6)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_valid_edge_cases(initialized_app):
    valid_edge_case_1 = {
        "age": 0,
        "gender": "female",
        "abnormal_tests": ["Elevated WBC: 15000/μL"],
        "symptoms": "fever",
    }
    response = client.post("/recommend-tests", json=valid_edge_case_1)
    assert response.status_code == 200
    data = response.json()
    assert "recommendations" in data
    assert len(data["recommendations"]) >= 3

    valid_edge_case_2 = {
        "age": 120,
        "gender": "male",
        "abnormal_tests": ["Elevated WBC: 15000/μL"],
        "symptoms": "fever",
    }
    response = client.post("/recommend-tests", json=valid_edge_case_2)
    assert response.status_code == 200
    data = response.json()
    assert "recommendations" in data
    assert len(data["recommendations"]) >= 3

    valid_normalized_gender = {
        "age": 30,
        "gender": "Female",
        "abnormal_tests": ["Elevated WBC: 15000/μL"],
        "symptoms": "fever",
    }
    response = client.post("/recommend-tests", json=valid_normalized_gender)
    assert response.status_code == 200
    data = response.json()
    assert "recommendations" in data
    assert len(data["recommendations"]) >= 3

    valid_no_symptoms = {
        "age": 30,
        "gender": "male",
        "abnormal_tests": ["Elevated WBC: 15000/μL", "High CRP: 50 mg/L"],
    }
    response = client.post("/recommend-tests", json=valid_no_symptoms)
    assert response.status_code == 200
    data = response.json()
    assert "recommendations" in data
    assert len(data["recommendations"]) >= 3
