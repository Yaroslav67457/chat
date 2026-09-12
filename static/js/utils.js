function messagePreview(text, image) {
    const preview = text || (image ? "📷 Изображение" : "");
    return preview.length > 200 ? preview.slice(0, 200) + "…" : preview;
}

function escapeHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function escapeAttr(str) {
    return str.replace(/"/g, "&quot;");
}

function renderLinks(text) {
    const escaped = escapeHtml(text);
    const linkRegex = /(\(([^)]*)\)\[([^\]]*)\])|(https?:\/\/[^\s]+)/g;
    return escaped.replace(
        linkRegex,
        function (match, complex, name, url, simpleUrl) {
            if (complex) {
                const linkText = name.trim() || url;
                const href = escapeAttr(url);
                return `<a href="${href}" target="_blank" class="chat-link">${linkText}</a>`;
            }
            if (simpleUrl) {
                const href = escapeAttr(simpleUrl);
                return `<a href="${href}" target="_blank" class="chat-link">${simpleUrl}</a>`;
            }
            return match;
        },
    );
}

function formatTimestamp(timestamp) {
    if (typeof timestamp !== "string") return "";
    const match = timestamp.match(/^(\d{1,2}):(\d{2})$/);
    if (!match || serverUtcOffsetMinutes === null) return timestamp;

    const serverMinutes = Number(match[1]) * 60 + Number(match[2]);
    const localUtcOffsetMinutes = -new Date().getTimezoneOffset();
    const minutesInDay = 24 * 60;
    const localMinutes =
        (serverMinutes +
            localUtcOffsetMinutes -
            serverUtcOffsetMinutes +
            minutesInDay) %
        minutesInDay;
    const hours = String(Math.floor(localMinutes / 60)).padStart(2, "0");
    const minutes = String(localMinutes % 60).padStart(2, "0");
    return `${hours}:${minutes}`;
}