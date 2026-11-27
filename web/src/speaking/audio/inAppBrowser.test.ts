import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inAppBrowser } from './inAppBrowser.ts';

// Real browsers' own words for themselves (user agents).
const AGENTS = {
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  chromeIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
  desktopChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
  telegramAndroid:
    'Mozilla/5.0 (Linux; Android 13; SM-A515F Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36 Telegram-Android/10.6.2 (Samsung SM-A515F; Android 13; SDK 33; AVERAGE)',
  instagramAndroid:
    'Mozilla/5.0 (Linux; Android 12; Redmi Note 11 Build/SKQ1.211103.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.163 Mobile Safari/537.36 Instagram 309.1.0.41.113 Android',
  facebookIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.40.97;FBBV/621036531]',
  someIphoneApp:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  someAndroidApp:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36',
};

test('real browsers are not built-in ones', () => {
  for (const name of ['chromeAndroid', 'safariIphone', 'chromeIphone', 'desktopChrome'] as const)
    assert.equal(inAppBrowser(AGENTS[name], false), null, name);
});

test('the browsers built into chat apps are told apart', () => {
  assert.equal(inAppBrowser(AGENTS.telegramAndroid, false), 'telegram');
  assert.equal(inAppBrowser(AGENTS.instagramAndroid, false), 'instagram');
  assert.equal(inAppBrowser(AGENTS.facebookIphone, false), 'facebook');
  assert.equal(inAppBrowser(AGENTS.someIphoneApp, false), 'other');
  assert.equal(inAppBrowser(AGENTS.someAndroidApp, false), 'other');
});

test('our own Android app asks for the microphone itself', () => {
  assert.equal(inAppBrowser(AGENTS.someAndroidApp, true), null);
});
