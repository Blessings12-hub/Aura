// Supabase Edge Function: create-flutterwave-session
// Paste this whole file into the Supabase Dashboard's function editor.
//
// Uses Flutterwave's Standard Checkout (POST /v3/payments) — a plain
// HTTP API call, no SDK/npm package needed, which sidesteps the
// npm-on-Deno uncertainty noted on the Didit functions entirely. This
// one is lower-risk than those.
//
// One-time payment only for now, not a recurring subscription — see the
// chat where this was built for why. To actually charge someone monthly
// later, you'd set up a "Payment Plan" in Flutterwave's dashboard and
// pass its ID here; that part isn't built yet.
//
// The uid is encoded directly into tx_ref (rather than relying on an
// unconfirmed custom-metadata field) so the webhook can recover it
// without guessing at an API shape I haven't verified.

import { initializeApp, cert, getApps } from "npm:firebase-admin@13.0.0/app";
import { getAuth } from "npm:firebase-admin@13.0.0/auth";

const BASE_URL = "https://aura-blush-zeta.vercel.app";

if (!getApps().length) {
  const serviceAccount = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT")!);
  initializeApp({ credential: cert(serviceAccount) });
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) {
    return new Response(JSON.stringify({ error: "Missing auth token" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let uid: string;
  let email: string | undefined;
  try {
    const decoded = await getAuth().verifyIdToken(idToken);
    uid = decoded.uid;
    email = decoded.email;
  } catch (err) {
    console.error("ID token verification failed", err);
    return new Response(JSON.stringify({ error: "Invalid auth token" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Aura accounts are anonymous and usually have no email — Flutterwave's
  // checkout requires SOME email, so a placeholder is used if none exists.
  // This is only for their own checkout receipt, never shown inside Aura.
  const customerEmail = email || `${uid}@aura-anonymous.app`;

  // tx_ref carries the uid so the webhook can recover it — anyone reading
  // this reference alone can't do anything with it (no auth power),
  // that's not a secret, just an identifier.
  const txRef = `aura-premium-${uid}-${Date.now()}`;

  const flwRes = await fetch("https://api.flutterwave.com/v3/payments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("FLUTTERWAVE_SECRET_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tx_ref: txRef,
      // ZMW = Zambian Kwacha. Change this and the amount to whatever you
      // actually want to charge — this is a placeholder value.
      amount: "50",
      currency: "ZMW",
      redirect_url: `${BASE_URL}/aura/match?upgrade=success`,
      customer: { email: customerEmail },
      customizations: { title: "Aura Premium" },
    }),
  });

  if (!flwRes.ok) {
    console.error("Flutterwave session creation failed", flwRes.status, await flwRes.text());
    return new Response(JSON.stringify({ error: "Could not start checkout" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const data = await flwRes.json();
  if (data.status !== "success" || !data.data?.link) {
    console.error("Flutterwave returned unexpected response", data);
    return new Response(JSON.stringify({ error: "Could not start checkout" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ url: data.data.link }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
