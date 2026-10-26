// Supabase connection. Both values are safe to publish: the anon key only works
// together with the row-level security rules in supabase/schema.sql.
// Leave them empty and the app runs fully offline on the device.
window.CUT_CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  // Public half of the push key pair (safe to publish). The private half is the
  // VAPID_PRIVATE_KEY secret in the repo's Actions settings.
  VAPID_PUBLIC_KEY: 'BI4W-nFb6kxFhB0BYzpSKD90ELt3ZzKKHIqwNtlv0fiq6MZBa-FcWk1RwqSUDx-dFvapwacynePdikaP9kRKgjI'
};
