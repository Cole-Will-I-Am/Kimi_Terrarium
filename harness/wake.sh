#!/bin/bash
# One wake cycle for the terrarium inhabitant. Root-owned; the inhabitant can read
# this (transparency) but cannot modify it (its own guardrails are out of reach).
#
# Flow: take a single-flight lock -> rouse the inhabitant as the unprivileged
# `terrarium` user with a minimal "you are awake" prompt -> record + ship the cycle.
set -uo pipefail

RUNNER=/srv/terrarium/runner
EVENTS=/srv/terrarium/events
SPACE=/srv/terrarium/space
SPOOL=/srv/terrarium/spool
LOCK="$EVENTS/wake.lock"
LOG="$EVENTS/wake.log"
TIMEOUT=540   # 9 min — finishes before the next 10-min wake

# INGEST_URL + INGEST_TOKEN (root-only; never exposed to the inhabitant).
# `set -a` so they're exported into record.py's environment.
set -a; [ -f "$RUNNER/terrarium.env" ] && source "$RUNNER/terrarium.env"; set +a

log() { echo "$(date -u +%FT%TZ) $*" >> "$LOG"; }

# Single-flight: if the previous cycle is still awake, skip this one.
exec 9>"$LOCK"
if ! flock -n 9; then
  log "skip: previous cycle still running"
  exit 0
fi

CYCLE=$(( $(cat "$EVENTS/cycle.count" 2>/dev/null || echo 0) + 1 ))
echo "$CYCLE" > "$EVENTS/cycle.count"

TS=$(date -u +%FT%TZ)
RAW="$SPOOL/$CYCLE.jsonl"
LAST="$SPOOL/$CYCLE.last.txt"
ERR="$SPOOL/$CYCLE.err"
: > "$RAW"; : > "$LAST"   # root pre-creates; terrarium owns spool so -o can write LAST
chown terrarium:terrarium "$RAW" "$LAST" 2>/dev/null

PROMPT="You are awake. The current time is $TS."

log "cycle $CYCLE: rousing inhabitant"
START=$(date +%s)
timeout "$TIMEOUT" runuser -u terrarium -- \
  env HOME=/srv/terrarium CODEX_HOME=/srv/terrarium/.codex OLLAMA_HOST=127.0.0.1:11435 \
  codex exec --json --skip-git-repo-check -C "$SPACE" -o "$LAST" "$PROMPT" \
  </dev/null >"$RAW" 2>"$ERR"
CODE=$?
END=$(date +%s)
ENDTS=$(date -u +%FT%TZ)

STATUS=ok
if [ "$CODE" -eq 124 ]; then STATUS=timeout
elif [ "$CODE" -ne 0 ]; then STATUS=error; fi
log "cycle $CYCLE: ended status=$STATUS exit=$CODE dur=$((END-START))s"

python3 "$RUNNER/record.py" \
  --cycle "$CYCLE" --raw "$RAW" --last "$LAST" \
  --started "$TS" --ended "$ENDTS" --duration "$((END-START))" \
  --status "$STATUS" --exit "$CODE" >> "$LOG" 2>&1

# keep spool tidy: drop raw transcripts older than this cycle (archive holds the parsed event)
find "$SPOOL" -maxdepth 1 -type f ! -newermt "-1 hour" -delete 2>/dev/null || true
