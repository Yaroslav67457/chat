function reasonCode(reason) {
    const codes = {
        "io server disconnect": "SERVER_DISCONNECT",
        "io client disconnect": "CLIENT_DISCONNECT",
        "ping timeout": "PING_TIMEOUT",
        "transport close": "TRANSPORT_CLOSE",
        "transport error": "TRANSPORT_ERROR",
    };
    return codes[reason] || "UNKNOWN_DISCONNECT";
}

function reasonText(reason) {
    const texts = {
        "io server disconnect": "сервер принудительно закрыл соединение",
        "io client disconnect": "соединение закрыто клиентом",
        "ping timeout": "сервер не получил heartbeat вовремя",
        "transport close": "транспорт закрыт прокси или сетью",
        "transport error": "ошибка WebSocket или polling-транспорта",
    };
    return texts[reason] || "причина не распознана";
}

function renderHistoryMessage(message) {
    if (message.whisper === true || (message.from && message.to)) {
        addWhisperMessage(message, false);
        return;
    }
    addMessage(
        message.username,
        message.text,
        message.image,
        message.timestamp,
        message.username === currentNick,
        message.reply_to || null,
        message.id || null,
    );
}

socket.on("connect", () => {
    historyRenderedForSocketId = null;
    statusSpan.innerHTML = "🟢 Онлайн";
    statusSpan.style.color = "#b4f0b0";
    addSystemMessage("Соединение с сервером установлено");
    autoSetSavedNick();
});

socket.on("disconnect", (reason) => {
    statusSpan.innerHTML = "🔴 Офлайн";
    statusSpan.style.color = "#ffaeae";
    if (reason !== "io client disconnect") {
        addSystemMessage(
            `🔌 Соединение оборвалось [${reasonCode(reason)}]: ${reasonText(reason)}. Переподключение...`,
        );
    }
});

socket.on("connect_error", (error) => {
    statusSpan.innerHTML = "🟡 Переподключение...";
    statusSpan.style.color = "#ffe08a";
    const message = error?.message || "unknown error";
    addSystemMessage(
        `⚠️ Ошибка подключения [CONNECT_ERROR]: ${message}. Повторная попытка...`,
    );
    console.warn("Socket.IO connection error:", error);
});

socket.on("system", (data) => {
    addSystemMessage(data.msg);
});

socket.on("new_message", (data) => {
    const isOwn = data.username === currentNick;
    addMessage(
        data.username,
        data.text,
        data.image,
        data.timestamp,
        isOwn,
        data.reply_to || null,
        data.id || null,
    );
    if (!isOwn) {
        showNotification(
            data.username,
            messagePreview(data.text, data.image),
        );
    }
});

socket.on("chat_history", (history) => {
    if (
        !Array.isArray(history) ||
        historyRenderedForSocketId === socket.id
    ) {
        return;
    }

    historyRenderedForSocketId = socket.id;
    messagesDiv.replaceChildren();
    messageElements.clear();
    const orderedHistory = [...history].sort(
        (left, right) => (left.id || 0) - (right.id || 0),
    );
    orderedHistory.forEach(renderHistoryMessage);
    if (orderedHistory.length) {
        addSystemMessage(`📜 Загружено ${orderedHistory.length} сообщений`);
    }
});

socket.on("message_edited", (data) => {
    updateEditedMessage(data.id, data.text, data.timestamp || null);
});

socket.on("new_whisper", (data) => {
    addWhisperMessage(data, true);
});

socket.on("whisper_history", (data) => {
    addWhisperMessage(data, false);
});