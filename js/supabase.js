// Supabase client singleton. Loads via esm.sh's bundle option so the
// entire SDK lands in one HTTP request (jsDelivr's +esm cascades into
// 5 sub-imports which can hang on slow / filtered networks).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4?bundle";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
    storageKey: "ovena-auth",
  },
});
