function addSystemMessage(text) {
    const div = document.createElement("div");
    div.className = "system-message";
    div.textContent = text;
    messagesDiv.appendChild(div);
    scrollToBottom();
}

function addMessage(
    username,
    text,
    imageBase64,
    timestamp,
    isOwn = false,
    replyData = null,
    msgId = null,
    whisper = false,
) {
    if (
        msgId !== null &&
        msgId !== undefined &&
        messageElements.has(msgId)
    ) {
        return;
    }

    const wasAtBottom =
        messagesDiv.scrollHeight -
            messagesDiv.scrollTop -
            messagesDiv.clientHeight <
        SCROLL_THRESHOLD;
    const msgDiv = document.createElement("div");
    const cls = isOwn ? "message-own" : "message-other";
    msgDiv.className = `message ${cls}${whisper ? " whisper-msg" : ""}`;
    if (msgId) msgDiv.dataset.msgId = msgId;

    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.innerHTML = `<span class="message-name">${escapeHtml(username)}</span><span>${formatTimestamp(timestamp)}</span>`;
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    if (replyData && replyData.username) {
        const quote = document.createElement("div");
        quote.className = "reply-quote";
        const replyText = replyData.text
            ? replyData.text.length > 80
                ? replyData.text.slice(0, 80) + "…"
                : replyData.text
            : replyData.image
              ? "📷 Изображение"
              : "";
        quote.innerHTML = `<span class="reply-quote-name">${escapeHtml(replyData.username)}</span>: ${escapeHtml(replyText)}`;
        bubble.appendChild(quote);
    }

    if (text) {
        const textDiv = document.createElement("div");
        textDiv.className = "msg-text";
        textDiv.style.whiteSpace = "pre-wrap";
        textDiv.innerHTML = renderLinks(text);
        bubble.appendChild(textDiv);
    }
    if (imageBase64) {
        const img = document.createElement("img");
        img.src = imageBase64;
        img.className = "chat-image";
        img.alt = "изображение";
        img.onclick = () => window.open(imageBase64, "_blank");
        bubble.appendChild(img);
    }

    msgDiv.appendChild(meta);
    msgDiv.appendChild(bubble);

    if (!isOwn) {
        const replyBtn = document.createElement("button");
        replyBtn.className = "reply-btn";
        replyBtn.textContent = "↩ Ответить";
        replyBtn.title = "Ответить [ESC - отмена]";
        replyBtn.addEventListener("click", () => {
            replyTo = {
                username,
                text: text || (imageBase64 ? "📷 Изображение" : ""),
                timestamp,
            };
            whisperTo = null;
            const snippet =
                replyTo.text.length > 50
                    ? replyTo.text.slice(0, 50) + "…"
                    : replyTo.text;
            messageInput.placeholder = `(ESC) Ответить: @${username} - ${snippet}`;
            messageInput.focus();
        });
        meta.appendChild(replyBtn);

        const whisperBtn = document.createElement("button");
        whisperBtn.className = "reply-btn";
        whisperBtn.textContent = "🤫";
        whisperBtn.title = `Шёпот для ${username} [ESC - отмена]`;
        whisperBtn.addEventListener("click", () => {
            whisperTo = { username };
            replyTo = null;
            messageInput.placeholder = `(ESC) 🤫 @${username}: сообщение...`;
            messageInput.focus();
        });
        meta.appendChild(whisperBtn);
    }

    if (isOwn && msgId && !whisper) {
        const editBtn = document.createElement("button");
        editBtn.className = "edit-btn";
        editBtn.textContent = "✏️";
        editBtn.title = "Редактировать";
        editBtn.addEventListener("click", () =>
            startEditing(msgId, text || ""),
        );
        meta.appendChild(editBtn);
    }

    if (msgId) {
        messageElements.set(msgId, {
            div: msgDiv,
            textDiv: bubble.querySelector(".msg-text"),
            bubble,
        });
    }

    messagesDiv.appendChild(msgDiv);
    if (wasAtBottom) messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function startEditing(msgId, currentText) {
    const entry = messageElements.get(msgId);
    if (!entry || !entry.textDiv) return;
    const { textDiv, bubble } = entry;

    textDiv.style.display = "none";
    const ta = document.createElement("textarea");
    ta.className = "edit-textarea";
    ta.value = currentText;
    bubble.appendChild(ta);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    let editClosed = false;

    function saveEdit() {
        const newText = ta.value.trim();
        if (!newText || newText === currentText) {
            cancelEdit();
            return;
        }
        socket.emit("edit_message", { id: msgId, text: newText });
        ta.disabled = true;
        ta.style.opacity = "0.5";
    }

    function cancelEdit() {
        if (editClosed) return;
        editClosed = true;
        ta.remove();
        textDiv.style.display = "";
    }

    ta.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            saveEdit();
        } else if (event.key === "Escape") {
            event.preventDefault();
            cancelEdit();
        }
    });
    ta.addEventListener("blur", cancelEdit);
}

function updateEditedMessage(msgId, newText, newTimestamp) {
    const entry = messageElements.get(msgId);
    if (!entry) return;
    const { textDiv, bubble } = entry;

    const existingTa = bubble.querySelector(".edit-textarea");
    if (existingTa) existingTa.remove();

    if (textDiv) {
        textDiv.style.display = "";
        textDiv.innerHTML = renderLinks(newText);
    }

    const meta = entry.div.querySelector(".message-meta");
    if (!meta) return;
    let badge = meta.querySelector(".edited-badge");
    if (!badge) {
        badge = document.createElement("span");
        badge.className = "edited-badge";
        badge.textContent = "ред.";
        meta.appendChild(badge);
    }

    const spans = meta.querySelectorAll("span");
    for (const span of spans) {
        if (
            span.classList.contains("message-name") ||
            span.classList.contains("edited-badge")
        ) {
            continue;
        }
        if (newTimestamp) span.textContent = formatTimestamp(newTimestamp);
        break;
    }
}

function scrollToBottom() {
    const atBottom =
        messagesDiv.scrollHeight -
            messagesDiv.scrollTop -
            messagesDiv.clientHeight <
        SCROLL_THRESHOLD;
    if (atBottom) messagesDiv.scrollTop = messagesDiv.scrollHeight;
}