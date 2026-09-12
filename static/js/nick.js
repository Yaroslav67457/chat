socket.on("nick_success", (data) => {
    currentNick = data.nick;
    if (Number.isFinite(data.server_utc_offset_minutes)) {
        serverUtcOffsetMinutes = data.server_utc_offset_minutes;
    }
    nickInput.value = currentNick;
    localStorage.setItem("python_chat_nick", data.nick);
    addSystemMessage(`✅ Ваш ник: ${currentNick}`);
});

socket.on("nick_failed", (data) => {
    addSystemMessage(`❌ Ошибка: ${data.reason}`);
});

function setNick() {
    const nick = nickInput.value.trim();
    if (!nick) {
        addSystemMessage("Введите никнейм");
        return;
    }
    socket.emit("set_nick", { nick });
}