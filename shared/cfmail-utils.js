(function (root, factory) {
  const exported = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }

  root.MultiPageCfmailUtils = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function stringifyValue(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value.trim();

    try {
      return JSON.stringify(value, null, 0);
    } catch {
      return String(value).trim();
    }
  }

  function extractCfmailCode(text) {
    const normalizedText = String(text || '');

    const m1 = normalizedText.match(/Subject:\s*Your ChatGPT code is\s*(\d{6})/i);
    if (m1) return m1[1];

    const m2 = normalizedText.match(/Your ChatGPT code is\s*(\d{6})/i);
    if (m2) return m2[1];

    const m3 = normalizedText.match(/temporary verification code to continue:\s*(\d{6})/i);
    if (m3) return m3[1];

    const m4 = normalizedText.match(/(?<![#&])\b(\d{6})\b/);
    if (m4) return m4[1];

    return null;
  }

  function getCfmailMessageRecipient(message) {
    return stringifyValue(message?.address).toLowerCase();
  }

  function parseCfmailTimestamp(value) {
    if (value == null || value === '') return null;

    if (typeof value === 'number' && Number.isFinite(value)) {
      return value > 10_000_000_000 ? value : value * 1000;
    }

    const text = String(value).trim();
    if (!text) return null;

    if (/^\d+(?:\.\d+)?$/.test(text)) {
      const numeric = Number(text);
      if (!Number.isFinite(numeric) || numeric <= 0) return null;
      return numeric > 10_000_000_000 ? numeric : numeric * 1000;
    }

    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)) {
      const normalized = text.replace(' ', 'T');
      const parsedUtc = Date.parse(`${normalized}Z`);
      return Number.isNaN(parsedUtc) ? null : parsedUtc;
    }

    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? null : parsed;
  }

  function extractCfmailTimestamp(message) {
    const candidates = [
      message?.received_at,
      message?.receivedAt,
      message?.created_at,
      message?.createdAt,
      message?.date,
      message?.timestamp,
    ];

    for (const candidate of candidates) {
      const parsed = parseCfmailTimestamp(candidate);
      if (parsed != null) return parsed;
    }

    return null;
  }

  function isCfmailMessageRecentEnough(message, notBeforeTimestamp) {
    if (!notBeforeTimestamp) return true;

    const parsedTimestamp = extractCfmailTimestamp(message);
    if (parsedTimestamp == null) return true;

    return parsedTimestamp >= (Number(notBeforeTimestamp) - 2000);
  }

  function buildCfmailMessageText(message) {
    return [
      message?.address,
      message?.raw,
      message?.metadata,
      message?.subject,
      message?.from,
      message?.body,
    ]
      .map(stringifyValue)
      .filter(Boolean)
      .join('\n');
  }

  function truncateForLog(text, maxLength = 120) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '-';
    return normalized.length <= maxLength
      ? normalized
      : `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
  }

  function buildCfmailDiagnostics(messages, expectedEmail = '', limit = 2) {
    if (!Array.isArray(messages) || messages.length === 0) {
      return 'mailbox empty';
    }

    const normalizedExpectedEmail = String(expectedEmail || '').trim().toLowerCase();
    const recentMessages = messages.slice(0, Math.max(1, limit));

    const parts = recentMessages.map((message, index) => {
      const recipient = getCfmailMessageRecipient(message) || '-';
      const combinedText = buildCfmailMessageText(message);
      const normalizedText = combinedText.toLowerCase();
      const matchedCode = extractCfmailCode(combinedText);
      const expectedMatch = normalizedExpectedEmail
        ? (recipient === normalizedExpectedEmail ? 'yes' : 'no')
        : 'n/a';
      const openaiMatch = /openai|chatgpt/.test(normalizedText) ? 'yes' : 'no';

      return [
        `#${index + 1}`,
        `recipient=${recipient}`,
        `expected=${expectedMatch}`,
        `openai=${openaiMatch}`,
        `code=${matchedCode ? 'yes' : 'no'}`,
        `preview="${truncateForLog(combinedText)}"`,
      ].join(' ');
    });

    return `mails=${messages.length}; ${parts.join(' | ')}`;
  }

  function shouldRequireManualEmail(provider) {
    return String(provider || '').trim().toLowerCase() !== 'cfmail';
  }

  return {
    buildCfmailDiagnostics,
    buildCfmailMessageText,
    extractCfmailTimestamp,
    extractCfmailCode,
    getCfmailMessageRecipient,
    isCfmailMessageRecentEnough,
    parseCfmailTimestamp,
    shouldRequireManualEmail,
  };
});
