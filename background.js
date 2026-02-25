const STORAGE_PREFIX = "tm_user_";
const ALARM_NAME = "tm_notify_check";

chrome.alarms.create(ALARM_NAME, {
  delayInMinutes: 0.5,
  periodInMinutes: 0.5,
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    checkNotifications();
  }
});

async function checkNotifications() {
  const all = await chrome.storage.local.get(null);

  for (const [key, userData] of Object.entries(all)) {
    if (!key.startsWith(STORAGE_PREFIX)) continue;
    if (!userData || typeof userData !== "object") continue;

    const notifySettings = userData.notifySettings || {};
    const days = userData.days || {};
    let hasChanges = false;

    for (const tasks of Object.values(days)) {
      if (!Array.isArray(tasks)) continue;

      for (const task of tasks) {
        if (task.status !== "running" || !task.startedAt) continue;

        const elapsed =
          (task.actualSeconds || 0) +
          Math.floor((Date.now() - task.startedAt) / 1000);
        const plannedSec = Math.max(0, (task.plannedMinutes || 0) * 60);

        if (plannedSec > 0 && elapsed >= plannedSec && !task.plannedNotified) {
          task.plannedNotified = true;
          hasChanges = true;
          chrome.notifications.create(`planned-${task.id}-${Date.now()}`, {
            type: "basic",
            iconUrl: "icon.png",
            title: "予定時間に到達しました",
            message: `${task.name} の予定時間に達しました`,
          });
        }

        if (
          notifySettings.beforeEnabled &&
          plannedSec > 0 &&
          !task.remainingNotified
        ) {
          const beforeSec = (notifySettings.beforeMinutes || 10) * 60;
          const remaining = plannedSec - elapsed;
          if (remaining > 0 && remaining <= beforeSec) {
            task.remainingNotified = true;
            hasChanges = true;
            chrome.notifications.create(
              `remaining-${task.id}-${Date.now()}`,
              {
                type: "basic",
                iconUrl: "icon.png",
                title: "予定終了が近づいています",
                message: `${task.name} の残り時間は約${Math.ceil(remaining / 60)}分です`,
              },
            );
          }
        }

        if (notifySettings.elapsedEnabled && !task.elapsedNotified) {
          const thresholdSec = (notifySettings.elapsedMinutes || 60) * 60;
          if (elapsed >= thresholdSec) {
            task.elapsedNotified = true;
            hasChanges = true;
            chrome.notifications.create(`elapsed-${task.id}-${Date.now()}`, {
              type: "basic",
              iconUrl: "icon.png",
              title: "経過時間通知",
              message: `${task.name} は${Math.floor(elapsed / 60)}分経過しています`,
            });
          }
        }
      }
    }

    if (hasChanges) {
      await chrome.storage.local.set({ [key]: userData });
    }
  }
}
