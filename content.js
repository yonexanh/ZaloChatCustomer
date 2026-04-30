const SEARCH_TERMS = ["tim", "search"];
const SEND_TERMS = ["gui", "send"];
const REACTION_TERMS = ["thich", "like", "cam xuc", "bieu cam", "reaction", "emoji"];
const COMPOSER_TERMS = ["tin nhan", "nhap", "message", "chat"];
const GENERIC_CONVERSATION_LABELS = [
  "thong tin hoi thoai",
  "thong tin nhom",
  "chi tiet hoi thoai",
  "chi tiet nhom",
  "thanh vien",
  "anh video",
  "anh va video",
  "file",
  "link",
  "tai lieu",
  "ghi chu",
  "media",
  "profile",
  "conversation info"
];

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleMessage(message)
    .then((response) => sendResponse(response))
    .catch((error) => {
      console.error("content message failed", error);
      sendResponse({ ok: false, error: error.message || "Unexpected error" });
    });

  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "PING":
      return { ok: true };
    case "CAPTURE_CONTEXT":
      return captureContext();
    case "PREPARE_IMAGE_UPLOAD":
      return prepareImageUpload(message.payload);
    case "GET_ATTACHMENT_TRIGGER_POINTS":
      return getAttachmentTriggerPoints(message.payload);
    case "GET_ATTACHMENT_OPTION_POINTS":
      return getAttachmentOptionPoints(message.payload);
    case "WAIT_FOR_IMAGE_READY":
      return waitForImageReady(message.payload);
    case "EXECUTE_SCHEDULE":
      return executeSchedule(message.payload);
    default:
      return { ok: false, error: "Unsupported message type" };
  }
}

function captureContext() {
  const editor = getComposerElement();
  return {
    ok: true,
    conversationName: getCurrentConversationName(),
    draftMessage: editor ? readEditableValue(editor) : ""
  };
}

async function executeSchedule(payload) {
  const executionId = typeof payload?.executionId === "string" ? payload.executionId.trim() : "";
  const conversationName = cleanText(payload?.conversationName || "");
  const message = typeof payload?.message === "string" ? payload.message.trim() : "";
  const imageAttachment = normalizeImageAttachment(payload?.imageAttachment);
  const existingAttachment = Boolean(payload?.existingAttachment);
  const skipConversationSelect = Boolean(payload?.skipConversationSelect);
  const attachmentFileName = cleanText(payload?.attachmentFileName || imageAttachment?.name || "");

  if (!executionId) {
    throw new Error("Thieu executionId.");
  }

  if (!conversationName) {
    throw new Error("Khong co ten cuoc tro chuyen.");
  }

  if (!message && !imageAttachment && !existingAttachment) {
    throw new Error("Khong co noi dung de gui.");
  }

  await waitForPageReady();
  if (!skipConversationSelect) {
    await selectConversation(conversationName);
    await sleep(600);
  }

  let editor = await waitForComposer();
  if (composerLooksBusy(editor, { ignoreAttachment: existingAttachment })) {
    throw new Error("O chat dang co ban nhap hoac anh cho gui. Hay xoa thu cong roi thu lai.");
  }

  const beforeCount = countMessageOccurrences(message, editor);
  const beforeMediaCount = countRecentChatMediaOccurrences(editor);
  let attachmentState = null;

  if (imageAttachment) {
    attachmentState = await attachImageToComposer(editor, imageAttachment);
    if (!attachmentState?.attached) {
      throw new Error(`Khong dinh kem duoc anh: ${attachmentState?.detail || "khong ro ly do"}`);
    }

    await sleep(300);
    editor = (await refreshComposerTarget(editor, 1_000)) || editor;
  } else if (existingAttachment) {
    attachmentState = {
      attached: true,
      fileName: attachmentFileName,
      detail: "ảnh đã nạp sẵn trong ô chat",
      initialProbe: createAttachmentProbe(editor, attachmentFileName)
    };

    if (!attachmentProbeHasIndicators(attachmentState.initialProbe)) {
      throw new Error("Khong thay anh da nap san trong o chat.");
    }
  }

  if (message) {
    const inserted = await ensureMessageInserted(editor, message);
    if (!inserted) {
      throw new Error("Khong nhap duoc noi dung vao o soan.");
    }

    await sleep(250);
    editor = (await refreshComposerTarget(editor, 800)) || editor;
  }

  const sendButton = await waitForSendButtonReady(editor, 2_500);
  let sendMethod = "enter";

  if (sendButton) {
    clickElement(sendButton);
    sendMethod = "button";
  } else {
    await triggerEnterSend(editor);
  }

  const verification = await waitForSendVerification(
    editor,
    {
      message,
      previousCount: beforeCount,
      previousMediaCount: beforeMediaCount,
      attachmentState
    },
    8_500
  );

  if (!verification.verified) {
    throw new Error(`Da thu gui bang ${sendMethod === "button" ? "nut Gui" : "Enter"} nhung ${verification.note}.`);
  }

  return {
    ok: true,
    note: [
      sendMethod === "button" ? "đã bấm nút Gửi" : "đã gửi bằng Enter",
      attachmentState?.detail,
      verification.note
    ]
      .filter(Boolean)
      .join("; ")
  };
}

async function prepareImageUpload(payload) {
  await waitForPageReady();

  if (payload?.conversationName) {
    await selectConversation(payload.conversationName);
    await sleep(600);
  }

  const attachmentFileName = cleanText(payload?.attachmentFileName || "");
  const editor = await waitForComposer();
  if (composerLooksBusy(editor)) {
    throw new Error("O chat dang co ban nhap hoac anh cho gui. Hay xoa thu cong roi thu lai.");
  }

  focusElementIfPossible(editor);
  if (editor.isContentEditable) {
    moveCaretToEnd(editor);
  }

  return {
    ok: true,
    attachmentProbe: createAttachmentProbe(editor, attachmentFileName),
    recentMediaCount: countRecentChatMediaOccurrences(editor)
  };
}

async function getAttachmentTriggerPoints(payload) {
  await waitForPageReady();

  if (payload?.conversationName && !payload?.skipConversationSelect) {
    await selectConversation(payload.conversationName);
    await sleep(500);
  }

  const editor = await waitForComposer();
  return {
    ok: true,
    points: elementsToClickablePoints(findAttachmentTriggers(editor).slice(0, 8))
  };
}

async function getAttachmentOptionPoints(payload) {
  await waitForPageReady();

  if (payload?.conversationName && !payload?.skipConversationSelect) {
    await selectConversation(payload.conversationName);
    await sleep(300);
  }

  const editor = await waitForComposer();
  const triggers = findAttachmentTriggers(editor);
  return {
    ok: true,
    points: elementsToClickablePoints(findAttachmentNestedOptions(editor, null, triggers).slice(0, 8))
  };
}

async function waitForImageReady(payload) {
  await waitForPageReady();

  if (payload?.conversationName && !payload?.skipConversationSelect) {
    await selectConversation(payload.conversationName);
    await sleep(400);
  }

  const attachmentFileName = cleanText(payload?.attachmentFileName || "");
  const baselineProbe =
    payload?.attachmentProbe && typeof payload.attachmentProbe === "object" ? payload.attachmentProbe : null;
  const baselineMediaCount = Number(payload?.recentMediaCount) || 0;
  const timeoutMs = Number.isFinite(Number(payload?.timeoutMs))
    ? Math.min(Math.max(Number(payload.timeoutMs), 500), 15_000)
    : 8_000;
  const startedAt = Date.now();
  let editor = getComposerElement();

  while (Date.now() - startedAt < timeoutMs) {
    const activeEditor = resolveLiveComposerTarget(editor);
    if (activeEditor) {
      const probe = createAttachmentProbe(activeEditor, attachmentFileName);
      if (baselineProbe ? didAttachmentPreviewAppear(activeEditor, attachmentFileName, baselineProbe) : attachmentProbeHasIndicators(probe)) {
        return {
          ok: true,
          status: "attached",
          attachmentProbe: probe,
          recentMediaCount: countRecentChatMediaOccurrences(activeEditor)
        };
      }
    }

    const currentMediaCount = countRecentChatMediaOccurrences(activeEditor || editor);
    if (currentMediaCount > baselineMediaCount) {
      return {
        ok: true,
        status: "delivered",
        recentMediaCount: currentMediaCount
      };
    }

    await sleep(180);
    editor = (await refreshComposerTarget(activeEditor || editor, 300)) || getComposerElement() || activeEditor || editor;
  }

  return {
    ok: false,
    error: baselineProbe
      ? "Khong thay anh duoc nap vao o chat hoac xuat hien trong khung chat"
      : "Khong thay anh xuat hien trong o chat"
  };
}

async function waitForPageReady(timeoutMs = 20_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (getComposerElement() || getSearchElement()) {
      return;
    }
    await sleep(400);
  }

  throw new Error("Khong thay giao dien chat. Hay dang nhap Zalo Web truoc.");
}

async function selectConversation(name, timeoutMs = 10_000) {
  const currentName = getCurrentConversationName() || getConversationNameFromPageTitle();
  if (isTextMatch(currentName, name)) {
    return;
  }

  const searchElement = await waitForSearchElement();
  if (!searchElement) {
    throw new Error("Khong tim thay o tim cuoc tro chuyen.");
  }

  await setEditableValue(searchElement, name);
  await sleep(450);

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const row = findConversationRow(name);
    if (row) {
      clickElement(row);
      await sleep(850);
      return;
    }
    await sleep(300);
  }

  throw new Error(`Khong tim thay cuoc tro chuyen "${name}".`);
}

async function waitForComposer(timeoutMs = 12_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const editor = getComposerElement();
    if (editor) {
      return editor;
    }
    await sleep(250);
  }

  throw new Error("Khong tim thay o soan tin nhan.");
}

async function waitForSearchElement(timeoutMs = 8_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const searchElement = getSearchElement();
    if (searchElement) {
      return searchElement;
    }
    await sleep(250);
  }

  return null;
}

function composerLooksBusy(editor, options = {}) {
  const draftMessage = cleanText(readEditableValue(editor));
  if (draftMessage) {
    return true;
  }

  if (options.ignoreAttachment) {
    return false;
  }

  return hasPendingAttachmentPreview(editor);
}

function hasPendingAttachmentPreview(editor) {
  if (!editor) {
    return false;
  }

  const editorRect = editor.getBoundingClientRect();
  const scope = editor.closest("footer,form,section,div") || document;

  const hasChosenFiles = queryAllDeep('input[type="file"]', scope).some((input) => {
    return input instanceof HTMLInputElement && input.files?.length;
  });
  if (hasChosenFiles) {
    return true;
  }

  return queryAllDeep(
    "img,canvas,video,picture,figure,[style*='background-image'],[style*='background: url'],[style*='background:url']",
    scope
  ).some((element) => {
    if (!(element instanceof HTMLElement) || !isVisible(element)) {
      return false;
    }

    if (element.closest("aside,nav,header")) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return (
      rect.width >= 56 &&
      rect.height >= 56 &&
      rect.bottom >= editorRect.top - 220 &&
      rect.top <= editorRect.bottom + 140 &&
      rect.left >= editorRect.left - 48 &&
      rect.right <= window.innerWidth - 8
    );
  });
}

async function attachImageToComposer(editor, imageAttachment) {
  const baselineProbe = createAttachmentProbe(editor, imageAttachment.name);
  const file = dataUrlToFile(imageAttachment);
  const pasteResult = await attachImageByPaste(editor, file, imageAttachment.name, baselineProbe);

  if (pasteResult.attached) {
    return buildAttachmentState(editor, imageAttachment.name, pasteResult.detail);
  }

  const directResult = await tryFileInputs(findBestAttachmentInputs(editor), editor, file, imageAttachment.name, baselineProbe);

  if (directResult.attached) {
    return buildAttachmentState(editor, imageAttachment.name, directResult.detail);
  }

  const triggers = findAttachmentTriggers(editor);
  const diagnostics = [pasteResult.detail, directResult.detail, `thay ${triggers.length} nut dinh kem`];

  for (const [index, trigger] of triggers.slice(0, 6).entries()) {
    clickElement(trigger);
    await sleep(320);

    const triggerInputs = mergeUniqueElements(findLinkedFileInputs(trigger), findBestAttachmentInputs(editor));
    const triggerResult = await tryFileInputs(triggerInputs, editor, file, imageAttachment.name, baselineProbe);
    if (triggerResult.attached) {
      return buildAttachmentState(editor, imageAttachment.name, `sau nut dinh kem ${index + 1}: ${triggerResult.detail}`);
    }

    diagnostics.push(`nut ${index + 1}: ${triggerResult.detail}`);

    const nestedOptions = findAttachmentNestedOptions(editor, trigger, triggers);
    for (const [optionIndex, option] of nestedOptions.slice(0, 6).entries()) {
      clickElement(option);
      await sleep(320);

      const nestedInputs = mergeUniqueElements(findLinkedFileInputs(option), findBestAttachmentInputs(editor));
      const nestedResult = await tryFileInputs(nestedInputs, editor, file, imageAttachment.name, baselineProbe);
      if (nestedResult.attached) {
        return buildAttachmentState(
          editor,
          imageAttachment.name,
          `nut ${index + 1}, lua chon ${optionIndex + 1}: ${nestedResult.detail}`
        );
      }

      diagnostics.push(`nut ${index + 1}, lua chon ${optionIndex + 1}: ${nestedResult.detail}`);
    }
  }

  return {
    attached: false,
    detail: diagnostics.filter(Boolean).join("; ")
  };
}

async function attachImageByPaste(editor, file, fileName, baselineProbe) {
  editor.focus();
  if (editor.isContentEditable) {
    moveCaretToEnd(editor);
  }

  const transfer = createFileTransfer(file);
  const targets = listAttachmentEventTargets(editor);
  let attempts = 0;

  for (const target of targets) {
    attempts += 1;
    dispatchClipboardLikeEvent(target, "paste", transfer);
    if (await waitForAttachmentPreview(editor, fileName, baselineProbe, 1_600)) {
      return {
        attached: true,
        detail: `paste thanh cong o ${describeEventTarget(target)}`
      };
    }

    attempts += 1;
    dispatchPasteInputEvent(target, transfer, "beforeinput");
    if (await waitForAttachmentPreview(editor, fileName, baselineProbe, 1_200)) {
      return {
        attached: true,
        detail: `beforeinput thanh cong o ${describeEventTarget(target)}`
      };
    }

    attempts += 1;
    dispatchPasteInputEvent(target, transfer, "input");
    if (await waitForAttachmentPreview(editor, fileName, baselineProbe, 1_200)) {
      return {
        attached: true,
        detail: `input paste thanh cong o ${describeEventTarget(target)}`
      };
    }
  }

  for (const target of targets) {
    attempts += 1;
    dispatchDropSequence(target, transfer);
    if (await waitForAttachmentPreview(editor, fileName, baselineProbe, 1_500)) {
      return {
        attached: true,
        detail: `drop thanh cong o ${describeEventTarget(target)}`
      };
    }
  }

  return {
    attached: false,
    detail: `da thu ${attempts} luot paste/drop tren ${targets.length} dich nhung khong thay preview`
  };
}

async function tryFileInputs(inputs, editor, file, fileName, baselineProbe) {
  if (!inputs.length) {
    return {
      attached: false,
      detail: "khong thay input file"
    };
  }

  let assignedCount = 0;
  const seen = new Set();

  for (const input of inputs) {
    if (!(input instanceof HTMLInputElement) || seen.has(input)) {
      continue;
    }
    seen.add(input);

    const assigned = assignFileToInput(input, file);
    if (!assigned) {
      continue;
    }

    assignedCount += 1;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));

    const appeared = await waitForAttachmentPreview(editor, fileName, baselineProbe, 2_600);
    if (appeared) {
      return {
        attached: true,
        detail: `preview xuat hien sau input ${assignedCount}/${inputs.length}`
      };
    }
  }

  return {
    attached: false,
    detail: assignedCount
      ? `da gan file vao ${assignedCount}/${inputs.length} input nhung khong thay preview`
      : `khong gan duoc file vao ${inputs.length} input`
  };
}

function assignFileToInput(input, file) {
  const transfer = new DataTransfer();
  transfer.items.add(file);

  try {
    input.files = transfer.files;
    return input.files?.length > 0;
  } catch (_error) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files");
      descriptor?.set?.call(input, transfer.files);
      return input.files?.length > 0;
    } catch (_innerError) {
      return false;
    }
  }
}

function createFileTransfer(file) {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  return transfer;
}

function listAttachmentEventTargets(editor) {
  const candidates = [
    document.activeElement,
    editor,
    editor?.parentElement,
    editor?.parentElement?.parentElement,
    editor?.closest("footer"),
    editor?.closest("form"),
    editor?.closest("[role='textbox']"),
    editor?.closest("[role='main']"),
    document.body,
    document
  ];

  const seen = new Set();
  return candidates.filter((target) => {
    if (!target || typeof target.dispatchEvent !== "function" || seen.has(target)) {
      return false;
    }

    seen.add(target);
    return true;
  });
}

function dispatchClipboardLikeEvent(target, type, transfer) {
  let event;
  try {
    event = new ClipboardEvent(type, {
      bubbles: true,
      cancelable: true
    });
  } catch (_error) {
    event = new Event(type, {
      bubbles: true,
      cancelable: true
    });
  }

  defineLegacyClipboardProp(event, "clipboardData", transfer);
  defineLegacyClipboardProp(event, "dataTransfer", transfer);
  target.dispatchEvent(event);
}

function dispatchPasteInputEvent(target, transfer, type) {
  let event;
  try {
    event = new InputEvent(type, {
      bubbles: true,
      cancelable: true,
      inputType: "insertFromPaste"
    });
  } catch (_error) {
    event = new Event(type, {
      bubbles: true,
      cancelable: true
    });
  }

  defineLegacyClipboardProp(event, "clipboardData", transfer);
  defineLegacyClipboardProp(event, "dataTransfer", transfer);
  target.dispatchEvent(event);
}

function dispatchDropSequence(target, transfer) {
  dispatchDragLikeEvent(target, "dragenter", transfer);
  dispatchDragLikeEvent(target, "dragover", transfer);
  dispatchDragLikeEvent(target, "drop", transfer);
}

function dispatchDragLikeEvent(target, type, transfer) {
  let event;
  try {
    event = new DragEvent(type, {
      bubbles: true,
      cancelable: true
    });
  } catch (_error) {
    event = new Event(type, {
      bubbles: true,
      cancelable: true
    });
  }

  defineLegacyClipboardProp(event, "dataTransfer", transfer);
  target.dispatchEvent(event);
}

function describeEventTarget(target) {
  if (target === document) {
    return "document";
  }
  if (target === document.body) {
    return "body";
  }
  if (!(target instanceof Element)) {
    return "node";
  }

  const parts = [target.tagName.toLowerCase()];
  if (target.id) {
    parts.push(`#${target.id}`);
  }
  if (target.getAttribute("role")) {
    parts.push(`[role=${target.getAttribute("role")}]`);
  }
  if (target.classList.length) {
    parts.push(`.${[...target.classList].slice(0, 2).join(".")}`);
  }
  return parts.join("");
}

async function waitForAttachmentPreview(editor, fileName, baselineProbe, timeoutMs = 8_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (didAttachmentPreviewAppear(editor, fileName, baselineProbe)) {
      return true;
    }

    await sleep(180);
    editor = (await refreshComposerTarget(editor, 300)) || editor;
  }

  return false;
}

function didAttachmentPreviewAppear(editor, fileName, baselineProbe) {
  const baseline = normalizeAttachmentProbe(editor, fileName, baselineProbe);
  const current = createAttachmentProbe(editor, fileName);
  return (
    current.composerCount > baseline.composerCount ||
    current.lowerMediaCount > baseline.lowerMediaCount ||
    current.fileNameCount > baseline.fileNameCount
  );
}

function buildAttachmentState(editor, fileName, detail) {
  return {
    attached: true,
    fileName,
    detail,
    initialProbe: createAttachmentProbe(editor, fileName)
  };
}

async function ensureMessageInserted(element, value) {
  if (!value) {
    return true;
  }

  const candidates = gatherMessageTargets(element);
  for (const candidate of candidates) {
    const inserted = await tryInsertMessageIntoTarget(candidate, value);
    if (inserted) {
      return true;
    }
  }

  const refreshed = await refreshComposerTarget(element, 600);
  if (refreshed && !candidates.includes(refreshed)) {
    return tryInsertMessageIntoTarget(refreshed, value);
  }

  return false;
}

async function tryInsertMessageIntoTarget(element, value) {
  if (!isEditableElement(element) || !element.isConnected) {
    return false;
  }

  await setEditableValue(element, value);
  await sleep(180);
  if (editorContainsMessage(element, value)) {
    return true;
  }

  if (element.isContentEditable && typeof document.execCommand === "function") {
    clearContentEditable(element);
    element.focus();
    document.execCommand("insertText", false, value);
    dispatchInputSequence(element, value);
    await sleep(180);
    if (editorContainsMessage(element, value)) {
      return true;
    }
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.focus();
    setNativeValue(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await sleep(180);
  }

  return editorContainsMessage(element, value);
}

async function setEditableValue(element, value) {
  element.focus();

  if ("value" in element) {
    setNativeValue(element, value);
    dispatchInputSequence(element, value);
    return;
  }

  if (element.isContentEditable) {
    clearContentEditable(element);
    const lines = String(value).split("\n");
    const fragment = document.createDocumentFragment();

    lines.forEach((line, index) => {
      fragment.appendChild(document.createTextNode(line));
      if (index < lines.length - 1) {
        fragment.appendChild(document.createElement("br"));
      }
    });

    element.replaceChildren(fragment);
    moveCaretToEnd(element);
    dispatchInputSequence(element, value);
  }
}

async function refreshComposerTarget(previousElement, timeoutMs = 2_500) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const candidates = gatherMessageTargets(previousElement);
    if (candidates.length) {
      const freshCandidate = candidates.find((candidate) => candidate !== previousElement && candidate.isConnected);
      return freshCandidate || candidates[0];
    }
    await sleep(120);
  }

  return null;
}

async function waitForSendButtonReady(editor, timeoutMs = 2_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const button = getSendButton(editor);
    if (button) {
      return button;
    }

    await sleep(120);
    editor = (await refreshComposerTarget(editor, 250)) || editor;
  }

  return null;
}

async function waitForSendVerification(editor, options, timeoutMs = 5_500) {
  const message = options?.message || "";
  const previousCount = Number(options?.previousCount) || 0;
  const previousMediaCount = Number(options?.previousMediaCount) || 0;
  const attachmentState = options?.attachmentState || null;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const activeEditor = resolveLiveComposerTarget(editor);
    const messageCleared = !message || !editorContainsMessage(activeEditor, message);
    const attachmentCleared = !attachmentState || isAttachmentCleared(activeEditor, attachmentState);
    const currentMediaCount = attachmentState ? countRecentChatMediaOccurrences(activeEditor) : 0;

    if (attachmentState && attachmentCleared && messageCleared) {
      return { verified: true, note: "preview anh va noi dung da roi khoi o soan" };
    }

    if (attachmentState && !message && currentMediaCount > previousMediaCount) {
      return { verified: true, note: "thay anh moi xuat hien trong khung chat" };
    }

    if (!attachmentState && message && messageCleared) {
      return { verified: true, note: "o soan da duoc xoa" };
    }

    const currentCount = message ? countMessageOccurrences(message, activeEditor) : 0;
    if (message && currentCount > previousCount && attachmentCleared) {
      return { verified: true, note: "thay tin nhan moi xuat hien trong khung chat" };
    }

    await sleep(180);
  }

  return { verified: false, note: "khong xac minh duoc bang DOM" };
}

function isAttachmentCleared(editor, attachmentState) {
  if (!attachmentState?.initialProbe) {
    return true;
  }

  const current = createAttachmentProbe(editor, attachmentState.fileName || "");
  return (
    current.composerCount < attachmentState.initialProbe.composerCount ||
    current.lowerMediaCount < attachmentState.initialProbe.lowerMediaCount ||
    current.fileNameCount < attachmentState.initialProbe.fileNameCount
  );
}

function resolveLiveComposerTarget(preferredElement) {
  const candidates = gatherMessageTargets(preferredElement);
  return candidates[0] || preferredElement || null;
}

function createAttachmentProbe(editor, fileName = "") {
  return {
    composerCount: countComposerAttachmentIndicators(editor, fileName),
    lowerMediaCount: countLowerMediaIndicators(editor),
    fileNameCount: countVisibleFileNameIndicators(editor, fileName)
  };
}

function attachmentProbeHasIndicators(probe) {
  return (
    (Number(probe?.composerCount) || 0) > 0 ||
    (Number(probe?.lowerMediaCount) || 0) > 0 ||
    (Number(probe?.fileNameCount) || 0) > 0
  );
}

function normalizeAttachmentProbe(editor, fileName, baselineProbe) {
  if (baselineProbe && typeof baselineProbe === "object") {
    return {
      composerCount: Number(baselineProbe.composerCount) || 0,
      lowerMediaCount: Number(baselineProbe.lowerMediaCount) || 0,
      fileNameCount: Number(baselineProbe.fileNameCount) || 0
    };
  }

  return {
    composerCount: countComposerAttachmentIndicators(editor, fileName),
    lowerMediaCount: countLowerMediaIndicators(editor),
    fileNameCount: countVisibleFileNameIndicators(editor, fileName)
  };
}

function countComposerAttachmentIndicators(editor, fileName = "") {
  if (!editor) {
    return 0;
  }

  const editorRect = editor.getBoundingClientRect();
  const normalizedFileName = normalizeText(fileName);

  const mediaCount = queryAllDeep(
    "img,canvas,video,picture,figure,[style*='background-image'],[style*='background: url'],[style*='background:url']"
  ).filter((element) => {
    if (!(element instanceof HTMLElement) || !isVisible(element)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return (
      rect.bottom <= editorRect.bottom + 120 &&
      rect.top >= editorRect.top - 460 &&
      rect.left >= editorRect.left - 48 &&
      rect.right <= window.innerWidth - 8 &&
      rect.width >= 28 &&
      rect.height >= 28
    );
  }).length;

  const fileInputCount = queryAllDeep('input[type="file"]').filter((input) => {
    if (!(input instanceof HTMLInputElement)) {
      return false;
    }

    const files = input.files;
    if (!files?.length) {
      return false;
    }

    if (!normalizedFileName) {
      return true;
    }

    return [...files].some((file) => normalizeText(file?.name || "") === normalizedFileName);
  }).length;

  const fileNameCount = normalizedFileName
    ? queryAllDeep("div,span,p,strong").filter((element) => {
        if (!(element instanceof HTMLElement) || !isVisible(element)) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        if (
          rect.bottom > editorRect.bottom + 120 ||
          rect.top < editorRect.top - 460 ||
          rect.left < editorRect.left - 48
        ) {
          return false;
        }

        const text = normalizeText(cleanText(element.innerText || element.textContent || ""));
        return text.includes(normalizedFileName);
      }).length
    : 0;

  return mediaCount + fileInputCount + fileNameCount;
}

function countLowerMediaIndicators(editor) {
  const editorRect = editor?.getBoundingClientRect?.();
  const thresholdTop = editorRect ? Math.max(0, editorRect.top - 360) : window.innerHeight * 0.42;

  return queryAllDeep(
    "img,canvas,video,picture,figure,[style*='background-image'],[style*='background: url'],[style*='background:url']"
  ).filter((element) => {
    if (!(element instanceof HTMLElement) || !isVisible(element)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.bottom >= thresholdTop && rect.top <= window.innerHeight - 4 && rect.width >= 24 && rect.height >= 24;
  }).length;
}

function countVisibleFileNameIndicators(editor, fileName = "") {
  const normalizedFileName = normalizeText(fileName);
  if (!normalizedFileName) {
    return 0;
  }

  const editorRect = editor?.getBoundingClientRect?.();
  const thresholdTop = editorRect ? Math.max(0, editorRect.top - 360) : window.innerHeight * 0.42;

  return queryAllDeep("div,span,p,strong").filter((element) => {
    if (!(element instanceof HTMLElement) || !isVisible(element)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.bottom < thresholdTop || rect.top > window.innerHeight - 4) {
      return false;
    }

    const text = normalizeText(cleanText(element.innerText || element.textContent || ""));
    return text.includes(normalizedFileName);
  }).length;
}

function countMessageOccurrences(message, editor) {
  const target = normalizeText(message);
  if (!target) {
    return 0;
  }

  const editorRect = editor?.getBoundingClientRect?.() || null;

  return [...document.querySelectorAll("div,span,p")]
    .filter((element) => {
      if (!(element instanceof HTMLElement) || !isVisible(element)) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      if (rect.top < 48) {
        return false;
      }

      const inSidebarPreview = rect.right <= window.innerWidth * 0.34;
      const inChatArea = rect.left >= window.innerWidth * 0.2 && (!editorRect || rect.bottom <= editorRect.top - 4);

      if (!inSidebarPreview && !inChatArea) {
        return false;
      }

      const text = normalizeText(cleanText(element.innerText || element.textContent || ""));
      if (!matchesSentMessageText(text, target, inSidebarPreview)) {
        return false;
      }

      return ![...element.children].some((child) => {
        const childText = normalizeText(cleanText(child.innerText || child.textContent || ""));
        return matchesSentMessageText(childText, target, inSidebarPreview);
      });
    })
    .length;
}

function countRecentChatMediaOccurrences(editor) {
  const editorRect = editor?.getBoundingClientRect?.() || null;
  const thresholdTop = editorRect ? Math.max(48, editorRect.top - 520) : window.innerHeight * 0.2;
  const thresholdBottom = editorRect ? editorRect.top + 24 : window.innerHeight - 120;

  return queryAllDeep(
    "img,canvas,video,picture,figure,[style*='background-image'],[style*='background: url'],[style*='background:url']"
  ).filter((element) => {
    if (!(element instanceof HTMLElement) || !isVisible(element)) {
      return false;
    }

    if (element.closest("footer,form,[role='textbox'],textarea,input,[contenteditable]")) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.bottom < thresholdTop || rect.top > thresholdBottom) {
      return false;
    }

    return rect.left >= window.innerWidth * 0.2 && rect.width >= 24 && rect.height >= 24;
  }).length;
}

function matchesSentMessageText(text, target, allowPreviewContains) {
  if (!text || !target) {
    return false;
  }

  if (text === target) {
    return true;
  }

  if (!allowPreviewContains) {
    return false;
  }

  return text.includes(target) && text.length <= target.length + 20;
}

function gatherMessageTargets(preferredElement) {
  const seen = new Set();
  const results = [];

  const addCandidate = (element) => {
    if (!isEditableElement(element) || !isVisible(element) || seen.has(element)) {
      return;
    }
    seen.add(element);
    results.push(element);
  };

  addCandidate(preferredElement);
  addCandidate(document.activeElement);
  addCandidate(getComposerElement());

  for (const candidate of getComposerCandidates().slice(0, 6)) {
    addCandidate(candidate);
  }

  return results;
}

function getComposerElement() {
  return getComposerCandidates()[0] || null;
}

function getSearchElement() {
  const controls = getEditableControls();
  const candidates = controls.filter((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.left > window.innerWidth * 0.45 || rect.top > window.innerHeight * 0.45) {
      return false;
    }

    return containsSearchMetadata(element) || rect.top < 180;
  });

  candidates.sort((left, right) => {
    const leftRect = left.getBoundingClientRect();
    const rightRect = right.getBoundingClientRect();
    return leftRect.top - rightRect.top || leftRect.left - rightRect.left;
  });

  return candidates[0] || null;
}

function getComposerCandidates() {
  const controls = [...getEditableControls(), ...getComposerFallbackControls()];
  const uniqueControls = [...new Set(controls)];
  const candidates = uniqueControls.filter((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.bottom < window.innerHeight * 0.45) {
      return false;
    }
    if (containsSearchMetadata(element)) {
      return false;
    }
    return true;
  });

  candidates.sort((left, right) => {
    const leftRect = left.getBoundingClientRect();
    const rightRect = right.getBoundingClientRect();
    return rightRect.bottom - leftRect.bottom || leftRect.left - rightRect.left;
  });

  return candidates;
}

function getEditableControls() {
  return queryAllDeep("textarea,input,[contenteditable],[role='textbox']").filter((element) => {
    if (!isEditableElement(element) || !isVisible(element)) {
      return false;
    }

    if (element.getAttribute("contenteditable") === "false") {
      return false;
    }

    const type = element.getAttribute("type");
    if (type && ["hidden", "checkbox", "radio", "submit"].includes(type.toLowerCase())) {
      return false;
    }

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (element.disabled || element.readOnly) {
        return false;
      }
    }

    return true;
  });
}

function getComposerFallbackControls() {
  const fallbackRoots = queryAllDeep("footer,form,section,div").filter((element) => {
    if (!(element instanceof HTMLElement) || !isVisible(element)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.bottom < window.innerHeight * 0.55) {
      return false;
    }

    return containsComposerMetadata(element);
  });

  const results = [];
  for (const root of fallbackRoots) {
    const resolved = resolveEditableElement(root);
    if (resolved && !results.includes(resolved)) {
      results.push(resolved);
    }
  }

  return results;
}

function resolveEditableElement(element) {
  if (!(element instanceof HTMLElement)) {
    return null;
  }

  if (isEditableElement(element) && isVisible(element) && element.getAttribute("contenteditable") !== "false") {
    return element;
  }

  const nested = [...element.querySelectorAll("textarea,input,[contenteditable],[role='textbox']")].find((candidate) => {
    return (
      candidate instanceof HTMLElement &&
      isEditableElement(candidate) &&
      isVisible(candidate) &&
      candidate.getAttribute("contenteditable") !== "false"
    );
  });

  return nested || null;
}

function getSendButton(editor) {
  const editorRect = editor?.getBoundingClientRect?.() || null;
  const editorCenterY = editorRect ? editorRect.top + editorRect.height / 2 : window.innerHeight * 0.85;
  const selectorCandidates = [
    'button[aria-label*="Gui" i]',
    'button[aria-label*="Gửi" i]',
    'button[title*="Gui" i]',
    'button[title*="Gửi" i]',
    '[role="button"][aria-label*="Gui" i]',
    '[role="button"][aria-label*="Gửi" i]',
    'button[data-testid*="send" i]',
    '[role="button"][data-testid*="send" i]'
  ];

  for (const selector of selectorCandidates) {
    const buttons = [...document.querySelectorAll(selector)].filter((button) => {
      if (!(button instanceof HTMLElement) || !isVisible(button) || looksLikeReactionButton(button)) {
        return false;
      }

      if (!editorRect) {
        return true;
      }

      return isLikelySendButton(button, editorRect, editorCenterY);
    });

    if (buttons.length) {
      if (!editorRect) {
        return buttons[0];
      }

      buttons.sort((left, right) => {
        return scoreSendButtonCandidate(right, editorRect, editorCenterY) - scoreSendButtonCandidate(left, editorRect, editorCenterY);
      });
      return buttons[0];
    }
  }

  const nearbyButton = findSendButtonNearEditor(editor);
  if (nearbyButton) {
    return nearbyButton;
  }

  return null;
}

function findSendButtonNearEditor(editor) {
  if (!editor) {
    return null;
  }

  const editorRect = editor.getBoundingClientRect();
  const editorCenterY = editorRect.top + editorRect.height / 2;
  const candidates = new Set();

  for (const node of document.querySelectorAll("button,[role='button'],[tabindex],a,div,span,svg,img,path")) {
    const candidate = toPotentialClickable(node);
    if (candidate && isLikelySendButton(candidate, editorRect, editorCenterY)) {
      candidates.add(candidate);
    }
  }

  const ranked = [...candidates].sort((left, right) => {
    return scoreSendButtonCandidate(right, editorRect, editorCenterY) - scoreSendButtonCandidate(left, editorRect, editorCenterY);
  });

  return ranked[0] || null;
}

function isLikelySendButton(element, editorRect, editorCenterY) {
  if (!(element instanceof HTMLElement) || !isVisible(element) || looksLikeReactionButton(element)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width < 16 || rect.height < 16 || rect.width > 120 || rect.height > 120) {
    return false;
  }

  const sameBand = rect.bottom >= editorRect.top - 18 && rect.top <= editorRect.bottom + 18;
  const rightSide = rect.left >= editorRect.left + editorRect.width * 0.74 || rect.right >= window.innerWidth * 0.82;

  if (!sameBand || !rightSide) {
    return false;
  }

  const metadata = normalizeText(readTextMetadata(element));
  const hasGraphic = Boolean(element.querySelector("svg,img,path"));
  const verticalDistance = Math.abs(rect.top + rect.height / 2 - editorCenterY);

  if (verticalDistance > Math.max(36, editorRect.height)) {
    return false;
  }

  if (SEND_TERMS.some((term) => metadata.includes(term))) {
    return true;
  }

  return hasGraphic || isButtonLikeElement(element);
}

function scoreSendButtonCandidate(element, editorRect, editorCenterY) {
  const rect = element.getBoundingClientRect();
  const metadata = normalizeText(readTextMetadata(element));
  const hasGraphic = Boolean(element.querySelector("svg,img,path"));
  const centerY = rect.top + rect.height / 2;
  let score = 0;

  score += rect.right * 2;
  score -= Math.abs(centerY - editorCenterY) * 3;
  score -= Math.abs(rect.top - editorRect.top);

  if (SEND_TERMS.some((term) => metadata.includes(term))) {
    score += 1_000;
  }
  if (hasGraphic) {
    score += 220;
  }
  if (isButtonLikeElement(element)) {
    score += 120;
  }

  return score;
}

function findBestAttachmentInputs(editor) {
  const editorRect = editor?.getBoundingClientRect?.();
  const inputs = queryAllDeep('input[type="file"]').filter((input) => input instanceof HTMLInputElement && !input.disabled);

  return inputs
    .map((input, index) => ({
      input,
      score: scoreAttachmentInput(input, editorRect, index)
    }))
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.input);
}

function scoreAttachmentInput(input, editorRect, index) {
  const accept = normalizeText(input.getAttribute("accept") || "");
  let score = 50 - index;

  if (!accept || accept.includes("image")) {
    score += 400;
  }
  if (accept.includes("video")) {
    score -= 120;
  }

  const anchor = getVisibleAnchorRect(input);
  if (anchor && editorRect) {
    if (anchor.bottom >= editorRect.top - 220 && anchor.top <= editorRect.bottom + 40) {
      score += 260;
    }
    if (anchor.left <= editorRect.left + 120) {
      score += 120;
    }
  } else {
    score += 40;
  }

  return score;
}

function getVisibleAnchorRect(element) {
  let current = element.parentElement;
  let depth = 0;

  while (current && current !== document.body && depth < 6) {
    const rect = current.getBoundingClientRect();
    if (rect.width >= 6 && rect.height >= 6) {
      return rect;
    }
    current = current.parentElement;
    depth += 1;
  }

  return null;
}

function findAttachmentTriggers(editor) {
  if (!editor) {
    return [];
  }

  const editorRect = editor.getBoundingClientRect();
  return queryAllDeep("button,[role='button'],[tabindex],a,div,span,label")
    .filter((element) => {
      if (!(element instanceof HTMLElement) || !isVisible(element)) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      if (rect.right > editorRect.left + 120 || rect.left < editorRect.left - 280) {
        return false;
      }
      if (rect.bottom < editorRect.top - 40 || rect.top > editorRect.bottom + 140) {
        return false;
      }

      const metadata = normalizeText(readTextMetadata(element));
      const hasGraphic = Boolean(element.querySelector("svg,img,path"));
      return (
        metadata.includes("anh") ||
        metadata.includes("image") ||
        metadata.includes("file") ||
        metadata.includes("tep") ||
        metadata.includes("dinh kem") ||
        hasGraphic
      );
    })
    .sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return leftRect.left - rightRect.left || leftRect.top - rightRect.top;
    });
}

function findAttachmentNestedOptions(editor, trigger, existingTriggers = []) {
  if (!editor) {
    return [];
  }

  const editorRect = editor.getBoundingClientRect();
  const triggerRect = trigger?.getBoundingClientRect?.() || editorRect;
  const excluded = new Set(existingTriggers);

  return queryAllDeep("button,[role='button'],[tabindex],a,div,span,label,li")
    .filter((element) => {
      if (!(element instanceof HTMLElement) || !isVisible(element) || excluded.has(element) || element === trigger) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      const nearTrigger =
        rect.left >= triggerRect.left - 40 &&
        rect.right <= triggerRect.right + 280 &&
        rect.top >= triggerRect.top - 220 &&
        rect.bottom <= triggerRect.bottom + 260;
      const nearEditor =
        rect.left >= editorRect.left - 80 &&
        rect.right <= editorRect.left + 360 &&
        rect.top >= editorRect.top - 260 &&
        rect.bottom <= editorRect.bottom + 260;

      if (!nearTrigger && !nearEditor) {
        return false;
      }

      const metadata = normalizeText(readTextMetadata(element));
      const hasGraphic = Boolean(element.querySelector("svg,img,path"));
      const linkedFileInputs = findLinkedFileInputs(element);

      return (
        linkedFileInputs.length > 0 ||
        metadata.includes("anh") ||
        metadata.includes("hinh") ||
        metadata.includes("image") ||
        metadata.includes("photo") ||
        metadata.includes("upload") ||
        metadata.includes("album") ||
        metadata.includes("tep") ||
        metadata.includes("file") ||
        hasGraphic
      );
    })
    .sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return leftRect.top - rightRect.top || leftRect.left - rightRect.left;
    });
}

function findLinkedFileInputs(element) {
  if (!(element instanceof Element)) {
    return [];
  }

  const ownerDocument = element.ownerDocument || document;
  const linkedInputs = [];
  const seen = new Set();

  const addInput = (input) => {
    if (input instanceof HTMLInputElement && input.type === "file" && !seen.has(input)) {
      seen.add(input);
      linkedInputs.push(input);
    }
  };

  if (element instanceof HTMLLabelElement && element.htmlFor) {
    addInput(ownerDocument.getElementById(element.htmlFor));
  }

  if (element.getAttribute("for")) {
    addInput(ownerDocument.getElementById(element.getAttribute("for")));
  }

  for (const input of element.querySelectorAll?.('input[type="file"]') || []) {
    addInput(input);
  }

  const parent = element.parentElement;
  if (parent) {
    for (const input of parent.querySelectorAll('input[type="file"]')) {
      addInput(input);
    }
  }

  return linkedInputs;
}

function elementsToClickablePoints(elements) {
  const seen = new Set();
  return elements
    .map((element, index) => {
      if (!(element instanceof HTMLElement) || !isVisible(element)) {
        return null;
      }

      const rect = element.getBoundingClientRect();
      if (rect.width < 6 || rect.height < 6 || rect.width > 360 || rect.height > 120) {
        return null;
      }

      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.top + rect.height / 2);
      const key = `${x}:${y}`;
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        y < 0 ||
        x > window.innerWidth ||
        y > window.innerHeight ||
        seen.has(key)
      ) {
        return null;
      }
      seen.add(key);

      return {
        x,
        y,
        label: cleanText(readTextMetadata(element)).slice(0, 80) || `muc ${index + 1}`
      };
    })
    .filter(Boolean);
}

function mergeUniqueElements(...groups) {
  const results = [];
  const seen = new Set();

  for (const group of groups) {
    for (const element of group || []) {
      if (!element || seen.has(element)) {
        continue;
      }
      seen.add(element);
      results.push(element);
    }
  }

  return results;
}

function getCurrentConversationName() {
  const fromTitle = getConversationNameFromPageTitle();
  const sidebarRightEdge = getSidebarRightEdge();
  const headerStripName = getConversationNameFromHeaderStrip(sidebarRightEdge);
  if (isUsableConversationName(headerStripName)) {
    return headerStripName;
  }

  const avatarAlignedName = getConversationNameNearHeaderAvatar(sidebarRightEdge);
  if (isUsableConversationName(avatarAlignedName)) {
    return avatarAlignedName;
  }

  if (isUsableConversationName(fromTitle)) {
    return fromTitle;
  }

  return "";
}

function getConversationNameFromHeaderStrip(sidebarRightEdge) {
  const stripLeft = Math.max(sidebarRightEdge + 16, 16);
  const stripRight = Math.min(window.innerWidth - 60, stripLeft + 520);

  const candidates = queryAllDeep("h1,h2,h3,[role='heading'],strong,span,div")
    .filter(isVisible)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const text = cleanText(element.innerText || element.textContent || "");
      const fontSize = Number.parseFloat(window.getComputedStyle(element).fontSize || "0");
      return { element, rect, text, fontSize };
    })
    .filter(({ element, rect, text, fontSize }) => {
      if (!isUsableConversationName(text) || looksLikeConversationNoise(text)) {
        return false;
      }
      if (fontSize < 14 || rect.top < 0 || rect.bottom > 88) {
        return false;
      }
      if (rect.left < stripLeft || rect.right > stripRight || rect.width > 480 || rect.height > 42) {
        return false;
      }
      if (element.closest("[contenteditable='true'],[role='textbox'],textarea,input,footer,aside,nav")) {
        return false;
      }
      return true;
    })
    .sort((left, right) => {
      const leftScore = scoreHeaderNameCandidate(left, stripLeft);
      const rightScore = scoreHeaderNameCandidate(right, stripLeft);
      return rightScore - leftScore;
    });

  return candidates[0]?.text || "";
}

function getConversationNameNearHeaderAvatar(sidebarRightEdge) {
  const avatarCandidates = queryAllDeep("img,canvas,svg")
    .filter(isVisible)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return { rect };
    })
    .filter(({ rect }) => {
      return (
        rect.top >= 0 &&
        rect.top <= 88 &&
        rect.left >= Math.max(sidebarRightEdge + 8, 8) &&
        rect.left <= Math.min(sidebarRightEdge + 120, window.innerWidth * 0.42) &&
        rect.width >= 24 &&
        rect.width <= 72 &&
        rect.height >= 24 &&
        rect.height <= 72
      );
    })
    .sort((left, right) => left.rect.left - right.rect.left || left.rect.top - right.rect.top);

  if (!avatarCandidates.length) {
    return "";
  }

  const texts = queryAllDeep("h1,h2,h3,[role='heading'],strong,span,div")
    .filter(isVisible)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const text = cleanText(element.innerText || element.textContent || "");
      const fontSize = Number.parseFloat(window.getComputedStyle(element).fontSize || "0");
      return { element, rect, text, fontSize };
    })
    .filter(({ element, rect, text, fontSize }) => {
      if (!isUsableConversationName(text) || looksLikeConversationNoise(text)) {
        return false;
      }
      if (fontSize < 14 || rect.top > 88 || rect.bottom > 110 || rect.width > 480 || rect.height > 40) {
        return false;
      }
      if (element.closest("[contenteditable='true'],[role='textbox'],textarea,input,footer,aside,nav")) {
        return false;
      }
      return true;
    });

  const ranked = [];
  for (const avatar of avatarCandidates) {
    for (const candidate of texts) {
      const sameRow = candidate.rect.top >= avatar.rect.top - 10 && candidate.rect.bottom <= avatar.rect.bottom + 12;
      const nearRight = candidate.rect.left >= avatar.rect.right - 8 && candidate.rect.left <= avatar.rect.right + 420;

      if (!sameRow || !nearRight) {
        continue;
      }

      ranked.push({
        text: candidate.text,
        score:
          candidate.fontSize * 100 -
          Math.abs(candidate.rect.left - avatar.rect.right) -
          Math.abs(candidate.rect.top - avatar.rect.top) * 2
      });
    }
  }

  ranked.sort((left, right) => right.score - left.score);
  return ranked[0]?.text || "";
}

function findConversationRow(name) {
  const target = normalizeText(name);
  if (!target) {
    return null;
  }

  const textNodes = [...document.querySelectorAll("span,div,p,strong,a,li,button")]
    .filter(isVisible)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const text = normalizeText(cleanText(element.innerText || element.textContent || ""));
      return { element, rect, text };
    })
    .filter(({ rect, text }) => {
      if (!text || !text.includes(target)) {
        return false;
      }
      if (rect.left > window.innerWidth * 0.45 || rect.top < 48 || rect.height > 180 || rect.width < 48) {
        return false;
      }
      return true;
    });

  const rowCandidates = [];
  for (const candidate of textNodes) {
    const row = toClickableRow(candidate.element);
    if (!row || !isVisible(row)) {
      continue;
    }

    if (!rowCandidates.includes(row)) {
      rowCandidates.push(row);
    }
  }

  rowCandidates.sort((left, right) => {
    const leftRect = left.getBoundingClientRect();
    const rightRect = right.getBoundingClientRect();
    return leftRect.top - rightRect.top || leftRect.left - rightRect.left;
  });

  return rowCandidates[0] || null;
}

function toClickableRow(element) {
  let current = element;

  while (current && current !== document.body) {
    const rect = current.getBoundingClientRect();
    const isLikelyRow =
      rect.left < window.innerWidth * 0.45 &&
      rect.width > 120 &&
      rect.height >= 28 &&
      rect.height <= 180;

    if (
      isLikelyRow &&
      (current.matches("a,button,li,[role='button'],[tabindex]") ||
        typeof current.onclick === "function" ||
        current.getAttribute("role") === "option")
    ) {
      return current;
    }

    current = current.parentElement;
  }

  return element;
}

function readEditableValue(element) {
  if (!element) {
    return "";
  }

  if ("value" in element) {
    return element.value || "";
  }

  return cleanText(element.innerText || element.textContent || "");
}

function editorContainsMessage(element, value) {
  const actual = normalizeText(readEditableValue(element));
  const expected = normalizeText(value);
  if (!expected) {
    return actual === "";
  }
  return actual === expected || actual.includes(expected);
}

function setNativeValue(element, value) {
  const prototype = Object.getPrototypeOf(element);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

  if (descriptor?.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }
}

function dispatchInputSequence(element, value) {
  element.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      cancelable: true,
      data: value,
      inputType: "insertText"
    })
  );
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

async function triggerEnterSend(element) {
  if (!element) {
    return;
  }

  element.focus();
  const target = document.activeElement || element;
  dispatchEnterKey(target, "keydown");
  dispatchEnterKey(target, "keypress");
  dispatchEnterKey(target, "keyup");
  await sleep(120);
}

function dispatchEnterKey(target, type) {
  const event = new KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    key: "Enter",
    code: "Enter"
  });

  defineLegacyKeyboardProp(event, "keyCode", 13);
  defineLegacyKeyboardProp(event, "which", 13);
  defineLegacyKeyboardProp(event, "charCode", type === "keypress" ? 13 : 0);
  target.dispatchEvent(event);
}

function clearContentEditable(element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);

  if (typeof document.execCommand === "function") {
    document.execCommand("delete");
  }

  element.textContent = "";
}

function moveCaretToEnd(element) {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function clickElement(element) {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  const rect = element.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  const ownerDocument = element.ownerDocument || document;
  const topElement = ownerDocument.elementFromPoint?.(clientX, clientY);
  const target = toPotentialClickable(topElement) || element;

  focusElementIfPossible(target);
  dispatchPointerLikeEvent(target, "pointerdown", clientX, clientY);
  dispatchMouseLikeEvent(target, "mousedown", clientX, clientY);
  dispatchPointerLikeEvent(target, "pointerup", clientX, clientY);
  dispatchMouseLikeEvent(target, "mouseup", clientX, clientY);
  target.click();
}

function focusElementIfPossible(element) {
  if (element instanceof HTMLElement && typeof element.focus === "function") {
    element.focus({ preventScroll: true });
  }
}

function dispatchPointerLikeEvent(target, type, clientX, clientY) {
  let event;

  try {
    event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX,
      clientY
    });
  } catch (_error) {
    event = new Event(type, {
      bubbles: true,
      cancelable: true,
      composed: true
    });
  }

  target.dispatchEvent(event);
}

function dispatchMouseLikeEvent(target, type, clientX, clientY) {
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 0,
      buttons: 1,
      clientX,
      clientY
    })
  );
}

function toPotentialClickable(node) {
  let current = node instanceof Element ? node : null;
  let fallback = current instanceof Element ? current : null;
  let depth = 0;

  while (current && current !== document.body && depth < 5) {
    if (current instanceof HTMLElement && isVisible(current)) {
      fallback = current;
      const style = window.getComputedStyle(current);
      if (
        style.cursor === "pointer" ||
        current.getAttribute("role") ||
        current.hasAttribute("aria-label") ||
        current.hasAttribute("tabindex")
      ) {
        return current;
      }
    }

    if (isButtonLikeElement(current)) {
      return current;
    }

    current = current.parentElement;
    depth += 1;
  }

  return fallback instanceof Element ? fallback : node instanceof Element ? node.parentElement : null;
}

function dataUrlToFile(imageAttachment) {
  const blob = dataUrlToBlob(imageAttachment.dataUrl, imageAttachment.type);
  return new File([blob], imageAttachment.name || "schedule-image.png", {
    type: blob.type || imageAttachment.type || "image/png"
  });
}

function dataUrlToBlob(dataUrl, fallbackType = "image/png") {
  const [meta, base64] = String(dataUrl || "").split(",");
  const mimeMatch = meta.match(/data:([^;]+);base64/i);
  const mimeType = mimeMatch?.[1] || fallbackType || "image/png";
  const binary = atob(base64 || "");
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

function queryAllDeep(selector, root = document) {
  const results = [];
  const seenResults = new Set();
  const stack = [root];
  const seenRoots = new Set();

  while (stack.length) {
    const current = stack.pop();
    if (!current || seenRoots.has(current)) {
      continue;
    }
    seenRoots.add(current);

    if (typeof current.querySelectorAll === "function") {
      for (const element of current.querySelectorAll(selector)) {
        if (!seenResults.has(element)) {
          seenResults.add(element);
          results.push(element);
        }
      }

      for (const element of current.querySelectorAll("*")) {
        if (element.shadowRoot && !seenRoots.has(element.shadowRoot)) {
          stack.push(element.shadowRoot);
        }
      }

      for (const frame of current.querySelectorAll("iframe,frame")) {
        const frameRoot = getFrameSearchRoot(frame);
        if (frameRoot && !seenRoots.has(frameRoot)) {
          stack.push(frameRoot);
        }
      }
    }
  }

  return results;
}

function getFrameSearchRoot(frameElement) {
  if (!(frameElement instanceof HTMLIFrameElement || frameElement instanceof HTMLFrameElement)) {
    return null;
  }

  try {
    return frameElement.contentDocument || frameElement.contentWindow?.document || null;
  } catch (_error) {
    return null;
  }
}

function normalizeImageAttachment(imageAttachment) {
  if (!imageAttachment || typeof imageAttachment !== "object") {
    return null;
  }

  const name = typeof imageAttachment.name === "string" ? imageAttachment.name.trim() : "";
  const type = typeof imageAttachment.type === "string" ? imageAttachment.type.trim() : "";
  const dataUrl = typeof imageAttachment.dataUrl === "string" ? imageAttachment.dataUrl.trim() : "";

  if (!name || !type.startsWith("image/") || !dataUrl.startsWith("data:image/")) {
    return null;
  }

  return {
    name,
    type,
    dataUrl
  };
}

function getConversationNameFromPageTitle() {
  const title = cleanText(document.title.replace(/\s*-\s*Zalo.*$/i, ""));
  if (!title || title === "Zalo") {
    return "";
  }

  return title
    .replace(/^chat voi\s+/i, "")
    .replace(/^tro chuyen voi\s+/i, "")
    .replace(/^cuoc tro chuyen voi\s+/i, "")
    .trim();
}

function getSidebarRightEdge() {
  const searchElement = getSearchElement();
  if (searchElement) {
    const rect = searchElement.getBoundingClientRect();
    if (rect.width > 40) {
      return rect.right;
    }
  }

  return Math.max(180, window.innerWidth * 0.18);
}

function scoreHeaderNameCandidate(candidate, stripLeft) {
  let score = candidate.fontSize * 100;
  score -= Math.abs(candidate.rect.left - (stripLeft + 52));
  score -= Math.abs(candidate.rect.top - 20) * 4;

  if (candidate.element.closest("header")) {
    score += 220;
  }
  if (candidate.text.length <= 24) {
    score += 40;
  }

  return score;
}

function isUsableConversationName(value) {
  const cleaned = cleanText(value);
  if (!cleaned) {
    return false;
  }

  const normalized = normalizeText(cleaned);
  if (!normalized || normalized.length < 2) {
    return false;
  }

  return !GENERIC_CONVERSATION_LABELS.some((label) => normalized === label || normalized.includes(label));
}

function looksLikeConversationNoise(value) {
  const cleaned = cleanText(value);
  if (!cleaned) {
    return true;
  }

  const symbolChars = cleaned.match(/[\/\\:;()[\]<>_-]/g) || [];
  const letterChars = cleaned.match(/[\p{L}\p{N}]/gu) || [];
  return symbolChars.length >= 6 && symbolChars.length >= letterChars.length;
}

function containsSearchMetadata(element) {
  const metadata = normalizeText(readTextMetadata(element));
  return SEARCH_TERMS.some((term) => metadata.includes(term));
}

function containsComposerMetadata(element) {
  const metadata = normalizeText(readTextMetadata(element));
  if (!metadata) {
    return false;
  }

  return COMPOSER_TERMS.some((term) => metadata.includes(term));
}

function readTextMetadata(element) {
  return [
    element.getAttribute("placeholder"),
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.dataset?.placeholder,
    element.innerText,
    element.textContent
  ]
    .filter(Boolean)
    .join(" ");
}

function looksLikeReactionButton(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const metadata = normalizeText(
    [
      readTextMetadata(element),
      element.getAttribute("data-testid"),
      element.getAttribute("name"),
      element.id,
      typeof element.className === "string" ? element.className : ""
    ]
      .filter(Boolean)
      .join(" ")
  );
  const text = cleanText(element.innerText || element.textContent || "");
  const emojiOnly = /^(?:[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D\s])+$/u.test(text);

  if (REACTION_TERMS.some((term) => metadata.includes(term))) {
    return true;
  }

  return emojiOnly && text.length <= 4;
}

function isButtonLikeElement(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  return (
    element.matches("button,[role='button'],a") ||
    element.hasAttribute("tabindex") ||
    typeof element.onclick === "function"
  );
}

function isEditableElement(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (element.matches("textarea,input")) {
    return true;
  }

  return element.isContentEditable || element.getAttribute("role") === "textbox";
}

function isTextMatch(left, right) {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}

function findVisible(nodeList) {
  return [...nodeList].find((node) => isVisible(node)) || null;
}

function isVisible(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width < 6 || rect.height < 6) {
    return false;
  }

  const style = window.getComputedStyle(element);
  return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
}

function defineLegacyKeyboardProp(event, name, value) {
  try {
    Object.defineProperty(event, name, {
      configurable: true,
      get() {
        return value;
      }
    });
  } catch (_error) {
    // Ignore legacy prop failures.
  }
}

function defineLegacyClipboardProp(event, name, value) {
  try {
    Object.defineProperty(event, name, {
      configurable: true,
      get() {
        return value;
      }
    });
  } catch (_error) {
    // Ignore legacy prop failures.
  }
}

function normalizeText(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
