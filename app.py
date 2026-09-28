import calendar
import os
import sqlite3
import uuid
from contextlib import closing, contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from flask import Flask, abort, flash, redirect, render_template, request, send_from_directory, url_for
from werkzeug.utils import secure_filename

CUISINES = ["日式料理", "台式料理", "韓式料理", "義式料理", "中式料理", "美式料理", "泰式料理", "越式料理", "其他"]
MEALS = ["早餐", "午餐", "晚餐", "點心", "宵夜"]
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
CHART_COLORS = ["#e7795e", "#6f9d7d", "#e5b84e", "#7196a7", "#a789b5", "#d69b62", "#7f9b58", "#d47a8a", "#98a2a5"]


def create_app(test_config=None):
    app = Flask(__name__, instance_relative_config=True)
    if test_config:
        app.config.update(test_config)

    @app.get("/")
    def home():
        return render_template("home.html", today=date.today())

    @app.get("/add")
    def add_record():
        return render_template("record_form.html", editing=False, record_id="", meals=MEALS, cuisines=CUISINES)

    @app.get("/edit/<int:record_id>")
    def edit_record(record_id):
        return render_template("record_form.html", editing=True, record_id=record_id, meals=MEALS, cuisines=CUISINES)

    @app.get("/calendar")
    def calendar_page():
        now = date.today()
        try:
            year = int(request.args.get("year", now.year))
            month = int(request.args.get("month", now.month))
            if not 1 <= month <= 12 or not 1900 <= year <= 9999:
                raise ValueError
            selected_day = int(request.args["day"]) if request.args.get("day") else None
            if selected_day and selected_day > calendar.monthrange(year, month)[1]:
                selected_day = None
        except ValueError:
            abort(400)
        previous_year, previous_month = (year - 1, 12) if month == 1 else (year, month - 1)
        next_year, next_month = (year + 1, 1) if month == 12 else (year, month + 1)
        weeks = calendar.Calendar(firstweekday=6).monthdayscalendar(year, month)
        return render_template("calendar.html", year=year, month=month, weeks=weeks,
                               selected_day=selected_day,
                               previous=(previous_year, previous_month), next_month=(next_year, next_month))

    @app.get("/statistics")
    def statistics():
        now = date.today()
        try:
            year = int(request.args.get("year", now.year))
            month = int(request.args.get("month", now.month))
            if not 1 <= month <= 12 or not 1900 <= year <= 9999:
                raise ValueError
        except ValueError:
            abort(400)
        previous = (year - 1, 12) if month == 1 else (year, month - 1)
        following = (year + 1, 1) if month == 12 else (year, month + 1)
        return render_template("statistics.html", year=year, month=month,
                               previous=previous, following=following)

    @app.get("/profile")
    def profile():
        return render_template("profile.html", cuisines=CUISINES)

    return app


def initialize_database(database_path):
    with closing(sqlite3.connect(database_path)) as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS food_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                food_name TEXT NOT NULL,
                eaten_at TEXT NOT NULL,
                timezone_offset INTEGER NOT NULL DEFAULT 0,
                meal_type TEXT NOT NULL,
                cuisine_type TEXT NOT NULL,
                image_url TEXT,
                note TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS food_record_tags (
                food_record_id INTEGER NOT NULL REFERENCES food_records(id) ON DELETE CASCADE,
                tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                PRIMARY KEY (food_record_id, tag_id)
            );
        """)
        db.execute("PRAGMA foreign_keys = ON")
        db.commit()


@contextmanager
def connect(app):
    db = sqlite3.connect(app.config["DATABASE"])
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def format_local_time(value, offset):
    eaten_at = datetime.fromisoformat(value)
    local_zone = timezone(timedelta(minutes=-int(offset)))
    return eaten_at.astimezone(local_zone).strftime("%H:%M")


def local_datetime_input(record):
    eaten_at = datetime.fromisoformat(record["eaten_at"])
    local_zone = timezone(timedelta(minutes=-int(record.get("timezone_offset", 0))))
    return eaten_at.astimezone(local_zone).strftime("%Y-%m-%dT%H:%M")


def load_records(app):
    with connect(app) as db:
        rows = db.execute("""
            SELECT f.*, GROUP_CONCAT(t.name, char(31)) AS tag_names
            FROM food_records AS f
            LEFT JOIN food_record_tags AS ft ON ft.food_record_id = f.id
            LEFT JOIN tags AS t ON t.id = ft.tag_id
            GROUP BY f.id ORDER BY f.eaten_at DESC, f.id DESC
        """).fetchall()
    records = []
    for row in rows:
        record = dict(row)
        record["tags"] = record.pop("tag_names").split(chr(31)) if record.get("tag_names") else []
        records.append(record)
    return records


def load_record(app, record_id):
    return next((record for record in load_records(app) if record["id"] == record_id), None)


def load_tag_names(app):
    with connect(app) as db:
        return [row[0] for row in db.execute("SELECT name FROM tags ORDER BY name").fetchall()]


def local_date(record):
    eaten_at = datetime.fromisoformat(record["eaten_at"])
    offset = int(record.get("timezone_offset", 0))
    return eaten_at.astimezone(timezone(timedelta(minutes=-offset))).date()


def save_record(app, record_id=None):
    food_name = request.form.get("food_name", "").strip()
    meal_type = request.form.get("meal_type", "")
    cuisine_type = request.form.get("cuisine_type", "")
    eaten_value = request.form.get("eaten_at", "")
    if not food_name:
        return None, "請填寫食物名稱。"
    if meal_type not in MEALS or cuisine_type not in CUISINES:
        return None, "請選擇有效的餐別與料理類型。"
    try:
        eaten_at = datetime.fromisoformat(eaten_value)
        offset = int(request.form.get("timezone_offset", "0"))
        if eaten_at.tzinfo is not None or not -840 <= offset <= 840:
            raise ValueError
        eaten_at = eaten_at.replace(tzinfo=timezone(timedelta(minutes=-offset))).astimezone(timezone.utc).isoformat()
    except (ValueError, TypeError):
        return None, "請選擇有效的日期與時間。"

    with connect(app) as db:
        old = db.execute("SELECT image_url FROM food_records WHERE id = ?", (record_id,)).fetchone() if record_id else None
        if record_id and old is None:
            abort(404)
        image_name = old["image_url"] if old else None
        uploaded = request.files.get("image")
        if uploaded and uploaded.filename:
            extension = Path(secure_filename(uploaded.filename)).suffix.lower()
            if extension not in IMAGE_EXTENSIONS or not (uploaded.mimetype or "").startswith("image/"):
                return None, "請上傳 JPG、PNG、WebP 或 GIF 圖片。"
            image_name = f"{uuid.uuid4().hex}{extension}"
            uploaded.save(Path(app.config["UPLOAD_FOLDER"]) / image_name)
        values = (food_name, eaten_at, offset, meal_type, cuisine_type, image_name, request.form.get("note", "").strip())
        if record_id:
            db.execute("""UPDATE food_records SET food_name=?, eaten_at=?, timezone_offset=?, meal_type=?, cuisine_type=?, image_url=?, note=? WHERE id=?""", (*values, record_id))
        else:
            cursor = db.execute("""INSERT INTO food_records (food_name, eaten_at, timezone_offset, meal_type, cuisine_type, image_url, note) VALUES (?, ?, ?, ?, ?, ?, ?)""", values)
            record_id = cursor.lastrowid
        db.execute("DELETE FROM food_record_tags WHERE food_record_id = ?", (record_id,))
        tag_names = dict.fromkeys(tag.strip().lstrip("#") for tag in request.form.get("tags", "").replace("\n", ",").split(",") if tag.strip().lstrip("#"))
        for tag_name in tag_names:
            db.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (tag_name[:40],))
            tag_id = db.execute("SELECT id FROM tags WHERE name = ?", (tag_name[:40],)).fetchone()[0]
            db.execute("INSERT INTO food_record_tags (food_record_id, tag_id) VALUES (?, ?)", (record_id, tag_id))
    if old and old["image_url"] and image_name != old["image_url"]:
        remove_image(app, old["image_url"])
    return record_id, None


def remove_image(app, image_name):
    if image_name:
        try:
            (Path(app.config["UPLOAD_FOLDER"]) / Path(image_name).name).unlink(missing_ok=True)
        except OSError:
            app.logger.warning("Could not remove uploaded image %s", image_name)


app = create_app()

if __name__ == "__main__":
    app.run(debug=os.environ.get("FLASK_DEBUG") == "1")
