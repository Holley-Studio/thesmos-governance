// @vitest-environment node
/**
 * Unit tests for Ruby on Rails security rules (RB_001–020).
 *
 * Each test exercises ONE rule by passing crafted changedFiles.
 * "fires" tests verify the rule detects bad code.
 * "safe" tests verify no false positives on correct code.
 */
import { describe, it, expect } from 'vitest';
import { RUBY_RULES } from './ruby';
import { CONFIG_DEFAULTS } from '../config';
import type { DetectInput, ScanResult } from '../types';

const EMPTY_SCAN: ScanResult = {
  _generatedSections: [],
  generatedAt: '2024-01-01T00:00:00.000Z',
  scanVersion: '2.0.0',
  pages: [],
  apiRoutes: [],
  componentCount: 0,
  sharedUiFiles: [],
  designSystemFiles: [],
  storeFiles: [],
  testFiles: [],
  largeFiles: [],
  riskyFiles: [],
  scriptFiles: [],
  envFiles: [],
  clientBoundaryRisks: [],
};

function rule(id: string) {
  const r = RUBY_RULES.find((r) => r.id === id);
  if (!r) throw new Error(`Rule ${id} not found`);
  return r;
}

function detect(ruleId: string, files: Array<{ path: string; content: string }>) {
  const input: DetectInput = { scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: files };
  return rule(ruleId).detect(input);
}

// ── RB_001: SQL injection via ActiveRecord string interpolation ───────────────

describe('RB_001 — SQL injection via ActiveRecord string interpolation', () => {
  it('fires on .where with string interpolation', () => {
    const findings = detect('RB_001', [
      { path: 'app/models/user.rb', content: 'User.where("email = \'#{params[:email]}\'")\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rails_sql_injection');
    expect(findings[0]!.line).toBe(1);
  });

  it('fires on .find_by with interpolation', () => {
    const findings = detect('RB_001', [
      { path: 'app/models/post.rb', content: 'Post.find_by("title = #{params[:title]}")\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on .order with interpolation', () => {
    const findings = detect('RB_001', [
      { path: 'app/controllers/items_controller.rb', content: 'Item.order("#{params[:sort]} ASC")\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on .joins with interpolation', () => {
    const findings = detect('RB_001', [
      { path: 'app/models/order.rb', content: 'Order.joins("LEFT JOIN #{table_name} ON ...")\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on parameterized where', () => {
    const findings = detect('RB_001', [
      { path: 'app/models/user.rb', content: 'User.where("email = ?", params[:email])\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on hash-style where', () => {
    const findings = detect('RB_001', [
      { path: 'app/models/user.rb', content: 'User.where(email: params[:email])\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on spec files', () => {
    const findings = detect('RB_001', [
      { path: 'spec/models/user_spec.rb', content: 'User.where("email = \'#{email}\'")\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-Ruby files', () => {
    const findings = detect('RB_001', [
      { path: 'app/views/users/index.html.erb', content: 'User.where("email = \'#{params[:email]}\'")\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RB_002: Raw SQL injection via connection.execute ─────────────────────────

describe('RB_002 — raw SQL injection via connection.execute', () => {
  it('fires on connection.execute with interpolation', () => {
    const findings = detect('RB_002', [
      { path: 'app/models/report.rb', content: 'ActiveRecord::Base.connection.execute("SELECT * FROM users WHERE id = #{params[:id]}")\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rails_raw_sql_injection');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on conn.execute with interpolation', () => {
    const findings = detect('RB_002', [
      { path: 'lib/tasks/migrate.rb', content: 'conn.execute("DELETE FROM sessions WHERE token = \'#{token}\'")\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on connection.execute without interpolation', () => {
    const findings = detect('RB_002', [
      { path: 'app/models/report.rb', content: 'ActiveRecord::Base.connection.execute("SELECT * FROM users WHERE active = true")\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on spec files', () => {
    const findings = detect('RB_002', [
      { path: 'spec/models/report_spec.rb', content: 'connection.execute("SELECT * FROM users WHERE id = #{id}")\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RB_003: Controller missing authenticate before_action ────────────────────

describe('RB_003 — controller missing authentication before_action', () => {
  it('fires when controller has CRUD actions but no auth', () => {
    const findings = detect('RB_003', [
      {
        path: 'app/controllers/posts_controller.rb',
        content: [
          'class PostsController < ApplicationController',
          '  def index',
          '    @posts = Post.all',
          '  end',
          '  def destroy',
          '    Post.find(params[:id]).destroy',
          '  end',
          'end',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rails_missing_authenticate');
  });

  it('does not fire when before_action :authenticate_user! is present', () => {
    const findings = detect('RB_003', [
      {
        path: 'app/controllers/posts_controller.rb',
        content: [
          'class PostsController < ApplicationController',
          '  before_action :authenticate_user!',
          '  def index',
          '    @posts = Post.all',
          '  end',
          'end',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on ApplicationController itself', () => {
    const findings = detect('RB_003', [
      {
        path: 'app/controllers/application_controller.rb',
        content: [
          'class ApplicationController < ActionController::Base',
          '  def index; end',
          '  def show; end',
          'end',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when require_login before_action is present', () => {
    const findings = detect('RB_003', [
      {
        path: 'app/controllers/dashboard_controller.rb',
        content: 'class DashboardController < ApplicationController\n  before_action :require_login\n  def index; end\nend\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on spec files', () => {
    const findings = detect('RB_003', [
      {
        path: 'spec/controllers/posts_controller_spec.rb',
        content: 'class PostsController < ApplicationController\n  def index; end\nend\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RB_004: skip_before_action disabling auth ────────────────────────────────

describe('RB_004 — skip_before_action disabling authentication', () => {
  it('fires on skip_before_action :authenticate_user!', () => {
    const findings = detect('RB_004', [
      { path: 'app/controllers/api_controller.rb', content: 'skip_before_action :authenticate_user!, only: [:index]\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rails_skip_before_action_auth');
  });

  it('fires on skip_before_action :require_login', () => {
    const findings = detect('RB_004', [
      { path: 'app/controllers/public_controller.rb', content: 'skip_before_action :require_login\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on skip_before_action for non-auth filters', () => {
    const findings = detect('RB_004', [
      { path: 'app/controllers/api_controller.rb', content: 'skip_before_action :verify_format\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on commented-out skip_before_action', () => {
    const findings = detect('RB_004', [
      { path: 'app/controllers/api_controller.rb', content: '# skip_before_action :authenticate_user!\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on spec files', () => {
    const findings = detect('RB_004', [
      { path: 'spec/controllers/api_spec.rb', content: 'skip_before_action :authenticate_user!\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RB_005: params.permit! allows all parameters ─────────────────────────────

describe('RB_005 — params.permit! bypasses strong parameters', () => {
  it('fires on params.require(:x).permit!', () => {
    const findings = detect('RB_005', [
      { path: 'app/controllers/users_controller.rb', content: 'def user_params; params.require(:user).permit!; end\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rails_mass_assignment_permit_all');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on bare params.permit!', () => {
    const findings = detect('RB_005', [
      { path: 'app/controllers/items_controller.rb', content: 'Item.create(params.permit!)\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on params.permit with specific fields', () => {
    const findings = detect('RB_005', [
      { path: 'app/controllers/users_controller.rb', content: 'def user_params; params.require(:user).permit(:name, :email); end\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on spec files', () => {
    const findings = detect('RB_005', [
      { path: 'spec/controllers/users_controller_spec.rb', content: 'params.require(:user).permit!\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RB_006: attr_accessible with admin/role fields ───────────────────────────

describe('RB_006 — attr_accessible exposing privileged fields', () => {
  it('fires on attr_accessible :admin', () => {
    const findings = detect('RB_006', [
      { path: 'app/models/user.rb', content: 'attr_accessible :name, :email, :admin\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rails_unsafe_attributes');
  });

  it('fires on attr_accessible :role', () => {
    const findings = detect('RB_006', [
      { path: 'app/models/user.rb', content: 'attr_accessible :role\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on attr_accessible :is_admin', () => {
    const findings = detect('RB_006', [
      { path: 'app/models/user.rb', content: 'attr_accessible :username, :is_admin\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on attr_accessible with safe fields only', () => {
    const findings = detect('RB_006', [
      { path: 'app/models/user.rb', content: 'attr_accessible :name, :email, :bio\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on spec files', () => {
    const findings = detect('RB_006', [
      { path: 'spec/models/user_spec.rb', content: 'attr_accessible :name, :admin\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RB_007: CSRF protection disabled ─────────────────────────────────────────

describe('RB_007 — CSRF protection disabled', () => {
  it('fires on protect_from_forgery with: :null_session', () => {
    const findings = detect('RB_007', [
      { path: 'app/controllers/application_controller.rb', content: 'protect_from_forgery with: :null_session\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rails_csrf_protect_disabled');
  });

  it('fires on skip_before_action :verify_authenticity_token', () => {
    const findings = detect('RB_007', [
      { path: 'app/controllers/api_controller.rb', content: 'skip_before_action :verify_authenticity_token\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on protect_from_forgery with: :exception', () => {
    const findings = detect('RB_007', [
      { path: 'app/controllers/application_controller.rb', content: 'protect_from_forgery with: :exception\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on commented-out skip', () => {
    const findings = detect('RB_007', [
      { path: 'app/controllers/api_controller.rb', content: '# skip_before_action :verify_authenticity_token\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on spec files', () => {
    const findings = detect('RB_007', [
      { path: 'spec/controllers/api_spec.rb', content: 'skip_before_action :verify_authenticity_token\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RB_008: Open redirect via params ─────────────────────────────────────────

describe('RB_008 — open redirect via user-supplied params', () => {
  it('fires on redirect_to params[:return_to]', () => {
    const findings = detect('RB_008', [
      { path: 'app/controllers/sessions_controller.rb', content: 'redirect_to params[:return_to]\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rails_open_redirect');
  });

  it('fires on redirect_to params[:redirect_url]', () => {
    const findings = detect('RB_008', [
      { path: 'app/controllers/auth_controller.rb', content: 'redirect_to params[:redirect_url]\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on redirect_to params[:next]', () => {
    const findings = detect('RB_008', [
      { path: 'app/controllers/auth_controller.rb', content: 'redirect_to params[:next]\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on redirect_to with a named route', () => {
    const findings = detect('RB_008', [
      { path: 'app/controllers/sessions_controller.rb', content: 'redirect_to root_path\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on spec files', () => {
    const findings = detect('RB_008', [
      { path: 'spec/controllers/sessions_spec.rb', content: 'redirect_to params[:return_to]\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RB_009: Command injection ─────────────────────────────────────────────────

describe('RB_009 — command injection via shell interpolation', () => {
  it('fires on system() with interpolation', () => {
    const findings = detect('RB_009', [
      { path: 'app/services/converter.rb', content: 'system("convert #{filename} output.png")\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rails_command_injection');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on backtick with interpolation', () => {
    const findings = detect('RB_009', [
      { path: 'app/services/ffmpeg.rb', content: '`ffmpeg -i #{params[:video]} output.mp4`\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on exec() with interpolation', () => {
    const findings = detect('RB_009', [
      { path: 'lib/runner.rb', content: 'exec("rm #{path}")\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on IO.popen with interpolation', () => {
    const findings = detect('RB_009', [
      { path: 'app/services/compress.rb', content: 'IO.popen("gzip #{file}")\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on Open3.capture2 with interpolation', () => {
    const findings = detect('RB_009', [
      { path: 'app/services/process.rb', content: 'Open3.capture2("ls #{dir}")\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on system() with array form', () => {
    const findings = detect('RB_009', [
      { path: 'app/services/converter.rb', content: 'system("convert", filename, "output.png")\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on system() with no interpolation', () => {
    const findings = detect('RB_009', [
      { path: 'app/services/converter.rb', content: 'system("ls -la")\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on spec files', () => {
    const findings = detect('RB_009', [
      { path: 'spec/services/converter_spec.rb', content: 'system("convert #{filename} output.png")\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RB_010: Path traversal via user-controlled params ────────────────────────

describe('RB_010 — path traversal via user-controlled file path', () => {
  it('fires on File.read(params[...])', () => {
    const findings = detect('RB_010', [
      { path: 'app/controllers/files_controller.rb', content: 'File.read(params[:path])\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rails_path_traversal');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on File.open(params[...])', () => {
    const findings = detect('RB_010', [
      { path: 'app/controllers/downloads_controller.rb', content: 'File.open(params[:filename])\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on send_file(params[...])', () => {
    const findings = detect('RB_010', [
      { path: 'app/controllers/downloads_controller.rb', content: 'send_file(params[:file])\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on render file: params[...]', () => {
    const findings = detect('RB_010', [
      { path: 'app/controllers/pages_controller.rb', content: 'render file: params[:template]\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on File.read with a literal path', () => {
    const findings = detect('RB_010', [
      { path: 'app/services/loader.rb', content: 'File.read(Rails.root.join("config", "data.json"))\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on spec files', () => {
    const findings = detect('RB_010', [
      { path: 'spec/controllers/files_spec.rb', content: 'File.read(params[:path])\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RB_011: send_file with variable path ────────────────────────────────────

describe('RB_011 — send_file with variable path argument', () => {
  it('fires on send_file with instance variable', () => {
    const findings = detect('RB_011', [
      { path: 'app/controllers/downloads_controller.rb', content: 'send_file @upload.file_path\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rails_send_file_user_input');
  });

  it('fires on send_file with local variable', () => {
    const findings = detect('RB_011', [
      { path: 'app/controllers/downloads_controller.rb', content: 'send_file user_path\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on send_file with literal string', () => {
    const findings = detect('RB_011', [
      { path: 'app/controllers/downloads_controller.rb', content: 'send_file "/var/app/static/readme.pdf"\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on send_file with Rails.root', () => {
    const findings = detect('RB_011', [
      { path: 'app/controllers/downloads_controller.rb', content: 'send_file Rails.root.join("public", "file.pdf")\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on spec files', () => {
    const findings = detect('RB_011', [
      { path: 'spec/controllers/downloads_spec.rb', content: 'send_file user_path\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RB_012: Hardcoded secret_key_base ────────────────────────────────────────

describe('RB_012 — hardcoded secret_key_base in YAML', () => {
  it('fires on literal secret_key_base in secrets.yml', () => {
    const findings = detect('RB_012', [
      { path: 'config/secrets.yml', content: 'production:\n  secret_key_base: "abc123xyzverylongvalue"\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rails_hardcoded_secret_key_base');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on literal secret_key_base in any yml', () => {
    const findings = detect('RB_012', [
      { path: 'config/application.yml', content: 'secret_key_base: "my-very-secret-key-here"\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when using ENV expansion', () => {
    const findings = detect('RB_012', [
      { path: 'config/secrets.yml', content: 'production:\n  secret_key_base: <%= ENV["SECRET_KEY_BASE"] %>\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-yml files', () => {
    const findings = detect('RB_012', [
      { path: 'config/initializers/secret.rb', content: 'secret_key_base: "abc123"\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on short placeholder values', () => {
    const findings = detect('RB_012', [
      { path: 'config/secrets.yml', content: 'secret_key_base: ""\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RB_013: Debug mode in production ─────────────────────────────────────────

describe('RB_013 — debug mode in production config', () => {
  it('fires on config.log_level = :debug in production file', () => {
    const findings = detect('RB_013', [
      { path: 'config/environments/production.rb', content: 'config.log_level = :debug\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rails_debug_mode_production');
  });

  it('fires on consider_all_requests_local = true in production file', () => {
    const findings = detect('RB_013', [
      { path: 'config/environments/production.rb', content: 'config.consider_all_requests_local = true\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on :info log level in production', () => {
    const findings = detect('RB_013', [
      { path: 'config/environments/production.rb', content: 'config.log_level = :info\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on :debug in development file', () => {
    const findings = detect('RB_013', [
      { path: 'config/environments/development.rb', content: 'config.log_level = :debug\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-Ruby files', () => {
    const findings = detect('RB_013', [
      { path: 'config/production.yml', content: 'log_level: debug\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RB_014: XSS via raw() or html_safe ───────────────────────────────────────

describe('RB_014 — XSS via raw() or html_safe on user input', () => {
  it('fires on raw() in ERB template', () => {
    const findings = detect('RB_014', [
      { path: 'app/views/posts/show.html.erb', content: '<%= raw(params[:message]) %>\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rails_xss_raw');
  });

  it('fires on .html_safe in ERB template', () => {
    const findings = detect('RB_014', [
      { path: 'app/views/users/profile.html.erb', content: '<%= @user_bio.html_safe %>\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on .html_safe on interpolated string in Ruby', () => {
    const findings = detect('RB_014', [
      { path: 'app/helpers/application_helper.rb', content: '"Hello #{params[:name]}".html_safe\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on plain ERB output tag', () => {
    const findings = detect('RB_014', [
      { path: 'app/views/posts/show.html.erb', content: '<%= @post.title %>\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on ERB comment', () => {
    const findings = detect('RB_014', [
      { path: 'app/views/posts/show.html.erb', content: '<%# raw(@post.body) %>\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on spec files', () => {
    const findings = detect('RB_014', [
      { path: 'spec/helpers/application_helper_spec.rb', content: '"Hello #{name}".html_safe\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RB_015: render inline with interpolation ─────────────────────────────────

describe('RB_015 — render inline: with string interpolation', () => {
  it('fires on render inline with interpolated variable', () => {
    const findings = detect('RB_015', [
      { path: 'app/controllers/pages_controller.rb', content: 'render inline: "<b>#{params[:name]}</b>"\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rails_render_inline_xss');
  });

  it('fires on render inline with instance variable interpolation', () => {
    const findings = detect('RB_015', [
      { path: 'app/controllers/pages_controller.rb', content: 'render inline: "Welcome #{@user.name}"\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on render inline with no interpolation', () => {
    const findings = detect('RB_015', [
      { path: 'app/controllers/pages_controller.rb', content: 'render inline: "<h1>Hello World</h1>"\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on render :template', () => {
    const findings = detect('RB_015', [
      { path: 'app/controllers/pages_controller.rb', content: 'render :show\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on spec files', () => {
    const findings = detect('RB_015', [
      { path: 'spec/controllers/pages_spec.rb', content: 'render inline: "Welcome #{@user.name}"\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RB_016: YAML.load unsafe deserialization ─────────────────────────────────

describe('RB_016 — YAML.load unsafe deserialization', () => {
  it('fires on YAML.load()', () => {
    const findings = detect('RB_016', [
      { path: 'app/services/config_loader.rb', content: 'data = YAML.load(params[:config])\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rails_yaml_load_unsafe');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on YAML.load with file content', () => {
    const findings = detect('RB_016', [
      { path: 'lib/loader.rb', content: 'YAML.load(File.read(user_path))\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on YAML.safe_load()', () => {
    const findings = detect('RB_016', [
      { path: 'app/services/config_loader.rb', content: 'data = YAML.safe_load(params[:config])\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on YAML.load_file() (not a deserialization sink for user input)', () => {
    const findings = detect('RB_016', [
      { path: 'config/initializers/settings.rb', content: 'settings = YAML.load_file("config/settings.yml")\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on spec files', () => {
    const findings = detect('RB_016', [
      { path: 'spec/services/config_spec.rb', content: 'YAML.load(config_string)\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RB_017: Marshal.load deserialization ────────────────────────────────────

describe('RB_017 — Marshal.load/restore deserialization', () => {
  it('fires on Marshal.load()', () => {
    const findings = detect('RB_017', [
      { path: 'app/services/cache.rb', content: 'obj = Marshal.load(params[:data])\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rails_marshal_load');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on Marshal.restore()', () => {
    const findings = detect('RB_017', [
      { path: 'app/services/session.rb', content: 'obj = Marshal.restore(Base64.decode64(cookie_value))\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on Marshal.dump()', () => {
    const findings = detect('RB_017', [
      { path: 'app/services/cache.rb', content: 'data = Marshal.dump(object)\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on spec files', () => {
    const findings = detect('RB_017', [
      { path: 'spec/services/cache_spec.rb', content: 'Marshal.load(data)\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RB_018: Logging sensitive values ─────────────────────────────────────────

describe('RB_018 — logging sensitive values', () => {
  it('fires on Rails.logger.info with password interpolation', () => {
    const findings = detect('RB_018', [
      { path: 'app/services/auth.rb', content: 'Rails.logger.info "User login with password=#{password}"\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rails_log_sensitive');
  });

  it('fires on logger.debug with token interpolation', () => {
    const findings = detect('RB_018', [
      { path: 'app/services/api_client.rb', content: 'logger.debug "Calling API with token: #{api_token}"\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on Rails.logger.error with secret interpolation', () => {
    const findings = detect('RB_018', [
      { path: 'app/services/integrations.rb', content: 'Rails.logger.error "Failed auth secret=#{secret}"\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on logging non-sensitive values', () => {
    const findings = detect('RB_018', [
      { path: 'app/services/auth.rb', content: 'Rails.logger.info "User #{user.id} logged in"\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on commented-out log lines', () => {
    const findings = detect('RB_018', [
      { path: 'app/services/auth.rb', content: '# Rails.logger.info "password=#{password}"\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RB_019: Regex anchors ^ and $ in validation ──────────────────────────────

describe('RB_019 — regex with ^ and $ in model validation', () => {
  it('fires on validates format with /^.../ regex', () => {
    const findings = detect('RB_019', [
      { path: 'app/models/user.rb', content: 'validates :username, format: { with: /^[a-z0-9]+$/ }\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rails_regex_dos');
  });

  it('fires on validates format with /^.../ and no $', () => {
    const findings = detect('RB_019', [
      { path: 'app/models/user.rb', content: 'validates :slug, format: { with: /^[a-z-]+/ }\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when using \\A and \\z anchors', () => {
    const findings = detect('RB_019', [
      { path: 'app/models/user.rb', content: 'validates :username, format: { with: /\\A[a-z0-9]+\\z/ }\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on validates without format', () => {
    const findings = detect('RB_019', [
      { path: 'app/models/user.rb', content: 'validates :email, presence: true, uniqueness: true\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on spec files', () => {
    const findings = detect('RB_019', [
      { path: 'spec/models/user_spec.rb', content: 'validates :username, format: { with: /^[a-z]+$/ }\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RB_020: Gemfile with HTTP gem source ─────────────────────────────────────

describe('RB_020 — Gemfile with HTTP gem source', () => {
  it('fires on source http://rubygems.org', () => {
    const findings = detect('RB_020', [
      { path: 'Gemfile', content: "source 'http://rubygems.org'\ngem 'rails'\n" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rails_gem_source_http');
  });

  it('fires on source http:// with double quotes', () => {
    const findings = detect('RB_020', [
      { path: 'Gemfile', content: 'source "http://gems.example.com"\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on HTTPS source', () => {
    const findings = detect('RB_020', [
      { path: 'Gemfile', content: "source 'https://rubygems.org'\ngem 'rails'\n" },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-Gemfile files', () => {
    const findings = detect('RB_020', [
      { path: 'app/services/client.rb', content: "source 'http://rubygems.org'\n" },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on commented-out source', () => {
    const findings = detect('RB_020', [
      { path: 'Gemfile', content: "# source 'http://rubygems.org'\nsource 'https://rubygems.org'\n" },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── Structural validation ─────────────────────────────────────────────────────

describe('RUBY_RULES structural checks', () => {
  it('has exactly 20 rules', () => {
    expect(RUBY_RULES).toHaveLength(20);
  });

  it('every rule has a unique ID', () => {
    const ids = RUBY_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every rule has an explain block', () => {
    for (const r of RUBY_RULES) {
      expect(r.explain, `[${r.id}] missing explain`).toBeDefined();
      expect(r.explain!.why.length, `[${r.id}] explain.why empty`).toBeGreaterThan(0);
      expect(Array.isArray(r.explain!.commonViolations), `[${r.id}] commonViolations not array`).toBe(true);
      expect(r.explain!.goodExample.length, `[${r.id}] goodExample empty`).toBeGreaterThan(0);
      expect(r.explain!.badExample.length, `[${r.id}] badExample empty`).toBeGreaterThan(0);
    }
  });

  it('every rule detect() returns an array', () => {
    const input: DetectInput = { scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: [] };
    for (const r of RUBY_RULES) {
      expect(Array.isArray(r.detect(input)), `[${r.id}] detect() did not return array`).toBe(true);
    }
  });
});
