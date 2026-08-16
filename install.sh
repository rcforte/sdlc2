#!/usr/bin/env bash
#
# sdlc2 installer — macOS, and Windows under WSL.
#
#   curl -fsSL https://raw.githubusercontent.com/rcforte/sdlc2/main/install.sh | bash
#
# Installs sdlc2 through Claude Code's own plugin CLI and nothing else: no clone, no
# writes anywhere under your home directory, and no edit to any project's CLAUDE.md —
# SPEC.md [R-CFG-03] forbids writing that file without your confirmation, and
# `/sdlc2 new-feature` is what asks. [R-PKG-05]
#
# Safe to re-run: it updates whatever is already there and re-checks the result, so it
# is also the repair path when something looks wrong.
#
# When piped from curl this script IS standard input, so it can never prompt you. That
# is load-bearing, not incidental — every branch below decides from the CLI's own
# state rather than from a question.

set -euo pipefail

readonly MARKET_SOURCE="rcforte/sdlc2"
readonly MARKET_NAME="sdlc2-marketplace"
readonly PLUGIN="sdlc2"
readonly SCOPE="user"

# Always the qualified plugin@marketplace id. `claude plugin details` accepts the bare
# name but `claude plugin update` does not — it answers `Plugin "sdlc2" not found` — so
# one qualified id everywhere beats remembering which subcommand is lenient.
readonly PLUGIN_ID="${PLUGIN}@${MARKET_NAME}"

# What a correct install looks like. `claude plugin details` reports Skills, Agents,
# Hooks, MCP servers and LSP servers — there is no separate Commands category, because
# slash commands are counted under Skills. (Confirmed against claude-md-management,
# which ships one skill and one command and reports Skills (2).) So the expected total
# is the four bundled skills PLUS the /sdlc2 router.
#
# The agent count is the check that matters: SPEC.md §12 risk 2 names agent-name
# resolution as the likeliest first-run failure, and a host that registers the personas
# differently shows up right here.
readonly EXPECT_AGENTS=9
readonly EXPECT_SKILLS=5   # 4 bundled skills + the /sdlc2 command

if [ -t 1 ]; then
  BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; OFF=$'\033[0m'
else
  BOLD=''; RED=''; GREEN=''; OFF=''
fi

step() { printf '\n%s==>%s %s\n' "$BOLD" "$OFF" "$1"; }
ok()   { printf '    %s✓%s %s\n' "$GREEN" "$OFF" "$1"; }
die()  { printf '\n%serror:%s %s\n\n' "$RED" "$OFF" "$1" >&2; exit 1; }

# ── prerequisites ─────────────────────────────────────────────────────────────
step "Checking prerequisites"

command -v claude >/dev/null 2>&1 ||
  die "Claude Code is not on your PATH.
    Install it first, then re-run this script:  https://claude.com/claude-code"

claude plugin --help >/dev/null 2>&1 ||
  die "this Claude Code build has no \`claude plugin\` command.
    Update Claude Code and re-run:  claude update"

# Capability, not a version number: asserting a minimum version would be a guess about
# which release introduced these subcommands.
claude plugin --help 2>&1 | grep -q 'install' ||
  die "\`claude plugin\` exists but exposes no \`install\` subcommand.
    Update Claude Code and re-run:  claude update"

ok "$(claude --version 2>/dev/null | head -1)"

# ── marketplace ───────────────────────────────────────────────────────────────
step "Marketplace: $MARKET_NAME"

if claude plugin marketplace list 2>/dev/null | grep -q "$MARKET_NAME"; then
  claude plugin marketplace update "$MARKET_NAME" >/dev/null
  ok "updated from $MARKET_SOURCE"
else
  claude plugin marketplace add "$MARKET_SOURCE" >/dev/null
  ok "added $MARKET_SOURCE"
fi

# ── plugin ────────────────────────────────────────────────────────────────────
step "Plugin: $PLUGIN_ID"

if claude plugin list 2>/dev/null | grep -q "$PLUGIN_ID"; then
  claude plugin update "$PLUGIN_ID" >/dev/null
  ok "updated"
else
  claude plugin install "$PLUGIN_ID" --scope "$SCOPE" >/dev/null
  ok "installed at ${SCOPE} scope"
fi

# ── check the install ─────────────────────────────────────────────────────────
step "Checking the install"

details="$(claude plugin details "$PLUGIN_ID" 2>&1)" ||
  die "\`claude plugin details $PLUGIN_ID\` failed:

$details"

inventory_count() {
  printf '%s\n' "$details" | sed -n "s/^ *$1 (\([0-9][0-9]*\)).*/\1/p" | head -1
}

expect_count() {
  local label="$1" want="$2" got
  got="$(inventory_count "$label")"

  [ -n "$got" ] ||
    die "\`claude plugin details $PLUGIN_ID\` reported no $label line. The inventory was:

$details"

  [ "$got" = "$want" ] ||
    die "expected $label ($want), got $label ($got).

    sdlc2 ships $want $(printf '%s' "$label" | tr '[:upper:]' '[:lower:]') — the host has not registered
    them as expected. See SPEC.md §12 risk 2. The full inventory was:

$details"

  ok "$label ($got)"
}

expect_count Agents "$EXPECT_AGENTS"
expect_count Skills "$EXPECT_SKILLS"

# ── done ──────────────────────────────────────────────────────────────────────
step "Done"
printf '%s\n' \
  "" \
  "    Restart Claude Code, then:" \
  "" \
  "      /sdlc2 help                    the command table" \
  "      /sdlc2 new-feature \"<idea>\"    the graph: framing → design → build → report" \
  "" \
  "    The first run in a project proposes an sdlc2 config block for that project's" \
  "    own CLAUDE.md and asks before writing it. This installer never touches it." \
  "" \
  "    Update or repair   re-run this script" \
  "    Uninstall          claude plugin uninstall $PLUGIN_ID" \
  "                       claude plugin marketplace remove $MARKET_NAME" \
  ""
