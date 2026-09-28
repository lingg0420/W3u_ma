import io
import tempfile
import unittest
from pathlib import Path

from app import create_app


class FoodDiaryTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.app = create_app({
            "TESTING": True,
            "DATABASE": str(root / "test.sqlite3"),
            "UPLOAD_FOLDER": str(root / "uploads"),
            "SECRET_KEY": "test",
        })
        self.client = self.app.test_client()

    def tearDown(self):
        self.temp_dir.cleanup()

    def create_record(self, name="測試拉麵", date="2026-09-12T19:20", tags="拉麵, 外食", image=None):
        data = {
            "food_name": name,
            "eaten_at": date,
            "timezone_offset": "-480",
            "meal_type": "晚餐",
            "cuisine_type": "日式料理",
            "tags": tags,
            "note": "湯頭很濃",
        }
        if image:
            data["image"] = (io.BytesIO(image), "meal.jpg", "image/jpeg")
        return self.client.post("/add", data=data, content_type="multipart/form-data", follow_redirects=True)

    def test_create_record_appears_in_calendar_and_statistics(self):
        response = self.create_record()
        self.assertEqual(response.status_code, 200)
        self.assertIn("飲食紀錄已儲存".encode(), response.data)

        calendar_response = self.client.get("/calendar?year=2026&month=9&day=12")
        self.assertIn("測試拉麵".encode(), calendar_response.data)
        statistics_response = self.client.get("/statistics?year=2026&month=9")
        self.assertIn("日式料理".encode(), statistics_response.data)
        self.assertIn("拉麵".encode(), statistics_response.data)
        self.assertIn("100.0%".encode(), statistics_response.data)

    def test_edit_and_delete_record(self):
        self.create_record()
        with self.app.app_context():
            from app import load_records
            record_id = load_records(self.app)[0]["id"]
        edited = self.client.post(f"/edit/{record_id}", data={
            "food_name": "修改後的拉麵", "eaten_at": "2026-09-13T12:00", "timezone_offset": "-480",
            "meal_type": "午餐", "cuisine_type": "日式料理", "tags": "拉麵", "note": "修改完成",
        }, follow_redirects=True)
        edited_day = self.client.get("/calendar?year=2026&month=9&day=13")
        self.assertIn("修改後的拉麵".encode(), edited_day.data)
        deleted = self.client.post(f"/delete/{record_id}", follow_redirects=True)
        self.assertIn("飲食紀錄已刪除".encode(), deleted.data)
        self.assertIn("還在等你".encode(), deleted.data)

    def test_upload_image_and_reject_non_image(self):
        saved = self.create_record(image=b"image bytes")
        self.assertEqual(saved.status_code, 200)
        with self.app.app_context():
            from app import load_records
            record = load_records(self.app)[0]
        self.assertTrue((Path(self.app.config["UPLOAD_FOLDER"]) / record["image_url"]).exists())

        invalid = self.client.post("/add", data={
            "food_name": "錯誤檔案", "eaten_at": "2026-09-12T19:20", "timezone_offset": "0",
            "meal_type": "晚餐", "cuisine_type": "日式料理", "tags": "",
            "image": (io.BytesIO(b"not an image"), "notes.txt", "text/plain"),
        }, content_type="multipart/form-data")
        self.assertEqual(invalid.status_code, 400)
        self.assertIn("請上傳".encode(), invalid.data)


if __name__ == "__main__":
    unittest.main()
