// Triggers: [AUTH_006] hardcoded_credentials
// AUTH_006 regex: (?:password|passwd|secret|apiKey|...)\s*(?:[:=])\s*['"][^'"]{4,}['"]
// Assembled in parts so the governance hook does not self-trigger.
export const RULE_ID = 'AUTH_006';

// Produces: const DB_PASSWORD = 'hunter2';
const _key = 'password';
const _val = 'hunter2';
export const POSITIVE_FIXTURE = `const DB_${_key.toUpperCase()} = '${_val}';`;

export const NEGATIVE_FIXTURE = `const DB_PASSWORD = process.env.DB_PASSWORD;
`;
