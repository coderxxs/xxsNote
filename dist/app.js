(() => {
  "use strict";

  const SAVE_DELAY = 280;
  const DEFAULT_GROUP = { id: "default", name: "默认分组", createdAt: 0 };

  const elements = {
    body: document.body,
    notesList: document.querySelector("#notesList"),
    noteCount: document.querySelector("#noteCount"),
    currentGroupLabel: document.querySelector("#currentGroupLabel"),
    groupsList: document.querySelector("#groupsList"),
    groupsToggle: document.querySelector("#groupsToggle"),
    addGroupButton: document.querySelector("#addGroupButton"),
    groupDialog: document.querySelector("#groupDialog"),
    groupForm: document.querySelector("#groupForm"),
    groupNameInput: document.querySelector("#groupNameInput"),
    cancelGroupButton: document.querySelector("#cancelGroupButton"),
    newNoteButton: document.querySelector("#newNoteButton"),
    emptyNewButton: document.querySelector("#emptyNewButton"),
    searchInput: document.querySelector("#searchInput"),
    clearSearch: document.querySelector("#clearSearch"),
    titleInput: document.querySelector("#titleInput"),
    contentInput: document.querySelector("#contentInput"),
    noteGroupSelect: document.querySelector("#noteGroupSelect"),
    createdDate: document.querySelector("#createdDate"),
    lastEditedTime: document.querySelector("#lastEditedTime"),
    paragraphCount: document.querySelector("#paragraphCount"),
    styleSelect: document.querySelector("#styleSelect"),
    formatToolbar: document.querySelector(".format-toolbar"),
    quickInsert: document.querySelector("#quickInsert"),
    editorPanel: document.querySelector("#editorPanel"),
    emptyEditor: document.querySelector("#emptyEditor"),
    characterCount: document.querySelector("#characterCount"),
    saveState: document.querySelector("#saveState"),
    pinButton: document.querySelector("#pinButton"),
    deleteButton: document.querySelector("#deleteButton"),
    toast: document.querySelector("#toast"),
    undoDelete: document.querySelector("#undoDelete"),
    openSidebar: document.querySelector("#openSidebar"),
    closeSidebar: document.querySelector("#closeSidebar"),
    sidebarBackdrop: document.querySelector("#sidebarBackdrop"),
  };

  let notes = [];
  let groups = [DEFAULT_GROUP];
  let activeId = null;
  let activeGroupId = DEFAULT_GROUP.id;
  let searchTerm = "";
  let saveTimer = null;
  let saveChain = Promise.resolve();
  let toastTimer = null;
  let deletedSnapshot = null;

  void loadVersion();
  void initialize();

  async function loadVersion() {
    try {
      const response = await fetch("/api/version", { cache: "no-store" });
      if (!response.ok) return;
      const info = await response.json();
      if (typeof info.version === "string" && info.version) {
        document.querySelector("#appVersion").textContent = `v${info.version}`;
      }
    } catch {
      // 保留 HTML 中的构建版本号，不影响笔记功能。
    }
  }

  async function initialize() {
    setSaveState("saving", "正在读取…");
    try {
      const [notesResponse, groupsResponse] = await Promise.all([
        fetch("/api/notes", { cache: "no-store" }),
        fetch("/api/groups", { cache: "no-store" }),
      ]);
      if (!notesResponse.ok) throw new Error(`读取失败：${notesResponse.status}`);

      const noteValues = await notesResponse.json();
      const groupValues = groupsResponse.ok ? await groupsResponse.json() : [DEFAULT_GROUP];
      groups = normalizeGroups(groupValues);
      notes = Array.isArray(noteValues) ? noteValues.filter(isValidMetadata).map(normalizeMetadata) : [];
      activeGroupId = groups[0]?.id ?? DEFAULT_GROUP.id;

      if (notes.length === 0) {
        await addNote({
          title: "今天，从一条记录开始",
          content: "这里可以记录工作进展、临时想法和待办事项。\n\n每篇笔记都会按创建日期单独保存在项目的 data 目录中，不会上传到网络。",
          focus: false,
        });
      } else {
        activeId = sortNotes(notesForActiveGroup())[0]?.id ?? null;
        if (activeId) await ensureLoaded(activeId);
        setSaveState("saved", "已保存到 JSON");
        renderAll();
      }
    } catch (error) {
      notes = [];
      activeId = null;
      renderAll();
      setSaveState("error", "无法读取 data 目录");
      console.error(error);
    }
  }

  function normalizeGroups(value) {
    const valid = Array.isArray(value)
      ? value.filter((group) => group && typeof group.id === "string" && typeof group.name === "string")
      : [];
    if (!valid.some((group) => group.id === DEFAULT_GROUP.id)) valid.unshift(DEFAULT_GROUP);
    return valid;
  }

  function createNote(overrides = {}) {
    const now = Date.now();
    return {
      id: makeId(),
      title: "",
      content: "",
      preview: "",
      pinned: false,
      groupId: activeGroupId || DEFAULT_GROUP.id,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  function makeId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `note-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function isValidMetadata(note) {
    return note && typeof note.id === "string" && typeof note.title === "string";
  }

  function normalizeMetadata(note) {
    const now = Date.now();
    const groupId = groups.some((group) => group.id === note.groupId) ? note.groupId : DEFAULT_GROUP.id;
    return {
      id: note.id,
      title: note.title,
      preview: typeof note.preview === "string" ? note.preview : "",
      pinned: Boolean(note.pinned),
      groupId,
      createdAt: Number(note.createdAt) || now,
      updatedAt: Number(note.updatedAt) || now,
      content: undefined,
    };
  }

  async function ensureLoaded(id) {
    const existing = notes.find((note) => note.id === id);
    if (!existing || typeof existing.content === "string") return existing;
    setSaveState("saving", "正在读取…");
    const response = await fetch(`/api/notes/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`读取笔记失败：${response.status}`);
    const fullNote = await response.json();
    Object.assign(existing, fullNote, {
      groupId: groups.some((group) => group.id === fullNote.groupId) ? fullNote.groupId : DEFAULT_GROUP.id,
    });
    return existing;
  }

  function persistNote(note) {
    if (!note || typeof note.content !== "string") return Promise.resolve(false);
    const snapshot = JSON.stringify({
      id: note.id,
      title: note.title,
      content: note.content,
      pinned: Boolean(note.pinned),
      groupId: note.groupId || DEFAULT_GROUP.id,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    });

    saveChain = saveChain
      .catch(() => undefined)
      .then(async () => {
        const response = await fetch(`/api/notes/${encodeURIComponent(note.id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: snapshot,
        });
        if (!response.ok) throw new Error(`保存失败：${response.status}`);
        setSaveState("saved", "已保存到 JSON");
        return true;
      })
      .catch((error) => {
        setSaveState("error", "保存失败，请检查 data 目录");
        console.error(error);
        return false;
      });
    return saveChain;
  }

  function removeNoteFile(id) {
    saveChain = saveChain
      .catch(() => undefined)
      .then(async () => {
        const response = await fetch(`/api/notes/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!response.ok && response.status !== 404) throw new Error(`删除失败：${response.status}`);
        setSaveState("saved", "已保存到 JSON");
      })
      .catch((error) => {
        setSaveState("error", "删除失败，请检查 data 目录");
        console.error(error);
      });
    return saveChain;
  }

  function queueSave() {
    clearTimeout(saveTimer);
    setSaveState("saving", "正在保存…");
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void persistNote(getActiveNote());
    }, SAVE_DELAY);
  }

  function flushSave() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    void persistNote(getActiveNote());
  }

  function setSaveState(state, label) {
    elements.saveState.className = `save-state${state === "saved" ? "" : ` ${state}`}`;
    elements.saveState.querySelector("span:last-child").textContent = label;
  }

  function sortNotes(collection) {
    return [...collection].sort((a, b) => {
      if (a.pinned !== b.pinned) return Number(b.pinned) - Number(a.pinned);
      return b.updatedAt - a.updatedAt;
    });
  }

  function notesForActiveGroup() {
    return notes.filter((note) => note.groupId === activeGroupId);
  }

  function getActiveNote() {
    return notes.find((note) => note.id === activeId) ?? null;
  }

  function getActiveGroup() {
    return groups.find((group) => group.id === activeGroupId) ?? groups[0] ?? DEFAULT_GROUP;
  }

  function renderAll() {
    renderGroups();
    renderList();
    renderEditor();
  }

  function renderGroups() {
    elements.groupsList.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (const group of groups) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `group-row${group.id === activeGroupId ? " active" : ""}`;
      row.dataset.groupId = group.id;

      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("class", "group-row-icon");
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = '<path d="M3.5 7.5h6l2 2h9v9.5h-17z" /><path d="M3.5 7.5V5h6l2 2" />';

      const name = document.createElement("span");
      name.className = "group-row-name";
      name.textContent = group.name;

      const count = document.createElement("span");
      count.className = "group-row-count";
      count.textContent = String(notes.filter((note) => note.groupId === group.id).length);

      row.append(icon, name, count);
      row.addEventListener("click", () => void selectGroup(group.id));
      fragment.append(row);
    }
    elements.groupsList.append(fragment);

    const activeGroup = getActiveGroup();
    elements.currentGroupLabel.textContent = activeGroup.name;
    elements.noteGroupSelect.replaceChildren();
    for (const group of groups) {
      const option = document.createElement("option");
      option.value = group.id;
      option.textContent = group.name;
      elements.noteGroupSelect.append(option);
    }
  }

  function renderList() {
    const normalizedTerm = searchTerm.trim().toLocaleLowerCase("zh-CN");
    const groupNotes = notesForActiveGroup();
    const filtered = sortNotes(groupNotes).filter((note) => {
      if (!normalizedTerm) return true;
      const searchable = `${note.title}\n${note.content ?? note.preview ?? ""}`;
      return searchable.toLocaleLowerCase("zh-CN").includes(normalizedTerm);
    });

    elements.noteCount.textContent = normalizedTerm ? `${filtered.length} 条结果` : `${groupNotes.length} 篇`;
    elements.notesList.replaceChildren();

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "no-results";
      empty.innerHTML = normalizedTerm
        ? "<strong>没有找到相关笔记</strong><span>可搜索标题和内容摘要</span>"
        : "<strong>这个分组还是空的</strong><span>点击上方按钮新建笔记</span>";
      elements.notesList.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const note of filtered) fragment.append(createNoteCard(note));
    elements.notesList.append(fragment);
  }

  function createNoteCard(note) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `note-card${note.id === activeId ? " active" : ""}`;
    card.dataset.noteId = note.id;
    card.setAttribute("role", "option");
    card.setAttribute("aria-selected", String(note.id === activeId));

    const titleRow = document.createElement("span");
    titleRow.className = "note-card-title";
    if (note.pinned) {
      const pin = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      pin.setAttribute("viewBox", "0 0 24 24");
      pin.setAttribute("class", "pin-mark");
      pin.setAttribute("aria-hidden", "true");
      pin.innerHTML = '<path d="m9 4 6 0 1 5 3 3v2h-6v6l-1 1-1-1v-6H5v-2l3-3 1-5Z" />';
      titleRow.append(pin);
    }

    const title = document.createElement("strong");
    title.textContent = note.title.trim() || "无标题笔记";
    titleRow.append(title);

    const preview = document.createElement("span");
    preview.className = "note-card-preview";
    preview.textContent = (note.content ?? note.preview ?? "").trim().replace(/\s+/g, " ") || "暂无内容";

    const time = document.createElement("time");
    time.className = "note-card-time";
    time.dateTime = new Date(note.updatedAt).toISOString();
    time.textContent = formatListTime(note.updatedAt);

    card.append(titleRow, preview, time);
    card.addEventListener("click", () => void selectNote(note.id));
    return card;
  }

  function renderEditor() {
    const note = getActiveNote();
    const hasNote = Boolean(note);
    elements.editorPanel.hidden = !hasNote;
    elements.emptyEditor.hidden = hasNote;
    elements.pinButton.disabled = !hasNote;
    elements.deleteButton.disabled = !hasNote;
    if (!note) return;

    if (document.activeElement !== elements.titleInput) elements.titleInput.value = note.title;
    if (document.activeElement !== elements.contentInput) elements.contentInput.value = note.content ?? "";
    elements.noteGroupSelect.value = note.groupId || DEFAULT_GROUP.id;
    elements.pinButton.setAttribute("aria-pressed", String(note.pinned));
    elements.pinButton.querySelector("span").textContent = note.pinned ? "取消置顶" : "置顶";
    elements.createdDate.dateTime = new Date(note.createdAt).toISOString();
    elements.createdDate.textContent = formatCreatedDate(note.createdAt);
    elements.lastEditedTime.textContent = `最后编辑 ${formatClockTime(note.updatedAt)}`;
    elements.characterCount.textContent = `${countCharacters(note.content ?? "")} 字`;
    elements.paragraphCount.textContent = `${countParagraphs(note.content ?? "")} 段`;
  }

  async function selectGroup(groupId) {
    if (!groups.some((group) => group.id === groupId)) return;
    flushSave();
    activeGroupId = groupId;
    searchTerm = "";
    elements.searchInput.value = "";
    elements.clearSearch.hidden = true;
    activeId = sortNotes(notesForActiveGroup())[0]?.id ?? null;
    if (activeId) {
      try {
        await ensureLoaded(activeId);
      } catch (error) {
        setSaveState("error", "无法读取这篇笔记");
        console.error(error);
      }
    }
    renderAll();
    closeSidebar();
  }

  async function selectNote(id) {
    if (!notes.some((note) => note.id === id) || id === activeId) {
      closeSidebar();
      return;
    }
    flushSave();
    activeId = id;
    renderList();
    closeSidebar();
    try {
      await ensureLoaded(id);
      setSaveState("saved", "已保存到 JSON");
      renderEditor();
    } catch (error) {
      setSaveState("error", "无法读取这篇笔记");
      console.error(error);
    }
  }

  async function addNote(options = {}) {
    flushSave();
    const note = createNote({ title: options.title ?? "", content: options.content ?? "" });
    note.preview = makePreview(note.content);
    notes.push(note);
    activeId = note.id;
    searchTerm = "";
    elements.searchInput.value = "";
    elements.clearSearch.hidden = true;
    renderAll();
    closeSidebar();
    await persistNote(note);
    if (options.focus !== false) requestAnimationFrame(() => elements.titleInput.focus());
  }

  function updateActiveNote(field, value) {
    const note = getActiveNote();
    if (!note) return;
    note[field] = value;
    note.updatedAt = Date.now();
    note.preview = makePreview(note.content ?? "");
    elements.lastEditedTime.textContent = `最后编辑 ${formatClockTime(note.updatedAt)}`;
    elements.characterCount.textContent = `${countCharacters(note.content ?? "")} 字`;
    elements.paragraphCount.textContent = `${countParagraphs(note.content ?? "")} 段`;
    renderList();
    queueSave();
  }

  function togglePin() {
    const note = getActiveNote();
    if (!note) return;
    note.pinned = !note.pinned;
    note.updatedAt = Date.now();
    void persistNote(note);
    renderAll();
  }

  async function deleteActiveNote() {
    const index = notes.findIndex((note) => note.id === activeId);
    if (index < 0) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    deletedSnapshot = { note: { ...notes[index] }, index };
    const deletedId = notes[index].id;
    notes.splice(index, 1);
    activeId = sortNotes(notesForActiveGroup())[0]?.id ?? null;
    renderAll();
    showToast();
    void removeNoteFile(deletedId);
    if (activeId) {
      try {
        await ensureLoaded(activeId);
        renderEditor();
      } catch (error) {
        setSaveState("error", "无法读取这篇笔记");
        console.error(error);
      }
    }
  }

  function undoDelete() {
    if (!deletedSnapshot) return;
    clearTimeout(toastTimer);
    const restored = deletedSnapshot.note;
    notes.splice(Math.min(deletedSnapshot.index, notes.length), 0, restored);
    activeGroupId = restored.groupId || DEFAULT_GROUP.id;
    activeId = restored.id;
    deletedSnapshot = null;
    elements.toast.hidden = true;
    void persistNote(restored);
    renderAll();
  }

  async function createGroup(name) {
    const response = await fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "创建分组失败");
    if (!groups.some((group) => group.id === result.id)) groups.push(result);
    activeGroupId = result.id;
    activeId = sortNotes(notesForActiveGroup())[0]?.id ?? null;
    renderAll();
  }

  function applyFormat(format) {
    const textarea = elements.contentInput;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end);
    let replacement = selected;
    let cursorOffset = 0;

    const wrappers = {
      bold: ["**", "**"],
      italic: ["*", "*"],
      link: ["[", "](https://)"],
    };
    const prefixes = {
      bullet: "- ",
      number: "1. ",
      check: "- [ ] ",
      quote: "> ",
      heading: "## ",
    };

    if (wrappers[format]) {
      const [before, after] = wrappers[format];
      replacement = `${before}${selected || "文字"}${after}`;
      cursorOffset = before.length + (selected || "文字").length;
    } else if (prefixes[format]) {
      replacement = selected
        ? selected.split("\n").map((line) => `${prefixes[format]}${line}`).join("\n")
        : prefixes[format];
      cursorOffset = replacement.length;
    } else if (format === "divider") {
      replacement = `${start > 0 ? "\n" : ""}---\n`;
      cursorOffset = replacement.length;
    }

    textarea.setRangeText(replacement, start, end, "end");
    const nextCursor = start + (cursorOffset || replacement.length);
    textarea.setSelectionRange(nextCursor, nextCursor);
    textarea.focus();
    updateActiveNote("content", textarea.value);
  }

  function showToast() {
    clearTimeout(toastTimer);
    elements.toast.hidden = false;
    toastTimer = setTimeout(() => {
      elements.toast.hidden = true;
      deletedSnapshot = null;
    }, 5000);
  }

  function makePreview(text) {
    return text.trim().replace(/\s+/g, " ").slice(0, 160);
  }

  function formatListTime(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return formatClockTime(timestamp);
    if (date.getFullYear() === today.getFullYear()) {
      return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date);
    }
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(date);
  }

  function formatCreatedDate(timestamp) {
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(new Date(timestamp));
  }

  function formatClockTime(timestamp) {
    return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(timestamp));
  }

  function countCharacters(text) {
    return [...text.replace(/\s/g, "")].length;
  }

  function countParagraphs(text) {
    if (!text.trim()) return 0;
    return text.split(/\n\s*\n/).filter((paragraph) => paragraph.trim()).length;
  }

  function openSidebar() {
    elements.body.classList.add("sidebar-open");
    requestAnimationFrame(() => elements.searchInput.focus());
  }

  function closeSidebar() {
    elements.body.classList.remove("sidebar-open");
  }

  elements.newNoteButton.addEventListener("click", () => void addNote());
  elements.emptyNewButton.addEventListener("click", () => void addNote());
  elements.titleInput.addEventListener("input", (event) => updateActiveNote("title", event.target.value));
  elements.contentInput.addEventListener("input", (event) => updateActiveNote("content", event.target.value));
  elements.noteGroupSelect.addEventListener("change", (event) => {
    const note = getActiveNote();
    if (!note) return;
    note.groupId = event.target.value;
    note.updatedAt = Date.now();
    activeGroupId = note.groupId;
    void persistNote(note);
    renderAll();
  });
  elements.pinButton.addEventListener("click", togglePin);
  elements.deleteButton.addEventListener("click", () => void deleteActiveNote());
  elements.undoDelete.addEventListener("click", undoDelete);
  elements.openSidebar.addEventListener("click", openSidebar);
  elements.closeSidebar.addEventListener("click", closeSidebar);
  elements.sidebarBackdrop.addEventListener("click", closeSidebar);

  elements.groupsToggle.addEventListener("click", () => {
    const expanded = elements.groupsToggle.getAttribute("aria-expanded") === "true";
    elements.groupsToggle.setAttribute("aria-expanded", String(!expanded));
    elements.groupsList.classList.toggle("collapsed", expanded);
  });

  elements.addGroupButton.addEventListener("click", () => {
    elements.groupNameInput.value = "";
    elements.groupDialog.showModal();
    requestAnimationFrame(() => elements.groupNameInput.focus());
  });

  elements.cancelGroupButton.addEventListener("click", () => elements.groupDialog.close());
  elements.groupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = elements.groupNameInput.value.trim();
    if (!name) {
      elements.groupNameInput.focus();
      return;
    }
    try {
      await createGroup(name);
      elements.groupDialog.close();
    } catch (error) {
      elements.groupNameInput.setCustomValidity(error.message);
      elements.groupNameInput.reportValidity();
      elements.groupNameInput.setCustomValidity("");
    }
  });

  elements.searchInput.addEventListener("input", (event) => {
    searchTerm = event.target.value;
    elements.clearSearch.hidden = !searchTerm;
    renderList();
  });

  elements.clearSearch.addEventListener("click", () => {
    searchTerm = "";
    elements.searchInput.value = "";
    elements.clearSearch.hidden = true;
    elements.searchInput.focus();
    renderList();
  });

  elements.formatToolbar.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-format]");
    if (button) applyFormat(button.dataset.format);
  });

  elements.styleSelect.addEventListener("change", () => {
    if (elements.styleSelect.value === "heading") applyFormat("heading");
    elements.styleSelect.value = "body";
  });

  elements.quickInsert.addEventListener("click", () => {
    const start = elements.contentInput.selectionStart;
    const end = elements.contentInput.selectionEnd;
    elements.contentInput.setRangeText("\n\n", start, end, "end");
    elements.contentInput.focus();
    updateActiveNote("content", elements.contentInput.value);
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
      event.preventDefault();
      void addNote();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      flushSave();
      setSaveState("saving", "正在保存…");
      void persistNote(getActiveNote());
    }
    if (event.key === "Escape") {
      if (elements.groupDialog.open) elements.groupDialog.close();
      closeSidebar();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSave();
  });
  window.addEventListener("beforeunload", flushSave);
})();
