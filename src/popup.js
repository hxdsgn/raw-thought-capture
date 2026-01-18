import { auth, provider, signInWithPopup, saveEntry, ensureAuth, fetchOpenContexts, markEntryDone } from "./firebase.local.js";

// --- DOM ELEMENTS ---
const els = {
  // Views
  viewCapture: document.getElementById("view-capture"),
  viewSettings: document.getElementById("view-settings"),
  settingsBtn: document.getElementById("settings-btn"),
  backBtn: document.getElementById("back-btn"),
  
  // Tabs
  tabContext: document.getElementById("tab-context"),
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
  sourceDisplay: document.getElementById("source-display"),
  sourceToggle: document.getElementById("source-toggle"),
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

let currentSourceUrl = "";
let openingMode = "popup_manual";
let cachedSessions = [];
let isPreviewMode = false;

// --- 1. INITIALIZATION ---

async function init() {
  try {
    loadConfigUI(); 
    await loadDropdowns(); 
    await loadRecentSessions();
    
    // Auto-Sync Check
    const autoSync = localStorage.getItem("autosync_enabled") === "true";
    if (autoSync) {
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
    updateSourceDisplay();
  } catch (err) { console.error("Init Error:", err); }
}

// --- 2. SYNC LOGIC ---

async function performSync(silent = false) {
  if (!silent) els.forceSyncBtn.textContent = "Syncing...";
  try {
    const freshData = await fetchOpenContexts();
    
    // Sort: Newest first
    freshData.sort((a, b) => b.timestamp - a.timestamp);
    
    await chrome.storage.local.set({ recent_sessions: freshData });
    
    // Update Dropdowns based on synced data
    const groups = new Set(JSON.parse(localStorage.getItem("saved_groups") || "[]"));
    const cats = new Set(JSON.parse(localStorage.getItem("saved_categories") || "[]"));
    
    freshData.forEach(d => {
      if(d.group) groups.add(d.group);
      if(d.category) cats.add(d.category);
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
});

els.backBtn.addEventListener("click", () => {
  els.viewSettings.classList.add("hidden");
  els.viewCapture.classList.remove("hidden");
  loadDropdowns();
  loadRecentSessions();
});

function switchTab(tabId) {
  if (tabId === "context") {
    els.tabContext.classList.add("active");
    els.tabConfig.classList.remove("active");
    els.panelContext.classList.remove("hidden");
    els.panelConfig.classList.add("hidden");
  } else {
    els.tabConfig.classList.add("active");
    els.tabContext.classList.remove("active");
    els.panelConfig.classList.remove("hidden");
    els.panelContext.classList.add("hidden");
  }
}
els.tabContext.addEventListener("click", () => switchTab("context"));
els.tabConfig.addEventListener("click", () => switchTab("config"));

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
  if (items.includes(currentVal)) selectEl.value = currentVal; else selectEl.value = "all";
  updateDeleteBtnState();
}

function updateDeleteBtnState() {
  els.btnDelGroup.disabled = els.filterGroup.value === "all";
  els.btnDelCat.disabled = els.filterCat.value === "all";
}

els.filterGroup.addEventListener("change", () => { updateDeleteBtnState(); renderContextList(); });
els.filterCat.addEventListener("change", () => { updateDeleteBtnState(); renderContextList(); });

// Delete Group/Category Buttons
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

// Render Context Items (Accordion)
async function renderContextList() {
  const data = await chrome.storage.local.get("recent_sessions");
  const sessions = data.recent_sessions || [];
  const selectedGroup = els.filterGroup.value;
  const selectedCat = els.filterCat.value;

  const filtered = sessions.filter(s => {
    return (selectedGroup === "all" || s.group === selectedGroup) && 
           (selectedCat === "all" || s.category === selectedCat);
  });

  els.contextList.innerHTML = "";
  if (filtered.length === 0) {
    els.contextList.innerHTML = `<div style="text-align:center; color:#666; font-size:12px; padding:20px;">No contexts found.</div>`;
    return;
  }

  filtered.forEach(sess => {
    const item = document.createElement("div");
    item.className = "ctx-item";
    const header = document.createElement("div"); header.className = "ctx-header";
    
    const info = document.createElement("div"); info.className = "ctx-info";
    const titleText = sess.note || sess.title || "(Untitled)";
    info.innerHTML = `<div class="ctx-title">${titleText}</div><div class="ctx-meta">${new Date(sess.timestamp).toLocaleDateString()} • ${sess.group || '-'}</div>`;

    const actions = document.createElement("div"); actions.className = "ctx-actions";
    
    // --- DONE BUTTON (The Fix) ---
    const doneBtn = document.createElement("button");
    doneBtn.className = "ctx-btn ctx-btn-done";
    doneBtn.textContent = "Done";
    doneBtn.onclick = async (e) => {
      e.stopPropagation();
      doneBtn.textContent = "...";
      
      // SAFETY CHECK: Is this a "Ghost" item (Local ID only)?
      if (sess.id.startsWith("sess_")) {
        console.warn("Cleaning up unsynced local item.");
        await removeSessionLocal(sess.id); // Just delete locally
      } else {
        try {
          await markEntryDone(sess.id); // Sync to Cloud
          await removeSessionLocal(sess.id); // Remove Local
        } catch (err) {
          alert("Sync error: " + err.message);
          doneBtn.textContent = "Err";
        }
      }
    };

    // DELETE BUTTON (Local Only)
    const delBtn = document.createElement("button");
    delBtn.className = "ctx-btn ctx-btn-del";
    delBtn.textContent = "Del";
    delBtn.onclick = (e) => {
      e.stopPropagation();
      removeSessionLocal(sess.id);
    };

    actions.appendChild(doneBtn); actions.appendChild(delBtn);
    header.appendChild(info); header.appendChild(actions);

    const body = document.createElement("div"); body.className = "ctx-body";
    body.innerHTML = `<strong>Content:</strong><br>${sess.title}<br><br><em style="color:#888">ID: ${sess.id}</em>`;

    header.onclick = () => { item.classList.toggle("open"); };
    item.appendChild(header); item.appendChild(body);
    els.contextList.appendChild(item);
  });
}

async function removeSessionLocal(id) {
  const data = await chrome.storage.local.get("recent_sessions");
  let sessions = data.recent_sessions || [];
  sessions = sessions.filter(s => s.id !== id);
  await chrome.storage.local.set({ recent_sessions: sessions });
  renderContextList();
}

els.clearCacheBtn.addEventListener("click", () => {
  if (confirm("Reset local data?")) {
    localStorage.removeItem("saved_groups");
    localStorage.removeItem("saved_categories");
    chrome.storage.local.remove("recent_sessions");
    renderSettings();
  }
});

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
    if(confirm("Clear custom config and revert to default?")) {
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
  t = t.replace(/```([\s\S]*?)```/g, (m, c) => `<pre><code>${c.trim()}</code></pre>`);
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
els.sourceToggle.addEventListener("change", updateSourceDisplay);

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
  if (g.length===0) els.groupSelect.appendChild(new Option("(No groups)",""));
  else { els.groupSelect.appendChild(new Option("Select Group...","")); g.forEach(x => els.groupSelect.appendChild(new Option(x,x))); }
  els.groupSelect.appendChild(new Option("+ Create New","create_new"));

  const c = JSON.parse(localStorage.getItem("saved_categories") || "[]");
  els.catSelect.innerHTML = "";
  if (c.length===0) els.catSelect.appendChild(new Option("(No categories)",""));
  else { els.catSelect.appendChild(new Option("Select Category...","")); c.forEach(x => els.catSelect.appendChild(new Option(x,x))); }
  els.catSelect.appendChild(new Option("+ Create New","create_new"));
}

async function loadRecentSessions() {
  const d = await chrome.storage.local.get("recent_sessions");
  cachedSessions = d.recent_sessions || [];
  els.sessionSelect.innerHTML = '<option value="new">⚡ Start New Thread</option>';
  cachedSessions.forEach(s => {
    const t = s.note ? s.note : s.title;
    const opt = document.createElement("option"); opt.value = s.id;
    opt.textContent = `⤷ ${t.substring(0,35)}...`;
    els.sessionSelect.appendChild(opt);
  });
}

// Session Change Handler (Auto-Fill)
els.sessionSelect.addEventListener("change", () => {
  const id = els.sessionSelect.value;
  els.status.textContent = "";
  if (id === "new") {
    els.threadPreview.classList.add("hidden"); els.groupSelect.style.borderColor=""; els.catSelect.style.borderColor=""; return;
  }
  const s = cachedSessions.find(x => x.id === id);
  if (!s) return;
  if (s.note) { els.previewNote.textContent = s.note; els.previewContent.textContent = `"${s.title}"`; }
  else { els.previewNote.textContent = s.title; els.previewContent.textContent = ""; }
  els.threadPreview.classList.remove("hidden");
  if (s.group) { forceSetOption(els.groupSelect, s.group); els.groupSelect.style.borderColor="#3b82f6"; clearError(els.groupSelect); }
  if (s.category) { forceSetOption(els.catSelect, s.category); els.catSelect.style.borderColor="#3b82f6"; clearError(els.catSelect); }
});

function handleCreateNew(s, i) {
  s.addEventListener("change", () => {
    if (s.value === "create_new") { i.classList.remove("hidden"); i.focus(); } else { i.classList.add("hidden"); } clearError(s);
  });
}
handleCreateNew(els.groupSelect, els.groupNew); handleCreateNew(els.catSelect, els.catNew);

// --- 7. SAVE HANDLER (The "Real ID" Fix) ---
els.saveBtn.onclick = async () => {
  els.saveBtn.disabled = true; els.status.textContent = "";
  try {
    const content = els.content.value.trim();
    if (!content) { els.content.classList.add("input-error"); throw new Error("Content is required"); }
    
    let finalGroup = els.groupSelect.value; if (finalGroup === "create_new") finalGroup = els.groupNew.value.trim();
    let finalCat = els.catSelect.value; if (finalCat === "create_new") finalCat = els.catNew.value.trim();
    if (!finalGroup || !finalCat) throw new Error("Missing required fields");

    els.saveBtn.textContent = "Saving...";
    if (!auth.currentUser) await ensureAuth().catch(() => signInWithPopup(auth, provider));

    let selection = els.sessionSelect.value;
    let finalSessionId = null, finalSessionRef = null, isNewSession = false;

    // Use a temp ID just in case saveEntry fails, but we prefer the Real ID
    let tempId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    if (selection === "new") { isNewSession = true; finalSessionId = tempId; finalSessionRef = null; }
    else { isNewSession = false; finalSessionId = null; finalSessionRef = selection; }

    let sourceObj = null;
    if (currentSourceUrl) {
      const rootDomain = new URL(currentSourceUrl).origin;
      sourceObj = els.sourceToggle.checked 
        ? { full: currentSourceUrl, root: rootDomain, mode: "full" } 
        : { full: rootDomain, root: rootDomain, mode: "root" };
    }
    
    const payload = {
      content, note: els.note.value.trim() || null, 
      entryType: openingMode === "context_menu_modal" ? "User Highlight" : "User Idea",
      origin: openingMode, group: finalGroup, category: finalCat, source: sourceObj, 
      sessionId: finalSessionId, sessionRef: finalSessionRef, schemaVersion: 3
    };

    // --- CRITICAL: Get Real Cloud ID ---
    const docRef = await saveEntry(payload);
    const realCloudId = docRef.id; 

    // Update Local Dropdowns
    const savedGroups = JSON.parse(localStorage.getItem("saved_groups") || "[]");
    if (!savedGroups.includes(finalGroup)) { savedGroups.push(finalGroup); localStorage.setItem("saved_groups", JSON.stringify(savedGroups)); }
    const savedCats = JSON.parse(localStorage.getItem("saved_categories") || "[]");
    if (!savedCats.includes(finalCat)) { savedCats.push(finalCat); localStorage.setItem("saved_categories", JSON.stringify(savedCats)); }

    // Update Recent Sessions
    const data = await chrome.storage.local.get("recent_sessions");
    let sessions = data.recent_sessions || [];

    if (isNewSession) {
      // PUSH THE REAL CLOUD ID to local cache, not the temp ID
      sessions.unshift({ 
        id: realCloudId, 
        title: content, 
        note: els.note.value.trim() || null, 
        group: finalGroup, 
        category: finalCat, 
        timestamp: Date.now() 
      });
    } else if (finalSessionRef) {
      const index = sessions.findIndex(s => s.id === finalSessionRef);
      if (index !== -1) { sessions[index].group = finalGroup; sessions[index].category = finalCat; }
    }
    
    // Limit cache size
    if (sessions.length > 20) sessions = sessions.slice(0, 20);
    await chrome.storage.local.set({ recent_sessions: sessions });

    els.status.textContent = "Captured."; els.dot.style.backgroundColor = "#22c55e";
    setTimeout(() => window.close(), 800);
  } catch (err) {
    console.error(err); els.status.textContent = err.message; els.status.style.color = "#ef4444"; els.saveBtn.disabled = false; els.saveBtn.textContent = "Capture";
  }
};

init();