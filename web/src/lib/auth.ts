import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n/index.ts';

/**
 * Sign-in (ADR 0009). Production builds use Supabase Auth with email and password; development
 * builds have no sign-in and the API acts as a local development user (ADR 0004).
 */
export const authMode: 'supabase' | 'dev' = import.meta.env.VITE_AUTH_MODE === 'supabase' ? 'supabase' : 'dev';

function makeClient(): SupabaseClient | null {
  if (authMode !== 'supabase') return null;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required');
  return createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
}

export const supabase = makeClient();

/** The current access token (refreshed by the client when needed), or null when signed out. */
export async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** A token the API refuses (an account deleted elsewhere, say): back to the sign-in form. */
export async function dropSession(): Promise<void> {
  await supabase?.auth.signOut({ scope: 'local' });
}

/** Asks for the password again before what can't be undone; a fresh sign-in is what the API wants. */
export async function checkPassword(email: string, password: string): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error?.code === 'invalid_credentials') return t.wrongPassword;
    return error ? describeAuthError(error) : null;
  } catch {
    return describeAuthError(null);
  }
}

export type AuthFailure = { message?: string; status?: number; code?: string };

const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: t.wrongEmailOrPassword,
  user_already_exists: t.thisEmailIsAlreadyRegisteredSign,
  email_exists: t.thisEmailIsAlreadyRegisteredSign,
  weak_password: t.thePasswordMustBeAtLeast,
  same_password: t.theNewPasswordIsTheSame,
  otp_expired: t.wrongOrExpiredCodeCheckThe,
  otp_disabled: t.wrongOrExpiredCodeCheckThe,
  email_not_confirmed: t.firstConfirmYourEmailWithThe,
  email_address_invalid: t.checkYourEmailAddressItLooks,
  over_email_send_rate_limit: t.tooManyEmailsHaveBeenSent,
  over_request_rate_limit: t.tooManyAttemptsApi,
};

/** Learner-facing text for sign-in errors (Supabase messages are English). `null` = no response. */
export function describeAuthError(error: AuthFailure | null): string {
  if (!error) return t.couldnTReachTheServerCheck;
  if (error.code && AUTH_MESSAGES[error.code]) return AUTH_MESSAGES[error.code];
  if (error.status === 429) return AUTH_MESSAGES.over_request_rate_limit;
  // The sign-in service failed, often because its email could not be sent: not the learner's typo.
  if (error.status !== undefined && error.status >= 500) {
    return t.theSignInServiceIsnT;
  }
  const message = (error.message ?? '').toLowerCase();
  if (message.includes('invalid login')) return AUTH_MESSAGES.invalid_credentials;
  if (message.includes('already registered')) return AUTH_MESSAGES.user_already_exists;
  if (message.includes('password')) return AUTH_MESSAGES.weak_password;
  if (message.includes('email')) return AUTH_MESSAGES.email_address_invalid;
  return t.somethingWentWrongTryAgain;
}
