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
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { type, user_id, gig_id, price_id, is_featured } = await req.json();

    if (!user_id) {
      return new Response(JSON.stringify({ error: 'Missing user_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user email from Supabase for Stripe customer
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, username, full_name')
      .eq('id', user_id)
      .single();

    const { data: authUser } = await supabase.auth.admin.getUserById(user_id);
    const email = authUser?.user?.email ?? undefined;

    if (type === 'verified') {
      // Create a Stripe subscription payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: 3000, // $30.00 in cents
        currency: 'cad',
        metadata: {
          type: 'verified_artist',
          user_id,
          price_id,
        },
        receipt_email: email,
        description: `WOA Verified Artist — ${profile?.full_name ?? profile?.username ?? user_id}`,
      });

      return new Response(JSON.stringify({ clientSecret: paymentIntent.client_secret }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (type === 'gig') {
      const amount = is_featured ? 1400 : 600; // $14 or $6 in cents
      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: 'cad',
        metadata: {
          type: 'gig_post',
          user_id,
          gig_id: gig_id ?? '',
          is_featured: is_featured ? 'true' : 'false',
          price_id,
        },
        receipt_email: email,
        description: `WOA Gig Post${is_featured ? ' (Featured)' : ''} — ${profile?.username ?? user_id}`,
      });

      return new Response(JSON.stringify({ clientSecret: paymentIntent.client_secret }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown type' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
