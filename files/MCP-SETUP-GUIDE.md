# KLik Burger — Production MCP Ecosystem Setup Guide

## Folder Structure (New Files)

```
c:\fyp\
├── mcp-server.mjs              ← REPLACE existing file (root)
├── firestore.rules             ← REPLACE existing file (root)
├── .cursor/
│   └── mcp.json                ← REPLACE existing file
├── mcp/
│   ├── lib/
│   │   ├── collections.mjs     ← mirrors js/firebase/collections.js
│   │   ├── admin-init.mjs      ← mirrors scripts/lib/admin-init.mjs
│   │   ├── validators.mjs      ← input validation for all write tools
│   │   └── audit-logger.mjs    ← writes to pos_audit_logs
│   ├── middleware/
│   │   └── permission-gate.mjs ← tool-level RBAC
│   └── tools/
│       ├── read/index.mjs      ← 13 read tools
│       ├── write/index.mjs     ← 6 write tools
│       ├── admin/index.mjs     ← 5 admin tools
│       └── report/index.mjs    ← 4 report tools
└── scripts/
    └── test-mcp-tools.mjs      ← smoke test runner
```

## Step 1: Copy Files

Copy ALL files from this output into your project at `c:\fyp\`:

```bash
# Create the mcp/ directory structure
mkdir -p mcp/lib mcp/middleware mcp/tools/read mcp/tools/write mcp/tools/admin mcp/tools/report
```

## Step 2: Set Up Permission Level

Edit `.cursor/mcp.json` and set `MCP_PERMISSION_LEVEL` based on your needs:

| Level  | Can Do |
|--------|--------|
| `read` | Read all collections (safe, default) |
| `write` | + Create/update menu items, ingredients, purchases, orders |
| `admin` | + Delete docs, void receipts, close shifts, manage staff |
| `owner` | + Generate monthly reports, bulk operations |

## Step 3: Firebase Security Rules

Replace `firestore.rules` with the new production rules.

Deploy to Firebase:
```bash
npm run deploy:rules
# or
firebase deploy --only firestore:rules
```

**Important:** Test rules with Firebase emulator first!

## Step 4: Remove Hardcoded PIN (Security Fix)

In `js/pos-security-constants.js`, the manager PIN `"2580"` is exposed.
Now that `void_receipt` goes through MCP, you can:
1. Remove the PIN check from `voidReceiptInHub` in `js/pos-firestore-hub.js`
2. Replace with a server-side void via MCP tool

## Step 5: Test with Emulator

```bash
# Terminal 1: Start emulators
npm run dev

# Terminal 2: Run smoke tests
node scripts/test-mcp-tools.mjs
```

## Step 6: Start MCP Server

```bash
# Read-only (safe default)
MCP_PERMISSION_LEVEL=read node mcp-server.mjs

# Write access
MCP_PERMISSION_LEVEL=write GOOGLE_APPLICATION_CREDENTIALS=./firebase-service-account.json node mcp-server.mjs

# Full admin access (use with care)
MCP_PERMISSION_LEVEL=admin GOOGLE_APPLICATION_CREDENTIALS=./firebase-service-account.json node mcp-server.mjs
```

## All 28 Tools Reference

### Read Tools (always available)
| Tool | Description |
|------|-------------|
| `get_menu_items` | Filter by category, availability |
| `get_orders` | Filter by lifecycle, kitchen stage, shift, date |
| `get_order_by_id` | Single order + line items |
| `get_staff_list` | Filter by role, active status |
| `get_staff_by_id` | Single staff member |
| `get_sales_summary` | Revenue/COGS/profit aggregation |
| `get_ingredients` | Filter by category, low-stock flag |
| `get_inventory_status` | Full inventory with batches |
| `get_shifts` | Filter by status, date |
| `get_receipts` | Filter by void status, staff, date |
| `get_audit_logs` | Filter by action, source, date |
| `get_monthly_report` | Single month or list available months |
| `get_dashboard_summary` | Active shift + today's KPIs + low stock |

### Write Tools (level: write)
| Tool | Description |
|------|-------------|
| `update_menu_item` | Update price, availability, category |
| `update_ingredient` | Update name, unit, reorder level |
| `add_purchase` | Record purchase + create FIFO batch + update stock |
| `update_order_status` | Update kitchenStage or lifecycle |
| `create_document` | Generic create (whitelisted collections) |
| `update_document` | Generic update (whitelisted collections) |

### Admin Tools (level: admin)
| Tool | Description |
|------|-------------|
| `manage_staff` | Create / update / deactivate staff |
| `delete_document` | Hard-delete (financial collections protected) |
| `void_receipt` | Mark receipt voided + update linked order |
| `close_shift` | Force-close an open shift |
| `manage_inventory` | Stock adjustment with ledger entry |

### Report Tools (level: admin for generate, read for analytics)
| Tool | Description |
|------|-------------|
| `generate_monthly_report` | Aggregate + write to monthly_reports/{YYYY-MM} |
| `get_sales_analytics` | Hourly breakdown, payment methods, top items |
| `get_staff_performance` | Revenue/count per staff for date range |
| `get_cogs_report` | COGS ratio, per-item breakdown |

## Example AI Agent Prompts

```
"Show me today's dashboard summary"
→ calls get_dashboard_summary

"What ingredients are below reorder level?"
→ calls get_ingredients with lowStock:true

"Generate the monthly report for May 2025"
→ calls generate_monthly_report with yearMonth:"2025-05"

"Update the Big Burger price to RM 15.90"
→ calls get_menu_items to find ID, then update_menu_item

"We received 10kg of beef patties from supplier XYZ at RM 45/kg"
→ calls add_purchase with all details

"Void receipt RCP-0042, reason: customer complaint - wrong order"
→ calls void_receipt with receiptId and reason

"Show me staff performance for last month"
→ calls get_staff_performance with date range
```

## Security Notes

1. **Service account** (`firebase-service-account.json`) — never commit this; it's in `.gitignore`.
2. **MCP bypasses Firestore rules** — the permission-gate in `middleware/permission-gate.mjs` IS your security layer.
3. **Audit trail** — every write/admin action is logged to `pos_audit_logs` with `source: MCP_AGENT`.
4. **Protected collections** — `users`, `pos_meta`, `pos_sales_transactions`, `pos_receipts` can never be written via generic tools.
5. **Run MCP on admin machine only** — stdio transport means whoever runs the process has the configured level.
