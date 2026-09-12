from fastapi import FastAPI
from fastapi.responses import FileResponse
from collections import deque
from datetime import datetime
import socketio
import os
import json
import tempfile
import unicodedata

# History persistence can be disabled on hosts without persistent storage.
write_history = os.environ.get("WRITE_HISTORY", "false").lower() in ("1", "true", "yes", "on")

app = FastAPI(title="Python Chat")

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    max_http_buffer_size=20 * 1024 * 1024,  # 20 MB
    ping_interval=25,
    ping_timeout=30,
)

asgi_app = socketio.ASGIApp(sio, other_asgi_app=app)

users = {}
MAX_HISTORY_MESSAGES = 100
messages = deque(maxlen=MAX_HISTORY_MESSAGES)
message_id_counter = 0
HISTORY_FILE = "chat_history.json"
WHISPER_HISTORY_FILE = "whisper_history.json"
whisper_history = []
MAX_NICK_LENGTH = 24
MAX_TEXT_LENGTH = 16000
MAX_IMAGE_LENGTH = 14 * 1024 * 1024
CONTENT_LIMITS = {
    "nickname": (MAX_NICK_LENGTH, "Никнейм"),
    "message": (MAX_TEXT_LENGTH, "Сообщение"),
    "image": (MAX_IMAGE_LENGTH, "Изображение"),
}
COMPACT_HISTORY_FIELDS = {
    "username": "u",
    "text": "t",
    "image": "i",
    "reply_to": "r",
    "edited": "e",
    "timestamp": "ts",
    "from": "f",
    "to": "d",
    "whisper": "w",
}

# Разрешённый набор для ника: латиница, кириллица, цифры и обычные
# клавиатурные символы, перечисленные в правилах чата.
ALLOWED_NICK_CHARS = frozenset(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "йцукенгшщзхъфывапролджэячсмитьбю"
    "ЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮ"
    "1234567890"
    " !@#$%^&*()\"№;:?'|\\/.,{[}]`~+-=_"
)


def sanitize_nick(nick):
    """Remove characters outside the chat's standard nickname alphabet."""
    return "".join(character for character in nick if character in ALLOWED_NICK_CHARS)


def normalize_nick_for_comparison(nick):
    """Normalize nicknames for uniqueness and anti-impersonation checks."""
    normalized = unicodedata.normalize("NFKC", nick).casefold()
    return "".join(
        character
        for character in normalized
        if not character.isspace()
        and unicodedata.category(character) not in {"Cc", "Cf"}
        and not ("\u2800" <= character <= "\u28ff")
    )


def validate_content_length(value, content_type):
    """Return an error for an oversized nickname, message, or image payload."""
    limit_data = CONTENT_LIMITS.get(content_type)
    if limit_data is None:
        raise ValueError(f"Unknown content type: {content_type}")
    limit, label = limit_data
    if len(value) > limit:
        if content_type == "image":
            return f"{label} слишком большое (максимум: {limit // (1024 * 1024)} МБ)"
        return f"{label} слишком длинный (максимум: {limit} символов)"
    return None


def normalize_history_timestamp(timestamp):
    if not isinstance(timestamp, str):
        return timestamp
    parts = timestamp.split(":")
    if len(parts) == 3 and all(part.isdigit() for part in parts):
        return ":".join(parts[:2])
    return timestamp


def get_server_utc_offset_minutes():
    offset = datetime.now().astimezone().utcoffset()
    return int(offset.total_seconds() // 60) if offset else 0


def current_timestamp():
    return datetime.now().strftime("%H:%M")


def next_message_id():
    global message_id_counter
    message_id_counter += 1
    return message_id_counter


async def send_system(message, *, sid=None, skip_sid=None):
    target = (
        {"to": sid}
        if sid is not None
        else {"skip_sid": skip_sid}
        if skip_sid is not None
        else {}
    )
    await sio.emit("system", {"msg": message}, **target)


def validate_message_content(text, image):
    text = text.strip()
    error = validate_content_length(text, "message") or validate_content_length(
        image or "", "image"
    )
    return text, error


def expand_history_message(message):
    expanded = dict(message)
    for full_key, compact_key in COMPACT_HISTORY_FIELDS.items():
        if full_key not in expanded and compact_key in expanded:
            expanded[full_key] = expanded[compact_key]
        expanded.pop(compact_key, None)
    if isinstance(expanded.get("reply_to"), dict):
        expanded["reply_to"] = expand_history_message(expanded["reply_to"])
    if "timestamp" in expanded:
        expanded["timestamp"] = normalize_history_timestamp(expanded["timestamp"])
    return expanded


def compact_history_message(message):
    compact = {}
    for full_key, compact_key in COMPACT_HISTORY_FIELDS.items():
        if full_key in message:
            value = message[full_key]
            if full_key == "reply_to" and isinstance(value, dict):
                value = compact_history_message(value)
            compact[compact_key] = (
                normalize_history_timestamp(value)
                if full_key == "timestamp"
                else value
            )
    if "id" in message:
        compact["id"] = message["id"]
    return compact


def load_history():
    global message_id_counter
    try:
        with open(HISTORY_FILE, "r", encoding="utf-8") as history_file:
            raw_history = history_file.read()
        if not raw_history.strip():
            return
        saved_messages = json.loads(raw_history)
        if not isinstance(saved_messages, list):
            raise ValueError("history must be a list")
        saved_messages = [
            expand_history_message(message)
            for message in saved_messages[-MAX_HISTORY_MESSAGES:]
            if isinstance(message, dict)
        ]
        messages.extend(saved_messages)
        message_id_counter = max(
            (
                message.get("id", 0)
                for message in messages
                if isinstance(message.get("id", 0), int)
            ),
            default=0,
        )
        if [
            compact_history_message(message) for message in saved_messages
        ] != [
            message
            for message in json.loads(raw_history)[-MAX_HISTORY_MESSAGES:]
            if isinstance(message, dict)
        ]:
            save_history()
        print(f"[HISTORY] Загружено сообщений: {len(messages)}")
    except FileNotFoundError:
        print("[HISTORY] Файл истории ещё не создан")
    except (OSError, json.JSONDecodeError, ValueError) as error:
        print(f"[HISTORY] Не удалось загрузить историю: {error}")


def save_history():
    temporary_path = None
    try:
        history_directory = os.path.dirname(os.path.abspath(HISTORY_FILE)) or "."
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=history_directory, delete=False
        ) as temporary_file:
            json.dump(
                [compact_history_message(message) for message in messages],
                temporary_file,
                ensure_ascii=False,
                separators=(",", ":"),
            )
            temporary_path = temporary_file.name
        os.replace(temporary_path, HISTORY_FILE)
    except OSError as error:
        print(f"[HISTORY] Не удалось сохранить историю: {error}")
        if temporary_path:
            try:
                os.unlink(temporary_path)
            except OSError:
                pass


def load_whisper_history():
    global message_id_counter
    try:
        with open(WHISPER_HISTORY_FILE, "r", encoding="utf-8") as history_file:
            raw_history = history_file.read()
        if not raw_history.strip():
            return
        saved_whispers = json.loads(raw_history)
        if isinstance(saved_whispers, list):
            saved_whispers = [
                expand_history_message(whisper)
                for whisper in saved_whispers
                if isinstance(whisper, dict)
            ]
            whisper_history.extend(saved_whispers)
            used_ids = {
                message.get("id")
                for message in messages
                if isinstance(message.get("id"), int) and message.get("id") > 0
            }
            history_changed = False
            for whisper in whisper_history:
                whisper_id = whisper.get("id")
                if (
                    not isinstance(whisper_id, int)
                    or whisper_id <= 0
                    or whisper_id in used_ids
                ):
                    message_id_counter += 1
                    while message_id_counter in used_ids:
                        message_id_counter += 1
                    whisper["id"] = message_id_counter
                    history_changed = True
                else:
                    message_id_counter = max(message_id_counter, whisper_id)
                used_ids.add(whisper["id"])
                if "username" not in whisper and isinstance(whisper.get("from"), str):
                    whisper["username"] = whisper["from"]
                    history_changed = True
                if "edited" not in whisper:
                    whisper["edited"] = False
                    history_changed = True
                if "whisper" not in whisper:
                    whisper["whisper"] = True
                    history_changed = True
            if history_changed or [
                compact_history_message(whisper) for whisper in whisper_history
            ] != [
                whisper
                for whisper in json.loads(raw_history)
                if isinstance(whisper, dict)
            ]:
                save_whisper_history()
        print(f"[WHISPER HISTORY] Загружено сообщений: {len(whisper_history)}")
    except FileNotFoundError:
        print("[WHISPER HISTORY] Файл истории ещё не создан")
    except (OSError, json.JSONDecodeError) as error:
        print(f"[WHISPER HISTORY] Не удалось загрузить историю: {error}")


def save_whisper_history():
    temporary_path = None
    try:
        history_directory = (
            os.path.dirname(os.path.abspath(WHISPER_HISTORY_FILE)) or "."
        )
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=history_directory, delete=False
        ) as temporary_file:
            json.dump(
                [compact_history_message(whisper) for whisper in whisper_history],
                temporary_file,
                ensure_ascii=False,
                separators=(",", ":"),
            )
            temporary_path = temporary_file.name
        os.replace(temporary_path, WHISPER_HISTORY_FILE)
    except OSError as error:
        print(f"[WHISPER HISTORY] Не удалось сохранить историю: {error}")
        if temporary_path:
            try:
                os.unlink(temporary_path)
            except OSError:
                pass


if write_history:
    load_history()
    load_whisper_history()


def get_history_for_nick(nick):
    visible_whispers = [
        whisper
        for whisper in whisper_history
        if (
            whisper.get("from", "").lower() == nick.lower()
            or whisper.get("to", "").lower() == nick.lower()
        )
    ]
    return sorted(
        [*messages, *visible_whispers],
        key=lambda message: message.get("id", 0),
    )


@app.get("/")
async def index():
    return FileResponse(
        "templates/index.html",
        media_type="text/html",
        headers={"Cache-Control": "no-store, must-revalidate"},
    )


@app.get("/favicon.ico")
async def favicon():
    return FileResponse(
        "favicon.ico",
        media_type="image/x-icon",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@app.get("/msg.ico")
async def message_icon():
    return FileResponse(
        "msg.ico",
        media_type="image/x-icon",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@sio.event
async def connect(sid, environ):
    transport = environ.get("asgi.scope", {}).get("type", "unknown")
    print(f"[SOCKET CONNECT] sid={sid} transport={transport}")


@sio.on("set_nick")
async def handle_set_nick(sid, data):
    if not isinstance(data, dict):
        return
    nick = data.get("nick", "")
    if not isinstance(nick, str):
        return
    nick = sanitize_nick(nick).strip()
    if not nick:
        await sio.emit("nick_failed", {"reason": "Ник не может быть пустым"}, to=sid)
        return
    nick_error = validate_content_length(nick, "nickname")
    if nick_error:
        await sio.emit("nick_failed", {"reason": nick_error}, to=sid)
        return
    old_nick = users.get(sid)
    nick_key = normalize_nick_for_comparison(nick)
    if not nick_key:
        await sio.emit("nick_failed", {"reason": "Ник не может быть пустым"}, to=sid)
        return
    # Запрещаем точные совпадения и попытки взять чужой ник с суффиксом.
    for other_sid, existing_nick in users.items():
        existing_key = normalize_nick_for_comparison(existing_nick)
        if other_sid != sid and existing_key and nick_key.startswith(existing_key):
            await sio.emit("nick_failed", {"reason": "никнейм уже занят"}, to=sid)
            return
    users[sid] = nick
    await sio.emit(
        "nick_success",
        {
            "nick": nick,
            "server_utc_offset_minutes": get_server_utc_offset_minutes(),
        },
        to=sid,
    )
    if old_nick is None:
        await sio.emit("chat_history", get_history_for_nick(nick), to=sid)
    if old_nick is None:
        await send_system(f"👋 {nick} присоединился к чату", skip_sid=sid)
    elif old_nick != nick:
        await send_system(f"✏️ {old_nick} сменил ник на {nick}", skip_sid=sid)


@sio.on("send_message")
async def handle_message(sid, data):
    if not isinstance(data, dict):
        return
    text = data.get("text", "")
    image = data.get("image")  # base64 строка, может быть None
    reply_to = data.get("reply_to")  # {username, text, timestamp} или None
    if not isinstance(text, str) or not isinstance(image, (str, type(None))):
        return
    if reply_to is not None and not isinstance(reply_to, dict):
        return
    text, content_error = validate_message_content(text, image)
    if content_error:
        await send_system(content_error, sid=sid)
        return
    if not text and not image:
        return
    nick = users.get(sid)
    if not nick:
        await send_system("Сначала установи никнейм", sid=sid)
        return
    msg = {
        "id": next_message_id(),
        "username": nick,
        "text": text,
        "image": image,
        "reply_to": reply_to,
        "edited": False,
        "timestamp": current_timestamp(),
    }
    messages.append(msg)
    if write_history:
        save_history()
    try:
        await sio.emit("new_message", msg)
    except Exception as e:
        print(f"Broadcast error: {e}")
        await send_system("Не удалось отправить сообщение (превышен размер)", sid=sid)


@sio.on("edit_message")
async def handle_edit_message(sid, data):
    if not isinstance(data, dict):
        await send_system("Некорректные данные редактирования", sid=sid)
        return
    msg_id = data.get("id")
    new_text = data.get("text", "")
    if (
        not isinstance(msg_id, int)
        or isinstance(msg_id, bool)
        or msg_id <= 0
    ):
        await send_system("Некорректный ID сообщения", sid=sid)
        return
    if not isinstance(new_text, str):
        await send_system("Текст сообщения должен быть строкой", sid=sid)
        return
    new_text = new_text.strip()
    if not new_text:
        await send_system("Текст сообщения не может быть пустым", sid=sid)
        return
    content_error = validate_content_length(new_text, "message")
    if content_error:
        await send_system(content_error, sid=sid)
        return
    nick = users.get(sid)
    if not nick:
        return
    msg = next((message for message in messages if message.get("id") == msg_id), None)
    if msg is None:
        await send_system("Сообщение не найдено", sid=sid)
        return
    if msg.get("whisper"):
        await send_system("Whisper-сообщения нельзя редактировать", sid=sid)
        return
    if msg.get("username") != nick:
        await send_system("Нельзя редактировать чужие сообщения", sid=sid)
        return

    old_text = msg.get("text", "")
    if not isinstance(old_text, str):
        old_text = ""
    msg["text"] = new_text
    msg["edited"] = True
    msg["timestamp"] = current_timestamp()
    if write_history:
        save_history()
    print(
        f"[EDIT] sid={sid} id={msg_id} "
        f"old_text_length={len(old_text)} new_text_length={len(new_text)}"
    )
    await sio.emit(
        "message_edited",
        {"id": msg_id, "text": new_text, "timestamp": msg["timestamp"]},
    )


@sio.on("whisper_message")
async def handle_whisper(sid, data):
    if not isinstance(data, dict):
        return
    target_nick = data.get("target_nick", "")
    text = data.get("text", "")
    image = data.get("image")
    reply_to = data.get("reply_to")
    if (
        not isinstance(target_nick, str)
        or not isinstance(text, str)
        or not isinstance(image, (str, type(None)))
    ):
        return
    target_nick_error = validate_content_length(target_nick, "nickname")
    if target_nick_error:
        await send_system(target_nick_error, sid=sid)
        return
    if reply_to is not None and not isinstance(reply_to, dict):
        return
    text, content_error = validate_message_content(text, image)
    if not text and not image:
        return
    if content_error:
        await send_system(content_error, sid=sid)
        return
    nick = users.get(sid)
    if not nick:
        return
    target_sid = None
    for other_sid, other_nick in users.items():
        if other_nick.lower() == target_nick.lower():
            target_sid = other_sid
            break
    if not target_sid or target_sid == sid:
        await send_system(f"Пользователь «{target_nick}» не найден", sid=sid)
        return
    msg = {
        "id": next_message_id(),
        "username": nick,
        "from": nick,
        "to": target_nick,
        "text": text,
        "image": image,
        "reply_to": reply_to,
        "edited": False,
        "whisper": True,
        "timestamp": current_timestamp(),
    }
    whisper_history.append(msg)
    if write_history:
        save_whisper_history()
    print(
        f"[WHISPER] sid={sid} target_sid={target_sid} "
        f"text_length={len(text)} has_image={bool(image)}"
    )
    await sio.emit("new_whisper", msg, to=sid)
    await sio.emit("new_whisper", msg, to=target_sid)


@sio.event
async def disconnect(sid):
    nick = users.pop(sid, None)
    print(f"[SOCKET DISCONNECT] sid={sid} had_nick={bool(nick)}")
    if nick:
        await send_system(f"👋 {nick} покинул чат")


if __name__ == "__main__":
    import asyncio
    from hypercorn.asyncio import serve
    from hypercorn.config import Config

    port = int(os.environ.get("PORT", 5000))
    config = Config()
    config.bind = [f"0.0.0.0:{port}"]
    config.graceful_timeout = 10
    config.keep_alive_timeout = 30
    asyncio.run(serve(asgi_app, config))
