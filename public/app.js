var state = {
  info: null,
  paired: false,
  socket: null,
  selectedFiles: [],
  selectedTargetId: "host",
  superDragArmed: false,
  gestureActive: false,
  deviceId: getOrCreateDeviceId(),
  deviceName: localStorage.getItem("nearshare.deviceName") || defaultDeviceName()
};

var e = {};

document.addEventListener("DOMContentLoaded", boot);

async function boot() {
  cacheEls();
  bindEvents();
  e.deviceName.value = state.deviceName;
  await refreshInfo();
  await refreshHistory();
  var urlCode = new URLSearchParams(location.search).get("code");
  var lastCode = localStorage.getItem("nearshare.lastPairCode");
  if (urlCode) {
    e.pairInput.value = digits(urlCode).slice(0, 6);
  } else if (lastCode) {
    e.pairInput.value = digits(lastCode).slice(0, 6);
  } else if (state.info && state.info.pairingCode) {
    e.pairInput.value = state.info.pairingCode;
  }
  setStatus("Server online", false);
}

function cacheEls() {
  var ids = [
    "status-dot", "status-text", "pair-code", "refresh-info",
    "pair-form", "pair-button", "pair-input", "device-name",
    "quick-files", "quick-folder", "arm-drag", "dropzone",
    "select-files", "select-folder", "clear-files", "file-picker",
    "folder-picker", "selected-list", "send-button", "device-list",
    "transfer-note", "target-host", "forget-target", "history-list",
    "refresh-history", "progress-wrap", "progress-bar",
    "gesture-pad", "gesture-cursor", "cancel-gesture", "toast-region"
  ];
  ids.forEach(function(id) {
    e[camelize(id)] = document.getElementById(id);
  });
}

function bindEvents() {
  e.refreshInfo.onclick = refreshInfo;
  e.refreshHistory.onclick = refreshHistory;

  e.pairForm.onsubmit = function(ev) {
    ev.preventDefault();
    pairDevice();
  };

  e.deviceName.oninput = function() {
    state.deviceName = e.deviceName.value.trim() || defaultDeviceName();
    localStorage.setItem("nearshare.deviceName", state.deviceName);
  };

  e.quickFiles.onclick = function() { e.filePicker.click(); };
  e.selectFiles.onclick = function() { e.filePicker.click(); };
  e.quickFolder.onclick = function() { e.folderPicker.click(); };
  e.selectFolder.onclick = function() { e.folderPicker.click(); };

  e.filePicker.onchange = function() {
    addFiles(Array.from(e.filePicker.files).map(function(f) {
      return { file: f, relativePath: f.name };
    }));
    e.filePicker.value = "";
  };

  e.folderPicker.onchange = function() {
    addFiles(Array.from(e.folderPicker.files).map(function(f) {
      return { file: f, relativePath: f.webkitRelativePath || f.name };
    }));
    e.folderPicker.value = "";
  };

  e.clearFiles.onclick = function() {
    state.selectedFiles = [];
    renderSelected();
    toast("Selection cleared.", "warn");
  };

  e.sendButton.onclick = function() { sendSelected(false); };

  e.targetHost.onclick = function() {
    state.selectedTargetId = "host";
    renderDevices();
    toast("Target set to host inbox.", "good");
  };

  e.forgetTarget.onclick = function() {
    state.selectedTargetId = "host";
    renderDevices();
    toast("Target cleared.", "warn");
  };

  e.armDrag.onclick = function() { toggleSuperDrag(); };

  e.dropzone.onclick = function(ev) {
    if (!ev.target.closest("button")) {
      e.filePicker.click();
    }
  };

  e.dropzone.onkeydown = function(ev) {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      e.filePicker.click();
    }
  };

  e.dropzone.ondragenter = markDrag;
  e.dropzone.ondragover = markDrag;
  e.dropzone.ondragleave = function(ev) {
    ev.preventDefault();
    if (!e.dropzone.contains(ev.relatedTarget)) {
      e.dropzone.classList.remove("dragging");
    }
  };

  e.dropzone.ondrop = async function(ev) {
    ev.preventDefault();
    e.dropzone.classList.remove("dragging");
    var files = await droppedFiles(ev.dataTransfer);
    addFiles(files);
    if (state.superDragArmed && files.length) {
      toggleSuperDrag(false);
      sendSocket({ type: "super-drag-drop", targetId: getTarget(), uploadHint: { itemCount: files.length } });
      toast("Super drag drop captured.", "good");
    }
  };

  e.cancelGesture.onclick = cancelGesture;

  e.gesturePad.onpointerdown = function(ev) {
    e.gesturePad.setPointerCapture(ev.pointerId);
    state.gestureActive = true;
    e.gesturePad.classList.add("active");
    moveCursor(ev);
    sendSocket({ type: "gesture", gesture: "pick", payload: pointerPos(ev) });
  };

  e.gesturePad.onpointermove = function(ev) {
    if (!state.gestureActive) return;
    moveCursor(ev);
    var p = pointerPos(ev);
    sendSocket({ type: "super-drag-hover", targetId: getTarget(), x: p.x, y: p.y });
  };

  e.gesturePad.onpointerup = function(ev) {
    if (!state.gestureActive) return;
    moveCursor(ev);
    sendSocket({ type: "gesture", gesture: "drop", payload: pointerPos(ev) });
    state.gestureActive = false;
    e.gesturePad.classList.remove("active");
    if (state.selectedFiles.length) {
      sendSelected(true);
    }
  };

  e.gesturePad.onpointercancel = cancelGesture;
}

async function refreshInfo() {
  try {
    var r = await fetch("/api/info", { cache: "no-store" });
    if (!r.ok) throw new Error("Unable to load app info.");
    state.info = await r.json();
    e.pairCode.textContent = state.info.pairingCode || "------";
    renderDevices(state.info.pairedDevices || []);
    setStatus(state.paired ? "Paired and ready" : "Server online", state.paired);
  } catch (err) {
    setStatus("Server unavailable", false);
    toast(err.message, "bad");
  }
}

async function pairDevice() {
  var code = digits(e.pairInput.value).slice(0, 6);
  var name = e.deviceName.value.trim() || defaultDeviceName();
  if (code.length !== 6) {
    toast("Enter the 6-digit pairing code.", "warn");
    return;
  }
  e.pairButton.disabled = true;
  setStatus("Pairing...", false);
  try {
    var r = await fetch("/api/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code, name: name, deviceId: state.deviceId })
    });
    var out = await r.json();
    if (!r.ok || !out.ok) throw new Error(out.error || "Pairing failed.");
    state.paired = true;
    state.deviceName = name;
    localStorage.setItem("nearshare.deviceName", name);
    localStorage.setItem("nearshare.lastPairCode", code);
    connectSocket(code);
    setStatus("Paired and ready", true);
    toast("This device is paired.", "good");
    await refreshInfo();
  } catch (err) {
    setStatus("Pairing failed", false);
    toast(err.message, "bad");
  } finally {
    e.pairButton.disabled = false;
  }
}

function connectSocket(code) {
  if (state.socket) state.socket.close();
  var scheme = location.protocol === "https:" ? "wss" : "ws";
  var url = new URL(scheme + "://" + location.host + "/events");
  url.searchParams.set("code", code);
  url.searchParams.set("deviceId", state.deviceId);
  url.searchParams.set("name", state.deviceName);
  state.socket = new WebSocket(url);
  state.socket.onopen = function() { setStatus("Live connection active", true); };
  state.socket.onmessage = function(ev) {
    var m = parseJson(ev.data);
    if (m) handleMessage(m);
  };
  state.socket.onclose = function() { setStatus("Live connection closed", false); };
  state.socket.onerror = function() { setStatus("Live connection error", false); };
}

function handleMessage(m) {
  if (m.type === "hello" || m.type === "devices" || m.type === "device-online" || m.type === "device-offline") {
    renderDevices(m.devices || []);
  }
  if (m.type === "device-paired") {
    refreshInfo();
    toast((m.device && m.device.name ? m.device.name : "A device") + " joined.", "good");
  }
  if (m.type === "files-received") {
    toast("Received " + m.upload.fileCount + " item(s).", "good");
    refreshHistory();
  }
  if (m.type === "transfer-offer") {
    toast((m.sender && m.sender.name ? m.sender.name : "A device") + " is preparing " + m.fileCount + " item(s).", "warn");
  }
  if (m.type === "gesture") {
    toast((m.sender && m.sender.name ? m.sender.name : "A device") + " gesture: " + m.gesture, "warn");
  }
  if (m.type === "super-drag-drop") {
    toast((m.sender && m.sender.name ? m.sender.name : "A device") + " dropped files your way.", "good");
  }
  if (m.type === "pairing-denied" || m.type === "error") {
    toast(m.error || "Connection error.", "bad");
  }
}

function renderDevices(list) {
  list = list || (state.info ? state.info.pairedDevices : []) || [];
  e.deviceList.innerHTML = "";
  e.deviceList.appendChild(deviceCard({
    id: "host",
    name: state.info && state.info.deviceName ? state.info.deviceName + " inbox" : "Host inbox",
    online: true,
    lastSeenAt: "local"
  }));
  var visible = list.filter(function(d) { return d.id !== state.deviceId; });
  if (!visible.length) {
    makeEmpty(e.deviceList, "No other paired devices yet.");
    return;
  }
  visible.forEach(function(d) { e.deviceList.appendChild(deviceCard(d)); });
}

function deviceCard(d) {
  var b = document.createElement("button");
  b.className = "device" + (state.selectedTargetId === d.id ? " selected" : "");
  b.type = "button";

  var main = document.createElement("div");
  main.className = "device-main";

  var nameEl = document.createElement("span");
  nameEl.className = "name";
  nameEl.textContent = d.name || "Nearby device";

  var badge = document.createElement("span");
  badge.className = "badge" + (d.online ? "" : " offline");
  badge.textContent = d.online ? "online" : "offline";

  var meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = d.id === "host"
    ? "Save directly into the host shared inbox."
    : "Last seen: " + formatTime(d.lastSeenAt);

  main.appendChild(nameEl);
  main.appendChild(badge);
  b.appendChild(main);
  b.appendChild(meta);

  b.onclick = function() {
    state.selectedTargetId = d.id;
    renderDevices();
    toast("Target set to " + (d.name || "device") + ".", "good");
  };
  return b;
}

function addFiles(entries) {
  entries = entries.filter(function(x) { return x && x.file; });
  var map = new Map();
  state.selectedFiles.forEach(function(x) { map.set(x.relativePath + ":" + x.file.size, x); });
  entries.forEach(function(x) {
    var p = cleanPath(x.relativePath || x.file.name);
    map.set(p + ":" + x.file.size, { file: x.file, relativePath: p });
  });
  state.selectedFiles = Array.from(map.values());
  renderSelected();
  if (entries.length) {
    toast("Added " + entries.length + " item(s).", "good");
    sendSocket({
      type: "transfer-offer",
      targetId: getTarget(),
      offerId: randomId(),
      fileCount: state.selectedFiles.length,
      totalBytes: state.selectedFiles.reduce(function(t, x) { return t + x.file.size; }, 0),
      names: state.selectedFiles.slice(0, 25).map(function(x) { return x.relativePath; })
    });
  }
}

function renderSelected() {
  e.sendButton.disabled = !state.selectedFiles.length;
  e.selectedList.innerHTML = "";
  if (!state.selectedFiles.length) {
    makeEmpty(e.selectedList, "No files selected yet.");
    return;
  }
  var total = state.selectedFiles.reduce(function(t, x) { return t + x.file.size; }, 0);
  makeChip(e.selectedList, state.selectedFiles.length + " selected item(s)", formatBytes(total), "Remove all", function() {
    state.selectedFiles = [];
    renderSelected();
  });
  state.selectedFiles.slice(0, 10).forEach(function(x) {
    makeChip(e.selectedList, x.relativePath, formatBytes(x.file.size), "Remove", function() {
      state.selectedFiles = state.selectedFiles.filter(function(y) { return y !== x; });
      renderSelected();
    });
  });
  if (state.selectedFiles.length > 10) {
    makeEmpty(e.selectedList, "And " + (state.selectedFiles.length - 10) + " more item(s).");
  }
}

function makeChip(parent, name, meta, btnText, fn) {
  var c = document.createElement("div");
  c.className = "chip";

  var textWrap = document.createElement("div");
  var nameEl = document.createElement("div");
  nameEl.className = "name";
  nameEl.textContent = name;
  var metaEl = document.createElement("div");
  metaEl.className = "meta";
  metaEl.textContent = meta;
  textWrap.appendChild(nameEl);
  textWrap.appendChild(metaEl);

  var btn = document.createElement("button");
  btn.className = "btn";
  btn.type = "button";
  btn.textContent = btnText;
  btn.onclick = fn;

  c.appendChild(textWrap);
  c.appendChild(btn);
  parent.appendChild(c);
}

async function sendSelected(gestureMode) {
  if (!state.selectedFiles.length) {
    toast("Select files first.", "warn");
    return;
  }
  var fd = new FormData();
  fd.append("senderId", state.deviceId);
  fd.append("senderName", state.deviceName);
  fd.append("targetId", state.selectedTargetId === "host" ? "" : state.selectedTargetId);
  fd.append("gestureMode", String(!!gestureMode));
  fd.append("note", e.transferNote.value || "");
  state.selectedFiles.forEach(function(x) { fd.append("file", x.file, x.relativePath); });

  e.sendButton.disabled = true;
  e.progressWrap.hidden = false;
  e.progressBar.style.width = "0%";
  setStatus("Uploading...", true);

  try {
    var out = await uploadXhr("/api/upload", fd, function(pct) {
      e.progressBar.style.width = pct + "%";
    });
    if (!out.ok) throw new Error(out.error || "Upload failed.");
    sendSocket({
      type: "super-drag-drop",
      targetId: getTarget(),
      uploadHint: { uploadId: out.upload.uploadId, fileCount: out.upload.fileCount }
    });
    toast("Sent " + out.upload.fileCount + " item(s).", "good");
    state.selectedFiles = [];
    renderSelected();
    refreshHistory();
  } catch (err) {
    toast(err.message, "bad");
  } finally {
    e.sendButton.disabled = !state.selectedFiles.length;
    e.progressWrap.hidden = true;
    e.progressBar.style.width = "0%";
    setStatus(state.paired ? "Paired and ready" : "Server online", state.paired);
  }
}

function uploadXhr(url, fd, onProgress) {
  return new Promise(function(resolve, reject) {
    var x = new XMLHttpRequest();
    x.open("POST", url);
    x.upload.onprogress = function(ev) {
      if (ev.lengthComputable) onProgress(Math.round(ev.loaded / ev.total * 100));
    };
    x.onload = function() {
      var out = parseJson(x.responseText) || {};
      if (x.status >= 200 && x.status < 300) {
        onProgress(100);
        resolve(out);
      } else {
        reject(new Error(out.error || "Upload failed with status " + x.status + "."));
      }
    };
    x.onerror = function() { reject(new Error("Network upload failed.")); };
    x.onabort = function() { reject(new Error("Upload cancelled.")); };
    x.send(fd);
  });
}

async function refreshHistory() {
  try {
    var r = await fetch("/api/history", { cache: "no-store" });
    var data = await r.json();
    var uploads = (data.uploads || []).slice(0, 10);
    e.historyList.innerHTML = "";
    if (!uploads.length) {
      makeEmpty(e.historyList, "No transfers yet.");
      return;
    }
    uploads.forEach(function(u) {
      var card = document.createElement("div");
      card.className = "history";
      var strong = document.createElement("strong");
      strong.textContent = u.fileCount + " item(s) from " + (u.senderName || "Unknown device");
      var meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = formatBytes(u.totalBytes) + "  |  " + formatTime(u.receivedAt);
      var note = document.createElement("div");
      note.className = "meta";
      note.textContent = u.note ? "Note: " + u.note : "Folder: " + u.folder;
      card.appendChild(strong);
      card.appendChild(meta);
      card.appendChild(note);
      e.historyList.appendChild(card);
    });
  } catch (err) {
    toast(err.message, "bad");
  }
}

async function droppedFiles(dataTransfer) {
  var items = Array.from(dataTransfer.items || []);
  var supportsEntries = items.some(function(item) {
    return typeof item.webkitGetAsEntry === "function";
  });
  if (items.length && supportsEntries) {
    var results = [];
    for (var i = 0; i < items.length; i++) {
      var entry = items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : null;
      if (entry) {
        var walked = await walkEntry(entry, "");
        results = results.concat(walked);
      }
    }
    return results;
  }
  return Array.from(dataTransfer.files || []).map(function(f) {
    return { file: f, relativePath: f.webkitRelativePath || f.name };
  });
}

async function walkEntry(entry, prefix) {
  if (entry.isFile) {
    return [await fileFromEntry(entry, prefix)];
  }
  if (!entry.isDirectory) return [];
  var reader = entry.createReader();
  var children = await readDirEntries(reader);
  var results = [];
  for (var i = 0; i < children.length; i++) {
    var sub = await walkEntry(children[i], prefix + entry.name + "/");
    results = results.concat(sub);
  }
  return results;
}

function fileFromEntry(entry, prefix) {
  return new Promise(function(resolve, reject) {
    entry.file(function(f) {
      resolve({ file: f, relativePath: prefix + f.name });
    }, reject);
  });
}

function readDirEntries(reader) {
  return new Promise(function(resolve, reject) {
    var all = [];
    function batch() {
      reader.readEntries(function(entries) {
        if (!entries.length) { resolve(all); return; }
        all = all.concat(Array.from(entries));
        batch();
      }, reject);
    }
    batch();
  });
}

function toggleSuperDrag(force) {
  state.superDragArmed = typeof force === "boolean" ? force : !state.superDragArmed;
  e.dropzone.classList.toggle("armed", state.superDragArmed);
  e.armDrag.textContent = state.superDragArmed ? "Super drag armed" : "Arm super drag";
  if (state.superDragArmed) {
    sendSocket({ type: "super-drag-start", itemCount: state.selectedFiles.length });
    toast("Super drag armed. Drop files when ready.", "good");
  } else {
    sendSocket({ type: "gesture", gesture: "cancel" });
  }
}

function markDrag(ev) {
  ev.preventDefault();
  e.dropzone.classList.add("dragging");
}

function pointerPos(ev) {
  var r = e.gesturePad.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)),
    y: Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height))
  };
}

function moveCursor(ev) {
  var p = pointerPos(ev);
  e.gesturePad.style.setProperty("--gx", p.x * 100 + "%");
  e.gesturePad.style.setProperty("--gy", p.y * 100 + "%");
  e.gestureCursor.style.left = p.x * 100 + "%";
  e.gestureCursor.style.top = p.y * 100 + "%";
}

function cancelGesture() {
  state.gestureActive = false;
  e.gesturePad.classList.remove("active");
  sendSocket({ type: "gesture", gesture: "cancel" });
  toast("Gesture cancelled.", "warn");
}

function sendSocket(msg) {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify(msg));
  }
}

function getTarget() {
  return state.selectedTargetId === "host" ? null : state.selectedTargetId;
}

function setStatus(text, online) {
  e.statusText.textContent = text;
  e.statusDot.classList.toggle("online", !!online);
}

function toast(msg, type) {
  var n = document.createElement("div");
  n.className = "toast " + (type || "");
  n.textContent = msg;
  e.toastRegion.appendChild(n);
  setTimeout(function() {
    n.style.opacity = "0";
    n.style.transform = "translateY(6px)";
    n.style.transition = "opacity 0.2s, transform 0.2s";
  }, 3200);
  setTimeout(function() { n.remove(); }, 3500);
}

function makeEmpty(parent, msg) {
  var d = document.createElement("div");
  d.className = "empty";
  d.textContent = msg;
  parent.appendChild(d);
}

function getOrCreateDeviceId() {
  var id = localStorage.getItem("nearshare.deviceId");
  if (!id) {
    id = randomId();
    localStorage.setItem("nearshare.deviceId", id);
  }
  return id;
}

function randomId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  var arr = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(arr);
  else for (var i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
  return Array.from(arr).map(function(b) { return b.toString(16).padStart(2, "0"); }).join("");
}

function defaultDeviceName() {
  var p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "device";
  return "My " + p;
}

function digits(v) { return String(v || "").replace(/[^0-9]/g, ""); }

function cleanPath(v) {
  var parts = String(v || "file").replace(/\\/g, "/").split("/").filter(function(p) {
    return p && p !== "." && p !== "..";
  });
  return parts.join("/").slice(0, 1500) || "file";
}

function formatBytes(n) {
  if (!n || !isFinite(n)) return "0 B";
  var u = ["B", "KB", "MB", "GB", "TB"];
  var p = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return (n / Math.pow(1024, p)).toFixed(p ? 1 : 0) + " " + u[p];
}

function formatTime(v) {
  if (!v || v === "local") return "local";
  var d = new Date(v);
  return isNaN(d.getTime()) ? "unknown" : d.toLocaleString();
}

function parseJson(v) {
  try { return JSON.parse(v); } catch (ex) { return null; }
}

function camelize(id) {
  return id.replace(/-([a-z])/g, function(_, c) { return c.toUpperCase(); });
}
