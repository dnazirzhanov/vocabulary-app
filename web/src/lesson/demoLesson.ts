import type { ChoiceExercise } from './types.ts';

const option = (id: string, label: string) => ({ id, label });

// Demo content until decks come from the backend. Distractors share the
// target's topic so the choice still requires knowing the word.
export const demoLesson: ChoiceExercise[] = [
  {
    id: 'umbrella',
    word: 'umbrella',
    illustration: 'umbrella',
    illustrationAlt: 'An open umbrella with rain falling around it',
    options: [option('hat', 'шляпа'), option('boots', 'резиновые сапоги'), option('umbrella', 'зонт'), option('raincoat', 'плащ')],
    answerId: 'umbrella',
  },
  {
    id: 'kettle',
    word: 'kettle',
    illustration: 'kettle',
    illustrationAlt: 'A kettle with steam rising from its spout',
    options: [option('kettle', 'чайник'), option('pot', 'кастрюля'), option('mug', 'кружка'), option('pan', 'сковорода')],
    answerId: 'kettle',
  },
  {
    id: 'lighthouse',
    word: 'lighthouse',
    illustration: 'lighthouse',
    illustrationAlt: 'A striped tower on a small island shining beams of light',
    options: [option('tower', 'башня'), option('lighthouse', 'маяк'), option('bridge', 'мост'), option('pier', 'причал')],
    answerId: 'lighthouse',
  },
  {
    id: 'backpack',
    word: 'backpack',
    illustration: 'backpack',
    illustrationAlt: 'A bag with a top handle, a flap and a front pocket',
    options: [option('suitcase', 'чемодан'), option('wallet', 'кошелёк'), option('bag', 'сумка'), option('backpack', 'рюкзак')],
    answerId: 'backpack',
  },
  {
    id: 'key',
    word: 'key',
    illustration: 'key',
    illustrationAlt: 'A key with a round bow and notched teeth',
    options: [option('lock', 'замок'), option('key', 'ключ'), option('door', 'дверь'), option('coin', 'монета')],
    answerId: 'key',
  },
];
