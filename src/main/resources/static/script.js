"use strict";

/* =====================================================================
   QueueEase — frontend logic
   The Spring Boot backend is the single source of truth. This file only
   displays data and calls the API; it never invents tokens, priorities,
   waiting times or statuses.
   ===================================================================== */

// When served by Spring Boot (http://localhost:8080/) requests are same-origin.
// If the page is opened directly from disk, fall back to the backend URL.
const API_BASE = window.location.protocol.startsWith("http") ? "" : "http://localhost:8080";
const POLL_INTERVAL_MS = 15000;

/* ---------------------------- State ---------------------------- */
const state = {
  doctors: [],
  patients: [],
  tokens: [],
  history: [],
  selectedDoctorId: null,
  queueFilter: "ACTIVE",
  section: "dashboard",
  online: true,
  lastTokenResult: null,
};
const busy = new Set(); // action keys currently in flight (prevents duplicate submits)

/* ---------------------------- Helpers ---------------------------- */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function pad(n) { return String(n).padStart(2, "0"); }

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d)) return esc(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function formatWait(minutes) {
  if (minutes === null || minutes === undefined || isNaN(minutes)) return "—";
  const m = Number(minutes);
  if (m <= 0) return "No wait";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} hr ${r} min` : `${h} hr`;
}

const statusOf = (t) => String(t?.status || "").toUpperCase();
const isPriority = (t) => t?.priority === true;

/* ---------------------------- API layer ---------------------------- */
class ApiError extends Error {
  constructor(type, status = 0, serverMessage = "") {
    super(type);
    this.type = type;           // "network" | "http"
    this.status = status;
    this.serverMessage = serverMessage;
  }
}

async function request(path, { method = "GET", body } = {}) {
  const options = { method, headers: { Accept: "application/json" } };
  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(API_BASE + path, options);
  } catch (_) {
    setOnline(false);
    throw new ApiError("network");
  }
  setOnline(true);

  const raw = await response.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch (_) { data = raw; }
  }

  if (!response.ok) {
    let message = "";
    if (data && typeof data === "object") message = data.message || data.error || "";
    else if (typeof data === "string") message = data.slice(0, 300);
    throw new ApiError("http", response.status, String(message));
  }
  return data;
}

const api = {
  getDoctors: () => request("/api/doctors"),
  getPatients: () => request("/api/patients"),
  getTokens: () => request("/api/tokens"),
  createPatient: (patient) => request("/api/patients", { method: "POST", body: patient }),
  generateToken: (doctorId, patientId, priority) =>
    request(
      `/api/tokens/generate?doctorId=${encodeURIComponent(doctorId)}&patientId=${encodeURIComponent(patientId)}&priority=${priority ? "true" : "false"}`,
      { method: "POST" }
    ),
  callNext: (doctorId) => request(`/api/tokens/next/${encodeURIComponent(doctorId)}`, { method: "POST" }),
  completeToken: (tokenId) => request(`/api/tokens/${encodeURIComponent(tokenId)}/complete`, { method: "PUT" }),
  getHistory: (doctorId) => request(`/api/tokens/history/${encodeURIComponent(doctorId)}`),
};

/* Turn technical errors into friendly, non-technical messages. */
function friendlyError(err, fallback) {
  if (!(err instanceof ApiError)) return fallback;
  if (err.type === "network") {
    return "Cannot reach the server. Please check that the QueueEase backend is running.";
  }
  const msg = (err.serverMessage || "").toLowerCase();
  if (/priority/.test(msg)) {
    return "A priority token is already active for this doctor. Please complete it first.";
  }
  if (/no (waiting|token|patient|pending)|queue is empty|empty queue/.test(msg)) {
    return "There are no waiting patients in this queue.";
  }
  if (err.status === 404) {
    return "We could not find that record. Please refresh and try again.";
  }
  return fallback;
}

/* ---------------------------- Toasts ---------------------------- */
function showToast(message, type = "info", duration = 4200) {
  const container = $("#toastContainer");
  const icons = { success: "✓", error: "!", warning: "!", info: "i" };
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || "i"}</span>
    <span class="toast-msg">${esc(message)}</span>
    <button class="toast-close" type="button" aria-label="Dismiss">×</button>`;
  container.appendChild(toast);

  const remove = () => {
    if (toast.classList.contains("leaving")) return;
    toast.classList.add("leaving");
    setTimeout(() => toast.remove(), 300);
  };
  $(".toast-close", toast).addEventListener("click", remove);
  setTimeout(remove, duration);

  // Keep the stack tidy
  while (container.children.length > 4) container.firstElementChild.remove();
}

/* ---------------------------- Busy / loading guard ---------------------------- */
function setButtonsLoading(buttons, loading) {
  buttons.forEach((btn) => {
    btn.classList.toggle("is-loading", loading);
    btn.disabled = loading;
  });
}

async function guard(key, buttons, task) {
  if (busy.has(key)) return;         // duplicate submission prevention
  busy.add(key);
  setButtonsLoading(buttons, true);
  try {
    return await task();
  } finally {
    busy.delete(key);
    setButtonsLoading(buttons, false);
    updateActionButtons();
  }
}

/* ---------------------------- Derived data ---------------------------- */
function selectedDoctor() {
  return state.doctors.find((d) => d.id === state.selectedDoctorId) || null;
}
function doctorTokens() {
  return state.tokens.filter((t) => t.doctor && t.doctor.id === state.selectedDoctorId);
}
function currentServing() {
  return doctorTokens().find((t) => statusOf(t) === "SERVING") || null;
}
function waitingTokens() {
  return doctorTokens().filter((t) => statusOf(t) === "WAITING");
}

/* ---------------------------- Rendering ---------------------------- */
function statusBadge(status) {
  const map = { WAITING: "waiting", SERVING: "serving", COMPLETED: "completed" };
  const label = { WAITING: "Waiting", SERVING: "Serving", COMPLETED: "Completed" };
  const cls = map[status] || "other";
  const text = label[status] || (status ? status.charAt(0) + status.slice(1).toLowerCase() : "Unknown");
  return `<span class="badge ${cls}">${esc(text)}</span>`;
}
function priorityBadge(t) {
  return isPriority(t)
    ? `<span class="badge priority">★ Priority</span>`
    : `<span class="badge normal">Normal</span>`;
}

function emptyState(title, text) {
  return `
    <div class="empty">
      <div class="empty-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
      </div>
      <h4>${esc(title)}</h4>
      <p>${esc(text)}</p>
    </div>`;
}

function tokenCardHTML(t, index = 0) {
  const status = statusOf(t);
  const patient = t.patient || {};
  const doctor = t.doctor || {};
  return `
    <article class="token-card ${status.toLowerCase()} ${isPriority(t) ? "is-priority" : ""}" style="animation-delay:${Math.min(index, 8) * 40}ms">
      <div class="token-num">${esc(t.tokenNumber)}</div>
      <div class="token-info">
        <h4>${esc(patient.name || "Unknown patient")}</h4>
        <p>${esc(doctor.name || "—")}${doctor.specialization ? " · " + esc(doctor.specialization) : ""}</p>
      </div>
      <div class="token-meta">
        <div class="badges">${priorityBadge(t)}${statusBadge(status)}</div>
        ${status === "WAITING" ? `<span class="wait">Est. wait ${esc(formatWait(t.estimatedWaitTime))}</span>` : ""}
      </div>
    </article>`;
}

function setStat(id, value) {
  const el = $(id);
  const text = String(value);
  if (el.textContent !== text) {
    el.textContent = text;
    el.classList.remove("bump");
    void el.offsetWidth; // restart animation
    el.classList.add("bump");
  }
}

function renderHeader() {
  $("#currentDate").textContent = new Date().toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  $("#greeting").textContent = `${greeting}, welcome to QueueEase`;
}

function setOnline(on) {
  state.online = on;
  const chip = $("#systemStatus");
  chip.classList.toggle("online", on);
  chip.classList.toggle("offline", !on);
  $("#statusText").textContent = on ? "System online" : "Backend offline";
}

function renderDoctors() {
  const headerSelect = $("#doctorSelect");
  const tokenSelect = $("#tokenDoctor");
  const previousTokenDoctor = tokenSelect.value;

  if (!state.doctors.length) {
    const empty = `<option value="">No doctors available</option>`;
    headerSelect.innerHTML = empty;
    tokenSelect.innerHTML = empty;
    return;
  }

  if (!state.doctors.some((d) => d.id === state.selectedDoctorId)) {
    state.selectedDoctorId = state.doctors[0].id;
  }

  const options = state.doctors
    .map((d) => `<option value="${esc(d.id)}">${esc(d.name)}${d.specialization ? " — " + esc(d.specialization) : ""}</option>`)
    .join("");

  headerSelect.innerHTML = options;
  headerSelect.value = String(state.selectedDoctorId);

  tokenSelect.innerHTML = `<option value="">Select a doctor</option>` + options;
  const keep = state.doctors.some((d) => String(d.id) === previousTokenDoctor) ? previousTokenDoctor : String(state.selectedDoctorId);
  tokenSelect.value = keep;
}

function renderPatients() {
  // Dropdown in token form
  const select = $("#tokenPatient");
  const previous = select.value;
  if (!state.patients.length) {
    select.innerHTML = `<option value="">No patients registered yet</option>`;
  } else {
    select.innerHTML =
      `<option value="">Select a patient</option>` +
      state.patients
        .map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.age)} yrs${p.phone ? ", " + esc(p.phone) : ""})</option>`)
        .join("");
    if (state.patients.some((p) => String(p.id) === previous)) select.value = previous;
  }
  renderPatientTable();
}

function renderPatientTable() {
  const query = $("#patientSearch").value.trim().toLowerCase();
  const list = state.patients.filter(
    (p) => !query || String(p.name || "").toLowerCase().includes(query) || String(p.phone || "").includes(query)
  );
  $("#patientCount").textContent = state.patients.length;
  const body = $("#patientList");
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="3" class="muted">${state.patients.length ? "No patients match your search." : "No patients registered yet."}</td></tr>`;
    return;
  }
  body.innerHTML = list
    .map((p) => `<tr><td class="cell-strong">${esc(p.name)}</td><td>${esc(p.age)}</td><td>${esc(p.phone)}</td></tr>`)
    .join("");
}

function renderStats() {
  const today = todayISO();
  setStat("#statPatients", state.patients.length);
  setStat("#statWaiting", state.tokens.filter((t) => statusOf(t) === "WAITING").length);
  setStat("#statServing", state.tokens.filter((t) => statusOf(t) === "SERVING").length);
  setStat("#statCompleted", state.tokens.filter((t) => statusOf(t) === "COMPLETED" && t.tokenDate === today).length);
}

let lastServingId = null;
function renderNowServing() {
  const box = $("#nowServing");
  const serving = currentServing();
  const doctor = selectedDoctor();

  if (!doctor) {
    box.innerHTML = emptyState("No doctor selected", "Add a doctor in the backend to begin.");
    return;
  }
  if (!serving) {
    box.innerHTML = `
      <div class="serving-info">
        <span class="tiny-label">Now Serving</span>
        <h3>No patient in consultation</h3>
        <p>${esc(doctor.name)} is ready. Press “Call Next Patient” to begin.</p>
      </div>`;
    lastServingId = null;
    return;
  }

  const isNew = lastServingId !== serving.id;
  lastServingId = serving.id;
  box.innerHTML = `
    <div class="serving-number ${isNew ? "flash" : ""}">${esc(serving.tokenNumber)}</div>
    <div class="serving-info">
      <span class="tiny-label">Now Serving</span>
      <h3>${esc(serving.patient?.name || "Unknown patient")}</h3>
      <p>${esc(serving.doctor?.name || doctor.name)}${serving.doctor?.specialization ? " · " + esc(serving.doctor.specialization) : ""}</p>
      <div class="meta-row">
        ${priorityBadge(serving)}
        ${statusBadge("SERVING")}
        <span class="wait">Est. wait was ${esc(formatWait(serving.estimatedWaitTime))}</span>
      </div>
    </div>`;
}

function renderDashQueue() {
  const waiting = waitingTokens().slice(0, 5);
  const box = $("#dashQueue");
  if (!selectedDoctor()) { box.innerHTML = emptyState("No doctor selected", "Choose a doctor from the header."); return; }
  if (!waiting.length) {
    box.innerHTML = emptyState("No waiting tokens", "The queue is clear for this doctor.");
    return;
  }
  box.innerHTML = waiting.map((t, i) => tokenCardHTML(t, i)).join("");
}

function renderQueue() {
  const doctor = selectedDoctor();
  $("#queueDoctorLabel").textContent = doctor
    ? `Showing tokens for ${doctor.name}${doctor.specialization ? " · " + doctor.specialization : ""}`
    : "Select a doctor to see their queue.";

  const rank = { SERVING: 0, WAITING: 1, COMPLETED: 2 };
  let list = doctorTokens();
  const f = state.queueFilter;
  if (f === "ACTIVE") list = list.filter((t) => ["WAITING", "SERVING"].includes(statusOf(t)));
  else if (f !== "ALL") list = list.filter((t) => statusOf(t) === f);

  // Stable sort by status group only — the order inside "waiting" is left exactly as the backend returns it.
  list = list
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (rank[statusOf(a.t)] ?? 3) - (rank[statusOf(b.t)] ?? 3) || a.i - b.i)
    .map((x) => x.t);

  const box = $("#queueList");
  if (!doctor) { box.innerHTML = emptyState("No doctor selected", "Choose a doctor from the header."); return; }
  if (!list.length) {
    box.innerHTML = emptyState("Nothing to show", "No tokens match this filter yet.");
    return;
  }
  box.innerHTML = list.map((t, i) => tokenCardHTML(t, i)).join("");
}

function renderHistory() {
  const doctor = selectedDoctor();
  $("#historyDoctorLabel").textContent = doctor
    ? `Previous tokens for ${doctor.name}${doctor.specialization ? " · " + doctor.specialization : ""}`
    : "Select a doctor to see their history.";
  const body = $("#historyList");
  if (!doctor) { body.innerHTML = `<tr><td colspan="5" class="muted">Select a doctor to view history.</td></tr>`; return; }
  if (!state.history.length) {
    body.innerHTML = `<tr><td colspan="5" class="muted">No history available for this doctor yet.</td></tr>`;
    return;
  }
  body.innerHTML = state.history
    .map((t) => `
      <tr>
        <td class="cell-strong">#${esc(t.tokenNumber)}</td>
        <td>${esc(t.patient?.name || "—")}</td>
        <td>${priorityBadge(t)}</td>
        <td>${statusBadge(statusOf(t))}</td>
        <td>${formatDate(t.tokenDate)}</td>
      </tr>`)
    .join("");
}

function renderTokenResult() {
  const box = $("#tokenResult");
  const t = state.lastTokenResult;
  if (!t) {
    box.innerHTML = `
      <div class="token-placeholder">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9a2 2 0 0 0 0 6v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3a2 2 0 0 1 0-6V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1z"/><path d="M13 5v14" stroke-dasharray="2 2"/></svg>
        <h3>Your token will appear here</h3>
        <p>Choose a doctor and patient, then generate the token.</p>
      </div>`;
    return;
  }
  box.innerHTML = `
    <div class="token-display">
      <div class="kicker">TOKEN GENERATED</div>
      <div class="token-big">${esc(t.tokenNumber)}</div>
      <p class="token-patient-line">${esc(t.patient?.name || "")}</p>
      <div class="who">${esc(t.doctor?.name || "")}</div>
      <div class="spec">${esc(t.doctor?.specialization || "")}</div>
      <div class="token-wait">
        <small>Estimated wait</small>
        <strong>${esc(t.estimatedWaitTime ?? "—")}${t.estimatedWaitTime !== undefined && t.estimatedWaitTime !== null ? " minutes" : ""}</strong>
      </div>
      ${isPriority(t) ? `<div><span class="token-priority-tag">PRIORITY</span></div>` : ""}
    </div>`;
}

function updateActionButtons() {
  const noDoctor = !state.selectedDoctorId;
  const noServing = !currentServing();
  $$(".js-call-next").forEach((b) => { if (!busy.has("next")) b.disabled = noDoctor; });
  $$(".js-complete").forEach((b) => { if (!busy.has("complete")) b.disabled = noServing; });
}

function renderAll() {
  renderHeader();
  renderDoctors();
  renderPatients();
  renderStats();
  renderNowServing();
  renderDashQueue();
  renderQueue();
  renderHistory();
  renderTokenResult();
  updateActionButtons();
}

/* ---------------------------- Data loading ---------------------------- */
async function refreshData({ silent = false } = {}) {
  try {
    const [doctors, patients, tokens] = await Promise.all([
      api.getDoctors(), api.getPatients(), api.getTokens(),
    ]);
    state.doctors = Array.isArray(doctors) ? doctors : [];
    state.patients = Array.isArray(patients) ? patients : [];
    state.tokens = Array.isArray(tokens) ? tokens : [];
    renderDoctors();
    renderPatients();
    renderStats();
    renderNowServing();
    renderDashQueue();
    renderQueue();
    updateActionButtons();
    if (state.section === "history") await loadHistory({ silent: true });
    return true;
  } catch (err) {
    if (!silent) showToast(friendlyError(err, "Unable to load data. Please try again."), "error");
    return false;
  }
}

async function loadHistory({ silent = false } = {}) {
  const doctor = selectedDoctor();
  if (!doctor) { state.history = []; renderHistory(); return; }
  if (!silent) $("#historyList").innerHTML = `<tr><td colspan="5" class="muted">Loading history…</td></tr>`;
  try {
    const data = await api.getHistory(doctor.id);
    state.history = Array.isArray(data) ? data : [];
  } catch (err) {
    state.history = [];
    if (!silent) showToast(friendlyError(err, "Unable to load token history."), "error");
  }
  renderHistory();
}

/* ---------------------------- Navigation ---------------------------- */
function showSection(name) {
  if (!$(`#view-${name}`)) name = "dashboard";
  state.section = name;
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.nav === name));
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
  if (name === "history") loadHistory();
}

/* ---------------------------- Actions ---------------------------- */
function setFieldError(inputId, message) {
  const input = $(`#${inputId}`);
  const err = $(`#err-${inputId}`);
  const field = input.closest(".field");
  field.classList.toggle("invalid", Boolean(message));
  err.textContent = message || "";
}

async function handlePatientSubmit(event) {
  event.preventDefault();
  const name = $("#patientName").value.trim();
  const ageRaw = $("#patientAge").value.trim();
  const phone = $("#patientPhone").value.trim();
  const age = Number(ageRaw);

  let valid = true;
  if (name.length < 2) { setFieldError("patientName", "Please enter the patient's full name."); valid = false; } else setFieldError("patientName", "");
  if (!ageRaw || !Number.isInteger(age) || age < 0 || age > 120) { setFieldError("patientAge", "Enter a valid age (0–120)."); valid = false; } else setFieldError("patientAge", "");
  if (!/^\d{10,15}$/.test(phone)) { setFieldError("patientPhone", "Enter a valid phone number (10–15 digits)."); valid = false; } else setFieldError("patientPhone", "");
  if (!valid) { showToast("Please correct the highlighted fields.", "warning"); return; }

  await guard("patient", [$("#registerBtn")], async () => {
    try {
      const created = await api.createPatient({ name, age, phone });
      $("#patientForm").reset();
      await refreshData({ silent: true });
      if (created && created.id !== undefined) $("#tokenPatient").value = String(created.id);
      showToast("Patient registered successfully", "success");
    } catch (err) {
      showToast(friendlyError(err, "Unable to register the patient. Please check the details and try again."), "error");
    }
  });
}

async function handleTokenSubmit(event) {
  event.preventDefault();
  const doctorId = $("#tokenDoctor").value;
  const patientId = $("#tokenPatient").value;

  let valid = true;
  if (!doctorId) { setFieldError("tokenDoctor", "Please select a doctor."); valid = false; } else setFieldError("tokenDoctor", "");
  if (!patientId) { setFieldError("tokenPatient", "Please select a patient."); valid = false; } else setFieldError("tokenPatient", "");
  if (!valid) { showToast("Please select a doctor and a patient.", "warning"); return; }

  await guard("generate", [$("#generateBtn")], async () => {
    try {
      const token = await api.generateToken(doctorId, patientId, $("#tokenPriority").checked);
      state.lastTokenResult = token;
      renderTokenResult();
      await refreshData({ silent: true });
      showToast("Token generated successfully", "success");
    } catch (err) {
      showToast(friendlyError(err, "Unable to generate token. Please check the queue."), "error");
    }
  });
}

async function handleCallNext() {
  if (!state.selectedDoctorId) { showToast("Please select a doctor first.", "warning"); return; }
  await guard("next", $$(".js-call-next"), async () => {
    try {
      await api.callNext(state.selectedDoctorId);
      await refreshData({ silent: true });
      showToast("Patient called successfully", "success");
    } catch (err) {
      showToast(friendlyError(err, "Unable to call the next patient. Please check the queue."), "error");
    }
  });
}

async function handleComplete() {
  const serving = currentServing();
  if (!serving) { showToast("No patient is currently being served.", "warning"); return; }
  await guard("complete", $$(".js-complete"), async () => {
    try {
      await api.completeToken(serving.id);
      await refreshData({ silent: true });
      showToast("Consultation completed", "success");
    } catch (err) {
      showToast(friendlyError(err, "Unable to complete the consultation. Please try again."), "error");
    }
  });
}

async function handleDoctorChange(event) {
  state.selectedDoctorId = Number(event.target.value) || null;
  $("#tokenDoctor").value = state.selectedDoctorId ? String(state.selectedDoctorId) : "";
  lastServingId = null;
  renderNowServing();
  renderDashQueue();
  renderQueue();
  updateActionButtons();
  if (state.section === "history") await loadHistory();
  else state.history = [];
}

/* ---------------------------- Init ---------------------------- */
function bindEvents() {
  // Navigation (sidebar + any [data-goto] shortcuts)
  document.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-nav]");
    if (nav) return showSection(nav.dataset.nav);
    const go = e.target.closest("[data-goto]");
    if (go) showSection(go.dataset.goto);
  });

  $("#patientForm").addEventListener("submit", handlePatientSubmit);
  $("#tokenForm").addEventListener("submit", handleTokenSubmit);
  $("#doctorSelect").addEventListener("change", handleDoctorChange);
  $("#patientSearch").addEventListener("input", renderPatientTable);
  $("#refreshHistoryBtn").addEventListener("click", () => guard("history", [$("#refreshHistoryBtn")], () => loadHistory()));

  $$(".js-call-next").forEach((b) => b.addEventListener("click", handleCallNext));
  $$(".js-complete").forEach((b) => b.addEventListener("click", handleComplete));

  // Keep the token form's doctor in sync with header when the user changes it manually
  $("#tokenDoctor").addEventListener("change", () => setFieldError("tokenDoctor", ""));
  $("#tokenPatient").addEventListener("change", () => setFieldError("tokenPatient", ""));

  // Clear validation messages as the user types
  ["patientName", "patientAge", "patientPhone"].forEach((id) =>
    $(`#${id}`).addEventListener("input", () => setFieldError(id, ""))
  );
  // Phone: digits only
  $("#patientPhone").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, ""); });

  // Queue filters
  $("#queueFilters").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    state.queueFilter = chip.dataset.filter;
    $$(".chip", $("#queueFilters")).forEach((c) => c.classList.toggle("active", c === chip));
    renderQueue();
  });

  window.addEventListener("hashchange", () => showSection(location.hash.replace("#", "") || "dashboard"));
}

async function init() {
  bindEvents();
  renderAll();
  showSection(location.hash.replace("#", "") || "dashboard");

  const ok = await refreshData();
  if (!ok) setOnline(false);

  // Live-looking queue: quietly poll the backend
  setInterval(() => {
    if (busy.size === 0 && document.visibilityState === "visible") refreshData({ silent: true });
  }, POLL_INTERVAL_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshData({ silent: true });
  });
}

document.addEventListener("DOMContentLoaded", init);