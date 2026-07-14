function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const today = dateKey(new Date());

const business = {
  name: "OG Automotives Limited",
  address: "Unit 1 Foxhall Road, CM0 7LB"
};
const VAT_RATE = 0.2;
const PROFIT_PASSWORD = "240710";
const STORAGE_KEY = "garageDeskStateFirstUse";
const SUPABASE_URL = "https://jlnfsafgonfuzuetgmhj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpsbmZzYWZnb25mdXp1ZXRnbWhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5MzQ4MzcsImV4cCI6MjA5OTUxMDgzN30.Nwg6AfGPGGiofZjO4BLubjRsx6QqRSgEiBwvZ-LKjCQ";
const DATA_TABLES = ["customers", "vehicles", "jobs", "invoices", "expenses"];
const DEFAULT_MECHANICS = ["DOM"];

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
let searchTerm = "";
let activeQuoteItems = [];
let activeInvoiceId = null;
let activeEditJobId = null;
let calendarDate = new Date(today);
let profitUnlocked = false;
let currentUser = null;
let remoteReady = false;
let syncingRemote = false;
let saveTimer = null;
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

const save = () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  queueRemoteSave();
};
const money = (value) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(value || 0));
const byId = (collection, id) => state[collection].find((item) => item.id === id);
const makeId = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const formatDate = (value) => {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
};
const lineTotal = (item) => Number(item.qty || 0) * Number(item.unitPrice || 0);
const itemType = (item) => item.type || "part";
const partStatus = (item) => item.status || "Needed";
const labourItemsTotal = (items = []) => items.filter((item) => itemType(item) === "labour").reduce((total, item) => total + lineTotal(item), 0);
const partsTotal = (items = []) => items.filter((item) => itemType(item) === "part").reduce((total, item) => total + lineTotal(item), 0);
const jobLabourTotal = (job) => labourItemsTotal(job?.lineItems || []);
const jobTotal = (job) => jobLabourTotal(job) + partsTotal(job?.lineItems || []);
const allLabourIncome = () => state.jobs.reduce((total, job) => total + jobLabourTotal(job), 0);
const allPartsCost = () => state.jobs.reduce((total, job) => total + partsTotal(job.lineItems || []), 0);
const expensesTotal = () => state.expenses.reduce((total, expense) => total + Number(expense.amount || 0), 0);
const invoiceForJob = (jobId) => state.invoices.find((invoice) => invoice.job === jobId);
const isJobPaid = (job) => invoiceForJob(job.id)?.status === "Paid";
const paidLabourIncome = () => state.jobs.reduce((total, job) => total + (isJobPaid(job) ? jobLabourTotal(job) : 0), 0);
const profit = () => paidLabourIncome();

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

function normalizeState() {
  state.customers = Array.isArray(state.customers) ? state.customers : [];
  state.vehicles = Array.isArray(state.vehicles) ? state.vehicles : [];
  state.jobs = Array.isArray(state.jobs) ? state.jobs : [];
  state.invoices = Array.isArray(state.invoices) ? state.invoices : [];
  state.expenses = Array.isArray(state.expenses) ? state.expenses : [];
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
  });
  state.invoices.forEach((invoice) => {
    const job = byId("jobs", invoice.job);
    invoice.vatEnabled = Boolean(invoice.vatEnabled && customerForJob(job)?.vatCustomer);
    if (job) invoice.amount = invoiceTotal(invoice);
  });
  save();
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
  const expenseNames = state.expenses
    .filter((expense) => expense.type === "mechanic" && expense.mechanicName)
    .map((expense) => expense.mechanicName.trim())
    .filter(Boolean);
  const assignedNames = state.jobs
    .map((job) => job.mechanic)
    .filter((name) => name && name !== "Unassigned");
  return ["Unassigned", ...new Set([...DEFAULT_MECHANICS, ...expenseNames, ...assignedNames])];
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

function setView(viewId) {
  if (viewId === "profit" && !unlockProfitSection()) return;
  if (viewId !== "profit") profitUnlocked = false;
  views.forEach((view) => view.classList.toggle("active-view", view.id === viewId));
  navItems.forEach((item) => item.classList.toggle("active", item.dataset.view === viewId));
  pageTitle.textContent = viewId === "jobs" ? "Quotes" : viewId[0].toUpperCase() + viewId.slice(1);
  render();
}

function unlockProfitSection() {
  if (profitUnlocked) return true;
  const enteredPassword = window.prompt("Enter profit password");
  if (enteredPassword === PROFIT_PASSWORD) {
    profitUnlocked = true;
    render();
    return true;
  }
  if (enteredPassword !== null) window.alert("Incorrect password");
  return false;
}

function statusBadge(status) {
  const tone = status === "Paid" || status === "Collected" ? "good" : status === "Ready" ? "warn" : "";
  return `<span class="badge ${tone}">${status}</span>`;
}

function renderDashboard() {
  const openJobs = state.jobs.filter((job) => job.status !== "Collected");
  const dueToday = state.jobs.filter((job) => job.due === today && job.status !== "Collected");
  const unpaid = state.invoices.filter((invoice) => invoice.status === "Unpaid");

  document.querySelector("#openJobsCount").textContent = openJobs.length;
  document.querySelector("#dueTodayCount").textContent = dueToday.length;
  document.querySelector("#unpaidInvoicesCount").textContent = unpaid.length;

  document.querySelector("#queueList").innerHTML = openJobs.length
    ? openJobs.slice(0, 5).map((job) => `<div class="list-item"><div><strong>${quoteTitle(job)}</strong><div class="muted">${vehicleLabel(job.vehicle)} - job date ${formatDate(job.due)} - ${job.mechanic || "Unassigned"}</div></div>${statusBadge(job.status)}</div>`).join("")
    : `<div class="empty">No open quotes.</div>`;
}

function renderJobs() {
  const filtered = state.jobs.filter((job) => {
    const statusMatches = currentJobFilter === "all" || job.status === currentJobFilter;
    const searchMatches = !searchTerm || jobSearchText(job).includes(searchTerm);
    return statusMatches && searchMatches;
  });

  document.querySelector("#jobsGrid").innerHTML = filtered.length
    ? filtered.map((job) => `
        <article class="job-card">
          <div class="job-card-header">
            <div>
              <h3>${vehicleRegistration(job.vehicle)}</h3>
              <span class="muted">${quoteTitle(job)} - ${byId("vehicles", job.vehicle)?.model || "Unknown model"}</span>
            </div>
            ${statusBadge(job.status)}
          </div>
          <div class="job-meta">
            <span>Job date: ${formatDate(job.due)}</span>
            <span>Mechanic: ${job.mechanic || "Unassigned"}</span>
            <span>Labour: ${money(jobLabourTotal(job))}</span>
            <span>Parts: ${money(partsTotal(job.lineItems))}</span>
            <span class="parts-status">Parts status: ${partsStatusSummary(job)}</span>
            <span>Total quote: ${money(jobTotal(job))}</span>
            <span class="job-note">${job.notes || "No notes"}</span>
          </div>
          <div class="row-actions">
            <button class="small-button" type="button" data-job-edit="${job.id}">Edit quote</button>
            <button class="small-button danger-button" type="button" data-job-delete="${job.id}">Delete job</button>
          </div>
          <label>Mechanic
            <select data-job-mechanic="${job.id}">
              ${mechanicOptions().map((name) => `<option value="${name}" ${name === (job.mechanic || "Unassigned") ? "selected" : ""}>${name}</option>`).join("")}
            </select>
          </label>
          <label>Status
            <select data-job-status="${job.id}">
              ${["Booked", "In progress", "Ready", "Collected"].map((status) => `<option ${status === job.status ? "selected" : ""}>${status}</option>`).join("")}
            </select>
          </label>
        </article>
      `).join("")
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
            ${dayJobs.map((job) => `
              <button class="calendar-job" type="button" data-job-edit="${job.id}">
                <strong>${quoteTitle(job)}</strong>
                <span>${vehicleLabel(job.vehicle)}</span>
                <span>${job.mechanic || "Unassigned"} - ${job.status}</span>
              </button>
            `).join("")}
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
      return `<tr><td><strong>${customer.name}</strong><br><span class="muted">${customer.phone}<br>${customer.email || "-"}<br>${customer.address || "No address saved"}<br>${customer.vatCustomer ? "VAT customer" : "No VAT"}</span><br><button class="small-button" data-customer-vat="${customer.id}">${customer.vatCustomer ? "Remove VAT" : "Mark VAT"}</button></td><td>${vehicleList}</td></tr>`;
    })
    .join("");

  document.querySelector("#customersList").innerHTML = `
    <h2>Customers</h2>
    <table><thead><tr><th>Customer</th><th>Make, model, mileage and MOT</th></tr></thead><tbody>${rows || `<tr><td colspan="2">No customers found.</td></tr>`}</tbody></table>
  `;
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
      return `<tr><td><strong>${invoice.id.toUpperCase()}</strong></td><td>${job ? quoteTitle(job) : "Quote removed"}</td><td>${job ? vehicleLabel(job.vehicle) : "-"}</td><td>${money(invoiceTotal(invoice))}</td><td>${formatDate(invoice.due)}</td><td>${customer?.vatCustomer ? invoice.vatEnabled ? "VAT invoice" : "VAT available" : "No VAT"}</td><td>${statusBadge(invoice.status)}</td><td><div class="row-actions"><button class="small-button" data-invoice-view="${invoice.id}">View</button><button class="small-button" data-invoice-print="${invoice.id}">Print</button><button class="small-button" data-invoice-email="${invoice.id}">Email</button>${vatButton}<button class="small-button" data-invoice-toggle="${invoice.id}">${invoice.status === "Paid" ? "Mark unpaid" : "Mark paid"}</button></div></td></tr>`;
    })
    .join("");

  document.querySelector("#invoicesList").innerHTML = `
    <h2>Invoices</h2>
    <table><thead><tr><th>No.</th><th>Quote</th><th>Vehicle</th><th>Amount</th><th>Due</th><th>VAT</th><th>Status</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="8">No invoices found.</td></tr>`}</tbody></table>
  `;
}

function renderProfit() {
  if (!profitUnlocked) {
    document.querySelector("#profitList").innerHTML = `<div class="empty">Profit section locked.</div>`;
    return;
  }
  const jobRows = state.jobs.map((job) => {
    const paid = isJobPaid(job);
    const jobProfit = paid ? jobLabourTotal(job) : 0;
    return `<tr><td><strong>${quoteTitle(job)}</strong></td><td>${vehicleLabel(job.vehicle)}</td><td>${paid ? "Paid" : "Unpaid"}</td><td>${money(jobLabourTotal(job))}</td><td>${money(partsTotal(job.lineItems))}</td><td>${money(jobProfit)}</td></tr>`;
  }).join("");
  const expenseRows = state.expenses.map((expense) => `
    <tr>
      <td><strong>${expenseTypeLabel(expense.type)}</strong></td>
      <td>${expense.type === "mechanic" ? expense.mechanicName || "-" : "-"}</td>
      <td>${expense.description || "-"}</td>
      <td>${money(expense.amount)}</td>
      <td><button class="small-button" data-expense-delete="${expense.id}">Delete</button></td>
    </tr>
  `).join("");
  document.querySelector("#profitList").innerHTML = `
    <h2>Profit</h2>
    <div class="profit-grid">
      <div class="profit-box"><span>Paid labour</span><strong>${money(paidLabourIncome())}</strong></div>
      <div class="profit-box"><span>Total labour quoted</span><strong>${money(allLabourIncome())}</strong></div>
      <div class="profit-box"><span>Parts</span><strong>${money(allPartsCost())}</strong></div>
      <div class="profit-box"><span>Expenses</span><strong>${money(expensesTotal())}</strong></div>
      <div class="profit-box"><span>Profit</span><strong>${money(profit())}</strong></div>
    </div>
    <h2>Expenses</h2>
    <table><thead><tr><th>Type</th><th>Mechanic</th><th>Description</th><th>Amount</th><th></th></tr></thead><tbody>${expenseRows || `<tr><td colspan="5">No expenses yet.</td></tr>`}</tbody></table>
    <h2>Quotes</h2>
    <table><thead><tr><th>Quote</th><th>Vehicle</th><th>Payment</th><th>Labour</th><th>Parts</th><th>Profit counted</th></tr></thead><tbody>${jobRows || `<tr><td colspan="6">No quotes yet.</td></tr>`}</tbody></table>
  `;
}

function renderSelects() {
  const ownerOptions = state.customers.length
    ? state.customers.map((customer) => `<option value="${customer.id}">${customer.name}</option>`).join("")
    : `<option value="">Add a customer first</option>`;
  document.querySelector('#vehicleForm select[name="owner"]').innerHTML = ownerOptions;
  document.querySelector('#jobForm select[name="newVehicleCustomer"]').innerHTML = ownerOptions;

  const vehicleOptions = state.vehicles.length
    ? state.vehicles.map((vehicle) => `<option value="${vehicle.id}">${vehicle.plate} - ${vehicle.model} (${ownerName(vehicle.owner)})</option>`).join("")
    : `<option value="">No vehicles yet</option>`;
  document.querySelector('#jobForm select[name="vehicle"]').innerHTML = vehicleOptions;

  const assignedMechanic = document.querySelector('#jobForm select[name="mechanic"]').value || "Unassigned";
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
  document.querySelector('#jobForm input[name="due"]').value = today;
  document.querySelector('#jobForm input[name="vehicleMode"][value="new"]').checked = true;
  document.querySelector(`#jobForm input[name="customerMode"][value="${state.customers.length ? "existing" : "new"}"]`).checked = true;
  activeQuoteItems = [];
  activeEditJobId = null;
  document.querySelector("#jobDialogTitle").textContent = "New quote";
  document.querySelector("#saveJobBtn").textContent = "Create quote";
  renderSelects();
  setVehicleMode("new");
  renderQuoteBuilder();
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
  document.querySelector('#jobForm select[name="mechanic"]').value = job.mechanic || "Unassigned";
  document.querySelector('#jobForm select[name="status"]').value = job.status;
  document.querySelector('#jobForm textarea[name="notes"]').value = job.notes || "";
  activeQuoteItems = (job.lineItems || []).map((item) => ({ ...item }));
  setVehicleMode("existing");
  renderQuoteBuilder();
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

  return `
    <div class="invoice-title">
      <div>
        <h3>${business.name}</h3>
        <div class="muted">${business.address}</div>
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
      <div><strong>Vehicle</strong><br>${vehicle ? `${vehicle.plate} - ${vehicle.model}` : "-"}<br>${vehicle ? `${Number(vehicle.mileage).toLocaleString()} mi` : ""}</div>
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
  `;
}

function showInvoice(invoiceId) {
  activeInvoiceId = invoiceId;
  document.querySelector("#invoiceContent").innerHTML = invoiceHtml(invoiceId);
  invoiceDialog.showModal();
}

function emailInvoice(invoiceId) {
  const { invoice, job, vehicle, customer } = getInvoiceDetails(invoiceId);
  if (!invoice || !job) return;
  const subject = encodeURIComponent(`Invoice ${invoice.id.toUpperCase()} from ${business.name}`);
  const vatText = isVatInvoice(invoice)
    ? `\nNet total: ${money(invoiceSubtotal(invoice))}\nTotal VAT 20%: ${money(invoiceVatAmount(invoice))}`
    : "";
  const body = encodeURIComponent(
    `Hi ${customer?.name || ""},\n\nPlease find your invoice details below.\n\nInvoice: ${invoice.id.toUpperCase()}\nBusiness: ${business.name}\nAddress: ${business.address}\nCustomer address: ${customer?.address || "-"}\nVehicle: ${vehicle ? `${vehicle.plate} - ${vehicle.model}` : "-"}\nQuote: ${quoteTitle(job)}\nLabour: ${money(jobLabourTotal(job))}\nParts: ${money(partsTotal(job.lineItems))}${vatText}\nGrand total: ${money(invoiceTotal(invoice))}\nDue: ${formatDate(invoice.due)}\n\nThanks,\n${business.name}`
  );
  window.location.href = `mailto:${customer?.email || ""}?subject=${subject}&body=${body}`;
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

function queueRemoteSave() {
  if (!remoteReady || syncingRemote || !supabaseClient) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveStateToSupabase().catch((error) => {
      console.error("Supabase save failed", error);
    });
  }, 400);
}

async function loadTableRows(table) {
  const { data, error } = await supabaseClient.from(table).select("id,data");
  if (error) throw error;
  return (data || []).map((row) => ({ ...row.data, id: row.id }));
}

async function loadStateFromSupabase() {
  remoteReady = false;
  const remoteState = {};
  let hasRemoteData = false;

  for (const table of DATA_TABLES) {
    remoteState[table] = await loadTableRows(table);
    if (remoteState[table].length) hasRemoteData = true;
  }

  if (hasRemoteData) state = remoteState;
  normalizeState();
  remoteReady = true;

  if (!hasRemoteData && DATA_TABLES.some((table) => state[table].length)) {
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

async function saveStateToSupabase() {
  if (!remoteReady || !supabaseClient) return;
  syncingRemote = true;
  try {
    for (const table of DATA_TABLES) {
      await saveTableRows(table);
    }
  } finally {
    syncingRemote = false;
  }
}

async function handleSignedIn(user) {
  currentUser = user;
  setLoginMessage("Loading workshop data...");
  await loadStateFromSupabase();
  render();
  setVehicleMode("new");
  renderQuoteBuilder();
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
  renderProfit();
}

document.querySelectorAll("[data-view], [data-view-link]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view || button.dataset.viewLink));
});

document.querySelector("#globalSearch").addEventListener("input", (event) => {
  searchTerm = event.target.value.trim().toLowerCase();
  render();
});

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
  currentUser = null;
  remoteReady = false;
  profitUnlocked = false;
  showAuthenticatedApp(false);
  setLoginMessage("Signed out.");
  window.clearTimeout(saveTimer);
  if (supabaseClient) {
    const { error } = await supabaseClient.auth.signOut();
    if (error) setLoginMessage(`Signed out locally. Supabase said: ${error.message}`);
  }
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

function addQuoteItem(type, nameSelector, qtySelector, priceSelector, statusSelector) {
  const nameInput = nameSelector ? document.querySelector(nameSelector) : null;
  const qtyInput = document.querySelector(qtySelector);
  const priceInput = document.querySelector(priceSelector);
  const statusInput = statusSelector ? document.querySelector(statusSelector) : null;
  const name = type === "labour" ? "Labour" : nameInput.value.trim();
  const qty = Number(qtyInput.value || 1);
  const unitPrice = Number(priceInput.value || 0);
  if (!name || qty <= 0) return;
  activeQuoteItems.push({ type, name, qty, unitPrice, status: type === "part" ? statusInput?.value || "Needed" : "" });
  if (nameInput) nameInput.value = "";
  qtyInput.value = 1;
  priceInput.value = "";
  if (statusInput) statusInput.value = "Needed";
  renderQuoteBuilder();
}

document.querySelector("#addLabourBtn").addEventListener("click", () => addQuoteItem("labour", null, "#labourItemQty", "#labourItemPrice"));
document.querySelector("#addPartBtn").addEventListener("click", () => addQuoteItem("part", "#partItemName", "#partItemQty", "#partItemPrice", "#partItemStatus"));

document.querySelector("#jobForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  let vehicleId = form.get("vehicle");

  if (form.get("vehicleMode") === "new") {
    let customerId = form.get("newVehicleCustomer");
    if (form.get("customerMode") === "new" || !customerId) {
      customerId = makeId("c");
      state.customers.push({ id: customerId, name: form.get("newCustomerName"), phone: form.get("newCustomerPhone"), email: form.get("newCustomerEmail"), address: form.get("newCustomerAddress"), postcode: form.get("newCustomerPostcode"), vatCustomer: form.has("newCustomerVat") });
    }
    vehicleId = makeId("v");
    state.vehicles.push({ id: vehicleId, plate: form.get("newPlate").toUpperCase(), model: form.get("newModel"), owner: customerId, mileage: Number(form.get("newMileage")), motDue: form.get("newMotDue") });
  }

  const job = activeEditJobId ? byId("jobs", activeEditJobId) : {
    id: makeId("j")
  };
  Object.assign(job, {
    vehicle: vehicleId,
    type: activeQuoteItems[0]?.name || vehicleLabel(vehicleId),
    due: form.get("due"),
    estimate: 0,
    lineItems: activeQuoteItems.map((item) => ({ ...item })),
    mechanic: form.get("mechanic") || "Unassigned",
    status: form.get("status"),
    notes: form.get("notes")
  });

  if (activeEditJobId) {
    const invoice = state.invoices.find((item) => item.job === job.id);
    if (invoice) {
      invoice.vatEnabled = Boolean(customerForJob(job)?.vatCustomer);
      invoice.amount = invoiceTotal(invoice);
      invoice.due = job.due;
    }
  } else {
    state.jobs.unshift(job);
    const invoice = { id: makeId("i"), job: job.id, amount: 0, status: "Unpaid", due: job.due, vatEnabled: Boolean(customerForJob(job)?.vatCustomer) };
    invoice.amount = invoiceTotal(invoice);
    state.invoices.unshift(invoice);
  }

  event.currentTarget.reset();
  activeQuoteItems = [];
  activeEditJobId = null;
  renderQuoteBuilder();
  setVehicleMode("new");
  jobDialog.close();
  save();
  setView("jobs");
});

document.querySelector("#customerForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.customers.push({ id: makeId("c"), name: form.get("name"), phone: form.get("phone"), email: form.get("email"), address: form.get("address"), postcode: form.get("postcode"), vatCustomer: form.has("vatCustomer") });
  event.currentTarget.reset();
  save();
  render();
});

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
    description: form.get("description"),
    amount: Number(form.get("amount"))
  });
  event.currentTarget.reset();
  document.querySelector("#mechanicNameField").classList.remove("hidden");
  save();
  render();
});

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
    byId("jobs", jobId).status = event.target.value;
    save();
    render();
  }
  if (mechanicJobId) {
    byId("jobs", mechanicJobId).mechanic = event.target.value;
    save();
    render();
  }
});

document.addEventListener("click", (event) => {
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

  const editJobId = event.target.dataset.jobEdit;
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
