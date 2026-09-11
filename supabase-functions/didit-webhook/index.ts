// Supabase Edge Function: didit-webhook
// Paste this whole file into the Supabase Dashboard's function editor.
// This is the URL you give Didit in their webhook setup — it receives
// their verification result and writes verified: true/false to Firestore.
//
// Signature verification is UNCHANGED from the original Firebase version
// — same X-Signature-Simple check, verified directly against Didit's
// published docs. That part is pure crypto (Deno's built-in Web Crypto
// API), no npm compatibility risk at all. The Firestore write below is
// the part using npm:firebase-admin — see the note in
// create-didit-session/index.ts about testing that in isolation first.

import { initializeApp, cert, getApps } from "npm:firebase-admin@13.0.0/app";
import { getFirestore } from "npm:firebase-admin@13.0.0/firestore";

if (!getApps().length) {
  const serviceAccount = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT")!);
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time string comparison — timingSafeEqual's job in the original
// Node version. Deno's Web Crypto doesn't expose that helper directly,
// so this does the same thing by hand: compare every character
// regardless of an early mismatch, so a failed check doesn't take
// measurably less time than a passing one (which is what would let an
// attacker guess the signature one byte at a time).
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

Deno.serve(async (req: Request) => {
  const timestampHeader = req.headers.get("x-timestamp");
  const signatureHeader = req.headers.get("x-signature-simple");
  const body = await req.json().catch(() => ({}));
  const {
    session_id: sessionId, status, webhook_type: webhookType, timestamp, vendor_data: vendorData,
    decision, verification_data: verificationData,
  } = body;
  let vendor: { uid: string; purpose?: string } | null = null;
  try { vendor = JSON.parse(String(vendorData)); } catch { vendor = vendorData ? { uid: String(vendorData) } : null; }
  const uid = vendor?.uid;

  if (!timestampHeader || !signatureHeader) {
    return new Response("Missing signature headers", { status: 401 });
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - parseInt(timestampHeader, 10)) > 300) {
    console.error("Didit webhook stale timestamp", timestampHeader);
    return new Response("Stale timestamp", { status: 401 });
  }

  const canonical = `${timestamp ?? ""}:${sessionId ?? ""}:${status ?? ""}:${webhookType ?? ""}`;
  const webhookSecret = Deno.env.get("DIDIT_WEBHOOK_SECRET")!;
  const expected = await hmacSha256Hex(webhookSecret, canonical);

  if (!timingSafeEqual(expected, String(signatureHeader))) {
    console.error("Didit webhook signature mismatch", sessionId);
    return new Response("Invalid signature", { status: 401 });
  }

  if (webhookType !== "status.updated" || !uid) {
    return new Response("ignored", { status: 200 });
  }

  const verifiedSex = verificationData?.sex ?? verificationData?.gender ?? decision?.sex ?? decision?.gender;
  const birthDate = verificationData?.date_of_birth ?? verificationData?.birth_date ?? decision?.date_of_birth;
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);
  if (status === "Approved") {
    await db.doc(`users/${uid}`).set({
      verified: true,
      verificationStatus: "approved",
      verifiedAt: now.toISOString(),
      verificationExpiresAt: expiresAt.getTime(),
      ...(verifiedSex ? { verifiedSex: String(verifiedSex) } : {}),
      ...(birthDate ? { verifiedBirthDate: String(birthDate) } : {}),
    }, { merge: true });
  } else if (["Declined", "Expired", "Abandoned"].includes(String(status))) {
    await db.doc(`users/${uid}`).set({
      verified: false,
      verificationStatus: "declined",
      verifiedAt: now.toISOString(),
    }, { merge: true });
  }
  // Any other status ("In Review", "In Progress") — deliberately no-op.

  return new Response("ok", { status: 200 });
});
