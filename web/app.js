const state = {
  user: "",
  date: "",
  tasks: [],
  projects: [],
};

const STORAGE_PREFIX = "tm_user_";
const PREF_LAST_USER_KEY = "tm_pref_last_user";
const SAVE_DEBOUNCE_MS = 700;

let saveTimer = null;
let saveInFlight = false;
let saveQueued = false;

const el = {
  loginUserInput: document.getElementById("loginUserInput"),
  rememberUserChk: document.getElementById("rememberUserChk"),
  loginState: document.getElementById("loginState"),
  dateInput: document.getElementById("dateInput"),
  message: document.getElementById("message"),
  activeBody: document.getElementById("activeBody"),
  doneBody: document.getElementById("doneBody"),
  newName: document.getElementById("newName"),
  newProjectSelect: document.getElementById("newProjectSelect"),
  newProjectName: document.getElementById("newProjectName"),
  newPlanned: document.getElementById("newPlanned"),
  newNote: document.getElementById("newNote"),
  copyBtn: document.getElementById("copyBtn"),
  userList: document.getElementById("userList"),
  projectList: document.getElementById("projectList"),
};

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

function secToHour(sec) {
  return Math.round((sec / 3600) * 2) / 2;
}

function minToHour(min) {
  return Math.round((min / 60) * 2) / 2;
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

function normalizeTask(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    id: String(raw.id || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`).slice(0, 128),
    name: String(raw.name || "").slice(0, 200),
    project: normalizeProjectName(raw.project),
    plannedMinutes: Math.max(0, Number(raw.plannedMinutes || 0) || 0),
    actualSeconds: Math.max(0, Math.floor(Number(raw.actualSeconds || 0) || 0)),
    note: String(raw.note || "").slice(0, 1000),
    status: ["pending", "running", "paused", "completed"].includes(raw.status) ? raw.status : "pending",
    startedAt: Math.max(0, Math.floor(Number(raw.startedAt || 0) || 0)),
    completedAt: Math.max(0, Math.floor(Number(raw.completedAt || 0) || 0)),
  };
}

function normalizeTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks.map(normalizeTask).filter(Boolean);
}

function deriveProjectsFromTasks(tasks) {
  return normalizeProjects(tasks.map((t) => t.project));
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

function storageKey(user) {
  return `${STORAGE_PREFIX}${user}`;
}

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
        const userData = data[storageKey(user)] || { days: {}, projects: [] };
        const tasks = normalizeTasks(userData.days?.[date]);
        const projects = normalizeProjects(userData.projects || []).concat(
          deriveProjectsFromTasks(tasks).filter((p) => !(userData.projects || []).includes(p)),
        );
        return { tasks, projects: normalizeProjects(projects) };
      },
      async saveDay(user, date, tasks, projects) {
        const key = storageKey(user);
        const data = await chromeStorageGet(key);
        const userData = data[key] && typeof data[key] === "object" ? data[key] : { days: {}, projects: [] };
        if (!userData.days || typeof userData.days !== "object") {
          userData.days = {};
        }
        userData.days[date] = normalizeTasks(tasks);
        userData.projects = normalizeProjects(projects);
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
        return {
          tasks: normalizeTasks(data.tasks),
          projects: normalizeProjects(data.projects || []).concat(
            deriveProjectsFromTasks(normalizeTasks(data.tasks)).filter((p) => !(data.projects || []).includes(p)),
          ),
        };
      },
      async saveDay(user, date, tasks, projects) {
        await api("/api/day/save", {
          method: "POST",
          body: JSON.stringify({
            user,
            date,
            tasks: normalizeTasks(tasks),
            projects: normalizeProjects(projects),
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
      if (!raw) return { tasks: [], projects: [] };
      try {
        const data = JSON.parse(raw);
        const tasks = normalizeTasks(data.days?.[date]);
        return {
          tasks,
          projects: normalizeProjects(data.projects || []).concat(
            deriveProjectsFromTasks(tasks).filter((p) => !(data.projects || []).includes(p)),
          ),
        };
      } catch {
        return { tasks: [], projects: [] };
      }
    },
    async saveDay(user, date, tasks, projects) {
      const key = storageKey(user);
      let data = { days: {}, projects: [] };
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          data = { days: {}, projects: [] };
        }
      }
      if (!data.days || typeof data.days !== "object") {
        data.days = {};
      }
      data.days[date] = normalizeTasks(tasks);
      data.projects = normalizeProjects(projects);
      localStorage.setItem(key, JSON.stringify(data));
    },
  };
})();

function ensureProjectExists(name) {
  const normalized = normalizeProjectName(name);
  if (!normalized) return;
  if (!state.projects.includes(normalized)) {
    state.projects.push(normalized);
    state.projects = normalizeProjects(state.projects);
  }
}

function updateLoginState() {
  if (state.user) {
    el.loginState.textContent = `${state.user} でログイン中`;
  } else {
    el.loginState.textContent = "未ログイン";
  }
}

function requireLogin() {
  if (state.user) return true;
  show("先にログインしてください", true);
  return false;
}

function renderProjectSelect() {
  const current = el.newProjectSelect.value;
  el.newProjectSelect.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "(未設定)";
  el.newProjectSelect.appendChild(blank);

  state.projects.forEach((p) => {
    const option = document.createElement("option");
    option.value = p;
    option.textContent = p;
    el.newProjectSelect.appendChild(option);
  });

  if (state.projects.includes(current)) {
    el.newProjectSelect.value = current;
  }
}

function renderProjectList() {
  const frag = document.createDocumentFragment();
  state.projects.forEach((p) => {
    const li = document.createElement("li");
    li.className = "project-item";
    const label = document.createElement("span");
    label.textContent = p;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.action = "remove-project";
    btn.dataset.project = p;
    btn.textContent = "削除";
    li.appendChild(label);
    li.appendChild(btn);
    frag.appendChild(li);
  });
  el.projectList.replaceChildren(frag);
}

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
  const { tasks, projects } = await backend.loadDay(state.user, date);
  state.tasks = tasks;
  state.projects = normalizeProjects(projects.length ? projects : deriveProjectsFromTasks(tasks));
  renderProjectSelect();
  renderProjectList();
  render();
  show(`${state.user} / ${date} を読み込みました (${backend.name})`);
}

async function saveDayCore(showSuccessMessage = true) {
  if (!state.user || !state.date) return;
  await backend.saveDay(state.user, state.date, state.tasks, state.projects);
  if (showSuccessMessage) {
    show("保存しました");
  }
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

function addTask() {
  if (!requireLogin()) return;
  if (!state.date) {
    show("先に日付を読み込んでください", true);
    return;
  }

  const name = el.newName.value.trim();
  if (!name) {
    show("工数名を入力してください", true);
    return;
  }

  const project = normalizeProjectName(el.newProjectSelect.value);
  ensureProjectExists(project);

  state.tasks.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name,
    project,
    plannedMinutes: Math.max(0, (Number(el.newPlanned.value || 0) || 0) * 60),
    actualSeconds: 0,
    note: el.newNote.value.trim(),
    status: "pending",
    startedAt: 0,
    completedAt: 0,
  });

  el.newName.value = "";
  el.newNote.value = "";
  renderProjectSelect();
  renderProjectList();
  render();
  scheduleSave();
}

function addProject() {
  if (!requireLogin()) return;
  const name = normalizeProjectName(el.newProjectName.value);
  if (!name) {
    show("案件名を入力してください", true);
    return;
  }
  ensureProjectExists(name);
  el.newProjectName.value = "";
  renderProjectSelect();
  renderProjectList();
  scheduleSave();
}

function removeProject(name) {
  state.projects = state.projects.filter((p) => p !== name);
  state.tasks = state.tasks.map((t) => (t.project === name ? { ...t, project: "" } : t));
  renderProjectSelect();
  renderProjectList();
  render();
  scheduleSave();
}

function findTask(id) {
  return state.tasks.find((t) => t.id === id);
}

function startTask(id) {
  const task = findTask(id);
  if (!task || task.status === "completed") return;

  state.tasks.forEach((t) => {
    if (t.status === "running" && t.id !== id && t.startedAt) {
      t.actualSeconds += Math.floor((nowMs() - t.startedAt) / 1000);
      t.startedAt = 0;
      t.status = "paused";
    }
  });

  if (task.status !== "running") {
    task.status = "running";
    task.startedAt = nowMs();
  }
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
  render();
  scheduleSave();
}

function render() {
  const active = state.tasks.filter((t) => t.status !== "completed");
  const done = state.tasks.filter((t) => t.status === "completed");

  const activeFrag = document.createDocumentFragment();
  active.forEach((t) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(t.name)}</td>
      <td>${escapeHtml(t.project || "")}</td>
      <td>${minToHour(t.plannedMinutes)}</td>
      <td data-role="elapsed" data-id="${t.id}">${secToHour(elapsedSeconds(t))}h</td>
      <td>${escapeHtml(t.note || "")}</td>
      <td>${taskStatusLabel(t.status)}</td>
      <td>
        <div class="ops">
          <button data-action="start" data-id="${t.id}">開始</button>
          <button class="stop" data-action="pause" data-id="${t.id}">一時停止</button>
          <button class="done" data-action="complete" data-id="${t.id}">完了</button>
        </div>
      </td>
    `;
    activeFrag.appendChild(tr);
  });
  el.activeBody.replaceChildren(activeFrag);

  const doneFrag = document.createDocumentFragment();
  done.forEach((t) => {
    const tr = document.createElement("tr");
    const completeAt = t.completedAt
      ? new Date(t.completedAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
      : "";
    tr.innerHTML = `
      <td>${state.date}</td>
      <td>${escapeHtml(t.name)}</td>
      <td>${escapeHtml(t.project || "")}</td>
      <td>${minToHour(t.plannedMinutes)}</td>
      <td>${secToHour(elapsedSeconds(t))}</td>
      <td>${escapeHtml(t.note || "")}</td>
      <td>${completeAt}</td>
      <td><button class="line-copy" data-action="copy-row" data-id="${t.id}">1行コピー</button></td>
    `;
    doneFrag.appendChild(tr);
  });
  el.doneBody.replaceChildren(doneFrag);
}

function tickRunningElapsedOnly() {
  const running = state.tasks.filter((t) => t.status === "running");
  if (running.length === 0) return;

  running.forEach((t) => {
    const cell = el.activeBody.querySelector(`[data-role="elapsed"][data-id="${CSS.escape(t.id)}"]`);
    if (cell) {
      cell.textContent = `${secToHour(elapsedSeconds(t))}h`;
    }
  });
}

function rowToTSV(task) {
  return [
    state.date,
    task.name || "",
    task.project || "",
    String(minToHour(task.plannedMinutes)),
    String(secToHour(elapsedSeconds(task))),
    task.note || "",
    task.completedAt ? new Date(task.completedAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) : "",
  ]
    .map((c) => String(c).replaceAll("\t", " ").replaceAll("\n", " "))
    .join("\t");
}

function rowToColumns(task) {
  return [
    state.date,
    task.name || "",
    task.project || "",
    String(minToHour(task.plannedMinutes)),
    String(secToHour(elapsedSeconds(task))),
    task.note || "",
    task.completedAt ? new Date(task.completedAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) : "",
  ].map((c) => String(c).replaceAll("\t", " ").replaceAll("\n", " "));
}

function columnsToHTML(rows) {
  const tbody = rows.map((row) =>
    "<tr>" + row.map((c) => `<td>${escapeHtml(c)}</td>`).join("") + "</tr>"
  ).join("");
  return `<google-sheets-html-origin><table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0"><tbody>${tbody}</tbody></table></google-sheets-html-origin>`;
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

function tsvForDone() {
  const done = state.tasks.filter((t) => t.status === "completed");
  const lines = [["日付", "工数名", "案件名", "予定(h)", "実績(h)", "備考", "完了時刻"]];
  done.forEach((t) => {
    lines.push(rowToTSV(t).split("\t"));
  });
  return lines.map((row) => row.join("\t")).join("\n");
}

async function copyDoneTSV() {
  const done = state.tasks.filter((t) => t.status === "completed");
  const rows = done.map((t) => rowToColumns(t));
  const text = tsvForDone();
  const html = columnsToHTML(rows);
  await writeClipboard(text, html);
  show("完了一覧をまとめてコピーしました");
}

async function copyDoneRow(id) {
  const task = findTask(id);
  if (!task || task.status !== "completed") {
    show("コピー対象の完了行が見つかりません", true);
    return;
  }
  const text = rowToTSV(task);
  const html = columnsToHTML([rowToColumns(task)]);
  await writeClipboard(text, html);
  show(`1行コピーしました: ${task.name}`);
}

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
  updateLoginState();
  renderProjectSelect();
  renderProjectList();
  render();
  show("ログアウトしました");
}

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

document.addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-action]");
  if (!btn) return;

  const action = btn.getAttribute("data-action");
  if (action === "remove-project") {
    const project = btn.getAttribute("data-project") || "";
    removeProject(project);
    return;
  }

  const id = btn.getAttribute("data-id");
  if (action === "start") startTask(id);
  if (action === "pause") pauseTask(id);
  if (action === "complete") completeTask(id);
  if (action === "copy-row") {
    copyDoneRow(id).catch((e) => show(`コピー失敗: ${e.message}`, true));
  }
});

el.copyBtn.addEventListener("click", () => {
  copyDoneTSV().catch((e) => show(`コピー失敗: ${e.message}`, true));
});

setInterval(tickRunningElapsedOnly, 1000);

(function init() {
  el.dateInput.value = todayStr();
  renderProjectSelect();
  applyRememberedUser();
  loadUsers().catch(() => {});
  if (state.user) {
    loadDay().catch(() => {});
  }
})();
