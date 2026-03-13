#!/usr/bin/env bash
# ============================================================================
# Inferwise Live Demo — Run each CLI command step by step
#
# Usage:
#   bash demo/inferwise-live/run-demo.sh
#
# Runs from the monorepo — uses the locally built CLI.
# ============================================================================

set -euo pipefail
DEMO_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DEMO_DIR/../.." && pwd)"
cd "$DEMO_DIR"

# Use the locally built CLI from the monorepo
INFERWISE="node $REPO_ROOT/packages/cli/dist/index.js"

# Colors
BOLD="\033[1m"
CYAN="\033[36m"
YELLOW="\033[33m"
GREEN="\033[32m"
RESET="\033[0m"

pause() {
  echo ""
  read -rp "  Press Enter to continue..."
  echo ""
}

header() {
  echo ""
  echo -e "${BOLD}${CYAN}════════════════════════════════════════════════════════════════${RESET}"
  echo -e "${BOLD}${CYAN}  $1${RESET}"
  echo -e "${BOLD}${CYAN}════════════════════════════════════════════════════════════════${RESET}"
  echo ""
}

# ── Step 1: Show the sample app ─────────────────────────────────────────────
header "STEP 1: Sample Application"

echo -e "${YELLOW}These are the source files Inferwise will scan:${RESET}"
echo ""
echo "  src/chat.ts        — Premium (claude-opus-4-6)    — complex queries"
echo "  src/summarize.ts   — Mid-tier (claude-sonnet-4-6) — document summaries"
echo "  src/classify.ts    — Mid-tier (gpt-4o)            — ticket classification"
echo ""
echo -e "${YELLOW}Config (inferwise.config.json):${RESET}"
cat inferwise.config.json
pause

# ── Step 2: Estimate ────────────────────────────────────────────────────────
header "STEP 2: inferwise estimate — What will this cost?"

echo -e "${YELLOW}Running: inferwise estimate src/ --config inferwise.config.json${RESET}"
echo ""
$INFERWISE estimate src/ --config inferwise.config.json
pause

# ── Step 3: Audit ───────────────────────────────────────────────────────────
header "STEP 3: inferwise audit — Where can we save money?"

echo -e "${YELLOW}Running: inferwise audit src/ --config inferwise.config.json${RESET}"
echo ""
$INFERWISE audit src/ --config inferwise.config.json
pause

# ── Step 4: Fix (dry run) ──────────────────────────────────────────────────
header "STEP 4: inferwise fix --dry-run — Preview auto-swaps"

echo -e "${YELLOW}Running: inferwise fix src/ --dry-run --config inferwise.config.json${RESET}"
echo ""
$INFERWISE fix src/ --dry-run --config inferwise.config.json
pause

# ── Step 5: Fix (apply) ────────────────────────────────────────────────────
header "STEP 5: inferwise fix — Apply model swaps"

echo -e "${YELLOW}Running: inferwise fix src/ --config inferwise.config.json${RESET}"
echo ""
$INFERWISE fix src/ --config inferwise.config.json
echo ""

echo -e "${GREEN}Changes applied. Let's see the diff:${RESET}"
echo ""
git diff src/ 2>/dev/null || diff <(echo "") <(echo "") # show diff if in git repo
pause

# ── Step 6: Re-estimate after fix ──────────────────────────────────────────
header "STEP 6: inferwise estimate — Cost after optimization"

echo -e "${YELLOW}Running: inferwise estimate src/ --config inferwise.config.json${RESET}"
echo ""
$INFERWISE estimate src/ --config inferwise.config.json
pause

# ── Step 7: Budget check ───────────────────────────────────────────────────
header "STEP 7: inferwise check — Budget enforcement"

echo -e "${YELLOW}Running: inferwise check src/ --config inferwise.config.json${RESET}"
echo ""
set +e
$INFERWISE check src/ --config inferwise.config.json
EXIT_CODE=$?
set -e

echo ""
if [ "$EXIT_CODE" -eq 0 ]; then
  echo -e "${GREEN}  ✓ Budget check PASSED — safe to merge${RESET}"
else
  echo -e "${YELLOW}  ✗ Budget check FAILED (exit code $EXIT_CODE) — merge blocked${RESET}"
fi
pause

# ── Step 8: Restore original files ─────────────────────────────────────────
header "STEP 8: Restore original files"

echo -e "${YELLOW}Reverting model swaps so the demo can be re-run...${RESET}"
git checkout src/ 2>/dev/null || echo "  (not in git — manually restore files to re-run)"
echo ""
echo -e "${GREEN}Done. Original files restored.${RESET}"

# ── Summary ─────────────────────────────────────────────────────────────────
header "DEMO COMPLETE"

echo "  What we just ran:"
echo ""
echo "  1. estimate    → Scanned code, calculated per-call and monthly costs"
echo "  2. audit       → Found cheaper model alternatives"
echo "  3. fix --dry   → Previewed model swaps without changing files"
echo "  4. fix         → Applied swaps — rewrote model IDs in source code"
echo "  5. estimate    → Re-estimated to show savings"
echo "  6. check       → Verified costs are within budget thresholds"
echo ""
echo "  In a real workflow, these run automatically:"
echo "    • Pre-commit hook: inferwise check (blocks expensive commits)"
echo "    • CI pipeline:     inferwise diff  (comments on PRs)"
echo "    • GitHub Action:   inferwise-action (labels + blocks merges)"
echo ""
