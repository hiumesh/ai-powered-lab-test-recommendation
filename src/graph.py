import operator
import os
import logging
from typing import TypedDict, Annotated, List, Dict, Optional, Any
from langchain_chroma import Chroma
from pydantic import BaseModel, Field, field_validator, ValidationError
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate


logger = logging.getLogger(__name__)


class PatientInput(BaseModel):

    age: int = Field(..., ge=0, le=120, description="Patient age in years (0-120)")
    gender: str = Field(..., description="Patient gender (M/F or Male/Female)")
    abnormal_tests: List[str] = Field(
        ..., min_length=1, description="List of abnormal test results with values"
    )
    symptoms: Optional[str] = Field(
        default="", description="Patient-reported symptoms (optional)"
    )

    @field_validator("gender")
    @classmethod
    def normalize_gender(cls, v: str) -> str:
        gender_upper = v.upper()
        if gender_upper in ["M", "MALE"]:
            return "M"
        elif gender_upper in ["F", "FEMALE"]:
            return "F"
        else:
            raise ValueError(f"Invalid gender: {v}. Must be M/F or Male/Female")

    @field_validator("abnormal_tests")
    @classmethod
    def validate_tests_not_empty(cls, v: List[str]) -> List[str]:
        if not v or len(v) == 0:
            raise ValueError("At least one abnormal test is required")
        return v


class TestRecommendation(BaseModel):
    test_name: str = Field(..., description="Name of the recommended laboratory test")
    reasoning: str = Field(
        ..., description="Medical reasoning for why this test is recommended"
    )
    confidence: float = Field(
        ..., ge=0.0, le=1.0, description="Confidence score between 0.0 and 1.0"
    )
    priority: str = Field(
        ...,
        pattern="^(high|medium|low)$",
        description="Priority level: high, medium, or low",
    )
    clinical_indication: str = Field(
        ..., description="Specific clinical indication based on patient data"
    )


class RecommendationOutput(BaseModel):

    recommendations: List[TestRecommendation] = Field(
        ..., min_length=1, max_length=10, description="List of 1-10 recommended tests"
    )
    overall_reasoning: str = Field(
        ..., description="Overall diagnostic reasoning and approach"
    )

    @field_validator("recommendations")
    @classmethod
    def validate_recommendation_count(
        cls, v: List[TestRecommendation]
    ) -> List[TestRecommendation]:
        if len(v) < 3:
            raise ValueError(f"Expected at least 3 recommendations, got {len(v)}")
        if len(v) > 5:
            pass
        return v


class GraphState(TypedDict):

    age: int
    gender: str
    abnormal_tests: List[str]
    symptoms: Optional[str]

    retrieved_context: Annotated[List[Dict], operator.add]

    recommendations: List[Dict]
    confidence_scores: Dict[str, float]
    reasoning: str

    error: Optional[str]
    should_retry: bool
    retry_count: int

    request_id: Optional[str]


class LabTestRecommendationGraphBuilder:

    def __init__(
        self,
        vector_store: Chroma,
        config: Any,
    ):

        self.vector_store = vector_store
        self.config = config
        self.k_retrieval = config.get("graph.k_retrieval", 5)

        llm_provider = config.get("graph.llm.provider", "openai")
        llm_model = config.get("graph.llm.model", "gpt-4o")
        self.max_retries = config.get("graph.llm.max_retries", 3)

        if llm_provider == "gemini":
            logger.info("Using Gemini LLM")
            self.llm = ChatGoogleGenerativeAI(
                model=llm_model, temperature=0, convert_system_message_to_human=True
            )
        else:
            logger.info("Using OpenAI LLM")
            self.llm = ChatOpenAI(model=llm_model, temperature=0)

    def _validate_input(self, state: GraphState) -> GraphState:
        request_id = state.get("request_id", "")
        logger.info("Validating input...", extra={"request_id": request_id})

        try:

            patient_input = PatientInput(
                age=state["age"],
                gender=state["gender"],
                abnormal_tests=state["abnormal_tests"],
                symptoms=state.get("symptoms", ""),
            )

            state["age"] = patient_input.age
            state["gender"] = patient_input.gender
            state["abnormal_tests"] = patient_input.abnormal_tests
            state["symptoms"] = patient_input.symptoms

            if "retrieved_context" not in state:
                state["retrieved_context"] = []
            if "symptoms" not in state:
                state["symptoms"] = ""

            state["error"] = None
            state["should_retry"] = False
            state["retry_count"] = 0

            logger.info("Input validation successful", extra={"request_id": request_id})
            return state

        except ValidationError as e:

            error_messages = []
            for error in e.errors():
                field = " -> ".join(str(loc) for loc in error["loc"])
                msg = error["msg"]
                error_messages.append(f"{field}: {msg}")

            state["error"] = f"Validation error: {'; '.join(error_messages)}"
            logger.error(
                f"Validation failed: {state['error']}", extra={"request_id": request_id}
            )
            return state

        except Exception as e:
            state["error"] = f"Validation error: {str(e)}"
            logger.error(
                f"Validation error: {str(e)}", extra={"request_id": request_id}
            )
            return state

    def _retrieve_context_node(self, state: GraphState) -> GraphState:
        request_id = state.get("request_id", "")
        logger.info(
            "Retrieving context from vector database...",
            extra={"request_id": request_id},
        )

        try:
            abnormal_tests_text = " ".join(state["abnormal_tests"])
            symptoms_text = state.get("symptoms", "")

            search_query = f"""
              Patient Context:
              Abnormal Tests: {abnormal_tests_text}
              Symptoms: {symptoms_text}
              
              Find relevant follow-up laboratory tests and diagnostic procedures.
            """

            # Use similarity_search from LangChain Chroma integration
            docs = self.vector_store.similarity_search(
                query=search_query, k=self.k_retrieval
            )

            context_list = []
            if docs:
                for doc in docs:
                    context_item = {
                        "content": doc.page_content,
                        "metadata": doc.metadata,
                    }
                    context_list.append(context_item)

            state["retrieved_context"] = context_list

            logger.info(
                f"Retrieved {len(context_list)} relevant test documents",
                extra={"request_id": request_id},
            )
            return state
        except Exception as e:
            state["error"] = f"Context retrieval error: {str(e)}"
            logger.error(
                f"Context retrieval failed: {state['error']}",
                extra={"request_id": request_id},
            )
            return state

    def _generate_recommendations_node(self, state: GraphState):
        request_id = state.get("request_id", "")
        logger.info("Generating recommendations...", extra={"request_id": request_id})

        try:
            context_text = "\n\n".join(
                [
                    f"--- Medical Test Information ---\n{ctx['content']}"
                    for ctx in state["retrieved_context"]
                ]
            )

            prompt = ChatPromptTemplate.from_messages(
                [
                    (
                        "system",
                        """You are an expert medical AI assistant specializing in laboratory diagnostics with deep knowledge of clinical pathology, hematology, biochemistry, and evidence-based medicine.

ROLE AND EXPERTISE:
- Board-certified clinical pathologist knowledge base
- Evidence-based diagnostic reasoning
- Patient safety and harm reduction focus
- Current clinical practice guidelines awareness

CRITICAL SAFETY CONSTRAINTS:
1. NEVER diagnose - only recommend diagnostic tests
2. NEVER recommend treatment or medication
3. NEVER provide definitive conclusions about diseases
4. This is clinical decision SUPPORT only - final decisions require physician review
5. When uncertain, err on the side of recommending more tests rather than fewer

REASONING FRAMEWORK - USE CHAIN OF THOUGHT:
For each recommendation, think step-by-step:
1. What abnormality pattern do I observe?
2. What are the differential diagnoses this could indicate?
3. Which test would best differentiate between these possibilities?
4. Does this align with patient demographics (age/gender)?
5. What is the clinical utility vs. cost/invasiveness trade-off?

MEDICAL ACCURACY REQUIREMENTS:
- Base ALL recommendations on retrieved medical knowledge
- Cross-reference abnormal values with normal ranges
- Consider age-appropriate and gender-appropriate testing
- Account for test sensitivity, specificity, and positive/negative predictive value
- Prioritize tests with highest diagnostic yield
- Consider test ordering (some tests should precede others)

OUTPUT REQUIREMENTS:
- Recommend EXACTLY 3-5 tests (not more, not less)
- DO NOT recommend tests already in the abnormal_tests list
- Use standardized medical test nomenclature (e.g., "CBC with differential" not "blood test")
- Confidence scores should reflect both clinical relevance AND certainty based on available data
- Priority levels: 
  * HIGH: Urgent, could indicate serious condition requiring immediate investigation
  * MEDIUM: Important for diagnosis but not immediately life-threatening
  * LOW: Helpful for complete workup but can be deferred

EXAMPLES OF GOOD vs BAD RECOMMENDATIONS:

GOOD Example:
- Test: "Serum Iron Studies (serum iron, TIBC, ferritin)"
- Reasoning: "Patient has microcytic anemia (low MCV 72 fL) with low hemoglobin. Iron deficiency is the most common cause. This panel will differentiate iron deficiency from other causes of microcytic anemia such as thalassemia or anemia of chronic disease."
- Confidence: 0.92
- Priority: "high"
- Clinical Indication: "Microcytic anemia workup in context of low MCV and hemoglobin"

BAD Example:
- Test: "Blood test"  ❌ Too vague
- Reasoning: "To check iron"  ❌ Not specific enough
- Confidence: 0.5  ❌ Too low without justification
- Priority: "maybe"  ❌ Invalid priority level

STEP-BY-STEP APPROACH:
1. Analyze the abnormal test results and identify patterns
2. Consider the patient's demographics (age, gender)
3. Review symptoms if provided
4. Reference the medical knowledge base provided
5. Apply differential diagnosis reasoning
6. Select 3-5 most appropriate follow-up tests
7. Rank by clinical priority and diagnostic utility
8. Provide evidence-based reasoning for each test""",
                    ),
                    (
                        "user",
                        """PATIENT CASE PRESENTATION:

Demographics:
- Age: {age} years
- Gender: {gender}

Abnormal Laboratory Findings:
{abnormal_tests}

Clinical Presentation:
{symptoms}

RELEVANT MEDICAL KNOWLEDGE FROM DATABASE:
{context}

TASK:
Using the chain-of-thought reasoning framework, analyze this patient case and recommend appropriate follow-up laboratory tests.

For each recommendation, explicitly show your reasoning:
1. What pattern/abnormality does this address?
2. What differential diagnoses are you considering?
3. How will this test help narrow the diagnosis?
4. Why is this the appropriate priority level?

Think carefully about:
- Test specificity and sensitivity
- Age and gender appropriateness
- Clinical urgency
- Diagnostic yield
- Test sequencing (should some tests be done before others?)

Provide your response in the following JSON format:
{{
  "recommendations": [
    {{
      "test_name": "Specific standardized test name",
      "reasoning": "Detailed step-by-step medical reasoning showing differential diagnosis thinking",
      "confidence": 0.85,
      "priority": "high",
      "clinical_indication": "Specific clinical indication based on patient's abnormal findings"
    }}
  ],
  "overall_reasoning": "Comprehensive diagnostic approach summary: Start with observed patterns, explain differential diagnoses being considered, justify the test selection strategy, and explain the recommended order of testing if relevant"
}}

REMEMBER: 
- Recommend EXACTLY 3-5 tests
- Use evidence from the medical knowledge base
- Show your step-by-step reasoning
- Be specific with test names
- Prioritize based on clinical urgency and diagnostic value""",
                    ),
                ]
            )
            abnormal_tests_formatted = "\n".join(
                [f"  • {test}" for test in state["abnormal_tests"]]
            )

            structured_llm = self.llm.with_structured_output(RecommendationOutput)

            chain = prompt | structured_llm

            result = chain.invoke(
                {
                    "age": state["age"],
                    "gender": state["gender"],
                    "abnormal_tests": abnormal_tests_formatted,
                    "symptoms": state.get("symptoms", "None reported"),
                    "context": context_text,
                }
            )

            if type(result) != RecommendationOutput:
                raise ValueError(f"Unexpected result type: {type(result)}")

            state["recommendations"] = [
                rec.model_dump() for rec in result.recommendations
            ]
            state["reasoning"] = result.overall_reasoning

            confidence_scores = {}
            for rec in result.recommendations:
                confidence_scores[rec.test_name] = rec.confidence
            state["confidence_scores"] = confidence_scores

            logger.info(
                f"Generated {len(state['recommendations'])} recommendations",
                extra={"request_id": request_id},
            )
            logger.info(
                f"Average confidence: {sum(confidence_scores.values()) / len(confidence_scores):.2f}",
                extra={"request_id": request_id},
            )

            return state

        except ValidationError as e:

            error_messages = []
            for error in e.errors():
                field = " -> ".join(str(loc) for loc in error["loc"])
                msg = error["msg"]
                error_messages.append(f"{field}: {msg}")

            state["error"] = f"LLM output validation error: {'; '.join(error_messages)}"
            state["should_retry"] = True
            state["retry_count"] = state.get("retry_count", 0) + 1
            logger.error(
                f"LLM output validation failed (Attempt {state['retry_count']}/{self.max_retries}): {state['error']}",
                extra={"request_id": request_id},
            )
            return state

        except Exception as e:
            state["error"] = f"LLM generation error: {str(e)}"
            state["should_retry"] = True
            state["retry_count"] = state.get("retry_count", 0) + 1
            logger.error(
                f"LLM generation failed (Attempt {state['retry_count']}/{self.max_retries}): {state['error']}",
                extra={"request_id": request_id},
            )
            return state

    def _format_output_node(self, state: GraphState) -> GraphState:
        request_id = state.get("request_id", "")
        logger.info("Formatting output...", extra={"request_id": request_id})

        try:

            for rec in state["recommendations"]:

                required_fields = [
                    "test_name",
                    "reasoning",
                    "confidence",
                    "priority",
                    "clinical_indication",
                ]
                for field in required_fields:
                    if field not in rec:
                        raise ValueError(
                            f"Missing required field: {field} in recommendation"
                        )

            if not state.get("reasoning"):
                state["reasoning"] = (
                    "Recommendations generated based on patient data and medical knowledge base."
                )

            logger.info(
                "Output formatted successfully", extra={"request_id": request_id}
            )
            logger.info(
                f"Total recommendations: {len(state['recommendations'])}",
                extra={"request_id": request_id},
            )
            logger.info(
                f"Average confidence: {sum(state['confidence_scores'].values()) / len(state['confidence_scores']):.2f}",
                extra={"request_id": request_id},
            )

            return state

        except Exception as e:
            state["error"] = f"Output formatting error: {str(e)}"
            logger.error(
                f"Formatting failed: {state['error']}", extra={"request_id": request_id}
            )
            return state

    def _handle_error_node(self, state: GraphState) -> GraphState:

        request_id = state.get("request_id", "")
        logger.error(
            f"Error occurred: {state.get('error', 'Unknown error')}",
            extra={"request_id": request_id},
        )

        state["recommendations"] = []
        state["reasoning"] = f"Error: {state.get('error', 'Unknown error')}"
        state["confidence_scores"] = {}

        return state

    def _should_continue(self, state: GraphState) -> str:
        if state.get("error"):
            return "error_handler"
        return "next_step"

    def _should_retry(self, state: GraphState) -> str:
        if state.get("error"):
            if state.get("should_retry", False):
                if state.get("retry_count", 0) <= self.max_retries:
                    logger.info(
                        f"Retrying based on policy (Attempt {state.get('retry_count')} allowed)",
                        extra={"request_id": state.get("request_id", "")},
                    )
                    return "retry"

            return "error_handler"
        return "next_step"

    def _should_end(self, state: GraphState) -> str:
        return END

    def build(self):
        workflow = StateGraph(GraphState)

        workflow.add_node("validate_input", self._validate_input)
        workflow.add_node("retrieve_context", self._retrieve_context_node)
        workflow.add_node(
            "generate_recommendations", self._generate_recommendations_node
        )
        workflow.add_node("format_output", self._format_output_node)
        workflow.add_node("error_handler", self._handle_error_node)

        workflow.set_entry_point("validate_input")

        workflow.add_conditional_edges(
            "validate_input",
            self._should_continue,
            {"next_step": "retrieve_context", "error_handler": "error_handler"},
        )

        workflow.add_conditional_edges(
            "retrieve_context",
            self._should_continue,
            {"next_step": "generate_recommendations", "error_handler": "error_handler"},
        )

        workflow.add_conditional_edges(
            "generate_recommendations",
            self._should_retry,
            {
                "next_step": "format_output",
                "retry": "generate_recommendations",
                "error_handler": "error_handler",
            },
        )

        workflow.add_conditional_edges("format_output", self._should_end, {END: END})
        workflow.add_conditional_edges("error_handler", self._should_end, {END: END})

        return workflow.compile()
