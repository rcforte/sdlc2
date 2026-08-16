<#
  sdlc2 installer — Windows, native PowerShell.

    irm https://raw.githubusercontent.com/rcforte/sdlc2/main/install.ps1 | iex

  Installs sdlc2 through Claude Code's own plugin CLI and nothing else: no clone, no
  writes anywhere under your profile, and no edit to any project's CLAUDE.md —
  SPEC.md [R-CFG-03] forbids writing that file without your confirmation, and
  `/sdlc2 new-feature` is what asks. [R-PKG-05]

  Safe to re-run: it updates whatever is already there and re-checks the result, so it
  is also the repair path when something looks wrong.

  The `irm | iex` form runs the script as an expression rather than a file, which
  sidesteps ExecutionPolicy entirely — a downloaded .ps1 would need Unblock-File or a
  policy change first. It also means the script cannot prompt, which is load-bearing:
  every branch below decides from the CLI's own state rather than from a question.
  Failures `throw` rather than `exit` so a piped run reports the error without
  closing your shell.

  Running under WSL instead? Use install.sh.
#>

$ErrorActionPreference = 'Stop'

$MarketSource = 'rcforte/sdlc2'
$MarketName   = 'sdlc2-marketplace'
$Plugin       = 'sdlc2'
$Scope        = 'user'

# Always the qualified plugin@marketplace id. `claude plugin details` accepts the bare
# name but `claude plugin update` does not -- it answers `Plugin "sdlc2" not found` --
# so one qualified id everywhere beats remembering which subcommand is lenient.
$PluginId     = "$Plugin@$MarketName"

# What a correct install looks like. `claude plugin details` reports Skills, Agents,
# Hooks, MCP servers and LSP servers -- there is no separate Commands category, because
# slash commands are counted under Skills. (Confirmed against claude-md-management,
# which ships one skill and one command and reports Skills (2).) So the expected total
# is the four bundled skills PLUS the /sdlc2 router.
#
# The agent count is the check that matters: SPEC.md section 12 risk 2 names agent-name
# resolution as the likeliest first-run failure, and a host that registers the personas
# differently shows up right here.
$ExpectAgents = 9
$ExpectSkills = 5   # 4 bundled skills + the /sdlc2 command

function Write-Step { param([string]$Message)
  Write-Host ''
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok { param([string]$Message)
  Write-Host "    [ok] $Message" -ForegroundColor Green
}

function Invoke-ClaudeCli {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CliArgs)

  $output = & claude @CliArgs 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    throw "``claude $($CliArgs -join ' ')`` failed:`n`n$output"
  }
  return $output
}

function Get-InventoryCount {
  param([string]$Label, [string]$Details)

  $match = [regex]::Match($Details, "^\s*$Label \((\d+)\)", 'Multiline')
  if (-not $match.Success) { return $null }
  return [int]$match.Groups[1].Value
}

# -- prerequisites ------------------------------------------------------------
Write-Step 'Checking prerequisites'

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  throw @'
Claude Code is not on your PATH.
    Install it first, then re-run this script:  https://claude.com/claude-code
'@
}

# Capability, not a version number: asserting a minimum version would be a guess about
# which release introduced these subcommands.
$pluginHelp = (& claude plugin --help 2>&1 | Out-String)
if ($pluginHelp -notmatch 'install') {
  throw @'
This Claude Code build exposes no `claude plugin install` subcommand.
    Update Claude Code and re-run:  claude update
'@
}

$version = (& claude --version 2>&1 | Out-String).Trim()
Write-Ok $version

# -- marketplace --------------------------------------------------------------
Write-Step "Marketplace: $MarketName"

$markets = (& claude plugin marketplace list 2>&1 | Out-String)
if ($markets -match [regex]::Escape($MarketName)) {
  Invoke-ClaudeCli plugin marketplace update $MarketName | Out-Null
  Write-Ok "updated from $MarketSource"
}
else {
  Invoke-ClaudeCli plugin marketplace add $MarketSource | Out-Null
  Write-Ok "added $MarketSource"
}

# -- plugin -------------------------------------------------------------------
Write-Step "Plugin: $PluginId"

$installed = (& claude plugin list 2>&1 | Out-String)
if ($installed -match [regex]::Escape($PluginId)) {
  Invoke-ClaudeCli plugin update $PluginId | Out-Null
  Write-Ok 'updated'
}
else {
  Invoke-ClaudeCli plugin install $PluginId --scope $Scope | Out-Null
  Write-Ok "installed at $Scope scope"
}

# -- check the install --------------------------------------------------------
Write-Step 'Checking the install'

$details = Invoke-ClaudeCli plugin details $PluginId

foreach ($expected in @(
    @{ Label = 'Agents'; Want = $ExpectAgents },
    @{ Label = 'Skills'; Want = $ExpectSkills })) {

  $got = Get-InventoryCount -Label $expected.Label -Details $details

  if ($null -eq $got) {
    throw "``claude plugin details $PluginId`` reported no $($expected.Label) line. The inventory was:`n`n$details"
  }

  if ($got -ne $expected.Want) {
    throw @"
Expected $($expected.Label) ($($expected.Want)), got $($expected.Label) ($got).

    sdlc2 ships $($expected.Want) $($expected.Label.ToLower()) -- the host has not registered
    them as expected. See SPEC.md section 12 risk 2. The full inventory was:

$details
"@
  }

  Write-Ok "$($expected.Label) ($got)"
}

# -- done ---------------------------------------------------------------------
Write-Step 'Done'
@"

    Restart Claude Code, then:

      /sdlc2 help                    the command table
      /sdlc2 new-feature "<idea>"    the graph: framing -> design -> build -> report

    The first run in a project proposes an sdlc2 config block for that project's
    own CLAUDE.md and asks before writing it. This installer never touches it.

    Update or repair   re-run this script
    Uninstall          claude plugin uninstall $PluginId
                       claude plugin marketplace remove $MarketName

"@ | Write-Host
