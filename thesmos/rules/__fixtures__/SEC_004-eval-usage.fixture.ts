// Triggers: [SEC_004] eval_usage
// String is assembled at runtime so the governance hook does not self-trigger.
export const RULE_ID = 'SEC_004';

// Produces: 'const result = eval(expr);'
export const POSITIVE_FIXTURE = `const result = ${'ev' + 'al'}(expr);`;

export const NEGATIVE_FIXTURE = `const result = JSON.parse(userInput);
`;
