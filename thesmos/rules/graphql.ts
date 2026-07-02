// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * GraphQL Security & Quality Rules — GQL_001–025
 *
 * Targets the predictable failure modes of AI-generated GraphQL code.
 * Covers schema design, resolver security, DoS vectors, auth gaps,
 * N+1 queries, and type correctness.
 *
 * Research basis: GraphQL is the primary API layer in many AI-first TypeScript
 * stacks (Apollo, Pothos, Nexus, graphql-yoga). AI agents generate syntactically
 * correct schemas and resolvers but consistently miss depth limits, field-level
 * auth, DataLoader patterns, and production hardening.
 */

import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isGqlFile(p: string) {
  return p.endsWith('.graphql') || p.endsWith('.gql');
}

function isGqlResolver(p: string) {
  return /resolver[s]?|graphql/i.test(p) && (p.endsWith('.ts') || p.endsWith('.js') || p.endsWith('.tsx'));
}

function isGqlSchema(p: string) {
  return isGqlFile(p) || /schema|typeDef[s]?/i.test(p);
}

// ── Rules ─────────────────────────────────────────────────────────────────────

export const GRAPHQL_RULES: ThesmosRule[] = [

  // ── GQL_001: No query depth limit ────────────────────────────────────────
  {
    id: 'GQL_001',
    category: 'gql_no_depth_limit',
    description: 'GraphQL server configured without query depth limiting — DoS via deeply nested queries.',
    severity: 'HIGH',
    tags: ['security', 'graphql', 'dos', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'GraphQL allows arbitrarily nested queries. Without depth limiting, an attacker can craft a query like `{ user { friends { friends { friends { ... } } } } }` that exponentially multiplies database calls, exhausting server resources in a single request.',
      commonViolations: ['Apollo Server without graphql-depth-limit plugin', 'yoga.createServer() with no validation rules'],
      goodExample: 'import depthLimit from "graphql-depth-limit"\nconst server = new ApolloServer({ validationRules: [depthLimit(7)] })',
      badExample: 'const server = new ApolloServer({ schema })  // ❌ no depth limit',
      relatedSkills: ['graphql-schema-review'],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gql_no_depth_limit', config.severityRules);
      const findings: Finding[] = [];
      const HAS_SERVER = /new ApolloServer\s*\(|createServer\s*\(|createYoga\s*\(|makeExecutableSchema/;
      const HAS_DEPTH = /depth[_-]?[Ll]imit|depthLimit|maxDepth|query[_-]?depth/i;
      for (const { path, content } of changedFiles) {
        if (!isGqlResolver(path) && !path.match(/apollo|server|graphql/i)) continue;
        if (!HAS_SERVER.test(content)) continue;
        if (HAS_DEPTH.test(content)) continue;
        const line = content.split('\n').findIndex((l) => HAS_SERVER.test(l));
        findings.push({
          severity: sev, category: 'gql_no_depth_limit', file: path, line: line >= 0 ? line + 1 : undefined,
          message: 'GraphQL server has no query depth limit — attackers can crash the server with deeply nested queries.',
          suggestion: 'Add graphql-depth-limit: validationRules: [depthLimit(7)]',
        });
      }
      return findings;
    },
  },

  // ── GQL_002: No query complexity limit ───────────────────────────────────
  {
    id: 'GQL_002',
    category: 'gql_no_complexity_limit',
    description: 'GraphQL server has no query complexity limit — DoS via expensive field combinations.',
    severity: 'HIGH',
    tags: ['security', 'graphql', 'dos'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Depth limiting alone is insufficient — a shallow but wide query requesting thousands of fields is equally destructive. Complexity scoring assigns a cost to each field and rejects queries exceeding a threshold, preventing resource exhaustion from costly field combinations.',
      commonViolations: ['ApolloServer with no complexity plugin', 'graphql-yoga without createComplexityRule'],
      goodExample: 'import { createComplexityRule } from "graphql-query-complexity"\nvalidationRules: [createComplexityRule({ maximumComplexity: 1000 })]',
      badExample: 'const server = new ApolloServer({ schema })  // ❌ no complexity limit',
      relatedSkills: ['graphql-schema-review'],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gql_no_complexity_limit', config.severityRules);
      const findings: Finding[] = [];
      const HAS_SERVER = /new ApolloServer\s*\(|createServer\s*\(|createYoga\s*\(/;
      const HAS_COMPLEXITY = /complexity|createComplexityRule|costLimit|maxComplexity/i;
      for (const { path, content } of changedFiles) {
        if (!isGqlResolver(path) && !path.match(/apollo|server|graphql/i)) continue;
        if (!HAS_SERVER.test(content)) continue;
        if (HAS_COMPLEXITY.test(content)) continue;
        const line = content.split('\n').findIndex((l) => HAS_SERVER.test(l));
        findings.push({
          severity: sev, category: 'gql_no_complexity_limit', file: path, line: line >= 0 ? line + 1 : undefined,
          message: 'GraphQL server has no query complexity limit — expensive field combinations can exhaust resources.',
          suggestion: 'Add graphql-query-complexity: validationRules: [createComplexityRule({ maximumComplexity: 1000 })]',
        });
      }
      return findings;
    },
  },

  // ── GQL_003: Resolver with no authorization check ─────────────────────────
  {
    id: 'GQL_003',
    category: 'gql_resolver_no_auth',
    description: 'GraphQL resolver accesses data without an authorization check.',
    severity: 'BLOCKER',
    tags: ['security', 'graphql', 'auth', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'GraphQL resolvers that access sensitive data without checking context.user or calling an auth helper can be queried by any authenticated (or unauthenticated) user. Unlike REST, every GraphQL field is individually accessible — each resolver that touches private data needs its own auth check.',
      commonViolations: ['async resolve(parent, args, ctx) { return ctx.db.findUser(args.id) }', 'Query.adminStats: () => db.getStats()'],
      goodExample: 'async resolve(parent, args, ctx) {\n  if (!ctx.user) throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHENTICATED" } })\n  return ctx.db.findUser(args.id)\n}',
      badExample: 'async resolve(parent, args, ctx) {\n  return ctx.db.findUser(args.id)  // ❌ no auth check\n}',
      relatedSkills: ['graphql-schema-review', 'auth-flow-review'],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gql_resolver_no_auth', config.severityRules);
      const findings: Finding[] = [];
      const RESOLVER_FN = /resolve\s*(?::\s*)?(?:async\s*)?\(\s*(?:parent|_|root)\s*,\s*args\s*,\s*(?:ctx|context)\s*\)/;
      const AUTH_CHECK = /ctx\.user|context\.user|ctx\.session|context\.session|isAuthenticated|requireAuth|checkAuth|authorize|getUser|currentUser/;
      for (const { path, content } of changedFiles) {
        if (!isGqlResolver(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!RESOLVER_FN.test(lines[i]!)) continue;
          const body = lines.slice(i, i + 12).join('\n');
          if (!AUTH_CHECK.test(body) && /ctx\.|context\./.test(body)) {
            findings.push({
              severity: sev, category: 'gql_resolver_no_auth', file: path, line: i + 1,
              message: 'GraphQL resolver accesses data without authorization check — any caller can read this field.',
              suggestion: 'Add: if (!ctx.user) throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHENTICATED" } })',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── GQL_004: N+1 query without DataLoader ────────────────────────────────
  {
    id: 'GQL_004',
    category: 'gql_n_plus_one',
    description: 'GraphQL resolver calls the database inside a field that returns a list — N+1 query problem.',
    severity: 'HIGH',
    tags: ['performance', 'graphql', 'database', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'When a list resolver returns N items and each item\'s child resolver hits the database, the result is N+1 queries per request. With 100 users, a single GraphQL query triggers 101 database calls. The solution is DataLoader, which batches and caches database calls per request.',
      commonViolations: ['posts resolver: parent => db.findUser(parent.authorId)', 'comments field: parent => prisma.comment.findMany({ where: { postId: parent.id } })'],
      goodExample: 'posts: (parent, args, ctx) => ctx.loaders.user.load(parent.authorId)',
      badExample: 'posts: (parent, args, ctx) => ctx.db.findUser(parent.authorId)  // ❌ N+1',
      relatedSkills: ['graphql-schema-review'],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gql_n_plus_one', config.severityRules);
      const findings: Finding[] = [];
      // Field resolver that calls db/prisma/orm directly on parent.id or parent.*Id
      const RESOLVER_WITH_PARENT_ID = /(?:resolve|resolve\s*:)\s*(?:async\s*)?\([^)]*parent[^)]*\)[^{]*\{[^}]*(?:db|prisma|orm|repository|repo)\.\w+\s*\(\s*\{[^}]*parent\.\w+Id/;
      for (const { path, content } of changedFiles) {
        if (!isGqlResolver(path)) continue;
        // Skip if DataLoader is used
        if (/dataloader|DataLoader|\.load\s*\(|loader[s]?\./i.test(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const window = lines.slice(i, i + 6).join('\n');
          if (RESOLVER_WITH_PARENT_ID.test(window)) {
            findings.push({
              severity: sev, category: 'gql_n_plus_one', file: path, line: i + 1,
              message: 'Resolver calls database using parent.id inside a field resolver — N+1 query pattern.',
              suggestion: 'Use DataLoader to batch these calls: ctx.loaders.user.load(parent.authorId)',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── GQL_005: GraphQL introspection enabled in production ──────────────────
  {
    id: 'GQL_005',
    category: 'gql_introspection_in_prod',
    description: 'GraphQL introspection not disabled — exposes full schema to attackers in production.',
    severity: 'MEDIUM',
    tags: ['security', 'graphql', 'information-disclosure'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'GraphQL introspection allows any client to query the entire schema — all types, fields, mutations, and their arguments. In production, this is a reconnaissance gift to attackers. Disable introspection in non-development environments.',
      commonViolations: ['new ApolloServer({ schema }) // no introspection:false', 'createYoga({ schema }) // defaults introspection to true'],
      goodExample: 'new ApolloServer({\n  schema,\n  introspection: process.env.NODE_ENV !== "production"\n})',
      badExample: 'new ApolloServer({ schema })  // ❌ introspection always on',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gql_introspection_in_prod', config.severityRules);
      const findings: Finding[] = [];
      const HAS_SERVER = /new ApolloServer\s*\(|createYoga\s*\(/;
      const HAS_INTROSPECTION = /introspection\s*:/;
      for (const { path, content } of changedFiles) {
        if (!path.match(/apollo|server|graphql/i)) continue;
        if (!HAS_SERVER.test(content)) continue;
        if (HAS_INTROSPECTION.test(content)) continue;
        const line = content.split('\n').findIndex((l) => HAS_SERVER.test(l));
        findings.push({
          severity: sev, category: 'gql_introspection_in_prod', file: path, line: line >= 0 ? line + 1 : undefined,
          message: 'GraphQL introspection is enabled by default — disable it in production to prevent schema exposure.',
          suggestion: 'Add: introspection: process.env.NODE_ENV !== "production"',
        });
      }
      return findings;
    },
  },

  // ── GQL_006: Resolver throws raw Error (leaks stack trace) ───────────────
  {
    id: 'GQL_006',
    category: 'gql_raw_error_thrown',
    description: 'Resolver throws a raw `Error` instead of `GraphQLError` — may leak internal stack traces.',
    severity: 'MEDIUM',
    tags: ['security', 'graphql', 'error-handling'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Throwing a native Error in a GraphQL resolver may expose the full stack trace and internal details in the errors[] response array, depending on server configuration. GraphQLError allows you to control which extensions are returned to the client and set appropriate error codes.',
      commonViolations: ['throw new Error("User not found")', 'throw new Error("Unauthorized")'],
      goodExample: 'throw new GraphQLError("User not found", {\n  extensions: { code: "NOT_FOUND" }\n})',
      badExample: 'throw new Error("User not found")  // ❌ may leak stack trace in response',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gql_raw_error_thrown', config.severityRules);
      const findings: Finding[] = [];
      const THROW_ERROR = /\bthrow\s+new\s+Error\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isGqlResolver(path)) continue;
        if (!/GraphQL|resolver|graphql/i.test(content)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (THROW_ERROR.test(line)) {
            findings.push({
              severity: sev, category: 'gql_raw_error_thrown', file: path, line: i + 1,
              message: 'Raw Error thrown in GraphQL resolver — use GraphQLError with an error code to control what the client sees.',
              suggestion: 'throw new GraphQLError("message", { extensions: { code: "NOT_FOUND" } })',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── GQL_007: String used for ID scalar ────────────────────────────────────
  {
    id: 'GQL_007',
    category: 'gql_string_for_id',
    description: 'Schema uses `String` type for ID fields — use the `ID` scalar instead.',
    severity: 'LOW',
    tags: ['graphql', 'schema', 'quality'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'GraphQL has a dedicated ID scalar for unique identifiers. Using String for ID fields bypasses client-side type coercion, breaks pagination conventions (Relay), and prevents tools like Apollo Client from cache normalization. IDs should always use the ID scalar.',
      commonViolations: ['id: String!', 'userId: String', 'postId: String!'],
      goodExample: 'id: ID!\nuserId: ID\npostId: ID!',
      badExample: 'type User {\n  id: String!  # ❌ use ID scalar\n}',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gql_string_for_id', config.severityRules);
      const findings: Finding[] = [];
      const STRING_ID = /^\s+(?:\w+[Ii]d|id)\s*:\s*String[!]?/;
      for (const { path, content } of changedFiles) {
        if (!isGqlFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (STRING_ID.test(line)) {
            findings.push({
              severity: sev, category: 'gql_string_for_id', file: path, line: i + 1,
              message: 'ID field typed as String — use the ID scalar for proper cache normalization and Relay compatibility.',
              suggestion: 'Change `String` to `ID`: `id: ID!`',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── GQL_008: Mutation returns Boolean ────────────────────────────────────
  {
    id: 'GQL_008',
    category: 'gql_mutation_returns_boolean',
    description: 'GraphQL mutation returns `Boolean` — use a typed payload for evolvable APIs.',
    severity: 'LOW',
    tags: ['graphql', 'schema', 'quality', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Mutations returning Boolean cannot evolve — there\'s nowhere to add a returned object, error details, or user feedback without a breaking schema change. A typed MutationPayload (with success, errors, and the affected entity) is the industry standard and allows non-breaking schema evolution.',
      commonViolations: ['deleteUser(id: ID!): Boolean', 'updateProfile(input: ProfileInput!): Boolean'],
      goodExample: 'deleteUser(id: ID!): DeleteUserPayload\n\ntype DeleteUserPayload {\n  success: Boolean!\n  user: User\n  errors: [String!]\n}',
      badExample: 'deleteUser(id: ID!): Boolean  # ❌ cannot evolve without breaking change',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gql_mutation_returns_boolean', config.severityRules);
      const findings: Finding[] = [];
      const MUTATION_BOOL = /^\s+\w+\s*\([^)]*\)\s*:\s*Boolean[!]?/;
      let inMutation = false;
      for (const { path, content } of changedFiles) {
        if (!isGqlFile(path)) continue;
        const lines = content.split('\n');
        inMutation = false;
        lines.forEach((line, i) => {
          if (/^\s*type\s+Mutation\b/.test(line)) { inMutation = true; return; }
          if (/^\s*type\s+\w+/.test(line) && !/Mutation/.test(line)) inMutation = false;
          if (inMutation && MUTATION_BOOL.test(line)) {
            findings.push({
              severity: sev, category: 'gql_mutation_returns_boolean', file: path, line: i + 1,
              message: 'Mutation returns Boolean — use a typed MutationPayload to allow schema evolution without breaking changes.',
              suggestion: 'Define a payload type: `type DeleteUserPayload { success: Boolean! user: User errors: [String!] }`',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── GQL_009: Missing @deprecated reason ──────────────────────────────────
  {
    id: 'GQL_009',
    category: 'gql_deprecated_no_reason',
    description: '`@deprecated` directive used without a `reason` — clients have no migration guidance.',
    severity: 'LOW',
    tags: ['graphql', 'schema', 'quality'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'The @deprecated directive accepts a reason argument that tells API consumers why the field is deprecated and what to use instead. Without a reason, GraphQL tools (Apollo Studio, GraphiQL) show "No longer supported" with no migration path.',
      commonViolations: ['oldField: String @deprecated', 'legacyUser: User @deprecated'],
      goodExample: 'oldField: String @deprecated(reason: "Use newField instead — available since v2.0")',
      badExample: 'oldField: String @deprecated  # ❌ no migration guidance',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gql_deprecated_no_reason', config.severityRules);
      const findings: Finding[] = [];
      const DEPRECATED_NO_REASON = /@deprecated(?!\s*\(\s*reason\s*:)/;
      for (const { path, content } of changedFiles) {
        if (!isGqlFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (DEPRECATED_NO_REASON.test(line)) {
            findings.push({
              severity: sev, category: 'gql_deprecated_no_reason', file: path, line: i + 1,
              message: '@deprecated without a reason — add a migration hint for API consumers.',
              suggestion: '@deprecated(reason: "Use newField instead — available since v2.0")',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── GQL_010: Subscription without auth on websocket ──────────────────────
  {
    id: 'GQL_010',
    category: 'gql_subscription_no_auth',
    description: 'GraphQL subscription handler has no authentication check on the connection context.',
    severity: 'BLOCKER',
    tags: ['security', 'graphql', 'auth', 'websocket'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'GraphQL subscriptions upgrade to WebSockets. Unlike queries/mutations, the HTTP authorization header is only available during the upgrade handshake — after connection, the auth context must be validated in onConnect or the subscription resolver. Missing this check allows unauthenticated clients to receive real-time data streams.',
      commonViolations: ['Subscription.onMessage: () => pubsub.asyncIterator(["MESSAGE"])', 'subscriptions: { onConnect: () => true }'],
      goodExample: 'subscriptions: {\n  onConnect: (params) => {\n    const token = params.authToken\n    if (!token) throw new Error("Unauthorized")\n    return { user: verifyToken(token) }\n  }\n}',
      badExample: 'subscriptions: { onConnect: () => true }  // ❌ no auth',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gql_subscription_no_auth', config.severityRules);
      const findings: Finding[] = [];
      const ON_CONNECT_PERMISSIVE = /onConnect\s*:\s*(?:async\s*)?\(\s*\)\s*=>\s*(?:true|\{\s*\})/;
      for (const { path, content } of changedFiles) {
        if (!isGqlResolver(path) && !path.match(/server|graphql/i)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (ON_CONNECT_PERMISSIVE.test(line)) {
            findings.push({
              severity: sev, category: 'gql_subscription_no_auth', file: path, line: i + 1,
              message: 'WebSocket onConnect accepts all connections without authentication — any client can subscribe.',
              suggestion: 'Validate auth in onConnect: const user = verifyToken(params.authToken); if (!user) throw new Error("Unauthorized")',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── GQL_011: context.user used without null check ─────────────────────────
  {
    id: 'GQL_011',
    category: 'gql_context_user_no_check',
    description: '`context.user` or `ctx.user` accessed without null check — crashes on unauthenticated requests.',
    severity: 'HIGH',
    tags: ['graphql', 'bugs', 'auth', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'If context.user is undefined (unauthenticated request) and a resolver accesses ctx.user.id or ctx.user.role, it throws a TypeError at runtime. Resolvers must explicitly check and throw a GraphQLError before accessing user properties.',
      commonViolations: ['return db.getUserPosts(ctx.user.id)', 'if (ctx.user.role === "admin")'],
      goodExample: 'if (!ctx.user) throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHENTICATED" } })\nreturn db.getUserPosts(ctx.user.id)',
      badExample: 'return db.getUserPosts(ctx.user.id)  // ❌ crashes if unauthenticated',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gql_context_user_no_check', config.severityRules);
      const findings: Finding[] = [];
      const CTX_USER_PROP = /\bct[x]\.user\.\w+|\bcontext\.user\.\w+/;
      const AUTH_GUARD = /(?:if\s*\(!?\s*(?:ctx|context)\.user)|(?:ctx|context)\.user\s*\?\./;
      for (const { path, content } of changedFiles) {
        if (!isGqlResolver(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (!CTX_USER_PROP.test(line)) continue;
          // Check the surrounding 5 lines for a guard
          const surrounding = lines.slice(Math.max(0, i - 5), i + 1).join('\n');
          if (!AUTH_GUARD.test(surrounding)) {
            findings.push({
              severity: sev, category: 'gql_context_user_no_check', file: path, line: i + 1,
              message: '`ctx.user` property accessed without null guard — throws TypeError if request is unauthenticated.',
              suggestion: 'Guard first: if (!ctx.user) throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHENTICATED" } })',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── GQL_012: Resolver returns undefined for nullable field ────────────────
  {
    id: 'GQL_012',
    category: 'gql_undefined_for_nullable',
    description: 'GraphQL resolver returns `undefined` for a nullable field — should return `null`.',
    severity: 'LOW',
    tags: ['graphql', 'bugs', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'GraphQL\'s spec defines null as the valid representation of an absent nullable field. Returning undefined from a resolver is not spec-compliant — while Apollo and graphql-js coerce it, other frameworks and clients may behave differently. Explicit null is always safer and more readable.',
      commonViolations: ['return undefined', 'if (!found) return undefined'],
      goodExample: 'if (!found) return null',
      badExample: 'if (!found) return undefined  // ❌ use null for nullable GraphQL fields',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gql_undefined_for_nullable', config.severityRules);
      const findings: Finding[] = [];
      const RETURN_UNDEFINED = /\breturn\s+undefined\b/;
      for (const { path, content } of changedFiles) {
        if (!isGqlResolver(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (RETURN_UNDEFINED.test(line)) {
            findings.push({
              severity: sev, category: 'gql_undefined_for_nullable', file: path, line: i + 1,
              message: 'Resolver returns `undefined` — return `null` for absent nullable GraphQL fields.',
              suggestion: 'Replace `return undefined` with `return null`',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── GQL_013: __resolveType missing on union/interface ─────────────────────
  {
    id: 'GQL_013',
    category: 'gql_missing_resolve_type',
    description: 'GraphQL union or interface schema defined but `__resolveType` missing in resolvers.',
    severity: 'HIGH',
    tags: ['graphql', 'bugs', 'schema'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'GraphQL unions and interfaces require a __resolveType function to determine which concrete type an object is at runtime. Without it, GraphQL returns null for all union/interface fields and logs a runtime error. This is a silent failure — the schema validates but queries return empty data.',
      commonViolations: ['union SearchResult = User | Post — no __resolveType in resolvers', 'interface Node { id: ID! } — no __resolveType implementation'],
      goodExample: 'SearchResult: {\n  __resolveType(obj) {\n    if (obj.email) return "User"\n    if (obj.title) return "Post"\n    return null\n  }\n}',
      badExample: '// schema has: union SearchResult = User | Post\n// resolvers has: SearchResult: {} // ❌ missing __resolveType',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gql_missing_resolve_type', config.severityRules);
      const findings: Finding[] = [];
      const UNION_DEF = /^\s*(?:union|interface)\s+(\w+)/;
      for (const { path, content } of changedFiles) {
        if (!isGqlFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          const m = UNION_DEF.exec(line);
          if (m) {
            findings.push({
              severity: sev, category: 'gql_missing_resolve_type', file: path, line: i + 1,
              message: `GraphQL ${line.trim().startsWith('union') ? 'union' : 'interface'} \`${m[1]}\` requires a \`__resolveType\` function in the resolver map.`,
              suggestion: `Add to resolvers: ${m[1]}: { __resolveType(obj) { return obj.__typename ?? null } }`,
            });
          }
        });
      }
      return findings;
    },
  },

  // ── GQL_014: console.log in resolver ──────────────────────────────────────
  {
    id: 'GQL_014',
    category: 'gql_console_log_in_resolver',
    description: '`console.log` in a GraphQL resolver — leaks query args and user data to server logs.',
    severity: 'MEDIUM',
    tags: ['security', 'graphql', 'observability', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'AI-generated resolvers routinely contain console.log(args) or console.log(ctx.user) for debugging that never gets removed. In production, this logs PII, access tokens, and query arguments to stdout where they may be ingested by log aggregators and retained indefinitely.',
      commonViolations: ['console.log(args)', 'console.log("user:", ctx.user)', 'console.log(result)'],
      goodExample: 'logger.debug("Fetching user", { userId: args.id })  // structured, redacted',
      badExample: 'console.log(args)  // ❌ may log PII to server logs',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gql_console_log_in_resolver', config.severityRules);
      const findings: Finding[] = [];
      const CONSOLE_LOG = /\bconsole\.\w+\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isGqlResolver(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (CONSOLE_LOG.test(line)) {
            findings.push({
              severity: sev, category: 'gql_console_log_in_resolver', file: path, line: i + 1,
              message: 'console.log in GraphQL resolver may log PII, tokens, or query args to production logs.',
              suggestion: 'Remove debug logging or replace with a structured logger that redacts sensitive fields.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── GQL_015: No rate limiting on GraphQL endpoint ─────────────────────────
  {
    id: 'GQL_015',
    category: 'gql_no_rate_limit',
    description: 'GraphQL endpoint has no rate limiting middleware configured.',
    severity: 'HIGH',
    tags: ['security', 'graphql', 'dos', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Without rate limiting, any client can flood the GraphQL endpoint with thousands of requests per second. Combined with complex queries, this is a trivial DoS. Rate limiting at the API gateway, express middleware, or GraphQL plugin layer is essential for public APIs.',
      commonViolations: ['ApolloServer without rate limit plugin', 'Express GraphQL route without express-rate-limit'],
      goodExample: 'app.use("/graphql", rateLimit({ windowMs: 60_000, max: 100 }), expressMiddleware(server))',
      badExample: 'app.use("/graphql", expressMiddleware(server))  // ❌ no rate limit',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gql_no_rate_limit', config.severityRules);
      const findings: Finding[] = [];
      const GQL_ROUTE = /app\.use\s*\(\s*['"]\/graphql['"]/i;
      const HAS_RATE_LIMIT = /rateLimit|rate_limit|rateLimiter|throttle|slowDown/i;
      for (const { path, content } of changedFiles) {
        if (!path.match(/server|app|index|route/i) || !path.match(/\.[jt]sx?$/)) continue;
        if (!GQL_ROUTE.test(content)) continue;
        if (HAS_RATE_LIMIT.test(content)) continue;
        const line = content.split('\n').findIndex((l) => GQL_ROUTE.test(l));
        findings.push({
          severity: sev, category: 'gql_no_rate_limit', file: path, line: line >= 0 ? line + 1 : undefined,
          message: 'GraphQL endpoint registered without rate limiting middleware.',
          suggestion: 'Add rate limiting: app.use("/graphql", rateLimit({ windowMs: 60_000, max: 100 }), expressMiddleware(server))',
        });
      }
      return findings;
    },
  },

  // ── GQL_016: File upload without size limit ───────────────────────────────
  {
    id: 'GQL_016',
    category: 'gql_file_upload_no_limit',
    description: 'GraphQL file upload configured without a file size limit.',
    severity: 'HIGH',
    tags: ['security', 'graphql', 'dos'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'GraphQL file uploads (via graphql-upload or Apollo Upload) without size limits allow attackers to upload arbitrarily large files, exhausting disk space and memory. Always configure maxFileSize and maxFiles.',
      commonViolations: ['graphqlUploadExpress()', 'Upload scalar without limits'],
      goodExample: 'graphqlUploadExpress({ maxFileSize: 10_000_000, maxFiles: 10 })',
      badExample: 'app.use(graphqlUploadExpress())  // ❌ no file size limit',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gql_file_upload_no_limit', config.severityRules);
      const findings: Finding[] = [];
      const UPLOAD_NO_LIMIT = /graphqlUploadExpress\s*\(\s*\)|graphqlUploadKoa\s*\(\s*\)/;
      for (const { path, content } of changedFiles) {
        if (!path.match(/\.[jt]sx?$/)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (UPLOAD_NO_LIMIT.test(line)) {
            findings.push({
              severity: sev, category: 'gql_file_upload_no_limit', file: path, line: i + 1,
              message: 'GraphQL file upload middleware configured with no size limit.',
              suggestion: 'Add limits: graphqlUploadExpress({ maxFileSize: 10_000_000, maxFiles: 10 })',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── GQL_017: Hardcoded secret in resolver ────────────────────────────────
  {
    id: 'GQL_017',
    category: 'gql_hardcoded_secret',
    description: 'Hardcoded API key, token, or secret found in GraphQL resolver.',
    severity: 'BLOCKER',
    tags: ['security', 'graphql', 'secrets', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'AI agents commonly embed API keys, service tokens, or JWT secrets directly in resolver files when generating example code. These end up committed to version control and exposed in the bundle.',
      commonViolations: ['const apiKey = "sk-abc123..."', 'const secret = "my-jwt-secret"'],
      goodExample: 'const apiKey = process.env.OPENAI_API_KEY',
      badExample: 'const apiKey = "sk-proj-abc123"  // ❌ committed secret',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gql_hardcoded_secret', config.severityRules);
      const findings: Finding[] = [];
      const SECRET_PATTERN = /(?:api[_-]?key|secret|token|password|auth[_-]?token)\s*=\s*['"][a-zA-Z0-9_\-./+]{16,}['"]/i;
      for (const { path, content } of changedFiles) {
        if (!isGqlResolver(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (SECRET_PATTERN.test(line) && !/process\.env/.test(line)) {
            findings.push({
              severity: sev, category: 'gql_hardcoded_secret', file: path, line: i + 1,
              message: 'Hardcoded secret or API key in GraphQL resolver — move to environment variable.',
              suggestion: 'Use process.env.API_KEY and add the variable to .env.example (never commit actual values)',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── GQL_018: Cursor pagination missing ───────────────────────────────────
  {
    id: 'GQL_018',
    category: 'gql_offset_pagination_only',
    description: 'GraphQL list field uses limit/offset pagination only — does not scale at high offsets.',
    severity: 'LOW',
    tags: ['graphql', 'performance', 'schema'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Offset pagination (`LIMIT n OFFSET m`) requires the database to scan and discard all preceding rows, making large offsets slow. Cursor-based pagination (using an opaque cursor pointing to a specific row) is consistent, fast, and handles concurrent inserts correctly.',
      commonViolations: ['users(limit: Int, offset: Int): [User!]', 'posts(page: Int, perPage: Int): [Post!]'],
      goodExample: 'users(first: Int, after: String): UserConnection\n\ntype UserConnection { edges: [UserEdge!]! pageInfo: PageInfo! }',
      badExample: 'users(limit: Int, offset: Int): [User!]  # ❌ offset pagination',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gql_offset_pagination_only', config.severityRules);
      const findings: Finding[] = [];
      const OFFSET_PAGINATION = /\(\s*\w*[lL]imit\s*:\s*Int[!]?\s*,?\s*\w*[oO]ffset\s*:\s*Int[!]?\s*\)/;
      for (const { path, content } of changedFiles) {
        if (!isGqlFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (OFFSET_PAGINATION.test(line) && !/first|after|cursor/i.test(content)) {
            findings.push({
              severity: sev, category: 'gql_offset_pagination_only', file: path, line: i + 1,
              message: 'Offset pagination degrades at scale — consider cursor-based pagination (Relay Connection spec).',
              suggestion: 'Use: `users(first: Int, after: String): UserConnection` with edge/pageInfo types',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── GQL_019: Schema stitching without permission inheritance ──────────────
  {
    id: 'GQL_019',
    category: 'gql_stitch_no_auth',
    description: 'Schema stitching merges a remote schema without forwarding authorization headers.',
    severity: 'HIGH',
    tags: ['security', 'graphql', 'auth'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'When stitching remote schemas, the auth context (headers, tokens) must be explicitly forwarded to the subgraph. Without forwarding, every request to the subgraph runs as the gateway service identity — bypassing per-user access controls on the downstream service.',
      commonViolations: ['introspectSchema(executor) without headers forwarding', 'wrapSchema({ schema, executor }) with static headers'],
      goodExample: 'executor: async ({ document, variables, context }) => {\n  return fetch(REMOTE_URL, {\n    headers: { Authorization: context.req.headers.authorization }\n  })\n}',
      badExample: 'executor: async ({ document, variables }) => fetch(REMOTE_URL, { body: ... })  // ❌ no auth forwarding',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gql_stitch_no_auth', config.severityRules);
      const findings: Finding[] = [];
      const STITCH = /introspectSchema|wrapSchema|stitchSchemas|buildHTTPExecutor/;
      const FORWARDS_AUTH = /context\.req|context\.headers|authorization/i;
      for (const { path, content } of changedFiles) {
        if (!isGqlResolver(path) && !path.match(/gateway|stitch/i)) continue;
        if (!STITCH.test(content)) continue;
        if (FORWARDS_AUTH.test(content)) continue;
        const line = content.split('\n').findIndex((l) => STITCH.test(l));
        findings.push({
          severity: sev, category: 'gql_stitch_no_auth', file: path, line: line >= 0 ? line + 1 : undefined,
          message: 'Schema stitching without forwarding the Authorization header — downstream subgraph runs without per-user auth.',
          suggestion: 'Forward headers in the executor: headers: { Authorization: context.req.headers.authorization }',
        });
      }
      return findings;
    },
  },

  // ── GQL_020: Named operation missing query keyword ────────────────────────
  {
    id: 'GQL_020',
    category: 'gql_implicit_query',
    description: 'Anonymous GraphQL operation (missing `query` keyword) — breaks persisted queries and APQ.',
    severity: 'LOW',
    tags: ['graphql', 'quality'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'The shorthand syntax `{ user { name } }` is an implicit anonymous query. While valid, it is incompatible with Automatic Persisted Queries (APQ) and makes query tracking in Apollo Studio impossible. Named operations (`query GetUser { ... }`) enable caching, tracing, and debugging.',
      commonViolations: ['{ user(id: $id) { name } }', '{ posts { title } }'],
      goodExample: 'query GetUser($id: ID!) {\n  user(id: $id) { name }\n}',
      badExample: '{ user(id: $id) { name } }  # ❌ anonymous implicit query',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gql_implicit_query', config.severityRules);
      const findings: Finding[] = [];
      const IMPLICIT_QUERY = /^\s*\{(?!\s*$)/;
      for (const { path, content } of changedFiles) {
        // Only check .graphql files and gql template literals in TS
        if (!isGqlFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (IMPLICIT_QUERY.test(line) && i === 0) {
            findings.push({
              severity: sev, category: 'gql_implicit_query', file: path, line: i + 1,
              message: 'Anonymous implicit query — name your operations for APQ, caching, and Apollo Studio tracking.',
              suggestion: 'Add the query keyword and a name: `query GetUser { ... }`',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── GQL_021: Input type used as output type ───────────────────────────────
  {
    id: 'GQL_021',
    category: 'gql_input_as_output',
    description: 'GraphQL `input` type name used as a field return type — inputs cannot be used as outputs.',
    severity: 'HIGH',
    tags: ['graphql', 'schema', 'bugs'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'GraphQL distinguishes between input types (for arguments) and output types (for fields). An `input` type cannot be used as the return type of a field — this causes a schema validation error at startup. AI agents regularly confuse the two, especially when generating CRUD schemas.',
      commonViolations: ['createUser(input: UserInput!): UserInput', 'type Query { user: UserInput }'],
      goodExample: 'input UserInput { name: String! }\ntype User { id: ID! name: String! }\ntype Mutation { createUser(input: UserInput!): User! }',
      badExample: 'createUser(input: UserInput!): UserInput  # ❌ input type as output',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gql_input_as_output', config.severityRules);
      const findings: Finding[] = [];
      const RETURN_INPUT = /\)\s*:\s*\w*[Ii]nput[!]?/;
      for (const { path, content } of changedFiles) {
        if (!isGqlFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (RETURN_INPUT.test(line) && !/^\s*#/.test(line)) {
            findings.push({
              severity: sev, category: 'gql_input_as_output', file: path, line: i + 1,
              message: 'Input type used as a field return type — define a separate output type.',
              suggestion: 'Create a matching output type: `type User { ... }` and return it instead of `UserInput`',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── GQL_022: Missing non-null on required schema fields ───────────────────
  {
    id: 'GQL_022',
    category: 'gql_missing_non_null',
    description: 'Schema fields that are semantically required are nullable (missing `!`).',
    severity: 'LOW',
    tags: ['graphql', 'schema', 'quality', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'AI agents tend to generate schemas with all fields nullable as a safe default. This forces clients to handle null for fields that will never be null in practice (e.g., id, createdAt, name), making type generation and client code more complex than necessary.',
      commonViolations: ['id: ID  # should be ID!', 'createdAt: String  # should be String!', 'email: String  # on User type'],
      goodExample: 'type User {\n  id: ID!\n  email: String!\n  createdAt: String!\n}',
      badExample: 'type User {\n  id: ID  # ❌ id is always present\n  email: String  # ❌ email is required\n}',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gql_missing_non_null', config.severityRules);
      const findings: Finding[] = [];
      // id, email, createdAt, updatedAt without ! inside type definitions
      const NULLABLE_REQUIRED = /^\s+(?:id|email|createdAt|updatedAt|created_at|updated_at)\s*:\s*(?:ID|String|Int|Float)(?![![])/;
      for (const { path, content } of changedFiles) {
        if (!isGqlFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (NULLABLE_REQUIRED.test(line) && !/^\s*#/.test(line)) {
            findings.push({
              severity: sev, category: 'gql_missing_non_null', file: path, line: i + 1,
              message: 'Semantically required field is nullable — add `!` to declare it non-null.',
              suggestion: 'Add !: `id: ID!`, `email: String!`, `createdAt: String!`',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── GQL_023: Error masking disabled ───────────────────────────────────────
  {
    id: 'GQL_023',
    category: 'gql_error_masking_disabled',
    description: 'GraphQL server configured to expose full error details — leaks internals in production.',
    severity: 'HIGH',
    tags: ['security', 'graphql', 'information-disclosure'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'In development, full error details are useful. In production, returning raw errors exposes stack traces, database query strings, internal service URLs, and other sensitive information. Apollo Server masks errors by default but this is often explicitly disabled in configuration.',
      commonViolations: ['includeStacktraceInErrorResponses: true', 'formatError: (err) => err', 'NODE_ENV check bypassed'],
      goodExample: 'new ApolloServer({ schema, includeStacktraceInErrorResponses: process.env.NODE_ENV !== "production" })',
      badExample: 'new ApolloServer({ schema, includeStacktraceInErrorResponses: true })  // ❌ leaks in production',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gql_error_masking_disabled', config.severityRules);
      const findings: Finding[] = [];
      const STACK_TRACE_ON = /includeStacktraceInErrorResponses\s*:\s*true/;
      for (const { path, content } of changedFiles) {
        if (!path.match(/apollo|server|graphql/i)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (STACK_TRACE_ON.test(line)) {
            findings.push({
              severity: sev, category: 'gql_error_masking_disabled', file: path, line: i + 1,
              message: '`includeStacktraceInErrorResponses: true` exposes internal stack traces in production.',
              suggestion: 'Gate on environment: includeStacktraceInErrorResponses: process.env.NODE_ENV !== "production"',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── GQL_024: Resolver not handling async errors ───────────────────────────
  {
    id: 'GQL_024',
    category: 'gql_unhandled_resolver_error',
    description: 'Async GraphQL resolver with no try/catch — unhandled rejections crash the server.',
    severity: 'HIGH',
    tags: ['graphql', 'error-handling', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'An unhandled promise rejection in a GraphQL resolver causes the field to return null with an error, but depending on the framework version and Node.js version, it may also crash the process or emit an UnhandledPromiseRejection warning that terminates the server.',
      commonViolations: ['async resolve(parent, args, ctx) { return await db.findUser(args.id) }'],
      goodExample: 'async resolve(parent, args, ctx) {\n  try {\n    return await db.findUser(args.id)\n  } catch (err) {\n    throw new GraphQLError("Failed to fetch user", { extensions: { code: "INTERNAL_SERVER_ERROR" } })\n  }\n}',
      badExample: 'async resolve(parent, args, ctx) {\n  return await db.findUser(args.id)  // ❌ no error handling\n}',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gql_unhandled_resolver_error', config.severityRules);
      const findings: Finding[] = [];
      const ASYNC_RESOLVER = /resolve\s*(?::\s*)?async\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isGqlResolver(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!ASYNC_RESOLVER.test(lines[i]!)) continue;
          const body = lines.slice(i, i + 15).join('\n');
          if (!/try\s*\{|\.catch\s*\(/.test(body) && /await\s+/.test(body)) {
            findings.push({
              severity: sev, category: 'gql_unhandled_resolver_error', file: path, line: i + 1,
              message: 'Async resolver with no try/catch — unhandled rejection returns null for the field and may crash the server.',
              suggestion: 'Wrap in try/catch and throw GraphQLError with a meaningful code.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── GQL_025: DataLoader not per-request ───────────────────────────────────
  {
    id: 'GQL_025',
    category: 'gql_shared_dataloader',
    description: 'DataLoader instance created outside request context — shared cache leaks data between users.',
    severity: 'BLOCKER',
    tags: ['security', 'graphql', 'dataloader', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'DataLoader caches results by key within a request. If a DataLoader is created at module level (singleton), its cache persists across requests — User A\'s data is returned to User B if they request the same key in the next request. DataLoaders must be created fresh per-request in the GraphQL context factory.',
      commonViolations: ['const userLoader = new DataLoader(keys => db.findUsers(keys))  // top-level singleton'],
      goodExample: '// In context factory:\nreturn { loaders: { user: new DataLoader(keys => db.findUsers(keys)) } }',
      badExample: 'const userLoader = new DataLoader(...)  // ❌ module-level — shared across requests',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gql_shared_dataloader', config.severityRules);
      const findings: Finding[] = [];
      const TOP_LEVEL_LOADER = /^(?:const|let|var)\s+\w+\s*=\s*new\s+DataLoader\s*\(/m;
      for (const { path, content } of changedFiles) {
        if (!isGqlResolver(path) && !path.match(/loader|context/i)) continue;
        if (!TOP_LEVEL_LOADER.test(content)) continue;
        // If it's inside a function/context factory it's fine — only flag top-level (no indentation)
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^(?:const|let|var)\s+\w+\s*=\s*new\s+DataLoader\s*\(/.test(line)) {
            findings.push({
              severity: sev, category: 'gql_shared_dataloader', file: path, line: i + 1,
              message: 'DataLoader created at module level — shared cache leaks data between concurrent user requests.',
              suggestion: 'Create DataLoaders inside the context factory so each request gets a fresh instance with an empty cache.',
            });
          }
        });
      }
      return findings;
    },
  },

];
