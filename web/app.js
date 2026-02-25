const state = {
  user: "",
  date: "",
  tasks: [],
  projects: [],
  taskNames: [],
  notifySettings: {
    beforeEnabled: false,
    beforeMinutes: 10,
    elapsedEnabled: false,
    elapsedMinutes: 60,
  },
};

const STORAGE_PREFIX = "tm_user_";
const PREF_LAST_USER_KEY = "tm_pref_last_user";
const SAVE_DEBOUNCE_MS = 700;

let saveTimer = null;
let saveInFlight = false;
let saveQueued = false;
let pendingSubTasks = [];

const el = {
  loginUserInput: document.getElementById("loginUserInput"),
  rememberUserChk: document.getElementById("rememberUserChk"),
  loginState: document.getElementById("loginState"),
  dateInput: document.getElementById("dateInput"),
  message: document.getElementById("message"),
  activeList: document.getElementById("activeList"),
  activeSummary: document.getElementById("activeSummary"),
  doneList: document.getElementById("doneList"),
  newName: document.getElementById("newName"),
  newProjectSelect: document.getElementById("newProjectSelect"),
  newProjectName: document.getElementById("newProjectName"),
  newPlanned: document.getElementById("newPlanned"),
  newNote: document.getElementById("newNote"),
  copyBtn: document.getElementById("copyBtn"),
  userList: document.getElementById("userList"),
  projectList: document.getElementById("projectList"),
  projectDatalist: document.getElementById("projectDatalist"),
  taskNameDatalist: document.getElementById("taskNameDatalist"),
  newTaskNameMaster: document.getElementById("newTaskNameMaster"),
  taskNameList: document.getElementById("taskNameList"),
  notifyBeforeEnabled: document.getElementById("notifyBeforeEnabled"),
  notifyBeforeMinutes: document.getElementById("notifyBeforeMinutes"),
  notifyElapsedEnabled: document.getElementById("notifyElapsedEnabled"),
  notifyElapsedMinutes: document.getElementById("notifyElapsedMinutes"),
  parallelToggle: document.getElementById("parallelToggle"),
  normalFields: document.getElementById("normalFields"),
  parallelFields: document.getElementById("parallelFields"),
  parallelGroupName: document.getElementById("parallelGroupName"),
  parallelProject: document.getElementById("parallelProject"),
  parallelTaskName: document.getElementById("parallelTaskName"),
  parallelPlanned: document.getElementById("parallelPlanned"),
  subTaskList: document.getElementById("subTaskList"),
};

/* ── Utilities ─────────────────── */

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function nowMs() {
  return Date.now();
}

function toHourNumberText(hours) {
  const n = Math.max(0, Number(hours || 0));
  return (Math.round(n * 100) / 100).toFixed(2);
}

function normalizeHalfHours(value, min = 0) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.round(n * 2) / 2);
}

function ceilHalf(hours) {
  if (hours <= 0) return 0;
  return Math.max(0.5, Math.ceil(hours * 2) / 2);
}

function normalizeWariRatio(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n * 10) / 10));
}

function secToHour(sec) {
  return Math.round((sec / 3600) * 2) / 2;
}

function formatClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function elapsedSeconds(t) {
  let sec = Number(t.actualSeconds || 0);
  if (t.status === "running" && t.startedAt) {
    sec += Math.floor((nowMs() - t.startedAt) / 1000);
  }
  return Math.max(0, sec);
}

function show(msg, isError = false) {
  el.message.textContent = msg;
  el.message.style.color = isError ? "#b03838" : "#1f7a5a";
}

function validateUser(user) {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(user);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function taskStatusLabel(status) {
  if (status === "running") return "進行中";
  if (status === "paused") return "一時停止";
  if (status === "completed") return "完了";
  return "未開始";
}

/* ── Normalization ─────────────── */

function normalizeProjectName(name) {
  return String(name || "").trim().slice(0, 120);
}

function normalizeProjects(projects) {
  if (!Array.isArray(projects)) return [];
  const uniq = new Set();
  projects.forEach((p) => {
    const name = normalizeProjectName(p);
    if (name) uniq.add(name);
  });
  return [...uniq];
}

function normalizeTaskName(name) {
  return String(name || "").trim().slice(0, 200);
}

function normalizeTaskNames(names) {
  if (!Array.isArray(names)) return [];
  const uniq = new Set();
  names.forEach((n) => {
    const name = normalizeTaskName(n);
    if (name) uniq.add(name);
  });
  return [...uniq];
}

function normalizeNotifySettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    beforeEnabled: Boolean(src.beforeEnabled),
    beforeMinutes: Math.max(1, Math.floor(Number(src.beforeMinutes || 10))),
    elapsedEnabled: Boolean(src.elapsedEnabled),
    elapsedMinutes: Math.max(1, Math.floor(Number(src.elapsedMinutes || 60))),
  };
}

function normalizeSubTask(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name || "").trim().slice(0, 200);
  if (!name) return null;
  return {
    name,
    project: normalizeProjectName(raw.project),
    plannedHours: normalizeHalfHours(raw.plannedHours, 0),
    ratio: normalizeWariRatio(raw.ratio),
  };
}

function normalizeTask(raw) {
  if (!raw || typeof raw !== "object") return null;
  const task = {
    id: String(raw.id || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`).slice(0, 128),
    name: String(raw.name || "").slice(0, 200),
    project: normalizeProjectName(raw.project),
    plannedMinutes: Math.max(0, Number(raw.plannedMinutes || 0) || 0),
    actualSeconds: Math.max(0, Math.floor(Number(raw.actualSeconds || 0) || 0)),
    note: String(raw.note || "").slice(0, 1000),
    status: ["pending", "running", "paused", "completed"].includes(raw.status) ? raw.status : "pending",
    startedAt: Math.max(0, Math.floor(Number(raw.startedAt || 0) || 0)),
    completedAt: Math.max(0, Math.floor(Number(raw.completedAt || 0) || 0)),
    plannedNotified: Boolean(raw.plannedNotified),
    remainingNotified: Boolean(raw.remainingNotified),
    elapsedNotified: Boolean(raw.elapsedNotified),
    parallel: Boolean(raw.parallel),
    subTasks: [],
  };
  if (task.parallel && Array.isArray(raw.subTasks)) {
    task.subTasks = raw.subTasks.map(normalizeSubTask).filter(Boolean);
  }
  return task;
}

function normalizeTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks.map(normalizeTask).filter(Boolean);
}

function deriveProjectsFromTasks(tasks) {
  return normalizeProjects(tasks.map((t) => t.project));
}

function storageKey(user) {
  return `${STORAGE_PREFIX}${user}`;
}

function ensureProjectExists(name) {
  const normalized = normalizeProjectName(name);
  if (!normalized) return "";
  if (!state.projects.includes(normalized)) {
    state.projects.push(normalized);
    state.projects = normalizeProjects(state.projects);
  }
  return normalized;
}

function ensureTaskNameExists(name) {
  const normalized = normalizeTaskName(name);
  if (!normalized) return "";
  if (!state.taskNames.includes(normalized)) {
    state.taskNames.push(normalized);
    state.taskNames = normalizeTaskNames(state.taskNames);
  }
  return normalized;
}

function getSubTaskPlannedHours(st) {
  return normalizeHalfHours(st?.plannedHours, 0);
}

function getSubTaskWeight(st) {
  const plannedHours = getSubTaskPlannedHours(st);
  if (plannedHours > 0) return plannedHours;
  return normalizeWariRatio(st?.ratio);
}

function getPendingParallelTotalHours() {
  return pendingSubTasks.reduce((sum, st) => sum + getSubTaskPlannedHours(st), 0);
}

function syncParallelTotalPlanned() {
  if (!el.parallelToggle.checked) return;
  const totalHours = getPendingParallelTotalHours();
  el.newPlanned.value = totalHours > 0 ? toHourNumberText(totalHours) : "0.0";
}

/* ── Storage Backend ───────────── */

function isChromeStorageAvailable() {
  return typeof chrome !== "undefined" && !!chrome.storage?.local;
}

function chromeStorageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (res) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(res || {});
    });
  });
}

function chromeStorageSet(payload) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(payload, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.json();
}

const backend = (() => {
  if (isChromeStorageAvailable()) {
    return {
      name: "chrome-storage",
      async listUsers() {
        const all = await chromeStorageGet(null);
        return Object.keys(all)
          .filter((k) => k.startsWith(STORAGE_PREFIX))
          .map((k) => k.slice(STORAGE_PREFIX.length))
          .filter(validateUser)
          .sort();
      },
      async loadDay(user, date) {
        const data = await chromeStorageGet(storageKey(user));
        const userData = data[storageKey(user)] || { days: {}, projects: [], taskNames: [], notifySettings: {} };
        const tasks = normalizeTasks(userData.days?.[date]);
        const fromTasks = deriveProjectsFromTasks(tasks);
        const taskNamesFromTasks = normalizeTaskNames(tasks.map((t) => t.name));
        return {
          tasks,
          projects: normalizeProjects([...(userData.projects || []), ...fromTasks]),
          taskNames: normalizeTaskNames([...(userData.taskNames || []), ...taskNamesFromTasks]),
          notifySettings: normalizeNotifySettings(userData.notifySettings),
        };
      },
      async saveDay(user, date, tasks, projects, taskNames, notifySettings) {
        const key = storageKey(user);
        const data = await chromeStorageGet(key);
        const userData = data[key] && typeof data[key] === "object" ? data[key] : { days: {}, projects: [], taskNames: [], notifySettings: {} };
        if (!userData.days || typeof userData.days !== "object") userData.days = {};
        userData.days[date] = normalizeTasks(tasks);
        userData.projects = normalizeProjects(projects);
        userData.taskNames = normalizeTaskNames(taskNames);
        userData.notifySettings = normalizeNotifySettings(notifySettings);
        await chromeStorageSet({ [key]: userData });
      },
    };
  }

  if (location.protocol === "http:" || location.protocol === "https:") {
    return {
      name: "server-api",
      async listUsers() {
        const data = await api("/api/users");
        return Array.isArray(data.users) ? data.users.filter(validateUser).sort() : [];
      },
      async loadDay(user, date) {
        const data = await api(`/api/day?user=${encodeURIComponent(user)}&date=${encodeURIComponent(date)}`);
        const tasks = normalizeTasks(data.tasks);
        const fromTasks = deriveProjectsFromTasks(tasks);
        const taskNamesFromTasks = normalizeTaskNames(tasks.map((t) => t.name));
        return {
          tasks,
          projects: normalizeProjects([...(data.projects || []), ...fromTasks]),
          taskNames: normalizeTaskNames([...(data.taskNames || []), ...taskNamesFromTasks]),
          notifySettings: normalizeNotifySettings(data.notifySettings),
        };
      },
      async saveDay(user, date, tasks, projects, taskNames, notifySettings) {
        await api("/api/day/save", {
          method: "POST",
          body: JSON.stringify({
            user,
            date,
            tasks: normalizeTasks(tasks),
            projects: normalizeProjects(projects),
            taskNames: normalizeTaskNames(taskNames),
            notifySettings: normalizeNotifySettings(notifySettings),
          }),
        });
      },
    };
  }

  return {
    name: "local-storage",
    async listUsers() {
      const users = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
        const user = key.slice(STORAGE_PREFIX.length);
        if (validateUser(user)) users.push(user);
      }
      return users.sort();
    },
    async loadDay(user, date) {
      const raw = localStorage.getItem(storageKey(user));
      if (!raw) return { tasks: [], projects: [], taskNames: [], notifySettings: normalizeNotifySettings({}) };
      try {
        const data = JSON.parse(raw);
        const tasks = normalizeTasks(data.days?.[date]);
        const fromTasks = deriveProjectsFromTasks(tasks);
        const taskNamesFromTasks = normalizeTaskNames(tasks.map((t) => t.name));
        return {
          tasks,
          projects: normalizeProjects([...(data.projects || []), ...fromTasks]),
          taskNames: normalizeTaskNames([...(data.taskNames || []), ...taskNamesFromTasks]),
          notifySettings: normalizeNotifySettings(data.notifySettings),
        };
      } catch {
        return { tasks: [], projects: [], taskNames: [], notifySettings: normalizeNotifySettings({}) };
      }
    },
    async saveDay(user, date, tasks, projects, taskNames, notifySettings) {
      const key = storageKey(user);
      let data = { days: {}, projects: [], taskNames: [], notifySettings: {} };
      const raw = localStorage.getItem(key);
      if (raw) {
        try { data = JSON.parse(raw); } catch { data = { days: {}, projects: [], taskNames: [], notifySettings: {} }; }
      }
      if (!data.days || typeof data.days !== "object") data.days = {};
      data.days[date] = normalizeTasks(tasks);
      data.projects = normalizeProjects(projects);
      data.taskNames = normalizeTaskNames(taskNames);
      data.notifySettings = normalizeNotifySettings(notifySettings);
      localStorage.setItem(key, JSON.stringify(data));
    },
  };
})();

/* ── UI State ──────────────────── */

function updateLoginState() {
  el.loginState.textContent = state.user ? `${state.user} でログイン中` : "未ログイン";
}

function requireLogin() {
  if (state.user) return true;
  show("先にログインしてください", true);
  return false;
}

function renderDatalists() {
  el.projectDatalist.innerHTML = "";
  state.projects.forEach((p) => {
    const o = document.createElement("option");
    o.value = p;
    el.projectDatalist.appendChild(o);
  });

  el.taskNameDatalist.innerHTML = "";
  state.taskNames.forEach((n) => {
    const o = document.createElement("option");
    o.value = n;
    el.taskNameDatalist.appendChild(o);
  });
}

function renderProjectList() {
  const frag = document.createDocumentFragment();
  state.projects.forEach((p) => {
    const li = document.createElement("li");
    li.className = "master-item";
    const label = document.createElement("span");
    label.textContent = p;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-danger";
    btn.dataset.action = "remove-project";
    btn.dataset.project = p;
    btn.textContent = "削除";
    li.appendChild(label);
    li.appendChild(btn);
    frag.appendChild(li);
  });
  el.projectList.replaceChildren(frag);
}

function renderTaskNameList() {
  const frag = document.createDocumentFragment();
  state.taskNames.forEach((n) => {
    const li = document.createElement("li");
    li.className = "master-item";
    const label = document.createElement("span");
    label.textContent = n;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-danger";
    btn.dataset.action = "remove-taskname";
    btn.dataset.taskname = n;
    btn.textContent = "削除";
    li.appendChild(label);
    li.appendChild(btn);
    frag.appendChild(li);
  });
  el.taskNameList.replaceChildren(frag);
}

function renderNotifySettings() {
  el.notifyBeforeEnabled.checked = Boolean(state.notifySettings.beforeEnabled);
  el.notifyBeforeMinutes.value = String(state.notifySettings.beforeMinutes);
  el.notifyElapsedEnabled.checked = Boolean(state.notifySettings.elapsedEnabled);
  el.notifyElapsedMinutes.value = String(state.notifySettings.elapsedMinutes);
  el.notifyBeforeMinutes.disabled = !state.notifySettings.beforeEnabled;
  el.notifyElapsedMinutes.disabled = !state.notifySettings.elapsedEnabled;
}

function renderSubTaskList() {
  const frag = document.createDocumentFragment();
  const totalPlannedHours = getPendingParallelTotalHours();
  pendingSubTasks.forEach((st, i) => {
    const div = document.createElement("div");
    div.className = "sub-task-item";
    const label = [st.name, st.project].filter(Boolean).join(" / ");
    const plannedHours = getSubTaskPlannedHours(st);
    div.innerHTML = `
      <span>${escapeHtml(label)}</span>
      <span class="sub-task-meta">${toHourNumberText(plannedHours)}h</span>
      <button data-action="remove-subtask" data-index="${i}" class="btn-danger" type="button">&times;</button>
    `;
    frag.appendChild(div);
  });
  if (pendingSubTasks.length > 0) {
    const total = document.createElement("div");
    total.className = "sub-task-item";
    total.innerHTML = `
      <span>合計</span>
      <span class="sub-task-meta">${toHourNumberText(totalPlannedHours)}h</span>
      <span></span>
    `;
    frag.appendChild(total);
  }
  el.subTaskList.replaceChildren(frag);
  syncParallelTotalPlanned();
}

function renderAll() {
  renderDatalists();
  renderProjectList();
  renderTaskNameList();
  renderNotifySettings();
  render();
}

/* ── Load / Save ───────────────── */

async function loadUsers() {
  const users = await backend.listUsers();
  el.userList.innerHTML = "";
  users.forEach((u) => {
    const o = document.createElement("option");
    o.value = u;
    el.userList.appendChild(o);
  });
}

async function loadDay() {
  if (!requireLogin()) return;

  const date = el.dateInput.value;
  if (!date) {
    show("日付を選択してください", true);
    return;
  }

  state.date = date;
  const result = await backend.loadDay(state.user, date);
  state.tasks = result.tasks;
  state.projects = result.projects;
  state.taskNames = result.taskNames;
  state.notifySettings = result.notifySettings;
  renderAll();
  show(`${state.user} / ${date} を読み込みました (${backend.name})`);
}

async function saveDayCore(showSuccessMessage = true) {
  if (!state.user || !state.date) return;
  await backend.saveDay(state.user, state.date, state.tasks, state.projects, state.taskNames, state.notifySettings);
  if (showSuccessMessage) show("保存しました");
}

async function saveDay() {
  if (!requireLogin()) return;
  if (!state.date) {
    show("先に日付を読み込んでください", true);
    return;
  }

  if (saveInFlight) {
    saveQueued = true;
    return;
  }

  saveInFlight = true;
  try {
    await saveDayCore(true);
    await loadUsers();
  } finally {
    saveInFlight = false;
    if (saveQueued) {
      saveQueued = false;
      saveDay().catch((e) => show(`保存失敗: ${e.message}`, true));
    }
  }
}

function scheduleSave() {
  if (!state.user || !state.date) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await saveDayCore(false);
      await loadUsers();
    } catch (e) {
      show(`自動保存失敗: ${e.message}`, true);
    }
  }, SAVE_DEBOUNCE_MS);
}

/* ── Task Actions ──────────────── */

function findTask(id) {
  return state.tasks.find((t) => t.id === id);
}

function startTask(id) {
  const task = findTask(id);
  if (!task || task.status === "completed" || task.status === "running") return;
  task.status = "running";
  task.startedAt = nowMs();
  render();
  scheduleSave();
}

function pauseTask(id) {
  const task = findTask(id);
  if (!task || task.status !== "running") return;
  task.actualSeconds += Math.floor((nowMs() - task.startedAt) / 1000);
  task.startedAt = 0;
  task.status = "paused";
  render();
  scheduleSave();
}

function completeTask(id) {
  const task = findTask(id);
  if (!task || task.status === "completed") return;
  if (task.status === "running" && task.startedAt) {
    task.actualSeconds += Math.floor((nowMs() - task.startedAt) / 1000);
    task.startedAt = 0;
  }
  task.status = "completed";
  task.completedAt = nowMs();
  if (task.parallel && task.subTasks.length > 0) {
    const equal = Math.round((10 / task.subTasks.length) * 10) / 10;
    task.subTasks.forEach((st) => {
      if (getSubTaskWeight(st) <= 0) st.ratio = equal;
    });
  }
  render();
  scheduleSave();
}

/* ── Render Tasks ──────────────── */

function render() {
  const active = state.tasks.filter((t) => t.status !== "completed").reverse();
  const done = state.tasks.filter((t) => t.status === "completed").reverse();
  const running = state.tasks.filter((t) => t.status === "running");
  const runningTotalSec = running.reduce((acc, t) => acc + elapsedSeconds(t), 0);
  el.activeSummary.textContent = `進行中: ${running.length}件 / 合計: ${formatClock(runningTotalSec)}`;

  /* ── Active ── */
  const activeFrag = document.createDocumentFragment();
  active.forEach((task) => {
    const actualSec = elapsedSeconds(task);
    const plannedSec = Math.max(0, Number(task.plannedMinutes || 0) * 60);
    const plannedHoursText = plannedSec > 0 ? toHourNumberText(ceilHalf(plannedSec / 3600)) + "h" : "-";
    const actualHoursText = actualSec > 0 ? toHourNumberText(ceilHalf(actualSec / 3600)) + "h" : "-";
    const progress = plannedSec > 0 ? Math.min(100, Math.round((actualSec / plannedSec) * 100)) : 0;

    let opsHtml = "";
    if (task.status === "running") {
      opsHtml = `
        <button class="btn-pause" data-action="pause" data-id="${task.id}" type="button">一時停止</button>
        <button class="btn-complete" data-action="complete" data-id="${task.id}" type="button">完了</button>
      `;
    } else if (task.status === "paused") {
      opsHtml = `
        <button class="btn-resume" data-action="start" data-id="${task.id}" type="button">再開</button>
        <button class="btn-complete" data-action="complete" data-id="${task.id}" type="button">完了</button>
      `;
    } else {
      opsHtml = `
        <button class="btn-start" data-action="start" data-id="${task.id}" type="button">開始</button>
        <button class="btn-complete" data-action="complete" data-id="${task.id}" type="button">完了</button>
      `;
    }

    const parallelBadge = task.parallel && task.subTasks.length > 0
      ? `<span class="task-tag parallel-tag">並列 ${task.subTasks.length}件</span>`
      : "";
    const projectTag = !task.parallel && task.project
      ? `<span class="task-tag">${escapeHtml(task.project)}</span>`
      : "";

    let subChips = "";
    if (task.parallel && task.subTasks.length > 0) {
      subChips = '<div class="sub-chips">';
      task.subTasks.forEach((st) => {
        const label = [st.name, st.project].filter(Boolean).join(" / ");
        subChips += `<span class="sub-chip">${escapeHtml(label)}</span>`;
      });
      subChips += "</div>";
    }

    const card = document.createElement("article");
    card.className = `task-card${task.status === "running" ? " task-card-running" : ""}`;
    card.innerHTML = `
      <div class="task-header">
        <div class="task-title">${escapeHtml(task.name)}</div>
        ${projectTag}${parallelBadge}
      </div>
      ${subChips}
      <div class="task-stats">
        <div class="stat"><span class="stat-label">想定</span><span class="stat-value">${plannedHoursText}</span></div>
        <div class="stat"><span class="stat-label">実績</span><span class="stat-value">${actualHoursText}</span></div>
        <div class="stat"><span class="stat-label">状態</span><span class="stat-value status-${task.status}">${taskStatusLabel(task.status)}</span></div>
      </div>
      <div class="timer-row">
        <span class="timer" data-elapsed="${task.id}">${formatClock(actualSec)}</span>
      </div>
      ${task.note ? `<div class="task-note">${escapeHtml(task.note)}</div>` : ""}
      <div class="progress-wrap">
        <div class="progress"><i style="width:${progress}%"></i></div>
        <span class="progress-text">${progress}%</span>
      </div>
      <div class="ops">${opsHtml}</div>
    `;
    activeFrag.appendChild(card);
  });
  el.activeList.replaceChildren(activeFrag);

  /* ── Done ── */
  const doneFrag = document.createDocumentFragment();
  done.forEach((task) => {
    const actualSec = elapsedSeconds(task);
    const plannedSec = Math.max(0, Number(task.plannedMinutes || 0) * 60);
    const plannedHoursText = plannedSec > 0 ? toHourNumberText(ceilHalf(plannedSec / 3600)) + "h" : "-";
    const actualHoursText = actualSec > 0 ? toHourNumberText(ceilHalf(actualSec / 3600)) + "h" : "-";
    const progress = plannedSec > 0 ? Math.min(100, Math.round((actualSec / plannedSec) * 100)) : 0;
    const completedAt = task.completedAt
      ? new Date(task.completedAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
      : "";

    const parallelBadge = task.parallel && task.subTasks.length > 0
      ? `<span class="task-tag parallel-tag">並列 ${task.subTasks.length}件</span>`
      : "";
    const projectTag = !task.parallel && task.project
      ? `<span class="task-tag">${escapeHtml(task.project)}</span>`
      : "";

    let ratioSection = "";
    if (task.parallel && task.subTasks.length > 0) {
      const totalWeight = task.subTasks.reduce((s, st) => s + getSubTaskWeight(st), 0);
      const totalPlannedHours = Number(task.plannedMinutes || 0) / 60;
      ratioSection = '<div class="sub-task-ratios">';
      task.subTasks.forEach((st) => {
        const label = [st.name, st.project].filter(Boolean).join(" / ");
        const plannedHours = getSubTaskPlannedHours(st);
        const share = totalWeight > 0 ? getSubTaskWeight(st) / totalWeight : 0;
        const allocatedHours = plannedHours > 0 ? plannedHours : totalPlannedHours * share;
        ratioSection += `
          <div class="ratio-row">
            <span class="ratio-label">${escapeHtml(label)}</span>
            <span class="ratio-plan">${toHourNumberText(ceilHalf(allocatedHours))}h</span>
          </div>
        `;
      });
      ratioSection += `<div class="ratio-total">合計: ${toHourNumberText(totalPlannedHours)}h</div>`;
      ratioSection += "</div>";
    }

    const card = document.createElement("article");
    card.className = "task-card task-card-done";
    card.innerHTML = `
      <div class="task-header">
        <div class="task-title">${escapeHtml(task.name)}</div>
        ${projectTag}${parallelBadge}
      </div>
      <div class="task-stats">
        <div class="stat"><span class="stat-label">想定</span><span class="stat-value">${plannedHoursText}</span></div>
        <div class="stat"><span class="stat-label">実績</span><span class="stat-value">${actualHoursText}</span></div>
        <div class="stat"><span class="stat-label">完了</span><span class="stat-value">${completedAt}</span></div>
      </div>
      <div class="timer-row">
        <span class="timer">${formatClock(actualSec)}</span>
      </div>
      ${task.note ? `<div class="task-note">${escapeHtml(task.note)}</div>` : ""}
      ${ratioSection}
      <div class="progress-wrap">
        <div class="progress"><i style="width:${progress}%"></i></div>
        <span class="progress-text">${progress}%</span>
      </div>
      <div class="ops">
        <button class="btn-copy" data-action="copy-row" data-id="${task.id}" type="button">コピー</button>
        <button class="btn-danger" data-action="delete-done" data-id="${task.id}" type="button">削除</button>
      </div>
    `;
    doneFrag.appendChild(card);
  });
  el.doneList.replaceChildren(doneFrag);
}

/* ── Timer tick ────────────────── */

function tickRunning() {
  const running = state.tasks.filter((t) => t.status === "running");
  let hasStateChange = false;

  running.forEach((t) => {
    const elapsed = elapsedSeconds(t);
    const node = document.querySelector(`[data-elapsed="${CSS.escape(t.id)}"]`);
    if (node) node.textContent = formatClock(elapsed);

    const plannedSec = Math.max(0, Number(t.plannedMinutes || 0) * 60);

    if (state.notifySettings.beforeEnabled && plannedSec > 0 && !t.remainingNotified) {
      const beforeSec = state.notifySettings.beforeMinutes * 60;
      const remainingSec = plannedSec - elapsed;
      if (remainingSec > 0 && remainingSec <= beforeSec) {
        t.remainingNotified = true;
        hasStateChange = true;
        sendNotification("予定終了が近づいています", `${t.name} の残り時間は約${Math.ceil(remainingSec / 60)}分です`);
      }
    }
    if (state.notifySettings.elapsedEnabled && !t.elapsedNotified) {
      const thresholdSec = state.notifySettings.elapsedMinutes * 60;
      if (elapsed >= thresholdSec) {
        t.elapsedNotified = true;
        hasStateChange = true;
        sendNotification("経過時間通知", `${t.name} は${Math.floor(elapsed / 60)}分経過しています`);
      }
    }
    if (plannedSec > 0 && elapsed >= plannedSec && !t.plannedNotified) {
      t.plannedNotified = true;
      hasStateChange = true;
      sendNotification("予定時間に到達しました", `${t.name} の予定時間に達しました`);
    }
  });

  const runningTotalSec = running.reduce((acc, t) => acc + elapsedSeconds(t), 0);
  el.activeSummary.textContent = `進行中: ${running.length}件 / 合計: ${formatClock(runningTotalSec)}`;
  if (hasStateChange) scheduleSave();
}

function sendNotification(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(title, { body });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then((perm) => {
      if (perm === "granted") new Notification(title, { body });
    });
  }
}

/* ── TSV Copy ──────────────────── */

function expandDoneTasks(tasks) {
  const rows = [];
  tasks.forEach((task) => {
    const actualSec = elapsedSeconds(task);
    if (task.parallel && task.subTasks.length > 0) {
      const totalWeight = task.subTasks.reduce((s, st) => s + getSubTaskWeight(st), 0);
      const totalPlannedHours = Number(task.plannedMinutes || 0) / 60;
      task.subTasks.forEach((st) => {
        const plannedHours = getSubTaskPlannedHours(st);
        const share = totalWeight > 0 ? getSubTaskWeight(st) / totalWeight : 0;
        const subPlannedHours = plannedHours > 0 ? plannedHours : totalPlannedHours * share;
        const subActualHours = (actualSec / 3600) * share;
        rows.push({
          name: [st.name, st.project].filter(Boolean).join(" "),
          planned: subPlannedHours > 0 ? toHourNumberText(ceilHalf(subPlannedHours)) : "",
          actual: subActualHours > 0 ? toHourNumberText(ceilHalf(subActualHours)) : "",
          user: state.user || "",
          note: task.note || "",
        });
      });
    } else {
      const plannedHours = Number(task.plannedMinutes || 0) / 60;
      const actualHours = actualSec / 3600;
      rows.push({
        name: [task.name, task.project].filter(Boolean).join(" "),
        planned: plannedHours > 0 ? toHourNumberText(ceilHalf(plannedHours)) : "",
        actual: actualHours > 0 ? toHourNumberText(ceilHalf(actualHours)) : "",
        user: state.user || "",
        note: task.note || "",
      });
    }
  });
  return rows;
}

function buildCopyData(rows) {
  const cs = 'style="border:none;background:none;padding:0;margin:0;color:inherit;font-family:inherit;font-size:inherit"';
  let html = `<table style="border-collapse:collapse;border:none">`;
  rows.forEach((r) => {
    html += "<tr>";
    html += `<td colspan="2" ${cs}>${escapeHtml(r.name)}</td>`;
    html += `<td ${cs}>${escapeHtml(r.planned)}</td>`;
    html += `<td ${cs}>${escapeHtml(r.actual)}</td>`;
    html += `<td colspan="3" ${cs}>${escapeHtml(r.user)}</td>`;
    html += `<td colspan="3" ${cs}>${escapeHtml(r.note)}</td>`;
    html += "</tr>";
  });
  html += "</table>";

  const textRows = rows.map((r) =>
    [r.name, "", r.planned, r.actual, r.user, "", "", r.note, "", ""].join("\t")
  );
  return { html, plainText: textRows.join("\n") };
}

async function writeClipboard(text, html) {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}

async function copyAllDone() {
  const done = state.tasks.filter((t) => t.status === "completed");
  if (done.length === 0) {
    show("完了タスクがありません", true);
    return;
  }
  const rows = expandDoneTasks(done);
  const { html, plainText } = buildCopyData(rows);
  await writeClipboard(plainText, html);
  show(`全件コピー (${rows.length}件)`);
}

async function copyRow(id) {
  const task = findTask(id);
  if (!task || task.status !== "completed") {
    show("完了タスクが見つかりません", true);
    return;
  }
  const rows = expandDoneTasks([task]);
  const { html, plainText } = buildCopyData(rows);
  await writeClipboard(plainText, html);
  show(`コピー: ${task.name}`);
}

async function copyColumn(col) {
  const done = state.tasks.filter((t) => t.status === "completed");
  if (done.length === 0) {
    show("完了タスクがありません", true);
    return;
  }
  const rows = expandDoneTasks(done);
  const labels = { name: "項目", planned: "想定", actual: "実際", user: "担当者", note: "備考" };
  const values = rows.map((r) => r[col] || "");
  await navigator.clipboard.writeText(values.join("\n"));
  show(`${labels[col]} コピー (${values.length}件)`);
}

/* ── Delete ────────────────────── */

function deleteDoneTask(id) {
  const before = state.tasks.length;
  state.tasks = state.tasks.filter((t) => !(t.id === id && t.status === "completed"));
  if (state.tasks.length !== before) {
    render();
    scheduleSave();
    show("完了タスクを削除しました");
  }
}

function clearDoneTasks() {
  const doneCount = state.tasks.filter((t) => t.status === "completed").length;
  if (doneCount === 0) {
    show("削除対象の完了タスクはありません");
    return;
  }
  state.tasks = state.tasks.filter((t) => t.status !== "completed");
  render();
  scheduleSave();
  show(`完了タスクを${doneCount}件削除しました`);
}

/* ── Master Management ─────────── */

function addProject() {
  if (!requireLogin()) return;
  const name = normalizeProjectName(el.newProjectName.value);
  if (!name) {
    show("案件名を入力してください", true);
    return;
  }
  ensureProjectExists(name);
  el.newProjectName.value = "";
  renderDatalists();
  renderProjectList();
  scheduleSave();
}

function removeProject(name) {
  state.projects = state.projects.filter((p) => p !== name);
  state.tasks = state.tasks.map((t) => (t.project === name ? { ...t, project: "" } : t));
  renderDatalists();
  renderProjectList();
  render();
  scheduleSave();
}

function addTaskNameMaster() {
  if (!requireLogin()) return;
  const name = normalizeTaskName(el.newTaskNameMaster.value);
  if (!name) {
    show("工数名を入力してください", true);
    return;
  }
  ensureTaskNameExists(name);
  el.newTaskNameMaster.value = "";
  renderDatalists();
  renderTaskNameList();
  scheduleSave();
}

function removeTaskName(name) {
  state.taskNames = state.taskNames.filter((n) => n !== name);
  renderDatalists();
  renderTaskNameList();
  scheduleSave();
}

/* ── Sub-task (parallel builder) ── */

function addSubTask() {
  const name = normalizeTaskName(el.parallelTaskName.value);
  if (!name) {
    show("工数名を入力してください", true);
    return;
  }
  ensureTaskNameExists(name);
  const project = normalizeProjectName(el.parallelProject.value);
  if (project) ensureProjectExists(project);
  const plannedHours = normalizeHalfHours(el.parallelPlanned.value, 0.5);
  pendingSubTasks.push({ name, project, plannedHours });
  el.parallelTaskName.value = "";
  el.parallelProject.value = "";
  el.parallelPlanned.value = "0.5";
  renderDatalists();
  renderTaskNameList();
  renderProjectList();
  renderSubTaskList();
}

function removeSubTask(index) {
  pendingSubTasks.splice(index, 1);
  renderSubTaskList();
}

/* ── Add Task ──────────────────── */

function addTask() {
  if (!requireLogin()) return;
  if (!state.date) {
    show("先に日付を読み込んでください", true);
    return;
  }

  const isParallel = el.parallelToggle.checked;

  if (isParallel) {
    const groupName = el.parallelGroupName.value.trim();
    if (!groupName) {
      show("グループ名を入力してください", true);
      return;
    }
    if (pendingSubTasks.length < 2) {
      show("サブタスクを2つ以上追加してください", true);
      return;
    }
    const totalPlannedHours = getPendingParallelTotalHours();
    if (totalPlannedHours <= 0) {
      show("並列サブタスクの予測時間を入力してください", true);
      return;
    }
    const subTasks = pendingSubTasks.map((st) => ({
      name: st.name,
      project: st.project,
      plannedHours: getSubTaskPlannedHours(st),
      ratio: 0,
    }));
    const totalWeight = subTasks.reduce((sum, st) => sum + getSubTaskPlannedHours(st), 0);
    subTasks.forEach((st) => {
      const ratio = totalWeight > 0 ? (getSubTaskPlannedHours(st) / totalWeight) * 10 : 0;
      st.ratio = normalizeWariRatio(ratio);
    });
    state.tasks.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      name: groupName,
      project: "",
      plannedMinutes: Math.max(0, Math.round(totalPlannedHours * 60)),
      actualSeconds: 0,
      note: el.newNote.value.trim(),
      status: "pending",
      startedAt: 0,
      completedAt: 0,
      plannedNotified: false,
      remainingNotified: false,
      elapsedNotified: false,
      parallel: true,
      subTasks,
    });
    pendingSubTasks = [];
    el.parallelGroupName.value = "";
    el.parallelTaskName.value = "";
    el.parallelProject.value = "";
    el.parallelPlanned.value = "0.5";
    renderSubTaskList();
  } else {
    const name = normalizeTaskName(el.newName.value.trim());
    if (!name) {
      show("工数名を入力してください", true);
      return;
    }
    ensureTaskNameExists(name);
    const project = normalizeProjectName(el.newProjectSelect.value);
    if (project) ensureProjectExists(project);
    const plannedHours = normalizeHalfHours(el.newPlanned.value, 0);
    const plannedMinutes = Math.max(0, Math.round(plannedHours * 60));

    state.tasks.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      name,
      project,
      plannedMinutes,
      actualSeconds: 0,
      note: el.newNote.value.trim(),
      status: "pending",
      startedAt: 0,
      completedAt: 0,
      plannedNotified: false,
      remainingNotified: false,
      elapsedNotified: false,
      parallel: false,
      subTasks: [],
    });
    el.newName.value = "";
  }

  el.newNote.value = "";
  renderAll();
  scheduleSave();
  syncParallelTotalPlanned();
}

/* ── Login ─────────────────────── */

function applyRememberedUser() {
  const remembered = localStorage.getItem(PREF_LAST_USER_KEY) || "";
  if (remembered && validateUser(remembered)) {
    el.loginUserInput.value = remembered;
    state.user = remembered;
    updateLoginState();
  }
}

function login() {
  const user = el.loginUserInput.value.trim();
  if (!validateUser(user)) {
    show("ユーザーは英数字/アンダースコア/ハイフンのみ (1-64文字)", true);
    return;
  }

  state.user = user;
  updateLoginState();

  if (el.rememberUserChk.checked) {
    localStorage.setItem(PREF_LAST_USER_KEY, user);
  } else {
    localStorage.removeItem(PREF_LAST_USER_KEY);
  }

  loadDay().catch((e) => show(`読込失敗: ${e.message}`, true));
}

function logout() {
  state.user = "";
  state.tasks = [];
  state.projects = [];
  state.taskNames = [];
  updateLoginState();
  renderAll();
  show("ログアウトしました");
}

/* ── Notify settings ───────────── */

function updateNotifySettingsFromInputs() {
  state.notifySettings = normalizeNotifySettings({
    beforeEnabled: el.notifyBeforeEnabled.checked,
    beforeMinutes: el.notifyBeforeMinutes.value,
    elapsedEnabled: el.notifyElapsedEnabled.checked,
    elapsedMinutes: el.notifyElapsedMinutes.value,
  });
  renderNotifySettings();
}

/* ── Event Listeners ───────────── */

document.getElementById("loginBtn").addEventListener("click", login);
document.getElementById("logoutBtn").addEventListener("click", logout);
document.getElementById("reloadBtn").addEventListener("click", () => {
  loadDay().catch((e) => show(`再読込失敗: ${e.message}`, true));
});
document.getElementById("saveBtn").addEventListener("click", () => {
  saveDay().catch((e) => show(`保存失敗: ${e.message}`, true));
});
document.getElementById("addBtn").addEventListener("click", addTask);
document.getElementById("addProjectBtn").addEventListener("click", addProject);
document.getElementById("addTaskNameBtn").addEventListener("click", addTaskNameMaster);
document.getElementById("addSubTaskBtn").addEventListener("click", addSubTask);
document.getElementById("clearDoneBtn").addEventListener("click", clearDoneTasks);

el.copyBtn.addEventListener("click", () => {
  copyAllDone().catch((e) => show(`コピー失敗: ${e.message}`, true));
});

el.newProjectName.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") addProject();
});
el.newTaskNameMaster.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") addTaskNameMaster();
});
el.notifyBeforeEnabled.addEventListener("change", () => {
  updateNotifySettingsFromInputs();
  scheduleSave();
});
el.notifyBeforeMinutes.addEventListener("input", () => {
  updateNotifySettingsFromInputs();
  scheduleSave();
});
el.notifyElapsedEnabled.addEventListener("change", () => {
  updateNotifySettingsFromInputs();
  scheduleSave();
});
el.notifyElapsedMinutes.addEventListener("input", () => {
  updateNotifySettingsFromInputs();
  scheduleSave();
});

el.parallelToggle.addEventListener("change", () => {
  const isParallel = el.parallelToggle.checked;
  el.normalFields.classList.toggle("hidden", isParallel);
  el.parallelFields.classList.toggle("hidden", !isParallel);
  el.newPlanned.readOnly = isParallel;
  el.newPlanned.disabled = isParallel;
  if (isParallel) {
    syncParallelTotalPlanned();
  } else if (Number(el.newPlanned.value || 0) <= 0) {
    el.newPlanned.value = "1";
  }
});

document.addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-action]");
  if (!btn) return;

  const action = btn.dataset.action;
  const id = btn.dataset.id || "";

  if (action === "remove-project") {
    removeProject(btn.dataset.project || "");
    return;
  }
  if (action === "remove-taskname") {
    removeTaskName(btn.dataset.taskname || "");
    return;
  }
  if (action === "remove-subtask") {
    removeSubTask(Number(btn.dataset.index));
    return;
  }
  if (action === "start") startTask(id);
  if (action === "pause") pauseTask(id);
  if (action === "complete") completeTask(id);
  if (action === "copy-row") copyRow(id).catch((e) => show(`コピー失敗: ${e.message}`, true));
  if (action === "copy-col") copyColumn(btn.dataset.col).catch((e) => show(`コピー失敗: ${e.message}`, true));
  if (action === "delete-done") deleteDoneTask(id);
});

setInterval(tickRunning, 1000);

/* ── Init ──────────────────────── */

(function init() {
  el.dateInput.value = todayStr();
  renderAll();
  applyRememberedUser();
  loadUsers().catch(() => {});
  if (state.user) {
    loadDay().catch(() => {});
  }
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
})();
