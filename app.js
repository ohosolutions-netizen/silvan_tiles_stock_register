const APP_NAME = "silvan-tiles";

const REPORTS = {
  items: "Item_Report",
  openings: "ALL_OPENING_STOCK",
  warehouses: "Warehouse_Report",
  purchase: "API_PURCHASE_RECEIVE",
  sales: "API_SALES_INVOICES",
  creditNote: "API_CREDIT_NOTES",
  vendorCredit: "API_VENDOR_CREDITS",
  transferOut: "API_BRANCH_TRANSFER_OUT",
  transferIn: "API_BRANCH_TRANSFER_IN",
  reprocess: "API_REPROCESS",
  adjustment: "API_INVENTORY_ADJUSTMENT",
};

const COLUMNS = [
  "date",
  "billNumber",
  "party",
  "opStock",
  "purchase",
  "sales",
  "creditNote",
  "vendorCredit",
  "transOut",
  "transIn",
  "reprocessOut",
  "reprocessIn",
  "shortage",
  "surplus",
  "balance",
];

const MOVEMENT_FIELDS = [
  "purchase",
  "sales",
  "creditNote",
  "vendorCredit",
  "transOut",
  "transIn",
  "reprocessOut",
  "reprocessIn",
  "shortage",
  "surplus",
];

const els = {
  itemSearch: document.querySelector("#itemSearch"),
  itemSuggestions: document.querySelector("#itemSuggestions"),
  warehouseSelect: document.querySelector("#warehouseSelect"),
  fromDate: document.querySelector("#fromDate"),
  toDate: document.querySelector("#toDate"),
  loadMastersButton: document.querySelector("#loadMastersButton"),
  applyButton: document.querySelector("#applyButton"),
  exportButton: document.querySelector("#exportButton"),
  openingStock: document.querySelector("#openingStock"),
  totalInward: document.querySelector("#totalInward"),
  totalOutward: document.querySelector("#totalOutward"),
  closingBalance: document.querySelector("#closingBalance"),
  rangeLabel: document.querySelector("#rangeLabel"),
  loadStatus: document.querySelector("#loadStatus"),
  rowCount: document.querySelector("#rowCount"),
  registerBody: document.querySelector("#registerBody"),
};

const state = {
  creatorReady: false,
  items: [],
  warehouses: [],
  visibleRows: [],
  warnings: [],
  itemCount: 0,
  warehouseCount: 0,
  mastersLoaded: false,
  selectedItem: null,
};

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

function isEmbeddedInCreator() {
  return new URLSearchParams(window.location.search).has("serviceOrigin");
}

function dateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function cleanKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function displayValue(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(displayValue).filter(Boolean).join(", ");
  if (typeof value === "object") {
    return (
      value.display_value ||
      value.zc_display_value ||
      value.name ||
      value.Name ||
      value.value ||
      value.ID ||
      ""
    );
  }
  return String(value);
}

function recordIdValue(value) {
  if (value == null) return "";
  if (typeof value === "object") {
    return String(value.ID || value.id || value.value || value.record_id || "").trim();
  }
  return "";
}

function getField(record, candidates) {
  if (!record) return "";
  const wanted = candidates.map(cleanKey);
  const exactKey = Object.keys(record).find((key) => wanted.includes(cleanKey(key)));
  if (exactKey) return record[exactKey];

  const containsKey = Object.keys(record).find((key) => {
    const normalized = cleanKey(key);
    return wanted.some((candidate) => normalized.includes(candidate) || candidate.includes(normalized));
  });

  return containsKey ? record[containsKey] : "";
}

function getText(record, candidates) {
  return displayValue(getField(record, candidates)).trim();
}

function getNumber(record, candidates) {
  const raw = displayValue(getField(record, candidates));
  const value = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(value) ? value : 0;
}

function getNestedNumber(record, candidates) {
  const wanted = candidates.map(cleanKey);
  let total = 0;

  function visit(value, key = "") {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, key));
      return;
    }
    if (typeof value === "object") {
      Object.entries(value).forEach(([childKey, childValue]) => visit(childValue, childKey));
      return;
    }

    const normalizedKey = cleanKey(key);
    const keyMatches = wanted.some(
      (candidate) => normalizedKey === candidate || normalizedKey.includes(candidate),
    );
    if (!keyMatches) return;

    const number = Number(String(value).replace(/,/g, ""));
    if (Number.isFinite(number)) total += number;
  }

  visit(record);
  return total;
}

function getTrailingNumber(record, candidates) {
  const text = getText(record, candidates);
  const matches = text.match(/-?\d+(?:\.\d+)?/g);
  if (!matches?.length) return 0;
  const value = Number(matches.at(-1));
  return Number.isFinite(value) ? value : 0;
}

function getQuantity(record, directCandidates, displayCandidates = []) {
  return (
    getNumber(record, directCandidates) ||
    getNestedNumber(record, directCandidates) ||
    getTrailingNumber(record, displayCandidates)
  );
}

function fallbackLabel(record) {
  return Object.entries(record || {})
    .filter(([key]) => cleanKey(key) !== "id")
    .map(([, value]) => displayValue(value).trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" - ");
}

function normalizeDateValue(value) {
  const text = displayValue(value).trim();
  if (!text) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const dmy = text.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,}|\d{1,2})[-/ ](\d{2,4})$/);
  if (dmy) {
    const [, day, monthRaw, yearRaw] = dmy;
    const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const month = Number(monthRaw) || monthNames.indexOf(monthRaw.slice(0, 3).toLowerCase()) + 1;
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function getDate(record, candidates) {
  return normalizeDateValue(getField(record, candidates));
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function formatQty(value) {
  return Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  });
}

function movementIn(row) {
  return row.purchase + row.creditNote + row.transIn + row.reprocessOut + row.surplus;
}

function movementOut(row) {
  return row.sales + row.vendorCredit + row.transOut + row.reprocessIn + row.shortage;
}

function hasStockMovement(row) {
  return MOVEMENT_FIELDS.some((field) => Number(row[field] || 0) !== 0);
}

function calculateRows(openingStock, movements) {
  let balance = openingStock;

  return movements.map((movement) => {
    const opStock = balance;
    balance = opStock + movementIn(movement) - movementOut(movement);
    return { ...movement, opStock, balance };
  });
}

function blankMovement(overrides) {
  return {
    date: "",
    billNumber: "",
    party: "",
    purchase: 0,
    sales: 0,
    creditNote: 0,
    vendorCredit: 0,
    transOut: 0,
    transIn: 0,
    reprocessOut: 0,
    reprocessIn: 0,
    shortage: 0,
    surplus: 0,
    ...overrides,
  };
}

function itemKeyFromRecord(record) {
  return cleanKey(
    [
      getText(record, ["ITEMCODE", "ITEM CODE", "Item Code", "Item_Code", "Code"]),
      getText(record, ["ITEM NAME", "Item Name", "Item", "Product", "Product Name"]),
    ]
      .filter(Boolean)
      .join("|"),
  );
}

function itemCodeFromRecord(record) {
  return cleanKey(getText(record, ["ITEMCODE", "ITEM CODE", "Item Code", "Item_Code", "Code"]));
}

function itemNameFromRecord(record, candidates = []) {
  return cleanKey(
    getText(record, [
      ...candidates,
      "ITEM NAME",
      "Item Name",
      "Item",
      "ITEM",
      "Product",
      "Product Name",
    ]),
  );
}

function itemIdFromRecord(record, candidates = []) {
  const value = getField(record, [
    ...candidates,
    "ITEM NAME",
    "Item Name",
    "Item",
    "ITEM",
    "Product",
    "Product Name",
  ]);
  return cleanKey(recordIdValue(value));
}

function warehouseKeyFromRecord(record, candidates = ["WAREHOUSE", "Warehouse", "Warehouse ID"]) {
  return cleanKey(getText(record, candidates));
}

function matchesItem(record, filters, candidates) {
  const selectedId = cleanKey(filters.itemId);
  const selectedCode = cleanKey(filters.itemCode);
  const selectedName = cleanKey(filters.itemRawName || filters.itemName);
  const selectedKey = cleanKey(filters.itemKey);
  if (!selectedCode && !selectedName && !selectedKey) return true;

  const recordItemId = itemIdFromRecord(record, candidates);
  if (selectedId && recordItemId) return recordItemId === selectedId;

  const recordCode = itemCodeFromRecord(record);
  if (selectedCode && recordCode) return recordCode === selectedCode;

  const candidateName = itemNameFromRecord(record, candidates);
  if (selectedName && candidateName) return candidateName === selectedName;

  const candidateValue = cleanKey(candidates.map((candidate) => getText(record, [candidate])).filter(Boolean).join("|"));
  return Boolean(selectedKey && candidateValue && candidateValue === selectedKey);
}

function matchesWarehouse(record, filters, candidates = ["WAREHOUSE", "Warehouse", "Warehouse ID"]) {
  const selected = cleanKey(filters.warehouseKey || filters.warehouseCode || filters.warehouseName);
  if (!selected) return true;
  const value = warehouseKeyFromRecord(record, candidates);
  return value.includes(selected) || selected.includes(value);
}

function inDateRange(date, fromDate, toDate) {
  return date && date >= fromDate && date <= toDate;
}

function beforeDate(date, targetDate) {
  return date && date < targetDate;
}

function combineText(...values) {
  return values.map((value) => displayValue(value).trim()).filter(Boolean).join(" - ");
}

async function creatorGetRecords(reportName, options = {}) {
  if (!state.creatorReady || !window.ZOHO?.CREATOR?.DATA?.getRecords) {
    return [];
  }

  const records = [];
  let recordCursor = "";

  do {
    const config = {
      report_name: reportName,
      max_records: 1000,
      field_config: options.fieldConfig || "all",
    };

    if (options.criteria) config.criteria = options.criteria;
    if (recordCursor) config.record_cursor = recordCursor;

    let response;
    try {
      response = await ZOHO.CREATOR.DATA.getRecords(config);
    } catch (error) {
      const detail = error?.message || JSON.stringify(error) || String(error);
      throw new Error(`${reportName}: ${detail}`);
    }

    const responseCode = String(response?.code || "");
    if (responseCode !== "3000") {
      const detail = response?.message || response?.status || JSON.stringify(response) || "Unable to fetch records";
      const noRecordMessage = cleanKey(detail).includes("norecord");
      if (responseCode === "3100" || noRecordMessage) return records;
      throw new Error(`${reportName}: ${detail}`);
    }

    records.push(...(response.data || []));
    recordCursor = response.record_cursor || response.result?.record_cursor || response.info?.record_cursor || "";
  } while (recordCursor);

  return records;
}

async function creatorGetRecordsSafe(reportName, options = {}) {
  try {
    return await creatorGetRecords(reportName, options);
  } catch (error) {
    const detail = error?.message || JSON.stringify(error) || String(error);
    state.warnings.push(detail);
    return [];
  }
}

async function fetchItems() {
  const records = await creatorGetRecordsSafe(REPORTS.items);
  return records
    .map((record) => {
      const code = getText(record, ["ITEMCODE", "ITEM CODE", "Item Code", "Item_Code", "Code"]);
      const name = getText(record, ["ITEM NAME", "Item Name", "Item", "Product Name", "Name"]);
      const label = combineText(code, name) || fallbackLabel(record) || displayValue(record.ID);
      return {
        value: itemKeyFromRecord(record) || cleanKey(label),
        label,
        code,
        name,
        id: displayValue(record.ID || record.ID1 || record.ID_),
      };
    })
    .filter((item) => item.label)
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function fetchWarehouses() {
  const records = await creatorGetRecordsSafe(REPORTS.warehouses);
  return records
    .map((record) => {
      const code = getText(record, ["WAREHOUSE CODE", "Warehouse Code", "Code"]);
      const name = getText(record, ["WAREHOUSE", "Warehouse", "WAREHOUSE NAME", "Warehouse Name", "Name"]);
      const label = combineText(code, name) || fallbackLabel(record) || displayValue(record.ID);
      return {
        value: cleanKey(combineText(code, name) || name || code || label),
        label,
        code,
        name,
      };
    })
    .filter((warehouse) => warehouse.label)
    .sort((a, b) => a.label.localeCompare(b.label));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderOptions(select, records, placeholder) {
  select.innerHTML = [
    `<option value="">${escapeHtml(placeholder)}</option>`,
    ...records.map(
      (record) =>
        `<option value="${escapeHtml(record.value)}" data-id="${escapeHtml(record.id)}" data-code="${escapeHtml(record.code)}" data-name="${escapeHtml(record.name)}">${escapeHtml(record.label)}</option>`,
    ),
  ].join("");
}

function renderItemOptions(records) {
  els.itemSearch.value = "";
  state.selectedItem = null;
  closeItemSuggestions();
}

function resolveSelectedItem() {
  const typed = els.itemSearch.value.trim();
  if (!typed) return null;
  if (state.selectedItem?.label === typed) return state.selectedItem;

  const normalized = cleanKey(typed);
  return (
    state.items.find((item) => item.label === typed) ||
    state.items.find((item) => cleanKey(item.code) === normalized) ||
    state.items.find((item) => cleanKey(item.label) === normalized) ||
    null
  );
}

function closeItemSuggestions() {
  els.itemSuggestions.classList.remove("is-open");
  els.itemSuggestions.innerHTML = "";
}

function chooseItem(item) {
  state.selectedItem = item;
  els.itemSearch.value = item.label;
  closeItemSuggestions();
}

function showItemSuggestions() {
  if (!state.mastersLoaded || els.itemSearch.disabled) return;

  state.selectedItem = null;
  const query = cleanKey(els.itemSearch.value);
  const matches = state.items
    .filter((item) => {
      if (!query) return true;
      return cleanKey(`${item.code} ${item.name} ${item.label}`).includes(query);
    })
    .slice(0, 60);

  if (!matches.length) {
    els.itemSuggestions.innerHTML = `<div class="suggestion-empty">No matching items</div>`;
    els.itemSuggestions.classList.add("is-open");
    return;
  }

  els.itemSuggestions.innerHTML = matches
    .map(
      (item, index) =>
        `<button class="suggestion-option" type="button" data-index="${index}" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</button>`,
    )
    .join("");

  [...els.itemSuggestions.querySelectorAll(".suggestion-option")].forEach((button, index) => {
    button.addEventListener("click", () => chooseItem(matches[index]));
  });
  els.itemSuggestions.classList.add("is-open");
}

function setMasterDependentControls(enabled) {
  els.itemSearch.disabled = !enabled;
  els.warehouseSelect.disabled = !enabled;
  els.applyButton.disabled = !enabled;
}

async function loadMasters() {
  if (!state.creatorReady) {
    state.mastersLoaded = true;
    setMasterDependentControls(true);
    els.loadMastersButton.disabled = true;
    els.loadMastersButton.textContent = "Preview Mode";
    return;
  }

  state.warnings = [];
  els.loadMastersButton.disabled = true;
  els.loadMastersButton.textContent = "Loading Masters";
  setMasterDependentControls(false);
  setStatus("Loading item and warehouse masters...");

  try {
    const [items, warehouses] = await withTimeout(
      Promise.all([fetchItems(), fetchWarehouses()]),
      20000,
      "Creator reports did not respond",
    );
    state.items = items;
    state.warehouses = warehouses;
    state.itemCount = items.length;
    state.warehouseCount = warehouses.length;
    state.mastersLoaded = true;
    renderItemOptions(items);
    renderOptions(els.warehouseSelect, warehouses, "Select warehouse");
    setMasterDependentControls(true);
    els.loadMastersButton.textContent = "Masters Loaded";
    els.loadStatus.textContent = `Loaded ${items.length} item options and ${warehouses.length} warehouse options. Select an item and warehouse, then click Apply.`;
  } catch (error) {
    const detail = error?.message || JSON.stringify(error) || String(error);
    state.mastersLoaded = false;
    els.loadMastersButton.disabled = false;
    els.loadMastersButton.textContent = "Load Masters";
    setMasterDependentControls(false);
    setStatus(detail || "Unable to load masters");
  }
}

function mapPurchase(record) {
  return blankMovement({
    date: getDate(record, ["DELIVERY DATE", "Delivery Date", "INV DATE", "Inv Date", "Date"]),
    billNumber: getText(record, ["Purchase Receives No", "PURCHASE RECEIVES NO", "POR NO", "INVOICE NO", "Invoice No"]),
    party: getText(record, ["SUPPLIER", "Vendor", "VENDOR", "BRANCH", "Party"]),
    purchase: getNumber(record, ["RECEIVED QTY", "Received Qty", "Quantity", "QTY"]),
  });
}

function mapSales(record) {
  return blankMovement({
    date: getDate(record, ["DATE", "Invoice Date", "INV DATE", "Date"]),
    billNumber: getText(record, ["Sales Invoice", "SALES INVOICE", "INVOICE NO", "Invoice No"]),
    party: getText(record, ["CUSTOMER NAME", "Customer Name", "CUSTOMER", "Customer", "Party"]),
    sales: getQuantity(record, ["QTY", "Qty", "Quantity"], ["Line Items", "Line Item"]),
  });
}

function mapCreditNote(record) {
  return blankMovement({
    date: getDate(record, ["DATE", "Credit Date", "CREDIT DATE", "Date"]),
    billNumber: getText(record, ["Credit Note", "CREDIT NOTE", "CREDIT NO", "Credit No"]),
    party: getText(record, ["CUSTOMER NAME", "Customer Name", "CUSTOMER", "Customer"]),
    creditNote: getNumber(record, ["QTY", "Qty", "Quantity"]),
  });
}

function mapVendorCredit(record) {
  return blankMovement({
    date: getDate(record, ["DATE", "Vendor Credit Date", "Date"]),
    billNumber: getText(record, ["Vendor Credits", "VENDOR CREDITS", "PREVIOUS BILL NO", "Previous Bill No"]),
    party: getText(record, ["VENDOR", "Vendor", "SUPPLIER", "Supplier"]),
    vendorCredit: getNumber(record, ["RETURN QTY", "Return Qty", "ACTUAL QTY", "Actual Qty", "Quantity"]),
  });
}

function mapTransfer(record, direction) {
  return blankMovement({
    date: getDate(record, ["DATE", "Date"]),
    billNumber: getText(record, ["Branch Transfer IN Out", "BRANCH TRANSFER NO", "Branch Transfer No", "DELIVERY NOTE"]),
    party:
      direction === "out"
        ? getText(record, ["Destination Warehouse", "DESTINATION WAREHOUSE"])
        : getText(record, ["Source Warehouse", "SOURCE WAREHOUSE"]),
    [direction === "out" ? "transOut" : "transIn"]: getNumber(record, [
      "Transfer Quantity",
      "TRANSFER QUANTITY",
      "Quantity",
      "QTY",
    ]),
  });
}

function mapReprocessOut(record) {
  return blankMovement({
    date: getDate(record, ["Date", "DATE"]),
    billNumber: getText(record, ["ORDER NO", "Order No", "REPROCESS", "Reprocess"]),
    party: "Reprocess output",
    reprocessOut: getNumber(record, ["QUANTITY", "Quantity", "REPROCESS OUT", "Reprocess Out", "TOTAL QTY"]),
  });
}

function mapReprocessIn(record) {
  return blankMovement({
    date: getDate(record, ["Date", "DATE"]),
    billNumber: getText(record, ["REPROCESS", "Reprocess", "ORDER NO", "Order No"]),
    party: "Reprocess consumption",
    reprocessIn: getNumber(record, ["TOTAL QTY", "Total Qty", "QUANTITY", "Quantity"]),
  });
}

function mapAdjustment(record) {
  const quantity = getNumber(record, ["Quantity Adjusted", "QUANTITY ADJUSTED", "Adjusted Quantity"]);
  return blankMovement({
    date: getDate(record, ["DATE", "Date"]),
    billNumber: getText(record, ["SI No", "SI NO", "ORDER NO", "REFERENCE NUMBER", "Reference Number"]),
    party: getText(record, ["REASON", "Reason", "ACCOUNT", "Account"]) || "Inventory adjustment",
    shortage: quantity < 0 ? Math.abs(quantity) : 0,
    surplus: quantity > 0 ? quantity : 0,
  });
}

async function transactionMovements(filters) {
  const [
    purchases,
    sales,
    creditNotes,
    vendorCredits,
    transferOuts,
    transferIns,
    reprocessRows,
    adjustments,
  ] = await Promise.all([
    creatorGetRecordsSafe(REPORTS.purchase),
    creatorGetRecordsSafe(REPORTS.sales),
    creatorGetRecordsSafe(REPORTS.creditNote),
    creatorGetRecordsSafe(REPORTS.vendorCredit),
    creatorGetRecordsSafe(REPORTS.transferOut),
    creatorGetRecordsSafe(REPORTS.transferIn),
    creatorGetRecordsSafe(REPORTS.reprocess),
    creatorGetRecordsSafe(REPORTS.adjustment),
  ]);

  const movements = [];

  purchases.forEach((record) => {
    if (matchesItem(record, filters, ["ITEMCODE", "ITEM CODE", "ITEM NAME"]) && matchesWarehouse(record, filters)) {
      movements.push(mapPurchase(record));
    }
  });

  sales.forEach((record) => {
    if (matchesItem(record, filters, ["ITEM CODE", "ITEM NAME"]) && matchesWarehouse(record, filters)) {
      movements.push(mapSales(record));
    }
  });

  creditNotes.forEach((record) => {
    if (matchesItem(record, filters, ["ITEM CODE", "ITEMCODE", "ITEM NAME"]) && matchesWarehouse(record, filters, ["Warehouse ID", "WAREHOUSE"])) {
      movements.push(mapCreditNote(record));
    }
  });

  vendorCredits.forEach((record) => {
    if (matchesItem(record, filters, ["ITEMCODE", "ITEM NAME"]) && matchesWarehouse(record, filters, ["Warehouse ID", "WAREHOUSE"])) {
      movements.push(mapVendorCredit(record));
    }
  });

  transferOuts.forEach((record) => {
    if (matchesItem(record, filters, ["Item", "ITEM"]) && matchesWarehouse(record, filters, ["Source Warehouse", "SOURCE WAREHOUSE"])) {
      movements.push(mapTransfer(record, "out"));
    }
  });

  transferIns.forEach((record) => {
    if (matchesItem(record, filters, ["Item", "ITEM"]) && matchesWarehouse(record, filters, ["Destination Warehouse", "DESTINATION WAREHOUSE"])) {
      movements.push(mapTransfer(record, "in"));
    }
  });

  reprocessRows.forEach((record) => {
    if (matchesItem(record, filters, ["REPROCESS OUT", "Reprocess Out"]) && matchesWarehouse(record, filters)) {
      movements.push(mapReprocessOut(record));
    }

    const subformRows = getField(record, ["REPROCESS IN", "Reprocess In"]);
    if (Array.isArray(subformRows)) {
      subformRows.forEach((subRow) => {
        const merged = { ...record, ...subRow };
        if (matchesItem(merged, filters, ["ITEM NAME", "Item Name"]) && matchesWarehouse(merged, filters)) {
          movements.push(mapReprocessIn(merged));
        }
      });
    } else if (
      itemIdFromRecord(record, ["ITEM NAME", "Item Name"]) &&
      matchesItem(record, filters, ["ITEM NAME", "Item Name"]) &&
      matchesWarehouse(record, filters)
    ) {
      movements.push(mapReprocessIn(record));
    }
  });

  adjustments.forEach((record) => {
    if (matchesItem(record, filters, ["Item Name", "ITEM NAME"]) && matchesWarehouse(record, filters)) {
      movements.push(mapAdjustment(record));
    }
  });

  return movements
    .filter((movement) => movement.date && hasStockMovement(movement))
    .sort((a, b) => a.date.localeCompare(b.date) || a.billNumber.localeCompare(b.billNumber));
}

async function openingStockFromReport(filters) {
  const openings = await creatorGetRecordsSafe(REPORTS.openings);
  const match = openings.find(
    (record) =>
      matchesItem(record, filters, ["ITEMCODE", "ITEM CODE", "ITEM NAME", "Item Name"]) &&
      matchesWarehouse(record, filters),
  );

  return match
    ? getNumber(match, ["OPENING STOCK", "Opening Stock", "Opening", "QTY", "Quantity", "Opening Quantity"])
    : 0;
}

async function loadStockRegister(filters) {
  if (!state.creatorReady) {
    return loadSampleStockRegister(filters);
  }

  const [financialYearOpening, movements] = await Promise.all([
    openingStockFromReport(filters),
    transactionMovements(filters),
  ]);

  const beforeFromDate = movements.filter((movement) => beforeDate(movement.date, filters.fromDate));
  const selectedRange = movements.filter((movement) => inDateRange(movement.date, filters.fromDate, filters.toDate));

  const openingStock = calculateRows(financialYearOpening, beforeFromDate).at(-1)?.balance ?? financialYearOpening;

  return {
    openingStock,
    rows: calculateRows(openingStock, selectedRange),
  };
}

function loadSampleStockRegister(filters) {
  const sampleMovements = [
    blankMovement({ date: filters.fromDate, billNumber: "PUR-1042", party: "Sample Supplier", purchase: 180 }),
    blankMovement({ date: filters.fromDate, billNumber: "INV-2218", party: "Sample Customer", sales: 64 }),
    blankMovement({ date: filters.toDate, billNumber: "ADJ-017", party: "Stock Audit", surplus: 3 }),
  ];
  const openingStock = 1240;
  return {
    openingStock,
    rows: calculateRows(openingStock, sampleMovements),
  };
}

function renderTable(rows, openingStock) {
  const openingRow = {
    date: els.fromDate.value,
    billNumber: "Opening",
    party: "Previous day closing stock",
    opStock: "",
    purchase: "",
    sales: "",
    creditNote: "",
    vendorCredit: "",
    transOut: "",
    transIn: "",
    reprocessOut: "",
    reprocessIn: "",
    shortage: "",
    surplus: "",
    balance: openingStock,
  };

  els.registerBody.innerHTML = [openingRow, ...rows]
    .map((row, rowIndex) => {
      const className = rowIndex === 0 ? " class=\"op-row\"" : "";
      const cells = COLUMNS.map((column) => {
        let value = row[column];
        if (column === "date") value = formatDate(value);
        if (typeof value === "number") value = formatQty(value);

        const tdClass = [
          column === "balance" ? "balance" : "",
          value === "0" ? "zero" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return `<td${tdClass ? ` class="${tdClass}"` : ""}>${value ?? ""}</td>`;
      }).join("");
      return `<tr${className}>${cells}</tr>`;
    })
    .join("");
}

function renderEmptyRegister(message) {
  state.visibleRows = [];
  renderSummary(0, []);
  renderTable([], 0);
  setStatus(message);
}

function renderSummary(openingStock, rows) {
  const totals = rows.reduce(
    (acc, row) => {
      acc.inward += movementIn(row);
      acc.outward += movementOut(row);
      return acc;
    },
    { inward: 0, outward: 0 },
  );

  const closing = rows.length ? rows[rows.length - 1].balance : openingStock;

  els.openingStock.textContent = formatQty(openingStock);
  els.totalInward.textContent = formatQty(totals.inward);
  els.totalOutward.textContent = formatQty(totals.outward);
  els.closingBalance.textContent = formatQty(closing);
  els.rowCount.textContent = `${rows.length} ${rows.length === 1 ? "row" : "rows"}`;
  els.rangeLabel.textContent = `${els.itemSearch.value || "All items"} in ${els.warehouseSelect.selectedOptions[0]?.text || "All warehouses"}, ${formatDate(els.fromDate.value)} to ${formatDate(els.toDate.value)}`;
}

function setStatus(message) {
  els.rangeLabel.textContent = message;
  els.loadStatus.textContent = message;
}

async function applyFilters() {
  state.warnings = [];
  if (state.creatorReady && !state.mastersLoaded) {
    renderEmptyRegister("Click Load Masters before applying filters.");
    return;
  }

  const selectedItem = resolveSelectedItem();
  const filters = {
    itemKey: selectedItem?.value || "",
    itemName: selectedItem?.label || els.itemSearch.value.trim(),
    itemId: selectedItem?.id || "",
    itemCode: selectedItem?.code || "",
    itemRawName: selectedItem?.name || "",
    warehouseKey: els.warehouseSelect.value,
    warehouseName: els.warehouseSelect.selectedOptions[0]?.text || "",
    fromDate: els.fromDate.value,
    toDate: els.toDate.value,
  };

  if (filters.fromDate > filters.toDate) {
    els.toDate.value = filters.fromDate;
    filters.toDate = filters.fromDate;
  }

  if (state.creatorReady && (!selectedItem || !filters.warehouseKey)) {
    renderEmptyRegister("Select a valid item from the filtered list and warehouse, then click Apply.");
    return;
  }

  els.applyButton.disabled = true;
  els.applyButton.textContent = "Loading";
  setStatus("Fetching Creator reports...");

  try {
    const result = await loadStockRegister(filters);
    state.visibleRows = result.rows;
    renderSummary(result.openingStock, result.rows);
    renderTable(result.rows, result.openingStock);
    const masterStatus = state.creatorReady
      ? `Loaded ${state.itemCount} item options and ${state.warehouseCount} warehouse options.`
      : "Local preview mode.";
    if (state.warnings.length) {
      els.loadStatus.textContent = `${masterStatus} Register loaded with ${state.warnings.length} warning(s): ${state.warnings.slice(0, 2).join(" | ")}`;
    } else {
      els.loadStatus.textContent = `${masterStatus} Register loaded.`;
    }
  } catch (error) {
    console.error(error);
    const detail = error?.message || JSON.stringify(error) || String(error);
    setStatus(detail || "Unable to load stock register");
    els.registerBody.innerHTML = "";
    renderSummary(0, []);
  } finally {
    els.applyButton.disabled = false;
    els.applyButton.textContent = "Apply";
  }
}

function exportCsv() {
  const headings = [
    "Date",
    "Bill Number",
    "Party(Customer)",
    "Op Stock",
    "Purchase",
    "Sales",
    "Credit Note",
    "Vendor Credit",
    "Trans.Out",
    "Trans.In",
    "Reprocess Out",
    "Reprocess In",
    "Shortage",
    "Surplus",
    "Balance",
  ];

  const lines = [
    headings.join(","),
    ...state.visibleRows.map((row) =>
      COLUMNS.map((column) => `"${String(row[column] ?? "").replaceAll('"', '""')}"`).join(","),
    ),
  ];

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "stock-register.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

function setDefaultDates() {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  els.fromDate.value = dateInputValue(firstDay);
  els.toDate.value = dateInputValue(today);
}

async function boot() {
  setDefaultDates();
  els.applyButton.addEventListener("click", applyFilters);
  els.exportButton.addEventListener("click", exportCsv);
  els.loadMastersButton.addEventListener("click", loadMasters);
  els.itemSearch.addEventListener("input", showItemSuggestions);
  els.itemSearch.addEventListener("focus", showItemSuggestions);
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-box")) closeItemSuggestions();
  });
  setMasterDependentControls(false);

  try {
    state.creatorReady = isEmbeddedInCreator() && Boolean(window.ZOHO?.CREATOR?.DATA?.getRecords);
    if (state.creatorReady) {
      if (typeof ZOHO.CREATOR.init === "function") {
        await withTimeout(ZOHO.CREATOR.init(), 10000, "Creator SDK did not initialize");
      }
      els.loadMastersButton.disabled = false;
      setStatus("Click Load Masters to load item and warehouse options.");
    } else {
      state.mastersLoaded = true;
      setMasterDependentControls(true);
      els.loadMastersButton.disabled = true;
      els.loadMastersButton.textContent = "Preview Mode";
      els.loadStatus.textContent = "Local preview mode. Creator data loads only inside the embedded page.";
    }
  } catch (error) {
    console.error(error);
    state.creatorReady = false;
    setStatus("Creator SDK unavailable. Showing sample rows.");
  }

  if (state.creatorReady) {
    renderEmptyRegister("Click Load Masters to load item and warehouse options.");
  } else {
    await applyFilters();
  }
}

boot();
