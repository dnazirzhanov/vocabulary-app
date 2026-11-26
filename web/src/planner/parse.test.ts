import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseQuick } from './parse.ts';

const MONDAY = '2026-11-23';
const p = (line: string, ignore: string[] = []) => parseQuick(line, MONDAY, ignore);

test('a daily study task at a time: the title keeps only its words', () => {
  const got = p('Английский каждый день в 21:00');
  assert.equal(got.title, 'Английский');
  assert.equal(got.repeatMask, 127);
  assert.equal(got.startMinute, 21 * 60);
  assert.equal(got.dueOn, MONDAY);
  assert.deepEqual(
    got.found.map((f) => f.kind),
    ['repeat', 'time'],
  );
});

test('days: today, tomorrow, the day after, a weekday ahead', () => {
  assert.equal(p('Купить тетрадь завтра').dueOn, '2026-11-24');
  assert.equal(p('Сдать эссе послезавтра').dueOn, '2026-11-25');
  assert.equal(p('Позвонить сегодня').dueOn, MONDAY);
  assert.equal(p('Тест в пятницу').dueOn, '2026-11-27');
  assert.equal(p('Тест в понедельник').dueOn, MONDAY); // today is Monday
  assert.equal(p('Essay on friday').dueOn, '2026-11-27');
  assert.equal(p('Read tomorrow').title, 'Read');
});

test('times: 24-hour, with a dot, and with a part of the day', () => {
  assert.equal(p('Слова в 7:30').startMinute, 7 * 60 + 30);
  assert.equal(p('Слова 21.15').startMinute, 21 * 60 + 15);
  assert.equal(p('Слова в 9 вечера').startMinute, 21 * 60);
  assert.equal(p('Слова в 9 утра').startMinute, 9 * 60);
  assert.equal(p('Words at 9pm').startMinute, 21 * 60);
  assert.equal(p('Words 12am').startMinute, 0);
});

test('repeats: weekdays, weekends, one weekday', () => {
  assert.equal(p('Школа по будням').repeatMask, 31);
  assert.equal(p('Отдых по выходным').repeatMask, 96);
  const sat = p('Отдых по выходным');
  assert.equal(sat.dueOn, '2026-11-28'); // the first Saturday
  assert.equal(p('Кружок каждую среду в 16:00').repeatMask, 4);
  assert.equal(p('Кружок по средам').repeatMask, 4);
  assert.equal(p('Gym every friday').repeatMask, 16);
  assert.equal(p('Words every day').repeatMask, 127);
  assert.equal(p('Words weekdays').repeatMask, 31);
});

test('words inside other words are left alone', () => {
  const got = p('Приготовить завтрак');
  assert.equal(got.title, 'Приготовить завтрак');
  assert.equal(got.dueOn, null);
  assert.equal(p('Посмотреть «Сегодняшний день»').dueOn, null);
});

test('a part tapped to keep as text stays in the title', () => {
  const got = p('Фильм «Завтра» завтра', ['«Завтра»']);
  assert.equal(got.dueOn, '2026-11-24');
  const kept = p('Читать сегодня', ['сегодня']);
  assert.equal(kept.title, 'Читать сегодня');
  assert.equal(kept.dueOn, null);
});

test('a plain line is just a title', () => {
  const got = p('  Купить   ручку ');
  assert.deepEqual(got, {
    title: 'Купить ручку',
    dueOn: null,
    startMinute: null,
    endMinute: null,
    repeatMask: 0,
    found: [],
  });
});

test('several days: Wednesday and Saturday, in either language', () => {
  const wedSat = 4 | 32;
  assert.equal(p('Бассейн по средам и субботам').repeatMask, wedSat);
  assert.equal(p('Бассейн каждую среду и субботу').repeatMask, wedSat);
  assert.equal(p('Кружок по понедельникам, средам и пятницам').repeatMask, 1 | 4 | 16);
  assert.equal(p('Pool every wednesday and saturday').repeatMask, wedSat);
  const got = p('Бассейн по средам и субботам в 18:00');
  assert.equal(got.title, 'Бассейн');
  assert.equal(got.dueOn, '2026-11-25'); // the first Wednesday
});

test('from a time to a time', () => {
  const a = p('Английский с 19:00 до 20:00');
  assert.deepEqual([a.title, a.startMinute, a.endMinute], ['Английский', 19 * 60, 20 * 60]);
  const b = p('Слова 7:30-8:15');
  assert.deepEqual([b.startMinute, b.endMinute], [7 * 60 + 30, 8 * 60 + 15]);
  const c = p('Чтение с 7 до 8 вечера');
  assert.deepEqual([c.startMinute, c.endMinute], [19 * 60, 20 * 60]);
  const d = p('Words from 7pm to 8pm');
  assert.deepEqual([d.title, d.startMinute, d.endMinute], ['Words', 19 * 60, 20 * 60]);
  // A count is no time: «2-3 слова» stays in the title.
  assert.equal(p('Выучить 2-3 слова').title, 'Выучить 2-3 слова');
});
