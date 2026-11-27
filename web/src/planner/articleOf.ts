/**
 * A reading link's article id, as the reader takes it. Apart from `links.ts`, so the app's first
 * screen doesn't load Reading's code to open a task's material.
 */
export const articleOf = (ref: string) => ref.replace(/^(library|reading):/, '');
