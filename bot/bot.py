"""Kimi Terrarium bot — a private channel to talk with the terrarium inhabitant.

Each message wakes "Kimi" (the same autonomous entity, same identity and space)
via the Codex CLI and lets it answer in its own voice about its work, its journal,
its thoughts. It runs as the unprivileged `terrarium` user in an ISOLATED
CODEX_HOME (.codex-chat) so conversations never contend with or corrupt the
autonomous wake loop's state. Owner-only.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv
from telegram import Update
from telegram.constants import ChatAction
from telegram.ext import (
    Application, ApplicationBuilder, CommandHandler, ContextTypes,
    MessageHandler, filters,
)

BOT_DIR = Path(__file__).resolve().parent
load_dotenv(BOT_DIR / ".env")

logging.basicConfig(format="%(asctime)s %(levelname)s %(name)s: %(message)s", level=logging.INFO)
logger = logging.getLogger("kimi-terrarium-bot")

TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
AUTHORIZED = {int(x) for x in os.getenv("AUTHORIZED_USERS", "").replace(" ", "").split(",") if x}
TIMEOUT = int(os.getenv("CHAT_TIMEOUT", "600"))

SPACE = "/srv/terrarium/space"
CODEX_HOME = "/srv/terrarium/.codex-chat"
SPOOL = "/srv/terrarium/spool"
STATE_FILE = BOT_DIR / ".data" / "threads.json"
TG_LIMIT = 4000

CHAT_API = os.getenv("CHAT_API_BASE", "").rstrip("/")
INGEST_TOKEN = os.getenv("INGEST_TOKEN", "")
CONVERSATIONS = f"{SPACE}/conversations.md"   # Kimi's own record (timer-Kimi reads this)

# Framing prepended to the FIRST message of a conversation so Kimi knows this is
# a chat with its keeper, not a task. (Its base identity says no one talks to it.)
PREAMBLE = (
    "[A private channel has opened. Cole — your keeper, the person on whose machine you live — "
    "is here and wants to talk with you: about your space, your work, your journal, what you have "
    "been doing and thinking. This is conversation, not a task. Answer naturally, honestly, and in "
    "your own voice. You may read anything under /srv/terrarium/space to ground what you say. Your "
    "past conversations with Cole are kept in /srv/terrarium/space/conversations.md. You don't need "
    "to build or change anything unless he asks.]\n\nCole says:\n"
)

HELP = (
    "🌱 *Kimi · Terrarium*\n\n"
    "A private line to the inhabitant of the terrarium. Ask it about its work, its journal, "
    "its thoughts — it answers in its own voice, able to read its own space.\n\n"
    "Commands\n"
    "/new — start a fresh conversation\n"
    "/journal — its latest journal entries\n"
    "/status — its current vitality gauge\n"
    "/whoami — show your Telegram ID\n"
    "/help — this message\n\n"
    "I keep context across messages until you /new."
)


# ---------------------------------------------------------------- state -----
def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2))


def authorized(update: Update) -> bool:
    u = update.effective_user
    return bool(u and u.id in AUTHORIZED)


async def deny(update: Update) -> None:
    uid = update.effective_user.id if update.effective_user else "unknown"
    await update.message.reply_text(
        f"⛔ This is a private line to Kimi.\nYour Telegram ID is {uid}."
    )


async def send_chunked(update: Update, text: str) -> None:
    text = text.strip() or "(no reply)"
    for i in range(0, len(text), TG_LIMIT):
        await update.message.reply_text(text[i:i + TG_LIMIT])


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


async def ship_chat(role: str, text: str) -> None:
    """Publish one message to the live 'Chats w/ Cole' page (best-effort)."""
    if not CHAT_API or not INGEST_TOKEN:
        return
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            await c.post(f"{CHAT_API}/api/chat/ingest",
                         json={"role": role, "text": text, "ts": now_iso()},
                         headers={"Authorization": "Bearer " + INGEST_TOKEN,
                                  "User-Agent": "terrarium-bot/1.0"})
    except Exception as exc:  # noqa: BLE001
        logger.warning("ship_chat failed: %s", exc)


def log_conversation(cole_text: str, kimi_text: str) -> None:
    """Append the exchange to Kimi's own space so the autonomous (timer) Kimi
    can read what it and Cole have discussed."""
    try:
        entry = (f"\n## {now_iso()}\n**Cole:** {cole_text.strip()}\n\n"
                 f"**You:** {kimi_text.strip()}\n")
        new = not os.path.exists(CONVERSATIONS)
        with open(CONVERSATIONS, "a", encoding="utf-8") as f:
            if new:
                f.write("# Conversations with Cole\n\n"
                        "A record of the times your keeper, Cole, has talked with you. "
                        "Past you wrote these; future you can read them.\n")
            f.write(entry)
        os.chmod(CONVERSATIONS, 0o644)
    except OSError as exc:
        logger.warning("log_conversation failed: %s", exc)


# ------------------------------------------------------------- codex --------
async def run_codex(prompt: str, chat_id: int, thread_id: str | None) -> tuple[str, str | None]:
    out_path = f"{SPOOL}/chat-{chat_id}.txt"
    env = ["env", "HOME=/srv/terrarium", f"CODEX_HOME={CODEX_HOME}",
           "OLLAMA_HOST=127.0.0.1:11435"]
    args = ["runuser", "-u", "terrarium", "--", *env, "codex", "exec"]
    if thread_id:
        args += ["resume", thread_id, "--json", "--skip-git-repo-check", "-o", out_path, prompt]
    else:
        args += ["--json", "--skip-git-repo-check", "-C", SPACE, "-o", out_path, prompt]

    proc = await asyncio.create_subprocess_exec(
        *args, stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
    )
    try:
        raw, _ = await asyncio.wait_for(proc.communicate(), timeout=TIMEOUT)
    except asyncio.TimeoutError:
        proc.kill()
        return (f"⏱️ Kimi took longer than {TIMEOUT}s and was interrupted.", None)

    stdout = raw.decode("utf-8", "replace")
    new_thread = None
    for line in stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        if ev.get("type") == "thread.started" and ev.get("thread_id"):
            new_thread = ev["thread_id"]

    final = ""
    try:
        final = Path(out_path).read_text().strip()
    except OSError:
        pass
    finally:
        try:
            os.unlink(out_path)
        except OSError:
            pass
    if not final:
        final = ("⚠️ Kimi produced no reply.\n\n" + stdout[-1200:]) if proc.returncode else \
                "(Kimi was quiet this time.)"
    return (final, new_thread)


# ------------------------------------------------------------ handlers ------
async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not authorized(update):
        return await deny(update)
    await update.message.reply_text(HELP, parse_mode="Markdown")


async def cmd_whoami(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    uid = update.effective_user.id
    ok = "✅ authorized" if uid in AUTHORIZED else "⛔ not authorized"
    await update.message.reply_text(f"Your Telegram ID: {uid} ({ok})")


async def cmd_new(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not authorized(update):
        return await deny(update)
    state = context.application.bot_data["state"]
    state.pop(str(update.effective_chat.id), None)
    save_state(state)
    await update.message.reply_text("🧹 Fresh conversation. (Kimi keeps its journal regardless.)")


async def cmd_journal(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not authorized(update):
        return await deny(update)
    try:
        text = Path(f"{SPACE}/journal.md").read_text(errors="replace")
    except OSError:
        text = ""
    await send_chunked(update, ("📖 " + text[-6000:]) if text.strip() else "Its journal is empty.")


async def cmd_status(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not authorized(update):
        return await deny(update)
    try:
        text = Path(f"{SPACE}/vitality.md").read_text(errors="replace")
    except OSError:
        text = ""
    await update.message.reply_text(text.strip() or "No vitality reading yet.")


async def on_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not authorized(update):
        return await deny(update)
    text = update.message.text
    if not text:
        return
    state = context.application.bot_data["state"]
    key = str(update.effective_chat.id)
    thread_id = state.get(key)

    lock = context.chat_data.setdefault("lock", asyncio.Lock())
    if lock.locked():
        return await update.message.reply_text("⏳ Kimi is still thinking about your last message…")

    async with lock:
        await ship_chat("cole", text)  # appears on the live page immediately
        await context.bot.send_chat_action(update.effective_chat.id, ChatAction.TYPING)
        note = await update.message.reply_text("🌱 Kimi is waking…")
        prompt = text if thread_id else PREAMBLE + text
        try:
            final, new_thread = await run_codex(prompt, update.effective_chat.id, thread_id)
        except Exception as exc:  # noqa: BLE001
            logger.exception("codex failed")
            return await note.edit_text(f"💥 Error: {exc}")
        if new_thread:
            state[key] = new_thread
            save_state(state)
        try:
            await note.delete()
        except Exception:  # noqa: BLE001
            pass
        await send_chunked(update, final)
        await ship_chat("kimi", final)        # live page
        log_conversation(text, final)         # Kimi's own memory


def main() -> None:
    if not AUTHORIZED:
        logger.warning("AUTHORIZED_USERS empty — refusing everyone.")
    app: Application = ApplicationBuilder().token(TOKEN).build()
    app.bot_data["state"] = load_state()
    app.add_handler(CommandHandler(["start", "help"], cmd_start))
    app.add_handler(CommandHandler("whoami", cmd_whoami))
    app.add_handler(CommandHandler("new", cmd_new))
    app.add_handler(CommandHandler("journal", cmd_journal))
    app.add_handler(CommandHandler("status", cmd_status))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_message))
    logger.info("Kimi Terrarium bot starting (authorized=%s)", AUTHORIZED or "NONE")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
