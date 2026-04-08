# CFMail Provider Integration Design

**Date:** 2026-04-08
**Author:** wangqiupei
**Status:** Draft

## Overview

Integrate CFMail (a self-hosted Cloudflare Email Worker API) as a new email provider channel in the multiPagePlugins Chrome extension. CFMail enables fully automated email registration without DuckDuckGo or manual mailbox input.

### Problem

Current email providers (163, QQ, Inbucket) require users to manually provide email addresses or use DuckDuckGo for temporary addresses. CFMail can both create temporary email addresses AND receive verification codes through its REST API, enabling a fully automated "zero-touch" registration flow.

### Goals

1. CFMail mode auto-creates temporary email addresses during Step 3 (no DuckDuckGo needed)
2. Verification codes for Steps 4 and 7 are polled via CFMail REST API
3. Multi-domain round-robin with circuit breaker support
4. Full backward compatibility — existing 163/QQ/Inbucket providers unchanged

## Architecture

### CFMail API Endpoints

Base URL configurable via `cfmailApiHost` in sidepanel (default: `https://mailapi.wqp.de5.net`).

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/admin/new_address` | POST | Create temporary mailbox |
| `/api/mails` | GET | Fetch emails for a mailbox |

**Create Mailbox Request:**
```
POST /admin/new_address
Headers: x-admin-auth: {apiKey}, Content-Type: application/json
Body: { "enablePrefix": true, "name": "oc{10hex}", "domain": "yourdomain" }
Response: { "address": "oc{10hex}@{domain}", "jwt": "..." }
```

**Fetch Mails Request:**
```
GET /api/mails?limit=10&offset=0
Headers: Authorization: Bearer {jwt}
Response: { "results": [{ id, createdAt, subject, from, body, ... }] }
```

### State Management

New keys in `chrome.storage.session`:

| Key | Type | Purpose |
|-----|------|---------|
| `cfmailMailbox` | `{ email, jwt, jwtCreatedAt }` | Current temporary mailbox (with JWT expiry tracking) |
| `cfmailApiKey` | `string` | CFMail admin password (cleared when switching away from cfmail provider) |
| `cfmailApiHost` | `string` | CFMail API base URL (default: `https://mailapi.wqp.de5.net`) |
| `cfmailDomains` | `string[]` | Available domains for round-robin |
| `cfmailDomainIndex` | `number` | Current round-robin index (reset to 0 on state reset) |
| `cfmailDomainFailures` | `{ [domain]: timestamp }` | Circuit breaker failure records (cleared on reset) |

### Module 1: background.js Changes

#### 1.1 New Functions

```
getCfmailApiHost(state): string
cfmailCreateMailbox(apiKey, domain): Promise<{ email, jwt }>
cfmailFetchMails(jwt, limit): Promise<MailMessage[]>
extractCfmailCode(text): string | null
getCfmailDomain(state): string
recordCfmailDomainFailure(domain): void
recordCfmailDomainSuccess(domain): void
ensureCfmailMailbox(state): Promise<{ email, jwt }>  // checks JWT expiry, re-creates if needed
pollCfmailCode(state, step): Promise<{ code, emailTimestamp }>
executeStep4Or7ViaCfmail(state, step): Promise<void>
```

#### 1.2 getMailConfig() Addition

```javascript
if (provider === 'cfmail') {
  return { source: 'cfmail', label: 'CFMail', isApi: true };
}
```

The `isApi: true` flag signals Steps 4/7 to skip browser tab creation and content script injection.

#### 1.3 Step 3 Modification

When `state.mailProvider === 'cfmail'`, Step 3 auto-creates a CFMail mailbox before filling the registration form:

1. Select domain via round-robin + circuit breaker
2. Call `cfmailCreateMailbox()` to get `{email, jwt}`
3. Save `email` as `state.email` and `state.cfmailMailbox` (including `jwtCreatedAt: Date.now()`)
4. Broadcast `DATA_UPDATED` to sync email to sidepanel

The `ensureCfmailMailbox(state)` helper checks if the existing JWT is still valid (JWT age < 30 minutes; if unknown expiry, assume 30 min as safe default). If expired or missing, it re-creates the mailbox and updates state.

#### 1.4 Step 4/7 Modification

Add cfmail branch at the top of `executeStep4()` and `executeStep7()`:

```javascript
if (state.mailProvider === 'cfmail') {
  return executeStep4Or7ViaCfmail(state, step);
}
```

The shared `executeStep4Or7ViaCfmail()` function:
1. **Calls `clickResendOnSignupPage(step)`** — triggers OpenAI to send the verification email (same as existing providers)
2. Calls `pollCfmailCode(state, step)` — retries up to 20 times with 3s intervals
3. On success: fills code into signup-page tab via `FILL_CODE` message
4. Updates `lastEmailTimestamp` state

#### 1.5 Verification Code Extraction

Uses 4 regex patterns from the cfmail provider (more precise than current 3):

1. `Subject:\s*Your ChatGPT code is\s*(\d{6})` — OpenAI subject line
2. `Your ChatGPT code is\s*(\d{6})` — OpenAI email body
3. `temporary verification code to continue:\s*(\d{6})` — Alternative body
4. `(?<![#&])\b(\d{6})\b` — Generic fallback (6-digit code). **Risk:** may match any 6-digit number in email body (dates, IDs, etc.). Strictly ordered as last resort — more specific patterns (1-3) are tried first. Consistent with existing Inbucket provider's fallback approach.

#### 1.6 Domain Round-Robin + Circuit Breaker

Lightweight implementation (no external dependencies):

- **Round-robin:** `cfmailDomainIndex` increments modulo domain count per mailbox creation
- **Circuit breaker:** `cfmailDomainFailures` maps domain → failure timestamp; domains with failures within cooldown (60s) are skipped
- **Fallback:** If all domains are failing, use the one with the oldest failure timestamp

### Module 2: Sidepanel UI Changes

#### 2.1 HTML Additions (sidepanel.html)

- Add `<option value="cfmail">CFMail (API-based)</option>` to `#select-mail-provider`
- Add `#row-cfmail-api-key`: password input for CFMail admin password
- Add `#row-cfmail-domains`: textarea for domain list (one per line)

#### 2.2 JavaScript Additions (sidepanel.js)

- `updateMailProviderUI()` extended to:
  - Show/hide cfmail config rows when `cfmail` selected
  - Hide DuckDuckGo "Auto" button when `cfmail` selected (cfmail auto-creates emails in Step 3)
- `restoreState()` extended to restore `cfmailApiHost`, `cfmailApiKey`, and `cfmailDomains`
- Three new `change` event listeners to save cfmail config on user input (`cfmailApiHost`, `cfmailApiKey`, `cfmailDomains`)
- Provider change handler: when switching away from `cfmail`, send `SAVE_SETTING` with `cfmailApiKey: ''` to clear credential from session storage

#### 2.3 DuckDuckGo Auto Button

In cfmail mode, the "Auto" button (DuckDuckGo email fetch) is hidden since cfmail handles email creation automatically.

### Module 3: Backward Compatibility

| Component | Compatibility Strategy |
|-----------|----------------------|
| Existing providers (163/QQ/Inbucket) | Zero code changes — early-exit in Step 4/7 before reaching existing logic |
| State storage | All new keys use `cfmail` prefix, no key collision |
| Default behavior | `mailProvider` defaults to `'163'`, unchanged |
| manifest.json | No changes needed — `<all_urls>` already covers CFMail API |
| Content scripts | No new content scripts needed |
| `resetState()` | Preserves `cfmailApiHost` and `cfmailDomains` (same as inbucketHost/inbucketMailbox); clears `cfmailDomainFailures` and `cfmailMailbox` |
| `SAVE_SETTING` handler | Extended to handle `cfmailApiHost`, `cfmailApiKey`, `cfmailDomains` |
| `DEFAULT_STATE` | New entries: `cfmailApiHost: ''`, `cfmailApiKey: ''`, `cfmailDomains: []`, `cfmailDomainIndex: 0`, `cfmailDomainFailures: {}`, `cfmailMailbox: null` |

## Data Flow

```
Step 3: cfmailCreateMailbox() → state.email + state.cfmailMailbox
              ↓
Step 4: pollCfmailCode() → extract code → FILL_CODE → signup-page
              ↓
Step 7: pollCfmailCode() → extract code → FILL_CODE → signup-page
```

## Error Handling

| Scenario | Response |
|----------|----------|
| CFMail API unreachable | Throw error with message, log with `warn` level |
| Invalid api_key (401) | Throw error: "CFMail API key rejected" |
| No matching email after 60s | Throw error: "No verification email found in CFMail" |
| All domains failing | Use oldest-failed domain, log warning |
| Signup page closed during code fill | Throw error with clear message |
| JWT expired during Step 7 | Re-create mailbox via `ensureCfmailMailbox()`, continue polling |
| CFMail mailbox not found (deleted) | Re-create mailbox and update `state.email` |

## Testing Strategy

1. **Manual testing:** Select CFMail provider, run full 9-step flow, verify end-to-end
2. **Unit testing:** Test `extractCfmailCode()` with various email body formats
3. **Integration testing:** Verify domain round-robin and circuit breaker with multiple domains
4. **Regression testing:** Run existing 163/QQ/Inbucket flows to confirm no breakage
