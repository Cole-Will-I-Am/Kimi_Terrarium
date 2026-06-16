#!/usr/bin/env python3
"""One-off: backfill Chronicle milestones from the START of the terrarium.

The hourly chronicler only reviews the last ~12 cycles, so early breakthroughs
were never swept. This walks the full archive (cycle 1 -> now) in chronological
windows, asks the same `chronicler` model for genuinely-new milestones per
window, and ships them — deduping against everything already recorded.
"""
import glob, json, os, sys, time

sys.path.insert(0, os.path.dirname(__file__))
import chronicle as C  # reuse token(), ask_model(), ship(), existing_titles()

WINDOW = 10  # cycles per review batch


def cycle_records():
    files = sorted(glob.glob(f"{C.ARCHIVE}/*.json"),
                   key=lambda p: int(os.path.basename(p)[:-5]) if os.path.basename(p)[:-5].isdigit() else 0)
    recs = []
    for f in files:
        try:
            d = json.load(open(f))
            recs.append((int(d.get("cycle", 0)), (d.get("summary") or "").strip()))
        except Exception:
            pass
    return recs


def main():
    tok = C.token()
    if not tok:
        print("no ingest token; abort"); return
    seen_lc = {t.lower() for t in C.existing_titles()}
    print(f"starting backfill; {len(seen_lc)} milestone(s) already recorded")

    recs = cycle_records()
    if not recs:
        print("no archive records found"); return
    print(f"archive spans cycle {recs[0][0]}..{recs[-1][0]} ({len(recs)} records)")

    total_new = 0
    for i in range(0, len(recs), WINDOW):
        batch = recs[i:i + WINDOW]
        lo, hi = batch[0][0], batch[-1][0]
        body = "\n".join(f"#{c}: {s[:C.CAP_SUMMARY]}" for c, s in batch if s)
        prompt = f"""You are reviewing an EARLY period of the terrarium's history for milestones.

== Wakings in this period (cycle: what it reported) ==
{body}

== Milestones ALREADY recorded — do NOT repeat or rephrase these ==
{chr(10).join('- ' + t for t in sorted(seen_lc)) or '(none yet)'}

Identify only GENUINELY NEW, significant milestones from THIS period that are not
already recorded. Output the JSON object of milestones (title, summary, tag).
If nothing genuinely new, output an empty list."""
        try:
            raw = C.ask_model(prompt)
        except Exception as e:
            print(f"window {lo}-{hi}: model failed: {e}"); continue
        try:
            obj = json.loads(raw)
            new = obj.get("milestones", []) if isinstance(obj, dict) else (obj if isinstance(obj, list) else [])
        except json.JSONDecodeError:
            import re
            m = re.search(r'\{.*\}', raw, re.S)
            new = (json.loads(m.group(0)).get("milestones", []) if m else [])
        win_new = 0
        for ms in new:
            if not isinstance(ms, dict):
                continue
            title = (ms.get("title") or "").strip()
            if not title or title.lower() in seen_lc:
                continue
            try:
                r = C.ship(ms, tok)
                if r.get("ok") and not r.get("skipped"):
                    seen_lc.add(title.lower()); win_new += 1; total_new += 1
                    print(f"  [{lo}-{hi}] recorded: {title}")
            except Exception as e:
                print(f"  ship failed: {e}")
        print(f"window {lo}-{hi}: {win_new} new")
        time.sleep(1)
    print(f"backfill done — {total_new} new milestone(s) total")


if __name__ == "__main__":
    main()
