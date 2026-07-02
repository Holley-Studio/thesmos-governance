#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# github-setup.sh — Apply optimal GitHub settings to all Holley-Studio repos
#
# Prerequisites:
#   brew install gh
#   gh auth login          (choose GitHub.com → HTTPS → web browser)
#   gh auth status         (verify you're logged in as Holley-Studio)
#
# Usage:
#   bash scripts/github-setup.sh
#
# What it does:
#   - Sets repo descriptions and homepages
#   - Applies 15 topics to thesmos-governance
#   - Configures branch protection on main (require PR, 1 review, passing CI)
#   - Enables Dependabot security alerts and secret scanning
#   - Verifies required secrets exist (VSCE_PAT, OVSX_PAT, NPM_TOKEN, etc.)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Prerequisites check ───────────────────────────────────────────────────────
if ! command -v gh &>/dev/null; then
  echo "❌  gh CLI not found. Install with: brew install gh"
  echo "    Then run: gh auth login"
  exit 1
fi

if ! gh auth status &>/dev/null; then
  echo "❌  Not logged in to gh. Run: gh auth login"
  exit 1
fi

ACTOR=$(gh api user --jq '.login')
echo "✓  Logged in as: $ACTOR"
echo ""

# ── Repo definitions ──────────────────────────────────────────────────────────
THESMOS="Holley-Studio/thesmos-governance"
HOLLEY="Holley-Studio/HolleyStudios"
PROCLIP="Holley-Studio/proclip-creativeops-studio"

# ─────────────────────────────────────────────────────────────────────────────
# 1. thesmos-governance
# ─────────────────────────────────────────────────────────────────────────────
echo "── thesmos-governance ───────────────────────────────────────────────────"

echo "  Setting description and homepage..."
gh repo edit "$THESMOS" \
  --description "AI governance CLI, GitHub Action, VS Code extension, and MCP server. 1,075+ rules for Claude, Gemini, Cursor, Copilot, and Codex." \
  --homepage "https://holley.studio/thesmos"

echo "  Setting topics..."
gh repo edit "$THESMOS" \
  --add-topic "ai-governance" \
  --add-topic "code-review" \
  --add-topic "linter" \
  --add-topic "cli-tool" \
  --add-topic "typescript" \
  --add-topic "monorepo" \
  --add-topic "github-action" \
  --add-topic "vscode-extension" \
  --add-topic "security-linting" \
  --add-topic "ai-safety" \
  --add-topic "mcp-server" \
  --add-topic "developer-tools" \
  --add-topic "rule-engine" \
  --add-topic "claude" \
  --add-topic "cursor"

echo "  Enabling Dependabot alerts and security features..."
gh api -X PATCH "repos/$THESMOS" \
  --field security_and_analysis='{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"},"dependabot_security_updates":{"status":"enabled"}}' \
  --silent 2>/dev/null || echo "  (security features require admin — check GitHub Settings manually)"

echo "  Setting branch protection on main..."
gh api -X PUT "repos/$THESMOS/branches/main/protection" \
  --field required_status_checks='{"strict":true,"contexts":["CI / Typecheck","CI / Test","CI / Build"]}' \
  --field enforce_admins=false \
  --field required_pull_request_reviews='{"required_approving_review_count":1,"require_code_owner_reviews":true,"dismiss_stale_reviews":true}' \
  --field restrictions=null \
  --field allow_squash_merge=true \
  --field allow_merge_commit=false \
  --field allow_rebase_merge=false \
  --silent && echo "  ✓ Branch protection set" || echo "  ⚠  Branch protection requires Pro — check GitHub Settings > Branches"

echo ""
echo "  Checking required secrets..."
for secret in VSCE_PAT OVSX_PAT NPM_TOKEN SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY CODECOV_TOKEN; do
  if gh secret list -R "$THESMOS" 2>/dev/null | grep -q "^$secret"; then
    echo "  ✓ $secret exists"
  else
    echo "  ✗ $secret MISSING — add at: https://github.com/$THESMOS/settings/secrets/actions"
  fi
done

# ─────────────────────────────────────────────────────────────────────────────
# 2. HolleyStudios
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "── HolleyStudios ────────────────────────────────────────────────────────"

echo "  Setting description and homepage..."
gh repo edit "$HOLLEY" \
  --description "Holley Studio — marketing site and creative ops platform built with Next.js and Supabase." \
  --homepage "https://holley.studio" 2>/dev/null || echo "  (repo may be private — skip or set manually)"

echo "  Setting topics..."
gh repo edit "$HOLLEY" \
  --add-topic "nextjs" \
  --add-topic "supabase" \
  --add-topic "typescript" \
  --add-topic "design-studio" \
  --add-topic "creative-ops" 2>/dev/null || true

echo "  Setting branch protection on main..."
gh api -X PUT "repos/$HOLLEY/branches/main/protection" \
  --field required_status_checks='{"strict":true,"contexts":[]}' \
  --field enforce_admins=false \
  --field required_pull_request_reviews='{"required_approving_review_count":1,"require_code_owner_reviews":true,"dismiss_stale_reviews":true}' \
  --field restrictions=null \
  --silent && echo "  ✓ Branch protection set" || echo "  ⚠  Branch protection skipped (private repo or Pro needed)"

echo ""
echo "  Checking required secrets..."
for secret in NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY VERCEL_TOKEN; do
  if gh secret list -R "$HOLLEY" 2>/dev/null | grep -q "^$secret"; then
    echo "  ✓ $secret exists"
  else
    echo "  ✗ $secret MISSING — add at: https://github.com/$HOLLEY/settings/secrets/actions"
  fi
done

# ─────────────────────────────────────────────────────────────────────────────
# 3. proclip-creativeops-studio
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "── proclip-creativeops-studio ───────────────────────────────────────────"

echo "  Setting description and homepage..."
gh repo edit "$PROCLIP" \
  --description "ProClip Creative Ops Studio — AI-powered creative operations platform built on Next.js and Supabase." \
  --homepage "https://proclip.app" 2>/dev/null || echo "  (repo may be private — skip or set manually)"

echo "  Setting topics..."
gh repo edit "$PROCLIP" \
  --add-topic "nextjs" \
  --add-topic "supabase" \
  --add-topic "typescript" \
  --add-topic "creative-ops" \
  --add-topic "ai" 2>/dev/null || true

echo "  Setting branch protection on main..."
gh api -X PUT "repos/$PROCLIP/branches/main/protection" \
  --field required_status_checks='{"strict":true,"contexts":["Thesmos Governance Review / Thesmos Governance Review"]}' \
  --field enforce_admins=false \
  --field required_pull_request_reviews='{"required_approving_review_count":1,"require_code_owner_reviews":true,"dismiss_stale_reviews":true}' \
  --field restrictions=null \
  --silent && echo "  ✓ Branch protection set" || echo "  ⚠  Branch protection skipped (private repo or Pro needed)"

echo ""
echo "  Checking required secrets..."
for secret in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY MONDAY_API_TOKEN VERCEL_TOKEN; do
  if gh secret list -R "$PROCLIP" 2>/dev/null | grep -q "^$secret"; then
    echo "  ✓ $secret exists"
  else
    echo "  ✗ $secret MISSING — add at: https://github.com/$PROCLIP/settings/secrets/actions"
  fi
done

# ─────────────────────────────────────────────────────────────────────────────
# Manual steps reminder
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════════════"
echo "  Manual steps remaining"
echo "═══════════════════════════════════════════════════════════════════════"
echo ""
echo "  thesmos-governance:"
echo "  1. Social preview (1280×640 image): https://github.com/$THESMOS/settings"
echo "  2. First VS Code extension publish: cd extensions/vscode && npx vsce publish"
echo "  3. VSCE_PAT secret: https://marketplace.visualstudio.com/manage → publisher holley-studios → Personal Access Tokens"
echo "  4. OVSX_PAT secret: https://open-vsx.org → User Settings → Access Tokens"
echo "  5. npm provenance: npmjs.com → Account Settings → Publishing → Trusted Publishing (add GitHub Actions OIDC)"
echo "  6. Codecov: https://codecov.io → Add repo → copy CODECOV_TOKEN"
echo ""
echo "  All repos:"
echo "  7. Enable Dependabot security alerts in each repo: Settings → Security → Dependabot"
echo "  8. Enable secret scanning: Settings → Security → Secret scanning"
echo ""
echo "  ⚠  VS Code Marketplace PATs are deprecated Dec 1, 2026."
echo "     Before that date, migrate VSCE_PAT → Microsoft Entra ID Service Principal."
echo "     See: https://code.visualstudio.com/api/working-with-extensions/publishing-extension#azure-devops-personal-access-tokens"
echo ""
echo "✓  Done. Run this script again to verify all secrets are set."
