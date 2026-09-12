function sendMessageWithImage(imageBase64 = null) {
    if (!currentNick) {
        addSystemMessage("Сначала установите никнейм!");
        return;
    }

    const text = messageInput.value;
    if (text.trim() === "" && !imageBase64) return;

    const payload = { text, image: imageBase64 };
    if (replyTo) payload.reply_to = replyTo;

    const eventName = whisperTo ? "whisper_message" : "send_message";
    if (whisperTo) payload.target_nick = whisperTo.username;
    socket.emit(eventName, payload);

    messageInput.value = "";
    messageInput.style.height = "auto";
    cancelWhisper();
    messageInput.focus();
}

function cancelWhisper() {
    whisperTo = null;
    replyTo = null;
    messageInput.placeholder = "Сообщение...";
}

imageInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
        sendMessageWithImage(loadEvent.target.result);
        imageInput.value = "";
    };
    reader.onerror = () => {
        addSystemMessage("❌ Ошибка при чтении файла");
        imageInput.value = "";
    };
    reader.readAsDataURL(file);
});