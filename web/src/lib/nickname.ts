/**
 * Nicknames for friend groups (ADR 0011). Generated ones need no typing and carry no personal
 * details; a typed one follows the same rules the server enforces.
 */
const ADJECTIVES = [
  'Быстрый',
  'Смелый',
  'Весёлый',
  'Тихий',
  'Мудрый',
  'Ловкий',
  'Добрый',
  'Ранний',
  'Звёздный',
  'Солнечный',
  'Храбрый',
  'Шустрый',
  'Спокойный',
  'Яркий',
  'Северный',
  'Горный',
  'Лесной',
  'Морской',
  'Задорный',
  'Хитрый',
];
// All masculine, so every pair agrees in gender.
const ANIMALS = [
  'Барсук',
  'Ёж',
  'Кот',
  'Лис',
  'Орёл',
  'Волк',
  'Медведь',
  'Заяц',
  'Бобр',
  'Сокол',
  'Тигр',
  'Енот',
  'Дельфин',
  'Пингвин',
  'Филин',
  'Олень',
  'Жираф',
  'Слон',
  'Леопард',
  'Кит',
];

export function suggestNicknames(count: number, random: () => number = Math.random): string[] {
  const picked = new Set<string>();
  while (picked.size < count) {
    const adjective = ADJECTIVES[Math.floor(random() * ADJECTIVES.length)];
    const animal = ANIMALS[Math.floor(random() * ANIMALS.length)];
    picked.add(`${adjective} ${animal}`);
  }
  return [...picked];
}

/** Why a typed nickname would be refused, or null if it is fine. Mirrors the server's rules. */
export function nicknameProblem(raw: string): string | null {
  const nickname = raw.trim().replace(/\s+/g, ' ');
  if (nickname.length < 2) return 'Не короче 2 символов.';
  if (nickname.length > 20) return 'Не длиннее 20 символов.';
  if (!/^[A-Za-zА-Яа-яЁё0-9 -]+$/.test(nickname)) return 'Только буквы, цифры, пробел и дефис.';
  const digits = (nickname.match(/\d/g) ?? []).length;
  if (digits >= 5 || digits === nickname.replace(/[ -]/g, '').length) return 'Имя не может быть номером.';
  if (/https?|www/i.test(nickname)) return 'Без ссылок.';
  return null;
}
