const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('.gitignore 应忽略本地噪音文件', () => {
  const gitignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
  assert.match(gitignore, /^\.setting\/\s*$/m);
  assert.match(gitignore, /^\.DS_Store\s*$/m);
  assert.match(gitignore, /^\*\.log\s*$/m);
});
