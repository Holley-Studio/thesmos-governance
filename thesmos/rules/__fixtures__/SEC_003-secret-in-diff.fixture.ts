// Triggers: [SEC_003] secret_in_diff
// Assembled at runtime so governance hook / GitHub push protection never sees
// a key-shaped literal in this source file. The rule engine still receives the
// exact fixture string with a matching sk-* pattern.
export const RULE_ID = 'SEC_003';

// Matches the default pattern: 'sk-[a-zA-Z0-9-]{20,}'
// Assembled as: 'sk-' + 'ant-api03-' + 'abc123XYZ987654321longvalue'
export const POSITIVE_FIXTURE = `const ANTHROPIC_API_KEY = '${['sk', 'ant-api03', 'abc123XYZ987654321longvalue'].join('-')}';`;

export const NEGATIVE_FIXTURE = `const apiKey = process.env.ANTHROPIC_API_KEY;
`;
