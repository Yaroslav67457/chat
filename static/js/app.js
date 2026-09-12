function syncAppHeight() {
    const viewportHeight =
        window.visualViewport?.height || window.innerHeight;
    document.documentElement.style.setProperty(
        "--app-height",
        `${Math.round(viewportHeight)}px`,
    );
}

syncAppHeight();
window.addEventListener("resize", syncAppHeight, { passive: true });
window.addEventListener("orientationchange", syncAppHeight, {
    passive: true,
});
window.visualViewport?.addEventListener("resize", syncAppHeight, {
    passive: true,
});

const socket = io({
    transports: ["polling", "websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    timeout: 20000,
});

let currentNick = "";
let replyTo = null;
let whisperTo = null;
let autoNickAttemptedSocketId = null;
let historyRenderedForSocketId = null;
let serverUtcOffsetMinutes = null;
const messageElements = new Map();

const messagesDiv = document.getElementById("messages");
const nickInput = document.getElementById("nickname");
const setNickBtn = document.getElementById("setNickBtn");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const statusSpan = document.getElementById("status");
const imageInput = document.getElementById("imageInput");
const notifToggle = document.getElementById("notifToggle");
const notifMenu = document.getElementById("notifMenu");
const notifNickInput = document.getElementById("notifNickInput");
const notifAddBtn = document.getElementById("notifAddBtn");
const notifUsers = document.getElementById("notifUsers");
const notifAllToggle = document.getElementById("notifAllToggle");

const SCROLL_THRESHOLD = 80;

function autoSetSavedNick() {
    const savedNick = localStorage.getItem("python_chat_nick")?.trim();
    if (
        !socket.connected ||
        !socket.id ||
        !savedNick ||
        autoNickAttemptedSocketId === socket.id
    ) {
        return;
    }

    autoNickAttemptedSocketId = socket.id;
    nickInput.value = savedNick;
    socket.emit("set_nick", { nick: savedNick });
}