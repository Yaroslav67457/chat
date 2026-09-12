sendBtn.addEventListener("click", () => sendMessageWithImage(null));

messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessageWithImage(null);
    } else if (event.key === "Escape" && (whisperTo || replyTo)) {
        event.preventDefault();
        cancelWhisper();
    }
});

messageInput.addEventListener("input", function () {
    this.style.height = "auto";
    this.style.height = this.scrollHeight + "px";
});

setNickBtn.addEventListener("click", setNick);
nickInput.addEventListener("keypress", (event) => {
    if (event.key === "Enter") setNick();
});

const saved = localStorage.getItem("python_chat_nick");
if (saved) nickInput.value = saved;
autoSetSavedNick();