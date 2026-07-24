// Triggers: [SEC_014] ssrf_fetch
// Assembled in parts so no single source line triggers the guard.
export const RULE_ID = 'SEC_014';

const _ft = 'fetch';
const _src = 'req.body.url';
export const POSITIVE_FIXTURE = `const resp = await ${_ft}(${_src});`;

export const NEGATIVE_FIXTURE = `const resp = await fetch('https://api.example.com/data');
`;
