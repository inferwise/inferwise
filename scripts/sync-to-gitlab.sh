#!/usr/bin/env bash
# sync-to-gitlab.sh
#
# Syncs the GitHub repo to the internal GitLab mirror while preserving
# GitLab-only files (.gitlab-ci.yml and any future GitLab-specific config).
#
# Usage:
#   bash scripts/sync-to-gitlab.sh
#
# Prerequisites:
#   - git remote "origin" points to GitHub
#   - git remote "gitlab" points to GitLab
#   - You have push access to the GitLab repo

set -euo pipefail

# --- Config ---
GITHUB_REMOTE="origin"
GITLAB_REMOTE="gitlab"
BRANCH="main"
GITLAB_ONLY_FILES=(".gitlab-ci.yml")
TEMP_DIR=$(mktemp -d)
TEMP_BRANCH="sync-to-gitlab-$(date +%s)"

cleanup() {
  # Clean up temp files
  rm -rf "$TEMP_DIR"
  # Switch back to original branch and delete temp branch
  git checkout "$BRANCH" 2>/dev/null || true
  git branch -D "$TEMP_BRANCH" 2>/dev/null || true
}
trap cleanup EXIT

echo "=== Inferwise GitHub → GitLab Sync ==="
echo ""

# --- Step 1: Fetch both remotes ---
echo "Fetching from GitHub ($GITHUB_REMOTE)..."
git fetch "$GITHUB_REMOTE" "$BRANCH"

echo "Fetching from GitLab ($GITLAB_REMOTE)..."
git fetch "$GITLAB_REMOTE" "$BRANCH" 2>/dev/null || {
  echo "Warning: Could not fetch from GitLab. If this is the first push, that's OK."
}

# --- Step 2: Save GitLab-only files from GitLab's main ---
echo ""
echo "Preserving GitLab-only files..."
PRESERVED=0
for file in "${GITLAB_ONLY_FILES[@]}"; do
  if git show "$GITLAB_REMOTE/$BRANCH:$file" > "$TEMP_DIR/$file" 2>/dev/null; then
    echo "  Saved: $file"
    PRESERVED=$((PRESERVED + 1))
  else
    # File doesn't exist on GitLab yet — check local working tree
    if [ -f "$file" ]; then
      cp "$file" "$TEMP_DIR/$file"
      echo "  Saved (from local): $file"
      PRESERVED=$((PRESERVED + 1))
    else
      echo "  Not found: $file (will skip)"
    fi
  fi
done

# --- Step 3: Create a temp branch from GitHub's latest main ---
echo ""
echo "Creating sync branch from $GITHUB_REMOTE/$BRANCH..."
git checkout -B "$TEMP_BRANCH" "$GITHUB_REMOTE/$BRANCH" --no-track

# --- Step 4: Re-apply GitLab-only files ---
if [ "$PRESERVED" -gt 0 ]; then
  echo "Re-applying GitLab-only files..."
  for file in "${GITLAB_ONLY_FILES[@]}"; do
    if [ -f "$TEMP_DIR/$file" ]; then
      # Ensure parent directory exists
      mkdir -p "$(dirname "$file")"
      cp "$TEMP_DIR/$file" "$file"
      git add "$file"
      echo "  Restored: $file"
    fi
  done

  # Only commit if there are staged changes
  if ! git diff --cached --quiet; then
    git commit -m "ci: preserve GitLab CI/CD configuration

Automatically added during GitHub → GitLab sync."
    echo "  Committed GitLab-only files."
  fi
fi

# --- Step 5: Push to GitLab ---
echo ""
echo "Pushing to GitLab ($GITLAB_REMOTE/$BRANCH)..."
git push "$GITLAB_REMOTE" "$TEMP_BRANCH:$BRANCH" --force-with-lease

echo ""
echo "=== Sync complete ==="
echo "  GitHub ($GITHUB_REMOTE/$BRANCH) → GitLab ($GITLAB_REMOTE/$BRANCH)"
echo "  GitLab-only files preserved: $PRESERVED"
