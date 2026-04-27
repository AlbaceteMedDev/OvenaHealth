// Auth flow: shared-team password against a single Supabase Auth user.
//
// The hardcoded TEAM_EMAIL is a stable identifier — the password is the only
// secret. On first run (account doesn't yet exist) the code falls through to
// signUp, which works without email confirmation. Subsequent logins use
// signInWithPassword.

import { supabase } from "./supabase.js";
import { TEAM_EMAIL } from "./config.js";

const listeners = new Set();
let currentSession = null;

export async function init() {
  const { data } = await supabase.auth.getSession();
  currentSession = data.session;
  supabase.auth.onAuthStateChange((_event, session) => {
    currentSession = session;
    for (const fn of listeners) fn(session);
  });
  return currentSession;
}

export function getSession() { return currentSession; }
export function isAuthed() { return !!currentSession; }

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Sign in with the shared password. On first ever run, account doesn't exist
// yet — we sign up instead (email confirmation must be off in Supabase Auth
// settings).
export async function signInWithPassword(password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: TEAM_EMAIL,
    password,
  });
  if (!error) return { ok: true, session: data.session };

  if (/invalid login credentials/i.test(error.message)) {
    // Account may not exist yet — try to create it. If it already exists with
    // a *different* password, signUp returns an error we surface to the user.
    const signup = await supabase.auth.signUp({
      email: TEAM_EMAIL,
      password,
    });
    if (signup.error) {
      return { ok: false, error: humanize(signup.error.message) };
    }
    if (signup.data.session) {
      return { ok: true, session: signup.data.session };
    }
    // Email confirmation still on — instruct user.
    return {
      ok: false,
      error: "Account created but Supabase requires email confirmation. Disable “Confirm email” in Supabase → Authentication → Providers → Email, then try again.",
    };
  }

  return { ok: false, error: humanize(error.message) };
}

export async function signOut() {
  await supabase.auth.signOut();
}

function humanize(msg) {
  if (/email rate limit/i.test(msg)) return "Too many attempts. Try again in a minute.";
  if (/user already registered/i.test(msg)) return "Wrong password.";
  return msg;
}
