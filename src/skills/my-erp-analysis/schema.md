# Schema & Query Cheatsheet

`my_erp` 的表結構、查詢眉角、HTTP endpoint 對照表。需要寫 SQL 或挑
endpoint 時 Read 這份。完整 schema 用 `sqlite3 {baseDir}/seed.db ".schema <table>"`
撈，本檔只列 demo 用得到的部分。

---

## 1. 核心表（10 張）

### `customers` — 客戶
| 欄位 | 型別 | 備註 |
|---|---|---|
| `id` | int PK | |
| `name` | str | 公司全名（中文）|
| `payment_terms_days` | int | 付款條件天數（30 / 45 / 60；0 = 現款）|
| `capital` | Decimal(14,2) | 資本額 NTD，nullable |
| `is_active` | bool | |

### `sales_orders` — 銷售單 SO（核心交易表）
| 欄位 | 備註 |
|---|---|
| `id`, `so_number` (e.g. `SO-20250318-0042`) | 編號 prefix = ordered_at 日期 |
| `customer_id` → customers | |
| `salesperson_id` → users | **業績歸屬**（跟 created_by_id 分開）|
| `created_by_id` → users | 實際建單者 |
| `status` | `draft` / `confirmed` / `cancelled` |
| `total_amount` | Decimal(14,2) — header 合計 |
| `is_tax_inclusive` | bool — true 表示 unit_price 已含稅 |
| `ordered_at` | DateTime — 下單時間 |
| `confirmed_at` | DateTime nullable — 確認時間（status=confirmed 才有）|

**分析時幾乎一律 `WHERE status='confirmed'`**。draft 是還沒成立的單、
cancelled 是取消的。

### `sales_order_items` — 銷售單明細
| 欄位 | 備註 |
|---|---|
| `sales_order_id` → sales_orders | |
| `product_id` → products | |
| `quantity` | int |
| `unit_price` | Decimal(12,2) — 客戶售價 |
| `unit_cost` | Decimal(12,2) **nullable** — 🔥 **成本快照**，見下方陷阱 |
| `subtotal` | Decimal(14,2) — `quantity * unit_price` |

### `purchase_orders` — 採購單 PO
| 欄位 | 備註 |
|---|---|
| `id`, `po_number` (e.g. `PO-20250115-0003`) | |
| `supplier_id` → suppliers | |
| `status` | `draft` / `received` / `cancelled` |
| `total_amount`, `is_tax_inclusive` | |
| `ordered_at`, `received_at` | received_at 才是進貨日 |

**分析時用 `WHERE status='received'`**。

### `purchase_order_items` — 採購明細
`purchase_order_id`, `product_id`, `quantity`, `unit_cost`, `subtotal`。
PO receive 時 `product.cost_price` 會被更新成此 PO 的 unit_cost（最新成本）。

### `products` — 商品
| 欄位 | 備註 |
|---|---|
| `sku` (e.g. `DC-H100-80`, `NV-5070`, `SVR-DELL-XE9680`) | |
| `name`, `unit_price`, `cost_price` | cost_price = 最新一次進貨成本 |
| `stock_quantity` | int — 當前庫存（永遠是「現在」的快照、不是歷史）|
| `low_stock_threshold` | int — 0 表示不警示 |
| `category_id` → categories | |

### `accounts_receivable` — 應收帳款 AR
| 欄位 | 備註 |
|---|---|
| `ar_number` (e.g. `AR-20250318-0042`) | |
| `sales_order_id` → sales_orders (UNIQUE — 一張 SO 對一筆 AR) | |
| `customer_id` | |
| `amount_untaxed`, `tax_amount`, `amount_total` | 三者必滿足 untaxed+tax=total |
| `paid_amount` | Decimal(14,2) — 累計已收 |
| `status` | `open` / `partial` / `paid` / `voided` |
| `issued_at` (DateTime), `due_date` (Date) | |

**SO confirm 時自動建 AR**。`balance = amount_total - paid_amount`（SQL
要自己算、沒有實體欄位）。

### `accounts_payable` — 應付帳款 AP
鏡像 AR：`ap_number`, `purchase_order_id` (UNIQUE), `supplier_id`,
`amount_untaxed/tax_amount/amount_total/paid_amount`, `status`,
`issued_at`, `due_date`。PO receive 時自動建。

### `ar_payments` — AR 收款明細（append-only）
| 欄位 | 備註 |
|---|---|
| `payment_number` (e.g. `REC-20250927-0003`) | prefix 用 paid_at |
| `accounts_receivable_id` | |
| `amount`, `method` (cash/bank_transfer/check/other) | |
| `paid_at` (DateTime) | 實際收款日 |
| `voided_at`, `voided_by_id`, `void_reason` | nullable — 作廢欄位 |

**作廢的紀錄不會刪除**，要在 query 加 `WHERE voided_at IS NULL` 排除。

### `stock_adjustments` — 盤點 / 庫存調整
| 欄位 | 備註 |
|---|---|
| `adjustment_number` (e.g. `ADJ-20260411-0001`) | |
| `product_id` | |
| `before_qty`, `change_qty`, `after_qty` | 數學一致 + change_qty ≠ 0 |
| `reason` | `surplus` / `shortage` / `scrap` / `other` |
| `adjusted_at` | 盤點日 |

Append-only、不能編輯刪除。

---

## 2. 輔助表（4 張）

- `ap_payments` — AP 付款，跟 ar_payments 同結構
- `users` — 員工帳號（含業務員）。`username`, `full_name`, `role_id`, `is_active`
- `roles` — 4 角色：`admin` / `manager` / `sales` / `warehouse`
- `employees` — HR 表，跟 users 是 1:1 nullable FK。`department`, `title`, `hire_date`, `termination_date`, `base_salary`
- `categories` — 商品分類。本資料庫 5 類：`GPU_CONSUMER` / `GPU_WORKSTATION` / `GPU_DATACENTER` / `AI_SERVER` / `GPU_AMD`
- `suppliers` — 6 家原廠：NVIDIA / AMD / INTEL / SMC / DELL / HPE

---

## 3. Computed-field 陷阱 ⚠️

這些欄位**沒有直接存在 DB**，SQL 要自己算：

1. **毛利 (gross profit / margin)**
   ```sql
   -- 單品毛利
   (soi.unit_price - soi.unit_cost) * soi.quantity AS gross_profit
   -- 毛利率
   ((soi.unit_price - soi.unit_cost) / soi.unit_price) * 100 AS margin_rate_pct
   ```
   - 只有 `status='confirmed'` 的 SO，其 `unit_cost` 才非 NULL
   - **`unit_cost` 是 confirm 當下的 snapshot**，不會跟著 `products.cost_price` 漲跌。所以做歷史毛利分析時要用 `soi.unit_cost`，不要用 `products.cost_price`（後者只是最新進價）。
   - 若要算「整張 SO 的整體毛利率」必須先 sum subtotal 跟 sum (unit_cost*qty) 再相除，不要平均 row 級的 margin_rate。

2. **AR / AP balance**（餘額）
   ```sql
   ar.amount_total - ar.paid_amount AS balance
   ```

3. **AR 是否逾期 (`is_overdue`)**
   ```sql
   ar.due_date < DATE('2026-05-22')
     AND ar.status NOT IN ('paid', 'voided')
   ```
   **今天日期硬編 2026-05-22**，不要用 `DATE('now')`（demo 用固定日期）。

4. **AR aging 桶（逾期天數）**
   ```sql
   CASE
     WHEN ar.due_date >= DATE('2026-05-22') THEN 'not_due'
     WHEN JULIANDAY('2026-05-22') - JULIANDAY(ar.due_date) <= 30  THEN 'd1_30'
     WHEN JULIANDAY('2026-05-22') - JULIANDAY(ar.due_date) <= 60  THEN 'd31_60'
     WHEN JULIANDAY('2026-05-22') - JULIANDAY(ar.due_date) <= 90  THEN 'd61_90'
     ELSE 'd90_plus'
   END AS bucket
   ```
   排除 `status IN ('paid','voided')`。或直接用 HTTP endpoint。

5. **付款狀況 (有效收款，排除作廢)**
   ```sql
   SELECT SUM(amount) FROM ar_payments
   WHERE accounts_receivable_id = ? AND voided_at IS NULL
   ```

6. **「業務員業績」= confirmed SO 的 total_amount**，記得歸到
   `salesperson_id` 不是 `created_by_id`。

---

## 4. 常用 Join 範本（5 個）

### a. 客戶月度營收 + 毛利
```sql
SELECT
  c.name AS customer,
  STRFTIME('%Y-%m', so.confirmed_at) AS month,
  SUM(soi.subtotal) AS revenue,
  SUM((soi.unit_price - soi.unit_cost) * soi.quantity) AS gross_profit,
  ROUND(
    SUM((soi.unit_price - soi.unit_cost) * soi.quantity) * 100.0
    / NULLIF(SUM(soi.subtotal), 0), 2
  ) AS margin_rate_pct
FROM sales_orders so
JOIN sales_order_items soi ON soi.sales_order_id = so.id
JOIN customers c ON c.id = so.customer_id
WHERE so.status = 'confirmed'
GROUP BY c.id, month
ORDER BY month, revenue DESC;
```

### b. SKU 月度毛利趨勢（用來看 H100 / NV-5070 cost hike 戲劇）
```sql
SELECT
  p.sku,
  STRFTIME('%Y-%m', so.confirmed_at) AS month,
  SUM(soi.quantity) AS qty,
  ROUND(AVG(soi.unit_price), 0) AS avg_price,
  ROUND(AVG(soi.unit_cost), 0) AS avg_cost,
  ROUND((AVG(soi.unit_price) - AVG(soi.unit_cost)) * 100.0 / NULLIF(AVG(soi.unit_price), 0), 2) AS margin_rate_pct
FROM sales_orders so
JOIN sales_order_items soi ON soi.sales_order_id = so.id
JOIN products p ON p.id = soi.product_id
WHERE so.status = 'confirmed'
  AND p.sku IN ('DC-H100-80','NV-5070','NV-5070TI')  -- 換成想看的 SKU
GROUP BY p.sku, month
ORDER BY p.sku, month;
```

### c. 業務員月度業績
```sql
SELECT
  u.full_name AS salesperson,
  r.name AS role,
  STRFTIME('%Y-%m', so.confirmed_at) AS month,
  COUNT(*) AS order_count,
  SUM(so.total_amount) AS revenue
FROM sales_orders so
JOIN users u ON u.id = so.salesperson_id
JOIN roles r ON r.id = u.role_id
WHERE so.status = 'confirmed'
GROUP BY u.id, month
ORDER BY month, revenue DESC;
```

### d. AR aging 分桶（如果不用 HTTP endpoint）
```sql
SELECT
  c.name AS customer,
  CASE
    WHEN ar.due_date >= DATE('2026-05-22') THEN 'not_due'
    WHEN JULIANDAY('2026-05-22') - JULIANDAY(ar.due_date) <= 30  THEN 'd1_30'
    WHEN JULIANDAY('2026-05-22') - JULIANDAY(ar.due_date) <= 60  THEN 'd31_60'
    WHEN JULIANDAY('2026-05-22') - JULIANDAY(ar.due_date) <= 90  THEN 'd61_90'
    ELSE 'd90_plus'
  END AS bucket,
  COUNT(*) AS ar_count,
  SUM(ar.amount_total - ar.paid_amount) AS balance
FROM accounts_receivable ar
JOIN customers c ON c.id = ar.customer_id
WHERE ar.status NOT IN ('paid', 'voided')
GROUP BY c.id, bucket
ORDER BY balance DESC;
```

### e. 客戶付款率（多少 % AR 已收齊）
```sql
SELECT
  c.name AS customer,
  COUNT(*) AS total_ar,
  SUM(CASE WHEN ar.status = 'paid' THEN 1 ELSE 0 END) AS paid_count,
  ROUND(
    SUM(CASE WHEN ar.status = 'paid' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1
  ) AS paid_rate_pct
FROM accounts_receivable ar
JOIN customers c ON c.id = ar.customer_id
GROUP BY c.id
ORDER BY paid_rate_pct;
```

---

## 5. HTTP Endpoint 對照表

backend 已實作 8 個 curated endpoint，邏輯（稅務拆分、aging 桶、weighted
margin）都比手 SQL 穩。先選 HTTP，挑不到再走 SQL。

需要 token：`POST /api/v1/auth/login` form-encoded 帶 `username=admin&password=...`，
回應的 `access_token` 帶 `Authorization: Bearer ...` 進後續 call。

| 問題類型 | Endpoint | 關鍵 query 參數 |
|---|---|---|
| 商品毛利排行 | `GET /api/v1/analytics/margin/by-product` | `start_date`, `end_date`, `sort_by` (margin_rate/revenue/gross_profit/quantity), `top` |
| 客戶毛利排行 | `GET /api/v1/analytics/margin/by-customer` | 同上 |
| 月度毛利趨勢 | `GET /api/v1/analytics/margin/trend` | `months` (預設 12) |
| 庫存月報 | `GET /api/v1/inventory/monthly-report` | `year`, `month` |
| 業務員月報 | `GET /api/v1/inventory/salesperson-report` | `year`, `month` |
| AR 帳齡 | `GET /api/v1/accounts-receivable/aging` | `as_of` (預設 today) |
| AP 帳齡 | `GET /api/v1/accounts-payable/aging` | `as_of` |
| 首頁 KPI 摘要 | `GET /api/v1/dashboard/summary` | — |

### 決策準則（SQL vs HTTP）

- **制式報表**（毛利、aging、月報、業務員月報）→ HTTP，邏輯不必自己 reimplement
- **自由探索 / 跨表 / 任意組合 / 多月趨勢**（趨勢 trend endpoint 雖在但只回 12 月、要看 SKU 級 18 月趨勢就走 SQL）→ SQL
- **單筆 detail**（查特定 SO/AR/客戶資訊）→ HTTP 或 SQL 都可，HTTP 較人類可讀

### Response shape 提醒

- 不確定欄位名先 `curl ... | python -m json.tool | head` 看一眼
- `margin/trend` 的 row 用 `year` + `month` 兩個 int 欄位（不是 'YYYY-MM' string）
- `salesperson-report` 的 row 用 `full_name`（不是 `salesperson_name`）
- 金額欄位都是 Decimal 字串（`"603132511.00"`）、要 `float()` 才能算術
- `aging` endpoint 的 `buckets` 是物件，key 是 `not_due/d1_30/d31_60/d61_90/d90_plus/total`

### 範例：login 拿 token + call endpoint
```bash
# 1. login
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -d "username=admin&password=ChangeMe!2026" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  | python -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# 2. call API
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8000/api/v1/analytics/margin/by-customer?top=10&sort_by=margin_rate" \
  | python -m json.tool
```

---

## 6. 精度 / 格式注意

- 金額：Decimal(12,2) 或 (14,2)，回答時加千位逗號 + NT$（例 `NT$ 1,234,567`）
- 數量：integer
- 毛利率：算到小數 2 位（13.32%）
- 日期：今天硬編 `2026-05-22`、時間窗口 `2024-12-01` ~ `2026-05-31`
- 編號 prefix 是 backdated 日期（不是建檔當天），可以靠 prefix 快速找特定月份的單
