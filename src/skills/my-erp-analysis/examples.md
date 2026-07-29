# Few-shot Q&A traces

三個完整 demo trace，示範 SKILL.md 的回答結構與工具使用方式。其他問題
依樣畫葫蘆。

每題格式：
- **Q**：使用者問題
- **思考**：拆出要查什麼、用什麼工具
- **指令**：實際 exec 的命令（SQL 或 curl）
- **資料**：預期輸出摘要
- **Agent 回答**：交付給老闆看的最終答案

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
  ROUND(AVG(soi.unit_price), 0) AS avg_price,
  ROUND(AVG(soi.unit_cost), 0)  AS avg_cost,
  ROUND((AVG(soi.unit_price) - AVG(soi.unit_cost)) * 100.0
        / NULLIF(AVG(soi.unit_price), 0), 2) AS margin_pct
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

> **結論：H100 在 2025-01 ~ 2025-09 我們是「虧錢賣」、毛利率介於 -3% 到
> -15% 之間，平均約 -9%。2025-10 起進價回穩 20%，毛利反彈到 +7% ~ +15%。**
>
> | 期間 | 平均售價 | 平均進價 | 毛利率 |
> |---|---|---|---|
> | 2025-01 ~ 2025-09 | ~NT$ 970,000 | NT$ 1,050,000 | **-3% 到 -15%** |
> | 2025-10 起至今 | ~NT$ 960,000 | NT$ 840,000 | **+7% 到 +15%** |
>
> 原因：進價在這 9 個月維持 NT$ 1,050,000（比 2025-10 之後高 25%），對
> 應 AI 熱潮供應緊；但我們對主要買家的售價沒跟著漲，於是每張平均賠約
> NT$ 80,000。額外做 customer + salesperson 拆分可看：立通科技在這段期
> 間累計買 ~NT$ 432M 的 H100、是第一大客戶卻是最虧的；業務員張俊宏因
> H100 訂單衝出全公司業績第一（~NT$ 203M），但屬於「業績衝、毛利沉」
> 型態。
>
> **建議**：未來原廠進價有大幅變動時，要同步檢視主要客戶價單；若客戶
> 無法接受漲價，至少要建立「進價成本紅線」自動擋下虧錢單。

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

> **結論：祥豐電腦從 2026-03 開始顯著流失，下單量掉 80%、營收幾乎歸零、
> 既有應收也停付。這不是單純少買，是客戶在收尾關係。**
>
> | 指標 | 2026-02 | 2026-03 | 2026-04 | 2026-05 |
> |---|---|---|---|---|
> | 下單數 | 5 | **1** | 1 | 0 |
> | 月營收 | NT$ 951,510 | NT$ 94,653 | NT$ 237,800 | NT$ 0 |
> | AR 付款率 | 60% | **0%** | — | — |
>
> 兩個信號同時出現：(a) 2026-02 還在 60% 付款率，到 2026-03 整月只有
> 1 張單且付款率歸 0；(b) 單量從月均 5-9 張掉到 1 張且持續到 4-5 月。
> 單一信號可能是淡季或臨時問題，兩個同時出現通常是客戶關係收尾。
>
> **建議**：
> 1. 短期：派業務拜訪確認原因（轉單到競爭對手？經營問題？）
> 2. 風險：祥豐目前還有 14 筆 AR 未結清、其中 11 筆已逾期 90+ 天、餘額
>    NT$ 3,057,000，建議**立即冷凍信用、改現款交易**
> 3. 預期 5 月底 RFM 會掉到最低分區段

---

## 範例 3：應該找誰催收？

> Q：「老闆要我列出該優先催收的客戶。」

**思考**：
- AR aging 是制式報表、邏輯複雜（5 個桶 + 排除 paid/voided）→ **直接走 HTTP**
- 不必自己寫 SQL

**指令**：
```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -d "username=admin&password=ChangeMe!2026" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  | python -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8000/api/v1/accounts-receivable/aging?as_of=2026-05-22" \
  | python -m json.tool
```

**資料**（實測，response 含 by-customer 分組 + totals）：
- d90+ 桶全公司餘額 NT$ 4,494,959
- 集中度：祥豐 3.06M + 旭光 1.01M + 諾奇 360k + 豪翔 67k = 100% 集中於 4 家

**Agent 回答**：

> **結論：建議優先催收祥豐電腦與旭光科技，合計逾期 90 天以上 20 筆、
> NT$ 4,068,000，佔全公司 d90+ 應收 91%。**
>
> | 優先 | 客戶 | d90+ 筆數 | d90+ 餘額 | 對策 |
> |---|---|---|---|---|
> | 🔴 立即 | 祥豐電腦 | 11 | NT$ 3,056,982 | **停止信用 + 派業務本週拜訪**（同時出現訂單暴跌 + 付款歸零兩個信號）|
> | 🔴 立即 | 旭光科技 | 9 | NT$ 1,010,948 | **法務發催款函**（拉 AR 看會發現約 27% 從未付款、屬頑固逾期型）|
> | 🟡 中 | 諾奇商業通路 | 1 | NT$ 359,551 | 注意已有 1 筆收款作廢紀錄，個案處理 |
> | 🟢 低 | 豪翔電腦 | 1 | NT$ 67,477 | 同上、金額小 |
>
> 全公司 d90+ 帳齡 22 筆、餘額 NT$ 4,495,000，集中度極高（兩戶 91%）。其
> 餘客戶 AR 健康 ── 大同雲端 109/109 全準時付款、AP 對供應商全準時，
> 可見「我們付供應商沒問題、客戶端 4 家在塞」。
>
> **建議流程**：
> 1. 本週發催款函給祥豐 + 旭光，要求 14 天內結清
> 2. 業務 next-day 拜訪祥豐確認流失原因
> 3. 祥豐若無付款計劃，下單一律要求現款交易
> 4. 諾奇 + 豪翔個案聯繫、追前次作廢原因

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
