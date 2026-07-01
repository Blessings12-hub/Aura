"""Generate Aura app logos via Gemini Nano Banana."""
import os
import asyncio
from pathlib import Path

from dotenv import load_dotenv
from emergentintegrations.llm.gemini.image_generation import GeminiImageGeneration

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / "backend" / ".env")

EMERGENT_LLM_KEY = os.environ["EMERGENT_LLM_KEY"]
PUBLIC_DIR = ROOT / "frontend" / "public"
PUBLIC_DIR.mkdir(exist_ok=True)


async def generate_logo():
    prompt = (
        "Professional minimal mobile app icon for 'Aura' — a mood-based social wellness app. "
        "Design: a soft glowing aura/halo shape forming the letter A, blended with serene wave-like gradients. "
        "Color palette: deep indigo #4F46E5 to warm pink #EC4899 gradient, with a hint of teal glow. "
        "Style: flat, modern, premium, iOS-style app icon, perfectly centered, no text outside the icon, "
        "rounded square format, soft inner glow, professional vector look, like Headspace or Calm apps. "
        "High contrast, clean, no clutter."
    )

    gen = GeminiImageGeneration(api_key=EMERGENT_LLM_KEY)
    images = await gen.generate_images(
        prompt=prompt,
        model="gemini-2.5-flash-image-preview",
        number_of_images=1,
    )

    logo_path = PUBLIC_DIR / "aura-logo.png"
    logo_path.write_bytes(images[0])
    print(f"Saved {logo_path} ({len(images[0])} bytes)")


asyncio.run(generate_logo())