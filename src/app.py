import json
import logging
import uuid
from typing import AsyncGenerator
from contextlib import asynccontextmanager
from dotenv import load_dotenv

load_dotenv()


from .config import config
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from langchain_core.runnables import RunnableConfig

from .graph import (
    LabTestRecommendationGraphBuilder,
    PatientInput,
    RecommendationOutput,
    GraphState,
)

from .utils.chroma_vector_db import ChromaVectorDB
from .utils.cache_manager import RecommendationCache


logger = logging.getLogger(__name__)

vector_store = None
app_graph = None
recommendation_cache = None

limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(_: FastAPI):

    global vector_store, app_graph, recommendation_cache
    logger.info("Initializing AI components...")

    try:

        vector_db = ChromaVectorDB(config)
        vector_store = vector_db.build()
        logger.info("Vector store initialized with medical data.")

        builder = LabTestRecommendationGraphBuilder(
            vector_store=vector_store, config=config
        )
        app_graph = builder.build()
        logger.info("LangGraph workflow built successfully.")

        recommendation_cache = RecommendationCache(config)
        logger.info("Recommendation cache initialized.")

    except Exception as e:
        logger.error(f"Error during initialization: {e}")
        raise

    yield

    logger.info("Shutting down...")


app = FastAPI(title="AI Lab Test Recommender", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


app.state.limiter = limiter


async def rate_limit_exceeded_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=429,
        content={"detail": "Rate limit exceeded"},
    )


app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)


@app.post("/recommend-tests", response_model=RecommendationOutput)
@limiter.limit(config.get("app.rate_limit", "10/minute"))
async def recommend_tests(request: Request, patient_data: PatientInput):
    
    request_id = getattr(request.state, "request_id", str(uuid.uuid4()))

    if not app_graph:
        raise HTTPException(status_code=503, detail="AI Service not initialized")

    if recommendation_cache:
        cached_result = recommendation_cache.get(patient_data)
        if cached_result:
            logger.info("Cache hit for patient data", extra={"request_id": request_id})
            return cached_result

    try:
        state_input = patient_data.model_dump()
        state_input["request_id"] = request_id

        graph_config = RunnableConfig(configurable={"thread_id": request_id})

        result = await app_graph.ainvoke(GraphState(**state_input), config=graph_config)

        if result.get("error"):
            raise HTTPException(status_code=500, detail=result["error"])

        result = RecommendationOutput(
            recommendations=result.get("recommendations", []),
            overall_reasoning=result.get("reasoning", ""),
        )

        if recommendation_cache:
            recommendation_cache.set(patient_data, result)

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing request: {e}", extra={"request_id": request_id})
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/recommend-tests/stream")
@limiter.limit(config.get("app.rate_limit", "10/minute"))
async def recommend_tests_stream(request: Request, patient_data: PatientInput):
    request_id = getattr(request.state, "request_id", str(uuid.uuid4()))

    async def event_generator() -> AsyncGenerator[str, None]:

        if not app_graph:
            error_payload = {"error": "AI Service not initialized"}
            yield f"data: {json.dumps(error_payload)}\n\n"
            return

        if recommendation_cache:
            cached_result = recommendation_cache.get(patient_data)
            if cached_result:
                logger.info("Cache hit for streaming request", extra={"request_id": request_id})
                data = (
                    cached_result.dict()
                    if hasattr(cached_result, "dict")
                    else cached_result
                )
                payload = {"step": "cached_result", "data": data}
                yield f"data: {json.dumps(payload)}\n\n"
                yield "data: [DONE]\n\n"
                return

        accumulated_data = {"recommendations": [], "reasoning": ""}

        try:
            state_input = patient_data.model_dump()
            state_input["request_id"] = request_id

            graph_config = RunnableConfig(configurable={"thread_id": request_id})

           
            async for event in app_graph.astream_events(
                GraphState(**state_input), config=graph_config, version="v2"
            ):
                event_type = event.get("event")
                node_name = event.get("name")
                
                target_nodes = {
                    "validate_input",
                    "retrieve_context",
                    "generate_recommendations",
                    "format_output"
                }

                if node_name in target_nodes:
                    
                    if event_type == "on_chain_start":
                        payload = {"step": node_name, "data": {}}
                        yield f"data: {json.dumps(payload)}\n\n"

                    elif event_type == "on_chain_end":
                        output = event.get("data", {}).get("output")
                        if output and isinstance(output, dict):
                             
                             payload = {"step": node_name, "data": {}}
            
                             
                             if "reasoning" in output:
                                 payload["data"]["reasoning"] = output["reasoning"]
                                 accumulated_data["reasoning"] = output["reasoning"]
                             if "recommendations" in output:
                                 payload["data"]["recommendations"] = output["recommendations"]
                                 accumulated_data["recommendations"] = output["recommendations"]
                             if "error" in output and output["error"]:
                                 payload["data"]["error"] = output["error"]
                             
                             if payload["data"]:
                                 yield f"data: {json.dumps(payload)}\n\n"

            if recommendation_cache and (
                accumulated_data["recommendations"] or accumulated_data["reasoning"]
            ):

                output = RecommendationOutput(
                    recommendations=accumulated_data["recommendations"],
                    overall_reasoning=accumulated_data["reasoning"],
                )
                recommendation_cache.set(patient_data, output)

            yield "data: [DONE]\n\n"

        except Exception as e:
            logger.error(f"Error in streaming: {e}", extra={"request_id": request_id})
            error_payload = {"error": str(e)}
            yield f"data: {json.dumps(error_payload)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/health")
def health_check():
    return {"status": "ok", "initialized": app_graph is not None}
