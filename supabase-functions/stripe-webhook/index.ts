// Supabase Edge Function: stripe-webhook
// Paste this whole file into the Supabase Dashboard's function editor.
// This is the URL you give Stripe in their webhook setup.
//
// Lower-risk than the Didit/Firestore combination above — Stripe's SDK
// via npm:stripe is exactly what Supabase's own official "Stripe
// Webhooks" dashboard template uses, so this specific combination is
// well-trodden. The Firestore write at the bottom carries the same
// npm:firebase-admin uncertainty noted in the other functions.

import { initializeApp, cert, getApps } from "npm:firebase-admin@13.0.0/app";
import { getFirestore } from "npm:firebase-admin@13.0.0/firestore";
import Stripe from "npm:stripe@17.0.0";

if (!getApps().length) {
  const serviceAccount = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT")!);
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

Deno.serve(async (req: Request) => {
  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
  const signature = req.headers.get("stripe-signature")!;
  // Stripe's signature check needs the EXACT raw request body text, not
  // parsed JSON — parsing and re-serializing can change whitespace/key
  // order enough to break the signature match.
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!,
    );
  } catch (err) {
    console.error("Stripe webhook signature verification failed", err);
    return new Response("Webhook signature verification failed", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const uid = session.client_reference_id;
    if (uid) {
      await db.doc(`users/${uid}`).set({
        plan: "premium",
        stripeCustomerId: session.customer,
        stripeSubscriptionId: session.subscription,
      }, { merge: true });
    }
  } else if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    const matches = await db.collection("users")
      .where("stripeSubscriptionId", "==", subscription.id)
      .limit(1)
      .get();
    if (!matches.empty) {
      await matches.docs[0].ref.set({ plan: "free" }, { merge: true });
    }
  }
  // Any other event type — deliberately no-op.

  return new Response("ok", { status: 200 });
});
