# my-erp-analysis (OpenClaw skill)

模擬 ERP 業務分析助理，附帶 18 個月故事化資料庫（`seed.db`，2024-12 ~ 2026-05）。

## 安裝

`openclaw skills install` 只吃 ClawHub slug / git repo / 本機資料夾三種來源，
且要求 `SKILL.md` 在來源根目錄。`seed.db`（~3MB）**不進 git**（被 `.gitignore`
擋掉），所以發佈靠隨附的 `my-erp-analysis.zip` 攜帶包，不走 git 安裝。

### 情境 1：在開發機上 demo（repo 已在本機）

`seed.db` 已在 skill 目錄裡，直接從本機路徑裝：

```bash
openclaw skills install ./seed/skills/my-erp-analysis --as my-erp-analysis
```

### 情境 2：在另一台機器 demo（老闆筆電 / 乾淨 demo 機）

把 `my-erp-analysis.zip` 傳過去，解壓後從資料夾裝（指向解出來的
`my-erp-analysis/`，因為 `SKILL.md` 要在來源根目錄）：

```bash
unzip my-erp-analysis.zip                                 # 解出 my-erp-analysis/（含 seed.db）
openclaw skills install ./my-erp-analysis --as my-erp-analysis
```

或更省事，直接解進搜尋路徑、免跑 install：

```bash
unzip my-erp-analysis.zip -d ~/.openclaw/skills/          # → ~/.openclaw/skills/my-erp-analysis/
```

加 `--global` 安到 `~/.openclaw/skills`（多 workspace 共用），預設裝在當前
workspace 的 `<workspace>/skills/`。

OpenClaw 載入 skill 的搜尋路徑優先序：
`<workspace>/skills` → `<workspace>/.agents/skills` → `~/.agents/skills`
→ `~/.openclaw/skills` → bundled → `skills.load.extraDirs`

## 用法

裝完直接用中文或英文問 ERP 相關問題，agent 會自動觸發 skill：

- 「H100 為什麼這幾個月在賠錢？」
- 「祥豐 PC 還跟我們有往來嗎？」
- 「現在有哪些客戶該優先催收？」
- 「過去 12 個月誰是 top 業務員？」

Skill 預設用 SQL 查 `{baseDir}/seed.db`（隨 skill 一起部署、不必另起服務）。
3 題完整 trace 範例見 `examples.md`。

## 檔案結構

```
my-erp-analysis/
├── SKILL.md         入口（frontmatter + 鐵則 + decision tree）
├── schema.md        SQL/HTTP cheatsheet + computed-field 陷阱 + join 範本
├── examples.md      3 題完整 Q→SQL→A trace
├── seed.db          SQLite 資料庫（~3MB，18 月 demo 資料）
└── README.md        本檔
```

## 進階：搭配 backend 跑制式報表（選用）

`seed.db` 純 SQL 已能答 95% 的題。若要用 HTTP API 拿封裝過的報表
（已做稅務拆分、aging 桶、毛利歸因），在 my_erp repo 跑：

```bash
cd backend
DATABASE_URL=sqlite:///../seed/skills/my-erp-analysis/seed.db \
  ./venv/bin/uvicorn app.main:app --port 8000
```

Skill 偵測到 `localhost:8000` 可達時會自動用 HTTP，否則 fallback 到 SQL。
HTTP endpoint 清單見 `schema.md` 第 5 節。

## 更新 seed.db

回 my_erp repo 重生資料：

```bash
cd backend && python -m app.scripts.seed     # 初始化空 DB
cd .. && python -m seed.seed --reset         # 跑 6 步驟產生 18 月資料
python -m seed.scripts.verify                # 11 條 KPI 全綠才算 OK
cp backend/seed.db seed/skills/my-erp-analysis/seed.db   # 同步進 skill
```

`seed.db` 不在 git 裡，所以重生後別忘了**重打包攜帶包 zip**（情境 2 部署要用）：

```bash
cd seed/skills
rm -f my-erp-analysis.zip
zip -r my-erp-analysis.zip my-erp-analysis \
  -x '*/storylines.md' '*/__pycache__/*'    # storylines.md 已併入 schema/examples，不收
```
