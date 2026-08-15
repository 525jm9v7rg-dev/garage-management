function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const today = dateKey(new Date());

const business = {
  name: "OG Automotives Limited",
  vatName: "OG Autos Services",
  address: "Unit 1 Foxhall Road, CM0 7LB",
  vatNumber: "519417090",
  bankName: "OG Automotives LTD",
  accountNumber: "30152887",
  vatBankName: "OG Autos Services Ltd",
  vatAccountNumber: "30184819",
  sortCode: "52-30-02"
};
const VAT_RATE = 0.2;
const PROFIT_PASSWORD = "240710";
const SALES_INACTIVITY_MS = 10 * 60 * 1000;
const REMOTE_REQUEST_TIMEOUT_MS = 10000;
const STORAGE_KEY = "garageDeskStateFirstUse";
const SUPABASE_URL = "https://jlnfsafgonfuzuetgmhj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpsbmZzYWZnb25mdXp1ZXRnbWhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5MzQ4MzcsImV4cCI6MjA5OTUxMDgzN30.Nwg6AfGPGGiofZjO4BLubjRsx6QqRSgEiBwvZ-LKjCQ";
const DATA_TABLES = ["customers", "vehicles", "jobs", "invoices", "expenses"];
const DEFAULT_MECHANICS = ["Dom", "Steve", "Jay", "Callum", "Jack"];
const MECHANIC_DAILY_HOURS = 8;
const MECHANIC_WEEKLY_HOURS = 40;
const WORK_LOG_TYPE = "sales-work-log";
const STOCK_ITEM_TYPE = "stock-item";

const seedData = {
  customers: [],
  vehicles: [],
  jobs: [],
  invoices: [],
  expenses: []
};

localStorage.removeItem("garageDeskState");

let state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || seedData;
let currentJobFilter = "all";
let selectedProfitMonth = null;
let searchTerm = "";
let activeQuoteItems = [];
const stockDrafts = new Map();
let activeInvoiceId = null;
let activeEditJobId = null;
let calendarDate = new Date(today);
let profitUnlocked = false;
let currentUser = null;
let currentProfile = null;
let loginLogs = [];
let userProfiles = [];
let remoteReady = false;
let syncingRemote = false;
let remoteSavePending = false;
let saveTimer = null;
let remoteReloadTimer = null;
let realtimeChannel = null;
let remotePollTimer = null;
let salesInactivityTimer = null;
sessionStorage.removeItem("profitUnlocked");

const supabaseClient = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const views = document.querySelectorAll(".view");
const navItems = document.querySelectorAll(".nav-item");
const pageTitle = document.querySelector("#pageTitle");
const jobDialog = document.querySelector("#jobDialog");
const invoiceDialog = document.querySelector("#invoiceDialog");
const loginScreen = document.querySelector("#loginScreen");
const appShell = document.querySelector("#appShell");
const loginMessage = document.querySelector("#loginMessage");
const existingVehicleFields = document.querySelector("#existingVehicleFields");
const newVehicleFields = document.querySelector("#newVehicleFields");
const existingCustomerField = document.querySelector("#existingCustomerField");
const newCustomerFields = document.querySelector("#newCustomerFields");

const saveLocal = () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};
const save = () => {
  saveLocal();
  queueRemoteSave();
};
const withTimeout = (promise, message = "The cloud request timed out.") => new Promise((resolve, reject) => {
  const timeoutId = window.setTimeout(() => reject(new Error(message)), REMOTE_REQUEST_TIMEOUT_MS);
  Promise.resolve(promise).then(
    (value) => {
      window.clearTimeout(timeoutId);
      resolve(value);
    },
    (error) => {
      window.clearTimeout(timeoutId);
      reject(error);
    }
  );
});
const money = (value) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(value || 0));
const byId = (collection, id) => state[collection].find((item) => item.id === id);
const makeId = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const formatDate = (value) => {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
};
const generatedRecordDate = (id) => {
  const timestamp = Number.parseInt(String(id || "").slice(1, -4), 36);
  if (!Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "" : dateKey(date);
};
const lineTotal = (item) => Number(item.qty || 0) * Number(item.unitPrice || 0);
const itemType = (item) => item.type || "part";
const partStatus = (item) => item.status || "Needed";
const labourItemsTotal = (items = []) => items.filter((item) => itemType(item) === "labour").reduce((total, item) => total + lineTotal(item), 0);
const partsTotal = (items = []) => items.filter((item) => itemType(item) === "part").reduce((total, item) => total + lineTotal(item), 0);
const jobLabourTotal = (job) => labourItemsTotal(job?.lineItems || []);
const jobTotal = (job) => jobLabourTotal(job) + partsTotal(job?.lineItems || []);
const monthKey = (value) => String(value || "").slice(0, 7);
const shiftedMonthKey = (offset = 0) => {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};
const monthName = (value) => new Date(`${value}-01T12:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const expensesTotal = (month = null) => state.expenses
  .filter((expense) => ![WORK_LOG_TYPE, STOCK_ITEM_TYPE].includes(expense.type) && (!month || monthKey(expense.expenseDate) === month))
  .reduce((total, expense) => total + Number(expense.amount || 0), 0);
const invoiceForJob = (jobId) => state.invoices.find((invoice) => invoice.job === jobId);
const isJobPaid = (job) => invoiceForJob(job.id)?.status === "Paid";
const isJobPaidInMonth = (job, month = null) => {
  const invoice = invoiceForJob(job.id);
  return invoice?.status === "Paid" && (!month || monthKey(invoice.paidDate) === month);
};
const paidLabourIncome = (month = null) => state.jobs.reduce((total, job) => total + (isJobPaidInMonth(job, month) ? jobLabourTotal(job) : 0), 0);
const profit = (month = null) => paidLabourIncome(month) - expensesTotal(month);
const paidLabourIncomeThrough = (month) => state.jobs.reduce((total, job) => {
  const invoice = invoiceForJob(job.id);
  return total + (invoice?.status === "Paid" && monthKey(invoice.paidDate) <= month ? jobLabourTotal(job) : 0);
}, 0);
const expensesTotalThrough = (month) => state.expenses
  .filter((expense) => ![WORK_LOG_TYPE, STOCK_ITEM_TYPE].includes(expense.type) && monthKey(expense.expenseDate) <= month)
  .reduce((total, expense) => total + Number(expense.amount || 0), 0);
const profitThrough = (month) => paidLabourIncomeThrough(month) - expensesTotalThrough(month);
const workLogs = () => state.expenses.filter((entry) => entry.type === WORK_LOG_TYPE);
const stockItems = () => state.expenses.filter((entry) => entry.type === STOCK_ITEM_TYPE);

function updateJobArchive(job) {
  const invoice = invoiceForJob(job.id);
  const shouldArchive = job.status === "Collected"
    && invoice?.status === "Paid"
    && Boolean(invoice.paidDate)
    && monthKey(invoice.paidDate) < shiftedMonthKey(0);
  job.archived = shouldArchive;
  if (shouldArchive && !job.archivedAt) job.archivedAt = dateKey(new Date());
  if (!shouldArchive) job.archivedAt = "";
}

function workLogHours(entry) {
  const [startHour, startMinute] = String(entry.startTime || "").split(":").map(Number);
  const [endHour, endMinute] = String(entry.endTime || "").split(":").map(Number);
  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return 0;
  return Math.max(0, ((endHour * 60 + endMinute) - (startHour * 60 + startMinute)) / 60);
}

function formatHours(value) {
  return `${Number(value || 0).toFixed(2).replace(/\.00$/, "")} hrs`;
}

function customerForJob(job) {
  const vehicle = job ? byId("vehicles", job.vehicle) : null;
  return vehicle ? byId("customers", vehicle.owner) : null;
}

function isVatInvoice(invoice) {
  const job = invoice ? byId("jobs", invoice.job) : null;
  const customer = customerForJob(job);
  return Boolean(customer?.vatCustomer && invoice?.vatEnabled);
}

function invoiceSubtotal(invoice) {
  const job = invoice ? byId("jobs", invoice.job) : null;
  return job ? jobTotal(job) : Number(invoice?.amount || 0);
}

function invoiceVatAmount(invoice) {
  return isVatInvoice(invoice) ? invoiceSubtotal(invoice) * VAT_RATE : 0;
}

function invoiceTotal(invoice) {
  return invoiceSubtotal(invoice) + invoiceVatAmount(invoice);
}

function invoiceBusinessName(invoice) {
  return isVatInvoice(invoice) ? business.vatName : business.name;
}

function normalizeState() {
  state.customers = Array.isArray(state.customers) ? state.customers : [];
  state.vehicles = Array.isArray(state.vehicles) ? state.vehicles : [];
  state.jobs = Array.isArray(state.jobs) ? state.jobs : [];
  state.invoices = Array.isArray(state.invoices) ? state.invoices : [];
  state.expenses = Array.isArray(state.expenses) ? state.expenses : [];
  state.expenses.forEach((entry) => {
    if (entry.type === WORK_LOG_TYPE) {
      if (entry.createdById === undefined) entry.createdById = entry.userId || "";
      if (entry.createdByEmail === undefined) entry.createdByEmail = entry.userEmail || "";
      if (entry.createdByRole === undefined) entry.createdByRole = "sales";
      return;
    }
    if (!entry.expenseDate) entry.expenseDate = String(entry.createdAt || "").slice(0, 10) || generatedRecordDate(entry.id) || dateKey(new Date());
  });
  state.customers.forEach((customer) => {
    if (customer.address === undefined) customer.address = "";
    if (customer.postcode === undefined) customer.postcode = "";
    if (customer.vatCustomer === undefined) customer.vatCustomer = false;
  });
  state.vehicles.forEach((vehicle) => {
    if (vehicle.motDue === undefined) vehicle.motDue = "";
  });
  state.jobs.forEach((job) => {
    if (!Array.isArray(job.lineItems)) job.lineItems = [];
    job.lineItems = job.lineItems.map((item) => {
      const type = item.type || "part";
      return { type, name: item.name, qty: Number(item.qty || 1), unitPrice: Number(item.unitPrice || 0), status: type === "part" ? item.status || "Needed" : "" };
    });
    if (Number(job.estimate || 0) > 0) {
      job.lineItems.unshift({ type: "labour", name: `${job.type || "Workshop"} labour`, qty: 1, unitPrice: Number(job.estimate || 0) });
      job.estimate = 0;
    }
    if (!job.type) job.type = quoteTitle(job);
    if (!job.mechanic) job.mechanic = "Unassigned";
    if (String(job.mechanic).toLowerCase() === "dom") job.mechanic = "Dom";
    if (!Number(job.estimatedHours)) {
      job.estimatedHours = Math.min(MECHANIC_DAILY_HOURS, Math.max(1, job.lineItems.filter((item) => itemType(item) === "labour").reduce((total, item) => total + Number(item.qty || 0), 0)));
    }
  });
  state.invoices.forEach((invoice) => {
    const job = byId("jobs", invoice.job);
    invoice.vatEnabled = Boolean(invoice.vatEnabled && customerForJob(job)?.vatCustomer);
    if (job) {
      if (job.readyDate === undefined) {
        job.readyDate = ["Ready", "Collected"].includes(job.status) ? invoice.due || job.due || "" : "";
      }
      invoice.due = job.readyDate || "";
      if (invoice.status === "Paid" && !invoice.paidDate) invoice.paidDate = invoice.due || job.readyDate || job.due || dateKey(new Date());
      if (invoice.status !== "Paid" && invoice.paidDate === undefined) invoice.paidDate = "";
      invoice.amount = invoiceTotal(invoice);
      updateJobArchive(job);
    }
  });
  saveLocal();
}

function expenseTypeLabel(type) {
  const labels = {
    mechanic: "Mechanic wages",
    rent: "Rent",
    "garage-parts": "Garage parts",
    other: "Other"
  };
  return labels[type] || type;
}

function vehicleLabel(vehicleId) {
  const vehicle = byId("vehicles", vehicleId);
  if (!vehicle) return "Unknown vehicle";
  return `${vehicle.plate} - ${vehicle.model}`;
}

function vehicleRegistration(vehicleId) {
  return byId("vehicles", vehicleId)?.plate || "Unknown registration";
}

function ownerName(ownerId) {
  return byId("customers", ownerId)?.name || "Unknown owner";
}

function customerVehicles(customerId) {
  return state.vehicles.filter((vehicle) => vehicle.owner === customerId);
}

function mechanicOptions() {
  const canonicalMechanicName = (name) => DEFAULT_MECHANICS.find((mechanic) => mechanic.toLowerCase() === String(name).trim().toLowerCase()) || String(name).trim();
  const expenseNames = state.expenses
    .filter((expense) => expense.type === "mechanic" && expense.mechanicName)
    .map((expense) => canonicalMechanicName(expense.mechanicName))
    .filter(Boolean);
  const assignedNames = state.jobs
    .map((job) => canonicalMechanicName(job.mechanic))
    .filter((name) => name && name !== "Unassigned");
  return ["Unassigned", ...new Set([...DEFAULT_MECHANICS, ...expenseNames, ...assignedNames])];
}

function dateFromKey(value) {
  return new Date(`${value}T12:00:00`);
}

function nextWeekday(value = dateKey(new Date())) {
  const date = dateFromKey(value);
  while ([0, 6].includes(date.getDay())) date.setDate(date.getDate() + 1);
  return dateKey(date);
}

function weekStartKey(value) {
  const date = dateFromKey(value);
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return dateKey(date);
}

function jobEstimatedHours(job) {
  return Number(job?.estimatedHours || 0);
}

function scheduledJobsForMechanic(mechanic, excludeJobId = null) {
  return state.jobs.filter((job) => job.id !== excludeJobId
    && job.mechanic === mechanic
    && ["Booked", "In progress"].includes(job.status));
}

function mechanicCapacity(mechanic, day, excludeJobId = null) {
  const scheduled = scheduledJobsForMechanic(mechanic, excludeJobId);
  const dayHours = scheduled.filter((job) => job.due === day).reduce((total, job) => total + jobEstimatedHours(job), 0);
  const week = weekStartKey(day);
  const weekHours = scheduled.filter((job) => weekStartKey(job.due) === week).reduce((total, job) => total + jobEstimatedHours(job), 0);
  return {
    available: Math.max(0, Math.min(MECHANIC_DAILY_HOURS - dayHours, MECHANIC_WEEKLY_HOURS - weekHours)),
    dayHours,
    weekHours
  };
}

function nextMechanicDates(mechanic, hours, excludeJobId = null, startDate = dateKey(new Date())) {
  if (!mechanic || mechanic === "Unassigned" || hours <= 0 || hours > MECHANIC_DAILY_HOURS) return [];
  const results = [];
  const date = dateFromKey(startDate);
  for (let checked = 0; checked < 120 && results.length < 3; checked += 1) {
    const day = dateKey(date);
    if (![0, 6].includes(date.getDay())) {
      const capacity = mechanicCapacity(mechanic, day, excludeJobId);
      if (capacity.available >= hours) results.push({ day, ...capacity });
    }
    date.setDate(date.getDate() + 1);
  }
  return results;
}

function renderMechanicAvailability() {
  const panel = document.querySelector("#mechanicAvailability");
  if (!panel) return;
  const mechanic = document.querySelector('#jobForm select[name="mechanic"]').value;
  const hours = Number(document.querySelector('#jobForm input[name="estimatedHours"]').value || 0);
  const availabilityFrom = document.querySelector("#availabilityFrom").value || dateKey(new Date());
  if (mechanic === "Unassigned") {
    panel.innerHTML = `<span class="muted">Choose a mechanic to see availability.</span>`;
    return;
  }
  if (!hours || hours > MECHANIC_DAILY_HOURS) {
    panel.innerHTML = `<span class="muted">Enter between 0.5 and ${MECHANIC_DAILY_HOURS} hours to see available days.</span>`;
    return;
  }
  const dates = nextMechanicDates(mechanic, hours, activeEditJobId, availabilityFrom);
  panel.innerHTML = dates.length
    ? `<strong>Next 3 available days for ${mechanic}</strong><div class="availability-days">${dates.map((entry) => `<button class="availability-day" type="button" data-availability-date="${entry.day}"><strong>${dateFromKey(entry.day).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</strong><span>${entry.available}h available</span></button>`).join("")}</div><small class="muted">Capacity: ${MECHANIC_DAILY_HOURS} hours per day, ${MECHANIC_WEEKLY_HOURS} hours per week.</small>`
    : `<span class="muted">No available dates found in the next 120 days.</span>`;
}

function vehicleSummary(vehicle) {
  return `${vehicle.plate} - ${vehicle.model}, ${Number(vehicle.mileage || 0).toLocaleString()} mi, MOT ${formatDate(vehicle.motDue)}`;
}

function quoteTitle(job) {
  const firstLine = (job.lineItems || [])[0]?.name;
  return firstLine || (job.vehicle ? vehicleLabel(job.vehicle) : "Workshop quote");
}

function partsStatusSummary(job) {
  const parts = (job.lineItems || []).filter((item) => itemType(item) === "part");
  if (!parts.length) return "No parts";
  const counts = parts.reduce((summary, item) => {
    const status = partStatus(item);
    summary[status] = (summary[status] || 0) + 1;
    return summary;
  }, {});
  return Object.entries(counts).map(([status, count]) => `${status}: ${count}`).join(", ");
}

function jobSearchText(job) {
  const vehicle = byId("vehicles", job.vehicle);
  const owner = vehicle ? byId("customers", vehicle.owner) : null;
  const quoteItems = (job.lineItems || []).map((item) => item.name).join(" ");
  return [quoteTitle(job), job.status, job.mechanic, job.notes, vehicle?.plate, vehicle?.model, owner?.name, quoteItems].join(" ").toLowerCase();
}

function currentRole() {
  return currentProfile?.role || "sales";
}

function isAdmin() {
  return currentRole() === "admin";
}

function canView(viewId) {
  return !["stock", "profit", "userLogs"].includes(viewId) || isAdmin();
}

function applyRoleAccess() {
  document.querySelectorAll('[data-view="stock"], [data-view="profit"], [data-view="userLogs"]').forEach((item) => {
    item.classList.toggle("hidden", !isAdmin());
  });
  document.querySelector("#workLogUserField").classList.toggle("hidden", !isAdmin());
  document.querySelector('#workLogForm select[name="workLogUser"]').required = isAdmin();
  if (!canView(document.querySelector(".active-view")?.id)) setView("dashboard");
}

function setView(viewId) {
  if (!canView(viewId)) {
    window.alert("You do not have permission to open this section.");
    setView("dashboard");
    return;
  }
  if (viewId === "profit" && !unlockProfitSection()) return;
  if (viewId !== "profit") profitUnlocked = false;
  views.forEach((view) => view.classList.toggle("active-view", view.id === viewId));
  navItems.forEach((item) => item.classList.toggle("active", item.dataset.view === viewId));
  pageTitle.textContent = viewId === "jobs" ? "Quotes" : viewId === "userLogs" ? "User Logs" : viewId === "workLogs" ? "Work Log" : viewId[0].toUpperCase() + viewId.slice(1);
  render();
  if (viewId === "userLogs") refreshAdminLogs();
}

function unlockProfitSection() {
  if (!isAdmin()) return false;
  profitUnlocked = true;
  return true;
}

function statusBadge(status) {
  return `<span class="badge ${statusTone(status)}">${status}</span>`;
}

function statusTone(status) {
  if (status === "Booked" || status === "Unpaid") return "bad";
  if (status === "In progress") return "warn";
  if (status === "Ready" || status === "Paid") return "good";
  if (status === "Collected" || status === "Archived") return "done";
  return "";
}

function renderDashboard() {
  const openJobs = state.jobs.filter((job) => job.status !== "Collected");
  const workshopQueue = state.jobs.filter((job) => job.status === "In progress");
  const dueToday = state.jobs.filter((job) => job.due === today && job.status !== "Collected");
  const unpaid = state.invoices.filter((invoice) => invoice.status === "Unpaid");

  document.querySelector("#openJobsCount").textContent = openJobs.length;
  document.querySelector("#dueTodayCount").textContent = dueToday.length;
  document.querySelector("#unpaidInvoicesCount").textContent = unpaid.length;

  document.querySelector("#queueList").innerHTML = workshopQueue.length
    ? workshopQueue.slice(0, 5).map((job) => `<div class="list-item"><div><strong>${quoteTitle(job)}</strong><div class="muted">${vehicleLabel(job.vehicle)} - job date ${formatDate(job.due)} - ${job.mechanic || "Unassigned"}</div></div>${statusBadge(job.status)}</div>`).join("")
    : `<div class="empty">No jobs currently in progress.</div>`;
}

function renderJobs() {
  const filtered = state.jobs.filter((job) => {
    const statusMatches = currentJobFilter === "Archived"
      ? job.archived
      : !job.archived && (currentJobFilter === "all" || job.status === currentJobFilter);
    const searchMatches = !searchTerm || jobSearchText(job).includes(searchTerm);
    return statusMatches && searchMatches;
  });

  if (currentJobFilter === "Collected") {
    filtered.sort((firstJob, secondJob) => Number(isJobPaid(firstJob)) - Number(isJobPaid(secondJob)));
  }
  if (currentJobFilter === "Archived") {
    filtered.sort((firstJob, secondJob) => String(invoiceForJob(secondJob.id)?.paidDate || "").localeCompare(String(invoiceForJob(firstJob.id)?.paidDate || "")));
  }

  document.querySelector("#jobsGrid").innerHTML = filtered.length
    ? filtered.map((job) => {
      const invoice = invoiceForJob(job.id);
      const collectedInvoiceAction = !job.archived && job.status === "Collected" && invoice
        ? `<button class="small-button payment-button ${invoice.status === "Paid" ? "payment-recorded" : "payment-outstanding"}" type="button" data-invoice-toggle="${invoice.id}">${invoice.status === "Paid" ? "Paid" : "Not Paid"}</button>`
        : "";
      const editQuoteAction = job.status === "Collected" || job.archived
        ? ""
        : `<button class="small-button" type="button" data-job-edit="${job.id}">Edit quote</button>`;
      const archivedActions = job.archived && invoice
        ? `<button class="small-button" type="button" data-invoice-view="${invoice.id}">View invoice</button><button class="small-button" type="button" data-invoice-print="${invoice.id}">Print invoice</button>`
        : "";
      return `
        <article class="job-card ${statusTone(job.status)}">
          <div class="job-card-header">
            <div>
              <h3>${vehicleRegistration(job.vehicle)}</h3>
              <span class="muted">${quoteTitle(job)} - ${byId("vehicles", job.vehicle)?.model || "Unknown model"}</span>
            </div>
            ${statusBadge(job.archived ? "Archived" : job.status)}
          </div>
          <div class="job-meta">
            <span>Job date: ${formatDate(job.due)}</span>
            <span>Mechanic: ${job.mechanic || "Unassigned"}</span>
            <span>Estimated time: ${jobEstimatedHours(job)} hours</span>
            <span>Labour: ${money(jobLabourTotal(job))}</span>
            <span>Parts: ${money(partsTotal(job.lineItems))}</span>
            <span class="parts-status">Parts status: ${partsStatusSummary(job)}</span>
            <span>Total quote: ${money(jobTotal(job))}</span>
            <span class="job-note">${job.notes || "No notes"}</span>
          </div>
          <div class="row-actions">
            ${editQuoteAction}
            ${collectedInvoiceAction}
            ${archivedActions}
            ${job.archived ? "" : `<button class="small-button danger-button" type="button" data-job-delete="${job.id}">Delete job</button>`}
          </div>
          ${job.archived ? `<div class="muted">Paid ${formatDate(invoice?.paidDate)} · Archived ${formatDate(job.archivedAt)}</div>` : `<label>Mechanic
            <select data-job-mechanic="${job.id}">
              ${mechanicOptions().map((name) => `<option value="${name}" ${name === (job.mechanic || "Unassigned") ? "selected" : ""}>${name}</option>`).join("")}
            </select>
          </label>
          <label>Status
            <select data-job-status="${job.id}">
              ${["Booked", "In progress", "Ready", "Collected"].map((status) => `<option ${status === job.status ? "selected" : ""}>${status}</option>`).join("")}
            </select>
          </label>`}
        </article>
      `;
    }).join("")
    : `<div class="empty">No quotes match this view.</div>`;
}

function renderCalendar() {
  const monthStart = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), 1);
  const monthEnd = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 0);
  const startOffset = (monthStart.getDay() + 6) % 7;
  const totalCells = Math.ceil((startOffset + monthEnd.getDate()) / 7) * 7;
  const monthName = monthStart.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  document.querySelector("#calendarMonth").textContent = monthName;
  document.querySelector("#calendarGrid").innerHTML = `
    ${weekDays.map((day) => `<div class="calendar-day-name">${day}</div>`).join("")}
    ${Array.from({ length: totalCells }, (_, index) => {
      const dayNumber = index - startOffset + 1;
      const inMonth = dayNumber >= 1 && dayNumber <= monthEnd.getDate();
      const date = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), dayNumber);
      const calendarDay = inMonth ? dateKey(date) : "";
      const dayJobs = inMonth ? state.jobs.filter((job) => job.due === calendarDay) : [];
      return `
        <div class="calendar-day ${inMonth ? "" : "muted-day"} ${calendarDay === today ? "today" : ""}">
          <div class="calendar-date">${inMonth ? dayNumber : ""}</div>
          <div class="calendar-jobs">
            ${dayJobs.map((job) => {
              const archivedInvoice = job.archived ? invoiceForJob(job.id) : null;
              const calendarAction = job.archived && archivedInvoice ? `data-invoice-view="${archivedInvoice.id}"` : `data-job-edit="${job.id}"`;
              return `
              <button class="calendar-job" type="button" ${calendarAction}>
                <strong>${quoteTitle(job)}</strong>
                <span>${vehicleLabel(job.vehicle)}</span>
                <span>${job.mechanic || "Unassigned"} - ${job.archived ? "Archived" : job.status}</span>
              </button>
            `;
            }).join("")}
          </div>
        </div>
      `;
    }).join("")}
  `;
}

function renderCustomers() {
  const rows = state.customers
    .filter((customer) => {
      const vehicles = customerVehicles(customer.id).map(vehicleSummary).join(" ");
      return !searchTerm || [customer.name, customer.phone, customer.email, customer.address, customer.postcode, vehicles].join(" ").toLowerCase().includes(searchTerm);
    })
    .map((customer) => {
      const vehicles = customerVehicles(customer.id);
      const vehicleList = vehicles.length ? vehicles.map((vehicle) => `<div><strong>${vehicle.model}</strong><br><span class="muted">${vehicle.plate} - ${Number(vehicle.mileage || 0).toLocaleString()} mi - MOT ${formatDate(vehicle.motDue)}</span></div>`).join("") : "-";
      return `<tr><td><strong>${customer.name}</strong><br><span class="muted">${customer.phone}<br>${customer.email || "-"}<br>${customer.address || "No address saved"}<br>${customer.vatCustomer ? "VAT customer" : "No VAT"}</span><br><div class="row-actions"><button class="small-button" data-customer-edit="${customer.id}">Edit</button><button class="small-button" data-customer-vat="${customer.id}">${customer.vatCustomer ? "Remove VAT" : "Mark VAT"}</button><button class="small-button danger-button" data-customer-delete="${customer.id}">Delete</button></div></td><td>${vehicleList}</td></tr>`;
    })
    .join("");

  document.querySelector("#customersList").innerHTML = `
    <h2>Customers</h2>
    <table><thead><tr><th>Customer</th><th>Make, model, mileage and MOT</th></tr></thead><tbody>${rows || `<tr><td colspan="2">No customers found.</td></tr>`}</tbody></table>
  `;
}

function resetCustomerForm() {
  const form = document.querySelector("#customerForm");
  form.reset();
  form.elements.customerId.value = "";
  document.querySelector("#customerFormTitle").textContent = "Add customer";
  document.querySelector("#saveCustomerBtn").textContent = "Save customer";
  document.querySelector("#cancelCustomerEditBtn").classList.add("hidden");
}

function editCustomer(customerId) {
  const customer = byId("customers", customerId);
  if (!customer) return;
  const form = document.querySelector("#customerForm");
  form.elements.customerId.value = customer.id;
  form.elements.name.value = customer.name || "";
  form.elements.phone.value = customer.phone || "";
  form.elements.email.value = customer.email || "";
  form.elements.postcode.value = customer.postcode || "";
  form.elements.address.value = customer.address || "";
  form.elements.vatCustomer.checked = Boolean(customer.vatCustomer);
  document.querySelector("#customerFormTitle").textContent = "Edit customer";
  document.querySelector("#saveCustomerBtn").textContent = "Update customer";
  document.querySelector("#cancelCustomerEditBtn").classList.remove("hidden");
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderVehicles() {
  const rows = state.vehicles
    .filter((vehicle) => !searchTerm || [vehicle.plate, vehicle.model, ownerName(vehicle.owner), vehicle.motDue].join(" ").toLowerCase().includes(searchTerm))
    .map((vehicle) => `<tr><td><strong>${vehicle.plate}</strong></td><td>${vehicle.model}</td><td>${ownerName(vehicle.owner)}</td><td>${Number(vehicle.mileage).toLocaleString()} mi</td><td>${formatDate(vehicle.motDue)}</td></tr>`)
    .join("");

  document.querySelector("#vehiclesList").innerHTML = `
    <h2>Vehicles</h2>
    <table><thead><tr><th>Reg</th><th>Model</th><th>Owner</th><th>Mileage</th><th>MOT due</th></tr></thead><tbody>${rows || `<tr><td colspan="5">No vehicles found.</td></tr>`}</tbody></table>
  `;
}

function renderInvoices() {
  const rows = state.invoices
    .filter((invoice) => !searchTerm || [invoice.id, invoice.status, vehicleLabel(byId("jobs", invoice.job)?.vehicle)].join(" ").toLowerCase().includes(searchTerm))
    .map((invoice) => {
      const job = byId("jobs", invoice.job);
      const customer = customerForJob(job);
      const vatButton = customer?.vatCustomer ? `<button class="small-button" data-invoice-vat="${invoice.id}">${invoice.vatEnabled ? "VAT off" : "VAT on"}</button>` : "";
      return `<tr><td><strong>${invoice.id.toUpperCase()}</strong></td><td>${job ? quoteTitle(job) : "Quote removed"}</td><td>${job ? vehicleLabel(job.vehicle) : "-"}</td><td>${money(invoiceTotal(invoice))}</td><td>${formatDate(invoice.due)}</td><td>${customer?.vatCustomer ? invoice.vatEnabled ? "VAT invoice" : "VAT available" : "No VAT"}</td><td>${statusBadge(invoice.status)}</td><td><div class="row-actions"><button class="small-button" data-invoice-view="${invoice.id}">View</button><button class="small-button" data-invoice-print="${invoice.id}">Print</button><button class="small-button" data-invoice-email="${invoice.id}">Email</button>${vatButton}<button class="small-button payment-button ${invoice.status === "Paid" ? "payment-recorded" : "payment-outstanding"}" data-invoice-toggle="${invoice.id}">${invoice.status === "Paid" ? "Paid" : "Not Paid"}</button></div></td></tr>`;
    })
    .join("");

  document.querySelector("#invoicesList").innerHTML = `
    <h2>Invoices</h2>
    <table><thead><tr><th>No.</th><th>Quote</th><th>Vehicle</th><th>Amount</th><th>Due</th><th>VAT</th><th>Status</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="8">No invoices found.</td></tr>`}</tbody></table>
  `;
}

function renderProfit() {
  if (!isAdmin()) {
    document.querySelector("#profitList").innerHTML = `<div class="empty">You do not have permission to view profit.</div>`;
    return;
  }
  if (!profitUnlocked) {
    document.querySelector("#profitList").innerHTML = `<div class="empty">Profit section locked.</div>`;
    return;
  }
  const availableMonths = Array.from({ length: 12 }, (_, index) => shiftedMonthKey(-index));
  if (!selectedProfitMonth || !availableMonths.includes(selectedProfitMonth)) selectedProfitMonth = availableMonths[0];
  const selectedMonthName = monthName(selectedProfitMonth);
  const overallNetProfit = profitThrough(selectedProfitMonth);
  const jobRows = state.jobs.filter((job) => isJobPaidInMonth(job, selectedProfitMonth)).map((job) => {
    const invoice = invoiceForJob(job.id);
    const paid = invoice?.status === "Paid";
    const countedThisMonth = isJobPaidInMonth(job, selectedProfitMonth) ? jobLabourTotal(job) : 0;
    return `<tr><td><strong>${quoteTitle(job)}</strong></td><td>${vehicleLabel(job.vehicle)}</td><td>${paid ? "Paid" : "Unpaid"}</td><td>${formatDate(invoice?.paidDate)}</td><td>${money(jobLabourTotal(job))}</td><td>${money(partsTotal(job.lineItems))}</td><td>${money(countedThisMonth)}</td></tr>`;
  }).join("");
  const expenseRows = state.expenses
    .filter((expense) => ![WORK_LOG_TYPE, STOCK_ITEM_TYPE].includes(expense.type) && monthKey(expense.expenseDate) === selectedProfitMonth)
    .slice()
    .sort((first, second) => String(second.expenseDate || "").localeCompare(String(first.expenseDate || "")))
    .map((expense) => `
      <tr>
        <td>${formatDate(expense.expenseDate)}</td>
        <td><strong>${expenseTypeLabel(expense.type)}</strong></td>
        <td>${expense.type === "mechanic" ? expense.mechanicName || "-" : "-"}</td>
        <td>${expense.description || "-"}</td>
        <td>${money(expense.amount)}</td>
        <td><button class="small-button" data-expense-delete="${expense.id}">Delete</button></td>
      </tr>
  `).join("");
  document.querySelector("#profitList").innerHTML = `
    <div class="profit-month-tabs" role="tablist" aria-label="Profit month">
      ${availableMonths.map((month) => `<button class="profit-month-tab ${month === selectedProfitMonth ? "active" : ""}" type="button" role="tab" aria-selected="${month === selectedProfitMonth}" data-profit-month="${month}">${monthName(month)}</button>`).join("")}
    </div>
    <h2>Profit — ${selectedMonthName}</h2>
    <div class="profit-grid">
      <div class="profit-box overall-profit"><span>Overall net profit</span><strong>${money(overallNetProfit)}</strong></div>
      <div class="profit-box"><span>${selectedMonthName} net profit</span><strong>${money(profit(selectedProfitMonth))}</strong></div>
      <div class="profit-box"><span>${selectedMonthName} paid labour</span><strong>${money(paidLabourIncome(selectedProfitMonth))}</strong></div>
      <div class="profit-box"><span>${selectedMonthName} expenses</span><strong>${money(expensesTotal(selectedProfitMonth))}</strong></div>
    </div>
    <p class="muted">Each month is calculated from invoices paid and expenses dated within that calendar month.</p>
    <h2>Expenses</h2>
    <table><thead><tr><th>Date</th><th>Type</th><th>Mechanic</th><th>Description</th><th>Amount</th><th></th></tr></thead><tbody>${expenseRows || `<tr><td colspan="6">No expenses yet.</td></tr>`}</tbody></table>
    <h2>Quotes</h2>
    <table><thead><tr><th>Quote</th><th>Vehicle</th><th>Payment</th><th>Paid date</th><th>Labour</th><th>Parts</th><th>${selectedMonthName} labour counted</th></tr></thead><tbody>${jobRows || `<tr><td colspan="7">No quotes yet.</td></tr>`}</tbody></table>
  `;
}

function renderStock() {
  const panel = document.querySelector("#stockList");
  if (!isAdmin()) {
    panel.innerHTML = `<div class="empty">You do not have permission to view stock.</div>`;
    return;
  }
  const activeInput = document.activeElement;
  const editingStockAmount = panel.contains(activeInput)
    && (activeInput?.matches("[data-stock-invested]") || activeInput?.matches("[data-stock-sold-for]"));
  if (editingStockAmount) return;
  const items = stockItems()
    .filter((item) => !searchTerm || [item.partName, item.stockAmount ?? item.quantity, item.invested, item.soldFor].join(" ").toLowerCase().includes(searchTerm))
    .slice()
    .sort((first, second) => String(second.createdAt || "").localeCompare(String(first.createdAt || "")));
  const stockInitialAmount = (item) => Number(item.stockAmount ?? item.quantity ?? 0);
  const stockTotalInvested = (item) => stockInitialAmount(item) + Number(item.invested || 0);
  const totalInvested = stockItems().reduce((total, item) => total + stockTotalInvested(item), 0);
  const totalSold = stockItems().reduce((total, item) => total + Number(item.soldFor || 0), 0);
  const rows = items.map((item) => {
    const draft = stockDrafts.get(item.id) || {};
    const investedValue = draft.invested ?? Number(item.invested || 0).toFixed(2);
    const soldForValue = draft.soldFor ?? Number(item.soldFor || 0).toFixed(2);
    return `
    <tr>
      <td><strong>${item.partName}</strong></td>
      <td>${money(stockInitialAmount(item))}</td>
      <td><label class="currency-input"><span>£</span><input class="table-money-input" data-stock-invested="${item.id}" type="text" inputmode="decimal" value="${investedValue}" aria-label="Amount invested for ${item.partName} in pounds" /></label></td>
      <td><label class="currency-input"><span>£</span><input class="table-money-input" data-stock-sold-for="${item.id}" type="text" inputmode="decimal" value="${soldForValue}" aria-label="Sold for amount for ${item.partName} in pounds" /></label></td>
      <td>${money(stockTotalInvested(item))}</td>
      <td>${money(Number(item.soldFor || 0) - stockTotalInvested(item))}</td>
      <td><div class="row-actions"><button class="small-button" data-stock-save="${item.id}">Save</button><button class="small-button" data-stock-delete="${item.id}">Delete</button></div></td>
    </tr>
  `;
  }).join("");
  panel.innerHTML = `
    <h2>Stock</h2>
    <div class="profit-grid">
      <div class="profit-box"><span>Total invested</span><strong>${money(totalInvested)}</strong></div>
      <div class="profit-box"><span>Total sold for</span><strong>${money(totalSold)}</strong></div>
      <div class="profit-box"><span>Profit</span><strong>${money(totalSold - totalInvested)}</strong></div>
    </div>
    <table><thead><tr><th>Part bought</th><th>Amount</th><th>Additional invested</th><th>Sold for</th><th>Total invested</th><th>Profit</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="7">No stock added yet.</td></tr>`}</tbody></table>
  `;
}
function canManageWorkLog(entry) {
  if (isAdmin()) return true;
  const assignedToCurrentUser = entry.userId === currentUser?.id || entry.userEmail === currentUser?.email;
  const createdByCurrentUser = entry.createdById === currentUser?.id || entry.createdByEmail === currentUser?.email;
  return assignedToCurrentUser && createdByCurrentUser && entry.createdByRole !== "admin";
}

function renderWorkLogUserOptions(selectedEmail = null) {
  const select = document.querySelector('#workLogForm select[name="workLogUser"]');
  if (!select) return;
  if (!isAdmin()) {
    const email = currentUser?.email || "";
    select.innerHTML = `<option value="${email}">${email}</option>`;
    select.value = email;
    return;
  }
  const currentSelection = select.value;
  const users = new Map();
  const addUser = (email, userId = "") => {
    const normalizedEmail = String(email || "").trim();
    if (!normalizedEmail) return;
    const existing = users.get(normalizedEmail);
    users.set(normalizedEmail, { email: normalizedEmail, userId: userId || existing?.userId || "" });
  };
  userProfiles.forEach((profile) => addUser(profile.email, profile.user_id));
  loginLogs.forEach((entry) => addUser(entry.user_email));
  workLogs().forEach((entry) => addUser(entry.userEmail, entry.userId));
  addUser(currentUser?.email, currentUser?.id);
  const options = [...users.values()].sort((first, second) => first.email.localeCompare(second.email));
  select.innerHTML = options.length
    ? options.map((user) => {
      const username = user.email.includes("@") ? user.email.split("@")[0] : user.email;
      return `<option value="${user.email}">${username}${username === user.email ? "" : ` (${user.email})`}</option>`;
    }).join("")
    : `<option value="">No users found</option>`;
  const preferredEmail = selectedEmail || currentSelection || currentUser?.email;
  if (options.some((user) => user.email === preferredEmail)) select.value = preferredEmail;
}

function renderWorkLogs() {
  const panel = document.querySelector("#workLogsList");
  if (!panel) return;
  renderWorkLogUserOptions();
  const monthInput = document.querySelector("#workLogMonth");
  if (!monthInput.value) monthInput.value = dateKey(new Date()).slice(0, 7);
  const selectedMonth = monthInput.value;
  const monthLabel = new Date(`${selectedMonth}-01T12:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const scopedLogs = workLogs()
    .filter((entry) => isAdmin() || entry.userId === currentUser?.id || entry.userEmail === currentUser?.email);
  const monthlyLogs = scopedLogs.filter((entry) => String(entry.workDate || "").startsWith(selectedMonth));
  const visibleLogs = monthlyLogs
    .filter((entry) => !searchTerm || [entry.userEmail, entry.description, entry.workDate, entry.startTime, entry.endTime].join(" ").toLowerCase().includes(searchTerm))
    .sort((first, second) => `${second.workDate} ${second.startTime}`.localeCompare(`${first.workDate} ${first.startTime}`));
  const totalHours = monthlyLogs.reduce((total, entry) => total + workLogHours(entry), 0);
  const userTotals = isAdmin()
    ? [...monthlyLogs.reduce((totals, entry) => {
      const email = entry.userEmail || "Unknown user";
      totals.set(email, (totals.get(email) || 0) + workLogHours(entry));
      return totals;
    }, new Map()).entries()]
    : [];
  const rows = visibleLogs.map((entry) => {
    const creatorLabel = entry.createdByRole === "admin" ? "Admin" : entry.createdByEmail || "Sales user";
    const controls = canManageWorkLog(entry)
      ? `<div class="row-actions"><button class="small-button" data-work-log-edit="${entry.id}">Edit</button><button class="small-button danger-button" data-work-log-delete="${entry.id}">Delete</button></div>`
      : `<span class="muted">Admin managed</span>`;
    return `
      <tr>
        ${isAdmin() ? `<td><strong>${entry.userEmail || "Unknown user"}</strong></td>` : ""}
        <td>${formatDate(entry.workDate)}</td>
        <td>${entry.startTime}–${entry.endTime}</td>
        <td>${entry.description}</td>
        <td><strong>${formatHours(workLogHours(entry))}</strong></td>
        <td>${creatorLabel}</td>
        <td>${controls}</td>
      </tr>
    `;
  }).join("");
  const columnCount = isAdmin() ? 7 : 6;
  panel.innerHTML = `
    <h2>${isAdmin() ? "All work logs" : "My work logs"} — ${monthLabel}</h2>
    <div class="work-log-summary">
      <div class="profit-box"><span>${isAdmin() ? "Total hours worked" : "Your total hours"} — ${monthLabel}</span><strong>${formatHours(totalHours)}</strong></div>
      ${userTotals.map(([email, hours]) => `<div class="profit-box"><span>${email}</span><strong>${formatHours(hours)}</strong></div>`).join("")}
    </div>
    <table><thead><tr>${isAdmin() ? "<th>User</th>" : ""}<th>Date</th><th>Time</th><th>Description</th><th>Hours</th><th>Added by</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="${columnCount}">No work logged yet.</td></tr>`}</tbody></table>
  `;
}

function resetWorkLogForm() {
  const form = document.querySelector("#workLogForm");
  form.reset();
  form.elements.workLogId.value = "";
  form.elements.workDate.value = dateKey(new Date());
  renderWorkLogUserOptions(currentUser?.email);
  document.querySelector("#workLogFormTitle").textContent = "Log work";
  document.querySelector("#saveWorkLogBtn").textContent = "Save work log";
  document.querySelector("#cancelWorkLogEditBtn").classList.add("hidden");
}

function editWorkLog(entryId) {
  const entry = workLogs().find((item) => item.id === entryId);
  if (!entry || !canManageWorkLog(entry)) return;
  const form = document.querySelector("#workLogForm");
  form.elements.workLogId.value = entry.id;
  form.elements.workDate.value = entry.workDate;
  form.elements.startTime.value = entry.startTime;
  form.elements.endTime.value = entry.endTime;
  form.elements.description.value = entry.description;
  renderWorkLogUserOptions(entry.userEmail);
  document.querySelector("#workLogFormTitle").textContent = `Edit ${entry.userEmail || "work"} entry`;
  document.querySelector("#saveWorkLogBtn").textContent = "Save changes";
  document.querySelector("#cancelWorkLogEditBtn").classList.remove("hidden");
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderUserLogs() {
  const panel = document.querySelector("#userLogsList");
  if (!isAdmin()) {
    panel.innerHTML = `<div class="empty">You do not have permission to view user logs.</div>`;
    return;
  }
  const rows = loginLogs.map((log) => `
    <tr>
      <td>${log.user_email || "-"}</td>
      <td>${log.action || "-"}</td>
      <td>${log.created_at ? new Date(log.created_at).toLocaleString("en-GB") : "-"}</td>
    </tr>
  `).join("");
  panel.innerHTML = `
    <h2>User logs</h2>
    <table><thead><tr><th>User</th><th>Action</th><th>Time</th></tr></thead><tbody>${rows || `<tr><td colspan="3">No user logs yet.</td></tr>`}</tbody></table>
  `;
}

function renderSelects() {
  const selectedOwner = document.querySelector('#vehicleForm select[name="owner"]').value;
  const selectedQuoteCustomer = document.querySelector('#jobForm select[name="newVehicleCustomer"]').value;
  const selectedQuoteVehicle = document.querySelector('#jobForm select[name="vehicle"]').value;
  const assignedMechanic = document.querySelector('#jobForm select[name="mechanic"]').value || "Unassigned";
  const ownerOptions = state.customers.length
    ? state.customers.map((customer) => `<option value="${customer.id}">${customer.name}</option>`).join("")
    : `<option value="">Add a customer first</option>`;
  document.querySelector('#vehicleForm select[name="owner"]').innerHTML = ownerOptions;
  document.querySelector('#jobForm select[name="newVehicleCustomer"]').innerHTML = ownerOptions;
  document.querySelector('#vehicleForm select[name="owner"]').value = state.customers.some((customer) => customer.id === selectedOwner) ? selectedOwner : document.querySelector('#vehicleForm select[name="owner"]').value;
  document.querySelector('#jobForm select[name="newVehicleCustomer"]').value = state.customers.some((customer) => customer.id === selectedQuoteCustomer) ? selectedQuoteCustomer : document.querySelector('#jobForm select[name="newVehicleCustomer"]').value;

  const vehicleOptions = state.vehicles.length
    ? state.vehicles.map((vehicle) => `<option value="${vehicle.id}">${vehicle.plate} - ${vehicle.model} (${ownerName(vehicle.owner)})</option>`).join("")
    : `<option value="">No vehicles yet</option>`;
  document.querySelector('#jobForm select[name="vehicle"]').innerHTML = vehicleOptions;
  document.querySelector('#jobForm select[name="vehicle"]').value = state.vehicles.some((vehicle) => vehicle.id === selectedQuoteVehicle) ? selectedQuoteVehicle : document.querySelector('#jobForm select[name="vehicle"]').value;

  const mechanicSelectOptions = mechanicOptions().map((name) => `<option value="${name}">${name}</option>`).join("");
  document.querySelector('#jobForm select[name="mechanic"]').innerHTML = mechanicSelectOptions;
  document.querySelector('#jobForm select[name="mechanic"]').value = mechanicOptions().includes(assignedMechanic) ? assignedMechanic : "Unassigned";
}

function setVehicleMode(mode) {
  const useNewVehicle = mode === "new";
  existingVehicleFields.classList.toggle("hidden", useNewVehicle);
  newVehicleFields.classList.toggle("hidden", !useNewVehicle);

  document.querySelector('#jobForm select[name="vehicle"]').required = !useNewVehicle;
  ["newPlate", "newModel", "newMileage"].forEach((name) => {
    document.querySelector(`#jobForm [name="${name}"]`).required = useNewVehicle;
  });
  setCustomerMode(document.querySelector('#jobForm input[name="customerMode"]:checked').value);
}

function setCustomerMode(mode) {
  const useNewCustomer = mode === "new";
  const useNewVehicle = document.querySelector('#jobForm input[name="vehicleMode"]:checked').value === "new";
  existingCustomerField.classList.toggle("hidden", !useNewVehicle || useNewCustomer);
  newCustomerFields.classList.toggle("hidden", !useNewVehicle || !useNewCustomer);
  document.querySelector('#jobForm select[name="newVehicleCustomer"]').required = useNewVehicle && !useNewCustomer;
  ["newCustomerName", "newCustomerPhone", "newCustomerAddress"].forEach((name) => {
    document.querySelector(`#jobForm [name="${name}"]`).required = useNewVehicle && useNewCustomer;
  });
}

function selectedQuoteCustomer() {
  const form = document.querySelector("#jobForm");
  const vehicleMode = form.querySelector('input[name="vehicleMode"]:checked')?.value || "new";
  if (vehicleMode === "existing") {
    const vehicle = byId("vehicles", form.querySelector('select[name="vehicle"]').value);
    return vehicle ? byId("customers", vehicle.owner) : null;
  }
  const customerMode = form.querySelector('input[name="customerMode"]:checked')?.value || "existing";
  if (customerMode === "new") {
    return { vatCustomer: form.querySelector('input[name="newCustomerVat"]').checked };
  }
  return byId("customers", form.querySelector('select[name="newVehicleCustomer"]').value);
}

function quoteHasVat() {
  return Boolean(selectedQuoteCustomer()?.vatCustomer);
}

function renderQuoteBuilder() {
  const labourTotal = labourItemsTotal(activeQuoteItems);
  const partTotal = partsTotal(activeQuoteItems);
  const netTotal = labourTotal + partTotal;
  const vatTotal = quoteHasVat() ? netTotal * VAT_RATE : 0;
  const quoteVatLine = document.querySelector("#quoteVatLine");
  document.querySelector("#quoteItemsList").innerHTML = activeQuoteItems.length
    ? activeQuoteItems.map((item, index) => `<div class="quote-line"><span><strong>${item.qty}x ${item.name}</strong><br><small class="muted">${itemType(item) === "labour" ? "Labour" : `<span class="parts-status">Part - ${partStatus(item)}</span>`} - ${money(item.unitPrice)} each</small></span>${itemType(item) === "part" ? `<select data-part-status-index="${index}">${["Needed", "Ordered", "Arrived", "Fitted"].map((status) => `<option ${status === partStatus(item) ? "selected" : ""}>${status}</option>`).join("")}</select>` : ""}<strong>${money(lineTotal(item))}</strong><button class="small-button" type="button" data-remove-quote-item="${index}">Remove</button></div>`).join("")
    : `<div class="empty">No extra labour or parts added yet.</div>`;
  document.querySelector("#quoteLabourTotal").textContent = money(labourTotal);
  document.querySelector("#quotePartsTotal").textContent = money(partTotal);
  document.querySelector("#quoteVatTotal").textContent = money(vatTotal);
  quoteVatLine.classList.toggle("hidden", vatTotal === 0);
  document.querySelector("#quoteGrandTotal").textContent = money(netTotal + vatTotal);
}

function resetQuoteForm() {
  document.querySelector("#jobForm").reset();
  const currentDate = dateKey(new Date());
  document.querySelector('#jobForm input[name="due"]').value = nextWeekday(currentDate);
  document.querySelector("#availabilityFrom").min = currentDate;
  document.querySelector("#availabilityFrom").value = currentDate;
  document.querySelector('#jobForm input[name="vehicleMode"][value="new"]').checked = true;
  document.querySelector(`#jobForm input[name="customerMode"][value="${state.customers.length ? "existing" : "new"}"]`).checked = true;
  activeQuoteItems = [];
  activeEditJobId = null;
  document.querySelector("#jobDialogTitle").textContent = "New quote";
  document.querySelector("#saveJobBtn").textContent = "Create quote";
  renderSelects();
  setVehicleMode("new");
  renderQuoteBuilder();
  renderMechanicAvailability();
}

function openNewQuoteDialog() {
  resetQuoteForm();
  jobDialog.showModal();
}

function openEditQuoteDialog(jobId) {
  const job = byId("jobs", jobId);
  if (!job) return;
  activeEditJobId = jobId;
  document.querySelector("#jobForm").reset();
  renderSelects();
  document.querySelector("#jobDialogTitle").textContent = "Edit quote";
  document.querySelector("#saveJobBtn").textContent = "Save quote";
  document.querySelector('#jobForm input[name="vehicleMode"][value="existing"]').checked = true;
  document.querySelector('#jobForm select[name="vehicle"]').value = job.vehicle;
  document.querySelector('#jobForm input[name="due"]').value = job.due;
  const currentDate = dateKey(new Date());
  document.querySelector("#availabilityFrom").min = currentDate;
  document.querySelector("#availabilityFrom").value = job.due >= currentDate ? job.due : currentDate;
  document.querySelector('#jobForm select[name="mechanic"]').value = job.mechanic || "Unassigned";
  document.querySelector('#jobForm input[name="estimatedHours"]').value = jobEstimatedHours(job);
  document.querySelector('#jobForm select[name="status"]').value = job.status;
  document.querySelector('#jobForm textarea[name="notes"]').value = job.notes || "";
  activeQuoteItems = (job.lineItems || []).map((item) => ({ ...item }));
  setVehicleMode("existing");
  renderQuoteBuilder();
  renderMechanicAvailability();
  jobDialog.showModal();
}

function getInvoiceDetails(invoiceId) {
  const invoice = byId("invoices", invoiceId);
  const job = invoice ? byId("jobs", invoice.job) : null;
  const vehicle = job ? byId("vehicles", job.vehicle) : null;
  const customer = vehicle ? byId("customers", vehicle.owner) : null;
  return { invoice, job, vehicle, customer };
}

function invoiceHtml(invoiceId) {
  const { invoice, job, vehicle, customer } = getInvoiceDetails(invoiceId);
  if (!invoice || !job) return `<div class="empty">Invoice not found.</div>`;
  const items = job.lineItems || [];
  const vatEnabled = isVatInvoice(invoice);
  const rows = items.map((item) => {
    const net = lineTotal(item);
    const vat = vatEnabled ? net * VAT_RATE : 0;
    const description = `${item.name}<br><small class="muted">${itemType(item) === "labour" ? "Labour" : "Part"}</small>`;
    return vatEnabled
      ? `<tr><td>${description}</td><td>${item.qty}</td><td>${money(item.unitPrice)}</td><td>${money(net)}</td><td>20%</td><td>${money(vat)}</td><td>${money(net + vat)}</td></tr>`
      : `<tr><td>${description}</td><td>${item.qty}</td><td>${money(item.unitPrice)}</td><td>${money(net)}</td></tr>`;
  }).join("");
  const invoiceHead = vatEnabled
    ? `<thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Net</th><th>VAT rate</th><th>VAT</th><th>Total</th></tr></thead>`
    : `<thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead>`;
  const vatRows = vatEnabled
    ? `<tr><th colspan="6">Net total</th><th>${money(invoiceSubtotal(invoice))}</th></tr>
        <tr><th colspan="6">Total VAT</th><th>${money(invoiceVatAmount(invoice))}</th></tr>`
    : "";
  const totalColspan = vatEnabled ? 6 : 3;
  const senderName = invoiceBusinessName(invoice);

  return `
    <div class="invoice-title">
      <div>
        <h3>${senderName}</h3>
        <div class="muted">${business.address}</div>
        ${vatEnabled ? `<div class="muted">VAT No. ${business.vatNumber}</div>` : ""}
      </div>
      <div>
        <strong>${invoice.id.toUpperCase()}</strong><br>
        <span class="muted">Status: ${invoice.status}</span>
        ${vatEnabled ? `<br><span class="muted">VAT invoice</span>` : ""}
      </div>
    </div>
    <div class="invoice-meta">
      <div><strong>Invoice date</strong><br>${formatDate(today)}</div>
      <div><strong>Due date</strong><br>${formatDate(invoice.due)}</div>
    </div>
    <div class="invoice-parties">
      <div><strong>Bill to</strong><br>${customer?.name || "-"}<br>${customer?.phone || ""}<br>${customer?.email || ""}<br>${customer?.address || ""}</div>
      <div><strong>Vehicle</strong><br>${vehicle ? `${vehicle.plate} - ${vehicle.model}` : "-"}</div>
    </div>
    <table>
      ${invoiceHead}
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><th colspan="${totalColspan}">${vatEnabled ? "Labour total (net)" : "Labour total"}</th><th>${money(jobLabourTotal(job))}</th></tr>
        <tr><th colspan="${totalColspan}">${vatEnabled ? "Parts total (net)" : "Parts total"}</th><th>${money(partsTotal(job.lineItems))}</th></tr>
        ${vatRows}
        <tr><th colspan="${totalColspan}">Grand total</th><th>${money(invoiceTotal(invoice))}</th></tr>
      </tfoot>
    </table>
    <div class="invoice-bank-details">
      <strong>Bank Details</strong><br>
      ${vatEnabled ? business.vatBankName : business.bankName}<br>
      ${vatEnabled ? business.vatAccountNumber : business.accountNumber}<br>
      ${business.sortCode}
    </div>
  `;
}

function showInvoice(invoiceId) {
  activeInvoiceId = invoiceId;
  document.querySelector("#invoiceContent").innerHTML = invoiceHtml(invoiceId);
  invoiceDialog.showModal();
}

async function createInvoicePdf(invoiceId) {
  if (!window.jspdf?.jsPDF || !window.html2canvas) throw new Error("The PDF generator has not loaded. Refresh and try again.");
  const { invoice, vehicle } = getInvoiceDetails(invoiceId);
  if (!invoice) throw new Error("Invoice not found.");
  const source = document.createElement("div");
  source.className = "invoice-document invoice-pdf-source";
  source.innerHTML = invoiceHtml(invoiceId);
  document.body.appendChild(source);
  try {
    const pdf = new window.jspdf.jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
    await new Promise((resolve) => {
      pdf.html(source, {
        callback: resolve,
        x: 28,
        y: 28,
        width: 539,
        windowWidth: 760,
        autoPaging: "text",
        html2canvas: { scale: 1, backgroundColor: "#ffffff" }
      });
    });
    const registration = String(vehicle?.plate || "vehicle").replace(/[^a-z0-9]/gi, "").toUpperCase();
    const filename = `Invoice-${invoice.id.toUpperCase()}-${registration}.pdf`;
    return { blob: pdf.output("blob"), filename };
  } finally {
    source.remove();
  }
}

async function emailInvoice(invoiceId) {
  const { invoice, job, vehicle, customer } = getInvoiceDetails(invoiceId);
  if (!invoice || !job) return;
  const senderName = invoiceBusinessName(invoice);
  const subjectText = `Invoice ${invoice.id.toUpperCase()} from ${senderName}`;
  const subject = encodeURIComponent(subjectText);
  const vatText = isVatInvoice(invoice)
    ? `\nVAT No: ${business.vatNumber}\nNet total: ${money(invoiceSubtotal(invoice))}\nTotal VAT 20%: ${money(invoiceVatAmount(invoice))}`
    : "";
  const bodyText =
    `Hi ${customer?.name || ""},\n\nPlease find your invoice details below.\n\nInvoice: ${invoice.id.toUpperCase()}\nBusiness: ${senderName}\nAddress: ${business.address}\nCustomer address: ${customer?.address || "-"}\nVehicle: ${vehicle ? `${vehicle.plate} - ${vehicle.model}` : "-"}\nQuote: ${quoteTitle(job)}\nLabour: ${money(jobLabourTotal(job))}\nParts: ${money(partsTotal(job.lineItems))}${vatText}\nGrand total: ${money(invoiceTotal(invoice))}\nDue: ${formatDate(invoice.due)}\n\nThanks,\n${senderName}`;
  const body = encodeURIComponent(bodyText);
  const emailButton = document.querySelector("#emailInvoiceBtn");
  const originalButtonText = emailButton?.textContent || "Email invoice";
  if (emailButton) {
    emailButton.disabled = true;
    emailButton.textContent = "Creating PDF...";
  }
  try {
    const { blob, filename } = await createInvoicePdf(invoiceId);
    const file = new File([blob], filename, { type: "application/pdf" });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: subjectText,
        text: `${bodyText}\n\nSend to: ${customer?.email || "customer"}`
      });
      return;
    }
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 30000);
    window.alert(`${filename} has been downloaded. Your email window will now open; attach the downloaded PDF before sending.`);
    window.location.href = `mailto:${customer?.email || ""}?subject=${subject}&body=${body}`;
  } catch (error) {
    if (error?.name !== "AbortError") window.alert(error.message || "Could not create the invoice PDF.");
  } finally {
    if (emailButton) {
      emailButton.disabled = false;
      emailButton.textContent = originalButtonText;
    }
  }
}

function exportData() {
  const backup = {
    exportedAt: new Date().toISOString(),
    app: "OG Autos Workshop Manager",
    data: state
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `og-autos-backup-${today}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function validImportedState(imported) {
  return imported
    && Array.isArray(imported.customers)
    && Array.isArray(imported.vehicles)
    && Array.isArray(imported.jobs)
    && Array.isArray(imported.invoices)
    && Array.isArray(imported.expenses);
}

function importData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const parsed = JSON.parse(reader.result);
      const importedState = parsed.data || parsed;
      if (!validImportedState(importedState)) {
        window.alert("That backup file does not look like OG Autos data.");
        return;
      }
      const confirmed = window.confirm("Importing will replace the data currently saved in this browser. Continue?");
      if (!confirmed) return;
      state = importedState;
      normalizeState();
      save();
      render();
      window.alert("Data imported successfully.");
    } catch (error) {
      window.alert("Could not import that file. Please choose a valid JSON backup.");
    }
  });
  reader.readAsText(file);
}

function setLoginMessage(message) {
  loginMessage.textContent = message || "";
}

function showAuthenticatedApp(show) {
  loginScreen.classList.toggle("hidden", show);
  appShell.classList.toggle("auth-locked", !show);
}

function stopSalesInactivityTimer() {
  window.clearTimeout(salesInactivityTimer);
  salesInactivityTimer = null;
}

function resetSalesInactivityTimer() {
  if (!currentUser || isAdmin()) {
    stopSalesInactivityTimer();
    return;
  }
  window.clearTimeout(salesInactivityTimer);
  salesInactivityTimer = window.setTimeout(() => {
    signOutUser("Signed out after 10 minutes of inactivity.", "auto logout");
  }, SALES_INACTIVITY_MS);
}

async function signOutUser(message = "Signed out.", action = "logout") {
  const signedOutUser = currentUser;
  stopSalesInactivityTimer();
  await recordLoginAction(action, signedOutUser);
  stopSalesInactivityTimer();
  currentUser = null;
  currentProfile = null;
  loginLogs = [];
  userProfiles = [];
  remoteReady = false;
  remoteSavePending = false;
  profitUnlocked = false;
  stopLiveSync();
  showAuthenticatedApp(false);
  setLoginMessage(message);
  window.clearTimeout(saveTimer);
  saveTimer = null;
  if (supabaseClient) {
    const { error } = await supabaseClient.auth.signOut();
    if (error) setLoginMessage(`${message} Supabase said: ${error.message}`);
  }
}

function queueRemoteSave() {
  if (!supabaseClient) return;
  remoteSavePending = true;
  if (!remoteReady || syncingRemote) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    saveStateToSupabase().catch((error) => {
      console.error("Supabase save failed", error);
    });
  }, 100);
}

async function loadTableRows(table) {
  const { data, error } = await supabaseClient.from(table).select("id,data");
  if (error) throw error;
  return (data || []).map((row) => ({ ...row.data, id: row.id }));
}

async function loadStateFromSupabase({ pushLocalWhenEmpty = true, replaceWhenEmpty = false } = {}) {
  remoteReady = false;
  const remoteState = {};
  let hasRemoteData = false;

  for (const table of DATA_TABLES) {
    remoteState[table] = await loadTableRows(table);
    if (remoteState[table].length) hasRemoteData = true;
  }

  if ((hasRemoteData || replaceWhenEmpty) && !remoteSavePending) state = remoteState;
  normalizeState();
  remoteReady = true;

  if (remoteSavePending) queueRemoteSave();

  if (pushLocalWhenEmpty && !hasRemoteData && DATA_TABLES.some((table) => state[table].length)) {
    await saveStateToSupabase();
  }
}

async function saveTableRows(table) {
  const rows = state[table].map((item) => ({ id: item.id, data: item }));
  const { data: existing, error: selectError } = await supabaseClient.from(table).select("id");
  if (selectError) throw selectError;

  const nextIds = new Set(rows.map((row) => row.id));
  const deleteIds = (existing || []).map((row) => row.id).filter((id) => !nextIds.has(id));
  if (deleteIds.length) {
    const { error } = await supabaseClient.from(table).delete().in("id", deleteIds);
    if (error) throw error;
  }

  if (rows.length) {
    const { error } = await supabaseClient.from(table).upsert(rows, { onConflict: "id" });
    if (error) throw error;
  }
}

async function saveRemoteRecord(table, item) {
  if (!supabaseClient || !item) throw new Error("Remote save is unavailable.");
  if (!remoteReady) throw new Error("Remote data is refreshing.");
  const { error } = await withTimeout(
    supabaseClient.from(table).upsert({ id: item.id, data: item }, { onConflict: "id" }),
    `Saving ${table} to the cloud timed out.`
  );
  if (error) throw error;
}

async function broadcastRemoteChange() {
  if (!realtimeChannel) return;
  await withTimeout(
    realtimeChannel.send({ type: "broadcast", event: "state-changed", payload: { updatedAt: new Date().toISOString() } }),
    "Notifying other users timed out."
  );
}

async function saveStateToSupabase() {
  if (!remoteReady || !supabaseClient) return;
  if (syncingRemote) {
    remoteSavePending = true;
    return;
  }
  remoteSavePending = false;
  syncingRemote = true;
  try {
    for (const table of DATA_TABLES) {
      await saveTableRows(table);
    }
    await broadcastRemoteChange();
  } finally {
    syncingRemote = false;
    if (remoteSavePending) queueRemoteSave();
  }
}

function queueRemoteReload() {
  if (!currentUser || !remoteReady || !supabaseClient) return;
  window.clearTimeout(remoteReloadTimer);
  remoteReloadTimer = window.setTimeout(async () => {
    remoteReloadTimer = null;
    if (syncingRemote || remoteSavePending || saveTimer) {
      queueRemoteReload();
      return;
    }
    try {
      await loadStateFromSupabase({ pushLocalWhenEmpty: false, replaceWhenEmpty: true });
      render();
      renderQuoteBuilder();
    } catch (error) {
      console.error("Supabase live reload failed", error);
    }
  }, 150);
}

function startLiveSync() {
  if (!supabaseClient || realtimeChannel) return;
  let channel = supabaseClient.channel("workshop-live-sync");
  channel = channel.on("broadcast", { event: "state-changed" }, queueRemoteReload);
  channel = channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "login_logs" }, refreshAdminLogs);
  DATA_TABLES.forEach((table) => {
    channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, queueRemoteReload);
  });
  realtimeChannel = channel.subscribe();
  window.clearInterval(remotePollTimer);
  remotePollTimer = window.setInterval(() => {
    queueRemoteReload();
    refreshAdminLogs();
  }, 3000);
}

function stopLiveSync() {
  window.clearTimeout(remoteReloadTimer);
  window.clearInterval(remotePollTimer);
  remoteReloadTimer = null;
  remotePollTimer = null;
  if (supabaseClient && realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
  }
  realtimeChannel = null;
}

async function loadCurrentProfile(user) {
  currentProfile = { user_id: user.id, email: user.email, role: "sales" };
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("user_id,email,role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    console.error("Profile load failed", error);
    return;
  }
  if (data) currentProfile = { ...data, role: String(data.role || "sales").trim().toLowerCase() };
}

async function loadUserProfiles() {
  userProfiles = [];
  if (!isAdmin() || !supabaseClient) return;
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("user_id,email,role")
    .order("email", { ascending: true });
  if (error) {
    console.error("User profiles load failed", error);
    return;
  }
  userProfiles = data || [];
}

async function loadLoginLogs() {
  if (!isAdmin()) {
    loginLogs = [];
    return;
  }
  const { data, error } = await supabaseClient
    .from("login_logs")
    .select("user_email,action,created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error("Login logs load failed", error);
    return;
  }
  loginLogs = data || [];
}

async function refreshAdminLogs() {
  if (!currentUser || !isAdmin() || !supabaseClient) return;
  await loadLoginLogs();
  renderUserLogs();
}

async function recordLoginAction(action, user = currentUser) {
  if (!supabaseClient || !user) return;
  const { error } = await supabaseClient.from("login_logs").insert({
    user_email: user.email,
    action,
    created_at: new Date().toISOString()
  });
  if (error) console.error("Login log save failed", error);
}

async function handleSignedIn(user) {
  currentUser = user;
  setLoginMessage("Loading workshop data...");
  await loadCurrentProfile(user);
  await loadUserProfiles();
  await recordLoginAction("login", user);
  await loadStateFromSupabase();
  await loadLoginLogs();
  render();
  resetWorkLogForm();
  document.querySelector('#expenseForm [name="expenseDate"]').value = dateKey(new Date());
  setVehicleMode("new");
  renderQuoteBuilder();
  applyRoleAccess();
  startLiveSync();
  resetSalesInactivityTimer();
  showAuthenticatedApp(true);
  setLoginMessage("");
}

async function initializeApp() {
  if (!supabaseClient) {
    setLoginMessage("Supabase could not load. Check your internet connection and refresh.");
    showAuthenticatedApp(false);
    return;
  }

  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    setLoginMessage(error.message);
    showAuthenticatedApp(false);
    return;
  }

  if (data.session?.user) {
    await handleSignedIn(data.session.user);
  } else {
    showAuthenticatedApp(false);
    normalizeState();
    renderQuoteBuilder();
  }
}

function render() {
  renderSelects();
  renderDashboard();
  renderJobs();
  renderCalendar();
  renderCustomers();
  renderVehicles();
  renderInvoices();
  renderWorkLogs();
  renderStock();
  renderProfit();
  renderUserLogs();
}

document.querySelectorAll("[data-view], [data-view-link]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view || button.dataset.viewLink));
});

document.querySelector("#globalSearch").addEventListener("input", (event) => {
  searchTerm = event.target.value.trim().toLowerCase();
  render();
});

document.addEventListener("input", (event) => {
  const investedId = event.target.dataset.stockInvested;
  const soldForId = event.target.dataset.stockSoldFor;
  const stockId = investedId || soldForId;
  if (!stockId) return;
  const draft = stockDrafts.get(stockId) || {};
  if (investedId) draft.invested = event.target.value;
  if (soldForId) draft.soldFor = event.target.value;
  stockDrafts.set(stockId, draft);
});

document.querySelector("#workLogMonth").addEventListener("change", renderWorkLogs);

document.querySelector("#expenseType").addEventListener("change", (event) => {
  document.querySelector("#mechanicNameField").classList.toggle("hidden", event.target.value !== "mechanic");
});

document.querySelector("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabaseClient) {
    setLoginMessage("Supabase is not available. Check your internet connection and refresh.");
    return;
  }

  const email = document.querySelector("#loginEmail").value.trim();
  const password = document.querySelector("#loginPassword").value;
  setLoginMessage("Signing in...");

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    setLoginMessage(error.message);
    return;
  }

  await handleSignedIn(data.user);
});

document.querySelector("#logoutBtn").addEventListener("click", async () => {
  await signOutUser();
});

["click", "keydown", "scroll", "mousemove", "touchstart"].forEach((eventName) => {
  window.addEventListener(eventName, resetSalesInactivityTimer, { passive: true });
});

document.querySelector("#newJobBtn").addEventListener("click", openNewQuoteDialog);
document.querySelector("#exportDataBtn").addEventListener("click", exportData);
document.querySelector("#importDataBtn").addEventListener("click", () => document.querySelector("#importDataFile").click());
document.querySelector("#importDataFile").addEventListener("change", (event) => {
  importData(event.target.files[0]);
  event.target.value = "";
});
document.querySelector("#prevMonthBtn").addEventListener("click", () => {
  calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1);
  renderCalendar();
});
document.querySelector("#nextMonthBtn").addEventListener("click", () => {
  calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1);
  renderCalendar();
});

document.querySelector("#closeDialog").addEventListener("click", () => jobDialog.close());
document.querySelector("#closeInvoiceDialog").addEventListener("click", () => invoiceDialog.close());

document.querySelector("#printInvoiceBtn").addEventListener("click", () => {
  document.body.classList.add("printing-invoice");
  window.print();
  document.body.classList.remove("printing-invoice");
});

document.querySelector("#emailInvoiceBtn").addEventListener("click", () => {
  if (activeInvoiceId) emailInvoice(activeInvoiceId);
});

document.querySelectorAll('#jobForm input[name="vehicleMode"]').forEach((radio) => {
  radio.addEventListener("change", (event) => {
    setVehicleMode(event.target.value);
    renderQuoteBuilder();
  });
});

document.querySelectorAll('#jobForm input[name="customerMode"]').forEach((radio) => {
  radio.addEventListener("change", (event) => {
    setCustomerMode(event.target.value);
    renderQuoteBuilder();
  });
});

["vehicle", "newVehicleCustomer", "newCustomerVat"].forEach((name) => {
  document.querySelector(`#jobForm [name="${name}"]`).addEventListener("change", renderQuoteBuilder);
});

document.querySelector('#jobForm select[name="mechanic"]').addEventListener("change", renderMechanicAvailability);
document.querySelector('#jobForm input[name="estimatedHours"]').addEventListener("input", renderMechanicAvailability);
document.querySelector('#jobForm input[name="due"]').addEventListener("change", renderMechanicAvailability);
document.querySelector("#availabilityFrom").addEventListener("change", renderMechanicAvailability);

function addQuoteItem(type, nameSelector, qtySelector, priceSelector, statusSelector) {
  const nameInput = nameSelector ? document.querySelector(nameSelector) : null;
  const qtyInput = document.querySelector(qtySelector);
  const priceInput = document.querySelector(priceSelector);
  const statusInput = statusSelector ? document.querySelector(statusSelector) : null;
  const name = type === "labour" ? "Labour" : nameInput.value.trim();
  const qty = Number(qtyInput.value || 1);
  const unitPrice = Number(priceInput.value || 0);
  if (!name || qty <= 0 || unitPrice < 0) return;
  activeQuoteItems.push({ type, name, qty, unitPrice, status: type === "part" ? statusInput?.value || "Needed" : "" });
  if (nameInput) nameInput.value = "";
  qtyInput.value = 1;
  priceInput.value = "";
  if (statusInput) statusInput.value = "Needed";
  renderQuoteBuilder();
}

document.querySelector("#addLabourBtn").addEventListener("click", () => addQuoteItem("labour", null, "#labourItemQty", "#labourItemPrice"));
document.querySelector("#addPartBtn").addEventListener("click", () => addQuoteItem("part", "#partItemName", "#partItemQty", "#partItemPrice", "#partItemStatus"));

document.querySelector("#jobForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeQuoteItems.length) {
    window.alert("Add at least one labour or part line before saving the quote.");
    return;
  }
  const form = new FormData(event.currentTarget);
  const mechanic = form.get("mechanic");
  const estimatedHours = Number(form.get("estimatedHours") || 0);
  const jobDate = form.get("due");
  if (!mechanic || mechanic === "Unassigned") {
    window.alert("Choose a mechanic before saving the quote.");
    return;
  }
  if ([0, 6].includes(dateFromKey(jobDate).getDay())) {
    window.alert("Choose a weekday for the job.");
    return;
  }
  if (["Booked", "In progress"].includes(form.get("status"))) {
    const capacity = mechanicCapacity(mechanic, jobDate, activeEditJobId);
    if (capacity.available < estimatedHours) {
      window.alert(`${mechanic} only has ${capacity.available} hours available on ${formatDate(jobDate)}. Choose one of the suggested available days.`);
      renderMechanicAvailability();
      return;
    }
  }
  const saveButton = document.querySelector("#saveJobBtn");
  saveButton.disabled = true;
  saveButton.textContent = "Saving quote...";
  const remoteRecords = [];
  let vehicleId = form.get("vehicle");
  const existingJob = activeEditJobId ? byId("jobs", activeEditJobId) : null;
  const previousStatus = existingJob?.status || "";

  if (form.get("vehicleMode") === "new") {
    let customerId = form.get("newVehicleCustomer");
    if (form.get("customerMode") === "new" || !customerId) {
      customerId = makeId("c");
      const newCustomer = { id: customerId, name: form.get("newCustomerName"), phone: form.get("newCustomerPhone"), email: form.get("newCustomerEmail"), address: form.get("newCustomerAddress"), postcode: form.get("newCustomerPostcode"), vatCustomer: form.has("newCustomerVat") };
      state.customers.push(newCustomer);
      remoteRecords.push(["customers", newCustomer]);
    }
    vehicleId = makeId("v");
    const newVehicle = { id: vehicleId, plate: form.get("newPlate").toUpperCase(), model: form.get("newModel"), owner: customerId, mileage: Number(form.get("newMileage")), motDue: form.get("newMotDue") };
    state.vehicles.push(newVehicle);
    remoteRecords.push(["vehicles", newVehicle]);
  }

  if (activeEditJobId && form.get("vehicleMode") === "existing" && !vehicleId) {
    vehicleId = existingJob?.vehicle;
  }

  const job = existingJob || {
    id: makeId("j")
  };
  Object.assign(job, {
    vehicle: vehicleId,
    type: activeQuoteItems[0]?.name || vehicleLabel(vehicleId),
    due: form.get("due"),
    estimate: 0,
    lineItems: activeQuoteItems.map((item) => ({ ...item })),
    mechanic,
    estimatedHours,
    status: form.get("status"),
    notes: form.get("notes")
  });
  if (job.status === "Ready" && previousStatus !== "Ready") job.readyDate = dateKey(new Date());
  if (job.status === "Collected" && !job.readyDate) job.readyDate = dateKey(new Date());
  if (job.readyDate === undefined) job.readyDate = "";

  let invoice;
  if (activeEditJobId) {
    invoice = state.invoices.find((item) => item.job === job.id);
    if (invoice) {
      invoice.vatEnabled = Boolean(customerForJob(job)?.vatCustomer);
      invoice.amount = invoiceTotal(invoice);
      invoice.due = job.readyDate || "";
    }
  } else {
    state.jobs.unshift(job);
    invoice = { id: makeId("i"), job: job.id, amount: 0, status: "Unpaid", paidDate: "", due: job.readyDate || "", vatEnabled: Boolean(customerForJob(job)?.vatCustomer) };
    invoice.amount = invoiceTotal(invoice);
    state.invoices.unshift(invoice);
  }

  remoteRecords.push(["jobs", job]);
  if (invoice) remoteRecords.push(["invoices", invoice]);
  updateJobArchive(job);
  saveLocal();

  // The quote is safely stored on this device. Close the editor immediately so
  // a slow cloud connection cannot leave users stuck on "Saving quote...".
  event.currentTarget.reset();
  activeQuoteItems = [];
  activeEditJobId = null;
  renderQuoteBuilder();
  setVehicleMode("new");
  saveButton.disabled = false;
  saveButton.textContent = "Create quote";
  jobDialog.close();
  setView("jobs");

  let syncDelayed = false;
  try {
    for (const [table, record] of remoteRecords) await saveRemoteRecord(table, record);
    await broadcastRemoteChange();
  } catch (error) {
    syncDelayed = true;
    console.error("Quote direct save failed", error);
    queueRemoteSave();
  }
  if (syncDelayed) window.alert("The quote is saved on this device. Cloud sync is retrying automatically.");
});

document.querySelector("#customerForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const customerId = form.get("customerId");
  const customer = customerId ? byId("customers", customerId) : null;
  const nextCustomer = {
    id: customerId || makeId("c"),
    name: form.get("name"),
    phone: form.get("phone"),
    email: form.get("email"),
    address: form.get("address"),
    postcode: form.get("postcode"),
    vatCustomer: form.has("vatCustomer")
  };
  if (customer) {
    Object.assign(customer, nextCustomer);
  } else {
    state.customers.push(nextCustomer);
  }
  state.invoices.forEach((invoice) => {
    const job = byId("jobs", invoice.job);
    if (customerForJob(job)?.id === nextCustomer.id) {
      invoice.vatEnabled = Boolean(invoice.vatEnabled && nextCustomer.vatCustomer);
      invoice.amount = invoiceTotal(invoice);
    }
  });
  resetCustomerForm();
  save();
  render();
});

document.querySelector("#cancelCustomerEditBtn").addEventListener("click", resetCustomerForm);

document.querySelector("#vehicleForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.vehicles.push({ id: makeId("v"), plate: form.get("plate").toUpperCase(), model: form.get("model"), owner: form.get("owner"), mileage: Number(form.get("mileage")), motDue: form.get("motDue") });
  event.currentTarget.reset();
  save();
  render();
});

document.querySelector("#expenseForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const type = form.get("type");
  state.expenses.push({
    id: makeId("e"),
    type,
    mechanicName: type === "mechanic" ? form.get("mechanicName") : "",
    expenseDate: form.get("expenseDate"),
    description: form.get("description"),
    amount: Number(form.get("amount")),
    createdAt: new Date().toISOString()
  });
  event.currentTarget.reset();
  document.querySelector('#expenseForm [name="expenseDate"]').value = dateKey(new Date());
  document.querySelector("#mechanicNameField").classList.remove("hidden");
  save();
  render();
});

document.querySelector("#stockForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!isAdmin()) return;
  const form = new FormData(event.currentTarget);
  const stockAmount = Number(String(form.get("stockAmount") || "").replace(/[£,\s]/g, ""));
  if (!Number.isFinite(stockAmount)) {
    window.alert("Enter a valid pound amount.");
    return;
  }
  state.expenses.push({
    id: makeId("s"),
    type: STOCK_ITEM_TYPE,
    partName: String(form.get("partName") || "").trim(),
    stockAmount,
    invested: 0,
    soldFor: 0,
    amount: 0,
    createdAt: new Date().toISOString()
  });
  event.currentTarget.reset();
  save();
  render();
});

document.querySelector("#workLogForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const entryId = form.get("workLogId");
  const existingEntry = entryId ? workLogs().find((entry) => entry.id === entryId) : null;
  if (entryId && (!existingEntry || !canManageWorkLog(existingEntry))) {
    window.alert("You cannot edit this work log.");
    resetWorkLogForm();
    return;
  }
  const selectedUserEmail = isAdmin() ? String(form.get("workLogUser") || "").trim() : currentUser.email;
  if (!selectedUserEmail) {
    window.alert("Choose a user before saving the work log.");
    return;
  }
  const selectedProfile = userProfiles.find((profile) => profile.email === selectedUserEmail);
  const knownUserLog = workLogs().find((entry) => entry.userEmail === selectedUserEmail);
  const selectedUserId = selectedProfile?.user_id || knownUserLog?.userId || (selectedUserEmail === currentUser.email ? currentUser.id : "");
  const nextEntry = existingEntry || {
    id: makeId("wl"),
    type: WORK_LOG_TYPE,
    createdById: currentUser.id,
    createdByEmail: currentUser.email,
    createdByRole: isAdmin() ? "admin" : "sales",
    createdAt: new Date().toISOString(),
    amount: 0
  };
  Object.assign(nextEntry, {
    userId: selectedUserId,
    userEmail: selectedUserEmail,
    workDate: form.get("workDate"),
    startTime: form.get("startTime"),
    endTime: form.get("endTime"),
    description: String(form.get("description") || "").trim(),
    updatedAt: new Date().toISOString()
  });
  if (workLogHours(nextEntry) <= 0) {
    window.alert("End time must be later than start time.");
    return;
  }
  if (!existingEntry) state.expenses.push(nextEntry);
  resetWorkLogForm();
  save();
  render();
});

document.querySelector("#cancelWorkLogEditBtn").addEventListener("click", resetWorkLogForm);

document.addEventListener("change", (event) => {
  const jobId = event.target.dataset.jobStatus;
  const mechanicJobId = event.target.dataset.jobMechanic;
  const partStatusIndex = event.target.dataset.partStatusIndex;
  if (partStatusIndex !== undefined) {
    activeQuoteItems[Number(partStatusIndex)].status = event.target.value;
    renderQuoteBuilder();
    return;
  }
  if (jobId) {
    const job = byId("jobs", jobId);
    const nextStatus = event.target.value;
    if (["Booked", "In progress"].includes(nextStatus)) {
      const capacity = mechanicCapacity(job.mechanic, job.due, job.id);
      if (!job.mechanic || job.mechanic === "Unassigned" || capacity.available < jobEstimatedHours(job)) {
        window.alert(`${job.mechanic || "This mechanic"} does not have enough availability for this job on ${formatDate(job.due)}.`);
        render();
        return;
      }
    }
    if (nextStatus === "Ready" && job.status !== "Ready") job.readyDate = dateKey(new Date());
    if (nextStatus === "Collected" && !job.readyDate) job.readyDate = dateKey(new Date());
    job.status = nextStatus;
    const invoice = invoiceForJob(job.id);
    if (invoice) invoice.due = job.readyDate || "";
    updateJobArchive(job);
    save();
    render();
  }
  if (mechanicJobId) {
    const job = byId("jobs", mechanicJobId);
    const nextMechanic = event.target.value;
    if (["Booked", "In progress"].includes(job.status)) {
      const capacity = mechanicCapacity(nextMechanic, job.due, job.id);
      if (nextMechanic === "Unassigned" || capacity.available < jobEstimatedHours(job)) {
        window.alert(`${nextMechanic} does not have ${jobEstimatedHours(job)} hours available on ${formatDate(job.due)}.`);
        render();
        return;
      }
    }
    job.mechanic = nextMechanic;
    save();
    render();
  }
});

document.addEventListener("click", (event) => {
  const profitMonth = event.target.closest("[data-profit-month]")?.dataset.profitMonth;
  if (profitMonth) {
    selectedProfitMonth = profitMonth;
    renderProfit();
    return;
  }

  const availabilityDate = event.target.closest("[data-availability-date]")?.dataset.availabilityDate;
  if (availabilityDate) {
    document.querySelector('#jobForm input[name="due"]').value = availabilityDate;
    renderMechanicAvailability();
    return;
  }

  const workLogEditId = event.target.closest("[data-work-log-edit]")?.dataset.workLogEdit;
  if (workLogEditId) {
    editWorkLog(workLogEditId);
    return;
  }

  const workLogDeleteId = event.target.closest("[data-work-log-delete]")?.dataset.workLogDelete;
  if (workLogDeleteId) {
    const entry = workLogs().find((item) => item.id === workLogDeleteId);
    if (!entry || !canManageWorkLog(entry)) return;
    if (!window.confirm(`Delete this work log for ${entry.userEmail || "this user"}?`)) return;
    state.expenses = state.expenses.filter((item) => item.id !== entry.id);
    if (document.querySelector('#workLogForm [name="workLogId"]').value === entry.id) resetWorkLogForm();
    save();
    render();
    return;
  }

  const stockDeleteId = event.target.closest("[data-stock-delete]")?.dataset.stockDelete;
  if (stockDeleteId) {
    if (!isAdmin()) return;
    const item = stockItems().find((entry) => entry.id === stockDeleteId);
    if (!item || !window.confirm(`Delete ${item.partName} from stock?`)) return;
    state.expenses = state.expenses.filter((entry) => entry.id !== stockDeleteId);
    stockDrafts.delete(stockDeleteId);
    save();
    render();
    return;
  }

  const stockSaveId = event.target.closest("[data-stock-save]")?.dataset.stockSave;
  if (stockSaveId) {
    if (!isAdmin()) return;
    const item = stockItems().find((entry) => entry.id === stockSaveId);
    if (!item) return;
    const investedInput = document.querySelector(`[data-stock-invested="${stockSaveId}"]`);
    const soldForInput = document.querySelector(`[data-stock-sold-for="${stockSaveId}"]`);
    const enteredInvested = Number(String(investedInput?.value || 0).replace(/[£,\s]/g, ""));
    const enteredSoldFor = Number(String(soldForInput?.value || 0).replace(/[£,\s]/g, ""));
    if (!Number.isFinite(enteredInvested) || !Number.isFinite(enteredSoldFor)) {
      window.alert("Enter valid pound amounts for invested and sold for.");
      return;
    }
    item.invested = enteredInvested;
    item.soldFor = enteredSoldFor;
    stockDrafts.delete(stockSaveId);
    save();
    render();
    return;
  }

  const customerEditId = event.target.dataset.customerEdit;
  if (customerEditId) {
    editCustomer(customerEditId);
    return;
  }

  const customerDeleteId = event.target.closest("[data-customer-delete]")?.dataset.customerDelete;
  if (customerDeleteId) {
    const customer = byId("customers", customerDeleteId);
    if (!customer) return;
    const vehicleIds = new Set(state.vehicles.filter((vehicle) => vehicle.owner === customer.id).map((vehicle) => vehicle.id));
    const jobIds = new Set(state.jobs.filter((job) => vehicleIds.has(job.vehicle)).map((job) => job.id));
    const invoiceCount = state.invoices.filter((invoice) => jobIds.has(invoice.job)).length;
    const confirmed = window.confirm(`Delete ${customer.name}? This will also delete ${vehicleIds.size} vehicle(s), ${jobIds.size} job(s), and ${invoiceCount} invoice(s). This cannot be undone.`);
    if (!confirmed) return;
    state.customers = state.customers.filter((item) => item.id !== customer.id);
    state.vehicles = state.vehicles.filter((vehicle) => !vehicleIds.has(vehicle.id));
    state.jobs = state.jobs.filter((job) => !jobIds.has(job.id));
    state.invoices = state.invoices.filter((invoice) => !jobIds.has(invoice.job));
    if (document.querySelector('#customerForm [name="customerId"]').value === customer.id) resetCustomerForm();
    save();
    render();
    return;
  }

  const customerVatId = event.target.dataset.customerVat;
  if (customerVatId) {
    const customer = byId("customers", customerVatId);
    customer.vatCustomer = !customer.vatCustomer;
    state.invoices.forEach((invoice) => {
      const job = byId("jobs", invoice.job);
      if (customerForJob(job)?.id === customer.id) {
        invoice.vatEnabled = Boolean(invoice.vatEnabled && customer.vatCustomer);
        invoice.amount = invoiceTotal(invoice);
      }
    });
    save();
    render();
    return;
  }

  const expenseDeleteId = event.target.dataset.expenseDelete;
  if (expenseDeleteId) {
    state.expenses = state.expenses.filter((expense) => expense.id !== expenseDeleteId);
    save();
    render();
    return;
  }

  const removeQuoteIndex = event.target.dataset.removeQuoteItem;
  if (removeQuoteIndex !== undefined) {
    activeQuoteItems.splice(Number(removeQuoteIndex), 1);
    renderQuoteBuilder();
    return;
  }

  const editJobId = event.target.closest("[data-job-edit]")?.dataset.jobEdit;
  if (editJobId) {
    openEditQuoteDialog(editJobId);
    return;
  }

  const deleteJobId = event.target.dataset.jobDelete;
  if (deleteJobId) {
    const job = byId("jobs", deleteJobId);
    const confirmed = window.confirm(`Delete ${job ? quoteTitle(job) : "this job"} and its invoice?`);
    if (!confirmed) return;
    state.jobs = state.jobs.filter((item) => item.id !== deleteJobId);
    state.invoices = state.invoices.filter((invoice) => invoice.job !== deleteJobId);
    save();
    render();
    return;
  }

  const viewInvoiceId = event.target.dataset.invoiceView;
  if (viewInvoiceId) {
    showInvoice(viewInvoiceId);
    return;
  }

  const printInvoiceId = event.target.dataset.invoicePrint;
  if (printInvoiceId) {
    showInvoice(printInvoiceId);
    document.body.classList.add("printing-invoice");
    window.print();
    document.body.classList.remove("printing-invoice");
    return;
  }

  const emailInvoiceId = event.target.dataset.invoiceEmail;
  if (emailInvoiceId) {
    showInvoice(emailInvoiceId);
    emailInvoice(emailInvoiceId);
    return;
  }

  const vatInvoiceId = event.target.dataset.invoiceVat;
  if (vatInvoiceId) {
    const invoice = byId("invoices", vatInvoiceId);
    const job = byId("jobs", invoice.job);
    const customer = customerForJob(job);
    if (customer?.vatCustomer) {
      invoice.vatEnabled = !invoice.vatEnabled;
      invoice.amount = invoiceTotal(invoice);
      save();
      render();
    }
    return;
  }

  const invoiceId = event.target.dataset.invoiceToggle;
  if (invoiceId) {
    const invoice = byId("invoices", invoiceId);
    invoice.status = invoice.status === "Paid" ? "Unpaid" : "Paid";
    invoice.paidDate = invoice.status === "Paid" ? dateKey(new Date()) : "";
    const job = byId("jobs", invoice.job);
    if (job) updateJobArchive(job);
    save();
    render();
  }

  const filter = event.target.dataset.jobFilter;
  if (filter) {
    currentJobFilter = filter;
    document.querySelectorAll("[data-job-filter]").forEach((button) => button.classList.toggle("active", button.dataset.jobFilter === filter));
    renderJobs();
  }
});

initializeApp().catch((error) => {
  console.error("App startup failed", error);
  setLoginMessage(error.message || "Could not start the app.");
  showAuthenticatedApp(false);
});
