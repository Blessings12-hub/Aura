// Supabase Edge Function: create-didit-session
// Paste this whole file into the Supabase Dashboard's function editor.
//
// UNCERTAINTY WORTH KNOWING: this uses npm:firebase-admin, a Node.js
// library, running on Deno (Supabase's runtime). Deno's npm
// compatibility is real and widely used for exactly this combination,
// but I can't personally run this code to confirm it behaves identically
// to the Node.js version it's replacing. Test it in isolation (see the
// setup walkthrough) before trusting it with real users.

import { initializeApp, cert, getApps } from "npm:firebase-admin@13.0.0/app";
import { getAuth } from "npm:firebase-admin@13.0.0/auth";

const BASE_URL = Deno.env.get("AURA_APP_URL") || "https://aura-blush-zeta.vercel.app";
const DIDIT_WORKFLOW_ID = Deno.env.get("DIDIT_WORKFLOW_ID");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

if (!getApps().length) {
  const serviceAccount = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT")!);
  initializeApp({ credential: cert(serviceAccount) });
}

// CORS: required because this is called directly from the browser at a
// different origin (your Vercel site calling your Supabase function) —
// without these headers the browser blocks the request before it even
// reaches this code.
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

  if (!DIDIT_WORKFLOW_ID || !Deno.env.get("DIDIT_API_KEY")) {
    console.error("Didit verification is not configured");
    return json({ error: "Verification is temporarily unavailable" }, 503);
  }

  const requestBody = await req.json().catch(() => ({}));
  const purpose = requestBody?.purpose === "matchFinder" ? "matchFinder" : "account";
  const diditApiKey = Deno.env.get("DIDIT_API_KEY")!;

  const diditRes = await fetch("https://verification.didit.me/v2/session/", {
    method: "POST",
    headers: { "x-api-key": diditApiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      workflow_id: DIDIT_WORKFLOW_ID,
      vendor_data: JSON.stringify({ uid, purpose, issuedAt: Date.now() }),
      callback: `${BASE_URL}${purpose === "matchFinder" ? "/aura/match" : "/login"}`,
    }),
  });

  if (!diditRes.ok) {
    console.error("Didit session creation failed", diditRes.status, await diditRes.text());
    return new Response(JSON.stringify({ error: "Could not start verification" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const data = await diditRes.json();
  return new Response(JSON.stringify({ url: data.url, sessionId: data.session_id }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
