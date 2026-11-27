/**
 * Whether the page is shown by an app's built-in browser (Telegram, Instagram, …), told by the
 * browser's own name for itself. No imports: a pure function, tested under Node.
 */
export type InApp = 'telegram' | 'instagram' | 'facebook' | 'whatsapp' | 'other';

/** The app whose built-in browser this is, or null in a real browser (or in our own app). */
export function inAppBrowser(agent: string, ownApp: boolean): InApp | null {
  if (ownApp) return null;
  if (/Telegram/i.test(agent)) return 'telegram';
  if (/Instagram/.test(agent)) return 'instagram';
  if (/FBAN|FBAV|FB_IAB|FBIOS/.test(agent)) return 'facebook';
  if (/WhatsApp/i.test(agent)) return 'whatsapp';
  if (/Line\/|VKAndroidApp|vkclient|Snapchat|TikTok|musical_ly|BytedanceWebview|MicroMessenger/i.test(agent))
    return 'other';
  // Android's built-in browser view marks itself «; wv)».
  if (/Android/.test(agent) && /; wv\)/.test(agent)) return 'other';
  // On iPhone, Safari and the other browsers name themselves; an app's view doesn't.
  if (/iPhone|iPad|iPod/.test(agent) && !/Safari\/|CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser/.test(agent)) return 'other';
  return null;
}
