const STORAGE_PREFIX = "tm_user_";
const PREF_LAST_USER_KEY = "tm_pref_last_user";
const PREF_LAST_TAB_KEY = "tm_pref_last_tab";
const SAVE_DEBOUNCE_MS = 600;

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
  tab: "new",
};

let saveTimer = null;
let pendingSubTasks = [];

const el = {
  loginUserInput: document.getElementById("loginUserInput"),
  loginState: document.getElementById("loginState"),
  dateInput: document.getElementById("dateInput"),
  message: document.getElementById("message"),
  newProjectField: document.getElementById("newProjectField"),
  newTaskNameField: document.getElementById("newTaskNameField"),
  newProjectOpenBtn: document.getElementById("newProjectOpenBtn"),
  newTaskNameOpenBtn: document.getElementById("newTaskNameOpenBtn"),
  newProjectMenu: document.getElementById("newProjectMenu"),
  newTaskNameMenu: document.getElementById("newTaskNameMenu"),
  projectOptions: document.getElementById("projectOptions"),
  taskNameOptions: document.getElementById("taskNameOptions"),
  newPlanned: document.getElementById("newPlanned"),
  newNote: document.getElementById("newNote"),
  userList: document.getElementById("userList"),
  masterProjectInput: document.getElementById("masterProjectInput"),
  masterTaskNameInput: document.getElementById("masterTaskNameInput"),
  notifyBeforeEnabled: document.getElementById("notifyBeforeEnabled"),
  notifyBeforeMinutes: document.getElementById("notifyBeforeMinutes"),
  notifyElapsedEnabled: document.getElementById("notifyElapsedEnabled"),
  notifyElapsedMinutes: document.getElementById("notifyElapsedMinutes"),
  masterProjectList: document.getElementById("masterProjectList"),
  masterTaskNameList: document.getElementById("masterTaskNameList"),
  activeList: document.getElementById("activeList"),
  doneList: document.getElementById("doneList"),
  activeSummary: document.getElementById("activeSummary"),
  tabs: document.getElementById("tabs"),
  panels: document.querySelectorAll(".tab-panel"),
  parallelToggle: document.getElementById("parallelToggle"),
  normalFields: document.getElementById("normalFields"),
  parallelFields: document.getElementById("parallelFields"),
  parallelGroupName: document.getElementById("parallelGroupName"),
  parallelProjectField: document.getElementById("parallelProjectField"),
  parallelTaskNameField: document.getElementById("parallelTaskNameField"),
  parallelProjectOpenBtn: document.getElementById("parallelProjectOpenBtn"),
  parallelTaskNameOpenBtn: document.getElementById("parallelTaskNameOpenBtn"),
  parallelProjectMenu: document.getElementById("parallelProjectMenu"),
  parallelTaskNameMenu: document.getElementById("parallelTaskNameMenu"),
  parallelPlannedInput: document.getElementById("parallelPlannedInput"),
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

function show(msg, isError = false) {
  el.message.textContent = msg;
  el.message.style.color = isError ? "#b03838" : "#1f7a5a";
}

function validateUser(user) {
  return user.length >= 1 && user.length <= 64 && !/[\s/\\]/.test(user);
}

function toHourNumberText(hours) {
  const n = Math.max(0, Number(hours || 0));
  const rounded = Math.round(n * 100) / 100;
  return rounded.toFixed(2);
}

function normalizeWariRatio(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n * 10) / 10));
}

function normalizeHalfHours(value, min = 0) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return min;
  const rounded = Math.round(n * 2) / 2;
  return Math.max(min, rounded);
}

function ceilHalf(hours) {
  if (hours <= 0) return 0;
  return Math.max(0.5, Math.ceil(hours * 2) / 2);
}

function formatClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function elapsedSeconds(task) {
  let sec = Number(task.actualSeconds || 0);
  if (task.status === "running" && task.startedAt) {
    sec += Math.floor((nowMs() - task.startedAt) / 1000);
  }
  return Math.max(0, sec);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/* ── Normalization ─────────────── */

function storageKey(user) {
  return `${STORAGE_PREFIX}${user}`;
}

function normalizeProjectName(name) {
  return String(name || "").trim().slice(0, 120);
}

function normalizeProjects(projects) {
  if (!Array.isArray(projects)) return [];
  const unique = new Set();
  projects.forEach((p) => {
    const name = normalizeProjectName(p);
    if (name) unique.add(name);
  });
  return [...unique];
}

function normalizeTaskNames(names) {
  if (!Array.isArray(names)) return [];
  const unique = new Set();
  names.forEach((n) => {
    const name = String(n || "").trim().slice(0, 200);
    if (name) unique.add(name);
  });
  return [...unique];
}

function normalizeNotifySettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const beforeMinutes = Math.max(1, Math.floor(Number(src.beforeMinutes || 10)));
  const elapsedMinutes = Math.max(1, Math.floor(Number(src.elapsedMinutes || 60)));
  return {
    beforeEnabled: Boolean(src.beforeEnabled),
    beforeMinutes,
    elapsedEnabled: Boolean(src.elapsedEnabled),
    elapsedMinutes,
  };
}

function normalizeSubTask(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name || "").trim().slice(0, 200);
  if (!name) return null;
  const plannedHours = normalizeHalfHours(raw.plannedHours, 0);
  return {
    name,
    project: normalizeProjectName(raw.project),
    ratio: normalizeWariRatio(raw.ratio),
    plannedHours,
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

function ensureProjectExists(name) {
  const normalized = normalizeProjectName(name);
  if (!normalized) return "";
  if (!state.projects.includes(normalized)) {
    state.projects.push(normalized);
    state.projects = normalizeProjects(state.projects);
  }
  return normalized;
}

function normalizeTaskName(name) {
  return String(name || "").trim().slice(0, 200);
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

function resolveProjectValue(inputEl) {
  return normalizeProjectName(inputEl?.value || "");
}

function resolveTaskNameValue(inputEl) {
  return normalizeTaskName(inputEl?.value || "");
}

function getSubTaskPlannedHours(st) {
  const plannedHours = normalizeHalfHours(st?.plannedHours, 0);
  if (plannedHours > 0) return plannedHours;
  return 0;
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

/* ── Chrome Storage ────────────── */

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

/* ── User Management ───────────── */

async function listUsers() {
  const all = await chromeStorageGet(null);
  return Object.keys(all)
    .filter((k) => k.startsWith(STORAGE_PREFIX))
    .map((k) => k.slice(STORAGE_PREFIX.length))
    .filter(validateUser)
    .sort();
}

async function loadUsers() {
  const users = await listUsers();
  el.userList.innerHTML = "";
  users.forEach((u) => {
    const option = document.createElement("option");
    option.value = u;
    el.userList.appendChild(option);
  });
}

/* ── Load / Save ───────────────── */

async function loadDay() {
  if (!state.user) {
    show("担当者を入力してください", true);
    return;
  }

  const date = el.dateInput.value;
  if (!date) {
    show("日付を選択してください", true);
    return;
  }

  const key = storageKey(state.user);
  const data = await chromeStorageGet(key);
  const userData = data[key] && typeof data[key] === "object"
    ? data[key]
    : { days: {}, projects: [], taskNames: [], notifySettings: {} };

  state.date = date;
  state.tasks = normalizeTasks(userData.days?.[date]);
  const fromTasks = normalizeProjects(state.tasks.map((t) => t.project));
  const taskNamesFromTasks = normalizeTaskNames(state.tasks.map((t) => t.name));
  state.projects = normalizeProjects([...(userData.projects || []), ...fromTasks]);
  state.taskNames = normalizeTaskNames([...(userData.taskNames || []), ...taskNamesFromTasks]);
  state.notifySettings = normalizeNotifySettings(userData.notifySettings);

  renderSelects();
  renderMasterLists();
  renderNotifySettings();
  renderTasks();
  show(`${state.user} / ${state.date} を読み込みました`);
}

async function saveDay(showMessage = false) {
  if (!state.user || !state.date) return;

  const key = storageKey(state.user);
  const data = await chromeStorageGet(key);
  const userData = data[key] && typeof data[key] === "object"
    ? data[key]
    : { days: {}, projects: [], taskNames: [], notifySettings: {} };

  if (!userData.days || typeof userData.days !== "object") userData.days = {};

  userData.days[state.date] = normalizeTasks(state.tasks);
  userData.projects = normalizeProjects(state.projects);
  userData.taskNames = normalizeTaskNames(state.taskNames);
  userData.notifySettings = normalizeNotifySettings(state.notifySettings);
  await chromeStorageSet({ [key]: userData });

  if (showMessage) show("保存しました");
}

function scheduleSave() {
  if (!state.user || !state.date) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveDay(false).catch((e) => show(`自動保存失敗: ${e.message}`, true));
  }, SAVE_DEBOUNCE_MS);
}

/* ── UI State ──────────────────── */

function updateLoginState() {
  el.loginState.textContent = state.user ? `担当者: ${state.user}` : "担当者未設定";
}

function renderNotifySettings() {
  el.notifyBeforeEnabled.checked = Boolean(state.notifySettings.beforeEnabled);
  el.notifyBeforeMinutes.value = String(state.notifySettings.beforeMinutes);
  el.notifyElapsedEnabled.checked = Boolean(state.notifySettings.elapsedEnabled);
  el.notifyElapsedMinutes.value = String(state.notifySettings.elapsedMinutes);
  el.notifyBeforeMinutes.disabled = !state.notifySettings.beforeEnabled;
  el.notifyElapsedMinutes.disabled = !state.notifySettings.elapsedEnabled;
}

function updateNotifySettingsFromInputs() {
  state.notifySettings = normalizeNotifySettings({
    beforeEnabled: el.notifyBeforeEnabled.checked,
    beforeMinutes: el.notifyBeforeMinutes.value,
    elapsedEnabled: el.notifyElapsedEnabled.checked,
    elapsedMinutes: el.notifyElapsedMinutes.value,
  });
  renderNotifySettings();
}

function setTab(tabName) {
  const allowedTabs = new Set(["new", "active", "done", "master"]);
  state.tab = allowedTabs.has(tabName) ? tabName : "new";
  localStorage.setItem(PREF_LAST_TAB_KEY, state.tab);
  document.querySelectorAll(".tab").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === state.tab));
  el.panels.forEach((panel) => panel.classList.toggle("hidden", panel.dataset.panel !== state.tab));
}

/* ── Render: Suggest Lists ─────── */

function populateDatalist(listEl, items) {
  listEl.innerHTML = "";
  items.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    listEl.appendChild(option);
  });
}

function renderSelects() {
  populateDatalist(el.projectOptions, state.projects);
  populateDatalist(el.taskNameOptions, state.taskNames);
  renderComboMenu(el.newProjectMenu, state.projects, el.newProjectField);
  renderComboMenu(el.parallelProjectMenu, state.projects, el.parallelProjectField);
  renderComboMenu(el.newTaskNameMenu, state.taskNames, el.newTaskNameField);
  renderComboMenu(el.parallelTaskNameMenu, state.taskNames, el.parallelTaskNameField);
}

function closeAllComboMenus() {
  [el.newProjectMenu, el.parallelProjectMenu, el.newTaskNameMenu, el.parallelTaskNameMenu].forEach((menu) => {
    menu.classList.add("hidden");
  });
}

function renderComboMenu(menuEl, items, inputEl) {
  const frag = document.createDocumentFragment();
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "combo-empty";
    empty.textContent = "候補なし";
    frag.appendChild(empty);
    menuEl.replaceChildren(frag);
    return;
  }
  items.forEach((name) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "combo-item";
    btn.textContent = name;
    btn.dataset.comboValue = name;
    btn.dataset.comboTarget = inputEl.id;
    frag.appendChild(btn);
  });
  menuEl.replaceChildren(frag);
}

function bindComboOpen(buttonEl, menuEl, inputEl) {
  const onOpen = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();

    const isHidden = menuEl.classList.contains("hidden");
    closeAllComboMenus();
    if (isHidden) {
      menuEl.classList.remove("hidden");
    }
    inputEl.focus();
  };
  buttonEl.addEventListener("click", onOpen);
}

function bindComboInputFocus(inputEl, menuEl) {
  const openMenu = () => {
    if (menuEl.childElementCount === 0) return;
    closeAllComboMenus();
    menuEl.classList.remove("hidden");
  };
  inputEl.addEventListener("focus", openMenu);
  inputEl.addEventListener("click", openMenu);
}

/* ── Render: Master Lists ──────── */

function renderMasterLists() {
  const projFrag = document.createDocumentFragment();
  state.projects.forEach((project) => {
    const li = document.createElement("li");
    li.className = "master-item";
    const span = document.createElement("span");
    span.textContent = project;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-danger";
    btn.dataset.action = "remove-master-project";
    btn.dataset.project = project;
    btn.textContent = "削除";
    li.appendChild(span);
    li.appendChild(btn);
    projFrag.appendChild(li);
  });
  el.masterProjectList.replaceChildren(projFrag);

  const taskFrag = document.createDocumentFragment();
  state.taskNames.forEach((name) => {
    const li = document.createElement("li");
    li.className = "master-item";
    const span = document.createElement("span");
    span.textContent = name;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-danger";
    btn.dataset.action = "remove-master-taskname";
    btn.dataset.taskname = name;
    btn.textContent = "削除";
    li.appendChild(span);
    li.appendChild(btn);
    taskFrag.appendChild(li);
  });
  el.masterTaskNameList.replaceChildren(taskFrag);
}

/* ── Render: Sub-task list (new task form) */

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

/* ── Render: Tasks ─────────────── */

function taskStatusLabel(status) {
  if (status === "running") return "進行中";
  if (status === "paused") return "一時停止";
  if (status === "completed") return "完了";
  return "未開始";
}

function renderTasks() {
  const active = state.tasks.filter((t) => t.status !== "completed").reverse();
  const done = state.tasks.filter((t) => t.status === "completed").reverse();
  const running = state.tasks.filter((t) => t.status === "running");
  const runningTotalSec = running.reduce((acc, t) => acc + elapsedSeconds(t), 0);
  el.activeSummary.textContent = `進行中: ${running.length}件 / 合計タイマー: ${formatClock(runningTotalSec)}`;

  /* ── Active / Pending ── */
  const activeFrag = document.createDocumentFragment();
  active.forEach((task) => {
    const actualSec = elapsedSeconds(task);
    const plannedSec = Math.max(0, Number(task.plannedMinutes || 0) * 60);
    const plannedHoursText = Number(task.plannedMinutes || 0) > 0 ? toHourNumberText(ceilHalf(Number(task.plannedMinutes || 0) / 60)) + "h" : "-";
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
      ? `<span class="item-tag parallel-tag">並列 ${task.subTasks.length}件</span>`
      : "";
    const projectTag = !task.parallel && task.project
      ? `<span class="item-tag">${escapeHtml(task.project)}</span>`
      : "";

    let subChips = "";
    if (task.parallel && task.subTasks.length > 0) {
      subChips = '<div class="sub-tasks-info">';
      task.subTasks.forEach((st) => {
        const label = [st.name, st.project].filter(Boolean).join(" / ");
        subChips += `<span class="sub-task-chip">${escapeHtml(label)}</span>`;
      });
      subChips += "</div>";
    }

    const item = document.createElement("article");
    item.className = `item${task.status === "running" ? " item-running" : ""}`;
    item.innerHTML = `
      <div class="item-header">
        <div class="item-title">${escapeHtml(task.name)}</div>
        ${projectTag}${parallelBadge}
      </div>
      ${subChips}
      <div class="item-stats">
        <div class="stat"><span class="stat-label">想定</span><span class="stat-value">${plannedHoursText}</span></div>
        <div class="stat"><span class="stat-label">実績</span><span class="stat-value">${actualHoursText}</span></div>
        <div class="stat"><span class="stat-label">状態</span><span class="stat-value status-${task.status}">${taskStatusLabel(task.status)}</span></div>
      </div>
      <div class="timer-row">
        <span class="timer" data-elapsed="${task.id}">${formatClock(actualSec)}</span>
      </div>
      ${task.note ? `<div class="item-note">${escapeHtml(task.note)}</div>` : ""}
      <div class="progress-wrap">
        <div class="progress"><i style="width:${progress}%"></i></div>
        <span class="progress-text">${progress}%</span>
      </div>
      <div class="ops">${opsHtml}</div>
    `;
    activeFrag.appendChild(item);
  });
  el.activeList.replaceChildren(activeFrag);

  /* ── Done ── */
  const doneFrag = document.createDocumentFragment();
  done.forEach((task) => {
    const actualSec = elapsedSeconds(task);
    const plannedSec = Math.max(0, Number(task.plannedMinutes || 0) * 60);
    const plannedHoursText = Number(task.plannedMinutes || 0) > 0 ? toHourNumberText(ceilHalf(Number(task.plannedMinutes || 0) / 60)) + "h" : "-";
    const actualHoursText = actualSec > 0 ? toHourNumberText(ceilHalf(actualSec / 3600)) + "h" : "-";
    const progress = plannedSec > 0 ? Math.min(100, Math.round((actualSec / plannedSec) * 100)) : 0;
    const completedAt = task.completedAt
      ? new Date(task.completedAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
      : "";

    const parallelBadge = task.parallel && task.subTasks.length > 0
      ? `<span class="item-tag parallel-tag">並列 ${task.subTasks.length}件</span>`
      : "";
    const projectTag = !task.parallel && task.project
      ? `<span class="item-tag">${escapeHtml(task.project)}</span>`
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
        const allocatedPlannedHours = plannedHours > 0 ? plannedHours : totalPlannedHours * share;
        ratioSection += `
          <div class="ratio-row">
            <span class="ratio-label">${escapeHtml(label)}</span>
            <span class="ratio-plan">${toHourNumberText(ceilHalf(allocatedPlannedHours))}h</span>
            <span class="ratio-suffix">固定</span>
          </div>
        `;
      });
      ratioSection += `<div class="ratio-total">合計: ${toHourNumberText(totalPlannedHours)}h</div>`;
      ratioSection += "</div>";
    }

    const item = document.createElement("article");
    item.className = "item item-done";
    item.innerHTML = `
      <div class="item-header">
        <div class="item-title">${escapeHtml(task.name)}</div>
        ${projectTag}${parallelBadge}
      </div>
      <div class="item-stats">
        <div class="stat"><span class="stat-label">想定</span><span class="stat-value">${plannedHoursText}</span></div>
        <div class="stat"><span class="stat-label">実績</span><span class="stat-value">${actualHoursText}</span></div>
        <div class="stat"><span class="stat-label">完了</span><span class="stat-value">${completedAt}</span></div>
      </div>
      <div class="timer-row">
        <span class="timer">${formatClock(actualSec)}</span>
      </div>
      ${task.note ? `<div class="item-note">${escapeHtml(task.note)}</div>` : ""}
      ${ratioSection}
      <div class="progress-wrap">
        <div class="progress"><i style="width:${progress}%"></i></div>
        <span class="progress-text">${progress}%</span>
      </div>
      <div class="ops">
        <button data-action="copy-row" data-id="${task.id}" type="button">コピー</button>
        <button data-action="delete-done" data-id="${task.id}" class="btn-danger" type="button">削除</button>
      </div>
    `;
    doneFrag.appendChild(item);
  });
  el.doneList.replaceChildren(doneFrag);
}

/* ── Task Actions ──────────────── */

function findTask(id) {
  return state.tasks.find((t) => t.id === id);
}

function createNotification(title, message, id) {
  if (typeof chrome === "undefined" || !chrome.notifications?.create) return;
  chrome.notifications.create(id, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icon.png"),
    title,
    message,
  });
}

function notifyPlannedTimeReached(task, elapsedSec) {
  const plannedSec = Math.max(0, Number(task.plannedMinutes || 0) * 60);
  if (plannedSec <= 0) return;
  createNotification(
    "予定時間に到達しました",
    `${task.name} (${toHourNumberText(plannedSec / 3600)}h) / 実績 ${toHourNumberText(elapsedSec / 3600)}h`,
    `planned-${task.id}-${Date.now()}`
  );
}

function notifyRemainingTime(task, remainingSec) {
  createNotification(
    "予定終了が近づいています",
    `${task.name} の残り時間は約${Math.ceil(remainingSec / 60)}分です`,
    `remaining-${task.id}-${Date.now()}`
  );
}

function notifyElapsedTime(task, elapsedSec) {
  createNotification(
    "経過時間通知",
    `${task.name} は${Math.floor(elapsedSec / 60)}分経過しています`,
    `elapsed-${task.id}-${Date.now()}`
  );
}

function startTask(id) {
  const task = findTask(id);
  if (!task || task.status === "completed" || task.status === "running") return;
  task.plannedNotified = Boolean(task.plannedNotified);
  task.remainingNotified = Boolean(task.remainingNotified);
  task.elapsedNotified = Boolean(task.elapsedNotified);
  task.status = "running";
  task.startedAt = nowMs();
  renderTasks();
  scheduleSave();
}

function pauseTask(id) {
  const task = findTask(id);
  if (!task || task.status !== "running") return;
  task.actualSeconds += Math.floor((nowMs() - task.startedAt) / 1000);
  task.startedAt = 0;
  task.status = "paused";
  renderTasks();
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
  renderTasks();
  scheduleSave();
}

/* ── TSV Copy ──────────────────── */

function rowToTSV(task) {
  const actualSec = elapsedSeconds(task);

  if (task.parallel && task.subTasks.length > 0) {
    const totalWeight = task.subTasks.reduce((s, st) => s + getSubTaskWeight(st), 0);
    const totalPlannedHours = Number(task.plannedMinutes || 0) / 60;
    return task.subTasks
      .map((st) => {
        const plannedHours = getSubTaskPlannedHours(st);
        const share = totalWeight > 0 ? getSubTaskWeight(st) / totalWeight : 0;
        const subActualHours = (actualSec / 3600) * share;
        const subPlannedHours = plannedHours > 0 ? plannedHours : totalPlannedHours * share;
        const planned = subPlannedHours > 0 ? toHourNumberText(ceilHalf(subPlannedHours))  : "";
        const actual = subActualHours > 0 ? toHourNumberText(ceilHalf(subActualHours))  : "";
        const taskLabel = [st.name, st.project].filter(Boolean).join(" ");
        // A-B, C, D, E-F-G, H-I-J 結合セルレイアウト
        return [taskLabel || "", "", planned, actual, state.user || "", "", "", task.note || "", "", ""]
          .map((c) => String(c).replaceAll("\t", " ").replaceAll("\n", " "))
          .join("\t");
      })
      .join("\n");
  }

  const plannedHours = Number(task.plannedMinutes || 0) / 60;
  const actualHours = actualSec / 3600;
  const planned = plannedHours > 0 ? toHourNumberText(ceilHalf(plannedHours))  : "";
  const actual = actualHours > 0 ? toHourNumberText(ceilHalf(actualHours))  : "";
  const taskLabel = [task.name, task.project].filter(Boolean).join(" ");
  // A-B, C, D, E-F-G, H-I-J 結合セルレイアウト
  return [taskLabel || "", "", planned, actual, state.user || "", "", "", task.note || "", "", ""]
    .map((c) => String(c).replaceAll("\t", " ").replaceAll("\n", " "))
    .join("\t");
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

async function copyRow(id) {
  const task = findTask(id);
  if (!task || task.status !== "completed") {
    show("完了タスクが見つかりません", true);
    return;
  }
  await copyText(rowToTSV(task));
  show(`コピー: ${task.name}`);
}

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
          planned: subPlannedHours > 0 ? toHourNumberText(ceilHalf(subPlannedHours))  : "",
          actual: subActualHours > 0 ? toHourNumberText(ceilHalf(subActualHours))  : "",
          user: state.user || "",
          note: task.note || "",
        });
      });
    } else {
      const plannedHours = Number(task.plannedMinutes || 0) / 60;
      const actualHours = actualSec / 3600;
      rows.push({
        name: [task.name, task.project].filter(Boolean).join(" "),
        planned: plannedHours > 0 ? toHourNumberText(ceilHalf(plannedHours))  : "",
        actual: actualHours > 0 ? toHourNumberText(ceilHalf(actualHours))  : "",
        user: state.user || "",
        note: task.note || "",
      });
    }
  });
  return rows;
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
  await copyText(values.join("\n"));
  show(`${labels[col]} コピー (${values.length}件)`);
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

async function copyAsHtml(html, plainText) {
  try {
    const htmlBlob = new Blob([html], { type: "text/html" });
    const textBlob = new Blob([plainText], { type: "text/plain" });
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": htmlBlob,
        "text/plain": textBlob,
      }),
    ]);
  } catch {
    await copyText(plainText);
  }
}

async function copyAllDoneHtml() {
  const done = state.tasks.filter((t) => t.status === "completed");
  if (done.length === 0) {
    show("完了タスクがありません", true);
    return;
  }
  const rows = expandDoneTasks(done);
  const { html, plainText } = buildCopyData(rows);
  await copyAsHtml(html, plainText);
  show(`全件コピー (${rows.length}件)`);
}

async function copyRowHtml(id) {
  const task = findTask(id);
  if (!task || task.status !== "completed") {
    show("完了タスクが見つかりません", true);
    return;
  }
  const rows = expandDoneTasks([task]);
  const { html, plainText } = buildCopyData(rows);
  await copyAsHtml(html, plainText);
  show(`コピー: ${task.name}`);
}

/* ── Delete ────────────────────── */

function deleteDoneTask(id) {
  const before = state.tasks.length;
  state.tasks = state.tasks.filter((t) => !(t.id === id && t.status === "completed"));
  if (state.tasks.length !== before) {
    renderTasks();
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
  renderTasks();
  scheduleSave();
  show(`完了タスクを${doneCount}件削除しました`);
}

/* ── Master Management ─────────── */

function addMasterProject() {
  if (!state.user) {
    show("担当者を入力してください", true);
    return;
  }
  const name = ensureProjectExists(el.masterProjectInput.value);
  if (!name) {
    show("案件名を入力してください", true);
    return;
  }
  el.masterProjectInput.value = "";
  renderSelects();
  renderMasterLists();
  scheduleSave();
  show(`案件「${name}」を追加しました`);
}

function removeMasterProject(name) {
  state.projects = state.projects.filter((p) => p !== name);
  state.tasks = state.tasks.map((t) => (t.project === name ? { ...t, project: "" } : t));
  renderSelects();
  renderMasterLists();
  renderTasks();
  scheduleSave();
  show(`案件「${name}」を削除しました`);
}

function addMasterTaskName() {
  if (!state.user) {
    show("担当者を入力してください", true);
    return;
  }
  const name = ensureTaskNameExists(el.masterTaskNameInput.value);
  if (!name) {
    show("工数名を入力してください", true);
    return;
  }
  el.masterTaskNameInput.value = "";
  renderSelects();
  renderMasterLists();
  scheduleSave();
  show(`工数名「${name}」を追加しました`);
}

function removeMasterTaskName(name) {
  state.taskNames = state.taskNames.filter((t) => t !== name);
  renderSelects();
  renderMasterLists();
  scheduleSave();
  show(`工数名「${name}」を削除しました`);
}

/* ── Sub-task (parallel builder) ── */

function addSubTask() {
  const name = ensureTaskNameExists(resolveTaskNameValue(el.parallelTaskNameField));
  if (!name) {
    show("工数名を選択または入力してください", true);
    return;
  }
  const project = ensureProjectExists(resolveProjectValue(el.parallelProjectField));
  const plannedHours = normalizeHalfHours(el.parallelPlannedInput.value, 0.5);
  if (plannedHours <= 0) {
    show("予測時間(h)は0.5以上で入力してください", true);
    return;
  }
  pendingSubTasks.push({ name, project, plannedHours });
  el.parallelTaskNameField.value = "";
  el.parallelProjectField.value = "";
  el.parallelPlannedInput.value = "0.5";
  renderSelects();
  renderMasterLists();
  renderSubTaskList();
}

function removeSubTask(index) {
  pendingSubTasks.splice(index, 1);
  renderSubTaskList();
}

/* ── Add Task ──────────────────── */

function addTask() {
  if (!state.user) {
    show("担当者を入力してください", true);
    return;
  }
  if (!state.date) {
    show("日付を選択してください", true);
    return;
  }

  const isParallel = el.parallelToggle.checked;
  const plannedHours = normalizeHalfHours(el.newPlanned.value, 0);
  const plannedMinutes = Math.max(0, Math.round(plannedHours * 60));

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
    el.parallelTaskNameField.value = "";
    el.parallelProjectField.value = "";
    el.parallelPlannedInput.value = "0.5";
    renderSubTaskList();
  } else {
    const name = ensureTaskNameExists(resolveTaskNameValue(el.newTaskNameField));
    if (!name) {
      show("工数名を選択または入力してください", true);
      return;
    }
    const project = ensureProjectExists(resolveProjectValue(el.newProjectField));
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
  }

  el.newNote.value = "";
  el.newTaskNameField.value = "";
  el.newProjectField.value = "";
  renderSelects();
  renderMasterLists();
  renderTasks();
  scheduleSave();
  syncParallelTotalPlanned();
  setTab("active");
}

/* ── Google Calendar Import ────── */

function getCalendarAuthToken() {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || !chrome.identity?.getAuthToken) {
      reject(new Error("この機能はChrome拡張機能でのみ利用可能です"));
      return;
    }
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!token) {
        reject(new Error("認証トークンを取得できませんでした"));
        return;
      }
      resolve(token);
    });
  });
}

async function fetchCalendarEvents(token, dateStr) {
  const timeMin = new Date(`${dateStr}T00:00:00`).toISOString();
  const nextDay = new Date(`${dateStr}T00:00:00`);
  nextDay.setDate(nextDay.getDate() + 1);
  const timeMax = nextDay.toISOString();

  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("timeMax", timeMax);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "100");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    if (res.status === 401) {
      chrome.identity.removeCachedAuthToken({ token });
      throw new Error("認証が期限切れです。再度お試しください");
    }
    throw new Error(`Calendar APIエラー: ${res.status}`);
  }

  return res.json();
}

async function importFromCalendar() {
  if (!state.user) {
    show("担当者を入力してください", true);
    return;
  }
  if (!state.date) {
    show("日付を選択してください", true);
    return;
  }

  const manifest = chrome.runtime.getManifest();
  const clientId = manifest.oauth2?.client_id || "";
  if (!clientId || clientId.startsWith("YOUR_CLIENT_ID")) {
    show("manifest.jsonにGoogle OAuth2のclient_idを設定してください", true);
    return;
  }

  const btn = document.getElementById("importCalendarBtn");
  btn.disabled = true;
  btn.textContent = "接続中...";

  try {
    const token = await getCalendarAuthToken();

    btn.textContent = "取得中...";
    const data = await fetchCalendarEvents(token, state.date);

    if (!data.items || data.items.length === 0) {
      show("この日のカレンダーイベントはありません");
      return;
    }

    const projectName = ensureProjectExists("カレンダー");
    let importCount = 0;

    for (const event of data.items) {
      if (event.status === "cancelled") continue;

      const title = event.summary || "(無題)";
      let plannedMinutes = 0;

      if (event.start?.dateTime && event.end?.dateTime) {
        const start = new Date(event.start.dateTime);
        const end = new Date(event.end.dateTime);
        plannedMinutes = Math.max(0, Math.round((end - start) / 60000));
      }

      const taskName = ensureTaskNameExists(title);

      state.tasks.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}-cal${importCount}`,
        name: taskName,
        project: projectName,
        plannedMinutes,
        actualSeconds: 0,
        note: "",
        status: "pending",
        startedAt: 0,
        completedAt: 0,
        plannedNotified: false,
        remainingNotified: false,
        elapsedNotified: false,
        parallel: false,
        subTasks: [],
      });
      importCount++;
    }

    renderSelects();
    renderMasterLists();
    renderTasks();
    scheduleSave();
    show(`${importCount}件のカレンダーイベントをインポートしました`);
    setTab("active");
  } catch (e) {
    show(`カレンダーインポート失敗: ${e.message}`, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "カレンダーからインポート";
  }
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

function applyRememberedTab() {
  const remembered = localStorage.getItem(PREF_LAST_TAB_KEY) || "new";
  setTab(remembered);
}

function setUserFromInput() {
  const user = el.loginUserInput.value.trim();
  if (!validateUser(user)) {
    state.user = "";
    updateLoginState();
    show("担当者名にスペース・スラッシュは使えません", true);
    return;
  }
  state.user = user;
  updateLoginState();
  localStorage.setItem(PREF_LAST_USER_KEY, user);
  loadDay().catch((e) => show(`読込失敗: ${e.message}`, true));
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
    if (
      state.notifySettings.beforeEnabled &&
      plannedSec > 0 &&
      !t.remainingNotified
    ) {
      const beforeSec = state.notifySettings.beforeMinutes * 60;
      const remainingSec = plannedSec - elapsed;
      if (remainingSec > 0 && remainingSec <= beforeSec) {
        t.remainingNotified = true;
        hasStateChange = true;
        notifyRemainingTime(t, remainingSec);
      }
    }
    if (
      state.notifySettings.elapsedEnabled &&
      !t.elapsedNotified
    ) {
      const thresholdSec = state.notifySettings.elapsedMinutes * 60;
      if (elapsed >= thresholdSec) {
        t.elapsedNotified = true;
        hasStateChange = true;
        notifyElapsedTime(t, elapsed);
      }
    }
    if (plannedSec > 0 && elapsed >= plannedSec && !t.plannedNotified) {
      t.plannedNotified = true;
      hasStateChange = true;
      notifyPlannedTimeReached(t, elapsed);
    }
  });
  const runningTotalSec = running.reduce((acc, t) => acc + elapsedSeconds(t), 0);
  el.activeSummary.textContent = `進行中: ${running.length}件 / 合計タイマー: ${formatClock(runningTotalSec)}`;
  if (hasStateChange) scheduleSave();
}

/* ── Event Listeners ───────────── */

document.getElementById("addBtn").addEventListener("click", addTask);
document.getElementById("importCalendarBtn").addEventListener("click", () => importFromCalendar().catch((e) => show(`インポート失敗: ${e.message}`, true)));
document.getElementById("copyAllHtmlBtn").addEventListener("click", () => copyAllDoneHtml().catch((e) => show(`コピー失敗: ${e.message}`, true)));
document.getElementById("clearDoneBtn").addEventListener("click", clearDoneTasks);
document.getElementById("addMasterProjectBtn").addEventListener("click", addMasterProject);
document.getElementById("addMasterTaskNameBtn").addEventListener("click", addMasterTaskName);
document.getElementById("addSubTaskBtn").addEventListener("click", addSubTask);
bindComboOpen(el.newProjectOpenBtn, el.newProjectMenu, el.newProjectField);
bindComboOpen(el.newTaskNameOpenBtn, el.newTaskNameMenu, el.newTaskNameField);
bindComboOpen(el.parallelProjectOpenBtn, el.parallelProjectMenu, el.parallelProjectField);
bindComboOpen(el.parallelTaskNameOpenBtn, el.parallelTaskNameMenu, el.parallelTaskNameField);
bindComboInputFocus(el.newProjectField, el.newProjectMenu);
bindComboInputFocus(el.newTaskNameField, el.newTaskNameMenu);
bindComboInputFocus(el.parallelProjectField, el.parallelProjectMenu);
bindComboInputFocus(el.parallelTaskNameField, el.parallelTaskNameMenu);

el.loginUserInput.addEventListener("change", setUserFromInput);
el.loginUserInput.addEventListener("blur", setUserFromInput);
el.loginUserInput.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") setUserFromInput();
});
el.dateInput.addEventListener("change", () => {
  if (state.user) loadDay().catch((e) => show(`読込失敗: ${e.message}`, true));
});
el.masterProjectInput.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") addMasterProject();
});
el.masterTaskNameInput.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") addMasterTaskName();
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
el.newPlanned.addEventListener("input", () => {
  if (el.parallelToggle.checked) return;
  el.newPlanned.value = String(normalizeHalfHours(el.newPlanned.value, 0));
});
el.newPlanned.addEventListener("blur", () => {
  el.newPlanned.value = String(normalizeHalfHours(el.newPlanned.value, 0));
});
el.parallelPlannedInput.addEventListener("input", () => {
  el.parallelPlannedInput.value = String(normalizeHalfHours(el.parallelPlannedInput.value, 0.5));
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
    el.newPlanned.value = "0.5";
  }
});

document.addEventListener("click", (ev) => {
  const comboItem = ev.target.closest(".combo-item");
  if (comboItem) {
    const targetId = comboItem.dataset.comboTarget || "";
    const value = comboItem.dataset.comboValue || "";
    const targetInput = targetId ? document.getElementById(targetId) : null;
    if (targetInput) {
      targetInput.value = value;
      targetInput.focus();
    }
    closeAllComboMenus();
    return;
  }
  const clickedCombo = ev.target.closest(".combo-wrap, .combo-menu");
  if (!clickedCombo) {
    closeAllComboMenus();
  }
  const btn = ev.target.closest("button[data-action]");
  if (!btn) return;

  const action = btn.dataset.action;
  const id = btn.dataset.id || "";

  if (action === "start") startTask(id);
  if (action === "pause") pauseTask(id);
  if (action === "complete") completeTask(id);
  if (action === "copy-row") copyRowHtml(id).catch((e) => show(`コピー失敗: ${e.message}`, true));
  if (action === "copy-col") copyColumn(btn.dataset.col).catch((e) => show(`コピー失敗: ${e.message}`, true));
  if (action === "delete-done") deleteDoneTask(id);
  if (action === "remove-master-project") removeMasterProject(btn.dataset.project);
  if (action === "remove-master-taskname") removeMasterTaskName(btn.dataset.taskname);
  if (action === "remove-subtask") removeSubTask(Number(btn.dataset.index));
});

el.tabs.addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-tab]");
  if (!btn) return;
  setTab(btn.dataset.tab);
});

/* ── Init ──────────────────────── */

(function init() {
  el.dateInput.value = todayStr();
  renderSelects();
  renderMasterLists();
  renderNotifySettings();
  renderTasks();
  applyRememberedUser();
  applyRememberedTab();
  loadUsers().catch(() => {});
  if (state.user) loadDay().catch(() => {});
  setInterval(tickRunning, 1000);
})();
