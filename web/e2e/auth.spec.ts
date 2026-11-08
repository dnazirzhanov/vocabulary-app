import { expect, test, type Locator, type Page, type Request, type Route } from '@playwright/test';
import { openSettings } from './learner.ts';

const SUPABASE = 'http://localhost:54321';

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const fakeToken = `${base64url({ alg: 'ES256', typ: 'JWT' })}.${base64url({ sub: 'user-1', role: 'authenticated' })}.sig`;

/** «Выйти» asks first (an accidental tap signs no one out); the window's own «Выйти» does it. */
async function signOut(page: Page, button: Locator) {
  await button.click();
  const asked = page.getByRole('dialog', { name: 'Выйти из приложения?' });
  await asked.getByRole('button', { name: 'Выйти', exact: true }).click();
}

function sessionFor(email: string) {
  return {
    access_token: fakeToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'refresh-1',
    user: { id: 'user-1', aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {} },
  };
}

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
};

const CODE = '123456';
const refuse = (code: string, message: string) => ({ error_code: code, code, message });

/**
 * Stands in for Supabase Auth: any email signs up, "right@example.com" signs in with any password but
 * "wrong-password", others are refused. `confirming`: as in production, signing up sends a code and opens
 * no session until it is typed (CODE). The learning API is the real one (in development mode, which
 * ignores the token), as a fresh learner per test.
 */
async function mockSupabase(page: Page, { confirming = false } = {}) {
  const apiRequests: Request[] = [];
  const learner = `auth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  await page.route(`${SUPABASE}/**`, async (route: Route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(request.url());
    const body = request.postDataJSON() as { email?: string; password?: string; token?: string } | null;
    const json = (status: number, payload: object) =>
      route.fulfill({ status, headers: cors, contentType: 'application/json', json: payload });
    if (url.pathname.endsWith('/signup')) {
      if (confirming) return json(200, sessionFor(body?.email ?? '').user);
      return json(200, sessionFor(body?.email ?? ''));
    }
    if (url.pathname.endsWith('/token')) {
      if (body?.email === 'unconfirmed@example.com') {
        return json(400, refuse('email_not_confirmed', 'Email not confirmed'));
      }
      if (body?.email === 'right@example.com' && body.password !== 'wrong-password') {
        return json(200, sessionFor(body.email));
      }
      return json(400, refuse('invalid_credentials', 'Invalid login credentials'));
    }
    if (url.pathname.endsWith('/verify')) {
      if (body?.token === CODE) return json(200, sessionFor(body.email ?? ''));
      return json(403, refuse('otp_expired', 'Token has expired or is invalid'));
    }
    if (url.pathname.endsWith('/recover') || url.pathname.endsWith('/resend')) return json(200, {});
    if (url.pathname.endsWith('/user')) return json(200, sessionFor('right@example.com').user);
    if (url.pathname.endsWith('/logout')) return route.fulfill({ status: 204, headers: cors });
    return json(404, { message: 'not mocked' });
  });
  // Past the first-run screens (e2e/goal.spec.ts covers them).
  await page.request.patch('/api/me', {
    data: { daily_target_words: 5, name: 'Тест' },
    headers: { 'x-dev-user': learner },
  });
  await page.route('**/api/**', async (route) => {
    apiRequests.push(route.request());
    await route.continue({ headers: { ...route.request().headers(), 'x-dev-user': learner } });
  });
  return apiRequests;
}

const fillForm = async (page: Page, email: string, password: string) => {
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
};

const signUp = async (page: Page, email: string, password: string) => {
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await fillForm(page, email, password);
  await page.getByLabel('Повторите пароль').fill(password);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
};

test('a signed-out visitor sees the login, not the lessons or sign-up', async ({ page }) => {
  await mockSupabase(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeFocused();
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toHaveCount(0);
  await expect(page.getByLabel('Повторите пароль')).toHaveCount(0);

  const submit = page.getByRole('button', { name: 'Войти', exact: true });
  await expect(submit).toBeDisabled();
  await fillForm(page, 'new@example.com', 'short');
  await expect(submit).toBeDisabled();
  await page.getByLabel('Пароль', { exact: true }).fill('long-enough-1');
  await expect(submit).toBeEnabled();
});

test('a new password is typed twice, and only a match can be sent', async ({ page }) => {
  await mockSupabase(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  const submit = page.getByRole('button', { name: 'Создать аккаунт' });
  await fillForm(page, 'new@example.com', 'long-enough-1');
  await expect(submit).toBeDisabled();

  const repeat = page.getByLabel('Повторите пароль');
  // Not while still typing: only once it is as long as the first, or the field is left.
  await repeat.fill('long');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await repeat.blur();
  await expect(page.getByRole('alert')).toHaveText('Пароли не совпадают.');
  await repeat.fill('long-enough-2');
  await expect(page.getByRole('alert')).toHaveText('Пароли не совпадают.');
  await expect(submit).toBeDisabled();

  await repeat.fill('long-enough-1');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(submit).toBeEnabled();
});

test('signing up opens the lessons and sends the token to the API', async ({ page }) => {
  const apiRequests = await mockSupabase(page);
  await page.goto('/');
  await signUp(page, 'new@example.com', 'long-enough-1');

  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
  const withToken = apiRequests.filter((request) => request.headers()['authorization'] === `Bearer ${fakeToken}`);
  expect(withToken.length).toBeGreaterThan(0);
  // Signed-out screens never reach the API.
  expect(apiRequests.every((request) => request.headers()['authorization'])).toBe(true);
});

test('a wrong password is explained in Russian and can be retried', async ({ page }) => {
  await mockSupabase(page);
  await page.goto('/');
  await fillForm(page, 'wrong@example.com', 'whatever-123');
  await page.getByRole('button', { name: 'Войти', exact: true }).last().click();
  await expect(page.getByRole('alert')).toHaveText('Неверный e-mail или пароль.');

  await page.getByLabel('E-mail').fill('right@example.com');
  await page.getByRole('button', { name: 'Войти', exact: true }).last().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
});

test('the session survives a reload, and signing out returns to the form', async ({ page }) => {
  await mockSupabase(page);
  await page.goto('/');
  await signUp(page, 'right@example.com', 'long-enough-1');
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();

  await openSettings(page); // the account is behind ⚙
  await expect(page.getByText('right@example.com')).toBeVisible();
  await signOut(page, page.getByRole('dialog').getByRole('button', { name: 'Выйти' }));
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
});

test('signing up asks for the code from the email before opening the lessons', async ({ page }) => {
  await mockSupabase(page, { confirming: true });
  await page.goto('/');
  await signUp(page, 'new@example.com', 'long-enough-1');

  await expect(page.getByRole('heading', { name: 'Введите код' })).toBeFocused();
  await expect(page.getByText('Мы отправили код на new@example.com.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Отправить ещё раз через \d+ с/ })).toBeDisabled();

  await page.getByLabel('Код из письма').fill('000000');
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByRole('alert')).toContainText('Неверный или устаревший код');
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toHaveCount(0);

  await page.getByLabel('Код из письма').fill(CODE);
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
});

test('signing in before confirming sends a new code and asks for it', async ({ page }) => {
  await mockSupabase(page, { confirming: true });
  const resent = page.waitForRequest((request) => request.url().endsWith('/resend'));
  await page.goto('/');
  await fillForm(page, 'unconfirmed@example.com', 'long-enough-1');
  await page.getByRole('button', { name: 'Войти', exact: true }).last().click();
  await resent;
  await expect(page.getByRole('heading', { name: 'Введите код' })).toBeVisible();
});

test('too many emails is not explained as a typo', async ({ page }) => {
  await mockSupabase(page);
  await page.route(`${SUPABASE}/**/signup`, (route) =>
    route.fulfill({
      status: 429,
      headers: cors,
      json: refuse('over_email_send_rate_limit', 'email rate limit exceeded'),
    }),
  );
  await page.goto('/');
  await signUp(page, 'new@example.com', 'long-enough-1');
  await expect(page.getByRole('alert')).toContainText('слишком много писем');
});

test('the sign-in service failing is not explained as a typo', async ({ page }) => {
  await mockSupabase(page);
  await page.route(`${SUPABASE}/**/signup`, (route) =>
    route.fulfill({ status: 504, headers: cors, body: 'upstream request timeout' }),
  );
  await page.goto('/');
  await signUp(page, 'new@example.com', 'long-enough-1');
  await expect(page.getByRole('alert')).toContainText('Сервис входа сейчас не отвечает');
});

test('a forgotten password: email, code, then a new password before the lessons', async ({ page }) => {
  await mockSupabase(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Забыли пароль?' }).click();
  await expect(page.getByRole('heading', { name: 'Забыли пароль?' })).toBeFocused();
  await page.getByLabel('E-mail').fill('right@example.com');
  await page.getByRole('button', { name: 'Прислать код' }).click();

  // Says the same whether or not the account exists.
  await expect(page.getByText('Если такой аккаунт есть, мы отправили код на right@example.com.')).toBeVisible();
  await page.getByLabel('Код из письма').fill(CODE);
  await page.getByRole('button', { name: 'Подтвердить' }).click();

  await expect(page.getByRole('heading', { name: 'Новый пароль' })).toBeFocused();
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toHaveCount(0);
  const save = page.getByRole('button', { name: 'Сохранить пароль' });
  await expect(save).toBeDisabled();
  await page.getByLabel('Новый пароль').fill('a-brand-new-one');
  await page.getByLabel('Повторите пароль').fill('a-brand-new-two');
  await expect(page.getByRole('alert')).toHaveText('Пароли не совпадают.');
  await expect(save).toBeDisabled();
  await page.getByLabel('Повторите пароль').fill('a-brand-new-one');
  const others = page.waitForRequest((request) => request.url().includes('/logout?scope=others'));
  await save.click();
  await others;
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
});

test('a group invite survives signing up with a code', async ({ page, browser }) => {
  await mockSupabase(page, { confirming: true });
  const teacher = await browser.newContext({
    extraHTTPHeaders: { 'X-Dev-User': `auth-teacher-${Date.now().toString(36)}` },
  });
  await teacher.request.patch('http://localhost:8000/api/me', { data: { name: 'Ольга' } });
  const group = await (
    await teacher.request.post('http://localhost:8000/api/groups', { data: { name: '7Б английский' } })
  ).json();
  await teacher.close();

  await page.goto(`/join/${group.invite_code}`);
  await expect(page.getByText('Вас пригласили в группу')).toBeVisible();
  await signUp(page, 'new@example.com', 'long-enough-1');
  await page.getByLabel('Код из письма').fill(CODE);
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByText('7Б английский')).toBeVisible();
});

test('the password can be shown, and hidden again', async ({ page }) => {
  await mockSupabase(page);
  await page.goto('/');
  const field = page.getByLabel('Пароль', { exact: true });
  await expect(field).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Показать' }).click();
  await expect(field).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Скрыть' }).click();
  await expect(field).toHaveAttribute('type', 'password');
});

test('a token the API refuses leads back to the sign-in form', async ({ page }) => {
  await mockSupabase(page);
  await page.goto('/');
  await signUp(page, 'right@example.com', 'long-enough-1');
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();

  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 401, json: { error: { code: 'invalid_token', message: 'Please sign in again' } } }),
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
});

/** A phone with reminders on: real push needs a push service, so the browser's side is a stand-in. */
const withReminders = (page: Page) =>
  page.addInitScript(() => {
    const device = {
      endpoint: 'https://push.example/device-1',
      toJSON: () => ({}),
      unsubscribe: async () => {
        localStorage.setItem('unsubscribed', 'yes');
        return true;
      },
    };
    const registration = { pushManager: { getSubscription: async () => device } };
    navigator.serviceWorker.getRegistration = (async () => registration) as never;
  });

const signInAndOpenSettings = async (page: Page) => {
  await page.goto('/');
  await signUp(page, 'right@example.com', 'long-enough-1');
  await openSettings(page); // the account is behind ⚙
};

test('signing out stops reminders on this device and leaves other devices signed in', async ({ page }) => {
  await mockSupabase(page);
  await withReminders(page);
  await signInAndOpenSettings(page);

  const forgotten = page.waitForRequest(
    (request) => request.url().endsWith('/api/push/subscriptions') && request.method() === 'DELETE',
  );
  const logout = page.waitForRequest((request) => request.url().includes('/logout'));
  await signOut(page, page.getByRole('dialog').getByRole('button', { name: 'Выйти' }));
  await forgotten;
  expect((await logout).url()).toContain('scope=local');
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('unsubscribed'))).toBe('yes');
});

test('«Выйти» on the main screen signs out too, and stops reminders', async ({ page }) => {
  await mockSupabase(page);
  await withReminders(page);
  await page.goto('/');
  await signUp(page, 'right@example.com', 'long-enough-1');
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();

  // Asked first: «Остаться» has the focus and keeps the learner in, with nothing sent.
  const home = page.getByRole('button', { name: 'Выйти', exact: true });
  await home.click();
  const asked = page.getByRole('dialog', { name: 'Выйти из приложения?' });
  await expect(asked.getByRole('button', { name: 'Остаться' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(asked).toBeHidden();
  await home.click();
  await page.keyboard.press('Escape');
  await expect(asked).toBeHidden();
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();

  const logout = page.waitForRequest((request) => request.url().includes('/logout'));
  await signOut(page, home);
  expect((await logout).url()).toContain('scope=local');
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('unsubscribed'))).toBe('yes');
});

test('signing out without a connection still signs out and stops reminders', async ({ page }) => {
  await mockSupabase(page);
  await withReminders(page);
  await signInAndOpenSettings(page);

  await page.route('**/api/push/subscriptions', (route) => route.abort());
  await page.route(`${SUPABASE}/**/logout*`, (route) => route.abort());
  await signOut(page, page.getByRole('dialog').getByRole('button', { name: 'Выйти' }));
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('unsubscribed'))).toBe('yes');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
});

test('deleting the account asks for the password, then signs the learner out', async ({ page }) => {
  await mockSupabase(page);
  await signInAndOpenSettings(page);

  await page.getByRole('button', { name: 'Удалить аккаунт' }).click();
  await expect(page.getByText('восстановить их будет нельзя')).toBeVisible();
  await page.getByRole('button', { name: 'Отмена' }).click();

  await page.getByRole('button', { name: 'Удалить аккаунт' }).click();
  const confirm = page.getByRole('button', { name: 'Да, удалить' });
  await expect(confirm).toBeDisabled();

  // A wrong password deletes nothing.
  let deleted = false;
  page.on('request', (request) => {
    if (request.method() === 'DELETE' && request.url().endsWith('/api/me')) deleted = true;
  });
  await page.getByLabel('Ваш пароль').fill('wrong-password');
  await confirm.click();
  await expect(page.getByRole('alert')).toHaveText('Неверный пароль.');
  expect(deleted).toBe(false);

  await page.getByLabel('Ваш пароль').fill('long-enough-1');
  await confirm.click();
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
  expect(deleted).toBe(true);
});

test('when deleting fails, the learner stays signed in and is told nothing changed', async ({ page }) => {
  await mockSupabase(page);
  await signInAndOpenSettings(page);
  await page.route('**/api/me', (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({
          status: 503,
          json: { error: { code: 'account_delete_failed', message: 'try again' } },
        })
      : route.fallback(),
  );
  await page.getByRole('button', { name: 'Удалить аккаунт' }).click();
  await page.getByLabel('Ваш пароль').fill('long-enough-1');
  await page.getByRole('button', { name: 'Да, удалить' }).click();
  await expect(page.getByRole('alert')).toContainText('ничего не изменилось');
  await expect(page.getByRole('dialog', { name: 'Настройки' })).toBeVisible();
});

test('on a computer the picture is beside the form, whole, with the language in the corner', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const box = async (locator: Locator) => (await locator.boundingBox())!;
  const form = await box(page.locator('form'));
  const picture = await box(page.locator('main svg').first());
  const language = await box(page.getByRole('combobox'));
  expect(picture.x + picture.width).toBeLessThanOrEqual(form.x); // to its left
  expect(form.y + form.height).toBeLessThanOrEqual(800); // all of it on the screen
  expect(picture.y).toBeLessThan(form.y + form.height);
  expect(form.y).toBeLessThan(picture.y + picture.height); // on the same level
  expect(language.x + language.width).toBeGreaterThan(1200); // the corner
  expect(language.y).toBeLessThan(40);
  expect(language.y + language.height).toBeLessThanOrEqual(form.y);
});
