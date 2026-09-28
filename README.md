# 好好食記

以 Python、Flask 與 SQLite 製作的手機優先食物日記。可新增、編輯、刪除餐點，保存照片及標籤，按日期回顧並查看每月料理比例與熱門標籤。

## 啟動

```powershell
C:/Python314/python.exe -m venv .venv
.venv/Scripts/Activate.ps1
python -m pip install -r requirements.txt
python app.py
```

開啟 http://127.0.0.1:5000。資料庫和上傳照片預設放在 `instance/`，不會被 Git 追蹤。可用 `FOOD_DIARY_DATABASE`、`FOOD_DIARY_UPLOADS` 和 `FLASK_SECRET_KEY` 覆寫設定。

## 測試

```powershell
python -m unittest discover -s tests -v
```

此版本使用本機 SQLite 與本機圖片目錄，不需要登入或雲端金鑰。部署到 Vercel/Supabase 前，需改用持久化資料庫與物件儲存；Vercel 無伺服器檔案系統不適合保存使用者圖片。
