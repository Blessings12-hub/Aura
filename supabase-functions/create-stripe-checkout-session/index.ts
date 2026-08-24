// Supabase Edge Function: create-stripe-checkout-session
// Paste this whole file into the Supabase Dashboard's function editor.

import { initializeApp, cert, getApps } from "npm:firebase-admin@13.0.0/app";
import { getAuth } from "npm:firebase-admin@13.0.0/auth";
import { getFirestore } from "npm:firebase-admin@13.0.0/firestore";
import Stripe from "npm:stripe@17.0.0";

const BASE_URL = "https://aura-blush-zeta.vercel.app";
// Stripe Dashboard -> Product catalog -> your product's Price ID.
const STRIPE_PRICE_ID = "REPLACE_WITH_YOUR_STRIPE_PRICE_ID";

if (!getApps().length) {
  const serviceAccount = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT")!);
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

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
  try {
    const decoded = await getAuth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch (err) {
    console.error("ID token verification failed", err);
    return new Response(JSON.stringify({ error: "Invalid auth token" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });

  // Reuse an existing Stripe customer if this account has checked out
  // before, instead of creating a duplicate customer record every time.
  const userSnap = await db.doc(`users/${uid}`).get();
  const existingCustomerId = userSnap.exists ? userSnap.data()?.stripeCustomerId : null;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    client_reference_id: uid,
    customer: existingCustomerId || undefined,
    success_url: `${BASE_URL}/aura/match?upgrade=success`,
    cancel_url: `${BASE_URL}/aura/match?upgrade=cancelled`,
  });

  return new Response(JSON.stringify({ url: session.url }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
