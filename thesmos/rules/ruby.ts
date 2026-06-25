// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Ruby on Rails Security Rules — RB_001–020
 *
 * Targets the predictable security failure modes of AI-generated Rails code.
 * Covers SQL injection, authentication gaps, mass assignment, CSRF bypass,
 * open redirect, command injection, path traversal, hardcoded secrets,
 * XSS, deserialization, sensitive logging, regex ReDoS, and insecure gems.
 *
 * AI assistants writing Rails code consistently use params.permit!, pass
 * user input directly into ActiveRecord queries, skip before_action
 * authenticate_user!, and call YAML.load instead of YAML.safe_load.
 */

import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isRubyFile(p: string) { return p.endsWith('.rb'); }
function isRubyTest(p: string) {
  return p.includes('_spec.rb') || p.includes('_test.rb') || p.includes('/test/') || p.includes('/spec/');
}
function isErb(p: string) { return p.endsWith('.erb'); }

function lineOf(content: string, re: RegExp): number | undefined {
  const idx = content.split('\n').findIndex((l) => re.test(l));
  return idx >= 0 ? idx + 1 : undefined;
}

// ── Rules ─────────────────────────────────────────────────────────────────────

export const RUBY_RULES: ThesmosRule[] = [

  // ── RB_001: SQL injection via string interpolation in ActiveRecord ──────────
  {
    id: 'RB_001',
    category: 'rails_sql_injection',
    description: 'String interpolation inside ActiveRecord .where()/.find_by()/.order()/.group()/.having()/.joins()/.select() — SQL injection risk.',
    severity: 'BLOCKER',
    tags: ['security', 'ruby', 'rails', 'sql-injection', 'vibe-coding'],
    sinceVersion: '1.4.0',
    explain: {
      why: 'Interpolating Ruby variables directly into ActiveRecord query strings allows attackers to escape the query context and execute arbitrary SQL. The ORM is only safe when placeholders (? or named params) separate data from SQL structure. AI assistants frequently generate .where("column = \'#{params[:x]}\'") because it looks concise.',
      commonViolations: [
        '.where("email = \'#{params[:email]}\'")',
        '.find_by("name = #{user_input}")',
        '.order("#{params[:sort]} ASC")',
      ],
      goodExample: 'User.where(email: params[:email])\nUser.where("email = ?", params[:email])',
      badExample: 'User.where("email = \'#{params[:email]}\'") # ❌ SQL injection',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rails_sql_injection', config.severityRules);
      const findings: Finding[] = [];
      const AR_METHODS_RE = /\.(where|find_by|order|group|having|joins|select)\s*\(\s*["'].*#\{/;
      for (const { path, content } of changedFiles) {
        if (!isRubyFile(path) || isRubyTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (AR_METHODS_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rails_sql_injection', file: path, line: i + 1,
              message: 'String interpolation in ActiveRecord query method — SQL injection vulnerability.',
              suggestion: 'Use parameterized form: .where(column: value) or .where("column = ?", value)',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── RB_002: Raw SQL injection via connection.execute with interpolation ─────
  {
    id: 'RB_002',
    category: 'rails_raw_sql_injection',
    description: 'ActiveRecord::Base.connection.execute() with string interpolation — SQL injection risk.',
    severity: 'BLOCKER',
    tags: ['security', 'ruby', 'rails', 'sql-injection', 'vibe-coding'],
    sinceVersion: '1.4.0',
    explain: {
      why: 'connection.execute() bypasses all ActiveRecord parameterization. When user input is interpolated into the SQL string with #{}, the attacker controls the raw SQL sent to the database, enabling full SQL injection including UNION-based data exfiltration and stacked queries.',
      commonViolations: [
        'ActiveRecord::Base.connection.execute("SELECT * FROM users WHERE id = #{params[:id]}")',
        'conn.execute("DELETE FROM sessions WHERE token = \'#{token}\'")',
      ],
      goodExample: 'ActiveRecord::Base.connection.execute(\n  ActiveRecord::Base.sanitize_sql(["SELECT * FROM users WHERE id = ?", params[:id]])\n)',
      badExample: 'connection.execute("SELECT * FROM users WHERE id = #{params[:id]}") # ❌ SQL injection',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rails_raw_sql_injection', config.severityRules);
      const findings: Finding[] = [];
      // Match both `connection.execute(` and shorthand `conn.execute(` with interpolation
      const RAW_SQL_RE = /(?:connection|conn)\.execute\s*\(.*#\{/;
      for (const { path, content } of changedFiles) {
        if (!isRubyFile(path) || isRubyTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (RAW_SQL_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rails_raw_sql_injection', file: path, line: i + 1,
              message: 'connection.execute() with string interpolation — raw SQL injection vulnerability.',
              suggestion: 'Use sanitize_sql with placeholders: connection.execute(sanitize_sql(["... WHERE id = ?", id]))',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── RB_003: Controller missing authenticate before_action ──────────────────
  {
    id: 'RB_003',
    category: 'rails_missing_authenticate',
    description: 'Rails controller with action methods but no before_action :authenticate_user! or equivalent.',
    severity: 'HIGH',
    tags: ['security', 'ruby', 'rails', 'auth', 'vibe-coding'],
    sinceVersion: '1.4.0',
    explain: {
      why: 'AI-generated Rails controllers frequently implement the full CRUD action set without adding any authentication guard. Without before_action :authenticate_user! (Devise) or equivalent, any unauthenticated HTTP request can invoke index, show, create, update, or destroy. This is the most common Rails auth vulnerability.',
      commonViolations: [
        'class PostsController < ApplicationController\n  def index; @posts = Post.all; end\n  def destroy; Post.find(params[:id]).destroy; end\nend',
        'Controller with create/update/destroy actions but no before_action or current_user check',
      ],
      goodExample: 'class PostsController < ApplicationController\n  before_action :authenticate_user!\n  def index; @posts = Post.all; end\nend',
      badExample: 'class PostsController < ApplicationController\n  def destroy\n    Post.find(params[:id]).destroy # ❌ no auth check\n  end\nend',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rails_missing_authenticate', config.severityRules);
      const findings: Finding[] = [];
      const CONTROLLER_RE = /class\s+(\w+)Controller\s*<\s*\w+/;
      const ACTION_RE = /^\s+def\s+(index|show|create|update|destroy|new|edit)\b/m;
      // \b inside the group for bare 'authenticate' only — authenticate_user! ends with ! (\W) so outer \b would fail
      const AUTH_RE = /before_action\s+:(?:authenticate_user!|require_login|authorize|authenticate\b)|current_user\b|authenticate!/;
      const WINDOW = 40;
      for (const { path, content } of changedFiles) {
        if (!isRubyFile(path) || isRubyTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const m = CONTROLLER_RE.exec(lines[i]!);
          if (!m) continue;
          // Skip ApplicationController itself
          if (m[1] === 'Application') continue;
          const end = Math.min(lines.length, i + WINDOW);
          const window = lines.slice(i, end).join('\n');
          if (ACTION_RE.test(window) && !AUTH_RE.test(window)) {
            findings.push({
              severity: sev, category: 'rails_missing_authenticate', file: path, line: i + 1,
              message: `${m[1]}Controller has action methods but no authentication before_action — unauthenticated access possible.`,
              suggestion: 'Add before_action :authenticate_user! (Devise) or before_action :require_login at the top of the controller.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── RB_004: skip_before_action disabling authentication ────────────────────
  {
    id: 'RB_004',
    category: 'rails_skip_before_action_auth',
    description: 'skip_before_action :authenticate_user! or :require_login disables authentication for specific actions.',
    severity: 'HIGH',
    tags: ['security', 'ruby', 'rails', 'auth', 'vibe-coding'],
    sinceVersion: '1.4.0',
    explain: {
      why: "skip_before_action removes an authentication filter for named actions. While sometimes legitimate (public pages), AI assistants add this to 'fix' broken tests or access-denied errors without understanding the security implication. Every use needs explicit justification.",
      commonViolations: [
        'skip_before_action :authenticate_user!, only: [:index, :show]',
        'skip_before_action :require_login',
      ],
      goodExample: '# Only skip auth for genuinely public endpoints, document why:\n# skip_before_action :authenticate_user!, only: [:home] # Public landing page',
      badExample: 'skip_before_action :authenticate_user! # ❌ removes auth — must be justified',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rails_skip_before_action_auth', config.severityRules);
      const findings: Finding[] = [];
      // No \b after group — authenticate_user! ends with !, a non-word char that can't form \b
      const SKIP_RE = /skip_before_action\s+:(?:authenticate_user!|require_login|authenticate)/;
      for (const { path, content } of changedFiles) {
        if (!isRubyFile(path) || isRubyTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (SKIP_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rails_skip_before_action_auth', file: path, line: i + 1,
              message: 'skip_before_action disabling authentication — requires explicit justification.',
              suggestion: 'Document why auth is skipped. If actions are truly public, only skip for the minimum required set.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── RB_005: params.permit! allows all parameters ───────────────────────────
  {
    id: 'RB_005',
    category: 'rails_mass_assignment_permit_all',
    description: 'params.permit! bypasses strong parameters and allows all user input through mass assignment.',
    severity: 'BLOCKER',
    tags: ['security', 'ruby', 'rails', 'mass-assignment', 'vibe-coding'],
    sinceVersion: '1.4.0',
    explain: {
      why: 'params.permit! (with exclamation mark) marks every parameter as permitted, completely bypassing Rails strong parameters protection. An attacker can then mass-assign any model attribute — including admin, role, is_admin, balance — by adding them to the request. AI uses this to "make the form work" without thinking about what should be permitted.',
      commonViolations: [
        'def user_params; params.require(:user).permit!; end',
        'User.create(params.permit!)',
      ],
      goodExample: 'def user_params\n  params.require(:user).permit(:name, :email, :bio)\nend',
      badExample: 'def user_params; params.require(:user).permit!; end # ❌ allows all attributes including admin',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rails_mass_assignment_permit_all', config.severityRules);
      const findings: Finding[] = [];
      // Match params anywhere in a chain (params.require(:x).permit! or bare params.permit!)
      const PERMIT_ALL_RE = /\bparams\b[^;#\n]*\.permit!/;
      for (const { path, content } of changedFiles) {
        if (!isRubyFile(path) || isRubyTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (PERMIT_ALL_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rails_mass_assignment_permit_all', file: path, line: i + 1,
              message: 'params.permit! bypasses strong parameters — all user-supplied attributes are allowed including privileged fields.',
              suggestion: 'Explicitly list permitted params: params.require(:user).permit(:name, :email)',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── RB_006: attr_accessible exposing role/admin fields ─────────────────────
  {
    id: 'RB_006',
    category: 'rails_unsafe_attributes',
    description: 'attr_accessible :admin, :role, or :is_admin exposes privileged fields to mass assignment.',
    severity: 'HIGH',
    tags: ['security', 'ruby', 'rails', 'mass-assignment', 'vibe-coding'],
    sinceVersion: '1.4.0',
    explain: {
      why: 'The Rails 3 attr_accessible pattern (still generated by AI from old training data) allows listed attributes to be set via mass assignment. Listing admin, role, or is_admin here means an attacker can escalate privileges by including these in any form POST or API request.',
      commonViolations: [
        'attr_accessible :name, :email, :admin',
        'attr_accessible :role',
        'attr_accessible :is_admin, :username',
      ],
      goodExample: '# Use Rails 4+ strong parameters. Never permit admin/role in params.\n# Set role/admin only in server-side code after authorization.',
      badExample: 'attr_accessible :name, :admin # ❌ admin is mass-assignable — privilege escalation',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rails_unsafe_attributes', config.severityRules);
      const findings: Finding[] = [];
      const UNSAFE_ATTR_RE = /\battr_accessible\b.*\b(admin|role|is_admin|superuser|staff)\b/;
      for (const { path, content } of changedFiles) {
        if (!isRubyFile(path) || isRubyTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (UNSAFE_ATTR_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rails_unsafe_attributes', file: path, line: i + 1,
              message: 'attr_accessible exposes admin/role field to mass assignment — privilege escalation vulnerability.',
              suggestion: 'Remove admin/role from attr_accessible. Set these fields only in server-side code after authorization checks.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── RB_007: CSRF protection disabled ───────────────────────────────────────
  {
    id: 'RB_007',
    category: 'rails_csrf_protect_disabled',
    description: 'protect_from_forgery with: :null_session or skip_before_action :verify_authenticity_token disables CSRF protection.',
    severity: 'HIGH',
    tags: ['security', 'ruby', 'rails', 'csrf', 'vibe-coding'],
    sinceVersion: '1.4.0',
    explain: {
      why: "CSRF attacks trick authenticated users into triggering state-changing requests. Rails' CSRF protection prevents this by requiring a per-session token on all non-GET requests. Disabling it or using :null_session (which drops the session instead of rejecting) leaves every state-changing endpoint open to cross-site request forgery.",
      commonViolations: [
        'protect_from_forgery with: :null_session',
        'skip_before_action :verify_authenticity_token',
      ],
      goodExample: '# Default Rails CSRF protection:\nprotect_from_forgery with: :exception\n# For API-only controllers, use token authentication instead.',
      badExample: 'protect_from_forgery with: :null_session # ❌ CSRF protection disabled',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rails_csrf_protect_disabled', config.severityRules);
      const findings: Finding[] = [];
      const NULL_SESSION_RE = /protect_from_forgery\s+with:\s*:null_session/;
      const SKIP_CSRF_RE = /skip_before_action\s+:verify_authenticity_token/;
      for (const { path, content } of changedFiles) {
        if (!isRubyFile(path) || isRubyTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (NULL_SESSION_RE.test(line) || SKIP_CSRF_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rails_csrf_protect_disabled', file: path, line: i + 1,
              message: 'CSRF protection disabled — cross-site request forgery attacks are possible for authenticated users.',
              suggestion: 'Use protect_from_forgery with: :exception (default). For APIs, use token-based authentication.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── RB_008: Open redirect via params ───────────────────────────────────────
  {
    id: 'RB_008',
    category: 'rails_open_redirect',
    description: 'redirect_to params[:return_to] or similar user-controlled URL without validation — open redirect.',
    severity: 'HIGH',
    tags: ['security', 'ruby', 'rails', 'open-redirect', 'vibe-coding'],
    sinceVersion: '1.4.0',
    explain: {
      why: 'Open redirects allow attackers to craft links on your trusted domain that redirect users to malicious sites. They are heavily used in phishing campaigns. AI frequently generates login/logout flows that redirect to params[:return_to] or params[:next] without validating the destination URL.',
      commonViolations: [
        'redirect_to params[:return_to]',
        'redirect_to params[:redirect_url]',
        'redirect_to params[:next]',
      ],
      goodExample: 'safe_url = params[:return_to]\nredirect_to(url_allowed?(safe_url) ? safe_url : root_path)',
      badExample: 'redirect_to params[:return_to] # ❌ open redirect — phishing vector',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rails_open_redirect', config.severityRules);
      const findings: Finding[] = [];
      const REDIRECT_PARAMS_RE = /redirect_to\s+params\[[:'"](return_to|redirect_url|next|redirect|url|back)['":]?\]/;
      for (const { path, content } of changedFiles) {
        if (!isRubyFile(path) || isRubyTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (REDIRECT_PARAMS_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rails_open_redirect', file: path, line: i + 1,
              message: 'redirect_to with user-supplied URL — open redirect vulnerability enables phishing via your domain.',
              suggestion: 'Validate the URL is safe and internal before redirecting. Use a url_allowed? check or redirect to named routes.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── RB_009: Command injection via shell with interpolation ─────────────────
  {
    id: 'RB_009',
    category: 'rails_command_injection',
    description: 'Shell command with string interpolation — system("#{...}"), backtick interpolation, exec, %x, IO.popen, Open3.',
    severity: 'BLOCKER',
    tags: ['security', 'ruby', 'rails', 'command-injection', 'vibe-coding'],
    sinceVersion: '1.4.0',
    explain: {
      why: 'Ruby provides multiple ways to run shell commands, all of which are vulnerable when user input is interpolated into the command string. Characters like ;, &&, |, $(), and backticks allow injection of additional commands. AI assistants frequently use string interpolation for convenience without considering that filenames, usernames, or any user-supplied value can contain shell metacharacters.',
      commonViolations: [
        'system("convert #{filename} output.png")',
        '`ffmpeg -i #{params[:video]}`',
        'exec("rm #{path}")',
        'IO.popen("gzip #{file}")',
      ],
      goodExample: 'system("convert", filename, "output.png") # array form — no shell interpolation',
      badExample: 'system("convert #{filename} output.png") # ❌ shell injection if filename contains ; or &&',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rails_command_injection', config.severityRules);
      const findings: Finding[] = [];
      // system("#{"), exec("#{"), %x{#{, IO.popen("#{, Open3.capture*("#{
      const CMD_RE = /(?:system|exec|spawn)\s*\(\s*["'].*#\{|`[^`]*#\{[^`]*`|%x\{[^}]*#\{|(?:IO\.popen|Open3\.capture[23e]?)\s*\(\s*["'].*#\{/;
      for (const { path, content } of changedFiles) {
        if (!isRubyFile(path) || isRubyTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (CMD_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rails_command_injection', file: path, line: i + 1,
              message: 'Shell command with string interpolation — command injection if any variable is user-controlled.',
              suggestion: 'Use array form: system("convert", filename, "output.png") — never interpolate into shell strings.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── RB_010: Path traversal via user-controlled file path ───────────────────
  {
    id: 'RB_010',
    category: 'rails_path_traversal',
    description: 'File.read/File.open/send_file/render file: with params[] — user-controlled file path traversal.',
    severity: 'BLOCKER',
    tags: ['security', 'ruby', 'rails', 'path-traversal', 'vibe-coding'],
    sinceVersion: '1.4.0',
    explain: {
      why: 'Path traversal (../../etc/passwd) lets attackers read or write arbitrary files on the server. AI-generated file-serving code frequently passes params values directly to File.read, File.open, send_file, or render file: without constraining the path to a safe directory.',
      commonViolations: [
        'File.read(params[:path])',
        'File.open(params[:filename])',
        'send_file(params[:file])',
        'render file: params[:template]',
      ],
      goodExample: 'safe_path = Rails.root.join("public", "uploads", File.basename(params[:filename]))\nraise "Invalid path" unless safe_path.to_s.start_with?(Rails.root.join("public").to_s)\nsend_file safe_path',
      badExample: 'File.read(params[:path]) # ❌ path traversal — attacker can read /etc/passwd',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rails_path_traversal', config.severityRules);
      const findings: Finding[] = [];
      const PATH_TRAVERSAL_RE = /(?:File\.read|File\.open|send_file|render\s+file:)\s*\(?\s*params\s*\[/;
      for (const { path, content } of changedFiles) {
        if (!isRubyFile(path) || isRubyTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (PATH_TRAVERSAL_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rails_path_traversal', file: path, line: i + 1,
              message: 'File operation with user-controlled path — path traversal allows reading arbitrary server files.',
              suggestion: 'Use Rails.root.join() with File.basename() and verify the resolved path stays within the intended directory.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── RB_011: send_file with user-controlled variable path ───────────────────
  {
    id: 'RB_011',
    category: 'rails_send_file_user_input',
    description: 'send_file with a variable path argument (not a string literal or Rails.root-based path) — path traversal risk.',
    severity: 'BLOCKER',
    tags: ['security', 'ruby', 'rails', 'path-traversal', 'vibe-coding'],
    sinceVersion: '1.4.0',
    explain: {
      why: 'send_file streams a file to the browser. When the path comes from a variable (not a literal or Rails.root-anchored path), an attacker who controls that variable can request any file on the filesystem. AI assistants commonly write send_file(user_path) or send_file(@attachment.path) where the path originated from user input.',
      commonViolations: [
        'send_file @upload.file_path',
        'send_file user_path',
        'send_file file_location',
      ],
      goodExample: 'safe = Rails.root.join("storage", File.basename(@upload.filename))\nsend_file safe.to_s, disposition: "attachment"',
      badExample: 'send_file @upload.file_path # ❌ if file_path is user-controlled, path traversal',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rails_send_file_user_input', config.severityRules);
      const findings: Finding[] = [];
      // send_file followed by a variable (not a string literal, not Rails.root)
      const SEND_FILE_VAR_RE = /\bsend_file\s+(?!["'\/]|Rails\.root)[@\w]/;
      for (const { path, content } of changedFiles) {
        if (!isRubyFile(path) || isRubyTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (SEND_FILE_VAR_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rails_send_file_user_input', file: path, line: i + 1,
              message: 'send_file with a variable path — path traversal risk if the variable is derived from user input.',
              suggestion: 'Anchor the path to Rails.root.join() and use File.basename() to strip directory components.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── RB_012: Hardcoded secret_key_base in YAML ──────────────────────────────
  {
    id: 'RB_012',
    category: 'rails_hardcoded_secret_key_base',
    description: 'secret_key_base with a literal string value in a YAML config file — credential in source code.',
    severity: 'BLOCKER',
    tags: ['security', 'ruby', 'rails', 'secrets', 'vibe-coding'],
    sinceVersion: '1.4.0',
    explain: {
      why: 'The Rails secret_key_base is used to sign and verify session cookies. A leaked key lets attackers forge sessions for any user, including admins. AI assistants generate secrets.yml and credentials.yml.enc examples with literal strings that developers ship unchanged.',
      commonViolations: [
        'secret_key_base: "abc123verylong..."  # in secrets.yml',
        'production:\n  secret_key_base: "hardcoded-secret"',
      ],
      goodExample: 'secret_key_base: <%= ENV["SECRET_KEY_BASE"] %>',
      badExample: 'secret_key_base: "abc123xyz..." # ❌ hardcoded — anyone with repo access can forge sessions',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rails_hardcoded_secret_key_base', config.severityRules);
      const findings: Finding[] = [];
      // Only check YAML files; match secret_key_base: "..." (literal, not ENV erb)
      const SECRET_KEY_RE = /^\s*secret_key_base:\s*["'][^"']{8,}["']/;
      for (const { path, content } of changedFiles) {
        if (!path.endsWith('.yml') && !path.endsWith('.yaml')) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (SECRET_KEY_RE.test(line) && !/ENV\b|<%= /.test(line)) {
            findings.push({
              severity: sev, category: 'rails_hardcoded_secret_key_base', file: path, line: i + 1,
              message: 'secret_key_base is hardcoded — session cookies can be forged by anyone with source access.',
              suggestion: 'Use ERB environment expansion: secret_key_base: <%= ENV["SECRET_KEY_BASE"] %>',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── RB_013: Debug mode in production config ─────────────────────────────────
  {
    id: 'RB_013',
    category: 'rails_debug_mode_production',
    description: 'config.log_level = :debug or consider_all_requests_local = true in a production config file.',
    severity: 'HIGH',
    tags: ['security', 'ruby', 'rails', 'config', 'vibe-coding'],
    sinceVersion: '1.4.0',
    explain: {
      why: 'Debug log level in production exposes SQL queries, full request/response bodies, and application internals to log aggregators. consider_all_requests_local = true shows full stack traces and source code in browser error pages — the equivalent of Django DEBUG = True — leaking internal paths and credentials.',
      commonViolations: [
        'config.log_level = :debug  # in config/environments/production.rb',
        'config.consider_all_requests_local = true',
      ],
      goodExample: 'config.log_level = :info  # or :warn in production.rb',
      badExample: 'config.log_level = :debug # ❌ in production.rb — leaks SQL queries and internals to logs',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rails_debug_mode_production', config.severityRules);
      const findings: Finding[] = [];
      const DEBUG_LOG_RE = /config\.log_level\s*=\s*:debug\b/;
      const LOCAL_RE = /config\.consider_all_requests_local\s*=\s*true\b/;
      for (const { path, content } of changedFiles) {
        if (!isRubyFile(path)) continue;
        if (!path.includes('production')) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (DEBUG_LOG_RE.test(line) || LOCAL_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rails_debug_mode_production', file: path, line: i + 1,
              message: 'Debug configuration in production file — exposes internal details and SQL queries.',
              suggestion: 'Set config.log_level = :info and config.consider_all_requests_local = false in production.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── RB_014: XSS via raw() or html_safe on user input ──────────────────────
  {
    id: 'RB_014',
    category: 'rails_xss_raw',
    description: 'raw() or .html_safe called on user-controlled content — XSS vulnerability.',
    severity: 'HIGH',
    tags: ['security', 'ruby', 'rails', 'xss', 'vibe-coding'],
    sinceVersion: '1.4.0',
    explain: {
      why: 'Rails ERB templates auto-escape HTML output by default. raw() and .html_safe bypass this protection. When the value comes from params, a database field edited by users, or an interpolated string containing variables, an attacker can inject arbitrary JavaScript. This is the most common XSS vector in Rails.',
      commonViolations: [
        '<%= raw(params[:message]) %>',
        '<%= @user_bio.html_safe %>',
        '<%= "Hello #{params[:name]}".html_safe %>',
      ],
      goodExample: '<%= @user_bio %> <%# auto-escaped — safe %>',
      badExample: '<%= raw(params[:message]) %> <%# ❌ XSS if message contains <script> %>',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rails_xss_raw', config.severityRules);
      const findings: Finding[] = [];
      // ERB: <%= raw(...) or .html_safe in template output
      const ERB_RAW_RE = /<%=\s*raw\s*\(|<%=\s*[\w@.]+\.html_safe\b/;
      // Ruby: .html_safe on an interpolated string
      const RB_HTML_SAFE_RE = /["'].*#\{[^}]+\}.*["']\.html_safe\b/;
      for (const { path, content } of changedFiles) {
        if (!isErb(path) && !isRubyFile(path)) continue;
        if (isRubyTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#|^\s*<%#/.test(line)) return;
          if (ERB_RAW_RE.test(line) || RB_HTML_SAFE_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rails_xss_raw', file: path, line: i + 1,
              message: 'raw() or html_safe bypasses HTML escaping — XSS vulnerability if content is user-controlled.',
              suggestion: 'Remove raw()/html_safe. Use content_tag() or sanitize() for HTML you must render.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── RB_015: render inline with string interpolation ─────────────────────────
  {
    id: 'RB_015',
    category: 'rails_render_inline_xss',
    description: 'render inline: "..." with string interpolation — ERB in a string bypasses template escaping.',
    severity: 'MEDIUM',
    tags: ['security', 'ruby', 'rails', 'xss', 'vibe-coding'],
    sinceVersion: '1.4.0',
    explain: {
      why: 'render inline: evaluates an ERB string at runtime. When the string is built with Ruby string interpolation (#{variable}), any user-controlled content in that variable is rendered as raw ERB/HTML without the normal auto-escaping pipeline. This is functionally equivalent to calling raw() on the content.',
      commonViolations: [
        'render inline: "<b>#{params[:name]}</b>"',
        'render inline: "Welcome #{@user.name}, your code is #{code}"',
      ],
      goodExample: 'render :show  # use a proper view template with auto-escaping',
      badExample: 'render inline: "<b>#{params[:name]}</b>" # ❌ no escaping — XSS',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rails_render_inline_xss', config.severityRules);
      const findings: Finding[] = [];
      const RENDER_INLINE_RE = /render\s+inline:\s*["'].*#\{/;
      for (const { path, content } of changedFiles) {
        if (!isRubyFile(path) || isRubyTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (RENDER_INLINE_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rails_render_inline_xss', file: path, line: i + 1,
              message: 'render inline: with string interpolation — bypasses template auto-escaping, XSS risk.',
              suggestion: 'Use a proper view template file instead of inline ERB strings.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── RB_016: YAML.load (unsafe deserialization) ─────────────────────────────
  {
    id: 'RB_016',
    category: 'rails_yaml_load_unsafe',
    description: 'YAML.load() without safe_load — executes arbitrary Ruby code via !!ruby/object tags.',
    severity: 'BLOCKER',
    tags: ['security', 'ruby', 'rails', 'deserialization', 'rce', 'vibe-coding'],
    sinceVersion: '1.4.0',
    explain: {
      why: "Ruby's YAML parser supports type tags like !!ruby/object that instantiate arbitrary Ruby classes during deserialization. YAML.load() processes these tags, meaning an attacker who controls the YAML input can achieve remote code execution. YAML.safe_load() restricts parsing to primitive types only.",
      commonViolations: [
        'YAML.load(params[:config])',
        'YAML.load(File.read(user_path))',
        'YAML.load(request.body.read)',
      ],
      goodExample: 'YAML.safe_load(params[:config], permitted_classes: [Symbol])',
      badExample: 'YAML.load(params[:config]) # ❌ RCE via !!ruby/object type tag',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rails_yaml_load_unsafe', config.severityRules);
      const findings: Finding[] = [];
      // Match YAML.load( but not YAML.load_file or YAML.safe_load
      const YAML_LOAD_RE = /\bYAML\.load\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isRubyFile(path) || isRubyTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (YAML_LOAD_RE.test(line) && !/safe_load/.test(line)) {
            findings.push({
              severity: sev, category: 'rails_yaml_load_unsafe', file: path, line: i + 1,
              message: 'YAML.load() can execute arbitrary Ruby code — use YAML.safe_load() instead.',
              suggestion: 'Replace YAML.load() with YAML.safe_load(). Specify permitted_classes if you need Symbol or Date.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── RB_017: Marshal.load deserialization ───────────────────────────────────
  {
    id: 'RB_017',
    category: 'rails_marshal_load',
    description: 'Marshal.load() or Marshal.restore() deserializes arbitrary Ruby objects — RCE if input is attacker-controlled.',
    severity: 'BLOCKER',
    tags: ['security', 'ruby', 'rails', 'deserialization', 'rce', 'vibe-coding'],
    sinceVersion: '1.4.0',
    explain: {
      why: "Ruby's Marshal format serializes complete Ruby objects including Proc and method references. Deserializing attacker-controlled Marshal data is equivalent to remote code execution — an attacker can craft a payload that runs arbitrary Ruby code when Marshal.load is called. Never use Marshal with untrusted data.",
      commonViolations: [
        'Marshal.load(params[:data])',
        'Marshal.restore(Base64.decode64(cookie_value))',
        'Marshal.load(redis.get("session:#{id}"))',
      ],
      goodExample: 'JSON.parse(params[:data])  # safe: JSON cannot embed executable code',
      badExample: 'Marshal.load(params[:data]) # ❌ RCE — attacker controls deserialized object graph',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rails_marshal_load', config.severityRules);
      const findings: Finding[] = [];
      const MARSHAL_RE = /\bMarshal\.(?:load|restore)\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isRubyFile(path) || isRubyTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (MARSHAL_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rails_marshal_load', file: path, line: i + 1,
              message: 'Marshal.load/restore — arbitrary object deserialization, remote code execution if input is attacker-controlled.',
              suggestion: 'Use JSON.parse() instead. If you must use Marshal, only deserialize data you generated and signed yourself.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── RB_018: Logging sensitive values ───────────────────────────────────────
  {
    id: 'RB_018',
    category: 'rails_log_sensitive',
    description: 'Rails.logger or logger logging interpolated strings containing password, token, secret, or api_key.',
    severity: 'MEDIUM',
    tags: ['security', 'ruby', 'rails', 'secrets', 'logging'],
    sinceVersion: '1.4.0',
    explain: {
      why: 'Logging sensitive values exposes them in log aggregators, monitoring dashboards, and CI output — often permanently retained. AI assistants add debug logging that includes full params hashes or interpolates secret variable names directly into log messages.',
      commonViolations: [
        'Rails.logger.info "User logged in with password=#{password}"',
        'logger.debug "API call with token: #{api_token}"',
        'Rails.logger.error "Failed: secret=#{secret}"',
      ],
      goodExample: 'Rails.logger.info "User #{user.id} logged in successfully"  # log identifier, not credential',
      badExample: 'Rails.logger.info "password=#{password}" # ❌ leaks credential to logs',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rails_log_sensitive', config.severityRules);
      const findings: Finding[] = [];
      const LOG_RE = /(?:Rails\.logger|logger)\s*\.\s*(?:debug|info|warn|error|fatal)\s+["'].*#\{[^}]*(?:password|token|secret|api_key|credit_card|cvv|ssn)[^}]*\}/i;
      for (const { path, content } of changedFiles) {
        if (!isRubyFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (LOG_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rails_log_sensitive', file: path, line: i + 1,
              message: 'Logging interpolated sensitive value (password/token/secret) — credential will appear in log output.',
              suggestion: 'Never log credentials. Log only non-sensitive identifiers like user IDs or request IDs.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── RB_019: Regex with ^ and $ anchors in validation (multiline bypass) ─────
  {
    id: 'RB_019',
    category: 'rails_regex_dos',
    description: 'Model validation regex uses ^ and $ anchors instead of \\A and \\z — allows multiline bypass in Ruby.',
    severity: 'MEDIUM',
    tags: ['security', 'ruby', 'rails', 'regex', 'validation'],
    sinceVersion: '1.4.0',
    explain: {
      why: "In Ruby, ^ matches the start of any line and $ matches the end of any line, not the start/end of the whole string. This means a validator using /^safe_pattern$/ can be bypassed by a value like \"malicious\\nsafe_pattern\". The correct anchors are \\A (start of string) and \\z (end of string). Rails even warns about this.",
      commonViolations: [
        'validates :username, format: { with: /^[a-z0-9]+$/ }',
        'validates :slug, format: { with: /^[a-z-]+$/ }',
      ],
      goodExample: 'validates :username, format: { with: /\\A[a-z0-9]+\\z/ }',
      badExample: 'validates :username, format: { with: /^[a-z0-9]+$/ } # ❌ multiline bypass possible',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rails_regex_dos', config.severityRules);
      const findings: Finding[] = [];
      // format: { with: /^.../ } or /...$/ — catches ^ at start or $ at end of regex
      const VALIDATE_REGEX_RE = /validates\s+:\w+.*format:.*with:\s*\/\^|validates\s+:\w+.*format:.*with:\s*\/[^/]*\$\//;
      for (const { path, content } of changedFiles) {
        if (!isRubyFile(path) || isRubyTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (VALIDATE_REGEX_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rails_regex_dos', file: path, line: i + 1,
              message: 'Validation regex uses ^ or $ anchors — use \\A and \\z instead to prevent multiline bypass.',
              suggestion: 'Replace /^pattern$/ with /\\Apattern\\z/ in all model format validations.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── RB_020: Gemfile with HTTP gem source ───────────────────────────────────
  {
    id: 'RB_020',
    category: 'rails_gem_source_http',
    description: "source 'http://' (not HTTPS) in Gemfile — gem installs over HTTP are MITM-vulnerable.",
    severity: 'MEDIUM',
    tags: ['security', 'ruby', 'rails', 'dependencies', 'supply-chain'],
    sinceVersion: '1.4.0',
    explain: {
      why: "A Gemfile source over plain HTTP allows a network attacker (or compromised router) to serve a modified gem in place of the real one. The attacker's gem runs arbitrary code during bundle install. AI assistants occasionally generate Gemfile examples with http:// sources copied from old tutorials.",
      commonViolations: [
        "source 'http://rubygems.org'",
        "source 'http://gems.example.com'",
      ],
      goodExample: "source 'https://rubygems.org'",
      badExample: "source 'http://rubygems.org' # ❌ MITM-vulnerable gem source",
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rails_gem_source_http', config.severityRules);
      const findings: Finding[] = [];
      const HTTP_SOURCE_RE = /^\s*source\s+['"]http:\/\//;
      for (const { path, content } of changedFiles) {
        if (!path.endsWith('Gemfile') && !path.endsWith('gemspec')) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (HTTP_SOURCE_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rails_gem_source_http', file: path, line: i + 1,
              message: "Gem source uses HTTP — MITM attack can substitute malicious gems during bundle install.",
              suggestion: "Change to HTTPS: source 'https://rubygems.org'",
            });
          }
        });
      }
      return findings;
    },
  },

];
