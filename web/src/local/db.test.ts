import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  accountDbName,
  accountFor,
  forgetAccount,
  LOCAL_VERSION,
  openAccountDb,
  readSnapshot,
  rememberAccount,
  saveSnapshot,
} from './db.ts';

test("each account's screens are kept apart, under its own id", async () => {
  await rememberAccount('subject-a', 'account-a');
  await rememberAccount('subject-b', 'account-b');
  const a = await openAccountDb('account-a');
  const b = await openAccountDb('account-b');
  await saveSnapshot(a, 'library', { mine: ['A'] });
  assert.deepEqual((await readSnapshot(a, 'library'))?.value, { mine: ['A'] });
  assert.equal(await readSnapshot(b, 'library'), null);
  assert.equal(a.name, accountDbName('account-a'));
  assert.equal(a.version, LOCAL_VERSION);
  a.close();
  b.close();
});

test('a sign-in finds its account offline, and only its own', async () => {
  await rememberAccount('subject-c', 'account-c');
  assert.equal(await accountFor('subject-c'), 'account-c');
  assert.equal(await accountFor('never-seen'), null);
  // Seen again as another account (the server said so): the new one wins.
  await rememberAccount('subject-c', 'account-c2');
  assert.equal(await accountFor('subject-c'), 'account-c2');
});

test('a deleted account leaves nothing on the device', async () => {
  await rememberAccount('subject-d', 'account-d');
  const d = await openAccountDb('account-d');
  await saveSnapshot(d, 'me', { name: 'Анна' });
  d.close();
  await forgetAccount('subject-d', 'account-d');
  assert.equal(await accountFor('subject-d'), null);
  const reopened = await openAccountDb('account-d');
  assert.equal(await readSnapshot(reopened, 'me'), null);
  reopened.close();
});
