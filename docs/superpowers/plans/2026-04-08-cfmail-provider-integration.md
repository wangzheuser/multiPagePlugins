# CFMail Provider Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate CFMail as a new email provider that auto-creates temporary email addresses and polls verification codes via REST API.

**Architecture:** Add cfmail as a new provider type in background.js with early-exit branches in Steps 3/4/7. Sidepanel gains cfmail configuration UI. All logic runs in background service worker via fetch() — no content scripts or browser tabs needed.

**Tech Stack:** Chrome Extension Manifest V3, chrome.storage.session, fetch API, vanilla JavaScript

---

### Task 1: Add cfmail defaults to DEFAULT_STATE

**Files:**
- Modify: `background.js:44-64` (DEFAULT_STATE block)

- [ ] **Step 1: Add cfmail keys to DEFAULT_STATE**

Add these 6 entries to the end of the DEFAULT_STATE object (before the closing `};` at line 64):

```javascript
  cfmailApiHost: '',
  cfmailApiKey: '',
  cfmailDomains: [],
  cfmailDomainIndex: 0,
  cfmailDomainFailures: {},
  cfmailMailbox: null,
```

The existing `mailProvider: '163'` default stays unchanged.

- [ ] **Step 2: Commit**

```bash
git add background.js
git commit -m "feat(cfmail): add cfmail defaults to DEFAULT_STATE"
```

---

### Task 2: Extend resetState() to preserve cfmail config

**Files:**
- Modify: `background.js:109-132` (resetState function)

- [ ] **Step 1: Add cfmail keys to the preserve list**

In `resetState()`, add these to the `chrome.storage.session.get([...])` array (after `'inbucketMailbox',`):

```javascript
    'cfmailApiHost',
    'cfmailDomains',
```

Note: `cfmailDomainFailures` and `cfmailMailbox` are intentionally NOT preserved — they are runtime state that should be cleared on reset.

- [ ] **Step 2: Add cfmail keys to the set() call**

In the `chrome.storage.session.set({...})` call, add after the `inbucketMailbox` line:

```javascript
    cfmailApiHost: prev.cfmailApiHost || '',
    cfmailDomains: prev.cfmailDomains || [],
```

- [ ] **Step 3: Commit**

```bash
git add background.js
git commit -m "feat(cfmail): preserve cfmail config across resetState"
```

---

### Task 3: Extend SAVE_SETTING handler for cfmail keys

**Files:**
- Modify: `background.js:625-633` (SAVE_SETTING message handler)

- [ ] **Step 1: Add cfmail keys to the handler**

After the `inbucketMailbox` line (line 631), add:

```javascript
      if (message.payload.cfmailApiHost !== undefined) updates.cfmailApiHost = message.payload.cfmailApiHost;
      if (message.payload.cfmailApiKey !== undefined) updates.cfmailApiKey = message.payload.cfmailApiKey;
      if (message.payload.cfmailDomains !== undefined) updates.cfmailDomains = message.payload.cfmailDomains;
```

- [ ] **Step 2: Commit**

```bash
git add background.js
git commit -m "feat(cfmail): handle cfmail keys in SAVE_SETTING message"
```

---

### Task 4: Implement cfmail API helper functions in background.js

**Files:**
- Modify: `background.js` — insert new section after the `normalizeInbucketOrigin()` function (~line 1094)

- [ ] **Step 1: Add cfmail API helper functions**

Insert this new section after line 1094 (after the `normalizeInbucketOrigin` function, before the `clickResendOnSignupPage` function):

```javascript
// ============================================================
// CFMail Provider — REST API helpers for mailbox creation & email polling
// ============================================================

const CFMAIL_DEFAULT_API_HOST = 'https://mailapi.wqp.de5.net';
const CFMAIL_JWT_TTL_MS = 30 * 60 * 1000; // 30 minutes safety default
const CFMAIL_DOMAIN_COOLDOWN_MS = 60 * 1000; // 60 seconds circuit breaker cooldown

function getCfmailApiHost(state) {
  return (state.cfmailApiHost || '').trim() || CFMAIL_DEFAULT_API_HOST;
}

function extractCfmailCode(text) {
  // Pattern 1: OpenAI subject line
  const m1 = text.match(/Subject:\s*Your ChatGPT code is\s*(\d{6})/i);
  if (m1) return m1[1];

  // Pattern 2: OpenAI email body
  const m2 = text.match(/Your ChatGPT code is\s*(\d{6})/i);
  if (m2) return m2[1];

  // Pattern 3: Alternative body
  const m3 = text.match(/temporary verification code to continue:\s*(\d{6})/i);
  if (m3) return m3[1];

  // Pattern 4: Generic fallback — last resort, may match any 6-digit number
  const m4 = text.match(/(?<![#&])\b(\d{6})\b/);
  if (m4) return m4[1];

  return null;
}

async function cfmailCreateMailbox(apiHost, apiKey, domain) {
  const local = `oc${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;

  const resp = await fetch(`${apiHost}/admin/new_address`, {
    method: 'POST',
    headers: {
      'x-admin-auth': apiKey,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      enablePrefix: true,
      name: local,
      domain,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    if (resp.status === 401) throw new Error('CFMail API key rejected');
    throw new Error(`CFMail API error (${resp.status}): ${body.slice(0, 200)}`);
  }

  const data = await resp.json();
  if (!data.address || !data.jwt) {
    throw new Error(`CFMail API returned invalid response: missing address or jwt`);
  }

  return { email: data.address, jwt: data.jwt };
}

async function cfmailFetchMails(apiHost, jwt, limit = 10) {
  const resp = await fetch(`${apiHost}/api/mails?limit=${limit}&offset=0`, {
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Accept': 'application/json',
    },
  });

  if (!resp.ok) {
    if (resp.status === 401) throw new Error('CFMail JWT expired or invalid');
    throw new Error(`CFMail fetch error (${resp.status})`);
  }

  const data = await resp.json();
  return Array.isArray(data.results) ? data.results : [];
}
```

- [ ] **Step 2: Commit**

```bash
git add background.js
git commit -m "feat(cfmail): add CFMail API helper functions"
```

---

### Task 5: Implement domain round-robin + circuit breaker

**Files:**
- Modify: `background.js` — append to the cfmail section from Task 4

- [ ] **Step 1: Add domain selection and circuit breaker functions**

Append these functions right after the cfmail helper functions from Task 4:

```javascript
async function getCfmailDomain(state) {
  const domains = Array.isArray(state.cfmailDomains) ? state.cfmailDomains.filter(Boolean) : [];
  if (domains.length === 0) {
    throw new Error('CFMail: no domains configured. Add domains in sidepanel settings.');
  }
  if (domains.length === 1) return domains[0];

  const failures = state.cfmailDomainFailures || {};
  const now = Date.now();
  const index = state.cfmailDomainIndex || 0;

  // Try each domain starting from current index, skip those in cooldown
  for (let i = 0; i < domains.length; i++) {
    const candidateIndex = (index + i) % domains.length;
    const domain = domains[candidateIndex];
    const failureTime = failures[domain];
    if (!failureTime || (now - failureTime) > CFMAIL_DOMAIN_COOLDOWN_MS) {
      return domain;
    }
  }

  // All domains in cooldown — use the one with oldest failure
  let oldestDomain = domains[0];
  let oldestTime = failures[domains[0]] || 0;
  for (const d of domains) {
    const t = failures[d] || 0;
    if (t < oldestTime) {
      oldestTime = t;
      oldestDomain = d;
    }
  }
  await addLog('CFMail: all domains in cooldown, using oldest-failed: ' + oldestDomain, 'warn');
  return oldestDomain;
}

async function recordCfmailDomainFailure(domain) {
  const state = await getState();
  const failures = { ...(state.cfmailDomainFailures || {}), [domain]: Date.now() };
  await setState({ cfmailDomainFailures: failures });
}

async function recordCfmailDomainSuccess(domain) {
  const state = await getState();
  const domains = Array.isArray(state.cfmailDomains) ? state.cfmailDomains.filter(Boolean) : [];
  if (domains.length <= 1) return;

  const failures = { ...(state.cfmailDomainFailures || {}) };
  delete failures[domain]; // Clear failure record on success

  const currentIndex = state.cfmailDomainIndex || 0;
  const nextIndex = (currentIndex + 1) % domains.length;

  await setState({
    cfmailDomainFailures: failures,
    cfmailDomainIndex: nextIndex,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add background.js
git commit -m "feat(cfmail): add domain round-robin and circuit breaker"
```

---

### Task 6: Implement cfmail mailbox creation and JWT management

**Files:**
- Modify: `background.js` — append to cfmail section

- [ ] **Step 1: Add ensureCfmailMailbox function**

Append after the functions from Task 5:

```javascript
async function ensureCfmailMailbox(state) {
  const apiHost = getCfmailApiHost(state);
  const apiKey = (state.cfmailApiKey || '').trim();

  if (!apiKey) {
    throw new Error('CFMail: API key not configured. Set it in sidepanel settings.');
  }

  const existing = state.cfmailMailbox;
  if (existing && existing.jwt && existing.jwtCreatedAt) {
    const age = Date.now() - existing.jwtCreatedAt;
    if (age < CFMAIL_JWT_TTL_MS) {
      // JWT still valid, reuse
      return { email: existing.email, jwt: existing.jwt };
    }
    await addLog('CFMail: JWT expired, creating new mailbox', 'warn');
  }

  const domain = await getCfmailDomain(state);
  const { email, jwt } = await cfmailCreateMailbox(apiHost, apiKey, domain);
  await recordCfmailDomainSuccess(domain);

  await setState({
    email,
    cfmailMailbox: { email, jwt, jwtCreatedAt: Date.now() },
  });
  broadcastDataUpdate({ email });

  await addLog(`CFMail: Created mailbox ${email} on domain ${domain}`, 'ok');
  return { email, jwt };
}
```

- [ ] **Step 2: Commit**

```bash
git add background.js
git commit -m "feat(cfmail): add ensureCfmailMailbox with JWT expiry management"
```

---

### Task 7: Implement cfmail verification code polling

**Files:**
- Modify: `background.js` — append to cfmail section

- [ ] **Step 1: Add pollCfmailCode function**

Append after the functions from Task 6:

```javascript
async function pollCfmailCode(state, step) {
  const maxAttempts = 20;
  const intervalMs = 3000;

  if (!state.cfmailMailbox || !state.cfmailMailbox.jwt) {
    throw new Error('CFMail: no mailbox available. Ensure Step 3 completed successfully.');
  }

  const apiHost = getCfmailApiHost(state);
  const filterAfterTimestamp = step === 7
    ? (state.lastEmailTimestamp || state.flowStartTime || 0)
    : (state.flowStartTime || 0);

  // Track seen message IDs to avoid duplicates
  const seenKey = `cfmailSeenMsgIds_step${step}`;
  let seenMsgIds = new Set();
  try {
    const stored = await chrome.storage.session.get(seenKey);
    if (Array.isArray(stored[seenKey])) {
      seenMsgIds = new Set(stored[seenKey]);
    }
  } catch {}

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await sleepWithStop(intervalMs);

    // Re-read mailbox from state each iteration (in case JWT was refreshed)
    const currentState = await getState();
    const mailbox = currentState.cfmailMailbox;
    if (!mailbox || !mailbox.jwt) {
      throw new Error('CFMail: mailbox disappeared during polling.');
    }

    let messages;
    try {
      messages = await cfmailFetchMails(apiHost, mailbox.jwt);
    } catch (err) {
      if (err.message.includes('JWT expired')) {
        await addLog(`CFMail: JWT expired during Step ${step} polling, recreating mailbox`, 'warn');
        await ensureCfmailMailbox(state);
        continue; // Re-read mailbox on next iteration
      }
      throw err;
    }

    const senderFilters = step === 7
      ? ['openai', 'noreply', 'verify', 'auth', 'chatgpt', 'duckduckgo', 'forward']
      : ['openai', 'noreply', 'verify', 'auth', 'duckduckgo', 'forward'];
    const subjectFilters = step === 7
      ? ['verify', 'verification', 'code', '验证', 'confirm', 'login']
      : ['verify', 'verification', 'code', '验证', 'confirm'];

    for (const msg of messages) {
      const msgId = msg.id || `${msg.createdAt}-${msg.subject}`;
      if (seenMsgIds.has(msgId)) continue;

      // Filter by timestamp
      const msgTime = msg.createdAt ? new Date(msg.createdAt).getTime() : 0;
      if (filterAfterTimestamp && msgTime <= filterAfterTimestamp) continue;

      // Combine text for filtering
      const combinedText = [msg.subject, msg.from, msg.body || ''].filter(Boolean).join(' ');
      const normalized = combinedText.toLowerCase();

      // Sender/subject relevance check
      const senderMatch = senderFilters.some(f => normalized.includes(f.toLowerCase()));
      const subjectMatch = subjectFilters.some(f => normalized.includes(f.toLowerCase()));
      const keywordMatch = /openai|chatgpt|verify|verification|confirm|login|验证码/.test(normalized);

      if (!senderMatch && !subjectMatch && !keywordMatch) continue;

      // Extract code
      const code = extractCfmailCode(combinedText);
      if (!code) continue;

      // Found a valid code
      seenMsgIds.add(msgId);
      try {
        await chrome.storage.session.set({ [seenKey]: [...seenMsgIds] });
      } catch {}

      await addLog(`Step ${step}: CFMail code found: ${code}`, 'ok');
      return { ok: true, code, emailTimestamp: msgTime || Date.now() };
    }

    if (attempt < maxAttempts) {
      await addLog(`Step ${step}: CFMail polling attempt ${attempt}/${maxAttempts}`);
    }
  }

  throw new Error(`No verification email found in CFMail after ${(maxAttempts * intervalMs / 1000).toFixed(0)}s.`);
}
```

- [ ] **Step 2: Commit**

```bash
git add background.js
git commit -m "feat(cfmail): add pollCfmailCode with dedup and timestamp filtering"
```

---

### Task 8: Modify executeStep3 to auto-create cfmail mailbox

**Files:**
- Modify: `background.js:1028-1050` (executeStep3 function — find by searching for `async function executeStep3`)

- [ ] **Step 1: Add cfmail early-exit to executeStep3**

Find the `executeStep3` function. Add the cfmail branch as the **very first** logic, before the existing `if (!state.email)` check:

Change from:
```javascript
async function executeStep3(state) {
  if (!state.email) {
    throw new Error('No email address. Paste email in Side Panel first.');
  }
```

To:
```javascript
async function executeStep3(state) {
  // CFMail provider: auto-create mailbox before filling form
  if (state.mailProvider === 'cfmail') {
    const { email } = await ensureCfmailMailbox(state);
    // ensureCfmailMailbox already sets state.email and broadcasts DATA_UPDATED
    const password = state.customPassword || generatePassword();
    await setPasswordState(password);
    const accounts = state.accounts || [];
    accounts.push({ email, password, createdAt: new Date().toISOString() });
    await setState({ accounts });
    await addLog(`Step 3: CFMail mailbox ${email}, password generated (${password.length} chars)`);
    await sendToContentScript('signup-page', {
      type: 'EXECUTE_STEP',
      step: 3,
      source: 'background',
      payload: { email, password },
    });
    return;
  }

  if (!state.email) {
    throw new Error('No email address. Paste email in Side Panel first.');
  }
```

This ensures CFMail users don't need to manually provide an email — the mailbox is created automatically.

- [ ] **Step 2: Commit**

```bash
git add background.js
git commit -m "feat(cfmail): auto-create mailbox in executeStep3 for cfmail provider"
```

---

### Task 9: Implement executeStep4Or7ViaCfmail and modify Step 4/7

**Files:**
- Modify: `background.js:1114-1177` (executeStep4 function)
- Modify: `background.js:1226-1280` (executeStep7 function, approximate range)

- [ ] **Step 1: Add executeStep4Or7ViaCfmail function**

Append after the pollCfmailCode function from Task 7 (still in the cfmail section):

```javascript
async function executeStep4Or7ViaCfmail(state, step) {
  // Trigger OpenAI to send the verification email
  await clickResendOnSignupPage(step);

  await addLog(`Step ${step}: Polling CFMail for verification code...`);
  const result = await pollCfmailCode(state, step);

  await setState({ lastEmailTimestamp: result.emailTimestamp });
  await addLog(`Step ${step}: Got verification code: ${result.code}`);

  // Fill code into signup page
  const signupTabId = await getTabId('signup-page');
  if (signupTabId) {
    await chrome.tabs.update(signupTabId, { active: true });
    await sendToContentScript('signup-page', {
      type: 'FILL_CODE',
      step,
      source: 'background',
      payload: { code: result.code },
    });
  } else {
    throw new Error('Signup page tab was closed. Cannot fill verification code.');
  }
}
```

- [ ] **Step 2: Modify executeStep4 to add cfmail early-exit**

In `executeStep4()`, add this as the first line of the function body:

Change from:
```javascript
async function executeStep4(state) {
  // Click "重新发送电子邮件" on the signup page before polling
  await clickResendOnSignupPage(4);

  const mail = getMailConfig(state);
```

To:
```javascript
async function executeStep4(state) {
  // CFMail provider: API-based polling, no browser tab needed
  if (state.mailProvider === 'cfmail') {
    return executeStep4Or7ViaCfmail(state, 4);
  }

  // Click "重新发送电子邮件" on the signup page before polling
  await clickResendOnSignupPage(4);

  const mail = getMailConfig(state);
```

- [ ] **Step 3: Modify executeStep7 to add cfmail early-exit**

Similarly, in `executeStep7()`, add as the first line:

Change from:
```javascript
async function executeStep7(state) {
  // Click "重新发送电子邮件" on the auth page before polling
  await clickResendOnSignupPage(7);
```

To:
```javascript
async function executeStep7(state) {
  // CFMail provider: API-based polling, no browser tab needed
  if (state.mailProvider === 'cfmail') {
    return executeStep4Or7ViaCfmail(state, 7);
  }

  // Click "重新发送电子邮件" on the auth page before polling
  await clickResendOnSignupPage(7);
```

- [ ] **Step 4: Commit**

```bash
git add background.js
git commit -m "feat(cfmail): wire cfmail into Steps 4 and 7 with early-exit routing"
```

---

### Task 10: Add cfmail to getMailConfig()

**Files:**
- Modify: `background.js:1056-1080` (getMailConfig function)

- [ ] **Step 1: Add cfmail branch to getMailConfig**

Add this branch before the final `return` (before the QQ Mail fallback return):

```javascript
  if (provider === 'cfmail') {
    return { source: 'cfmail', label: 'CFMail', isApi: true };
  }
```

Insert it after the Inbucket block and before the final `return { source: 'qq-mail', ... }` line.

- [ ] **Step 2: Commit**

```bash
git add background.js
git commit -m "feat(cfmail): add cfmail branch to getMailConfig with isApi flag"
```

---

### Task 11: Add cfmail UI elements to sidepanel.html

**Files:**
- Modify: `sidepanel/sidepanel.html:53-66` (Mail config section)

- [ ] **Step 1: Add CFMail option to mail provider dropdown**

In the `<select id="select-mail-provider">` element, add after the Inbucket option:

```html
          <option value="cfmail">CFMail (API-based)</option>
```

- [ ] **Step 2: Add cfmail configuration rows**

After the Inbucket mailbox row (`id="row-inbucket-mailbox"`), add:

```html
      <div class="data-row" id="row-cfmail-api-host" style="display:none;">
        <span class="data-label">API Host</span>
        <input type="text" id="input-cfmail-api-host" class="data-input" placeholder="https://mailapi.wqp.de5.net" />
      </div>
      <div class="data-row" id="row-cfmail-api-key" style="display:none;">
        <span class="data-label">API Key</span>
        <input type="password" id="input-cfmail-api-key" class="data-input" placeholder="CFMail admin password" />
      </div>
      <div class="data-row" id="row-cfmail-domains" style="display:none;">
        <span class="data-label">Domains</span>
        <textarea id="input-cfmail-domains" class="data-input" rows="2" placeholder="One domain per line (e.g. example.com)&#10;Round-robin + circuit breaker"></textarea>
      </div>
```

- [ ] **Step 3: Commit**

```bash
git add sidepanel/sidepanel.html
git commit -m "feat(cfmail): add cfmail UI elements to sidepanel"
```

---

### Task 12: Add cfmail logic to sidepanel.js

**Files:**
- Modify: `sidepanel/sidepanel.js` — multiple sections

- [ ] **Step 1: Add DOM references at top of file**

After the Inbucket references (around line 32), add:

```javascript
const rowCfmailApiHost = document.getElementById('row-cfmail-api-host');
const inputCfmailApiHost = document.getElementById('input-cfmail-api-host');
const rowCfmailApiKey = document.getElementById('row-cfmail-api-key');
const inputCfmailApiKey = document.getElementById('input-cfmail-api-key');
const rowCfmailDomains = document.getElementById('row-cfmail-domains');
const inputCfmailDomains = document.getElementById('input-cfmail-domains');
```

- [ ] **Step 2: Extend updateMailProviderUI()**

Change from:
```javascript
function updateMailProviderUI() {
  const useInbucket = selectMailProvider.value === 'inbucket';
  rowInbucketHost.style.display = useInbucket ? '' : 'none';
  rowInbucketMailbox.style.display = useInbucket ? '' : 'none';
}
```

To:
```javascript
function updateMailProviderUI() {
  const v = selectMailProvider.value;
  rowInbucketHost.style.display = v === 'inbucket' ? '' : 'none';
  rowInbucketMailbox.style.display = v === 'inbucket' ? '' : 'none';
  rowCfmailApiHost.style.display = v === 'cfmail' ? '' : 'none';
  rowCfmailApiKey.style.display = v === 'cfmail' ? '' : 'none';
  rowCfmailDomains.style.display = v === 'cfmail' ? '' : 'none';
  // Hide DuckDuckGo Auto button in cfmail mode (auto-creates emails)
  btnFetchEmail.style.display = v === 'cfmail' ? 'none' : '';
}
```

- [ ] **Step 3: Extend restoreState()**

After the Inbucket restoration block (after `inputInbucketMailbox.value = state.inbucketMailbox;`), add:

```javascript
    if (state.cfmailApiHost) {
      inputCfmailApiHost.value = state.cfmailApiHost;
    }
    if (state.cfmailApiKey) {
      inputCfmailApiKey.value = state.cfmailApiKey;
    }
    if (Array.isArray(state.cfmailDomains)) {
      inputCfmailDomains.value = state.cfmailDomains.join('\n');
    }
```

- [ ] **Step 4: Add cfmail change event listeners**

After the `inputInbucketHost.addEventListener('change', ...)` block (after line 421), add:

```javascript
inputCfmailApiHost.addEventListener('change', async () => {
  await chrome.runtime.sendMessage({
    type: 'SAVE_SETTING',
    source: 'sidepanel',
    payload: { cfmailApiHost: inputCfmailApiHost.value.trim() },
  });
});

inputCfmailApiKey.addEventListener('change', async () => {
  await chrome.runtime.sendMessage({
    type: 'SAVE_SETTING',
    source: 'sidepanel',
    payload: { cfmailApiKey: inputCfmailApiKey.value.trim() },
  });
});

inputCfmailDomains.addEventListener('change', async () => {
  const domains = inputCfmailDomains.value.trim().split('\n').map(d => d.trim()).filter(Boolean);
  await chrome.runtime.sendMessage({
    type: 'SAVE_SETTING',
    source: 'sidepanel',
    payload: { cfmailDomains: domains },
  });
});
```

- [ ] **Step 5: Clear cfmail API key on provider switch away from cfmail**

In the `selectMailProvider.addEventListener('change', ...)` handler (around line 399-405), modify the callback to clear cfmail credentials when switching away:

Change from:
```javascript
selectMailProvider.addEventListener('change', async () => {
  updateMailProviderUI();
  await chrome.runtime.sendMessage({
    type: 'SAVE_SETTING', source: 'sidepanel',
    payload: { mailProvider: selectMailProvider.value },
  });
});
```

To:
```javascript
selectMailProvider.addEventListener('change', async () => {
  updateMailProviderUI();
  const updates = { mailProvider: selectMailProvider.value };
  // Clear cfmail API key when switching away from cfmail
  if (selectMailProvider.value !== 'cfmail') {
    updates.cfmailApiKey = '';
  }
  await chrome.runtime.sendMessage({
    type: 'SAVE_SETTING', source: 'sidepanel',
    payload: updates,
  });
});
```

- [ ] **Step 6: Commit**

```bash
git add sidepanel/sidepanel.js
git commit -m "feat(cfmail): add cfmail logic to sidepanel.js"
```

---

### Task 13: Regression testing

**Files:**
- No file changes — manual verification only

- [ ] **Step 1: Verify existing providers still work**

Run the following manual checks:
1. Select `163 Mail` provider → run Steps 1-4 → verify email polling works
2. Select `QQ Mail` provider → run Steps 1-4 → verify email polling works
3. Select `Inbucket` provider → run Steps 1-4 → verify email polling works

- [ ] **Step 2: Verify cfmail provider works**

1. Select `CFMail` provider
2. Set API Host (default ok), API Key, and at least one Domain
3. Run Step 3 → verify automatic mailbox creation and email field population
4. Run Step 4 → verify verification code is auto-filled
5. Run full flow through Step 9 → verify end-to-end success

- [ ] **Step 3: Verify reset behavior**

1. Configure cfmail settings → run reset → verify API host and domains are preserved
2. Switch from cfmail to 163 Mail → verify cfmail API key is cleared
3. Verify DuckDuckGo Auto button is hidden in cfmail mode, visible in other modes
