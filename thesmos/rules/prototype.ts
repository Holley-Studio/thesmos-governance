// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Prototype Pollution Rules — PROTO_001–010
 *
 * Prototype pollution allows attackers to modify Object.prototype, affecting
 * all objects in the JavaScript runtime. AI coding assistants consistently
 * generate recursive merge helpers and object manipulation utilities without
 * the key guards that prevent this attack class.
 */

import type { ThesmosRule, DetectInput, Finding } from '../types.js';
import { SOURCE_EXT, isTestPath, isCommentLine } from './helpers.js';

export const PROTOTYPE_RULES: ThesmosRule[] = [
  {
    id: 'PROTO_001',
    category: 'prototype_pollution_recursive_merge',
    severity: 'BLOCKER',
    description: 'Recursive object merge without __proto__/constructor/prototype key guard — prototype pollution.',
    tags: ['security', 'prototype-pollution', 'ai-risk'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Recursive merge functions that assign properties from user input without checking for __proto__, constructor, or prototype keys allow an attacker to set Object.prototype.__defineGetter__ or similar properties. This affects all objects in the process, enabling privilege escalation and RCE in some frameworks.',
      commonViolations: [
        'function merge(target, source) { for (const key in source) { if (typeof source[key] === "object") merge(target[key], source[key]); else target[key] = source[key]; } }',
        'deepMerge helper that recursively assigns without key validation',
      ],
      goodExample: 'function merge(target, source) {\n  for (const key in source) {\n    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;\n    if (Object.prototype.hasOwnProperty.call(source, key)) {\n      if (typeof source[key] === "object") merge(target[key], source[key]);\n      else target[key] = source[key];\n    }\n  }\n}',
      badExample: 'function deepMerge(a, b) { for (const k in b) { if (typeof b[k] === "object") deepMerge(a[k], b[k]); else a[k] = b[k]; } }  // ❌ pollution',
      relatedPlaybooks: ['prototype-pollution.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      // Recursive function that merges objects with `for...in` or `Object.keys`
      const RECURSIVE_MERGE_RE = /function\s+\w*(?:merge|deep|extend|assign|clone)\w*[^{]*\{[\s\S]{0,300}?(?:for\s*\(|Object\.keys)[\s\S]{0,200}?(?:\w+\[k(?:ey)?\]\s*=|\w+\.\w+\s*=)/;
      const PROTO_GUARD_RE = /__proto__|constructor.*prototype|hasOwnProperty|Object\.create\s*\(\s*null\)/;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (!RECURSIVE_MERGE_RE.test(content)) continue;
        if (!PROTO_GUARD_RE.test(content)) {
          findings.push({
            severity: 'BLOCKER', category: 'prototype_pollution_recursive_merge',
            file: path,
            message: 'Recursive merge function without prototype key guard — prototype pollution risk.',
            suggestion: 'Skip __proto__, constructor, and prototype keys: if (key === "__proto__") continue;',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'PROTO_002',
    category: 'prototype_pollution_for_in_assign',
    severity: 'HIGH',
    description: 'for...in loop over user-supplied object assigns properties to target without key sanitization.',
    tags: ['security', 'prototype-pollution', 'ai-risk'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'for...in iterates over inherited properties. When applied to user-controlled input, an attacker can send {"__proto__": {"isAdmin": true}} and the loop assigns it to the target object\'s prototype, affecting every object created afterward.',
      commonViolations: [
        'for (const key in userInput) { config[key] = userInput[key]; }',
        'for (const k in req.body) { options[k] = req.body[k]; }',
      ],
      goodExample: 'for (const key of Object.keys(userInput)) {\n  if (!ALLOWED_KEYS.has(key)) continue;\n  config[key] = userInput[key];\n}',
      badExample: 'for (const key in req.body) { config[key] = req.body[key]; }  // ❌ pollution via __proto__',
      relatedPlaybooks: ['prototype-pollution.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const FOR_IN_USER_RE = /for\s*\(\s*(?:const|let|var)\s+k(?:ey)?\s+in\s+(?:req\.|body\.|params\.|userInput|userData|input\b)/i;
      const GUARD_RE = /hasOwnProperty|__proto__|ALLOWED_KEYS|Object\.keys\s*\(/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!FOR_IN_USER_RE.test(lines[i]!)) continue;
          const ctx = lines.slice(i, Math.min(lines.length, i + 6)).join('\n');
          if (!GUARD_RE.test(ctx)) {
            findings.push({
              severity: 'HIGH', category: 'prototype_pollution_for_in_assign',
              file: path, line: i + 1,
              message: 'for...in over user input assigns to target without key guard — prototype pollution.',
              suggestion: 'Use Object.keys() and validate against an allowlist. Skip __proto__ and constructor.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PROTO_003',
    category: 'prototype_pollution_lodash_merge',
    severity: 'HIGH',
    description: 'lodash.merge() called with unvalidated user input — known prototype pollution CVEs.',
    tags: ['security', 'prototype-pollution', 'lodash'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'lodash.merge() had multiple prototype pollution CVEs (CVE-2018-3721, CVE-2019-10744). While patched in newer versions, it must not be called with unvalidated user input. The safe alternative is lodash.mergeWith() with a key guard, or structuredClone().',
      commonViolations: [
        '_.merge({}, req.body)',
        'merge(defaults, userConfig)',
      ],
      goodExample: '// Use structuredClone for deep copy, or validate input first\nconst safe = UserConfigSchema.parse(req.body);\nconst merged = _.merge({}, defaults, safe);',
      badExample: 'const config = _.merge({}, defaults, req.body); // ❌ user controls merge target',
      relatedPlaybooks: ['prototype-pollution.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const LODASH_MERGE_RE = /(?:_|lodash)\s*\.\s*merge\s*\(\s*(?:\{\}|defaults|config|options)\s*,\s*(?:req\.|body\.|params\.|userInput|userData|input\.)/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (isCommentLine(lines[i]!)) continue;
          if (LODASH_MERGE_RE.test(lines[i]!)) {
            findings.push({
              severity: 'HIGH', category: 'prototype_pollution_lodash_merge',
              file: path, line: i + 1,
              message: 'lodash.merge() with unvalidated user input — prototype pollution risk.',
              suggestion: 'Validate user input with a Zod schema before merging: const safe = Schema.parse(input);',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PROTO_004',
    category: 'prototype_pollution_defaults_deep',
    severity: 'HIGH',
    description: 'lodash.defaultsDeep() with user input — recursive merge prototype pollution.',
    tags: ['security', 'prototype-pollution', 'lodash'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'defaultsDeep() performs a recursive merge like _.merge(). When applied to user-supplied input, the same prototype pollution path exists. CVE-2019-10744 specifically covers defaultsDeep().',
      commonViolations: [
        '_.defaultsDeep({}, req.body)',
        'defaultsDeep(options, userSettings)',
      ],
      goodExample: 'const validated = SettingsSchema.parse(req.body);\nconst options = _.defaultsDeep({}, systemDefaults, validated);',
      badExample: '_.defaultsDeep({}, req.body, systemDefaults); // ❌ user input as merge source',
      relatedPlaybooks: ['prototype-pollution.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const DEFAULTS_DEEP_RE = /(?:_|lodash)\s*\.\s*defaultsDeep\s*\([^)]*(?:req\.|body\.|userInput|userData|params\.)/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (isCommentLine(lines[i]!)) continue;
          if (DEFAULTS_DEEP_RE.test(lines[i]!)) {
            findings.push({
              severity: 'HIGH', category: 'prototype_pollution_defaults_deep',
              file: path, line: i + 1,
              message: 'lodash.defaultsDeep() with user input — CVE-2019-10744 pattern.',
              suggestion: 'Validate user input with a schema before passing to defaultsDeep.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PROTO_005',
    category: 'prototype_pollution_json_parse_assign',
    severity: 'HIGH',
    description: 'JSON.parse() result used as source in Object.assign without sanitization.',
    tags: ['security', 'prototype-pollution', 'ai-risk'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'JSON.parse(\'{"__proto__": {"isAdmin": true}}\') creates an object whose [[Prototype]] property is a plain property named "__proto__". When passed to Object.assign({}, parsed), it copies the __proto__ property to the target — polluting the prototype chain in Node.js < v16 and some edge cases.',
      commonViolations: [
        'Object.assign({}, JSON.parse(req.body.config))',
        'Object.assign(target, JSON.parse(userJson))',
      ],
      goodExample: 'const parsed = ConfigSchema.parse(JSON.parse(req.body.config));\nconst result = Object.assign({}, parsed);',
      badExample: 'Object.assign(target, JSON.parse(req.body.settings)); // ❌ __proto__ key risk',
      relatedPlaybooks: ['prototype-pollution.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const JSON_ASSIGN_RE = /Object\.assign\s*\([^)]*JSON\.parse\s*\(\s*(?:req\.|body\.|params\.|userInput|userData|input\.)/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (isCommentLine(lines[i]!)) continue;
          if (JSON_ASSIGN_RE.test(lines[i]!)) {
            findings.push({
              severity: 'HIGH', category: 'prototype_pollution_json_parse_assign',
              file: path, line: i + 1,
              message: 'Object.assign with JSON.parse(userInput) — __proto__ key pollution risk.',
              suggestion: 'Validate the parsed JSON with a schema before use: Schema.parse(JSON.parse(input))',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PROTO_006',
    category: 'prototype_pollution_qs_parse',
    severity: 'MEDIUM',
    description: 'qs.parse() with user input and allowDots not disabled — nested object prototype pollution.',
    tags: ['security', 'prototype-pollution', 'query-string'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'qs.parse() with allowDots: true (the default in some versions) allows parsing "a.__proto__.isAdmin=true" from a query string. This is a documented prototype pollution vector via query string parsing.',
      commonViolations: [
        'qs.parse(req.query)  // default allowDots may be true',
        'qs.parse(queryString, { allowDots: true })',
      ],
      goodExample: 'qs.parse(req.query, { allowDots: false, allowPrototypes: false })',
      badExample: 'qs.parse(req.query)  // ❌ allowDots default varies by qs version',
      relatedPlaybooks: ['prototype-pollution.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const QS_PARSE_RE = /qs\s*\.\s*parse\s*\(\s*(?:req\.|query\.|search|queryString|urlSearchParams)/i;
      const SAFE_RE = /allowPrototypes\s*:\s*false|allowDots\s*:\s*false/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!QS_PARSE_RE.test(lines[i]!)) continue;
          const ctx = lines[i]!;
          if (!SAFE_RE.test(ctx)) {
            findings.push({
              severity: 'MEDIUM', category: 'prototype_pollution_qs_parse',
              file: path, line: i + 1,
              message: 'qs.parse() without allowPrototypes: false — query string prototype pollution risk.',
              suggestion: 'Use qs.parse(input, { allowPrototypes: false, allowDots: false })',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PROTO_007',
    category: 'prototype_pollution_null_prototype_missing',
    severity: 'MEDIUM',
    description: 'Object used as a hash map without Object.create(null) — inherits prototype properties.',
    tags: ['security', 'prototype-pollution', 'best-practice'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Using {} as a hash map includes inherited Object.prototype properties (hasOwnProperty, toString, valueOf). If user input includes a key like "hasOwnProperty", it shadows the inherited method and can cause unexpected behavior or allow pollution via property assignment.',
      commonViolations: [
        'const cache = {};  cache[userKey] = value;  // userKey could be "__proto__"',
        'const lookup = {};  for (const key of keys) { lookup[key] = true; }',
      ],
      goodExample: 'const cache = Object.create(null);  // no prototype — safe hash map\ncache[userKey] = value;',
      badExample: 'const lookup = {};  lookup[userInput] = true;  // ❌ userInput could be __proto__',
      relatedPlaybooks: ['prototype-pollution.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const HASH_MAP_RE = /const\s+\w+\s*=\s*\{\s*\}\s*;[^\n]*\n(?:[^\n]*\n){0,5}[^\n]*\w+\s*\[\s*(?:req\.|body\.|userInput|params\.|userData|key\b|name\b)/i;
      const NULL_PROTO_RE = /Object\.create\s*\(\s*null\s*\)|new\s+Map\s*\(/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (HASH_MAP_RE.test(content) && !NULL_PROTO_RE.test(content)) {
          findings.push({
            severity: 'MEDIUM', category: 'prototype_pollution_null_prototype_missing',
            file: path,
            message: 'Plain {} used as hash map with user-controlled keys — use Object.create(null) or Map.',
            suggestion: 'const cache = Object.create(null); // null prototype prevents pollution',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'PROTO_008',
    category: 'prototype_pollution_express_body_deep',
    severity: 'HIGH',
    description: 'Express body-parser with extended: true parses deeply nested objects from user input — pollution vector.',
    tags: ['security', 'prototype-pollution', 'express'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'express.urlencoded({ extended: true }) uses the qs library to parse the request body, which supports deeply nested objects via bracket notation: a[__proto__][isAdmin]=1. This is a well-documented prototype pollution vector in Express applications.',
      commonViolations: [
        'app.use(express.urlencoded({ extended: true }))',
        'app.use(bodyParser.urlencoded({ extended: true }))',
      ],
      goodExample: 'app.use(express.urlencoded({ extended: false }));  // uses querystring — no deep nesting',
      badExample: 'app.use(express.urlencoded({ extended: true }));  // ❌ deep parse via qs',
      relatedPlaybooks: ['prototype-pollution.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const EXTENDED_TRUE_RE = /(?:express|bodyParser)\s*\.\s*urlencoded\s*\(\s*\{[^}]*extended\s*:\s*true/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (isCommentLine(lines[i]!)) continue;
          if (EXTENDED_TRUE_RE.test(lines[i]!)) {
            findings.push({
              severity: 'HIGH', category: 'prototype_pollution_express_body_deep',
              file: path, line: i + 1,
              message: 'express.urlencoded({ extended: true }) enables deep object parsing — prototype pollution vector.',
              suggestion: 'Use extended: false (uses querystring parser, no deep nesting) or validate/sanitize parsed body.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PROTO_009',
    category: 'prototype_pollution_has_own_missing',
    severity: 'MEDIUM',
    description: 'Property access on user-supplied object without hasOwnProperty check — inherited property confusion.',
    tags: ['security', 'prototype-pollution', 'best-practice'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Accessing properties on user-supplied objects without Object.prototype.hasOwnProperty.call() may return inherited properties. An attacker who adds properties to Object.prototype can cause these checks to return unexpected truthy values.',
      commonViolations: [
        'if (userObj[key]) { doSomething(); }  // inherited truthy from __proto__',
        'config[userInput] !== undefined  // __proto__ properties can satisfy this',
      ],
      goodExample: 'if (Object.prototype.hasOwnProperty.call(userObj, key) && userObj[key]) { ... }',
      badExample: 'if (userObj[key]) { executeAction(userObj[key]); }  // ❌ prototype inheritance bypass',
      relatedPlaybooks: ['prototype-pollution.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const USER_OBJ_ACCESS_RE = /if\s*\(\s*(?:req\.|body\.|userInput|params\.|userData)\w*\s*\[(?:key|k|prop|field|action|type)\]\s*\)/i;
      const SAFE_RE = /hasOwnProperty|Object\.hasOwn|in\s+Object\.prototype|Object\.prototype\.hasOwnProperty/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!USER_OBJ_ACCESS_RE.test(lines[i]!)) continue;
          const ctx = lines.slice(Math.max(0, i - 2), i + 3).join('\n');
          if (!SAFE_RE.test(ctx)) {
            findings.push({
              severity: 'MEDIUM', category: 'prototype_pollution_has_own_missing',
              file: path, line: i + 1,
              message: 'Property access on user-supplied object without hasOwnProperty guard.',
              suggestion: 'Use Object.prototype.hasOwnProperty.call(obj, key) or Object.hasOwn(obj, key).',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PROTO_010',
    category: 'prototype_pollution_spread_user',
    severity: 'HIGH',
    description: 'Spreading user input directly into an object literal without validation — prototype pollution via __proto__.',
    tags: ['security', 'prototype-pollution', 'ai-risk'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'The spread operator copies own enumerable properties. However, in certain JavaScript engine versions and patterns, spreading an object with a __proto__ property can still produce unexpected behavior. More importantly, it copies all keys without filtering, often including attacker-controlled fields that bypass expected type contracts.',
      commonViolations: [
        'const options = { ...req.body, userId }  // req.body could have any keys',
        'const config = { ...defaults, ...userSettings }  // userSettings unchecked',
      ],
      goodExample: 'const { name, email } = UserInputSchema.parse(req.body);\nconst user = { name, email, createdAt: new Date() };  // explicit, validated keys only',
      badExample: 'const user = { ...req.body, role: "user" };  // ❌ attacker can add extra fields',
      relatedPlaybooks: ['prototype-pollution.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const SPREAD_USER_RE = /(?:const|let|var)\s+\w+\s*=\s*\{[^}]*\.\.\.\s*(?:req\.|body\.|params\.|userInput|userData|input\.)\w*/i;
      const VALIDATE_RE = /\.parse\s*\(|\.safeParse|Schema\.\w+|validate\s*\(|pick\s*\(|omit\s*\(/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!SPREAD_USER_RE.test(lines[i]!)) continue;
          const ctx = lines.slice(Math.max(0, i - 4), i + 2).join('\n');
          if (!VALIDATE_RE.test(ctx)) {
            findings.push({
              severity: 'HIGH', category: 'prototype_pollution_spread_user',
              file: path, line: i + 1,
              message: 'User input spread into object literal without schema validation.',
              suggestion: 'Validate and extract only expected fields: const { name } = Schema.parse(req.body);',
            });
          }
        }
      }
      return findings;
    },
  },
];
