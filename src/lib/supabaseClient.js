// src/lib/supabaseClient.js
//
// Only used for Supabase Storage right now (voice notes — see
// uploadVoiceNote in chatMedia.js). Auth, database, everything else in
// Aura still runs entirely on Firebase — this is deliberately narrow,
// not a step toward migrating off Firebase.
//
// The anon key below is safe to ship in client code — it's the public,
// rate-limited key Supabase is designed to have embedded in a browser
// bundle, the same way Firebase's client config isn't a secret either.
// What actually controls access is the bucket's policies (set in the
// Supabase dashboard), not this key being hidden.
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

if (!supabase && import.meta.env.DEV) {
  // eslint-disable-next-line no-console
  console.warn(
    'Supabase not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY '
    + 'to enable voice note uploads (see .env.example).',
  );
}
