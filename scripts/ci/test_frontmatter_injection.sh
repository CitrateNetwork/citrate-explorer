#!/usr/bin/env bash
# EX-B-006 regression PoC — CI shell-injection via attacker-controlled filenames.
#
# The lint-frontmatter.yml / tripwires.yml workflows compute a list of added/
# changed `.md` files from a PR diff and hand it to check_frontmatter.py. The
# OLD code interpolated that list straight into a `run:` block:
#
#     ./scripts/ci/check_frontmatter.py --files ${{ steps.added.outputs.files }}
#
# GitHub Actions `${{ }}` is TEXTUAL substitution into the shell script before
# bash parses it, so a PR that adds a file named `pwned$(cmd).md` runs `cmd` on
# the runner. This script proves (RED) the injection against the old pattern and
# (GREEN) that the new --files0 path treats the same filename as inert data.
#
# Exit 0 = the fix holds; non-zero = the injection is live.
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
marker="$work/PWNED"

# An attacker-authored added filename (git permits $ ( ) and spaces in paths).
malicious="pwned\$(touch '$marker').md"

fail=0

# --- RED: the OLD interpolation pattern executes the injected command ---------
# Model the consumer step verbatim: the ${{ }} value is spliced into the script
# text, so the shell performs command substitution on the filename.
rm -f "$marker"
old_line="echo --files $malicious"   # what `--files ${{ ...files }}` expands to
bash -c "$old_line" >/dev/null 2>&1
if [[ -f "$marker" ]]; then
  echo "RED (expected): old --files interpolation executed the injected command"
else
  echo "note: old-pattern PoC did not trigger in this shell (still verifying the fix)"
fi

# --- GREEN: the NEW --files0 path treats the filename as inert data -----------
rm -f "$marker"
list="$work/list"
# Emit the malicious name NUL-delimited, exactly as the fixed workflow does.
printf '%s\0' "$(printf '%b' "$malicious")" > "$list"
"$repo_root/scripts/ci/check_frontmatter.py" --files0 "$list" >/dev/null 2>&1 || true
if [[ -f "$marker" ]]; then
  echo "GREEN FAIL: --files0 path executed the injected command"
  fail=1
else
  echo "GREEN: --files0 path did NOT execute the injected filename (data, not code)"
fi

# --- Static guard: no workflow may interpolate a file list into a run block ----
for wf in "$repo_root"/.github/workflows/tripwires.yml \
          "$repo_root"/.github/workflows/lint-frontmatter.yml; do
  # Ignore comment lines (which intentionally document the old vulnerable form).
  if grep -Ev '^[[:space:]]*#' "$wf" | grep -Eq -- '--files[[:space:]]+\$\{\{'; then
    echo "GUARD FAIL: $wf still interpolates a file list into run (--files \${{ ... }})"
    fail=1
  fi
  if ! grep -q -- '--files0 "\$LIST"' "$wf"; then
    echo "GUARD FAIL: $wf does not use the safe --files0 \"\$LIST\" invocation"
    fail=1
  fi
done

if [[ "$fail" -eq 0 ]]; then
  echo "OK: EX-B-006 injection is closed."
fi
exit "$fail"
