import logging
from typing import List, Dict, Any, Tuple
from app.core.config import settings
from app.rag.retrieval import RetrievedChunk

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are CASPEL AI, an official enterprise assistant designed for CASPEL's exhibition presence at CIFTIS 2026 in Beijing, China.

Your objective is to assist exhibition visitors by answering questions regarding CASPEL and its key technology solutions:
1. CASPEL Corporate & Company Overview
2. Caspel ERP (Enterprise Resource Planning)
3. Caspel PMS (Procurement Management System)
4. IRISSEA (LRIT - Long-Range Identification and Tracking Solution)

STRICT GROUNDING RULES:
1. Answer questions using ONLY the approved context provided below.
2. If the answer cannot be found in the provided context, state clearly and politely: "I'm sorry, but that information is not available in our official exhibition materials. Please feel free to request a demo or speak with our representatives at the booth."
3. DO NOT invent, hallucinate, or assume:
   - Client names or client lists
   - Pricing or financial figures
   - Unverified partnerships or certifications
   - Technical capabilities or features not mentioned in the source context
   - Office addresses or corporate statistics not in the context
4. When providing information from a specific slide/presentation, cite the presentation name and page number if available (e.g., "[CASPEL ERP Presentation, Page 4]").
5. Keep your tone professional, concise, and executive-ready.
"""


class GenerationService:
    def __init__(self):
        self.api_key = settings.GEMINI_API_KEY
        self.model_name = settings.GEMINI_CHAT_MODEL
        self._client_initialized = False

        if self.api_key:
            try:
                import google.generativeai as genai
                genai.configure(api_key=self.api_key)
                self._client_initialized = True
                logger.info(f"Gemini Generation Service initialized with model: {self.model_name}")
            except Exception as e:
                logger.error(f"Failed to configure Gemini GenerativeAI: {e}")
        else:
            logger.warning("GEMINI_API_KEY is not set. CASPEL AI will operate in test/mock response mode.")

    def generate_response(
        self,
        query: str,
        retrieved_chunks: List[RetrievedChunk],
        conversation_history: List[Dict[str, str]] = None,
    ) -> str:
        """
        Generate grounded response from Gemini or mock provider.
        """
        if not retrieved_chunks:
            context_text = "No relevant context found in official exhibition materials."
        else:
            formatted_chunks = []
            for i, c in enumerate(retrieved_chunks):
                formatted_chunks.append(
                    f"--- SOURCE {i+1}: {c.document_name} (Page {c.page_number}) ---\n{c.content}\n"
                )
            context_text = "\n".join(formatted_chunks)

        user_prompt = f"""Context from official CASPEL exhibition materials:
{context_text}

Visitor Question:
{query}

Please provide a clear, accurate, and grounded response based strictly on the context above:"""

        if self._client_initialized and self.api_key:
            try:
                import google.generativeai as genai
                model = genai.GenerativeModel(
                    model_name=self.model_name,
                    system_instruction=SYSTEM_PROMPT,
                )
                response = model.generate_content(user_prompt)
                if response and response.text:
                    return response.text.strip()
            except Exception as e:
                logger.error(f"Gemini generation failed: {e}")
                return (
                    "CASPEL AI is temporarily experiencing connection issues with the AI service. "
                    "Please explore our presentations above or use the Request Demo form to contact our team."
                )

        # Fallback / Mock response when API key is missing during local development
        if retrieved_chunks:
            top_source = retrieved_chunks[0]
            return (
                f"[Development Demo Mode — Real Gemini API Key not configured]\n\n"
                f"Based on {top_source.document_name} (Page {top_source.page_number}):\n"
                f"{top_source.content[:350]}...\n\n"
                f"To enable real Gemini generative responses, provide a valid GEMINI_API_KEY in your server environment."
            )
        else:
            return (
                "Welcome to CASPEL at CIFTIS 2026. "
                "I am here to answer your questions regarding CASPEL, Caspel ERP, Caspel PMS, and IRISSEA. "
                "How may I assist you with our technology solutions today?"
            )


generation_service = GenerationService()
