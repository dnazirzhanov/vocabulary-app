import { type Browser, type BrowserContext, type Page } from '@playwright/test';
import { button, DEMO, expect, test, named } from './learner.ts';

// A group's spelling tests (ADR 0046): the owner sets one up and opens it, everyone takes it alone
// in their own order against their own clock, and the results are open to the group by name.

const WORDS: Record<string, string> = {
  неудача: 'setback',
  'выгодная покупка': 'bargain',
  засуха: 'drought',
  урожай: 'harvest',
  фонарь: 'lantern',
  луг: 'meadow',
  сад: 'orchard',
  галька: 'pebble',
  ссора: 'quarrel',
  лента: 'ribbon',
};

async function deckFor(context: BrowserContext, groupId: string, count = 10) {
  const deck = await (await context.request.post('/api/decks', { data: { title: 'Unit 4' } })).json();
  for (const [translation, headword] of Object.entries(WORDS).slice(0, count)) {
    const added = await context.request.post(`/api/decks/${deck.id}/words`, {
      data: { headword, translation, pos: 'noun', example: `An example with ${headword}.` },
    });
    expect(added.ok()).toBe(true);
  }
  const given = await context.request.post(`/api/decks/${deck.id}/publish`, { data: { group_id: groupId } });
  expect(given.ok()).toBe(true);
  return deck.id as string;
}

async function ownerGroup(context: BrowserContext, count = 10) {
  const group = await (
    await (await named(context, 'Ольга')).request.post('/api/groups', { data: { name: '7Б' } })
  ).json();
  const deckId = await deckFor(context, group.id, count);
  return { id: group.id as string, code: group.invite_code as string, deckId };
}

const identities = new WeakMap<BrowserContext, string>();

async function member(browser: Browser, code: string, name: string) {
  const id = `e2e-m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const context = await browser.newContext({ extraHTTPHeaders: { ...DEMO, 'X-Dev-User': id } });
  identities.set(context, id);
  await context.request.patch('/api/me', { data: { daily_target_words: 5, study_days_per_week: 6 } });
  await (await named(context, name)).request.post(`/api/groups/join/${code}`);
  return context;
}

async function openTests(page: Page) {
  await page.goto('/');
  await page
    .getByRole('button', { name: /Друзья/ })
    .first()
    .click();
  await page.getByRole('button', { name: /^7Б/ }).click();
  await page.getByRole('button', { name: /^Тесты/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Тесты' })).toBeVisible();
}

async function openDeckTest(page: Page) {
  await openTests(page);
  await page.getByRole('button', { name: /^Unit 4/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Unit 4' })).toBeVisible();
}

/** The one attempt, past the question that guards it. */
async function startTest(page: Page) {
  await button(page, 'Начать тест').click();
  await page.getByRole('dialog', { name: 'Начать тест?' }).getByRole('button', { name: 'Начать', exact: true }).click();
}

const meaning = (page: Page) => page.locator('[data-spelling]').getByRole('heading', { level: 1 });

async function build(page: Page, word: string) {
  for (const letter of word) {
    await page.getByRole('group', { name: 'Буквы' }).getByRole('button', { name: letter, exact: true }).first().click();
  }
}

const checkHeading = (page: Page) => page.getByRole('heading', { name: 'Проверьте перед сдачей' });
/** «Дальше», or on the last word «К проверке». */
const forward = (page: Page) => page.getByRole('button', { name: /^(Дальше|К проверке)$/ });

/** From the check, hands in, saying yes if some words are empty. */
async function handIn(page: Page) {
  await expect(checkHeading(page)).toBeVisible();
  await button(page, 'Сдать').click();
  const ask = page.getByRole('dialog', { name: 'Сдать с пустыми словами?' });
  const result = page.getByRole('button', { name: 'Готово', exact: true });
  await expect(ask.or(result)).toBeVisible();
  if (await ask.isVisible()) await ask.getByRole('button', { name: 'Сдать', exact: true }).click();
}

/** Answers every word, then hands in; the words whose meaning is in `wrong` are built from the wrong word. */
async function answerAll(page: Page, wrong: string[] = []) {
  const order: string[] = [];
  for (;;) {
    await expect(meaning(page).or(checkHeading(page))).toBeVisible();
    if (await checkHeading(page).isVisible()) {
      await handIn(page);
      return order;
    }
    const shown = (await meaning(page).textContent())!;
    order.push(shown);
    const word = WORDS[shown];
    // The same letters in another order: always spells something wrong.
    await build(page, wrong.includes(shown) ? [...word].reverse().join('') : word);
    await forward(page).click();
    await expect(
      checkHeading(page)
        .or(page.getByText(`${order.length} / `))
        .first(),
    ).toBeVisible();
  }
}

test('the owner sets a test up in one window, and a member cannot', async ({ page, context, browser }) => {
  const group = await ownerGroup(context);
  const anna = await member(browser, group.code, 'Анна');
  const annaPage = await anna.newPage();

  await openDeckTest(page);
  await button(page, 'Настроить тест').click();
  const setup = page.getByRole('dialog', { name: 'Настройка теста' });
  await expect(setup.getByText('Все (10)')).toBeVisible();
  await expect(setup.getByLabel('Время, мин')).toHaveValue('10');
  await expect(setup.getByLabel('Сдать от, %')).toHaveValue('80');
  // The word list stays folded until asked for.
  await expect(setup.getByRole('checkbox')).toHaveCount(0);
  await setup.getByRole('button', { name: 'Убрать слова' }).click();
  await setup.getByRole('checkbox', { name: /setback/ }).uncheck();
  await expect(setup.getByText('Все (9)')).toBeVisible();
  await expect(setup.getByRole('button', { name: 'Убраны: 1' })).toBeVisible();
  await setup.getByLabel('Сдать от, %').fill('101');
  await expect(setup.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  await expect(setup.getByText('Сдать от: от 1 до 100%.')).toBeVisible();
  await setup.getByLabel('Сдать от, %').fill('70');
  await setup.getByRole('button', { name: 'Сохранить' }).click();

  await expect(page.getByText('9 слов · 10 мин · сдать от 70%')).toBeVisible();
  // Saved is not yet open.
  await openDeckTest(annaPage);
  await expect(annaPage.getByText('Тест ещё не открыт')).toBeVisible();
  // Nobody is behind on a test that has never been open.
  await expect(annaPage.getByRole('region', { name: 'Ещё не проходили' })).toHaveCount(0);
  await expect(annaPage.getByRole('button', { name: 'Настроить тест' })).toHaveCount(0);
  await expect(annaPage.getByRole('button', { name: 'Открыть тест' })).toHaveCount(0);

  await button(page, 'Открыть тест').click();
  await expect(button(page, 'Закрыть тест')).toBeVisible();
  // Settings wait until it is closed again.
  await expect(page.getByRole('button', { name: 'Настроить тест' })).toHaveCount(0);
  await annaPage.reload();
  await openDeckTest(annaPage);
  await expect(button(annaPage, 'Начать тест')).toBeVisible();
  await anna.close();
});

test('two students get their own order, and the results are open by name', async ({ page, context, browser }) => {
  const group = await ownerGroup(context);
  const setup = await context.request.get(`/api/groups/${group.id}/tests/${group.deckId}/setup`);
  const excluded = (await setup.json()).words.find((word: { headword: string }) => word.headword === 'pebble').id;
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}`, {
    data: { excluded_word_ids: [excluded] },
  });
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}/open`, { data: { open: true } });

  const anna = await member(browser, group.code, 'Анна');
  const ivan = await member(browser, group.code, 'Иван');
  const dina = await member(browser, group.code, 'Дина');
  const annaPage = await anna.newPage();
  const ivanPage = await ivan.newPage();

  await openDeckTest(annaPage);
  await expect(annaPage.getByText('9 слов · 10 мин · сдать от 80%')).toBeVisible();
  // The one attempt is guarded: «Отмена» has the focus, and cancelling starts nothing.
  await button(annaPage, 'Начать тест').click();
  const question = annaPage.getByRole('dialog', { name: 'Начать тест?' });
  await expect(question.getByText('Время пойдёт сразу. Попытка одна.')).toBeVisible();
  await expect(question.getByRole('button', { name: 'Отмена' })).toBeFocused();
  await question.getByRole('button', { name: 'Отмена' }).click();
  await expect(annaPage.locator('[data-spelling]')).toHaveCount(0);
  const before = await (await anna.request.get(`/api/groups/${group.id}/tests/${group.deckId}`)).json();
  expect(before.mine.state).toBe('none');
  await startTest(annaPage);
  await expect(annaPage.locator('[data-spelling]').getByText(/^Тест · слово 1 из \d+$/)).toBeVisible();
  // No hint of either kind, and nothing said between words.
  await expect(annaPage.getByRole('group', { name: 'Подсказки' })).toHaveCount(0);
  await expect(annaPage.getByRole('timer')).toHaveText(/^(10:00|9:\d\d)$/);
  const annaOrder = await answerAll(annaPage);
  await expect(annaPage.getByRole('img', { name: '9 из 9 · 100%' })).toBeVisible();
  await expect(annaPage.getByRole('heading', { level: 1, name: 'Без единой ошибки!' })).toBeVisible();

  await openDeckTest(ivanPage);
  await startTest(ivanPage);
  const wrong = Object.keys(WORDS)
    .filter((meaningText) => meaningText !== 'галька')
    .slice(0, 5);
  const ivanOrder = await answerAll(ivanPage, wrong);
  await expect(ivanPage.getByRole('img', { name: '4 из 9 · 44%' })).toBeVisible();
  await expect(ivanPage.getByRole('heading', { level: 1, name: 'Пока не сдан' })).toBeVisible();
  await expect(ivanPage.getByRole('region', { name: 'Ошибки' }).getByRole('listitem')).toHaveCount(5);

  expect(annaOrder).toHaveLength(9);
  expect(new Set(annaOrder).size).toBe(9);
  expect(annaOrder).not.toContain('галька'); // excluded
  expect([...annaOrder].sort()).toEqual([...ivanOrder].sort());
  expect(annaOrder).not.toEqual(ivanOrder); // 1 in 362,880 by chance

  await openDeckTest(page);
  const passed = page.getByRole('region', { name: 'Сдали', exact: true });
  await expect(passed.getByRole('listitem')).toHaveText(['Анна9 из 9 · 100%']);
  const failed = page.getByRole('region', { name: 'Не сдали' });
  await expect(failed.getByRole('listitem')).toHaveText(['Иван4 из 9 · 44%']);
  const waiting = page.getByRole('region', { name: 'Ещё не проходили' });
  await expect(waiting.getByRole('listitem')).toHaveText(['Дина']);

  // The group's page says how it went, and once taken the test can't start again.
  await page.getByRole('button', { name: 'Тесты', exact: true }).click();
  await page.getByRole('button', { name: 'К группе', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Тесты/ })).toContainText('Сдали 1 из 3 · Unit 4');
  await annaPage.getByRole('button', { name: 'Готово', exact: true }).click();
  await expect(annaPage.getByText('9 из 9 · 100% · Сдано')).toBeVisible();
  await expect(annaPage.getByRole('button', { name: /Начать тест/ })).toHaveCount(0);
  await anna.close();
  await ivan.close();
  await dina.close();
});

test('a reload in the middle of a test finds the same word, half-built, and the same clock', async ({
  page,
  context,
}) => {
  const group = await ownerGroup(context);
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}`, { data: {} });
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}/open`, { data: { open: true } });
  await openDeckTest(page);
  await startTest(page);

  const first = (await meaning(page).textContent())!;
  await build(page, WORDS[first]);
  await button(page, 'Дальше').click();
  await expect(page.getByText('1 / 10')).toBeVisible();

  const second = (await meaning(page).textContent())!;
  await build(page, WORDS[second].slice(0, 2));
  await page.reload();

  await expect(meaning(page)).toHaveText(second);
  await expect(page.getByText('1 / 10')).toBeVisible();
  await expect(page.getByRole('group', { name: `Ответ: 2 из ${WORDS[second].length} букв` })).toBeVisible();
  await expect(page.getByRole('timer')).toHaveText(/^9:\d\d$/);

  // Leaving warns; the page then offers to go back, still to the same word.
  await page.getByRole('button', { name: 'Выйти из теста' }).click();
  const leave = page.getByRole('dialog', { name: 'Выйти из теста?' });
  await expect(leave.getByText('Время продолжает идти.')).toBeVisible();
  await leave.getByRole('button', { name: 'Выйти', exact: true }).click();
  await page.getByRole('button', { name: /^Продолжить тест/ }).click();
  await expect(meaning(page)).toHaveText(second);
});

test('when the time is up the tiles lock, the built word counts, and the group sees the result', async ({
  page,
  context,
  browser,
  learner,
}) => {
  const group = await ownerGroup(context);
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}`, { data: { minutes: 1 } });
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}/open`, { data: { open: true } });

  const anna = await member(browser, group.code, 'Анна');
  const annaPage = await anna.newPage();
  await annaPage.clock.install();
  await openDeckTest(annaPage);
  await startTest(annaPage);
  const first = (await meaning(annaPage).textContent())!;
  await build(annaPage, WORDS[first]);
  await button(annaPage, 'Дальше').click();
  await expect(annaPage.getByText('1 / 10')).toBeVisible();
  // The second word is built but not sent when the time runs out.
  const second = (await meaning(annaPage).textContent())!;
  await build(annaPage, WORDS[second]);

  // The server's clock and the device's move together.
  await anna.setExtraHTTPHeaders({
    ...DEMO,
    'X-Dev-User': identities.get(anna)!,
    'X-Dev-Now': new Date(Date.now() + 61_000).toISOString(),
  });
  await annaPage.clock.fastForward(61_000);

  await expect(annaPage.getByRole('img', { name: '2 из 10 · 20%' })).toBeVisible();
  await expect(annaPage.getByText('Время вышло')).toBeVisible();
  await expect(annaPage.getByRole('heading', { level: 1, name: 'Пока не сдан' })).toBeVisible();
  await expect(annaPage.getByRole('region', { name: 'Не успели' }).getByRole('listitem')).toHaveCount(8);

  await learner.travelTo(new Date(Date.now() + 61_000));
  await openDeckTest(page);
  await expect(page.getByRole('region', { name: 'Не сдали' }).getByRole('listitem')).toHaveText(['Анна2 из 10 · 20%']);
  await anna.close();
});

test('someone who starts and never comes back still gets a result', async ({ page, context, browser, learner }) => {
  const group = await ownerGroup(context);
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}`, { data: { minutes: 1 } });
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}/open`, { data: { open: true } });

  const anna = await member(browser, group.code, 'Анна');
  const started = await anna.request.post(`/api/groups/${group.id}/tests/${group.deckId}/attempts`, {
    data: { kind: 'test' },
  });
  expect(started.ok()).toBe(true);
  await anna.close();

  await openDeckTest(page);
  await expect(page.getByRole('region', { name: 'Ещё не проходили' }).getByRole('listitem')).toHaveText(['Анна']);

  await learner.travelTo(new Date(Date.now() + 2 * 60_000));
  await page.reload();
  await openDeckTest(page);
  await expect(page.getByRole('region', { name: 'Не сдали' }).getByRole('listitem')).toHaveText(['Анна0 из 10 · 0%']);
});

test('practice stays private and shows its mistakes', async ({ page, context, browser }) => {
  const group = await ownerGroup(context, 3);
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}`, { data: {} });

  const anna = await member(browser, group.code, 'Анна');
  const annaPage = await anna.newPage();
  await openDeckTest(annaPage);
  // Practice needs only a saved test; the timed one is still closed.
  await button(annaPage, 'Тренировка').click();
  await expect(annaPage.getByRole('timer')).toHaveCount(0);
  await expect(annaPage.locator('[data-spelling]').getByText(/^Тренировка · слово 1 из \d+$/)).toBeVisible();
  await expect(annaPage.getByRole('button', { name: /Подсказка/ })).toHaveCount(0);
  await answerAll(annaPage, ['неудача']);
  await expect(annaPage.getByRole('img', { name: '2 из 3 · 66%' })).toBeVisible();
  await expect(annaPage.getByText('Сдано', { exact: true })).toHaveCount(0);
  await expect(annaPage.getByRole('region', { name: 'Ошибки' })).toContainText('setback');

  // Again, in a new attempt.
  await button(annaPage, 'Ещё раз').click();
  await expect(meaning(annaPage)).toBeVisible();
  await answerAll(annaPage, ['неудача']);
  await button(annaPage, 'Готово').click();

  // The group knows nothing of it.
  await openDeckTest(page);
  await button(page, 'Открыть тест').click();
  await expect(page.getByRole('region', { name: 'Ещё не проходили' }).getByRole('listitem')).toHaveText(['Анна']);
  await expect(page.getByRole('region', { name: 'Сдали', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Не сдали' })).toHaveCount(0);
  await anna.close();
});

test('changing the words asks before erasing results, and a student mid-test is told', async ({
  page,
  context,
  browser,
}) => {
  const group = await ownerGroup(context);
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}`, { data: {} });
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}/open`, { data: { open: true } });

  const anna = await member(browser, group.code, 'Анна');
  const annaPage = await anna.newPage();
  await openDeckTest(annaPage);
  await startTest(annaPage);
  await expect(meaning(annaPage)).toBeVisible();

  await openDeckTest(page);
  await button(page, 'Закрыть тест').click();
  await button(page, 'Настроить тест').click();
  const setup = page.getByRole('dialog');
  await setup.getByRole('radio', { name: 'Случайные' }).check();
  await setup.getByLabel('Сколько случайных слов').fill('4');
  await setup.getByRole('button', { name: 'Сохранить' }).click();

  const confirm = page.getByRole('dialog', { name: 'Другие слова — новый тест' });
  await expect(confirm.getByText('Результаты теста будут удалены: 1.')).toBeVisible();
  await expect(confirm.getByRole('button', { name: 'Отмена' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Удалить результаты и сохранить' }).click();
  await expect(page.getByText('4 слова · 10 мин · сдать от 80%')).toBeVisible();

  await build(annaPage, WORDS[(await meaning(annaPage).textContent())!]);
  await button(annaPage, 'Дальше').click();
  await expect(annaPage.getByText('Тест изменился. Начните заново.')).toBeVisible();
  await button(annaPage, 'Назад').click();
  await expect(annaPage.getByText('4 слова · 10 мин · сдать от 80%')).toBeVisible();
  await button(page, 'Открыть тест').click();
  await expect(button(page, 'Закрыть тест')).toBeVisible();
  await openDeckTest(annaPage);
  await expect(button(annaPage, 'Начать тест')).toBeVisible();
  await anna.close();
});

test('back, skip and next walk through the words; the check shows what is empty; then it is handed in', async ({
  page,
  context,
}) => {
  const group = await ownerGroup(context, 3);
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}`, { data: {} });
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}/open`, { data: { open: true } });
  await openDeckTest(page);
  await startTest(page);
  const card = page.locator('[data-spelling]');

  // The first word: no way back yet. Answered, then on.
  await expect(card.getByText('Тест · слово 1 из 3')).toBeVisible();
  await expect(button(page, 'Назад')).toBeDisabled();
  const first = (await meaning(page).textContent())!;
  await build(page, WORDS[first]);
  await button(page, 'Дальше').click();
  await expect(card.getByText('Тест · слово 2 из 3')).toBeVisible();

  // The second: skipped, so it stays empty.
  const second = (await meaning(page).textContent())!;
  await button(page, 'Пропустить').click();
  await expect(card.getByText('Тест · слово 3 из 3')).toBeVisible();
  const third = (await meaning(page).textContent())!;

  // Back twice: the first word with its answer in place, still changeable.
  await button(page, 'Назад').click();
  await expect(meaning(page)).toHaveText(second);
  await button(page, 'Назад').click();
  await expect(meaning(page)).toHaveText(first);
  await expect(
    page.getByRole('group', { name: `Ответ: ${WORDS[first].length} из ${WORDS[first].length} букв` }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Очистить' }).click();
  await build(page, [...WORDS[first]].reverse().join('')); // changed: now wrong
  await button(page, 'Дальше').click();
  await expect(meaning(page)).toHaveText(second);
  await expect(button(page, 'Дальше')).toBeDisabled(); // nothing built: «Дальше» waits
  await button(page, 'Пропустить').click();

  // The last word: «К проверке», and the check, word by word.
  await expect(meaning(page)).toHaveText(third);
  await build(page, WORDS[third]);
  await button(page, 'К проверке').click();
  await expect(checkHeading(page)).toBeVisible();
  const rows = page.getByRole('list', { name: 'Проверьте перед сдачей' }).getByRole('listitem');
  await expect(rows).toHaveText([`1${first}Есть ответ`, `2${second}Пропущено`, `3${third}Есть ответ`]);
  await expect(page.getByText('Без ответа: 1.')).toBeVisible();

  // A word on the check opens it; answering it there, then back to the check.
  await rows.nth(1).getByRole('button').click();
  await expect(meaning(page)).toHaveText(second);
  await button(page, 'Назад').click(); // and back again: still the first, changed answer
  await expect(meaning(page)).toHaveText(first);
  await button(page, 'Дальше').click();
  await expect(meaning(page)).toHaveText(second);
  await button(page, 'Пропустить').click();
  await button(page, 'К проверке').click();

  // Handing in with an empty word asks first; «Вернуться к словам» keeps it running.
  await button(page, 'Сдать').click();
  const ask = page.getByRole('dialog', { name: 'Сдать с пустыми словами?' });
  await expect(ask.getByText('Слов без ответа: 1. Они засчитаются как ошибки.')).toBeVisible();
  await ask.getByRole('button', { name: 'Вернуться к словам' }).click();
  await expect(checkHeading(page)).toBeVisible();
  await handIn(page);

  await expect(page.getByRole('img', { name: '1 из 3 · 33%' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Ошибки' })).toContainText(WORDS[first]);
  await expect(page.getByRole('region', { name: 'Пропущено' })).toContainText(WORDS[second]);
  await expect(page.getByRole('region', { name: 'Не успели' })).toHaveCount(0);
  await button(page, 'Готово').click();

  // Kept: «Мои попытки» on the test's page, opening the same result.
  const history = page.getByRole('region', { name: /Мои попытки/ });
  await expect(history.getByRole('listitem')).toHaveCount(1);
  await expect(history).toContainText('Тест');
  await expect(history).toContainText('1 из 3');
  await history.getByRole('button').click();
  await expect(page.getByRole('img', { name: '1 из 3 · 33%' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Пропущено' })).toContainText(WORDS[second]);
});

test('«К пропущенным» goes through only the skipped words, then back to the check', async ({ page, context }) => {
  const group = await ownerGroup(context, 4);
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}`, { data: {} });
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}/open`, { data: { open: true } });
  await openDeckTest(page);
  await startTest(page);
  const card = page.locator('[data-spelling]');

  // Skip the first and third, answer the second and fourth.
  const shown: string[] = [];
  for (let n = 0; n < 4; n += 1) {
    await expect(card.getByText(`Тест · слово ${n + 1} из 4`)).toBeVisible();
    const word = (await meaning(page).textContent())!;
    shown.push(word);
    if (n % 2 === 0) await button(page, 'Пропустить').click();
    else {
      await build(page, WORDS[word]);
      await forward(page).click();
    }
  }
  await expect(checkHeading(page)).toBeVisible();

  // Through the two skipped, in turn: the answered ones in between are passed by.
  await button(page, 'К пропущенным · 2').click();
  await expect(card.getByText('Тест · пропущенное 1 из 2')).toBeVisible();
  await expect(meaning(page)).toHaveText(shown[0]);
  await expect(button(page, 'Назад')).toBeDisabled();
  await build(page, WORDS[shown[0]]);
  await button(page, 'Дальше').click();
  await expect(card.getByText('Тест · пропущенное 2 из 2')).toBeVisible();
  await expect(meaning(page)).toHaveText(shown[2]);
  // «Назад» goes to the previous skipped one, its answer in place.
  await button(page, 'Назад').click();
  await expect(meaning(page)).toHaveText(shown[0]);
  await button(page, 'Дальше').click();
  await expect(meaning(page)).toHaveText(shown[2]);
  await build(page, WORDS[shown[2]]);
  await button(page, 'К проверке').click();

  // Back on the check, nothing missing: no way to the skipped, and it hands in at once.
  await expect(checkHeading(page)).toBeVisible();
  await expect(page.getByRole('button', { name: /^К пропущенным/ })).toHaveCount(0);
  await button(page, 'Сдать').click();
  await expect(page.getByRole('img', { name: '4 из 4 · 100%' })).toBeVisible();
});

test('the owner opens the test again: a student who passed takes it again, and the list follows', async ({
  page,
  context,
  browser,
}) => {
  const group = await ownerGroup(context, 3);
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}`, { data: {} });
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}/open`, { data: { open: true } });

  const anna = await member(browser, group.code, 'Анна');
  const annaPage = await anna.newPage();
  await annaPage.clock.install();
  await openDeckTest(annaPage);
  await startTest(annaPage);
  await answerAll(annaPage);
  await button(annaPage, 'Готово').click();
  await expect(annaPage.getByText('3 из 3 · 100% · Сдано')).toBeVisible();
  await expect(annaPage.getByRole('button', { name: 'Начать тест' })).toHaveCount(0);

  await openDeckTest(page);
  await expect(page.getByRole('region', { name: 'Сдали', exact: true }).getByRole('listitem')).toHaveText([
    'Анна3 из 3 · 100%',
  ]);
  await button(page, 'Закрыть тест').click();
  await button(page, 'Открыть тест').click();
  await expect(button(page, 'Закрыть тест')).toBeVisible();
  // The old result stands until there is a new one.
  await expect(page.getByRole('region', { name: 'Сдали', exact: true }).getByRole('listitem')).toHaveText([
    'Анна3 из 3 · 100%',
  ]);

  // A student already on the page sees it open, without reloading.
  await annaPage.clock.fastForward(31_000);
  await expect(annaPage.getByText('Прошлый раз: 3 из 3 · 100% · Сдано')).toBeVisible();
  await startTest(annaPage);
  await answerAll(annaPage, Object.keys(WORDS).slice(0, 3));
  await button(annaPage, 'Готово').click();
  await expect(annaPage.getByText('0 из 3 · 0% · Не сдано')).toBeVisible();

  await page.reload();
  await openDeckTest(page);
  await expect(page.getByRole('region', { name: 'Не сдали' }).getByRole('listitem')).toHaveText(['Анна0 из 3 · 0%']);
  await expect(page.getByRole('region', { name: 'Сдали', exact: true })).toHaveCount(0);
  await anna.close();
});

test('words misspelled and skipped in a test wait in «Трудные» on the deck page', async ({ context, browser }) => {
  const group = await ownerGroup(context, 3);
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}`, { data: {} });
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}/open`, { data: { open: true } });

  // A student who has studied no lesson at all.
  const anna = await member(browser, group.code, 'Анна');
  const annaPage = await anna.newPage();
  await openDeckTest(annaPage);
  await startTest(annaPage);

  const misspelled = (await meaning(annaPage).textContent())!;
  await build(annaPage, [...WORDS[misspelled]].reverse().join(''));
  await button(annaPage, 'Дальше').click();
  await expect(annaPage.getByText('1 / 3')).toBeVisible();

  const skipped = (await meaning(annaPage).textContent())!;
  await button(annaPage, 'Пропустить').click();
  await expect(annaPage.getByText('2 / 3')).toBeVisible();

  const right = (await meaning(annaPage).textContent())!;
  await build(annaPage, WORDS[right]);
  await button(annaPage, 'К проверке').click();
  await handIn(annaPage);

  // The feedback, in its groups.
  await expect(annaPage.getByRole('img', { name: '1 из 3 · 33%' })).toBeVisible();
  await expect(annaPage.getByRole('region', { name: 'Ошибки' })).toContainText(WORDS[misspelled]);
  await expect(annaPage.getByRole('region', { name: 'Пропущено' })).toContainText(WORDS[skipped]);
  await button(annaPage, 'Готово').click();

  // On the deck's page, in individual practice.
  await expect(annaPage.getByRole('heading', { level: 1, name: 'Unit 4' })).toBeVisible();
  // Hard words live in «Трудные», in one place: none on the group's page.
  await expect(annaPage.locator('main')).not.toContainText(WORDS[misspelled]);
  await expect(annaPage.locator('main')).not.toContainText(WORDS[skipped]);
  await annaPage.getByRole('button', { name: 'Сегодня' }).click();
  await annaPage
    .getByRole('button', { name: /Unit 4/ })
    .first()
    .click();
  await button(annaPage, 'Правописание').click();
  const modes = annaPage.getByRole('dialog', { name: 'Правописание' });
  await modes.getByRole('radio', { name: /Трудные 2.слова с ошибкой/ }).check();
  await modes.getByRole('button', { name: 'Начать · 2 слова' }).click();

  const seen = new Set<string>();
  for (let done = 0; done < 2; done += 1) {
    const shown = (await meaning(annaPage).textContent())!;
    seen.add(shown);
    await build(annaPage, WORDS[shown]);
    await button(annaPage, 'Проверить').click();
    await expect(annaPage.getByRole('status')).toContainText('Верно');
    await button(annaPage, 'Дальше').click();
    if (done === 0) await expect(meaning(annaPage)).not.toHaveText(shown);
  }
  expect([...seen].sort()).toEqual([misspelled, skipped].sort());
  await anna.close();
});

test('a member sees the way to tests only once a test exists', async ({ page, context, browser }) => {
  const group = await ownerGroup(context);
  const anna = await member(browser, group.code, 'Анна');
  const annaPage = await anna.newPage();
  await annaPage.goto('/');
  await annaPage
    .getByRole('button', { name: /Друзья/ })
    .first()
    .click();
  await annaPage.getByRole('button', { name: /^7Б/ }).click();
  await expect(annaPage.getByRole('heading', { level: 1, name: '7Б' })).toBeVisible();
  await expect(annaPage.getByRole('button', { name: /^Тесты/ })).toHaveCount(0);

  // The owner gets it as soon as there is a deck, to set one up.
  await page.goto('/');
  await page
    .getByRole('button', { name: /Друзья/ })
    .first()
    .click();
  await page.getByRole('button', { name: /^7Б/ }).click();
  await expect(page.getByRole('button', { name: /^Тесты/ })).toBeVisible();

  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}`, { data: {} });
  await openTests(annaPage);
  await expect(annaPage.getByRole('button', { name: /^Unit 4/ })).toBeVisible();
  await anna.close();
});

test('a group with no decks has no way to tests', async ({ page, context }) => {
  await (await named(context, 'Ольга')).request.post('/api/groups', { data: { name: '7Б' } });
  await page.goto('/');
  await page
    .getByRole('button', { name: /Друзья/ })
    .first()
    .click();
  await page.getByRole('button', { name: /^7Б/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: '7Б' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Тесты/ })).toHaveCount(0);
});

test('music plays while the words are answered, can be turned off, and stops at the result', async ({
  context,
  browser,
}) => {
  const group = await ownerGroup(context, 3);
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}`, { data: {} });
  const anna = await member(browser, group.code, 'Анна');
  // Count the notes the music schedules: what a listener would hear, without a speaker.
  await anna.addInitScript(() => {
    const w = window as unknown as { notes: number };
    w.notes = 0;
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (this: AudioContext) {
      w.notes += 1;
      return create.call(this);
    };
  });
  const page = await anna.newPage();
  const notes = () => page.evaluate(() => (window as unknown as { notes: number }).notes);
  const keepsPlaying = async () => {
    const before = await notes();
    await expect.poll(notes, { timeout: 6000 }).toBeGreaterThan(before + 4);
  };
  const isSilent = async () => {
    await page.waitForTimeout(300); // the notes already scheduled ahead
    const before = await notes();
    await page.waitForTimeout(800);
    expect(await notes()).toBe(before);
  };

  await openDeckTest(page);
  await button(page, 'Тренировка').click();
  await expect(meaning(page)).toBeVisible();
  const music = page.getByRole('button', { name: 'Музыка' });
  await expect(music).toHaveAttribute('aria-pressed', 'true');
  await keepsPlaying();

  await music.click();
  await expect(music).toHaveAttribute('aria-pressed', 'false');
  await isSilent();
  await music.click();
  await keepsPlaying();

  await answerAll(page);
  await expect(page.getByRole('img', { name: '3 из 3 · 100%' })).toBeVisible();
  await isSilent();

  // Off stays off in the next one, and is remembered on this device.
  await button(page, 'Ещё раз').click();
  await expect(meaning(page)).toBeVisible();
  await page.getByRole('button', { name: 'Музыка' }).click();
  await expect(page.getByRole('button', { name: 'Музыка' })).toHaveAttribute('aria-pressed', 'false');
  await isSilent();
  expect(await page.evaluate(() => localStorage.getItem('test-music'))).toBe('off');
  await anna.close();
});

test('words move at once while answers save behind, and any keyboard layout types', async ({ page, context }) => {
  const group = await ownerGroup(context, 3);
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}`, { data: {} });
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}/open`, { data: { open: true } });
  // A slow classroom network: every save takes three seconds.
  let saves = 0;
  await page.route('**/api/test-attempts/*/questions/*', async (route) => {
    await new Promise((done) => setTimeout(done, 3000));
    saves += 1;
    await route.continue();
  });
  await openDeckTest(page);
  await startTest(page);

  // A Russian layout: the key A types «ф», but it is still the key A.
  const first = (await meaning(page).textContent())!;
  for (const letter of WORDS[first]) {
    await page.evaluate(
      (code) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ф', code, bubbles: true })),
      `Key${letter.toUpperCase()}`,
    );
  }
  await expect(
    page.getByRole('group', { name: `Ответ: ${WORDS[first].length} из ${WORDS[first].length} букв` }),
  ).toBeVisible();

  // «Дальше» shows the next word at once, its letters ready, while the save is still on its way.
  await button(page, 'Дальше').click();
  await expect(meaning(page)).not.toHaveText(first, { timeout: 1000 });
  const letters = page.getByRole('group', { name: 'Буквы' }).getByRole('button');
  await expect(letters.first()).toBeEnabled({ timeout: 1000 });
  expect(saves).toBe(0);
  await button(page, 'Пропустить').click();
  await build(page, WORDS[(await meaning(page).textContent())!]);
  await button(page, 'К проверке').click();

  // Handing in waits for every save, then scores all of them.
  await handIn(page);
  await expect(page.getByRole('img', { name: '2 из 3 · 66%' })).toBeVisible({ timeout: 20_000 });
  expect(saves).toBe(3);
});

test('each score says its percent, and the bar shows the pass mark', async ({ page, context, browser }) => {
  const group = await ownerGroup(context, 3);
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}`, { data: { pass_percent: 80 } });
  await context.request.put(`/api/groups/${group.id}/tests/${group.deckId}/open`, { data: { open: true } });
  const anna = await member(browser, group.code, 'Анна');
  const annaPage = await anna.newPage();
  await openDeckTest(annaPage);
  await startTest(annaPage);
  await answerAll(annaPage, ['неудача']);
  await expect(annaPage.getByRole('img', { name: '2 из 3 · 66%' })).toBeVisible();

  await openDeckTest(page);
  const row = page.getByRole('region', { name: 'Не сдали' }).getByRole('listitem');
  await expect(row).toHaveText(['Анна2 из 3 · 66%']);
  // The tick at 80 %, past the end of a 66 % bar.
  const tick = row.locator('i');
  await expect(tick).toHaveAttribute('style', /left: 80%/);
  await anna.close();
});
