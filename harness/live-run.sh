#!/bin/bash
# Run Kimi's live server if it has written (and compiles), else the default page.
# Root-owned; runs as the unprivileged `terrarium` user via the systemd unit.
APP=/srv/terrarium/space/server/app.py
if [ -f "$APP" ] && python3 -c "import sys; compile(open(sys.argv[1]).read(), sys.argv[1], 'exec')" "$APP" 2>/dev/null; then
  exec python3 "$APP"
fi
exec python3 /srv/terrarium/runner/live-default.py
