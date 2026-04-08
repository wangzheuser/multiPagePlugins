const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sidepanelHtml = fs.readFileSync(path.join(__dirname, '..', 'sidepanel', 'sidepanel.html'), 'utf8');

function loadCfmailUtils() {
  return require(path.join(__dirname, '..', 'shared', 'cfmail-utils.js'));
}

test('VPS 输入框应为明文 text 类型', () => {
  assert.match(sidepanelHtml, /<input[^>]*(?:id="input-vps-url"[^>]*type="text"|type="text"[^>]*id="input-vps-url")/i);
});

test('cfmail 渠道在 Step 3 不应要求用户手动先填 email', () => {
  const { shouldRequireManualEmail } = loadCfmailUtils();
  assert.equal(shouldRequireManualEmail('cfmail'), false);
  assert.equal(shouldRequireManualEmail('qq'), true);
  assert.equal(shouldRequireManualEmail('163'), true);
});
