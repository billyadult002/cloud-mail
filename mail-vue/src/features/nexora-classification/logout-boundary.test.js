import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const headerUrl = new URL('../../layout/header/index.vue', import.meta.url);

test('successful logout clears the credential and cached actor before navigation', async () => {
  const source = await readFile(headerUrl, 'utf8');
  const handler = source.match(/function clickLogout\(\) \{([\s\S]*?)\n\}/)?.[1] || '';

  assert.match(handler, /logout\(\)\.then\(\(\) => \{/);
  assert.match(handler, /localStorage\.removeItem\(["']token["']\)/);
  assert.match(handler, /userStore\.\$reset\(\)/);
  assert.match(handler, /router\.replace\(["']\/login["']\)/);
  assert.ok(handler.indexOf('localStorage.removeItem') < handler.indexOf('userStore.$reset()'));
  assert.ok(handler.indexOf('userStore.$reset()') < handler.indexOf("router.replace('/login')"));
});
