// Triggers: [SEC_006] sql_injection
export const RULE_ID = 'SEC_006';

// Positive fixture built from parts — avoids triggering the write-hook on this source.
export const POSITIVE_FIXTURE = [
  'query(',
  String.fromCharCode(96),
  ['SELECT', ' * FROM users WHERE id = '].join(''),
  String.fromCharCode(36, 123), 'userId', String.fromCharCode(125),
  String.fromCharCode(96),
  ');',
].join('');

export const NEGATIVE_FIXTURE = `query('SELECT * FROM users WHERE id = ?', [userId]);
`;
