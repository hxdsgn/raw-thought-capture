import { auth, provider, signInWithPopup, saveEntry, ensureAuth, fetchOpenContexts, markEntryDone, markEntryActive, updateEntry, deleteEntry } from "./firebase.local.js";

// --- STATE MANAGEMENT ---
// --- STATE MANAGEMENT ---
let appState = {
  currentView: 'capture', // capture, settings, detail
  captureStorageMode: localStorage.getItem("storage_mode") || "firebase", // Main/Capture
  settingsStorageMode: localStorage.getItem("settings_storage_mode") || "firebase", // Manager/Settings
  activeTab: 'active', // active, done, trash
  currentDetailId: null,
  threadSortAsc: true,
  threadSearchQuery: "",

  // Refactored Source State
  sourceMode: localStorage.getItem("source_mode") || "custom", // custom, root, full
  customSources: JSON.parse(localStorage.getItem("custom_sources_list") || '["Idea", "Draft", "Note"]'),
  selectedCustomSource: localStorage.getItem("selected_custom_source") || "Idea"
};

// Getter for backward compatibility or explicit usage
Object.defineProperty(appState, 'storageMode', {
  get: function () { return this.captureStorageMode; }, // Default to Capture for generic accesses
  set: function (v) { this.captureStorageMode = v; }
});

// --- DOM ELEMENTS ---
const els = {
  // Views
  viewCapture: document.getElementById("view-capture"),
  viewSettings: document.getElementById("view-settings"),
  settingsBtn: document.getElementById("settings-btn"),
  backBtn: document.getElementById("back-btn"),

  // Tabs (Standard)
  tabConfig: document.getElementById("tab-config"),
  panelContext: document.getElementById("panel-context"),
  panelConfig: document.getElementById("panel-config"),

  // Context Manager (Settings)
  filterGroup: document.getElementById("filter-group"),
  btnDelGroup: document.getElementById("btn-del-group"),
  filterCat: document.getElementById("filter-cat"),
  btnDelCat: document.getElementById("btn-del-cat"),
  contextList: document.getElementById("context-list"),
  forceSyncBtn: document.getElementById("force-sync-btn"),
  clearCacheBtn: document.getElementById("clear-cache-btn"),

  // Config Manager
  configAutosync: document.getElementById("config-autosync"),
  cfgApiKey: document.getElementById("cfg-apikey"),
  cfgAuthDomain: document.getElementById("cfg-authdomain"),
  cfgProjectId: document.getElementById("cfg-projectid"),
  saveConfigBtn: document.getElementById("save-config-btn"),
  configStatus: document.getElementById("config-status"),

  // Capture UI
  content: document.getElementById("content"),
  previewBtn: document.getElementById("preview-btn"),
  markdownView: document.getElementById("markdown-preview"),
  note: document.getElementById("note"),

  // Source UI (Refactored)
  sourceModeSwitch: document.getElementById("source-mode-switch"),
  sourcePreview: document.getElementById("source-preview"),

  // Settings: Custom Source
  cfgCustomSelect: document.getElementById("cfg-custom-source"),
  cfgDelCustomBtn: document.getElementById("btn-del-custom-source"),
  cfgNewSourceInput: document.getElementById("cfg-new-source"),
  cfgAddCustomBtn: document.getElementById("btn-add-custom-source"),

  groupSelect: document.getElementById("group-select"),
  groupNew: document.getElementById("group-new"),
  catSelect: document.getElementById("category-select"),
  catNew: document.getElementById("category-new"),
  sessionSelect: document.getElementById("session-select"),
  threadPreview: document.getElementById("thread-preview"),
  previewContent: document.getElementById("preview-content"),
  previewNote: document.getElementById("preview-note"),
  saveBtn: document.getElementById("save-btn"),
  status: document.getElementById("status-msg"),
  dot: document.getElementById("status-dot")
};

// --- EXTENDED ELEMENTS (PKM) ---
const els_ex = {
  viewDetail: document.getElementById("view-detail"),
  detailBack: document.getElementById("detail-back-btn"),
  detailRoot: document.getElementById("detail-root-card"),
  detailList: document.getElementById("detail-list"),
  detailTitle: document.getElementById("detail-title"),
  storageSelect: document.getElementById("storage-mode-select"),
  // Tabs
  tabActive: document.getElementById("tab-active"),
  tabDone: document.getElementById("tab-done"),
  tabTrash: document.getElementById("tab-trash"),
  threadSortBtn: document.getElementById("thread-sort-btn"),
  threadSearch: document.getElementById("thread-search"),
  threadActionsBar: document.getElementById("thread-actions-bar"),
  fetchCloudBtn: document.getElementById("fetch-cloud-btn"),
  autoFetchToggle: document.getElementById("auto-fetch-toggle"),
  // Error Modal
  errorModal: document.getElementById("error-modal"),
  errorMessage: document.getElementById("error-message"),
  errorCloseBtn: document.getElementById("error-close-btn")
};

let currentSourceUrl = "";
let openingMode = "popup_manual";
let cachedSessions = [];
let isPreviewMode = false;

// --- UTILITIES: ERROR HANDLING ---
function showError(msg) {
  if (els_ex.errorMessage) {
    els_ex.errorMessage.textContent = msg || "Unknown Error";
    els_ex.errorModal.classList.remove("hidden");
  } else {
    console.error("Error Modal Missing:", msg);
    alert(msg); // Fallback
  }
}

if (els_ex.errorCloseBtn) {
  els_ex.errorCloseBtn.addEventListener("click", () => {
    els_ex.errorModal.classList.add("hidden");
  });
}

// --- 1. INITIALIZATION & CLEANUP ---

async function init() {
  try {
    loadConfigUI();
    initSourceLogic(); // Initialize Source Switch & Settings
    await loadDropdowns();

    // Set Storage Mode UI
    // els_ex.storageSelect.value = appState.storageMode; // Handled by separate event listener setup now

    // Clean up old trash
    cleanupTrash();

    await loadRecentSessions();

    // Setup Tabs
    setupTabs();

    // Auto-Sync Check
    const autoSync = localStorage.getItem("autosync_enabled") === "true";
    if (autoSync && appState.storageMode === 'firebase') {
      await performSync(true); // true = silent mode
    }

    // Check for Text Selection from Context Menu
    let data = await chrome.storage.local.get("pendingCapture");
    if (!data.pendingCapture) {
      await new Promise(r => setTimeout(r, 50));
      data = await chrome.storage.local.get("pendingCapture");
    }
    const pending = data.pendingCapture;

    if (pending) {
      els.content.value = pending.text || "";
      currentSourceUrl = pending.url || "";
      openingMode = pending.mode;
      await chrome.storage.local.remove("pendingCapture");
    } else {
      openingMode = "popup_manual";
      // Check for Active Tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        currentSourceUrl = tab.url;
        // Inject script to grab selection manually
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => window.getSelection().toString()
        }, (results) => {
          if (results?.[0]?.result) { els.content.value = results[0].result; }
        });
      }
    }



    // Bind Thread View Controls
    if (els_ex.threadSortBtn) {
      els_ex.threadSortBtn.addEventListener("click", () => {
        appState.threadSortAsc = !appState.threadSortAsc;
        els_ex.threadSortBtn.textContent = appState.threadSortAsc ? "⬇️" : "⬆️";
        const current = cachedSessions.find(s => s.id === appState.currentDetailId);
        if (current) openDetailView(current);
      });
    }
    if (els_ex.threadSearch) {
      els_ex.threadSearch.addEventListener("input", (e) => {
        appState.threadSearchQuery = e.target.value.toLowerCase();
        const current = cachedSessions.find(s => s.id === appState.currentDetailId);
        if (current) openDetailView(current);
      });
    }

    updateSourceDisplay();
  } catch (err) { console.error("Init Error:", err); }
}

// 24 Hour Cleanup Routine
async function cleanupTrash() {
  const data = await chrome.storage.local.get("recent_sessions");
  let sessions = data.recent_sessions || [];
  const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);

  const initialCount = sessions.length;
  // Keep items that are NOT (status=trash AND deletedAt < 24h ago)
  sessions = sessions.filter(s => {
    if (s.status === 'trash' && s.deletedAt < oneDayAgo) return false;
    return true;
  });

  if (sessions.length !== initialCount) {
    await chrome.storage.local.set({ recent_sessions: sessions });
    console.log(`Cleaned up ${initialCount - sessions.length} trash items.`);
  }
}

// --- 2. STORAGE & SYNC ---

// --- 2. STORAGE & SYNC ---

// A. CAPTURE STORAGE (Header)
const headerStorage = document.getElementById("header-storage-select");
headerStorage.value = appState.captureStorageMode;

headerStorage.addEventListener("change", (e) => {
  appState.captureStorageMode = e.target.value;
  localStorage.setItem("storage_mode", appState.captureStorageMode);
  updateStorageFeedback(appState.captureStorageMode);
  renderContextList(); // REFRESH LIST
  loadRecentSessions(); // REFRESH DROPDOWN
});

// B. SETTINGS STORAGE (Manager)
const settingsStorage = document.getElementById("storage-mode-select");
const forceSyncBtn = document.getElementById("force-sync-btn");

if (settingsStorage) {
  settingsStorage.value = appState.settingsStorageMode;

  // Init Visibility
  if (forceSyncBtn) forceSyncBtn.style.display = appState.settingsStorageMode === 'local' ? 'none' : 'block';

  settingsStorage.addEventListener("change", (e) => {
    appState.settingsStorageMode = e.target.value;
    localStorage.setItem("settings_storage_mode", appState.settingsStorageMode);

    // Toggle Sync Button
    if (forceSyncBtn) forceSyncBtn.style.display = appState.settingsStorageMode === 'local' ? 'none' : 'block';

    renderContextList(); // Specific refresh for Settings
  });
}

function updateStorageFeedback(mode) {
  const label = mode === 'firebase' ? '☁️ Cloud' : '💻 Local';
  els.status.textContent = `Capture: ${label}`;
  els.dot.style.backgroundColor = mode === 'firebase' ? '#3b82f6' : '#666';
  setTimeout(() => els.status.textContent = "", 2000);
}

// Init Feedback
updateStorageFeedback(appState.captureStorageMode);

// FORMAT TOGGLE
document.getElementById("format-btn").addEventListener("click", (e) => {
  const btn = e.currentTarget;
  const isCode = els.content.classList.toggle("format-code");
  btn.classList.toggle("active", isCode);
});

// CODE BLOCK WRAPPER (Auto-Wrap for Lazy Users)
document.getElementById("code-block-btn").addEventListener("click", () => {
  const start = els.content.selectionStart;
  const end = els.content.selectionEnd;
  const text = els.content.value;

  // Logic: If selection exists, wrap selection.
  // If NO selection, wrap EVERYTHING (User request: "I pasted code, make it code")

  if (start === end) {
    // Wrap All
    els.content.value = "```\n" + text + "\n```";
  } else {
    // Wrap Selection
    const selected = text.substring(start, end);
    els.content.value = text.substring(0, start) + "\n```\n" + selected + "\n```\n" + text.substring(end);
  }

  // Auto-enable Monospace View
  els.content.classList.add("format-code");
  document.getElementById("format-btn").classList.add("active");
});

async function performSync(silent = false) {
  if (appState.storageMode !== 'firebase') {
    if (!silent) alert("Sync not available in Local Mode");
    return;
  }
  if (!silent) els.forceSyncBtn.textContent = "Syncing...";
  try {
    if (!auth.currentUser) await ensureAuth().catch(() => signInWithPopup(auth, provider));
    const freshData = await fetchOpenContexts();

    // Sort: Newest first
    freshData.sort((a, b) => b.timestamp - a.timestamp);

    // MERGE LOGIC: Combine Cloud Data with Local Data
    const localDataObj = await chrome.storage.local.get("recent_sessions");
    const localData = localDataObj.recent_sessions || [];

    const mergedMap = new Map();
    // 1. Keep all Local Data first
    localData.forEach(item => mergedMap.set(item.id, item));

    // 2. Merge Cloud Data (Overwrite matches, Add new, OPTIMIZE Storage)
    freshData.forEach(item => {
      // Optimization: If Follower (Reply), store only essential data
      if (item.sessionRef) {
        const optimized = {
          id: item.id,
          sessionRef: item.sessionRef,
          timestamp: item.timestamp,
          status: item.status,
          content: item.content, // Required for display/search
          note: item.note,       // Required for context
          sessionId: item.sessionId || null // Should be null for follower but keep if exists
        };
        mergedMap.set(item.id, optimized);
      } else {
        // Leader (Root): Keep full context (Group, Category, Source, etc)
        mergedMap.set(item.id, item);
      }
    });

    const mergedList = Array.from(mergedMap.values());
    mergedList.sort((a, b) => b.timestamp - a.timestamp);

    await chrome.storage.local.set({ recent_sessions: mergedList });

    // Update Dropdowns based on synced data
    const groups = new Set(JSON.parse(localStorage.getItem("saved_groups") || "[]"));
    const cats = new Set(JSON.parse(localStorage.getItem("saved_categories") || "[]"));

    freshData.forEach(d => {
      if (d.group) groups.add(d.group);
      if (d.category) cats.add(d.category);
    });

    localStorage.setItem("saved_groups", JSON.stringify([...groups]));
    localStorage.setItem("saved_categories", JSON.stringify([...cats]));

    if (!silent) {
      renderContextList();
      els.forceSyncBtn.textContent = "Synced!";
      setTimeout(() => els.forceSyncBtn.textContent = "↻ Sync from Firebase", 1500);
    }
    await loadRecentSessions();
  } catch (e) {
    console.error(e);
    if (!silent) els.forceSyncBtn.textContent = "Sync Failed";
  }
}

els.forceSyncBtn.addEventListener("click", () => performSync(false));

// --- 3. VIEW & TAB NAVIGATION ---

els.settingsBtn.addEventListener("click", () => {
  renderSettings();
  els.viewCapture.classList.add("hidden");
  els.viewSettings.classList.remove("hidden");
  if (!appState.activeTab) appState.activeTab = 'active';
});

els.backBtn.addEventListener("click", () => {
  els.viewSettings.classList.add("hidden");
  els.viewCapture.classList.remove("hidden");
  loadDropdowns();
  loadRecentSessions();
});

function setupTabs() {
  // Context Tabs (Active, Done, Trash)
  [els_ex.tabActive, els_ex.tabDone, els_ex.tabTrash].forEach(btn => {
    if (!btn) return;
    btn.addEventListener("click", () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (btn.id === 'tab-active') appState.activeTab = 'active';
      if (btn.id === 'tab-done') appState.activeTab = 'done';
      if (btn.id === 'tab-trash') appState.activeTab = 'trash';

      // UI Toggle
      els.panelContext.classList.remove("hidden");
      els.panelConfig.classList.add("hidden");
      if (els.tabConfig) els.tabConfig.classList.remove("active");

      renderContextList();
    });
  });

  // Config Tab
  if (els.tabConfig) {
    els.tabConfig.addEventListener("click", () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      els.tabConfig.classList.add("active");
      els.panelContext.classList.add("hidden");
      els.panelConfig.classList.remove("hidden");
    });
  }
}

// --- 4. SETTINGS: CONTEXT MANAGER ---

async function renderSettings() {
  await loadFilters();
  renderContextList();
}

async function loadFilters() {
  const groups = JSON.parse(localStorage.getItem("saved_groups") || "[]");
  const cats = JSON.parse(localStorage.getItem("saved_categories") || "[]");
  populateFilter(els.filterGroup, groups, "Group");
  populateFilter(els.filterCat, cats, "Category");
}

function populateFilter(selectEl, items, type) {
  const currentVal = selectEl.value;
  selectEl.innerHTML = `<option value="all">All ${type}s</option>`;
  items.forEach(item => {
    const opt = document.createElement("option"); opt.value = item; opt.text = item;
    selectEl.appendChild(opt);
  });
  selectEl.value = "all";
  if (items.includes(currentVal)) selectEl.value = currentVal;
  updateDeleteBtnState();
}

function updateDeleteBtnState() {
  els.btnDelGroup.disabled = els.filterGroup.value === "all";
  els.btnDelCat.disabled = els.filterCat.value === "all";
}

els.filterGroup.addEventListener("change", () => { updateDeleteBtnState(); renderContextList(); });
els.filterCat.addEventListener("change", () => { updateDeleteBtnState(); renderContextList(); });

els.btnDelGroup.addEventListener("click", () => {
  const val = els.filterGroup.value;
  if (val !== "all" && confirm(`Strict Warning: Delete Group "${val}"?`)) {
    deleteFromStorage("saved_groups", val);
    loadFilters(); renderContextList();
  }
});
els.btnDelCat.addEventListener("click", () => {
  const val = els.filterCat.value;
  if (val !== "all" && confirm(`Strict Warning: Delete Category "${val}"?`)) {
    deleteFromStorage("saved_categories", val);
    loadFilters(); renderContextList();
  }
});

function deleteFromStorage(key, value) {
  let items = JSON.parse(localStorage.getItem(key) || "[]");
  items = items.filter(i => i !== value);
  localStorage.setItem(key, JSON.stringify(items));
}

/* -------------------------------------------------------------------------- */
/*                        3. STATUS & DELETION LOGIC                          */
/* -------------------------------------------------------------------------- */

// Helper to update status (Active <-> Done <-> Trash)
async function updateStatus(id, status) {
  // 1. Local Update
  const data = await chrome.storage.local.get("recent_sessions");
  const sessions = data.recent_sessions || [];
  const idx = sessions.findIndex(s => s.id === id);

  if (idx !== -1) {
    sessions[idx].status = status;
    if (status === 'trash') sessions[idx].deletedAt = Date.now();
    else delete sessions[idx].deletedAt; // Restore

    await chrome.storage.local.set({ recent_sessions: sessions });
  }

  // 2. Cloud Update
  // Note: We use appState.captureStorageMode or check ID prefix?
  // Use ID prefix to be safe.
  if (!id.startsWith('loc_')) {
    try {
      await updateEntry(id, { status: status, deletedAt: status === 'trash' ? Date.now() : null });
    } catch (e) {
      console.error("Cloud update failed", e);
      showError("Failed to sync status change to Cloud.");
    }
  }

  // 3. UI Refresh
  // If we are in Manager Modal, we might need to refresh that list too?
  // Manager handles its own refresh via loadRecentSessions -> openManager
  // But Trash View needs renderContextList.
  renderContextList();
}

/* -------------------------------------------------------------------------- */
/*                           PERMANENT DELETION                               */
/* -------------------------------------------------------------------------- */
async function deletePermanent(id, batchMode = false) {
  if (!batchMode && !confirm("Permanently delete this item?")) return;

  // 1. Local Delete
  const data = await chrome.storage.local.get("recent_sessions");
  let sessions = data.recent_sessions || [];

  // Cleanup Auxiliary Keys (Auto-FetchPrefs, etc)
  const item = sessions.find(s => s.id === id);
  if (item) {
    const key = item.sessionId || item.id; // Thread Key
    localStorage.removeItem("autofetch_" + key);
    // Add any other keys if they exist
  }

  sessions = sessions.filter(s => s.id !== id);
  await chrome.storage.local.set({ recent_sessions: sessions });

  // 2. Cloud Delete
  if (!id.startsWith('loc_')) {
    try {
      await deleteEntry(id);
    } catch (e) { console.error("Cloud delete failed", e); }
  }

  if (!batchMode) renderContextList();
}

// --- 4. RENDER CONTEXT LIST (MANAGER) ---
// UPDATED: Now filters by appState.settingsStorageMode
async function renderContextList() {
  els.contextList.innerHTML = "";
  const data = await chrome.storage.local.get("recent_sessions");
  const sessions = data.recent_sessions || [];

  const currentStatus = appState.activeTab || 'active'; // active, done, trash

  // FIX: Smart View Detection
  // If Settings View is visible, use Settings Mode. Else use Capture Mode (Header)
  const isSettingsView = !els.viewSettings.classList.contains("hidden");
  const viewMode = isSettingsView ? appState.settingsStorageMode : appState.captureStorageMode;

  // Filter Logic
  const filtered = sessions.filter(s => {
    let itemStatus = s.status || 'active';
    if (itemStatus === 'open') itemStatus = 'active';

    // 1. Status Check
    const matchesTab = itemStatus === currentStatus;
    if (!matchesTab) return false;

    // 2. Storage Mode Check
    const isLocalItem = s.id.startsWith('loc_');
    if (viewMode === 'local' && !isLocalItem) return false; // View Local -> Hide non-local
    if (viewMode === 'firebase' && isLocalItem) return false; // View Cloud -> Hide local

    // 3. Group/Category Filter
    const matchesFilter = (els.filterGroup.value === "all" || s.group === els.filterGroup.value) &&
      (els.filterCat.value === "all" || s.category === els.filterCat.value);
    if (!matchesFilter) return false;

    // 4. HIDE REPLIES from Main List, UNLESS in Trash
    const isRoot = !s.sessionRef;
    if (currentStatus === 'trash') return true; // Show all trash items that passed previous filters
    return isRoot; // Only show root items for active/done tabs
  });

  els.contextList.innerHTML = "";

  // --- TRASH VIEW: GROUPED START ---
  if (currentStatus === 'trash') {
    // 1. Group Items by Thread
    const groups = {};

    filtered.forEach(item => {
      const threadId = item.sessionRef || item.id; // If Reply -> Ref, If Root -> Id
      if (!groups[threadId]) {
        // Find Parent Meta
        const parent = sessions.find(s => s.id === threadId || s.sessionId === threadId);
        groups[threadId] = {
          parent: parent,
          items: []
        };
      }
      groups[threadId].items.push(item);
    });

    // 2. Render Batch Bar
    if (filtered.length > 0) {
      const batchBar = document.createElement("div");
      batchBar.style.cssText = "display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; gap:10px;";
      batchBar.innerHTML = `
            <div class="toggle-container" style="flex:1;" data-tooltip="Select All">
                <label class="switch-full">
                    <input type="checkbox" id="batch-select-all">
                    <span class="slider"></span>
                </label>
            </div>
            <button id="batch-restore-btn" class="btn-glass-primary" style="flex:2;">Restore Selected</button>
            <button id="batch-delete-btn" class="btn-glass-danger" style="flex:2;">Delete Selected</button>
        `;
      els.contextList.appendChild(batchBar);
    }

    // 3. Render Groups
    // 3. Render Groups
    Object.keys(groups).forEach(threadId => {
      const group = groups[threadId];
      const parentNote = group.parent ? (group.parent.note || group.parent.content?.substring(0, 30) || "Thread") : "Unknown Thread";

      const groupEl = document.createElement("div");
      groupEl.className = "ctx-item group-container";
      groupEl.style.cssText = "flex-direction:column; padding:0; align-items:stretch;";

      // Group Header
      const headerHTML = `
            <div class="group-header" style="display:flex; align-items:center; padding:10px; cursor:pointer; background:#222;">
               <input type="checkbox" class="group-check" data-thread="${threadId}" style="margin-right:10px;">
               <span style="font-size:12px; font-weight:600; color:#ddd; flex-grow:1;">Trash of [${parentNote}]</span>
               <span class="badge-count" style="margin-right:8px;">${group.items.length}</span>
               <div style="font-size:10px; color:#666;">▼</div>
            </div>
          `;

      // Group Body (Items)
      let bodyHTML = `<div class="group-body" style="display:none; border-top:1px solid #333;">`;
      group.items.forEach(item => {
        const date = new Date(item.timestamp).toLocaleDateString();
        const text = item.content ? item.content.substring(0, 50).replace(/</g, "&lt;") : "(No content)";

        // Note Display
        const noteHTML = item.note ? `<span style="color:#fff; font-weight:600; margin-right:6px;">${item.note}</span>` : "";

        bodyHTML += `
                 <div id="trash-item-${item.id}" class="ctx-item-child" style="display:flex; align-items:center; padding:8px 10px; border-bottom:1px solid #1a1a1a;">
                    <input type="checkbox" class="trash-check child-check-${threadId}" data-id="${item.id}" style="margin-right:10px;">
                    <div style="flex-grow:1; font-size:11px; color:#aaa; display:flex; align-items:center;">
                        <span style="color:#666; margin-right:8px; font-size:10px;">${date}</span> 
                        ${noteHTML}
                        <span style="opacity:0.8;">${text}...</span>
                    </div>
                    <button class="icon-btn" data-action="restore" data-id="${item.id}" title="Restore" style="margin-right:4px;">♻️</button>
                    <button class="icon-btn-danger" data-action="delete" data-id="${item.id}" title="Delete Permanent" style="padding:2px;">✕</button>
                 </div>
              `;
      });
      bodyHTML += `</div>`;

      groupEl.innerHTML = headerHTML + bodyHTML;
      els.contextList.appendChild(groupEl);

      // Event: Toggle Accordion
      groupEl.querySelector('.group-header').addEventListener('click', () => {
        const body = groupEl.querySelector('.group-body');
        const arrow = groupEl.querySelector('div:last-child');
        const isOpen = body.style.display === 'block';
        body.style.display = isOpen ? 'none' : 'block';
        arrow.textContent = isOpen ? '▼' : '▲';
      });

      // Event: Group Checkbox
      const groupCheck = groupEl.querySelector('.group-check');
      groupCheck.addEventListener('click', (e) => e.stopPropagation()); // Stop Accordion toggle
      groupCheck.addEventListener('change', (e) => {
        groupEl.querySelectorAll('.trash-check').forEach(cb => cb.checked = e.target.checked);
      });

      // Event Delegation for Items
      const bodyEl = groupEl.querySelector('.group-body');
      bodyEl.addEventListener('click', (e) => {
        // Handle Buttons
        const btn = e.target.closest('button');
        if (btn) {
          e.stopPropagation();
          const action = btn.dataset.action;
          const id = btn.dataset.id;
          if (action === "restore") updateStatus(id, 'active');
          if (action === "delete") deletePermanent(id);
        }
        // Handle Checkboxes bubble
        if (e.target.type === 'checkbox') e.stopPropagation();
      });
    });

    // Bind Batch Events
    setTimeout(() => {
      const selectAll = document.getElementById("batch-select-all");
      const delBtn = document.getElementById("batch-delete-btn");
      const restoreBtn = document.getElementById("batch-restore-btn");

      if (selectAll) selectAll.onchange = (e) => {
        document.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = e.target.checked);
      };

      if (restoreBtn) restoreBtn.onclick = async () => {
        const checked = document.querySelectorAll('.trash-check:checked');
        if (checked.length === 0) return alert("Nothing selected.");

        restoreBtn.textContent = "Multi-Restore...";
        for (const cb of checked) {
          await updateStatus(cb.dataset.id, 'active');
        }
        // renderContextList() called implicitly by updateStatus? 
        // updateStatus calls renderContextList(), but calling it in loop causes flicker.
        // But since we await, it is sequential. It is fine for now or we could optimistically do it.
      };

      if (delBtn) delBtn.onclick = async () => {
        const checked = document.querySelectorAll('.trash-check:checked');
        if (checked.length === 0) return alert("Nothing selected.");
        if (!confirm(`Permanently delete ${checked.length} items?`)) return;

        delBtn.textContent = "Deleting...";
        for (const cb of checked) {
          await deletePermanent(cb.dataset.id, true);
        }
        renderContextList();
      };
    }, 0);

    return; // EXIT FUNCTION for Trash Mode
  }
  // --- TRASH VIEW: GROUPED END ---

  filtered.forEach(sess => {
    // FIX: Match children using Custom Session ID if available
    const threadKey = sess.sessionId || sess.id;
    // Count only NON-TRASH children
    const childCount = sessions.filter(x => x.sessionRef === threadKey && x.status !== 'trash').length;
    const isLocal = sess.id && sess.id.startsWith('loc_');
    const isModeLocked = (appState.storageMode === 'local' && !isLocal) || (appState.storageMode === 'firebase' && isLocal);

    const item = document.createElement("div");
    item.className = "ctx-item";
    if (isModeLocked) item.classList.add('disabled');

    // Assign ID for instant removal
    item.id = `ctx-item-${sess.id}`;

    const mainContent = sess.content || sess.title || "";
    let titleText = sess.note || mainContent || "(Untitled)";

    // FORMAT REPLY TITLES IN TRASH
    if (currentStatus === 'trash' && sess.sessionRef) {
      const parent = sessions.find(p => (p.sessionId === sess.sessionRef || p.id === sess.sessionRef));
      const parentName = parent ? (parent.note || "Thread") : "Unknown Thread";
      titleText = `<span style="color:#aaa; font-weight:400;">Trash of</span> [${parentName}] <span style="font-size:10px; opacity:0.7;">(${sess.sessionRef})</span>`;
    }

    // Tag Badge
    const localTag = isLocal ? '<span class="badge-tag local">LOCAL</span>' : '';

    let displayStatus = sess.status || 'active';
    if (displayStatus === 'open') displayStatus = 'active';

    item.innerHTML = `
            <div class="ctx-header">
                <div class="ctx-info">
                    <div class="ctx-title">
                        ${titleText} ${localTag}
                        ${!sess.sessionRef ? `<span class="badge-count">${childCount}</span>` : ''}
                    </div>
                    <div class="ctx-meta">
                        ${currentStatus === 'trash' ? `<input type="checkbox" class="trash-check" data-id="${sess.id}" style="margin-right:6px;">` : ''}
                        ${new Date(sess.timestamp).toLocaleDateString()} • ${sess.group || '-'}
                    </div>
                </div>
                <div class="ctx-actions">
                    ${getActionButtons(sess.id, displayStatus, isModeLocked)}
                </div>
            </div>
            <div class="ctx-body" style="display:none; padding:10px; font-size:13px; color:#ccc; border-top:1px solid #333;">${mainContent}</div>
        `;

    // 1. Accordion Toggle (Whole Header)
    const header = item.querySelector('.ctx-header');
    header.addEventListener('click', () => {
      const body = item.querySelector('.ctx-body');
      if (body.style.display === 'none') {
        body.style.display = 'block';
        item.classList.add('open');
      } else {
        body.style.display = 'none';
        item.classList.remove('open');
      }
    });

    // 2. Action Buttons (Event Delegation)
    const actionContainer = item.querySelector('.ctx-actions');
    actionContainer.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent Accordion Toggle
      const btn = e.target.closest('.ctx-btn');
      if (!btn || btn.disabled) return;

      const action = btn.dataset.action;
      const id = btn.dataset.id;

      if (action === 'thread') openDetailViewViaId(id);
      if (action === 'delete-perm') deletePermanent(id);
      if (action === 'mark-done') updateStatus(id, 'done');
      if (action === 'mark-undone') updateStatus(id, 'active');
      if (action === 'mark-trash') updateStatus(id, 'trash');
    });

    els.contextList.appendChild(item);
  });

  // --- RESCUE / DEBUG: IF EMPTY ---
  if (filtered.length === 0) {
    els.contextList.innerHTML = `<div style="padding:20px; text-align:center; color:#666; font-style:italic;">No items found.</div>`;
  }
}

function getActionButtons(id, status, isLocked) {
  const disabledAttr = isLocked ? 'disabled' : '';

  // Use data attributes instead of onclick
  const threadBtn = `<button class="ctx-btn" title="Open Thread" style="padding:4px;" data-action="thread" data-id="${id}">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block; pointer-events:none;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
  </button>`;

  if (status === 'trash') {
    return `${threadBtn}<button class="ctx-btn ctx-btn-del" ${disabledAttr} data-action="delete-perm" data-id="${id}">Kill</button>`;
  } else if (status === 'done') {
    return `
            ${threadBtn}
            <button class="ctx-btn" ${disabledAttr} data-action="mark-undone" data-id="${id}">Undone</button>
            <button class="ctx-btn ctx-btn-del" ${disabledAttr} data-action="mark-trash" data-id="${id}">Del</button>
        `;
  } else {
    return `
            ${threadBtn}
            <button class="ctx-btn ctx-btn-done" ${disabledAttr} data-action="mark-done" data-id="${id}">Done</button>
            <button class="ctx-btn ctx-btn-del" ${disabledAttr} data-action="mark-trash" data-id="${id}">Del</button>
        `;
  }
}

// Global functions attached to window are still fine, but we use direct calls in listeners now.
// Keeping these for completeness if used elsewhere.
window.openDetailViewViaId = async (id) => {
  const data = await chrome.storage.local.get("recent_sessions");
  const sessions = data.recent_sessions || [];
  const item = sessions.find(s => s.id === id);
  if (item) {
    await openDetailView(item);
  }
};

window.updateStatus = async (id, newStatus) => {
  // Optimistic UI Update (Instant Delete/Move)
  const itemRow = document.getElementById(`ctx-item-${id}`);
  if (itemRow) {
    itemRow.style.opacity = '0.5';
    // If moving out of view
    if (newStatus === 'trash' || newStatus === 'done' || newStatus === 'active') {
      if (appState.activeTab !== newStatus && appState.activeTab !== 'all') {
        itemRow.remove();
      }
    }
  }

  const data = await chrome.storage.local.get("recent_sessions");
  let sessions = data.recent_sessions || [];
  const idx = sessions.findIndex(s => s.id === id);
  if (idx !== -1) {
    sessions[idx].status = newStatus;
    if (newStatus === 'trash') sessions[idx].deletedAt = Date.now();

    // --- FIREBASE SYNC (UNDONE FIX) ---
    if (appState.storageMode === 'firebase') {
      try {
        if (newStatus === 'done') await markEntryDone(id);
        if (newStatus === 'active') await markEntryActive(id);
        if (newStatus === 'trash') await updateEntry(id, { status: "trash" }); // Sync Delete
      } catch (e) { console.error(e); }
    }

    await chrome.storage.local.set({ recent_sessions: sessions });
    renderContextList();
  }
};

window.deletePermanent = async (id, silent = false) => {
  if (!silent && !confirm("Delete permanently?")) return;
  const itemRow = document.getElementById(`ctx-item-${id}`);
  if (itemRow) itemRow.remove();

  // also try chain item (Detail View)
  const chainRow = document.getElementById(`chain-${id}`);
  if (chainRow) chainRow.remove();

  // also try trash item (Trash View)
  const trashRow = document.getElementById(`trash-item-${id}`);
  if (trashRow) trashRow.remove();

  const data = await chrome.storage.local.get("recent_sessions");
  let sessions = data.recent_sessions || [];
  sessions = sessions.filter(s => s.id !== id);
  await chrome.storage.local.set({ recent_sessions: sessions });

  if (appState.storageMode === 'firebase') {
    try {
      await deleteEntry(id);
    } catch (e) { console.error("Firebase Delete Error", e); }
  }

  if (!silent) renderContextList();
};

// --- 4.5. DETAIL VIEW (CHAIN OF THOUGHT) ---

// --- 4.5. DETAIL VIEW (CHAIN OF THOUGHT) ---

async function openDetailView(rootSession, skipAutoFetch = false) {
  appState.currentDetailId = rootSession.id;
  appState.currentView = 'detail';

  els.viewSettings.classList.add("hidden");
  els_ex.viewDetail.classList.remove("hidden");
  els_ex.viewDetail.style.display = "flex";

  // --- 1. HEADER REFACTOR (Back | Note | Status) ---
  const headerTitle = els_ex.detailTitle; // "Thread Detail" span
  headerTitle.innerHTML = ""; // Clear

  // Note/Context
  const noteSpan = document.createElement("span");
  noteSpan.style.cssText = "font-weight:700; color:#fff; font-size:12px; margin-left:8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;";
  noteSpan.textContent = rootSession.note || "(No Context)";
  headerTitle.appendChild(noteSpan);

  // Status Badge
  const statusBadge = document.createElement("span");
  const isLocal = rootSession.id && rootSession.id.startsWith('loc_');
  statusBadge.className = "badge-tag " + (isLocal ? "local" : "");
  statusBadge.style.marginLeft = "8px";
  statusBadge.textContent = isLocal ? "LOCAL" : "CLOUD";
  headerTitle.appendChild(statusBadge);

  // --- 2. ROOT ITEM DISPLAY ---
  const mainContent = rootSession.content || rootSession.title || "";
  els_ex.detailRoot.innerHTML = `
        <div class="card-label">ROOT CONTEXT</div>
        <div class="card-content" style="color:#e5e5e5; font-style:normal;">${mainContent}</div>
    `;

  const data = await chrome.storage.local.get("recent_sessions");
  const sessions = data.recent_sessions || [];

  // FIX: Filter by Custom Session ID if available, else Doc ID
  // FIX: Filter by Custom Session ID if available, else Doc ID
  // FIX: Match children using Custom Session ID if available
  const threadKey = rootSession.sessionId || rootSession.id;
  let chain = sessions.filter(s => s.sessionRef === threadKey && s.status !== 'trash');

  // FILTER (Search)
  if (appState.threadSearchQuery) {
    chain = chain.filter(s => s.content.toLowerCase().includes(appState.threadSearchQuery));
  }

  // SORT
  chain.sort((a, b) => {
    return appState.threadSortAsc ? (a.timestamp - b.timestamp) : (b.timestamp - a.timestamp);
  });

  els_ex.detailList.innerHTML = '<div class="detail-thread-container"></div>';
  const container = els_ex.detailList.querySelector('.detail-thread-container');

  // --- THREAD ACTIONS (Fetch / Auto) ---
  const isCloud = appState.storageMode === 'firebase' && !isLocal;
  if (els_ex.threadActionsBar) {
    els_ex.threadActionsBar.style.display = isCloud ? "flex" : "none";

    if (isCloud) {
      // Bind Fetch Button
      els_ex.fetchCloudBtn.onclick = () => fetchThreadResponses(rootSession.id);

      // Bind Auto-Fetch Toggle
      const autoPrefKey = "autofetch_" + threadKey;
      els_ex.autoFetchToggle.checked = localStorage.getItem(autoPrefKey) === "true";

      els_ex.autoFetchToggle.onchange = () => {
        localStorage.setItem(autoPrefKey, els_ex.autoFetchToggle.checked);
        if (els_ex.autoFetchToggle.checked) fetchThreadResponses(rootSession.id);
      };

      // Trigger Auto-Fetch if Enabled and Not Skipped
      if (els_ex.autoFetchToggle.checked && !skipAutoFetch) {
        console.log("Auto-fetching thread...");
        fetchThreadResponses(rootSession.id); // This will re-call openDetailView with skip=true (via mod below)
        return; // Stop rendering this pass, let the fetch-update-render cycle take over
      }
    }
  }

  if (chain.length === 0) {
    const emptyMsg = document.createElement("div");
    emptyMsg.style.cssText = "padding:15px; color:#666; font-style:italic;";
    emptyMsg.textContent = "No responses in this thread yet.";
    container.appendChild(emptyMsg);
  } else {
    // --- DIRECTORY TREE RENDERER ---
    renderDirectoryTree(chain, container);
  }
}

/* -------------------------------------------------------------------------- */
/*                      TIMELINE (NESTED CARD) RENDERER                       */
/* -------------------------------------------------------------------------- */
function renderDirectoryTree(items, container) {
  const root = document.createElement("div");
  root.className = "timeline-root";
  container.appendChild(root);

  // 1. Group Items
  const groups = {};
  const unsorted = [];

  items.forEach(item => {
    if (!item.group) unsorted.push(item);
    else {
      if (!groups[item.group]) groups[item.group] = {};
      const cat = item.category || "General";
      if (!groups[item.group][cat]) groups[item.group][cat] = [];
      groups[item.group][cat].push(item);
    }
  });

  // 2. Render Groups
  Object.keys(groups).sort().forEach(grpName => {
    const grpStep = document.createElement("div");
    grpStep.className = "timeline-step is-group";

    // Group Header
    const grpHeader = document.createElement("div");
    grpHeader.className = "timeline-header";
    grpHeader.innerHTML = `
       <div style="display:flex; align-items:center;">
           <div class="timeline-node"></div>
           <span class="timeline-title">${grpName}</span>
       </div>
       <button class="timeline-copy-btn" title="Copy Group">📋 Copy</button>
    `;

    // Copy
    grpHeader.querySelector("button").onclick = (e) => {
      e.stopPropagation(); copyTreeContent(groups[grpName], grpName);
    };

    grpStep.appendChild(grpHeader);

    // Group Body
    const grpBody = document.createElement("div");
    grpBody.className = "timeline-body";

    // 3. Render Categories
    const categories = groups[grpName];
    Object.keys(categories).sort().forEach(catName => {
      const catStep = document.createElement("div");
      catStep.className = "timeline-step is-category";

      const catHeader = document.createElement("div");
      catHeader.className = "timeline-header";
      catHeader.innerHTML = `
            <div style="display:flex; align-items:center;">
                <div class="timeline-node"></div>
                <span class="timeline-title">${catName}</span>
            </div>
            <button class="timeline-copy-btn" title="Copy Category">📋</button>
        `;

      catHeader.querySelector("button").onclick = (e) => {
        e.stopPropagation(); copyTreeContent({ [catName]: categories[catName] }, catName);
      };

      const catBody = document.createElement("div");
      catBody.className = "timeline-body";

      // 4. Render Items
      categories[catName].forEach(item => {
        const itemStep = document.createElement("div");
        itemStep.className = "timeline-step is-item";

        // Item Node & Content
        const itemNode = document.createElement("div");
        itemNode.className = "timeline-node";
        itemStep.appendChild(itemNode);

        // Reuse renderChainItem but wrap in timeline-card
        const itemCard = renderChainItem(item);
        itemCard.className = "timeline-card"; // Reset class to avoid conflicts

        itemStep.appendChild(itemCard);
        catBody.appendChild(itemStep);
      });

      catStep.appendChild(catHeader);
      catStep.appendChild(catBody);
      grpBody.appendChild(catStep);
    });

    grpStep.appendChild(grpBody);
    root.appendChild(grpStep);
  });

  // 5. Render Unsorted
  if (unsorted.length > 0) {
    const unStep = document.createElement("div");
    unStep.className = "timeline-step is-group";
    unStep.innerHTML = `
        <div class="timeline-header">
           <div style="display:flex; align-items:center;">
               <div class="timeline-node" style="background:#555; border-color:#777;"></div>
               <span class="timeline-title" style="color:#777;">Unsorted</span>
           </div>
        </div>
     `;
    const unBody = document.createElement("div");
    unBody.className = "timeline-body";

    unsorted.forEach(item => {
      const itemStep = document.createElement("div");
      itemStep.className = "timeline-step is-item";
      const itemNode = document.createElement("div");
      itemNode.className = "timeline-node";
      itemStep.appendChild(itemNode);

      const itemCard = renderChainItem(item);
      itemCard.classList.add("timeline-card");
      itemStep.appendChild(itemCard);
      unBody.appendChild(itemStep);
    });

    unStep.appendChild(unBody);
    root.appendChild(unStep);
  }
}

// Helper to flatten and copy
function copyTreeContent(dataObj, title) {
  let text = `[${title}]\n\n`;

  // Recursively gather text? DataObj is { Category: [Items] }
  Object.keys(dataObj).forEach(cat => {
    text += `### ${cat}\n`;
    dataObj[cat].forEach(item => {
      const t = item.content || "";
      const n = item.note ? `> Note: ${item.note}\n` : "";
      const ts = new Date(item.timestamp).toLocaleString();
      text += `${n}${t}\n[${ts}]\n\n`;
    });
    text += "---\n";
  });

  navigator.clipboard.writeText(text);
  // Toast?
  const btn = document.activeElement;
  if (btn) {
    const old = btn.textContent;
    btn.textContent = "✅";
    setTimeout(() => btn.textContent = old, 1000);
  }
}

function renderChainItem(item) {
  const el = document.createElement("div");
  el.className = "chain-item tree-item"; // Add tree-item class
  el.id = `chain-${item.id}`;

  const itemNote = item.note ? `<div style="font-size:11px; color:#aaa; margin-bottom:4px; font-weight:600; font-style:italic;">📝 ${item.note}</div>` : "";
  const displayDate = new Date(item.timestamp).toLocaleString();

  // Truncate content for display if too long? No, detail view shows full.

  el.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
            <span style="font-size:10px; color:#666;">${displayDate}</span>
            <div class="chain-actions">
               <button class="icon-btn" onclick="copyChainItem('${item.id}')" title="Copy">📋</button>
               <button class="icon-btn" onclick="toggleEdit('${item.id}')" title="Edit">✏️</button>
               <button class="icon-btn-danger" onclick="deletePermanent('${item.id}')" title="Delete">🗑️</button>
            </div>
        </div>
        ${itemNote}
        <div class="chain-content markdown-view">${renderMarkdown(item.content)}</div>
    `;

  return el;
}


// Minimal manual fetch for Thread
async function fetchThreadResponses(rootId) {
  // Import helper dynamically or valid scope? 
  // We already imported auth/db from firebase.local.js at top but didn't import 'fetchThread'.
  // We need to implement it in firebase.local or do a direct query if possible.
  // Ideally we assume `fetchOpenContexts` gets everything but user implies we might miss some?
  // User said: "manual fetch the data that contain same session ref"

  // We'll call a sync but filtered? Or just performSync(false)?
  // User requested specific button. Let's do a full Sync for now as it's safer.
  await performSync(false);
  // Then refresh view
  const data = await chrome.storage.local.get("recent_sessions");
  const sessions = data.recent_sessions || [];
  const rootItem = sessions.find(s => s.id === rootId);
  if (rootItem) openDetailView(rootItem, true); // skipAutoFetch = true
}

// Edit Mode: Switch to Main Capture View populated with item data
window.toggleEdit = async (id) => {
  const data = await chrome.storage.local.get("recent_sessions");
  const item = data.recent_sessions?.find(s => s.id === id);
  if (!item) return;

  // Populate Form
  els.content.value = item.content || "";
  els.note.value = item.note || "";

  if (item.group) forceSetOption(els.groupSelect, item.group);
  if (item.category) forceSetOption(els.catSelect, item.category);

  // Set Thread Context Selection and HIDE it
  // If item has sessionRef, select it. If not (Root), select "new".
  if (item.sessionRef) {
    forceSetOption(els.sessionSelect, item.sessionRef);
  } else {
    els.sessionSelect.value = "new";
  }
  // Hide the Session Context during Edit Mode (User Request)
  if (els.sessionSelect) els.sessionSelect.closest('.session-section').classList.add('hidden');

  // Set Edit State
  appState.editingId = id;
  els.saveBtn.textContent = "Update";

  // Hide Detail View -> Show Main View
  els_ex.viewDetail.classList.add("hidden");
  els_ex.viewDetail.style.display = "none";
  els.viewSettings.classList.remove("hidden"); // Ensure we aren't in settings either

  // Show Main Container
  document.querySelector('.app-container').classList.remove('hidden'); // Should be visible anyway

  // Logic to show "Thread Preview" or similar if needed? 
  // For now just focus content
  els.content.focus();
};

async function saveEdit(id) {
  const input = document.getElementById(`edit - txt - ${id} `);
  if (!input) return;
  const newText = input.value;

  const data = await chrome.storage.local.get("recent_sessions");
  const sessions = data.recent_sessions || [];
  const index = sessions.findIndex(s => s.id === id);
  if (index !== -1) {
    sessions[index].content = newText;
    await chrome.storage.local.set({ recent_sessions: sessions });

    // Firebase Sync
    if (appState.storageMode === 'firebase' && !id.startsWith('loc_')) {
      await updateEntry(id, { content: newText });
    }
  }

  const rootItem = sessions.find(s => s.id === appState.currentDetailId);
  if (rootItem) openDetailView(rootItem);
}



els_ex.detailBack.addEventListener("click", () => {
  els_ex.viewDetail.classList.add("hidden");
  els_ex.viewDetail.style.display = "none";
  els.viewSettings.classList.remove("hidden");
  appState.currentView = 'settings';
  renderContextList();
});

// Button Style Fix: Handled in CSS now.
// els.clearCacheBtn.style.cssText = "padding: 6px; font-size: 11px; opacity: 0.7; margin-top: 5px;";

els.clearCacheBtn.addEventListener("click", () => {
  if (confirm("Reset local data?")) {
    localStorage.removeItem("saved_groups");
    localStorage.removeItem("saved_categories");
    chrome.storage.local.remove("recent_sessions");
    renderSettings();
  }
});

// Copy All Chain Content
const copyChainBtn = document.getElementById("copy-chain-btn");
if (copyChainBtn) {
  copyChainBtn.addEventListener("click", async () => {
    if (!appState.currentDetailId) return;

    const data = await chrome.storage.local.get("recent_sessions");
    const sessions = data.recent_sessions || [];

    // 1. Get Root
    const root = sessions.find(s => s.id === appState.currentDetailId);
    let text = "";
    if (root) {
      const rootContent = root.content || root.title || "";
      if (rootContent) text += `[ROOT]: ${rootContent} \n\n`;
    }

    // 2. Get Children
    const threadKey = root ? (root.sessionId || root.id) : appState.currentDetailId;
    let chain = sessions.filter(s => s.sessionRef === threadKey && s.status !== 'trash');

    // Sort Ascending (Chronological)
    chain.sort((a, b) => (a.timestamp - b.timestamp));

    chain.forEach(item => {
      if (item.content) text += `[${new Date(item.timestamp).toLocaleString()}]\n${item.content} \n\n`;
    });

    // 3. Copy
    try {
      await navigator.clipboard.writeText(text);

      // Feedback
      const originalIcon = copyChainBtn.textContent;
      copyChainBtn.textContent = "✅";
      setTimeout(() => copyChainBtn.textContent = originalIcon, 1500);
    } catch (err) {
      console.error("Failed to copy", err);
    }
  });
}

// --- 5. SETTINGS: CONFIGURATION ---

function loadConfigUI() {
  els.configAutosync.checked = localStorage.getItem("autosync_enabled") === "true";
  const localConfig = JSON.parse(localStorage.getItem("firebase_custom_config") || "null");
  if (localConfig) {
    els.cfgApiKey.value = localConfig.apiKey || "";
    els.cfgAuthDomain.value = localConfig.authDomain || "";
    els.cfgProjectId.value = localConfig.projectId || "";
  }
}

els.configAutosync.addEventListener("change", () => {
  localStorage.setItem("autosync_enabled", els.configAutosync.checked);
});

els.saveConfigBtn.addEventListener("click", () => {
  const apiKey = els.cfgApiKey.value.trim();
  const authDomain = els.cfgAuthDomain.value.trim();
  const projectId = els.cfgProjectId.value.trim();

  if (!apiKey || !authDomain || !projectId) {
    if (confirm("Clear custom config and revert to default?")) {
      localStorage.removeItem("firebase_custom_config");
      els.configStatus.textContent = "Reverted.";
      setTimeout(() => window.location.reload(), 1000);
    }
    return;
  }

  const newConfig = {
    apiKey, authDomain, projectId,
    storageBucket: `${projectId}.appspot.com`,
    messagingSenderId: "000000000",
    appId: "1:000000000:web:0000000000"
  };

  localStorage.setItem("firebase_custom_config", JSON.stringify(newConfig));
  els.configStatus.textContent = "Saved. Reloading...";
  setTimeout(() => window.location.reload(), 1000);
});


// --- 6. CORE CAPTURE LOGIC ---

// Markdown Renderer
function renderMarkdown(text) {
  if (!text) return "";
  let t = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  t = t.replace(/```([\s\S] *?)```/g, (m, c) => ` < pre > <code>${c.trim()}</code></pre > `);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  return t.split(/(<pre>[\s\S]*?<\/pre>)/g).map(p => p.startsWith('<pre>') ? p : p.replace(/\n/g, '<br>')).join('');
}

els.previewBtn.addEventListener("click", () => {
  isPreviewMode = !isPreviewMode;
  if (isPreviewMode) {
    els.markdownView.innerHTML = renderMarkdown(els.content.value);
    els.content.classList.add("hidden"); els.markdownView.classList.remove("hidden"); els.previewBtn.classList.add("active");
  } else {
    els.markdownView.classList.add("hidden"); els.content.classList.remove("hidden"); els.previewBtn.classList.remove("active"); els.content.focus();
  }
});

// Source Toggle
function updateSourceDisplay() {
  if (!currentSourceUrl) { els.sourceDisplay.textContent = "No Source"; return; }
  try {
    const u = new URL(currentSourceUrl);
    els.sourceDisplay.textContent = els.sourceToggle.checked ? currentSourceUrl : u.hostname;
    els.sourceDisplay.title = currentSourceUrl;
  } catch (e) { els.sourceDisplay.textContent = "Invalid URL"; }
}
// els.sourceToggle.addEventListener("change", updateSourceDisplay); // REMOVED (Refactored)

// Helpers
function clearError(el) { el.classList.remove("input-error"); el.style.borderColor = ""; }
els.groupSelect.addEventListener("change", () => clearError(els.groupSelect));
els.catSelect.addEventListener("change", () => clearError(els.catSelect));
els.content.addEventListener("input", () => clearError(els.content));

function forceSetOption(selectEl, value) {
  if (!value) return false;
  let exists = false;
  for (let i = 0; i < selectEl.options.length; i++) { if (selectEl.options[i].value === value) exists = true; }
  if (!exists) {
    const opt = document.createElement("option"); opt.value = value; opt.text = value;
    selectEl.insertBefore(opt, selectEl.firstChild);
  }
  selectEl.value = value;
  return true;
}

// Loaders
async function loadDropdowns() {
  const g = JSON.parse(localStorage.getItem("saved_groups") || "[]");
  els.groupSelect.innerHTML = "";
  if (g.length === 0) els.groupSelect.appendChild(new Option("(No groups)", ""));
  else { els.groupSelect.appendChild(new Option("Select Group...", "")); g.forEach(x => els.groupSelect.appendChild(new Option(x, x))); }
  els.groupSelect.appendChild(new Option("+ Create New", "create_new"));

  const c = JSON.parse(localStorage.getItem("saved_categories") || "[]");
  els.catSelect.innerHTML = "";
  if (c.length === 0) els.catSelect.appendChild(new Option("(No categories)", ""));
  else { els.catSelect.appendChild(new Option("Select Category...", "")); c.forEach(x => els.catSelect.appendChild(new Option(x, x))); }
  els.catSelect.appendChild(new Option("+ Create New", "create_new"));
}

// --- SOURCE LOGIC (Refactored) ---
function initSourceLogic() {
  // 1. Initial Render
  renderSourceMode();
  refreshCustomSourceDropdown();

  // 2. Switch Click (Delegation)
  if (els.sourceModeSwitch) {
    els.sourceModeSwitch.addEventListener("click", (e) => {
      if (e.target.classList.contains("seg-btn")) {
        appState.sourceMode = e.target.dataset.value;
        localStorage.setItem("source_mode", appState.sourceMode);
        renderSourceMode();
      }
    });
  }

  // 3. Settings: Add Custom Source
  if (els.cfgAddCustomBtn) {
    els.cfgAddCustomBtn.addEventListener("click", () => {
      const val = els.cfgNewSourceInput.value.trim();
      if (val && !appState.customSources.includes(val)) {
        appState.customSources.push(val);
        localStorage.setItem("custom_sources_list", JSON.stringify(appState.customSources));
        els.cfgNewSourceInput.value = "";
        refreshCustomSourceDropdown();
        // Auto-select newly added?
        appState.selectedCustomSource = val;
        localStorage.setItem("selected_custom_source", val);
        renderSourceMode();
      }
    });
  }

  // 4. Settings: Delete Custom Source
  if (els.cfgDelCustomBtn) {
    els.cfgDelCustomBtn.addEventListener("click", () => {
      const val = els.cfgCustomSelect.value;
      if (val) {
        if (confirm(`Delete source "${val}"?`)) {
          appState.customSources = appState.customSources.filter(x => x !== val);
          localStorage.setItem("custom_sources_list", JSON.stringify(appState.customSources));

          // Reset selection if deleted
          if (appState.selectedCustomSource === val) {
            appState.selectedCustomSource = appState.customSources[0] || "Idea";
            localStorage.setItem("selected_custom_source", appState.selectedCustomSource);
          }
          refreshCustomSourceDropdown();
          renderSourceMode();
        }
      }
    });
  }
}

function renderSourceMode() {
  // Update Buttons
  if (els.sourceModeSwitch) {
    Array.from(els.sourceModeSwitch.children).forEach(btn => {
      if (btn.dataset.value === appState.sourceMode) btn.classList.add("active");
      else btn.classList.remove("active");
    });
  }

  // Update Preview Text
  if (els.sourcePreview) {
    let text = "";
    if (appState.sourceMode === 'custom') {
      text = `[User] ${appState.selectedCustomSource}`;
    } else if (appState.sourceMode === 'root') {
      // Need origin. currentSourceUrl might be empty if manual open.
      try {
        const urlObj = new URL(currentSourceUrl);
        text = `[Root] ${urlObj.origin}`;
      } catch (e) { text = "[Root] (No URL)"; }
    } else {
      // Full
      text = `[Link] ${currentSourceUrl}`;
    }
    els.sourcePreview.textContent = text;
    els.sourcePreview.title = text;
  }
}

function refreshCustomSourceDropdown() {
  if (!els.cfgCustomSelect) return;
  els.cfgCustomSelect.innerHTML = "";
  appState.customSources.forEach(s => {
    const opt = new Option(s, s);
    if (s === appState.selectedCustomSource) opt.selected = true;
    els.cfgCustomSelect.appendChild(opt);
  });

  // Bind Change
  els.cfgCustomSelect.onchange = () => {
    appState.selectedCustomSource = els.cfgCustomSelect.value;
    localStorage.setItem("selected_custom_source", appState.selectedCustomSource);
    renderSourceMode();
  };
}

async function loadRecentSessions() {
  const d = await chrome.storage.local.get("recent_sessions");
  cachedSessions = d.recent_sessions || [];
  els.sessionSelect.innerHTML = '<option value="new">⚡ Start New Thread</option>';

  const mode = appState.captureStorageMode;

  cachedSessions.filter(s => {
    // 1. Must be Root (Thread)
    if (!s.sessionId) return false;

    // 2. Storage Mode Check (Segregation)
    const isLocal = s.id.startsWith('loc_');
    if (mode === 'local' && !isLocal) return false;
    if (mode === 'firebase' && isLocal) return false;

    // 3. Status Check (Active Only)
    // Filter out Done and Trash threads
    if (s.status === 'done' || s.status === 'trash') return false;

    return true;
  }).forEach(s => {
    // Note takes priority for the label
    const mainContent = s.content || s.title || "";
    const t = s.note ? s.note : mainContent;

    const opt = document.createElement("option"); opt.value = s.id;
    // Modernized Look: "Note" or "Content (truncated)"
    opt.textContent = t ? (t.length > 40 ? t.substring(0, 40) + "..." : t) : "Untitled Thread";
    els.sessionSelect.appendChild(opt);
  });

  // Force UI Reset (Hide stale quotes)
  els.sessionSelect.value = "new";
  els.sessionSelect.dispatchEvent(new Event('change'));
}

// Session Change Handler (Auto-Fill)
els.sessionSelect.addEventListener("change", () => {
  const id = els.sessionSelect.value;
  els.status.textContent = "";
  if (id === "new") {
    els.threadPreview.classList.add("hidden"); els.groupSelect.style.borderColor = ""; els.catSelect.style.borderColor = ""; return;
  }
  const s = cachedSessions.find(x => x.id === id);
  if (!s) return;

  const mainContent = s.content || s.title || "";

  if (s.note) { els.previewNote.textContent = s.note; els.previewContent.textContent = `"${mainContent}"`; }
  else { els.previewNote.textContent = mainContent; els.previewContent.textContent = ""; }

  els.threadPreview.classList.remove("hidden");
  if (s.group) { forceSetOption(els.groupSelect, s.group); els.groupSelect.style.borderColor = "#3b82f6"; clearError(els.groupSelect); }
  if (s.category) { forceSetOption(els.catSelect, s.category); els.catSelect.style.borderColor = "#3b82f6"; clearError(els.catSelect); }
});

function handleCreateNew(s, i) {
  if (!s || !i) return;
  s.addEventListener("change", () => {
    if (s.value === "create_new") { i.classList.remove("hidden"); i.focus(); } else { i.classList.add("hidden"); } clearError(s);
  });
}
handleCreateNew(els.groupSelect, els.groupNew); handleCreateNew(els.catSelect, els.catNew);

// --- 7. SAVE HANDLER (The "Real ID" Fix) ---
// --- 7. SAVE HANDLER (Create & Update) ---
els.saveBtn.onclick = async () => {
  els.saveBtn.disabled = true; els.status.textContent = "";
  try {
    const content = els.content.value.trim();
    if (!content) { els.content.classList.add("input-error"); throw new Error("Content is required"); }

    let finalGroup = els.groupSelect.value; if (finalGroup === "create_new") finalGroup = els.groupNew.value.trim();
    let finalCat = els.catSelect.value; if (finalCat === "create_new") finalCat = els.catNew.value.trim();

    // SANITIZATION: Note required for New Threads (Create Mode only)
    const noteVal = els.note.value.trim();
    let selection = els.sessionSelect.value;

    // If Editing, we might be editing a Root or Reply. context is already set.
    const isEditing = !!appState.editingId;

    if (!isEditing && selection === "new" && !noteVal) {
      els.note.classList.add("input-error");
      throw new Error("Note (Context) is required for new threads");
    }

    if (!finalGroup || !finalCat) throw new Error("Missing required fields");

    els.saveBtn.textContent = isEditing ? "Updating..." : "Saving...";

    // --- UPDATE LOGIC ---
    if (isEditing) {
      const id = appState.editingId;
      const updates = {
        content: content,
        note: noteVal || null,
        group: finalGroup,
        category: finalCat,
        timestamp: Date.now() // Optional: Update timestamp on edit? User didn't specify. Let's keep original timestamp usually, or update `updatedAt`. Let's just update content for now.
      };

      // 1. Update Local
      const data = await chrome.storage.local.get("recent_sessions");
      const sessions = data.recent_sessions || [];
      const idx = sessions.findIndex(s => s.id === id);
      if (idx !== -1) {
        sessions[idx] = { ...sessions[idx], ...updates };
        await chrome.storage.local.set({ recent_sessions: sessions });
      }

      // 2. Update Firebase
      if (appState.storageMode === 'firebase' && !id.startsWith('loc_')) {
        await updateEntry(id, updates);
      }

      // 3. Reset UI & Redirect
      appState.editingId = null;
      els.saveBtn.textContent = "Capture";
      els.status.textContent = "Updated.";
      els.dot.style.backgroundColor = "#22c55e";

      // RESTORE Session Context Visibility
      if (els.sessionSelect) els.sessionSelect.closest('.session-section').classList.remove('hidden');

      // REDIRECT LOGIC: "Fallback to the chain of thought page"
      // If we edited a Reply, go to Parent. If Thread, go to Self.
      // We need to find the TARGET ID.
      // Note: `sessions[idx]` (updated item) has the latest data.
      const updatedItem = sessions[idx];
      const targetId = updatedItem.sessionRef || updatedItem.id;

      // Find the Root to open
      const rootToOpen = sessions.find(s => s.id === targetId);

      if (rootToOpen) {
        setTimeout(() => {
          openDetailView(rootToOpen);
        }, 500);
        return;
      }

      setTimeout(() => window.close(), 800);
      return;
    }

    // --- CREATE LOGIC (Existing) ---

    // 1. Prepare Data
    // selection already declared above for sanitization check
    let finalSessionId = null, finalSessionRef = null;

    // GENERATE SESSION ID
    let tempId;
    if (appState.storageMode === 'local') {
      const cleanNote = (noteVal || 'thread').replace(/[^a-zA-Z0-9]/g, '').substring(0, 15);
      tempId = `${cleanNote}_${Date.now()}`;
    } else {
      const localConfig = JSON.parse(localStorage.getItem("firebase_custom_config") || "{}");
      const pId = (localConfig.projectId || "default").replace(/\s+/g, '');
      tempId = `${Date.now()}${pId}`;
    }

    if (selection === "new") {
      finalSessionId = tempId;
      finalSessionRef = null;
    } else {
      finalSessionRef = selection;

      // FIX: Session Linking Logic (User Engine)
      const parentSession = cachedSessions.find(s => s.id === selection);

      // Determine the Thread ID (Custom Session ID)
      // If parent is Root, it has sessionId.
      // If parent is Reply, it has sessionRef (which is the Thread ID).
      // Fallback to parent.id if legacy.
      const threadId = parentSession?.sessionId || parentSession?.sessionRef || parentSession?.id;

      finalSessionId = null; // Explicitly null for replies
      finalSessionRef = threadId; // "Push that value to ref id"
    }

    let sourceObj = null;

    // NEW SOURCE LOGIC
    if (appState.sourceMode === 'custom') {
      // User Defined: No URL, use Label
      sourceObj = { mode: "custom", label: appState.selectedCustomSource, full: "", root: "" };
    } else if (appState.sourceMode === 'root') {
      try {
        const rootDomain = new URL(currentSourceUrl).origin;
        sourceObj = { mode: "root", full: rootDomain, root: rootDomain };
      } catch (e) {
        sourceObj = { mode: "root", full: "", root: "" };
      }
    } else {
      // Full Link
      try {
        const rootDomain = new URL(currentSourceUrl).origin;
        sourceObj = { mode: "full", full: currentSourceUrl, root: rootDomain };
      } catch (e) {
        sourceObj = { mode: "full", full: currentSourceUrl || "", root: "" };
      }
    }

    const payload = {
      content,
      note: els.note.value.trim() || null,
      entryType: openingMode === "context_menu_modal" ? "User Highlight" : "User Idea",
      origin: openingMode, group: finalGroup, category: finalCat, source: sourceObj,
      sessionId: finalSessionId, sessionRef: finalSessionRef, schemaVersion: 3
    };

    // 2. Storage Handling (Use CAPTURE Mode)
    let realCloudId;
    if (appState.captureStorageMode === 'firebase') {
      try {
        // A. Offline Check
        if (!navigator.onLine) throw new Error("No Internet Connection (Offline).");

        // B. Auth Check
        if (!auth.currentUser) await ensureAuth().catch(() => signInWithPopup(auth, provider));

        // C. Save with Timeout (Start Race)
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Request Timed Out (Slow Network).")), 5000)
        );

        const docRef = await Promise.race([
          saveEntry(payload),
          timeoutPromise
        ]);

        realCloudId = docRef.id;
      } catch (e) {
        console.error("Cloud Error", e);
        showError("❌ Cloud Save Failed:\n" + (e.message || "Unknown error"));

        els.saveBtn.disabled = false; cls_status();
        els.saveBtn.textContent = "Capture";
        return; // Stop execution
      }
    } else {
      realCloudId = `loc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // 3. Update Local Cache
    const savedGroups = JSON.parse(localStorage.getItem("saved_groups") || "[]");
    if (!savedGroups.includes(finalGroup)) { savedGroups.push(finalGroup); localStorage.setItem("saved_groups", JSON.stringify(savedGroups)); }
    const savedCats = JSON.parse(localStorage.getItem("saved_categories") || "[]");
    if (!savedCats.includes(finalCat)) { savedCats.push(finalCat); localStorage.setItem("saved_categories", JSON.stringify(savedCats)); }

    // CONDITIONAL CACHING: Always Cache Locally (Auto-Dump)
    const shouldCacheLocally = true;

    if (shouldCacheLocally) {
      const data = await chrome.storage.local.get("recent_sessions");
      let sessions = data.recent_sessions || [];

      const newItem = {
        id: realCloudId,
        content: content,
        note: els.note.value.trim() || null,
        group: finalGroup,
        category: finalCat,
        timestamp: Date.now(),
        status: 'active',
        sessionRef: finalSessionRef || null,
        sessionId: finalSessionId
      };

      sessions.unshift(newItem);

      if (sessions.length > 50) sessions = sessions.slice(0, 50);
      await chrome.storage.local.set({ recent_sessions: sessions });
    }

    els.status.textContent = "Captured."; els.dot.style.backgroundColor = "#22c55e";
    setTimeout(() => window.close(), 800);
  } catch (err) {
    console.error(err); els.status.textContent = err.message; els.status.style.color = "#ef4444"; els.saveBtn.disabled = false; els.saveBtn.textContent = appState.editingId ? "Update" : "Capture";
  }
};

// --- 8. MANAGER MODAL LOGIC ---
// --- 8. MANAGER MODAL LOGIC ---
function initManager() {
  const modal = document.getElementById("manager-modal");
  const list = document.getElementById("manager-list");
  const title = document.getElementById("manager-title");
  if (!modal) return;

  document.getElementById("btn-close-manager").onclick = () => {
    modal.classList.add("hidden");
  };

  // Event Delegation for Manager List
  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('.manager-del-btn');
    if (!btn) return;

    const type = btn.dataset.type;
    const id = btn.dataset.id;

    await deleteManagerItem(type, id);
  });

  function openManager(type) {
    modal.classList.remove("hidden");
    list.innerHTML = "";
    let items = [];

    if (type === 'group') {
      title.textContent = "Manage Groups";
      items = JSON.parse(localStorage.getItem("saved_groups") || "[]").map(x => ({ id: x, label: x }));
    } else if (type === 'cat') {
      title.textContent = "Manage Categories";
      items = JSON.parse(localStorage.getItem("saved_categories") || "[]").map(x => ({ id: x, label: x }));
    } else if (type === 'thread') {
      title.textContent = "Manage Threads";
      // Only show Root Threads (Active/Done), Hide Trash
      items = cachedSessions.filter(s => s.sessionId && s.status !== 'trash').map(s => ({
        id: s.id,
        label: s.note || s.content.substring(0, 30) || "Untitled"
      }));
    }

    if (items.length === 0) {
      list.innerHTML = '<div style="padding:10px; color:#666; font-style:italic;">No items found.</div>';
      return;
    }

    items.forEach(item => {
      const el = document.createElement("div");
      el.className = "manager-item";
      el.innerHTML = `
        <span class="manager-label" title="${item.label}">${item.label}</span>
        <button class="manager-del-btn" title="Delete" data-type="${type}" data-id="${item.id}">🗑️</button>
      `;
      list.appendChild(el);
    });
  }

  async function deleteManagerItem(type, id) {
    if (!confirm("Delete this item?")) return;

    if (type === 'group') {
      const groups = JSON.parse(localStorage.getItem("saved_groups") || "[]").filter(x => x !== id);
      localStorage.setItem("saved_groups", JSON.stringify(groups));
      await loadDropdowns();
    } else if (type === 'cat') {
      const cats = JSON.parse(localStorage.getItem("saved_categories") || "[]").filter(x => x !== id);
      localStorage.setItem("saved_categories", JSON.stringify(cats));
      await loadDropdowns();
    } else if (type === 'thread') {
      // Soft Delete Thread (Dump to Trash first, remove from this list)
      await updateStatus(id, 'trash');
      await loadRecentSessions();
    }

    openManager(type); // Refresh List
  }

  // Bind Buttons
  document.getElementById("btn-manage-groups").onclick = () => openManager('group');
  document.getElementById("btn-manage-cats").onclick = () => openManager('cat');
  document.getElementById("btn-manage-threads").onclick = () => openManager('thread');
}

initManager();
init();