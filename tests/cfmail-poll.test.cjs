const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createChromeStub({ session: initialSession = {}, local: initialLocal = {} } = {}) {
  const session = { ...initialSession };
  const local = { ...initialLocal };

  return {
    session,
    local,
    chrome: {
      storage: {
        local: {
          async get(keys) {
            if (keys == null) return { ...local };
            if (typeof keys === 'string') return { [keys]: local[keys] };
            if (Array.isArray(keys)) {
              return Object.fromEntries(keys.map((key) => [key, local[key]]));
            }
            if (typeof keys === 'object') {
              return Object.fromEntries(
                Object.keys(keys).map((key) => [key, key in local ? local[key] : keys[key]])
              );
            }
            return {};
          },
          async set(updates) {
            Object.assign(local, updates);
          },
          async clear() {
            Object.keys(local).forEach((key) => delete local[key]);
          },
        },
        session: {
          async get(keys) {
            if (keys == null) return { ...session };
            if (typeof keys === 'string') return { [keys]: session[keys] };
            if (Array.isArray(keys)) {
              return Object.fromEntries(keys.map((key) => [key, session[key]]));
            }
            if (typeof keys === 'object') {
              return Object.fromEntries(
                Object.keys(keys).map((key) => [key, key in session ? session[key] : keys[key]])
              );
            }
            return {};
          },
          async set(updates) {
            Object.assign(session, updates);
          },
          async clear() {
            Object.keys(session).forEach((key) => delete session[key]);
          },
          async setAccessLevel() {},
        },
      },
      runtime: {
        onMessage: { addListener() {} },
        sendMessage() {
          return Promise.resolve({ ok: true });
        },
      },
      sidePanel: {
        async setPanelBehavior() {},
      },
      tabs: {
        async get(tabId) {
          return { id: tabId, url: 'https://example.test', active: true, windowId: 1 };
        },
        async sendMessage() {
          return { ok: true };
        },
        async update(tabId, updates = {}) {
          return { id: tabId, ...updates, windowId: 1 };
        },
        async create({ url, active, windowId }) {
          return { id: 99, url, active, windowId };
        },
        onUpdated: {
          addListener() {},
          removeListener() {},
        },
      },
      windows: {
        async get(windowId) {
          return { id: windowId };
        },
        async getLastFocused() {
          return { id: 1 };
        },
      },
      scripting: {
        async executeScript() {},
      },
      webNavigation: {
        onBeforeNavigate: {
          addListener() {},
          removeListener() {},
        },
      },
      debugger: {
        async attach() {},
        async detach() {},
        async sendCommand() {},
      },
    },
  };
}

function loadBackground(options = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
  const { chrome, session, local } = createChromeStub(options);
  const context = {
    console,
    chrome,
    crypto: {
      randomUUID() {
        return '12345678-1234-1234-1234-123456789abc';
      },
    },
    fetch: async () => ({ ok: true, json: async () => ({}), text: async () => '' }),
    setTimeout,
    clearTimeout,
    URL,
  };

  vm.createContext(context);
  context.importScripts = (...scripts) => {
    for (const script of scripts) {
      const scriptPath = path.join(__dirname, '..', script);
      const scriptSource = fs.readFileSync(scriptPath, 'utf8');
      vm.runInContext(scriptSource, context, { filename: script });
    }
  };
  vm.runInContext(source, context, { filename: 'background.js' });
  return { context, session, local };
}

test('pollCfmailCode 能从 cfmail raw/metadata 结构中提取 OpenAI 验证码', async () => {
  const now = Date.now();
  const state = {
    cfmailMailbox: { email: 'oc123@example.com', jwt: 'jwt-token', jwtCreatedAt: now },
    email: 'oc123@example.com',
    cfmailApiHost: 'https://mailapi.example.test',
    flowStartTime: now - 10_000,
    lastEmailTimestamp: null,
  };
  const { context, session } = loadBackground({ session: state });

  const mailMessage = {
    id: 'mail-1',
    createdAt: new Date(now).toISOString(),
    address: 'oc123@example.com',
    raw: 'Subject: Your ChatGPT code is 123456\nFrom: OpenAI <noreply@tm.openai.com>\n\nYour ChatGPT code is 123456',
    metadata: {
      from: { address: 'noreply@tm.openai.com', name: 'OpenAI' },
    },
  };

  context.sleepWithStop = async () => {};
  context.addLog = async () => {};
  context.setState = async (updates) => Object.assign(session, updates);
  context.getState = async () => ({ ...state, ...session });
  context.ensureCfmailMailbox = async () => state.cfmailMailbox;
  context.cfmailFetchMails = async () => [mailMessage];

  const result = await context.pollCfmailCode(state, 4);

  assert.equal(result.ok, true);
  assert.equal(result.code, '123456');
  assert.ok(result.emailTimestamp >= now);
});

test('ensureCfmailMailbox 在首个域名创建失败时会切换到下一个域名', async () => {
  const state = {
    cfmailMailbox: null,
    cfmailApiHost: 'https://mailapi.example.test',
    cfmailApiKey: 'admin-key',
    cfmailDomains: ['bad.example.com', 'good.example.com'],
    cfmailDomainIndex: 0,
    cfmailDomainFailures: {},
  };
  const { context, session } = loadBackground({ session: state });
  const attempts = [];

  context.addLog = async () => {};
  context.getState = async () => ({ ...state, ...session });
  context.setState = async (updates) => Object.assign(session, updates);
  context.cfmailCreateMailbox = async (_apiHost, _apiKey, domain) => {
    attempts.push(domain);
    if (domain === 'bad.example.com') {
      throw new Error('domain unavailable');
    }
    return { email: 'oc999@good.example.com', jwt: 'jwt-good' };
  };

  const mailbox = await context.ensureCfmailMailbox(state);

  assert.deepEqual(attempts, ['bad.example.com', 'good.example.com']);
  assert.equal(mailbox.email, 'oc999@good.example.com');
  assert.equal(session.cfmailDomainFailures['bad.example.com'] > 0, true);
  assert.equal(session.email, 'oc999@good.example.com');
});

test('配置项写入后应持久化到 local，并在新会话恢复，运行态字段不恢复', async () => {
  const { context, local } = loadBackground();

  await context.setState({
    vpsUrl: 'http://127.0.0.1:3000/oauth',
    customPassword: 'custom-pass',
    mailProvider: 'cfmail',
    inbucketHost: 'mail.local',
    inbucketMailbox: 'box1',
    cfmailApiHost: 'https://mailapi.example.test',
    cfmailApiKey: 'cfmail-secret',
    cfmailDomains: ['a.example.com', 'b.example.com'],
    email: 'temp@example.com',
    password: 'runtime-password',
  });

  assert.equal(local.vpsUrl, 'http://127.0.0.1:3000/oauth');
  assert.equal(local.customPassword, 'custom-pass');
  assert.equal(local.mailProvider, 'cfmail');
  assert.equal(local.inbucketHost, 'mail.local');
  assert.equal(local.inbucketMailbox, 'box1');
  assert.equal(local.cfmailApiHost, 'https://mailapi.example.test');
  assert.equal(local.cfmailApiKey, 'cfmail-secret');
  assert.deepEqual(local.cfmailDomains, ['a.example.com', 'b.example.com']);
  assert.equal(local.email, undefined);
  assert.equal(local.password, undefined);

  const reloaded = loadBackground({ local });
  const restoredState = await reloaded.context.getState();

  assert.equal(restoredState.vpsUrl, 'http://127.0.0.1:3000/oauth');
  assert.equal(restoredState.customPassword, 'custom-pass');
  assert.equal(restoredState.mailProvider, 'cfmail');
  assert.equal(restoredState.inbucketHost, 'mail.local');
  assert.equal(restoredState.inbucketMailbox, 'box1');
  assert.equal(restoredState.cfmailApiHost, 'https://mailapi.example.test');
  assert.equal(restoredState.cfmailApiKey, 'cfmail-secret');
  assert.deepEqual(restoredState.cfmailDomains, ['a.example.com', 'b.example.com']);
  assert.equal(restoredState.email, null);
  assert.equal(restoredState.password, null);
});

test('resetState 应保留 local 中的配置，同时清空本次运行态字段', async () => {
  const { context, local } = loadBackground({
    session: {
      email: 'runtime@example.com',
      oauthUrl: 'https://auth.example.test',
      logs: [{ message: 'x', level: 'info', timestamp: Date.now() }],
      stepStatuses: { 1: 'completed' },
    },
    local: {
      vpsUrl: 'http://127.0.0.1:4000/oauth',
      customPassword: 'persisted-pass',
      mailProvider: 'inbucket',
      inbucketHost: 'persist.host',
      inbucketMailbox: 'persist-box',
    },
  });

  await context.resetState();
  const state = await context.getState();

  assert.equal(state.vpsUrl, 'http://127.0.0.1:4000/oauth');
  assert.equal(state.customPassword, 'persisted-pass');
  assert.equal(state.mailProvider, 'inbucket');
  assert.equal(state.inbucketHost, 'persist.host');
  assert.equal(state.inbucketMailbox, 'persist-box');
  assert.equal(state.email, null);
  assert.equal(state.oauthUrl, null);
  assert.equal(Array.isArray(state.logs), true);
  assert.equal(state.logs.length, 0);
  assert.equal(local.vpsUrl, 'http://127.0.0.1:4000/oauth');
});

test('pollCfmailCode 在空邮箱时应输出 mailbox empty 诊断日志', async () => {
  const now = Date.now();
  const state = {
    cfmailMailbox: { email: 'empty@example.com', jwt: 'jwt-token', jwtCreatedAt: now },
    email: 'empty@example.com',
    cfmailApiHost: 'https://mailapi.example.test',
    flowStartTime: now - 10_000,
  };
  const { context, session } = loadBackground({ session: state });
  const logs = [];

  context.sleepWithStop = async () => {};
  context.addLog = async (message, level = 'info') => logs.push({ message, level });
  context.setState = async (updates) => Object.assign(session, updates);
  context.getState = async () => ({ ...state, ...session });
  context.cfmailFetchMails = async () => [];

  await assert.rejects(() => context.pollCfmailCode(state, 4), /No verification email found/);

  assert.equal(
    logs.some((entry) => entry.message.includes('CFMail diagnostics attempt 1/20') && entry.message.includes('mailbox empty')),
    true
  );
});

test('pollCfmailCode 在收到 OpenAI 邮件但无验证码时应输出 openai=yes code=no 诊断日志', async () => {
  const now = Date.now();
  const state = {
    cfmailMailbox: { email: 'nocode@example.com', jwt: 'jwt-token', jwtCreatedAt: now },
    email: 'nocode@example.com',
    cfmailApiHost: 'https://mailapi.example.test',
    flowStartTime: now - 10_000,
  };
  const { context, session } = loadBackground({ session: state });
  const logs = [];

  context.sleepWithStop = async () => {};
  context.addLog = async (message, level = 'info') => logs.push({ message, level });
  context.setState = async (updates) => Object.assign(session, updates);
  context.getState = async () => ({ ...state, ...session });
  context.cfmailFetchMails = async () => [{
    id: 'mail-no-code',
    createdAt: new Date(now).toISOString(),
    address: 'nocode@example.com',
    raw: 'Subject: Welcome to OpenAI\nFrom: OpenAI <noreply@tm.openai.com>\n\nPlease verify your email address to continue.',
    metadata: {
      from: { address: 'noreply@tm.openai.com', name: 'OpenAI' },
    },
  }];

  await assert.rejects(() => context.pollCfmailCode(state, 4), /No verification email found/);

  assert.equal(
    logs.some((entry) =>
      entry.message.includes('CFMail diagnostics attempt 1/20')
      && entry.message.includes('openai=yes')
      && entry.message.includes('code=no')
    ),
    true
  );
});

test('pollCfmailCode 应接受秒级 createdAt 时间戳，不把新邮件误判为旧邮件', async () => {
  const now = Date.now();
  const nowSeconds = Math.floor(now / 1000);
  const state = {
    cfmailMailbox: { email: 'epoch@example.com', jwt: 'jwt-token', jwtCreatedAt: now },
    email: 'epoch@example.com',
    cfmailApiHost: 'https://mailapi.example.test',
    flowStartTime: now - 10_000,
    lastEmailTimestamp: null,
  };
  const { context, session } = loadBackground({ session: state });

  context.sleepWithStop = async () => {};
  context.addLog = async () => {};
  context.setState = async (updates) => Object.assign(session, updates);
  context.getState = async () => ({ ...state, ...session });
  context.cfmailFetchMails = async () => [{
    id: 'mail-seconds',
    createdAt: nowSeconds,
    address: 'epoch@example.com',
    raw: 'Subject: Your ChatGPT code is 654321\nFrom: OpenAI <noreply@tm.openai.com>\n\nYour ChatGPT code is 654321',
    metadata: {
      from: { address: 'noreply@tm.openai.com', name: 'OpenAI' },
    },
  }];

  const result = await context.pollCfmailCode(state, 4);

  assert.equal(result.ok, true);
  assert.equal(result.code, '654321');
  assert.ok(result.emailTimestamp >= state.flowStartTime);
});

test('pollCfmailCode 不应被上一次调用遗留的 seenMsgIds 阻止命中当前验证码邮件', async () => {
  const now = Date.now();
  const state = {
    cfmailMailbox: { email: 'seen@example.com', jwt: 'jwt-token', jwtCreatedAt: now },
    email: 'seen@example.com',
    cfmailApiHost: 'https://mailapi.example.test',
    flowStartTime: now - 10_000,
  };
  const { context, session } = loadBackground({
    session: {
      ...state,
      cfmailSeenMsgIds_step4: ['mail-seen'],
    },
  });

  context.sleepWithStop = async () => {};
  context.addLog = async () => {};
  context.setState = async (updates) => Object.assign(session, updates);
  context.getState = async () => ({ ...state, ...session });
  context.cfmailFetchMails = async () => [{
    id: 'mail-seen',
    createdAt: new Date(now).toISOString(),
    address: 'seen@example.com',
    raw: 'Subject: Your ChatGPT code is 888999\nFrom: OpenAI <noreply@tm.openai.com>\n\nYour ChatGPT code is 888999',
    metadata: {
      from: { address: 'noreply@tm.openai.com', name: 'OpenAI' },
    },
  }];

  const result = await context.pollCfmailCode(state, 4);

  assert.equal(result.ok, true);
  assert.equal(result.code, '888999');
});

test('pollCfmailCode 应把无时区 datetime 字符串按 UTC 解析，避免 8 小时偏移导致 recent=no', async () => {
  const flowStartTime = Date.parse('2026-04-08T09:05:41.976Z');
  const state = {
    cfmailMailbox: { email: 'naive-utc@example.com', jwt: 'jwt-token', jwtCreatedAt: flowStartTime },
    email: 'naive-utc@example.com',
    cfmailApiHost: 'https://mailapi.example.test',
    flowStartTime,
  };
  const { context, session } = loadBackground({ session: state });

  context.sleepWithStop = async () => {};
  context.addLog = async () => {};
  context.setState = async (updates) => Object.assign(session, updates);
  context.getState = async () => ({ ...state, ...session });
  context.cfmailFetchMails = async () => [{
    id: 'mail-naive-utc',
    createdAt: '2026-04-08 09:06:14',
    address: 'naive-utc@example.com',
    raw: 'Subject: Your ChatGPT code is 112233\nFrom: OpenAI <noreply@tm.openai.com>\n\nYour ChatGPT code is 112233',
    metadata: {
      from: { address: 'noreply@tm.openai.com', name: 'OpenAI' },
    },
  }];

  const result = await context.pollCfmailCode(state, 4);

  assert.equal(result.ok, true);
  assert.equal(result.code, '112233');
  assert.equal(new Date(result.emailTimestamp).toISOString(), '2026-04-08T09:06:14.000Z');
});
