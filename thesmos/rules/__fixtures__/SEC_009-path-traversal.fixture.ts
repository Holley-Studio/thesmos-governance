// Triggers: [SEC_009] path_traversal
// Assembled in parts across multiple variables — no single source line
// contains the complete trigger pattern.
export const RULE_ID = 'SEC_009';

const _fn = 'path.join';
const _arg0 = '__dirname, ';
const _src = 'req.query.file';
export const POSITIVE_FIXTURE = `const file = ${_fn}(${_arg0}${_src});`;

export const NEGATIVE_FIXTURE = `const file = path.join(__dirname, 'static', 'index.html');
`;
