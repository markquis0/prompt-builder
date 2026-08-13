import { Router } from "express";
import Stripe from "stripe";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/requireAuth.js";

// Constructed lazily, not at module load — `new Stripe()` throws
// synchronously if given an empty/missing key, which would crash the
// *entire* server on boot (this module is imported unconditionally in
// index.js) if STRIPE_SECRET_KEY isn't set yet. Every call site below
// already checks the env var is present before calling this, same pattern
// as pool.js does for DATABASE_URL.
let stripeClient = null;
function getStripe() {
  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

const router = Router();

async function getUserById(userId) {
  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
  return rows[0] || null;
}

router.post("/create-checkout-session", requireAuth, async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID) {
    return res.status(503).json({ error: "Billing isn't configured yet." });
  }
  try {
    const user = await getUserById(req.userId);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      customer_email: user.email,
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      subscription_data: {
        trial_period_days: 7,
        // Also on the subscription itself, not just the Checkout Session —
        // customer.subscription.updated events carry this straight through,
        // so the webhook doesn't need a separate session lookup to find the user.
        metadata: { user_id: user.id },
      },
      success_url: `${process.env.FRONTEND_URL}/pro?checkout=success`,
      cancel_url: `${process.env.FRONTEND_URL}/pro?checkout=canceled`,
      metadata: { user_id: user.id },
    });
    res.json({ checkoutUrl: session.url });
  } catch (err) {
    console.error("[prompt-builder] create-checkout-session error:", err);
    res.status(500).json({ error: "Failed to start checkout. Please try again." });
  }
});

router.get("/portal", requireAuth, async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ error: "Billing isn't configured yet." });
  }
  try {
    const user = await getUserById(req.userId);
    if (!user?.stripe_customer_id) {
      return res.status(400).json({ error: "No subscription found for this account." });
    }
    const session = await getStripe().billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${process.env.FRONTEND_URL}/`,
    });
    res.json({ portalUrl: session.url });
  } catch (err) {
    console.error("[prompt-builder] billing portal error:", err);
    res.status(500).json({ error: "Failed to open the billing portal. Please try again." });
  }
});

export default router;

// Mounted directly in index.js with express.raw(), before the global
// express.json() middleware — Stripe's signature check needs the exact raw
// request bytes, and json() would already have consumed/reserialized the
// body by the time a normally-mounted router saw it (the single most common
// Stripe integration bug, per the handoff — this is the fix for it).
export async function handleStripeWebhook(req, res) {
  if (!process.env.STRIPE_WEBHOOK_SECRET || !process.env.STRIPE_SECRET_KEY) {
    console.error("[prompt-builder] Webhook received but Stripe env vars are not set.");
    return res.status(503).send("Webhook not configured.");
  }

  let event;
  try {
    event = getStripe().webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    // Bad signature — never retried, and never touches the DB. This is the
    // one thing standing between "anyone can POST a fake event and grant
    // themselves a subscription" and not.
    console.error("[prompt-builder] Webhook signature verification failed:", err.message);
    return res.status(400).send("Webhook signature verification failed");
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = session.metadata?.user_id;
        if (userId) {
          await pool.query(
            `UPDATE users
             SET stripe_customer_id = $1, stripe_subscription_id = $2, subscription_status = 'trialing'
             WHERE id = $3`,
            [session.customer, session.subscription, userId]
          );
        }
        break;
      }
      case "customer.subscription.updated": {
        const sub = event.data.object;
        await pool.query(
          `UPDATE users
           SET subscription_status = $1, current_period_ends_at = to_timestamp($2)
           WHERE stripe_subscription_id = $3`,
          [sub.status, sub.current_period_end, sub.id]
        );
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await pool.query(
          "UPDATE users SET subscription_status = 'canceled' WHERE stripe_subscription_id = $1",
          [sub.id]
        );
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        await pool.query(
          "UPDATE users SET subscription_status = 'past_due' WHERE stripe_customer_id = $1",
          [invoice.customer]
        );
        break;
      }
      default:
        break;
    }
    res.json({ received: true });
  } catch (err) {
    // Deliberately NOT swallowed into a 200 here — a DB error mid-update
    // means our subscription state just diverged from Stripe's. Returning
    // 500 makes Stripe retry (it backs off over ~3 days) so the two
    // eventually converge once the DB issue clears, instead of silently
    // staying wrong forever.
    console.error("[prompt-builder] Webhook handler error:", err);
    res.status(500).json({ error: "Internal error processing webhook." });
  }
}
