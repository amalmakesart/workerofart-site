import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
});

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const signature = req.headers.get('stripe-signature');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
  const body = await req.text();

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature ?? '', webhookSecret);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return new Response(JSON.stringify({ error: 'Invalid signature' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object as Stripe.PaymentIntent;
    const { type, user_id, gig_id, is_featured } = intent.metadata;

    console.log('Payment succeeded:', type, user_id);

    if (type === 'verified_artist' && user_id) {
      // Mark artist as verified in Supabase
      const { error } = await supabase
        .from('profiles')
        .update({
          is_verified: true,
          verified_since: new Date().toISOString(),
          stripe_subscription_id: intent.id,
        })
        .eq('id', user_id);

      if (error) {
        console.error('Failed to verify artist:', error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.log('Artist verified:', user_id);
    }

    if (type === 'gig_post' && gig_id) {
      // Activate the gig and set featured if applicable
      const updates: Record<string, unknown> = { status: 'active' };
      if (is_featured === 'true') {
        updates.is_featured = true;
        updates.featured_until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
      }

      const { error } = await supabase
        .from('gigs')
        .update(updates)
        .eq('id', gig_id);

      if (error) {
        console.error('Failed to activate gig:', error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.log('Gig activated:', gig_id, is_featured === 'true' ? '(featured)' : '');
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
