from __future__ import annotations

import json
import mimetypes
import os
import re
import threading
import uuid
import webbrowser
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


HOST = "127.0.0.1"
PORT = int(os.environ.get("XXSNOTE_PORT", "4173"))
ROOT = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT / "dist"
DATA_DIR = ROOT / "data"
VERSION_FILE = ROOT / "VERSION"
INDEX_FILE = DATA_DIR / "index.json"
INDEX_TEMP_FILE = DATA_DIR / "index.json.tmp"
MAX_BODY_SIZE = 5 * 1024 * 1024
ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,100}$")
INDEX_VERSION = 2
DEFAULT_GROUP_ID = "default"
DEFAULT_GROUP = {"id": DEFAULT_GROUP_ID, "name": "默认分组", "createdAt": 0}
BEIJING_TIMEZONE = timezone(timedelta(hours=8))
WRITE_LOCK = threading.Lock()


def read_app_version() -> str:
    try:
        version = VERSION_FILE.read_text(encoding="utf-8").strip()
        return version or "0.0.0"
    except OSError:
        return "0.0.0"


APP_VERSION = read_app_version()


def ensure_data_files() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not INDEX_FILE.exists():
        atomic_write_json(
            INDEX_FILE,
            {"version": INDEX_VERSION, "groups": [DEFAULT_GROUP], "notes": []},
        )
        return

    current = json.loads(INDEX_FILE.read_text(encoding="utf-8"))
    migrated = normalize_index(current)
    if migrated != current:
        atomic_write_json(INDEX_FILE, migrated)


def atomic_write_json(target: Path, value: object) -> None:
    temporary = target.with_name(f"{target.name}.tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, target)


def read_index() -> dict:
    value = json.loads(INDEX_FILE.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or not isinstance(value.get("notes"), list):
        raise ValueError("data/index.json 格式无效")
    return normalize_index(value)


def normalize_index(value: dict) -> dict:
    raw_groups = value.get("groups")
    groups = []
    if isinstance(raw_groups, list):
        for group in raw_groups:
            if (
                isinstance(group, dict)
                and isinstance(group.get("id"), str)
                and ID_PATTERN.fullmatch(group["id"])
                and isinstance(group.get("name"), str)
                and group["name"].strip()
            ):
                groups.append(
                    {
                        "id": group["id"],
                        "name": group["name"].strip()[:20],
                        "createdAt": group.get("createdAt", 0),
                    }
                )

    if not any(group["id"] == DEFAULT_GROUP_ID for group in groups):
        groups.insert(0, DEFAULT_GROUP.copy())

    group_ids = {group["id"] for group in groups}
    notes = []
    for metadata in value.get("notes", []):
        if not isinstance(metadata, dict):
            continue
        group_id = metadata.get("groupId")
        notes.append(
            {
                **metadata,
                "groupId": group_id if group_id in group_ids else DEFAULT_GROUP_ID,
            }
        )

    return {"version": INDEX_VERSION, "groups": groups, "notes": notes}


def format_storage_date(timestamp_ms: int | float) -> str:
    moment = datetime.fromtimestamp(timestamp_ms / 1000, tz=BEIJING_TIMEZONE)
    return moment.strftime("%Y-%m-%d")


def note_path(note_id: str, created_at: int | float) -> Path | None:
    if not ID_PATTERN.fullmatch(note_id) or not isinstance(created_at, (int, float)):
        return None
    return DATA_DIR / format_storage_date(created_at) / f"{note_id}.json"


def is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def validate_note(note: object, expected_id: str) -> bool:
    return bool(
        isinstance(note, dict)
        and note.get("id") == expected_id
        and ID_PATTERN.fullmatch(expected_id)
        and isinstance(note.get("title"), str)
        and len(note["title"]) <= 80
        and isinstance(note.get("content"), str)
        and isinstance(note.get("pinned"), bool)
        and (
            note.get("groupId") is None
            or (
                isinstance(note.get("groupId"), str)
                and ID_PATTERN.fullmatch(note["groupId"])
            )
        )
        and is_number(note.get("createdAt"))
        and is_number(note.get("updatedAt"))
    )


def to_metadata(note: dict) -> dict:
    preview = " ".join(note["content"].split())[:160]
    return {
        "id": note["id"],
        "title": note["title"],
        "preview": preview,
        "pinned": note["pinned"],
        "groupId": note["groupId"],
        "createdAt": note["createdAt"],
        "updatedAt": note["updatedAt"],
    }


def save_note(note: dict) -> None:
    with WRITE_LOCK:
        index = read_index()
        existing_position = next(
            (position for position, item in enumerate(index["notes"]) if item.get("id") == note["id"]),
            None,
        )
        created_at = (
            index["notes"][existing_position]["createdAt"]
            if existing_position is not None
            else note["createdAt"]
        )
        group_ids = {group["id"] for group in index["groups"]}
        requested_group_id = note.get("groupId")
        group_id = requested_group_id if requested_group_id in group_ids else DEFAULT_GROUP_ID
        saved_note = {**note, "createdAt": created_at, "groupId": group_id}
        metadata = to_metadata(saved_note)

        if existing_position is None:
            index["notes"].append(metadata)
        else:
            index["notes"][existing_position] = metadata

        target = note_path(saved_note["id"], created_at)
        if target is None:
            raise ValueError("笔记 ID 无效")
        target.parent.mkdir(parents=True, exist_ok=True)
        atomic_write_json(target, saved_note)
        atomic_write_json(
            INDEX_FILE,
            {"version": INDEX_VERSION, "groups": index["groups"], "notes": index["notes"]},
        )


def delete_note(note_id: str) -> None:
    with WRITE_LOCK:
        index = read_index()
        metadata = next((item for item in index["notes"] if item.get("id") == note_id), None)
        index["notes"] = [item for item in index["notes"] if item.get("id") != note_id]

        if metadata:
            target = note_path(note_id, metadata.get("createdAt"))
            if target:
                target.unlink(missing_ok=True)

        atomic_write_json(
            INDEX_FILE,
            {"version": INDEX_VERSION, "groups": index["groups"], "notes": index["notes"]},
        )


def create_group(name: str) -> dict:
    clean_name = name.strip()
    if not clean_name or len(clean_name) > 20:
        raise ValueError("分组名称需要 1–20 个字符")

    with WRITE_LOCK:
        index = read_index()
        existing = next(
            (group for group in index["groups"] if group["name"] == clean_name),
            None,
        )
        if existing:
            return existing

        group = {
            "id": f"group-{uuid.uuid4()}",
            "name": clean_name,
            "createdAt": int(datetime.now(tz=BEIJING_TIMEZONE).timestamp() * 1000),
        }
        index["groups"].append(group)
        atomic_write_json(
            INDEX_FILE,
            {"version": INDEX_VERSION, "groups": index["groups"], "notes": index["notes"]},
        )
        return group


class XxsNoteHandler(BaseHTTPRequestHandler):
    server_version = f"xxsNote/{APP_VERSION}"

    def log_message(self, format_string: str, *args: object) -> None:
        print(f"[{self.log_date_time_string()}] {format_string % args}")

    def send_json(self, status: HTTPStatus | int, value: object) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(int(status))
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def read_json_body(self) -> object:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise RequestError(HTTPStatus.BAD_REQUEST, "Content-Length 无效") from error
        if content_length > MAX_BODY_SIZE:
            raise RequestError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "请求内容过大")
        try:
            return json.loads(self.rfile.read(content_length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise RequestError(HTTPStatus.BAD_REQUEST, "JSON 格式无效") from error

    def do_GET(self) -> None:
        self.route_request()

    def do_HEAD(self) -> None:
        self.route_request()

    def do_PUT(self) -> None:
        self.route_request()

    def do_POST(self) -> None:
        self.route_request()

    def do_DELETE(self) -> None:
        self.route_request()

    def route_request(self) -> None:
        try:
            path = unquote(urlsplit(self.path).path)
            if path == "/api/notes" and self.command in {"GET", "HEAD"}:
                self.send_json(HTTPStatus.OK, read_index()["notes"])
                return

            if path == "/api/groups" and self.command in {"GET", "HEAD"}:
                self.send_json(HTTPStatus.OK, read_index()["groups"])
                return

            if path == "/api/groups" and self.command == "POST":
                body = self.read_json_body()
                if not isinstance(body, dict) or not isinstance(body.get("name"), str):
                    raise RequestError(HTTPStatus.BAD_REQUEST, "分组名称无效")
                try:
                    group = create_group(body["name"])
                except ValueError as error:
                    raise RequestError(HTTPStatus.BAD_REQUEST, str(error)) from error
                self.send_json(HTTPStatus.CREATED, group)
                return

            if path == "/api/version" and self.command in {"GET", "HEAD"}:
                self.send_json(
                    HTTPStatus.OK,
                    {
                        "name": "xxsNote",
                        "version": APP_VERSION,
                        "platform": "windows-x64",
                    },
                )
                return

            match = re.fullmatch(r"/api/notes/([^/]+)", path)
            if match:
                self.handle_note_request(match.group(1))
                return

            if path.startswith("/api/"):
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "接口不存在"})
                return

            if self.command not in {"GET", "HEAD"}:
                self.send_json(HTTPStatus.METHOD_NOT_ALLOWED, {"error": "不支持的请求方法"})
                return

            self.serve_static(path)
        except RequestError as error:
            self.send_json(error.status, {"error": error.message})
        except Exception as error:
            print(f"请求处理失败：{error}")
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "服务器错误"})

    def handle_note_request(self, note_id: str) -> None:
        if not ID_PATTERN.fullmatch(note_id):
            raise RequestError(HTTPStatus.BAD_REQUEST, "笔记 ID 无效")

        if self.command in {"GET", "HEAD"}:
            metadata = next(
                (item for item in read_index()["notes"] if item.get("id") == note_id),
                None,
            )
            if not metadata:
                raise RequestError(HTTPStatus.NOT_FOUND, "笔记不存在")
            target = note_path(note_id, metadata.get("createdAt"))
            if target is None or not target.is_file():
                raise RequestError(HTTPStatus.NOT_FOUND, "笔记不存在")
            self.send_json(HTTPStatus.OK, json.loads(target.read_text(encoding="utf-8")))
            return

        if self.command == "PUT":
            note = self.read_json_body()
            if not validate_note(note, note_id):
                raise RequestError(HTTPStatus.BAD_REQUEST, "笔记数据格式无效")
            save_note(note)
            self.send_json(HTTPStatus.OK, {"ok": True})
            return

        if self.command == "DELETE":
            delete_note(note_id)
            self.send_json(HTTPStatus.OK, {"ok": True})
            return

        self.send_json(HTTPStatus.METHOD_NOT_ALLOWED, {"error": "不支持的请求方法"})

    def serve_static(self, request_path: str) -> None:
        relative_path = "index.html" if request_path == "/" else request_path.lstrip("/")
        requested = (PUBLIC_DIR / relative_path).resolve()
        public_root = PUBLIC_DIR.resolve()

        try:
            requested.relative_to(public_root)
        except ValueError as error:
            raise RequestError(HTTPStatus.FORBIDDEN, "禁止访问") from error

        if requested.is_dir():
            requested = requested / "index.html"
        if not requested.is_file():
            raise RequestError(HTTPStatus.NOT_FOUND, "页面不存在")

        body = requested.read_bytes()
        content_type = mimetypes.guess_type(requested.name)[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type in {"application/javascript", "application/json"}:
            content_type += "; charset=utf-8"

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)


class RequestError(Exception):
    def __init__(self, status: HTTPStatus, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def main() -> None:
    ensure_data_files()
    server = ThreadingHTTPServer((HOST, PORT), XxsNoteHandler)
    app_url = f"http://{HOST}:{PORT}"
    print(f"xxsNote v{APP_VERSION} 已启动：{app_url}")
    print(f"索引文件：{INDEX_FILE}")
    print(f"笔记目录：{DATA_DIR}\\YYYY-MM-DD")
    print("关闭此窗口即可停止服务")
    if os.environ.get("XXSNOTE_OPEN_BROWSER", "1") != "0":
        browser_timer = threading.Timer(0.3, lambda: webbrowser.open(app_url))
        browser_timer.daemon = True
        browser_timer.start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
