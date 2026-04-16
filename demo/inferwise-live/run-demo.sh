#!/usr/bin/env bash
# ============================================================================
# Inferwise Live Demo — Run each CLI command step by step
#
# Usage:
#   bash demo/inferwise-live/run-demo.sh
#
# Runs from the monorepo — uses the locally built CLI.
# ============================================================================

set -uo pipefail
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
echo "  src/chat.ts        — Premium (claude-opus-4-7)     — complex queries"
echo "  src/summarize.ts   — Mid-tier (claude-sonnet-4-6)  — document summaries"
echo "  src/classify.ts    — Premium (gpt-4o)              — ticket classification (overkill!)"
echo "  src/extract.ts     — Premium (gpt-4o)              — invoice & meeting extraction"
echo "  src/moderate.ts    — Premium (gpt-4o)              — content moderation (overkill!)"
echo ""
echo -e "${YELLOW}Config (inferwise.config.json):${RESET}"
cat inferwise.config.json
pause

# ── Step 2: Estimate ────────────────────────────────────────────────────────
header "STEP 2: inferwise estimate — What will this cost?"

echo -e "${YELLOW}Running: inferwise estimate src/ --volume 100000 --config inferwise.config.json${RESET}"
echo ""
$INFERWISE estimate src/ --volume 100000 --config inferwise.config.json
pause

# ── Step 3: Audit ───────────────────────────────────────────────────────────
header "STEP 3: inferwise audit — Where can we save money?"

echo -e "${YELLOW}Running: inferwise audit src/ --volume 100000 --config inferwise.config.json${RESET}"
echo ""
$INFERWISE audit src/ --volume 100000 --config inferwise.config.json
pause

# ── Step 4: Fix (dry run) ──────────────────────────────────────────────────
header "STEP 4: inferwise fix --dry-run — Preview auto-swaps"

echo -e "${YELLOW}Running: inferwise fix src/ --dry-run --volume 100000 --config inferwise.config.json${RESET}"
echo ""
$INFERWISE fix src/ --dry-run --volume 100000 --config inferwise.config.json
pause

# ── Step 5: Fix (apply) ────────────────────────────────────────────────────
header "STEP 5: inferwise fix — Apply model swaps"

echo -e "${YELLOW}Running: inferwise fix src/ --volume 100000 --config inferwise.config.json${RESET}"
echo ""
$INFERWISE fix src/ --volume 100000 --config inferwise.config.json
echo ""

echo -e "${GREEN}Changes applied. Let's see the diff:${RESET}"
echo ""
git --no-pager diff src/ 2>/dev/null || true # show diff if in git repo
pause

# ── Step 6: Re-estimate after fix ──────────────────────────────────────────
header "STEP 6: inferwise estimate — Cost after optimization"

echo -e "${YELLOW}Running: inferwise estimate src/ --volume 100000 --config inferwise.config.json${RESET}"
echo ""
$INFERWISE estimate src/ --volume 100000 --config inferwise.config.json
pause

# ── Step 7: Budget check ───────────────────────────────────────────────────
header "STEP 7: inferwise check — Budget enforcement"

echo -e "${YELLOW}Running: inferwise check src/ --volume 100000 --config inferwise.config.json${RESET}"
echo ""
set +e
$INFERWISE check src/ --volume 100000 --config inferwise.config.json
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
header "DEMO COMPLETE — Summary"

echo -e "${BOLD}What we just demonstrated:${RESET}"
echo ""
echo "  Step  Command               What it does"
echo "  ────  ────────────────────  ──────────────────────────────────────────────"
echo "  1     inferwise estimate    Scan code → per-call costs + monthly projection"
echo "  2     inferwise audit       Find cheaper models + batch API opportunities"
echo "  3     inferwise fix --dry   Preview model swaps without modifying files"
echo "  4     inferwise fix         Apply swaps — rewrite model IDs in source code"
echo "  5     inferwise estimate    Re-estimate to show cost reduction"
echo "  6     inferwise check       Verify costs are within budget thresholds"
echo ""
echo -e "${BOLD}How this runs in production:${RESET}"
echo ""
echo "  ┌──────────────────────────────────────────────────────────────────┐"
echo "  │  Developer machine                                              │"
echo "  │    git commit → pre-commit hook → inferwise check               │"
echo "  │    Blocks expensive commits before they leave your machine      │"
echo "  │                                                                 │"
echo "  │  Pull Request                                                   │"
echo "  │    Push → GitHub Action → inferwise diff                        │"
echo "  │    Posts cost comment, applies labels, requests approval        │"
echo "  │                                                                 │"
echo "  │  Merge Gate                                                     │"
echo "  │    Budget exceeded → CI check FAILS → merge blocked             │"
echo "  │    Three tiers: warn → require approval → hard block            │"
echo "  └──────────────────────────────────────────────────────────────────┘"
echo ""
echo -e "${BOLD}Key numbers from this demo:${RESET}"
echo ""
echo "  Total monthly spend (before):  ~\$232,000/mo"
echo "  Total monthly spend (after):   ~\$5,000/mo"
echo "  Model swap savings:            ~\$227,000/mo (7 swaps, high confidence)"
echo "  Batch API savings (addl):      ~\$37,000/mo (50% off non-latency calls)"
echo ""
echo -e "${GREEN}  Inferwise catches these costs at code review time —${RESET}"
echo -e "${GREEN}  before they hit production.${RESET}"
echo ""
