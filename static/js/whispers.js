function addWhisperMessage(data, notify = true) {
    const isFromMe = data.from === currentNick;
    const displayName = isFromMe ? `→ ${data.to}` : data.from;

    addMessage(
        displayName,
        data.text,
        data.image,
        data.timestamp,
        isFromMe,
        data.reply_to || null,
        data.id || null,
        true,
    );

    if (notify && !isFromMe) {
        showNotification(
            `🤫 ${data.from}`,
            messagePreview(data.text, data.image),
        );
    }
}