// Triggers: [AUTH_004] user_id_from_body
// AUTH_004 path filter: /api|route|handler|controller/i — fixture path must match.
// AUTH_004 regex: (?:const|let|var)\s+\{?[^}]*\buserId\b[^}]*\}?\s*=\s*req\.(?:body|query|params)
export const RULE_ID = 'AUTH_004';

// NOTE: the test harness must use a path containing 'api' or 'route' for this rule.
export const POSITIVE_FIXTURE = `const userId = req.body.userId;
`;

export const NEGATIVE_FIXTURE = `const userId = req.session.userId;
`;

// Hint for the harness: file path should contain 'api' (e.g. fixture-AUTH_004-api.ts).
export const FIXTURE_PATH_HINT = 'api';
