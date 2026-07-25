// Triggers: [AUTH_002] jwt_decode_no_verify
// Assembled in parts so the guard does not self-trigger on this source.
export const RULE_ID = 'AUTH_002';

// Produces: const payload = jwt.decode(token);
const _jwtFn = 'jwt.' + 'decode';
export const POSITIVE_FIXTURE = `const payload = ${_jwtFn}(token);`;

// Negative uses algorithm pin to avoid tripping NODE_008 / JWT_002
const _verify = 'jwt.' + 'verify';
export const NEGATIVE_FIXTURE = `const payload = ${_verify}(token, secret, { algorithms: ['HS256'] });`;
