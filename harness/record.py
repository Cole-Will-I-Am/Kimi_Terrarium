#!/usr/bin/env python3
"""Parse one wake cycle's codex --json transcript, record it to a local SQLite
ledger, and ship it (plus any previously-unshipped cycles) to the monitor.

Runs as root (invoked by wake.sh). The inhabitant never sees this or the ledger.
Output is capped everywhere so a chatty cycle can't bloat storage or the wire.
"""
import argparse, json, os, sqlite3, urllib.request, urllib.error, sys

EVENTS = "/srv/terrarium/events"
SPACE = "/srv/terrarium/space"
JOURNAL = os.path.join(SPACE, "journal.md")
LEDGER = os.path.join(EVENTS, "ledger.db")

# --- caps (manage output/character limits) ---
CAP_SUMMARY = 4000
CAP_REASONING = 4000
CAP_CMD = 400
CAP_LIST = 60
CAP_JOURNAL = 30000
CAP_SPACE_FILES = 200
CAP_CANVAS = 220000  # the inhabitant's self-authored public page (≈215 KB)
CANVAS = os.path.join(SPACE, "site", "index.html")


def cap(s, n):
    if s is None:
        return None
    s = str(s)
    return s if len(s) <= n else s[:n] + f"\n…[+{len(s)-n} chars]"


def parse_raw(raw_path):
    thread_id = None
    reasoning, commands, files = [], [], []
    last_agent = None
    usage = {}
    try:
        with open(raw_path, encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    o = json.loads(line)
                except json.JSONDecodeError:
                    continue
                t = o.get("type")
                if t == "thread.started":
                    thread_id = o.get("thread_id")
                elif t == "turn.completed":
                    usage = o.get("usage", {}) or {}
                elif t == "item.completed":
                    it = o.get("item", {}) or {}
                    itype = it.get("type")
                    if itype == "reasoning":
                        reasoning.append(it.get("text", ""))
                    elif itype == "command_execution":
                        commands.append({
                            "command": cap(it.get("command", ""), CAP_CMD),
                            "exit_code": it.get("exit_code"),
                        })
                    elif itype == "agent_message":
                        last_agent = it.get("text", "")
                    elif itype == "file_change" or "path" in it or "changes" in it:
                        # codex apply_patch edits surface here
                        path = it.get("path")
                        if path:
                            files.append(path)
                        for ch in (it.get("changes") or []):
                            p = ch.get("path") if isinstance(ch, dict) else None
                            if p:
                                files.append(p)
    except FileNotFoundError:
        pass
    return thread_id, reasoning, commands, files, last_agent, usage


def snapshot_space():
    """A light view of what the inhabitant has built: file list + total bytes."""
    flist, total = [], 0
    for root, dirs, names in os.walk(SPACE):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "__pycache__")]
        for n in names:
            p = os.path.join(root, n)
            try:
                total += os.path.getsize(p)
            except OSError:
                pass
            rel = os.path.relpath(p, SPACE)
            if len(flist) < CAP_SPACE_FILES:
                flist.append(rel)
    return flist, total


def read_journal_tail():
    try:
        with open(JOURNAL, encoding="utf-8", errors="replace") as f:
            data = f.read()
    except FileNotFoundError:
        return ""
    return data[-CAP_JOURNAL:]


def read_canvas():
    """The inhabitant's self-authored public page, if it has made one."""
    try:
        with open(CANVAS, encoding="utf-8", errors="replace") as f:
            return f.read(CAP_CANVAS + 1)[:CAP_CANVAS]
    except (FileNotFoundError, IsADirectoryError, OSError):
        return None


def init_ledger():
    db = sqlite3.connect(LEDGER)
    db.execute("""CREATE TABLE IF NOT EXISTS cycles (
        cycle INTEGER PRIMARY KEY,
        payload TEXT NOT NULL,
        shipped INTEGER NOT NULL DEFAULT 0
    )""")
    db.commit()
    return db


def ship_pending(db, ingest_url, token):
    if not ingest_url or not token:
        return
    rows = db.execute("SELECT cycle, payload FROM cycles WHERE shipped=0 ORDER BY cycle").fetchall()
    for cycle, payload in rows:
        req = urllib.request.Request(
            ingest_url, data=payload.encode("utf-8"), method="POST",
            headers={"Content-Type": "application/json",
                     "Authorization": "Bearer " + token,
                     "User-Agent": "terrarium-harness/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                if resp.status in (200, 201):
                    db.execute("UPDATE cycles SET shipped=1 WHERE cycle=?", (cycle,))
                    db.commit()
                    print(f"shipped cycle {cycle}")
                else:
                    print(f"ship cycle {cycle}: HTTP {resp.status}")
                    break
        except (urllib.error.URLError, OSError) as e:
            print(f"ship cycle {cycle} failed (buffered): {e}")
            break  # offline — keep order, retry next cycle


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cycle", type=int, required=True)
    ap.add_argument("--raw", required=True)
    ap.add_argument("--last", required=True)
    ap.add_argument("--started", required=True)
    ap.add_argument("--ended", required=True)
    ap.add_argument("--duration", type=int, required=True)
    ap.add_argument("--status", required=True)
    ap.add_argument("--exit", type=int, required=True)
    a = ap.parse_args()

    thread_id, reasoning, commands, files, last_agent, usage = parse_raw(a.raw)

    summary = None
    try:
        with open(a.last, encoding="utf-8", errors="replace") as f:
            summary = f.read().strip()
    except FileNotFoundError:
        pass
    if not summary:
        summary = last_agent or ""

    reasoning_text = "\n\n".join(r for r in reasoning if r)
    space_files, space_bytes = snapshot_space()

    event = {
        "cycle": a.cycle,
        "thread_id": thread_id,
        "started_at": a.started,
        "ended_at": a.ended,
        "duration_s": a.duration,
        "status": a.status,
        "exit_code": a.exit,
        "summary": cap(summary, CAP_SUMMARY),
        "reasoning": cap(reasoning_text, CAP_REASONING),
        "commands": commands[:CAP_LIST],
        "num_commands": len(commands),
        "files_changed": files[:CAP_LIST],
        "num_files_changed": len(files),
        "input_tokens": usage.get("input_tokens"),
        "output_tokens": usage.get("output_tokens"),
        "reasoning_tokens": usage.get("reasoning_output_tokens"),
        "chars_out": len(summary or "") + len(reasoning_text),
        "journal_excerpt": read_journal_tail(),
        "space_files": space_files,
        "space_bytes": space_bytes,
        "canvas_html": read_canvas(),
    }

    payload = json.dumps(event, ensure_ascii=False)
    # archive locally + ledger
    with open(os.path.join(EVENTS, "archive", f"{a.cycle}.json"), "w", encoding="utf-8") as f:
        f.write(payload)
    db = init_ledger()
    db.execute("INSERT OR REPLACE INTO cycles (cycle, payload, shipped) VALUES (?,?,0)",
               (a.cycle, payload))
    db.commit()

    print(f"cycle {a.cycle}: status={a.status} dur={a.duration}s cmds={len(commands)} "
          f"files={len(files)} chars={event['chars_out']} tokens={usage.get('output_tokens')}")

    ship_pending(db, os.environ.get("INGEST_URL"), os.environ.get("INGEST_TOKEN"))
    db.close()


if __name__ == "__main__":
    main()
