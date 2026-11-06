/** Text as search compares it: case and «ё» don't count, so "еще" finds "ещё". */
export const foldText = (text: string) => text.toLowerCase().replaceAll('ё', 'е');
