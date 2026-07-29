# Few-shot Q&A traces

三個完整 demo trace，示範 SKILL.md 的回答結構與工具使用方式。其他問題
依樣畫葫蘆。

每題格式：
- **Q**：使用者問題
- **思考**：拆出要查什麼、用什麼工具
- **指令**：實際 exec 的命令（SQL 或 curl）
- **資料**：預期輸出摘要
- **Agent 回答**：交付給老闆看的最終答案

## 執行與判讀原則

- 範例中的數字必須能由隨附的 `seed.db` 重算；若資料庫更新，以實際查詢
  結果為準，不沿用舊範例數字。
- 若環境沒有 `sqlite3` CLI（例如部分 Windows Codex 環境），可用 Node.js
  內建的 `node:sqlite` 以唯讀模式執行同一段 SQL。不得因工具不同而改寫
  資料或啟動寫入權限。
- 嚴格區分三件事：資料庫可證明的事實、根據事實提出的管理假設，以及
  資料庫無法回答的未知。不得把假設寫成已證實原因。

---

## 範例 1：H100 為何 2024-12 ~ 2025-09 在賠錢賣？

> Q（user）：「2025 上半年 H100 銷售很好，為什麼毛利反而是負的？2025-10 怎麼回穩的？」

**思考**：
- 要看 `DC-H100-80` 月度的 `unit_price` vs `unit_cost`，畫出 18 月走勢
- 自訂 SKU + 自訂月份範圍 → 走 SQL（HTTP `/margin/trend` 只回 12 月、且不分 SKU）
- 跨多月、要做差異分析 → 用 `schema.md` 第 4 節 join 範本 b

**指令**：
```bash
sqlite3 {baseDir}/seed.db <<'SQL'
SELECT
  STRFTIME('%Y-%m', so.confirmed_at) AS month,
  SUM(soi.quantity) AS qty,
  ROUND(SUM(soi.subtotal) * 1.0 / SUM(soi.quantity), 0) AS avg_price,
  ROUND(SUM(soi.unit_cost * soi.quantity) * 1.0
        / SUM(soi.quantity), 0) AS avg_cost,
  ROUND((SUM(soi.subtotal) - SUM(soi.unit_cost * soi.quantity)) * 100.0
        / NULLIF(SUM(soi.subtotal), 0), 2) AS margin_pct
FROM sales_orders so
JOIN sales_order_items soi ON soi.sales_order_id = so.id
JOIN products p ON p.id = soi.product_id
WHERE so.status = 'confirmed' AND p.sku = 'DC-H100-80'
GROUP BY month ORDER BY month;
SQL
```

**資料**（實測，15 個月有出貨）：
| month | qty | avg_price | avg_cost | margin_pct |
|---|---|---|---|---|
| 2025-01 | 1 | 915,600 | 1,050,000 | **-14.68** |
| 2025-04 | 5 | 1,016,400 | 1,050,000 | **-3.31** |
| 2025-07 | 5 | 974,400 | 1,050,000 | **-7.76** |
| 2025-09 | 1 | 991,200 | 1,050,000 | **-5.93** |
| 2025-10 | 2 | 953,400 | 840,000  | **+11.89** |
| 2026-01 | 1 | 991,200 | 840,000  | **+15.25** |
| 2026-05 | 2 | 978,600 | 840,000  | **+14.16** |

**Agent 回答**：

> **結論：`DC-H100-80` 在 2025-01 ~ 2025-09 共售出 21 張，加權毛利率
> -8.70%，累計毛損 NT$ 1,764,000；2025-10 之後共售出 9 張，加權毛利率
> 回升至 +11.76%，累計毛利 NT$ 1,008,000。資料顯示主要轉折來自成本下降，
> 不是售價上升。**
>
> | 期間 | 銷量 | 加權平均售價 | 加權平均成本 | 加權毛利率 | 毛利 |
> |---|---:|---:|---:|---:|---:|
> | 2025-01 ~ 2025-09 | 21 | NT$ 966,000 | NT$ 1,050,000 | **-8.70%** | **-NT$ 1,764,000** |
> | 2025-10 ~ 2026-05 | 9 | NT$ 952,000 | NT$ 840,000 | **+11.76%** | **NT$ 1,008,000** |
>
> **資料支持的解讀**：2025-10 後單位成本由 NT$ 1,050,000 降至
> NT$ 840,000，下降 20%；同期加權平均售價由 NT$ 966,000 降至
> NT$ 952,000，並沒有漲價。因此毛利回升主要由成本下降解釋。立通科技是
> H100 最大買家，共買 12 張、營收 NT$ 11,600,400，該客戶這個 SKU 的
> 累計毛損為 NT$ 999,600。
>
> **未知**：ERP 可以證明成本、售價與毛利的變化，但無法單獨證明成本下降
> 是因為市場供需、原廠政策或其他原因；若要寫出外部原因，必須補採購備註、
> 供應商文件或外部來源。
>
> **建議管理行動**：由產品、採購與業務主管檢查高成本變動 SKU 的報價規則，
> 評估是否建立「售價低於成本或毛利門檻時需人工核准」的控制點。Agent
> 只能提出異常與建議，不得自行更改價單或阻擋訂單。

---

## 範例 2：祥豐電腦最近怎麼了？

> Q：「祥豐電腦最近還好嗎？我感覺他們最近單變少了。」

**思考**：
- 看祥豐月度訂單數 + 月度付款率（兩個變化都要看）
- 客戶名「祥豐電腦」，先找 customer_id；或直接 join 用 name
- 月度訂單 → SQL；付款狀況 → 也走 SQL（HTTP 沒有 per-customer payment-rate）

**指令**：
```bash
sqlite3 {baseDir}/seed.db <<'SQL'
-- 月度訂單數 + 營收
SELECT STRFTIME('%Y-%m', so.confirmed_at) AS month,
       COUNT(*) AS so_count,
       SUM(so.total_amount) AS revenue
FROM sales_orders so JOIN customers c ON c.id = so.customer_id
WHERE c.name LIKE '祥豐%' AND so.status='confirmed'
GROUP BY month ORDER BY month;

-- 月度付款率
SELECT STRFTIME('%Y-%m', ar.issued_at) AS month,
       COUNT(*) AS ar_total,
       SUM(CASE WHEN ar.status='paid' THEN 1 ELSE 0 END) AS paid,
       ROUND(SUM(CASE WHEN ar.status='paid' THEN 1 ELSE 0 END)*100.0/COUNT(*),0) AS paid_pct
FROM accounts_receivable ar JOIN customers c ON c.id = ar.customer_id
WHERE c.name LIKE '祥豐%' GROUP BY month ORDER BY month;
SQL
```

**資料**（實測，17 個月）：
| month | so_count | revenue |
|---|---|---|
| 2025-11 | 8 | 2,198,828 |
| 2025-12 | 9 | 2,257,295 |
| 2026-01 | 5 | 825,390 |
| 2026-02 | 5 | 951,510 |
| **2026-03** | **1** | **94,653** |
| **2026-04** | **1** | **237,800** |
| **2026-05** | — | — (無出貨) |

| month | ar_total | paid | paid_pct |
|---|---|---|---|
| 2025-12 | 9 | 9 | 100 |
| 2026-01 | 5 | 5 | 100 |
| 2026-02 | 5 | 3 | 60 |
| **2026-03** | **1** | **0** | **0** |

**Agent 回答**：

> **結論：祥豐電腦從 2026-03 起出現高風險訊號。訂單由 2026-02 的 5 張
> 降至 3 月與 4 月各 1 張，3 月營收較 2 月下降約 90%；同時 3 月新增的
> 1 筆 AR 尚未付款。這些資料支持「客戶關係可能惡化」的假設，但不能直接
> 證明客戶已轉向競爭對手或準備終止合作。**
>
> | 指標 | 2026-02 | 2026-03 | 2026-04 | 2026-05 |
> |---|---|---|---|---|
> | 下單數 | 5 | **1** | 1 | 0 |
> | 月營收 | NT$ 951,510 | NT$ 94,653 | NT$ 237,800 | NT$ 0 |
> | AR 付款率 | 60% | **0%** | — | — |
>
> 兩個信號同時出現：(a) 2026-02 還在 60% 付款率，到 2026-03 整月只有
> 1 張單且付款率歸 0；(b) 單量從月均 5-9 張掉到 1 張且持續到 4-5 月。
> 單一信號可能是淡季或臨時問題，兩個同時出現值得提高人工確認優先度。
>
> **未知**：資料庫沒有競爭對手、客戶專案狀態或業務訪談紀錄，無法判斷
> 訂單下降的真正原因。
>
> **建議管理行動**：
> 1. 由負責業務拜訪客戶，確認專案、預算與合作狀況。
> 2. 祥豐目前有 14 筆 AR 未結清，其中 11 筆逾期 90 天以上，餘額
>    NT$ 3,056,982；由業務主管與財務共同評估是否暫停信用或改為現款。
> 3. 一至兩個月後再追蹤訂單數、營收與回款，不讓 AI 自行調整信用條件。

---

## 範例 3：應該找誰催收？

> Q：「老闆要我列出該優先催收的客戶。」

**思考**：
- 若 backend 已啟動，AR aging 是制式報表，可優先使用 HTTP endpoint。
- 課堂只提供 `seed.db` 或 backend 未啟動時，依 `schema.md` 的固定日期與
  排除規則執行唯讀 SQL，結果必須相同。

**指令**：
```bash
sqlite3 {baseDir}/seed.db <<'SQL'
SELECT
  c.name AS customer,
  COUNT(*) AS d90_plus_count,
  ROUND(SUM(ar.amount_total - ar.paid_amount), 2) AS d90_plus_balance
FROM accounts_receivable ar
JOIN customers c ON c.id = ar.customer_id
WHERE ar.status NOT IN ('paid', 'voided')
  AND ar.due_date < DATE('2026-05-22', '-90 days')
GROUP BY c.id
ORDER BY d90_plus_balance DESC;
SQL
```

**資料**（實測）：
- d90+ 桶全公司共 22 筆，餘額 NT$ 4,494,959.15
- 集中度：祥豐 NT$ 3,056,982.05 + 旭光 NT$ 1,010,948.40 +
  諾奇 NT$ 359,551.50 + 豪翔 NT$ 67,477.20，集中於 4 家

**Agent 回答**：

> **結論：建議優先催收祥豐電腦與旭光科技，合計逾期 90 天以上 20 筆、
> NT$ 4,068,000，佔全公司 d90+ 應收 91%。**
>
> | 優先 | 客戶 | d90+ 筆數 | d90+ 餘額 | 對策 |
> |---|---|---|---|---|
> | 🔴 立即確認 | 祥豐電腦 | 11 | NT$ 3,056,982 | 業務確認客戶狀況；財務評估信用條件 |
> | 🔴 立即確認 | 旭光科技 | 9 | NT$ 1,010,948 | 財務確認催收紀錄與爭議，再決定催收層級 |
> | 🟡 個案確認 | 諾奇商業通路 | 1 | NT$ 359,552 | 檢查作廢收款與目前承諾付款日 |
> | 🟢 一般追蹤 | 豪翔電腦 | 1 | NT$ 67,477 | 金額較小，依既有催收流程處理 |
>
> 全公司 d90+ 帳齡 22 筆、餘額約 NT$ 4,494,959；祥豐與旭光合計占約
> 91%。這能支持「先集中查核兩戶」的排序，但不能單靠帳齡決定停信用、
> 發函或法律行動。
>
> **建議管理流程**：
> 1. 財務重算明細並排除爭議款、作廢款與已約定付款案件。
> 2. 業務確認祥豐與旭光的客戶狀況及付款承諾。
> 3. 再由財務主管依授權規則決定提醒、電話催收、正式函件或信用調整。
> 4. Agent 僅提供排序、證據與草稿，不得自行聯繫客戶或變更信用條件。

---

## 套用到其他題目

剩下 4 種典型題目都可套這個 shape：

| 題目 | 主要工具 |
|---|---|
| 最賺錢客戶（暖身）| HTTP `/analytics/margin/by-customer?sort_by=gross_profit&top=10` |
| 哪些 SKU 該停售/重議價 | HTTP `/analytics/margin/by-product?sort_by=margin_rate` + 必要時 SQL 看趨勢 |
| 業務員加碼 / 該關注 | HTTP `/inventory/salesperson-report` (最近 2-3 個月) |
| 公司最大隱患（自由）| 綜合多個前面查詢的結果 |

不要硬找新 SQL；先想「這題能不能用 HTTP curated」、再想「能不能套上面 5
個 join 範本」、最後才寫新 SQL。
