#!/usr/bin/env bash
# Proof-of-Execution Stop hook — blocks `[STATUS]: done` claims that lack a `[STDOUT]:` block.
#
# Mechanical enforcement of an "anti silent-failure" rule: an agent may only claim
# a task is done if it pastes real command output proving it. Reads the Stop event JSON from stdin, locates `transcript_path`, extracts
# the last assistant text message, and validates that a `[STATUS]: done` claim is backed
# by a non-empty `[STDOUT]:` block.
#
# Exit codes:
#   0 — allow (no claim, valid claim, or hook cannot inspect transcript)
#   2 — block (claim of "done" without a `[STDOUT]:` block)
set -u
INPUT=$(cat)

# Best-effort transcript discovery. If we can't read the transcript, do not block.
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)
if [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; then
  exit 0
fi

LAST_ASSISTANT=$(jq -rs '
  map(select(.type == "assistant"))
  | last
  | (.message.content // [])
  | map(select(.type == "text") | .text)
  | join("\n")
' "$TRANSCRIPT" 2>/dev/null)

if [ -z "$LAST_ASSISTANT" ] || [ "$LAST_ASSISTANT" = "null" ]; then
  exit 0
fi

# Only enforce when the agent uses the Proof-of-Execution format at all.
if printf '%s' "$LAST_ASSISTANT" | grep -qE '\[STATUS\]:[[:space:]]*done\b'; then
  # Require a `[STDOUT]:` block with at least one non-blank line of content
  # before the closing `[STATUS]:` line.
  if ! printf '%s' "$LAST_ASSISTANT" | awk '
    /\[STDOUT\]:/ { in_block = 1; next }
    in_block && /^\[STATUS\]:/ { exit }
    in_block && NF > 0 { found = 1 }
    END { exit (found ? 0 : 1) }
  '; then
    cat >&2 <<'EOF'
BLOCKED by Proof-of-Execution hook:
  [STATUS]: done was claimed without a non-empty [STDOUT]: block.

  Required action:
    - Paste raw stdout from a real Bash tool call in this session, OR
    - Change status to `implemented-pending-verification`.

EOF
    exit 2
  fi
fi

exit 0
