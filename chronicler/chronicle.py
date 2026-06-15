#!/usr/bin/env python3
"""The Chronicler: once an hour, review the terrarium's recent evolution with the
custom `chronicler` model (MiniMax-M3) and record any genuinely new breakthroughs
to the public Chronicle page. Runs as root (operator infra)."""
import glob, json, os, re, subprocess, urllib.request, urllib.error

SPACE = "/srv/terrarium/space"
ARCHIVE = "/srv/terrarium/events/archive"
OLLAMA = "http://127.0.0.1:11434/api/generate"
MODEL = "chronicler"
SITE = "https://terrarium.manticthink.com"
MAX_NEW_PER_RUN = 8

CAP_JOURNAL, CAP_SUMMARY, CAP_FILES = 14000, 400, 120
SKIP_DIRS = {".git", "__pycache__", "node_modules", "rendered", "Kimi_Sandbox"}


def token():
    try:
        with open("/srv/terrarium/runner/terrarium.env") as f:
            m = re.search(r'INGEST_TOKEN="?([^"\n]+)"?', f.read())
            return m.group(1) if m else ""
    except OSError:
        return ""


def journal_tail():
    try:
        return open(f"{SPACE}/journal.md", encoding="utf-8", errors="replace").read()[-CAP_JOURNAL:]
    except OSError:
        return ""


def recent_cycles():
    files = sorted(glob.glob(f"{ARCHIVE}/*.json"),
                   key=lambda p: int(os.path.basename(p)[:-5]) if os.path.basename(p)[:-5].isdigit() else 0)
    out = []
    for f in files[-12:]:
        try:
            d = json.load(open(f))
            out.append(f"#{d.get('cycle')}: {(d.get('summary') or '').strip()[:CAP_SUMMARY]}")
        except Exception:
            pass
    return "\n".join(out)


def space_tree():
    items = []
    for root, dirs, names in os.walk(SPACE):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for n in sorted(names):
            rel = os.path.relpath(os.path.join(root, n), SPACE)
            items.append(rel)
            if len(items) >= CAP_FILES:
                return "\n".join(items) + "\n…(more)"
    return "\n".join(items)


def models_built():
    try:
        out = subprocess.run(["ollama", "list"], capture_output=True, text=True,
                             env={**os.environ, "OLLAMA_HOST": "127.0.0.1:11435"}, timeout=15).stdout
        return out.strip()
    except Exception:
        return "(unavailable)"


def existing_titles():
    try:
        req = urllib.request.Request(f"{SITE}/api/milestones?limit=200",
                                     headers={"User-Agent": "terrarium-chronicler/1.0"})
        data = json.load(urllib.request.urlopen(req, timeout=20))
        return [m["title"] for m in data.get("milestones", [])]
    except Exception:
        return []


def ask_model(prompt):
    body = json.dumps({"model": MODEL, "prompt": prompt, "stream": False, "format": "json",
                       "options": {"temperature": 0.4, "num_ctx": 16384}}).encode()
    req = urllib.request.Request(OLLAMA, data=body, method="POST",
                                 headers={"Content-Type": "application/json"})
    resp = json.load(urllib.request.urlopen(req, timeout=240))
    return resp.get("response", "")


def ship(m, tok):
    payload = json.dumps({"title": m["title"], "summary": m.get("summary", ""), "tag": m.get("tag", "milestone")}).encode()
    req = urllib.request.Request(f"{SITE}/api/milestones/ingest", data=payload, method="POST",
                                 headers={"Content-Type": "application/json",
                                          "Authorization": "Bearer " + tok,
                                          "User-Agent": "terrarium-chronicler/1.0"})
    return json.load(urllib.request.urlopen(req, timeout=20))


def main():
    tok = token()
    if not tok:
        print("no ingest token; abort"); return
    seen = existing_titles()
    seen_lc = {t.lower() for t in seen}

    prompt = f"""RECENT ACTIVITY TO REVIEW (review for genuinely NEW developments or breakthroughs):

== Kimi's journal (recent) ==
{journal_tail()}

== Recent wakings (cycle: what it reported) ==
{recent_cycles()}

== Its world now (files it has created) ==
{space_tree()}

== Models it has built or pulled ==
{models_built()}

== Milestones ALREADY recorded — do NOT repeat these ==
{chr(10).join('- ' + t for t in seen) or '(none yet — this is the first review)'}

Output the JSON object of any genuinely new milestones since those already recorded."""

    try:
        raw = ask_model(prompt)
    except (urllib.error.URLError, OSError) as e:
        print("model call failed:", e); return

    try:
        obj = json.loads(raw)
        new = obj.get("milestones", []) if isinstance(obj, dict) else (obj if isinstance(obj, list) else [])
    except json.JSONDecodeError:
        m = re.search(r'\{.*\}', raw, re.S)
        new = (json.loads(m.group(0)).get("milestones", []) if m else [])

    shipped = 0
    for ms in new:
        if not isinstance(ms, dict):
            continue
        title = (ms.get("title") or "").strip()
        if not title or title.lower() in seen_lc:
            continue
        try:
            r = ship(ms, tok)
            if r.get("ok") and not r.get("skipped"):
                shipped += 1
                seen_lc.add(title.lower())
                print("recorded:", title)
            if shipped >= MAX_NEW_PER_RUN:
                break
        except (urllib.error.URLError, OSError) as e:
            print("ship failed:", e); break
    print(f"chronicler run done — {shipped} new milestone(s)")


if __name__ == "__main__":
    main()
