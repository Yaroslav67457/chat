let notificationsEnabled =
    localStorage.getItem("chat_notifications_enabled") !== "false";
let notificationUsers = {};

try {
    notificationUsers = JSON.parse(
        localStorage.getItem("chat_notification_users") || "{}",
    );
    if (
        !notificationUsers ||
        typeof notificationUsers !== "object" ||
        Array.isArray(notificationUsers)
    ) {
        notificationUsers = {};
    }
} catch {
    notificationUsers = {};
}

function updateNotifButton() {
    notifToggle.textContent = "🔔";
    notifAllToggle.textContent = notificationsEnabled
        ? "🔔 Получать все уведомления"
        : "🔕 Не получать уведомления";
}

function saveNotificationUsers() {
    localStorage.setItem(
        "chat_notification_users",
        JSON.stringify(notificationUsers),
    );
}

function renderNotificationUsers() {
    notifUsers.innerHTML = "";
    const names = Object.keys(notificationUsers);
    if (!names.length) {
        notifUsers.innerHTML =
            '<div class="notif-empty">Пользователи ещё не добавлены</div>';
        return;
    }

    names.forEach((name) => {
        const row = document.createElement("div");
        row.className = "notif-user";
        row.innerHTML = `
            <span class="notif-user-name">${escapeHtml(name)}</span>
            <label title="Получать уведомления">
                <input type="checkbox" ${notificationUsers[name] ? "checked" : ""}>
            </label>
            <button class="notif-user-remove" type="button" title="Удалить">×</button>
        `;
        row.querySelector("input").addEventListener("change", (event) => {
            notificationUsers[name] = event.target.checked;
            saveNotificationUsers();
        });
        row.querySelector(".notif-user-remove").addEventListener(
            "click",
            () => {
                delete notificationUsers[name];
                saveNotificationUsers();
                renderNotificationUsers();
            },
        );
        notifUsers.appendChild(row);
    });
}

function addNotificationUser() {
    const name = notifNickInput.value.trim();
    if (!name) return;

    const existingName = Object.keys(notificationUsers).find(
        (savedName) => savedName.toLowerCase() === name.toLowerCase(),
    );
    if (!existingName) {
        notificationUsers[name] = true;
        saveNotificationUsers();
        renderNotificationUsers();
    }
    notifNickInput.value = "";
    notifNickInput.focus();
}

function showNotification(title, body) {
    if (!notificationsEnabled) return;
    const savedName = Object.keys(notificationUsers).find(
        (name) => name.toLowerCase() === title.toLowerCase(),
    );
    if (savedName && !notificationUsers[savedName]) return;
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted" && document.hidden) {
        const notification = new Notification(title, {
            body,
            icon: "/msg.ico",
        });
        setTimeout(() => notification.close(), 3500);
    }
}

updateNotifButton();
renderNotificationUsers();

notifAllToggle.addEventListener("click", () => {
    notificationsEnabled = !notificationsEnabled;
    localStorage.setItem(
        "chat_notifications_enabled",
        notificationsEnabled,
    );
    updateNotifButton();
});

notifToggle.addEventListener("click", () => {
    notifMenu.hidden = !notifMenu.hidden;
});

notifAddBtn.addEventListener("click", addNotificationUser);
notifNickInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addNotificationUser();
});

if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
}