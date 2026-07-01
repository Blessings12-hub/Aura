from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel
from typing import Optional
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI()
api_router = APIRouter(prefix="/api")

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
INTEGRATION_PROXY_URL = os.environ.get(
    "INTEGRATION_PROXY_URL",
    "https://integrations.emergentagent.com"
)


class TranslateRequest(BaseModel):
    text: str
    target: str
    source: Optional[str] = "auto"


@api_router.get("/")
async def root():
    return {"message": "Aura API up"}


@api_router.get("/health")
async def health():
    return {"ok": True}


@api_router.post("/translate")
async def translate(req: TranslateRequest):
    """Translate text via Gemini (cached in Mongo). Lightweight, secure proxy."""
    if not req.text or not req.text.strip():
        return {"translatedText": req.text}

    if req.target == "en" or req.target == req.source:
        return {"translatedText": req.text}

    cache_key = {"text": req.text, "target": req.target}
    cached = await db.translations.find_one(cache_key)
    if cached:
        return {"translatedText": cached["translated"]}

    lang_names = {
        "en": "English",
        "es": "Spanish",
        "fr": "French",
        "de": "German",
        "pt": "Portuguese",
        "it": "Italian",
        "ru": "Russian",
        "ar": "Arabic",
        "hi": "Hindi",
        "zh": "Chinese (Simplified)",
    }
    target_name = lang_names.get(req.target, req.target)

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage

        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"translate-{req.target}",
            system_message=(
                f"You are a professional translator. Translate the user's text to {target_name}. "
                "Reply with ONLY the translation, no quotes, no explanation, no preface. "
                "Keep the same tone, casing, and punctuation. Preserve emoji."
            ),
        ).with_model("gemini", "gemini-2.5-flash")

        translated = await chat.send_message(UserMessage(text=req.text))
        translated = (translated or req.text).strip()

        if translated.startswith('"') and translated.endswith('"'):
            translated = translated[1:-1]

        await db.translations.insert_one({**cache_key, "translated": translated})
        return {"translatedText": translated}
    except Exception as e:
        logging.exception("translate failed")
        return {"translatedText": req.text, "error": str(e)}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()