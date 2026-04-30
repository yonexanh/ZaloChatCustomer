const STORAGE_KEY = "zaloScheduler.schedules";
const ALARM_PREFIX = "zaloScheduler:";
const PRESET_LIBRARY_PATH = "preset-library.json";
const CHAT_URL = "https://chat.zalo.me/";
const CHAT_URL_PATTERN = "https://chat.zalo.me/*";
const RUN_LOCK_MS = 2 * 60 * 1000;
const DEBUGGER_VERSION = "1.3";
const LOCAL_PROJECT_ROOT = "/Users/mac/Documents/ZaloChatCus";

chrome.runtime.onInstalled.addListener(() => {
  void restoreSchedules();
});

chrome.runtime.onStartup.addListener(() => {
  void restoreSchedules();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) {
    return;
  }

  const scheduleId = alarm.name.slice(ALARM_PREFIX.length);
  void executeSchedule(scheduleId, "alarm");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => {
      console.error("handleMessage failed", error);
      sendResponse({ ok: false, error: error.message || "Unexpected error" });
    });

  return true;
});

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "LIST_SCHEDULES":
      return { ok: true, schedules: await listSchedules() };
    case "SAVE_SCHEDULE":
      return { ok: true, schedule: await saveSchedule(message.payload, sender) };
    case "DELETE_SCHEDULE":
      await deleteSchedule(message.id);
      return { ok: true };
    case "SEND_NOW":
      await executeSchedule(message.id, "manual");
      return { ok: true };
    default:
      return { ok: false, error: "Unsupported message type" };
  }
}

async function getStoredSchedules() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const schedules = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
  return schedules.map((schedule) => normalizeSchedule(schedule)).filter(Boolean);
}

async function setStoredSchedules(schedules) {
  await chrome.storage.local.set({
    [STORAGE_KEY]: schedules.map((schedule) => normalizeSchedule(schedule)).filter(Boolean)
  });
  await refreshBadge(schedules);
}

async function listSchedules() {
  const schedules = await getStoredSchedules();
  const statusOrder = {
    scheduled: 0,
    running: 1,
    failed: 2,
    sent: 3
  };

  return schedules.sort((left, right) => {
    const leftRank = statusOrder[left.status] ?? 99;
    const rightRank = statusOrder[right.status] ?? 99;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    if (left.status === "sent" || left.status === "failed") {
      return (right.updatedAt || 0) - (left.updatedAt || 0);
    }

    return left.scheduledAt - right.scheduledAt;
  });
}

async function saveSchedule(payload, sender) {
  const conversationName = cleanText(payload?.conversationName || "");
  const message = String(payload?.message || "").trim();
  const presetAsset = normalizePresetAsset(payload?.presetAsset);
  const scheduledAt = Number(payload?.scheduledAt);
  const sourceTabId = Number.isInteger(payload?.sourceTabId) ? payload.sourceTabId : null;
  const sourceTabUrl = typeof sender?.tab?.url === "string" ? sender.tab.url : "";

  if (!conversationName) {
    throw new Error("Can chon dung khach hang / cuoc tro chuyen.");
  }

  if (!message && !presetAsset) {
    throw new Error("Can co noi dung hoac anh mau de gui.");
  }

  if (!Number.isFinite(scheduledAt)) {
    throw new Error("Thoi gian gui khong hop le.");
  }

  const now = Date.now();
  if (scheduledAt <= now) {
    throw new Error("Hay chon mot thoi diem trong tuong lai.");
  }

  const schedule = normalizeSchedule({
    id: createId(),
    createdAt: now,
    updatedAt: now,
    scheduledAt,
    conversationName,
    message,
    presetAsset,
    sourceTabId,
    sourceTabUrl,
    status: "scheduled",
    attempts: 0,
    sentAt: 0,
    failedAt: 0,
    startedAt: 0,
    lastExecutionId: "",
    lockExpiresAt: 0,
    lastError: "",
    executionNote: "",
    logEntries: [
      createLogEntry(
        "Tạo lịch",
        `Đã tạo lịch gửi lúc ${formatLogDateTime(scheduledAt)}${presetAsset ? " • có ảnh mẫu" : ""}.`,
        "info",
        now
      )
    ]
  });

  const schedules = await getStoredSchedules();
  schedules.push(schedule);
  await setStoredSchedules(schedules);
  await chrome.alarms.create(alarmNameFor(schedule.id), { when: scheduledAt });
  return schedule;
}

async function deleteSchedule(id) {
  const schedules = await getStoredSchedules();
  const nextSchedules = schedules.filter((schedule) => schedule.id !== id);
  await setStoredSchedules(nextSchedules);
  await chrome.alarms.clear(alarmNameFor(id));
}

async function restoreSchedules() {
  const schedules = await getStoredSchedules();
  const now = Date.now();
  let mutated = false;

  for (let index = 0; index < schedules.length; index += 1) {
    const schedule = schedules[index];

    if (schedule.status === "running") {
      schedules[index] = {
        ...schedule,
        status: "failed",
        updatedAt: now,
        failedAt: now,
        startedAt: 0,
        lockExpiresAt: 0,
        lastExecutionId: "",
        lastError:
          schedule.lastError || "Lần gửi trước bị gián đoạn. Kiểm tra tab Zalo rồi bấm Thử lại nếu cần.",
        executionNote: schedule.executionNote || "Da dung tien trinh cu de tranh gui trung.",
        logEntries: appendLogEntries(
          schedule.logEntries,
          createLogEntry(
            "Khôi phục phiên cũ",
            "Phiên chạy trước bị gián đoạn nên lịch được chuyển sang lỗi để tránh gửi trùng.",
            "warn",
            now
          )
        )
      };
      mutated = true;
      await chrome.alarms.clear(alarmNameFor(schedule.id));
      continue;
    }

    if (schedule.status === "scheduled") {
      const when = Math.max(schedule.scheduledAt, now + 1_000);
      await chrome.alarms.create(alarmNameFor(schedule.id), { when });
      continue;
    }

    await chrome.alarms.clear(alarmNameFor(schedule.id));
  }

  if (mutated) {
    await setStoredSchedules(schedules);
  } else {
    await refreshBadge(schedules);
  }
}

async function executeSchedule(scheduleId, trigger) {
  const schedules = await getStoredSchedules();
  const index = schedules.findIndex((schedule) => schedule.id === scheduleId);

  if (index === -1) {
    throw new Error("Khong tim thay lich gui.");
  }

  const current = schedules[index];
  const now = Date.now();

  if (trigger === "alarm" && current.status !== "scheduled") {
    await chrome.alarms.clear(alarmNameFor(scheduleId));
    return;
  }

  if (current.status === "running" && current.lockExpiresAt > now) {
    if (trigger === "alarm") {
      return;
    }
    throw new Error("Lich nay dang chay, hay cho xong roi thu lai.");
  }

  if (current.status === "sent") {
    throw new Error("Lich nay da gui xong.");
  }

  if (trigger === "manual") {
    await chrome.alarms.clear(alarmNameFor(scheduleId));
  }

  const executionId = createId();
  schedules[index] = {
    ...current,
    status: "running",
    updatedAt: now,
    startedAt: now,
    failedAt: 0,
    attempts: (current.attempts || 0) + 1,
    lastExecutionId: executionId,
    lockExpiresAt: now + RUN_LOCK_MS,
    lastError: "",
    executionNote: "",
    logEntries: appendLogEntries(
      current.logEntries,
      createLogEntry(
        "Bắt đầu chạy",
        trigger === "manual" ? "Được chạy thủ công từ popup." : "Đã đến giờ hẹn, bắt đầu thao tác trên Zalo Web.",
        "info",
        now
      )
    )
  };
  await setStoredSchedules(schedules);

  try {
    const schedule = schedules[index];
    const tab = await ensureChatTab(schedule);
    await focusChatTab(tab);
    await waitForTabComplete(tab.id);
    await waitForContentScript(tab.id);
    await appendScheduleLog(
      scheduleId,
      executionId,
      createLogEntry("Kết nối Zalo", "Đã mở đúng tab Zalo Web và sẵn sàng thao tác.", "info")
    );

    let imageAttachment = null;
    let latestPresetAsset = null;
    let response = null;

    if (schedule.presetAsset) {
      latestPresetAsset = await resolveLatestPresetAsset(schedule.presetAsset);
      imageAttachment = await loadPresetImageAttachment(latestPresetAsset);
      await appendScheduleLog(
        scheduleId,
        executionId,
        createLogEntry(
          "Chuẩn bị ảnh",
          `Đã nạp ảnh mẫu từ ${latestPresetAsset.path}.`,
          "info"
        )
      );
      // For image schedules, run exactly one automation path.
      // If it fails after touching the UI, stop immediately instead of
      // falling back to a second path that could click around unpredictably.
      response = await executeScheduleWithDebuggerImage(tab.id, executionId, schedule, imageAttachment, latestPresetAsset);
    } else {
      response = await chrome.tabs.sendMessage(tab.id, {
        type: "EXECUTE_SCHEDULE",
        payload: {
          executionId,
          conversationName: schedule.conversationName,
          message: schedule.message,
          imageAttachment
        }
      });
    }

    if (!response?.ok) {
      throw new Error(response?.error || "Tab Zalo khong xac nhan gui thanh cong.");
    }

    await finishScheduleSuccess(scheduleId, executionId, response.note || "");
  } catch (error) {
    await finishScheduleFailure(scheduleId, executionId, error.message || "Gui tin nhan that bai.");
    throw error;
  }
}

async function ensureChatTab(schedule) {
  const tabs = await chrome.tabs.query({ url: [CHAT_URL_PATTERN] });

  if (schedule.sourceTabId) {
    const exactTab = tabs.find((tab) => tab.id === schedule.sourceTabId);
    if (exactTab) {
      return exactTab;
    }
  }

  const activeTab = tabs.find((tab) => tab.active);
  if (activeTab) {
    return activeTab;
  }

  if (tabs[0]) {
    return tabs[0];
  }

  return chrome.tabs.create({ url: CHAT_URL, active: false });
}

async function focusChatTab(tab) {
  if (!tab?.id) {
    throw new Error("Khong tim thay tab Zalo Web.");
  }

  if (Number.isInteger(tab.windowId)) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }

  await chrome.tabs.update(tab.id, { active: true });
  await delay(900);
}

async function waitForTabComplete(tabId, timeoutMs = 30_000) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "complete") {
    return;
  }

  await new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      reject(new Error("Tab Zalo tai qua lau."));
    }, timeoutMs);

    const handleUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") {
        return;
      }

      clearTimeout(timeoutHandle);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      resolve();
    };

    chrome.tabs.onUpdated.addListener(handleUpdated);
  });
}

async function waitForContentScript(tabId, timeoutMs = 20_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "PING" });
      if (response?.ok) {
        return;
      }
    } catch (_error) {
      // Ignore while the tab is still loading.
    }

    await delay(700);
  }

  throw new Error("Khong ket noi duoc voi tab Zalo.");
}

async function executeScheduleWithDebuggerImage(tabId, executionId, schedule, imageAttachment, presetAsset) {
  const localPath = getLocalPresetAssetPath(presetAsset);
  if (!localPath) {
    throw new Error("Khong tao duoc duong dan local cho anh mau.");
  }

  const prepareResponse = await chrome.tabs.sendMessage(tabId, {
    type: "PREPARE_IMAGE_UPLOAD",
    payload: {
      conversationName: schedule.conversationName,
      attachmentFileName: imageAttachment.name
    }
  });

  if (!prepareResponse?.ok) {
    throw new Error(prepareResponse?.error || "Khong chuan bi duoc o chat de nap anh.");
  }

  const triggerResponse = await chrome.tabs.sendMessage(tabId, {
    type: "GET_ATTACHMENT_TRIGGER_POINTS",
    payload: {
      skipConversationSelect: true
    }
  });
  const triggerPoints = Array.isArray(triggerResponse?.points) ? triggerResponse.points : [];
  if (!triggerResponse?.ok || !triggerPoints.length) {
    throw new Error(triggerResponse?.error || "Khong tim thay nut dinh kem de mo file chooser.");
  }

  const diagnostics = [];
  const uploadResult = await withDebuggerSession(tabId, async (debuggee) => {
    await chrome.debugger.sendCommand(debuggee, "Page.enable");
    await chrome.debugger.sendCommand(debuggee, "DOM.enable");
    await chrome.debugger.sendCommand(debuggee, "Page.setInterceptFileChooserDialog", { enabled: true });

    try {
      for (const [triggerIndex, triggerPoint] of triggerPoints.slice(0, 5).entries()) {
        const triggerResult = await setFileByInterceptedChooser(
          debuggee,
          tabId,
          triggerPoint,
          localPath,
          `nut dinh kem ${triggerIndex + 1}`
        );
        diagnostics.push(triggerResult.detail);
        if (triggerResult.opened) {
          return { ok: true, detail: triggerResult.detail };
        }

        const optionResponse = await chrome.tabs.sendMessage(tabId, {
          type: "GET_ATTACHMENT_OPTION_POINTS",
          payload: {
            skipConversationSelect: true
          }
        });
        const optionPoints = Array.isArray(optionResponse?.points) ? optionResponse.points : [];

        for (const [optionIndex, optionPoint] of optionPoints.slice(0, 6).entries()) {
          const optionResult = await setFileByInterceptedChooser(
            debuggee,
            tabId,
            optionPoint,
            localPath,
            `nut ${triggerIndex + 1}, lua chon ${optionIndex + 1}`
          );
          diagnostics.push(optionResult.detail);
          if (optionResult.opened) {
            return { ok: true, detail: optionResult.detail };
          }
        }
      }

      return {
        ok: false,
        error: diagnostics.filter(Boolean).join("; ") || "Không mở được file chooser của Zalo."
      };
    } finally {
      try {
        await chrome.debugger.sendCommand(debuggee, "Page.setInterceptFileChooserDialog", { enabled: false });
      } catch (_error) {
        // Ignore cleanup failure.
      }
    }
  });

  if (!uploadResult?.ok) {
    throw new Error(uploadResult?.error || "Không nạp được ảnh bằng debugger.");
  }

  const readyResponse = await chrome.tabs.sendMessage(tabId, {
    type: "WAIT_FOR_IMAGE_READY",
    payload: {
      attachmentFileName: imageAttachment.name,
      attachmentProbe: prepareResponse.attachmentProbe || null,
      recentMediaCount: prepareResponse.recentMediaCount || 0,
      skipConversationSelect: true,
      timeoutMs: 7_000
    }
  });

  if (!readyResponse?.ok) {
    throw new Error(
      [uploadResult.detail, readyResponse?.error || "Không thấy preview ảnh sau khi gán file."]
        .filter(Boolean)
        .join("; ")
    );
  }

  const response = await chrome.tabs.sendMessage(tabId, {
    type: "EXECUTE_SCHEDULE",
    payload: {
      executionId,
      conversationName: schedule.conversationName,
      message: schedule.message,
      imageAttachment: null,
      existingAttachment: true,
      attachmentFileName: imageAttachment.name,
      skipConversationSelect: true
    }
  });

  if (!response?.ok) {
    throw new Error(
      [uploadResult.detail, response?.error || "Khong gui duoc sau khi anh da nap san."]
        .filter(Boolean)
        .join("; ")
    );
  }

  return {
    ok: true,
    note: [uploadResult.detail, "ảnh đã nạp bằng debugger", response.note].filter(Boolean).join("; ")
  };
}

async function withDebuggerSession(tabId, work) {
  const debuggee = { tabId };
  let attached = false;

  try {
    await chrome.debugger.attach(debuggee, DEBUGGER_VERSION);
    attached = true;
  } catch (_error) {
    throw new Error(
      "Khong gan duoc debugger vao tab Zalo. Neu DevTools dang mo cho tab nay, hay dong DevTools roi thu lai."
    );
  }

  try {
    return await work(debuggee);
  } finally {
    if (attached) {
      try {
        await chrome.debugger.detach(debuggee);
      } catch (_error) {
        // Ignore detach failures.
      }
    }
  }
}

async function setFileByInterceptedChooser(debuggee, tabId, point, localPath, label) {
  const chooserPromise = waitForDebuggerFileChooser(tabId, 2_500);
  await clickPointViaDebugger(debuggee, point);

  let chooserEvent = null;
  try {
    chooserEvent = await chooserPromise;
  } catch (_error) {
    return {
      opened: false,
      detail: `${label}: khong mo file chooser`
    };
  }

  const backendNodeId = Number(chooserEvent?.backendNodeId);
  if (!Number.isFinite(backendNodeId)) {
    return {
      opened: false,
      detail: `${label}: file chooser mo ra nhung khong co backendNodeId`
    };
  }

  await chrome.debugger.sendCommand(debuggee, "DOM.setFileInputFiles", {
    files: [localPath],
    backendNodeId
  });

  return {
    opened: true,
    detail: `${label}: da gan file vao file chooser`
  };
}

async function clickPointViaDebugger(debuggee, point) {
  const x = Math.round(Number(point?.x) || 0);
  const y = Math.round(Number(point?.y) || 0);

  if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) {
    throw new Error("Toa do click khong hop le de mo file chooser.");
  }

  await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
    button: "none"
  });
  await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1
  });
  await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1
  });
}

function waitForDebuggerFileChooser(tabId, timeoutMs = 2_500) {
  return new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      chrome.debugger.onEvent.removeListener(handleEvent);
      reject(new Error("Timeout waiting for Page.fileChooserOpened"));
    }, timeoutMs);

    const handleEvent = (source, method, params) => {
      if (source.tabId !== tabId || method !== "Page.fileChooserOpened") {
        return;
      }

      clearTimeout(timeoutHandle);
      chrome.debugger.onEvent.removeListener(handleEvent);
      resolve(params || {});
    };

    chrome.debugger.onEvent.addListener(handleEvent);
  });
}

async function finishScheduleSuccess(scheduleId, executionId, note) {
  const schedules = await getStoredSchedules();
  const index = schedules.findIndex((schedule) => schedule.id === scheduleId);

  if (index === -1) {
    return;
  }

  if (schedules[index].lastExecutionId !== executionId) {
    return;
  }

  const now = Date.now();
  schedules[index] = {
    ...schedules[index],
    status: "sent",
    updatedAt: now,
    sentAt: now,
    startedAt: 0,
    lockExpiresAt: 0,
    lastError: "",
    executionNote: note || "Đã gửi thành công.",
    logEntries: appendLogEntries(
      schedules[index].logEntries,
      createLogEntry("Hoàn tất", note || "Đã gửi thành công.", "success", now)
    )
  };

  await setStoredSchedules(schedules);
  await chrome.alarms.clear(alarmNameFor(scheduleId));
}

async function finishScheduleFailure(scheduleId, executionId, message) {
  const schedules = await getStoredSchedules();
  const index = schedules.findIndex((schedule) => schedule.id === scheduleId);

  if (index === -1) {
    return;
  }

  if (schedules[index].lastExecutionId !== executionId) {
    return;
  }

  const now = Date.now();
  schedules[index] = {
    ...schedules[index],
    status: "failed",
    updatedAt: now,
    failedAt: now,
    startedAt: 0,
    lockExpiresAt: 0,
    lastError: message || "Gui tin nhan that bai.",
    executionNote: schedules[index].executionNote || "Đã dừng lại để tránh gửi lặp.",
    logEntries: appendLogEntries(
      schedules[index].logEntries,
      createLogEntry("Lỗi", message || "Gửi tin nhắn thất bại.", "error", now)
    )
  };

  await setStoredSchedules(schedules);
  await chrome.alarms.clear(alarmNameFor(scheduleId));
}

async function resolveLatestPresetAsset(presetAsset) {
  const normalized = normalizePresetAsset(presetAsset);
  if (!normalized) {
    throw new Error("Anh mau trong project khong hop le.");
  }

  const latestPreset = await findPresetAssetById(normalized.id);
  return latestPreset || normalized;
}

async function findPresetAssetById(presetId) {
  const response = await fetch(`${chrome.runtime.getURL(PRESET_LIBRARY_PATH)}?t=${Date.now()}`);
  if (!response.ok) {
    throw new Error(`Khong doc duoc ${PRESET_LIBRARY_PATH}`);
  }

  const payload = await response.json();
  const presets = Array.isArray(payload?.presets) ? payload.presets : [];
  const matched = presets.find((preset) => String(preset?.id || "").trim() === presetId);

  if (!matched) {
    return null;
  }

  return normalizePresetAsset({
    id: matched.id,
    label: matched.label,
    path: matched.imagePath,
    name: matched.imageName
  });
}

async function loadPresetImageAttachment(presetAsset) {
  const normalized = normalizePresetAsset(presetAsset);
  if (!normalized) {
    throw new Error("Anh mau trong project khong hop le.");
  }

  const response = await fetch(chrome.runtime.getURL(normalized.path));
  if (!response.ok) {
    throw new Error(`Khong mo duoc anh mau: ${normalized.path}`);
  }

  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) {
    throw new Error(`File khong phai anh: ${normalized.path}`);
  }

  return {
    name: normalized.name || extractFileNameFromPath(normalized.path),
    type: blob.type || inferMimeTypeFromName(normalized.path),
    size: blob.size,
    dataUrl: await blobToDataUrl(blob)
  };
}

function getLocalPresetAssetPath(presetAsset) {
  const normalized = normalizePresetAsset(presetAsset);
  if (!normalized) {
    return "";
  }

  return `${LOCAL_PROJECT_ROOT}/${normalized.path}`;
}

function normalizeSchedule(schedule) {
  if (!schedule || typeof schedule !== "object") {
    return null;
  }

  const id = typeof schedule.id === "string" && schedule.id.trim() ? schedule.id.trim() : createId();
  const status = normalizeStatus(schedule.status);

  return {
    id,
    createdAt: normalizeTimestamp(schedule.createdAt),
    updatedAt: normalizeTimestamp(schedule.updatedAt),
    scheduledAt: normalizeTimestamp(schedule.scheduledAt),
    conversationName: cleanText(schedule.conversationName || ""),
    message: String(schedule.message || "").trim(),
    presetAsset: normalizePresetAsset(schedule.presetAsset),
    sourceTabId: Number.isInteger(schedule.sourceTabId) ? schedule.sourceTabId : null,
    sourceTabUrl: typeof schedule.sourceTabUrl === "string" ? schedule.sourceTabUrl : "",
    status,
    attempts: Math.max(0, Number(schedule.attempts) || 0),
    sentAt: normalizeTimestamp(schedule.sentAt, 0),
    failedAt: normalizeTimestamp(schedule.failedAt, 0),
    startedAt: normalizeTimestamp(schedule.startedAt, 0),
    lastExecutionId: typeof schedule.lastExecutionId === "string" ? schedule.lastExecutionId : "",
    lockExpiresAt: normalizeTimestamp(schedule.lockExpiresAt, 0),
    lastError: typeof schedule.lastError === "string" ? schedule.lastError : "",
    executionNote: typeof schedule.executionNote === "string" ? schedule.executionNote : "",
    logEntries: normalizeLogEntries(schedule.logEntries)
  };
}

function normalizePresetAsset(presetAsset) {
  if (!presetAsset || typeof presetAsset !== "object") {
    return null;
  }

  const id = typeof presetAsset.id === "string" ? presetAsset.id.trim() : "";
  const label = typeof presetAsset.label === "string" ? presetAsset.label.trim() : "";
  const path = typeof presetAsset.path === "string" ? presetAsset.path.trim().replace(/^\/+/, "") : "";
  const name =
    typeof presetAsset.name === "string" && presetAsset.name.trim()
      ? presetAsset.name.trim()
      : extractFileNameFromPath(path);

  if (!id || !label || !path || path.includes("..")) {
    return null;
  }

  return {
    id,
    label,
    path,
    name
  };
}

function normalizeStatus(status) {
  const supported = new Set(["scheduled", "running", "failed", "sent"]);
  return supported.has(status) ? status : "failed";
}

function normalizeTimestamp(value, fallback = Date.now()) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function alarmNameFor(id) {
  return `${ALARM_PREFIX}${id}`;
}

function createId() {
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function extractFileNameFromPath(path) {
  return String(path || "").split("/").filter(Boolean).pop() || "Anh-mau";
}

function inferMimeTypeFromName(filename) {
  const normalized = String(filename || "").toLowerCase();
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (normalized.endsWith(".webp")) {
    return "image/webp";
  }
  if (normalized.endsWith(".gif")) {
    return "image/gif";
  }
  return "image/png";
}

function createLogEntry(step, message, level = "info", at = Date.now()) {
  return {
    id: createId(),
    at: normalizeTimestamp(at),
    step: typeof step === "string" ? step.trim() : "",
    message: typeof message === "string" ? message.trim() : "",
    level: normalizeLogLevel(level)
  };
}

function normalizeLogEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => normalizeLogEntry(entry))
    .filter(Boolean)
    .slice(-12);
}

function normalizeLogEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const step = typeof entry.step === "string" ? entry.step.trim() : "";
  const message = typeof entry.message === "string" ? entry.message.trim() : "";
  const at = normalizeTimestamp(entry.at);

  if (!step && !message) {
    return null;
  }

  return {
    id: typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : createId(),
    at,
    step,
    message,
    level: normalizeLogLevel(entry.level)
  };
}

function appendLogEntries(entries, ...newEntries) {
  return normalizeLogEntries([...(Array.isArray(entries) ? entries : []), ...newEntries]);
}

function normalizeLogLevel(level) {
  const supported = new Set(["info", "success", "warn", "error"]);
  return supported.has(level) ? level : "info";
}

async function appendScheduleLog(scheduleId, executionId, entry) {
  const logEntry = normalizeLogEntry(entry);
  if (!logEntry) {
    return;
  }

  const schedules = await getStoredSchedules();
  const index = schedules.findIndex((schedule) => schedule.id === scheduleId);
  if (index === -1) {
    return;
  }

  if (executionId && schedules[index].lastExecutionId !== executionId) {
    return;
  }

  schedules[index] = {
    ...schedules[index],
    updatedAt: Math.max(schedules[index].updatedAt || 0, logEntry.at),
    logEntries: appendLogEntries(schedules[index].logEntries, logEntry)
  };

  await setStoredSchedules(schedules);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Khong doc duoc du lieu anh."));
    reader.readAsDataURL(blob);
  });
}

async function refreshBadge(schedules) {
  const failedCount = schedules.filter((schedule) => schedule.status === "failed").length;
  const pendingCount = schedules.filter((schedule) => schedule.status === "scheduled").length;

  if (failedCount > 0) {
    await chrome.action.setBadgeBackgroundColor({ color: "#b42318" });
    await chrome.action.setBadgeText({ text: "!" });
    return;
  }

  if (pendingCount > 0) {
    await chrome.action.setBadgeBackgroundColor({ color: "#1f6b52" });
    await chrome.action.setBadgeText({ text: String(Math.min(pendingCount, 99)) });
    return;
  }

  await chrome.action.setBadgeText({ text: "" });
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatLogDateTime(timestamp) {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
