// Triggers: [SEC_016] shell_injection
// Assembled in parts so the guard does not self-trigger on this source.
export const RULE_ID = 'SEC_016';

// SEC_016 regex: \bexec(?:Sync|File)?\s*\(\s*`[^`]*\$\{
// Produces: exec(`ls ${userInput}`)
const _fn = 'exec';
const _interp = String.fromCharCode(36, 123) + 'userInput' + String.fromCharCode(125);
// Produces: exec(`ls ${userInput}`);
export const POSITIVE_FIXTURE = [
  _fn + '(',
  String.fromCharCode(96), // opening backtick
  'ls ',
  _interp,
  String.fromCharCode(96), // closing backtick
  ');',
].join('');

export const NEGATIVE_FIXTURE = `execFile('ls', ['-la']);
`;
