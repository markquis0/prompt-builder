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
// Exported so routes/account.js can reuse the same lazily-constructed
// client for syncing a changed email to Stripe, instead of a second
// lazy-init copy of this exact pattern.
export function getStripe() {
  if (!stripeClient) {
    // Default is 80s, well past what "latency-sensitive" checkout
    // initiation should ever wait before failing fast.
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, { timeout: 12000 });
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
      // Managed Payments is on by default for this account and requires a
      // tax_code on the Product before it'll process a session at all
      // ("Invalid line_items[0]: this product tax code is ineligible for
      // Managed Payments"). Tax collection is a deliberate business decision
      // to make later (see README), not something to back into via this
      // error — explicitly opting out here until that decision is made.
      managed_payments: { enabled: false },
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
    // Dedup — before any other side effect. Stripe's delivery is at-least-
    // once (retries, and an operator can manually resend an old event from
    // the Dashboard), so the same event.id can arrive more than once.
    // Replaying an already-applied event is a true no-op, not an error.
    const { rows: alreadyProcessed } = await pool.query("SELECT 1 FROM stripe_webhook_events WHERE id = $1", [
      event.id,
    ]);
    if (alreadyProcessed.length > 0) {
      console.log(`[prompt-builder] Webhook event ${event.id} (${event.type}) already processed — skipping.`);
      return res.json({ received: true });
    }

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
        // trial_end is null once the trial ends or never applied — that's
        // fine, to_timestamp(null) is just null, same as current_period_end
        // already handles. Nothing wrote this column before now (not even
        // checkout.session.completed, which only has the session/customer
        // IDs to work with, not the subscription's own trial_end field) —
        // this event is the first place in the flow that actually carries
        // it, and it fires right after checkout in addition to every later
        // status change.
        //
        // Ordering guard: Stripe doesn't guarantee delivery order, so a
        // late-arriving older event could otherwise regress
        // subscription_status backward. The WHERE clause's timestamp
        // comparison makes "only apply if this is newer" atomic with the
        // write itself, rather than a separate check-then-update with a
        // race window. event.created (this event's own timestamp), not
        // sub.created (the subscription's creation date) — that's the
        // ordering signal, not this.
        const { rowCount } = await pool.query(
          `UPDATE users
           SET subscription_status = $1, current_period_ends_at = to_timestamp($2),
               trial_ends_at = to_timestamp($3), subscription_event_created_at = to_timestamp($5)
           WHERE stripe_subscription_id = $4
             AND (subscription_event_created_at IS NULL OR subscription_event_created_at < to_timestamp($5))`,
          [sub.status, sub.current_period_end, sub.trial_end, sub.id, event.created]
        );
        if (rowCount === 0) {
          // Two possible reasons: no user row matches this subscription yet
          // (same silent no-op as before this change — e.g.
          // checkout.session.completed hasn't landed for this customer),
          // or a matching row exists but this event is stale. Only the
          // second is new behavior worth a trace.
          const { rows: existing } = await pool.query(
            "SELECT 1 FROM users WHERE stripe_subscription_id = $1",
            [sub.id]
          );
          if (existing.length > 0) {
            console.log(
              `[prompt-builder] Skipped stale customer.subscription.updated for subscription ${sub.id} ` +
                `(event ${event.id}, event.created=${event.created}) — not newer than the already-applied update.`
            );
          }
        }
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

    // Recorded only after successfully handling the event — if this insert
    // itself fails, the catch below returns 500 and Stripe retries, same as
    // any other DB error here. ON CONFLICT DO NOTHING covers the same
    // event.id being delivered concurrently more than once.
    await pool.query("INSERT INTO stripe_webhook_events (id) VALUES ($1) ON CONFLICT DO NOTHING", [event.id]);

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
