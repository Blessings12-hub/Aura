// Supabase Edge Function: flutterwave-webhook
// Paste this whole file into the Supabase Dashboard's function editor.
//
// Signature check follows Flutterwave's own official docs exactly
// (developer.flutterwave.com/docs/webhooks): HMAC-SHA256 of the raw
// request body, using the secret hash you set in their dashboard,
// base64-encoded, compared against the flutterwave-signature header.
//
// Also does a SERVER-SIDE verification call back to Flutterwave
// (GET /v3/transactions/{id}/verify) before trusting the payment — this
// matches their own documented best practice ("always verify server-
// side"), and protects against trusting a webhook body that claims
// success without Flutterwave's own systems confirming it independently.

import { initializeApp, cert, getApps } from "npm:firebase-admin@13.0.0/app";
import { getFirestore } from "npm:firebase-admin@13.0.0/firestore";

if (!getApps().length) {
  const serviceAccount = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT")!);
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

async function hmacSha256Base64(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

// The uid was encoded into tx_ref as aura-premium-<uid>-<timestamp> when
// the session was created (see create-flutterwave-session) — this pulls
// it back out. Fragile in the sense that it depends on tx_ref's exact
// shape staying consistent between the two functions; simple enough that
// this is a reasonable tradeoff rather than depending on an unconfirmed
// custom-metadata API field.
function extractUidFromTxRef(txRef: string): string | null {
  const match = txRef?.match(/^aura-premium-(.+)-\d+$/);
  return match ? match[1] : null;
}

Deno.serve(async (req: Request) => {
  const signatureHeader = req.headers.get("flutterwave-signature");
  const rawBody = await req.text();

  if (!signatureHeader) {
    return new Response("Missing signature header", { status: 401 });
  }

  const secretHash = Deno.env.get("FLUTTERWAVE_SECRET_HASH")!;
  const expected = await hmacSha256Base64(secretHash, rawBody);

  if (!timingSafeEqual(expected, signatureHeader)) {
    console.error("Flutterwave webhook signature mismatch");
    return new Response("Invalid signature", { status: 401 });
  }

  const event = JSON.parse(rawBody);

  if (event.event === "charge.completed" && event.data?.status === "successful") {
    const transactionId = event.data.id;
    const txRef = event.data.tx_ref;

    // Server-side re-verification, per Flutterwave's own recommended
    // practice — don't trust the webhook body alone.
    const verifyRes = await fetch(
      `https://api.flutterwave.com/v3/transactions/${transactionId}/verify`,
      { headers: { Authorization: `Bearer ${Deno.env.get("FLUTTERWAVE_SECRET_KEY")}` } },
    );
    const verifyData = await verifyRes.json();

    if (verifyData?.data?.status === "successful" && verifyData?.data?.tx_ref === txRef) {
      const uid = extractUidFromTxRef(txRef);
      if (uid) {
        await db.doc(`users/${uid}`).set({
          plan: "premium",
          flutterwaveTransactionId: transactionId,
        }, { merge: true });
      } else {
        console.error("Could not extract uid from tx_ref", txRef);
      }
    } else {
      console.error("Server-side verification did not confirm success", verifyData);
    }
  }
  // Any other event type — deliberately no-op. (Flutterwave has no
  // direct equivalent wired up here yet for "subscription cancelled" —
  // that's tied to the recurring-billing gap noted in
  // create-flutterwave-session's comments.)

  return new Response("ok", { status: 200 });
});
