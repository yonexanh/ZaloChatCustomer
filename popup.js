const CHAT_URL_PATTERN = "https://chat.zalo.me/*";
const PRESET_LIBRARY_URL = chrome.runtime.getURL("preset-library.json");
const PRESET_OVERRIDES_KEY = "zaloScheduler.presetOverrides";

const state = {
  presets: [],
  presetOverrides: {},
  selectedPresetId: "",
  capturedTabId: null
};

const refs = {
  metaText: document.getElementById("metaText"),
  captureConversationBtn: document.getElementById("captureConversationBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  pendingCountText: document.getElementById("pendingCountText"),
  runningCountText: document.getElementById("runningCountText"),
  sentCountText: document.getElementById("sentCountText"),
  failedCountText: document.getElementById("failedCountText"),
  selectedConversationText: document.getElementById("selectedConversationText"),
  selectedConversationHint: document.getElementById("selectedConversationHint"),
  presetSelect: document.getElementById("presetSelect"),
  presetSummary: document.getElementById("presetSummary"),
  presetTitle: document.getElementById("presetTitle"),
  presetDescription: document.getElementById("presetDescription"),
  conversationInput: document.getElementById("conversationInput"),
  messageInput: document.getElementById("messageInput"),
  presetEditTitle: document.getElementById("presetEditTitle"),
  presetEditHint: document.getElementById("presetEditHint"),
  savePresetMessageBtn: document.getElementById("savePresetMessageBtn"),
  resetPresetMessageBtn: document.getElementById("resetPresetMessageBtn"),
  assetSummary: document.getElementById("assetSummary"),
  assetNameText: document.getElementById("assetNameText"),
  assetPathText: document.getElementById("assetPathText"),
  datetimeInput: document.getElementById("datetimeInput"),
  scheduleForm: document.getElementById("scheduleForm"),
  statusText: document.getElementById("statusText"),
  scheduleCountText: document.getElementById("scheduleCountText"),
  scheduleList: document.getElementById("scheduleList")
};

let statusTimer = null;

document.addEventListener("DOMContentLoaded", () => {
  void init();
});

async function init() {
  bindEvents();
  renderMeta();
  setDefaultScheduleTime();
  await loadPresetOverrides();
  await loadPresets();
  await refreshSchedules();
}

function bindEvents() {
  refs.captureConversationBtn.addEventListener("click", () => {
    void handleCaptureConversation();
  });

  refs.refreshBtn.addEventListener("click", () => {
    void refreshSchedules();
  });

  refs.presetSelect.addEventListener("change", handlePresetChange);
  refs.messageInput.addEventListener("input", handleMessageInputChange);
  refs.savePresetMessageBtn.addEventListener("click", () => {
    void handleSavePresetMessage();
  });
  refs.resetPresetMessageBtn.addEventListener("click", () => {
    void handleResetPresetMessage();
  });

  refs.scheduleForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void handleSaveSchedule();
  });

  refs.scheduleList.addEventListener("click", (event) => {
    void handleScheduleListClick(event);
  });
}

function renderMeta() {
  const manifest = chrome.runtime.getManifest();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  refs.metaText.textContent = `Phiên bản ${manifest.version} • ${timezone}`;
}

async function loadPresetOverrides() {
  try {
    const result = await chrome.storage.local.get(PRESET_OVERRIDES_KEY);
    state.presetOverrides = normalizePresetOverrides(result[PRESET_OVERRIDES_KEY]);
  } catch (_error) {
    state.presetOverrides = {};
  }
}

async function loadPresets() {
  try {
    const response = await fetch(`${PRESET_LIBRARY_URL}?t=${Date.now()}`);
    if (!response.ok) {
      throw new Error("Không đọc được preset-library.json.");
    }

    const payload = await response.json();
    state.presets = normalizePresets(payload?.presets);
    renderPresetOptions();
    updateSelectedPreset(state.selectedPresetId);
  } catch (error) {
    state.presets = [];
    renderPresetOptions();
    updateSelectedPreset("");
    showStatus(error.message || "Không nạp được thư viện mẫu.", "error", 0);
  }
}

function normalizePresets(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry, index) => normalizePreset(entry, index))
    .filter(Boolean);
}

function normalizePreset(entry, index) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  const label = typeof entry.label === "string" ? entry.label.trim() : "";
  const description = typeof entry.description === "string" ? entry.description.trim() : "";
  const message = typeof entry.message === "string" ? entry.message : "";
  const imagePath = typeof entry.imagePath === "string" ? entry.imagePath.trim().replace(/^\/+/, "") : "";
  const imageName =
    typeof entry.imageName === "string" && entry.imageName.trim()
      ? entry.imageName.trim()
      : extractFileName(imagePath);

  if (!id || !label || imagePath.includes("..")) {
    return null;
  }

  const override = state.presetOverrides[id];
  const overriddenMessage = typeof override?.message === "string" ? override.message : null;

  return {
    id,
    label,
    description,
    message: overriddenMessage ?? message,
    defaultMessage: message,
    imagePath,
    imageName,
    hasCustomMessage: overriddenMessage !== null && overriddenMessage !== message,
    sortIndex: index
  };
}

function renderPresetOptions() {
  if (!state.presets.length) {
    refs.presetSelect.innerHTML = '<option value="">Chưa có preset hợp lệ</option>';
    return;
  }

  refs.presetSelect.innerHTML = ['<option value="">Tự nhập nội dung</option>']
    .concat(
      state.presets.map((preset) => {
        const suffix = preset.imagePath ? " • có ảnh" : "";
        return `<option value="${escapeHtml(preset.id)}">${escapeHtml(`${preset.label}${suffix}`)}</option>`;
      })
    )
    .join("");
}

function handlePresetChange() {
  updateSelectedPreset(refs.presetSelect.value);
}

function handleMessageInputChange() {
  renderPresetEditorState(getSelectedPreset());
}

function updateSelectedPreset(presetId) {
  state.selectedPresetId = presetId || "";
  const preset = state.presets.find((item) => item.id === state.selectedPresetId) || null;

  if (!preset) {
    refs.presetSelect.value = "";
    refs.presetSummary.dataset.state = "empty";
    refs.presetTitle.textContent = "Chưa chọn mẫu";
    refs.presetDescription.textContent =
      "Chọn một dòng trong preset-library.json nếu muốn dùng nội dung và ảnh có sẵn.";
    renderPresetEditorState(null);
    refs.assetSummary.dataset.state = "empty";
    refs.assetNameText.textContent = "Không gửi kèm ảnh";
    refs.assetPathText.textContent = "Ảnh chỉ lấy từ thư mục preset-assets/, không cần chọn file thủ công.";
    return;
  }

  refs.presetSelect.value = preset.id;
  refs.presetSummary.dataset.state = "ready";
  refs.presetTitle.textContent = preset.label;
  refs.presetDescription.textContent =
    preset.description || "Preset này sẽ nạp nội dung và ảnh có sẵn trong project.";
  refs.messageInput.value = preset.message || "";
  renderPresetEditorState(preset);

  if (preset.imagePath) {
    refs.assetSummary.dataset.state = "image";
    refs.assetNameText.textContent = preset.imageName || extractFileName(preset.imagePath);
    refs.assetPathText.textContent = `Ảnh lấy trực tiếp từ project: ${preset.imagePath}`;
  } else {
    refs.assetSummary.dataset.state = "ready";
    refs.assetNameText.textContent = "Preset này không gắn ảnh";
    refs.assetPathText.textContent = "Chỉ gửi nội dung tin nhắn.";
  }
}

function renderPresetEditorState(preset) {
  if (!preset) {
    refs.presetEditTitle.textContent = "Nội dung mẫu cố định";
    refs.presetEditHint.textContent =
      "Chọn một mẫu rồi sửa nội dung ở trên nếu muốn lưu lại cho những lần sau.";
    refs.savePresetMessageBtn.disabled = true;
    refs.resetPresetMessageBtn.disabled = true;
    return;
  }

  const currentMessage = refs.messageInput.value;
  const savedMessage = preset.message || "";
  const defaultMessage = preset.defaultMessage || "";
  const isDirty = currentMessage !== savedMessage;
  const differsFromDefault = currentMessage !== defaultMessage;

  if (!isDirty) {
    refs.presetEditTitle.textContent = preset.hasCustomMessage
      ? `${preset.label} • đang dùng nội dung đã lưu`
      : `${preset.label} • đang dùng nội dung gốc`;
    refs.presetEditHint.textContent = preset.hasCustomMessage
      ? "Nội dung của mẫu này đã được anh chỉnh và lưu lại trong extension."
      : "Anh có thể sửa ô nội dung ở trên rồi bấm Lưu nội dung vào mẫu.";
  } else {
    refs.presetEditTitle.textContent = `${preset.label} • có thay đổi chưa lưu`;
    refs.presetEditHint.textContent = differsFromDefault
      ? "Anh đang sửa nội dung của mẫu này. Bấm Lưu nội dung vào mẫu để dùng lại ở những lần sau."
      : "Ô nội dung đã trở về bản gốc nhưng thay đổi này chưa được lưu.";
  }

  refs.savePresetMessageBtn.disabled = !isDirty;
  refs.resetPresetMessageBtn.disabled = !preset.hasCustomMessage && !differsFromDefault;
}

async function handleSavePresetMessage() {
  const preset = getSelectedPreset();
  if (!preset) {
    showStatus("Hãy chọn một mẫu cố định trước.", "error");
    return;
  }

  try {
    const nextMessage = refs.messageInput.value;
    const nextOverrides = { ...state.presetOverrides };
    let successMessage = `Đã lưu nội dung cho mẫu "${preset.label}".`;

    if (nextMessage === preset.defaultMessage) {
      delete nextOverrides[preset.id];
      successMessage = `Đã đưa mẫu "${preset.label}" về nội dung gốc.`;
    } else {
      nextOverrides[preset.id] = {
        message: nextMessage
      };
    }

    state.presetOverrides = nextOverrides;
    await chrome.storage.local.set({
      [PRESET_OVERRIDES_KEY]: nextOverrides
    });
    await loadPresets();
    showStatus(successMessage, "success");
  } catch (error) {
    showStatus(error.message || "Không lưu được nội dung mẫu.", "error", 0);
  }
}

async function handleResetPresetMessage() {
  const preset = getSelectedPreset();
  if (!preset) {
    showStatus("Hãy chọn một mẫu cố định trước.", "error");
    return;
  }

  try {
    if (!preset.hasCustomMessage) {
      if (refs.messageInput.value === preset.defaultMessage) {
        showStatus(`Mẫu "${preset.label}" đang ở nội dung gốc rồi.`, "info");
        return;
      }

      refs.messageInput.value = preset.defaultMessage;
      renderPresetEditorState(preset);
      showStatus(`Đã đưa ô nội dung của mẫu "${preset.label}" về bản gốc.`, "success");
      return;
    }

    const nextOverrides = { ...state.presetOverrides };
    delete nextOverrides[preset.id];
    state.presetOverrides = nextOverrides;
    await chrome.storage.local.set({
      [PRESET_OVERRIDES_KEY]: nextOverrides
    });
    await loadPresets();
    showStatus(`Đã khôi phục nội dung gốc của mẫu "${preset.label}".`, "success");
  } catch (error) {
    showStatus(error.message || "Không khôi phục được nội dung gốc.", "error", 0);
  }
}

async function handleCaptureConversation() {
  try {
    showStatus("Đang đọc cuộc trò chuyện đang mở...", "info", 0);
    const tab = await getCurrentZaloTab();
    const response = await chrome.tabs.sendMessage(tab.id, { type: "CAPTURE_CONTEXT" });

    if (!response?.ok) {
      throw new Error(response?.error || "Không đọc được thông tin từ tab Zalo.");
    }

    if (!response.conversationName) {
      throw new Error("Không nhận diện được tên cuộc trò chuyện hiện tại.");
    }

    state.capturedTabId = tab.id;
    refs.conversationInput.value = response.conversationName;
    refs.selectedConversationText.textContent = response.conversationName;
    refs.selectedConversationHint.textContent = "Lịch gửi sẽ ưu tiên dùng lại đúng tab Zalo này để thao tác.";

    if (!refs.messageInput.value.trim() && typeof response.draftMessage === "string" && response.draftMessage.trim()) {
      refs.messageInput.value = response.draftMessage.trim();
    }

    showStatus("Đã lấy khách hàng từ tab Zalo đang mở.", "success");
  } catch (error) {
    showStatus(error.message || "Không lấy được cuộc trò chuyện.", "error", 0);
  }
}

async function getCurrentZaloTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true,
    url: [CHAT_URL_PATTERN]
  });

  if (!tabs[0]?.id) {
    throw new Error("Hãy mở chat.zalo.me và chọn đúng cuộc trò chuyện trước.");
  }

  return tabs[0];
}

async function handleSaveSchedule() {
  try {
    const conversationName = refs.conversationInput.value.trim();
    const message = refs.messageInput.value.trim();
    const presetAsset = buildPresetAssetPayload();
    const scheduledAt = refs.datetimeInput.value ? new Date(refs.datetimeInput.value).getTime() : Number.NaN;

    if (!conversationName) {
      throw new Error("Cần nhập tên khách hàng / cuộc trò chuyện.");
    }

    if (!message && !presetAsset) {
      throw new Error("Cần có nội dung hoặc ảnh mẫu để gửi.");
    }

    if (!Number.isFinite(scheduledAt)) {
      throw new Error("Thời gian gửi không hợp lệ.");
    }

    const response = await chrome.runtime.sendMessage({
      type: "SAVE_SCHEDULE",
      payload: {
        conversationName,
        message,
        presetAsset,
        scheduledAt,
        sourceTabId: state.capturedTabId
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Không lưu được lịch gửi.");
    }

    showStatus("Đã lưu lịch gửi thành công.", "success");
    setDefaultScheduleTime();
    await refreshSchedules();
  } catch (error) {
    showStatus(error.message || "Không lưu được lịch gửi.", "error", 0);
  }
}

function buildPresetAssetPayload() {
  const preset = getSelectedPreset();
  if (!preset?.imagePath) {
    return null;
  }

  return {
    id: preset.id,
    label: preset.label,
    path: preset.imagePath,
    name: preset.imageName || extractFileName(preset.imagePath)
  };
}

function getSelectedPreset() {
  return state.presets.find((item) => item.id === state.selectedPresetId) || null;
}

async function refreshSchedules() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "LIST_SCHEDULES" });
    if (!response?.ok) {
      throw new Error(response?.error || "Không tải được danh sách lịch.");
    }

    const schedules = Array.isArray(response.schedules) ? response.schedules : [];
    renderStats(schedules);
    refs.scheduleCountText.textContent = String(schedules.length);
    renderSchedules(schedules);
  } catch (error) {
    renderStats([]);
    refs.scheduleCountText.textContent = "!";
    refs.scheduleList.innerHTML = `<div class="empty-state">${escapeHtml(
      error.message || "Không tải được lịch gửi."
    )}</div>`;
  }
}

function renderStats(schedules) {
  const counts = {
    scheduled: 0,
    running: 0,
    sent: 0,
    failed: 0
  };

  for (const schedule of schedules) {
    if (schedule?.status && counts[schedule.status] !== undefined) {
      counts[schedule.status] += 1;
    }
  }

  refs.pendingCountText.textContent = String(counts.scheduled);
  refs.runningCountText.textContent = String(counts.running);
  refs.sentCountText.textContent = String(counts.sent);
  refs.failedCountText.textContent = String(counts.failed);
}

function renderSchedules(schedules) {
  if (!schedules.length) {
    refs.scheduleList.innerHTML = '<div class="empty-state">Chưa có lịch gửi nào.</div>';
    return;
  }

  refs.scheduleList.innerHTML = schedules.map((schedule) => renderScheduleCard(schedule)).join("");
}

function renderScheduleCard(schedule) {
  const messagePreview = schedule.message?.trim()
    ? escapeHtml(schedule.message)
    : schedule.presetAsset
      ? "Chỉ gửi ảnh mẫu."
      : "Không có nội dung.";
  const canRun = schedule.status !== "running" && schedule.status !== "sent";
  const runLabel = schedule.status === "failed" ? "Thử lại" : "Gửi ngay";
  const runButton = canRun
    ? `<button type="button" class="secondary" data-action="run" data-id="${escapeHtml(schedule.id)}">${runLabel}</button>`
    : "";

  const metaChips = [
    schedule.presetAsset?.label ? `Mẫu: ${schedule.presetAsset.label}` : "Tự nhập nội dung",
    schedule.presetAsset ? "Có ảnh mẫu" : "Không có ảnh",
    `Số lần chạy: ${Number(schedule.attempts) || 0}`
  ];

  const infoCells = [
    buildInfoCell("Hẹn gửi", formatDateTime(schedule.scheduledAt)),
    buildInfoCell("Lần cập nhật", formatDateTime(schedule.updatedAt || schedule.createdAt)),
    buildInfoCell("Bắt đầu chạy", schedule.startedAt ? formatDateTime(schedule.startedAt) : "Chưa chạy"),
    buildInfoCell("Hoàn tất", schedule.sentAt ? formatDateTime(schedule.sentAt) : schedule.failedAt ? formatDateTime(schedule.failedAt) : "Chưa có")
  ].join("");

  const noteBox = schedule.executionNote
    ? `<div class="note-box">${escapeHtml(schedule.executionNote)}</div>`
    : "";
  const errorBox = schedule.lastError
    ? `<div class="error-box">${escapeHtml(schedule.lastError)}</div>`
    : "";
  const logEntries = Array.isArray(schedule.logEntries) ? [...schedule.logEntries].reverse() : [];
  const logDetails = logEntries.length
    ? `
      <details class="log-details">
        <summary>Nhật ký chạy • ${logEntries.length} dòng</summary>
        <div class="log-list">
          ${logEntries.map((entry) => renderLogEntry(entry)).join("")}
        </div>
      </details>
    `
    : "";

  return `
    <article class="schedule-item">
      <div class="schedule-meta">
        <div>
          <div class="schedule-title">${escapeHtml(schedule.conversationName || "Không rõ khách")}</div>
          <time class="schedule-time" datetime="${new Date(schedule.scheduledAt).toISOString()}">${escapeHtml(
            formatDateTime(schedule.scheduledAt)
          )}</time>
        </div>
        <span class="pill" data-status="${escapeHtml(schedule.status)}">${escapeHtml(statusLabel(schedule.status))}</span>
      </div>

      <div class="schedule-inline-meta">
        ${metaChips.map((value) => `<span class="meta-chip">${escapeHtml(value)}</span>`).join("")}
      </div>

      <p class="message-preview">${messagePreview}</p>

      <div class="info-grid">
        ${infoCells}
      </div>

      ${noteBox}
      ${errorBox}
      ${logDetails}

      <div class="schedule-actions">
        ${runButton}
        <button type="button" class="danger" data-action="delete" data-id="${escapeHtml(schedule.id)}">Xóa</button>
      </div>
    </article>
  `;
}

function buildInfoCell(label, value) {
  return `
    <div class="info-cell">
      <span class="info-label">${escapeHtml(label)}</span>
      <span class="info-value">${escapeHtml(value)}</span>
    </div>
  `;
}

function renderLogEntry(entry) {
  const step = entry?.step || "Nhật ký";
  const message = entry?.message || "";
  const level = normalizeLogLevel(entry?.level);

  return `
    <div class="log-row" data-level="${escapeHtml(level)}">
      <span class="log-time">${escapeHtml(formatLogTime(entry?.at))}</span>
      <div class="log-main">
        <span class="log-step">${escapeHtml(step)}</span>
        <span class="log-message">${escapeHtml(message)}</span>
      </div>
    </div>
  `;
}

async function handleScheduleListClick(event) {
  const button = event.target instanceof HTMLElement ? event.target.closest("[data-action]") : null;
  if (!button) {
    return;
  }

  const action = button.dataset.action;
  const id = button.dataset.id;
  if (!action || !id) {
    return;
  }

  try {
    if (action === "delete") {
      if (!window.confirm("Xóa lịch gửi này?")) {
        return;
      }

      const response = await chrome.runtime.sendMessage({ type: "DELETE_SCHEDULE", id });
      if (!response?.ok) {
        throw new Error(response?.error || "Không xóa được lịch gửi.");
      }

      showStatus("Đã xóa lịch gửi.", "success");
      await refreshSchedules();
      return;
    }

    if (action === "run") {
      showStatus("Đang chạy lịch ngay bây giờ...", "info", 0);
      const response = await chrome.runtime.sendMessage({ type: "SEND_NOW", id });
      if (!response?.ok) {
        throw new Error(response?.error || "Không gửi được lịch này.");
      }

      showStatus("Lệnh gửi đã được chạy.", "success");
      await refreshSchedules();
    }
  } catch (error) {
    showStatus(error.message || "Thao tác thất bại.", "error", 0);
    await refreshSchedules();
  }
}

function setDefaultScheduleTime() {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 10);
  now.setSeconds(0, 0);

  const roundedMinutes = Math.ceil(now.getMinutes() / 5) * 5;
  now.setMinutes(roundedMinutes);
  refs.datetimeInput.value = toDatetimeLocalValue(now);
}

function toDatetimeLocalValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function statusLabel(status) {
  switch (status) {
    case "scheduled":
      return "Đang chờ";
    case "running":
      return "Đang gửi";
    case "sent":
      return "Đã gửi";
    case "failed":
      return "Lỗi";
    default:
      return "Không rõ";
  }
}

function normalizeLogLevel(level) {
  const supported = new Set(["info", "success", "warn", "error"]);
  return supported.has(level) ? level : "info";
}

function normalizePresetOverrides(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([presetId, override]) => {
        if (!override || typeof override !== "object") {
          return null;
        }

        const id = String(presetId || "").trim();
        const message = typeof override.message === "string" ? override.message : "";
        if (!id) {
          return null;
        }

        return [id, { message }];
      })
      .filter(Boolean)
  );
}

function formatDateTime(timestamp) {
  if (!timestamp) {
    return "Chưa có";
  }

  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function formatLogTime(timestamp) {
  if (!timestamp) {
    return "--:--";
  }

  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function extractFileName(path) {
  return String(path || "").split("/").filter(Boolean).pop() || "Ảnh mẫu";
}

function showStatus(message, tone = "info", durationMs = 3500) {
  clearTimeout(statusTimer);
  refs.statusText.hidden = false;
  refs.statusText.dataset.tone = tone;
  refs.statusText.textContent = message;

  if (durationMs > 0) {
    statusTimer = setTimeout(() => {
      refs.statusText.hidden = true;
    }, durationMs);
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
