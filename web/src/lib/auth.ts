import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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

/** Learner-facing text for sign-in errors (Supabase messages are English). `null` = no response. */
export function describeAuthError(error: { message?: string; status?: number; code?: string } | null): string {
  if (!error) return 'Не удалось связаться с сервером. Проверьте интернет и попробуйте ещё раз.';
  const message = (error?.message ?? '').toLowerCase();
  if (error?.code === 'invalid_credentials' || message.includes('invalid login')) return 'Неверный e-mail или пароль.';
  if (error?.code === 'user_already_exists' || message.includes('already registered')) {
    return 'Этот e-mail уже зарегистрирован — войдите.';
  }
  if (error?.code === 'weak_password' || message.includes('password'))
    return 'Пароль должен быть не короче 8 символов.';
  if (message.includes('email')) return 'Проверьте e-mail: похоже, в нём опечатка.';
  if (error.status === 429) return 'Слишком много попыток. Подождите минуту и попробуйте снова.';
  return 'Что-то пошло не так. Попробуйте ещё раз.';
}
