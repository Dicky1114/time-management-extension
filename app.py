#!/usr/bin/env python3
import json
import os
import re
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR / "web"
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

USER_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def safe_user(user: str) -> str:
    if not USER_RE.match(user or ""):
        raise ValueError("invalid user")
    return user


def safe_date(date_str: str) -> str:
    if not DATE_RE.match(date_str or ""):
        raise ValueError("invalid date")
    # Validate actual date
    datetime.strptime(date_str, "%Y-%m-%d")
    return date_str


def user_file(user: str) -> Path:
    return DATA_DIR / f"{user}.json"


def load_user_data(user: str) -> dict:
    path = user_file(user)
    if not path.exists():
        return {"days": {}}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"days": {}}


def save_user_data(user: str, data: dict) -> None:
    path = user_file(user)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path):
        if not path.exists() or not path.is_file():
            self.send_error(404, "Not Found")
            return

        content_type = "text/plain; charset=utf-8"
        if path.suffix == ".html":
            content_type = "text/html; charset=utf-8"
        elif path.suffix == ".css":
            content_type = "text/css; charset=utf-8"
        elif path.suffix == ".js":
            content_type = "application/javascript; charset=utf-8"

        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8"))

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/":
            self._send_file(WEB_DIR / "index.html")
            return
        if path.startswith("/static/"):
            rel = path.replace("/static/", "", 1)
            self._send_file(WEB_DIR / rel)
            return
        if path in {"/style.css", "/app.js"}:
            self._send_file(WEB_DIR / path.lstrip("/"))
            return

        if path == "/api/users":
            users = sorted([p.stem for p in DATA_DIR.glob("*.json") if USER_RE.match(p.stem)])
            self._send_json(200, {"users": users})
            return

        if path == "/api/day":
            try:
                q = parse_qs(parsed.query)
                user = safe_user((q.get("user") or [""])[0])
                day = safe_date((q.get("date") or [""])[0])
                data = load_user_data(user)
                tasks = data.get("days", {}).get(day, [])
                projects = data.get("projects", [])
                task_names = data.get("taskNames", [])
                notify_settings = data.get("notifySettings", {})
                self._send_json(200, {
                    "tasks": tasks,
                    "projects": projects,
                    "taskNames": task_names,
                    "notifySettings": notify_settings,
                })
            except (ValueError, KeyError):
                self._send_json(400, {"error": "invalid parameters"})
            return

        self.send_error(404, "Not Found")

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/day/save":
            try:
                payload = self._read_json()
                user = safe_user(payload.get("user", ""))
                day = safe_date(payload.get("date", ""))
                tasks = payload.get("tasks", [])
                projects = payload.get("projects", [])

                if not isinstance(tasks, list):
                    raise ValueError("tasks must be list")
                if not isinstance(projects, list):
                    raise ValueError("projects must be list")

                clean_tasks = []
                for t in tasks:
                    if not isinstance(t, dict):
                        continue
                    task = {
                        "id": str(t.get("id", ""))[:128],
                        "name": str(t.get("name", ""))[:200],
                        "plannedMinutes": int(t.get("plannedMinutes", 0) or 0),
                        "actualSeconds": int(t.get("actualSeconds", 0) or 0),
                        "project": str(t.get("project", ""))[:120],
                        "note": str(t.get("note", ""))[:1000],
                        "status": str(t.get("status", "pending"))[:20],
                        "startedAt": int(t.get("startedAt", 0) or 0),
                        "completedAt": int(t.get("completedAt", 0) or 0),
                        "plannedNotified": bool(t.get("plannedNotified", False)),
                        "remainingNotified": bool(t.get("remainingNotified", False)),
                        "elapsedNotified": bool(t.get("elapsedNotified", False)),
                        "parallel": bool(t.get("parallel", False)),
                        "subTasks": [],
                    }
                    if task["parallel"] and isinstance(t.get("subTasks"), list):
                        for st in t["subTasks"]:
                            if not isinstance(st, dict):
                                continue
                            task["subTasks"].append({
                                "name": str(st.get("name", ""))[:200],
                                "project": str(st.get("project", ""))[:120],
                                "plannedHours": float(st.get("plannedHours", 0) or 0),
                                "ratio": float(st.get("ratio", 0) or 0),
                            })
                    clean_tasks.append(task)

                data = load_user_data(user)
                data.setdefault("days", {})[day] = clean_tasks
                data["projects"] = [str(p)[:120] for p in projects if str(p).strip()][:200]
                task_names = payload.get("taskNames", [])
                if isinstance(task_names, list):
                    data["taskNames"] = [str(n)[:200] for n in task_names if str(n).strip()][:500]
                notify_settings = payload.get("notifySettings")
                if isinstance(notify_settings, dict):
                    data["notifySettings"] = {
                        "beforeEnabled": bool(notify_settings.get("beforeEnabled", False)),
                        "beforeMinutes": max(1, int(notify_settings.get("beforeMinutes", 10) or 10)),
                        "elapsedEnabled": bool(notify_settings.get("elapsedEnabled", False)),
                        "elapsedMinutes": max(1, int(notify_settings.get("elapsedMinutes", 60) or 60)),
                    }
                save_user_data(user, data)
                self._send_json(200, {"ok": True})
            except (ValueError, json.JSONDecodeError):
                self._send_json(400, {"error": "invalid payload"})
            return

        self.send_error(404, "Not Found")


def main():
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Server started: http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
