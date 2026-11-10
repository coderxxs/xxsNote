(() => {
  "use strict";

  const SAVE_DELAY = 280;

  const elements = {
    body: document.body,
    notesList: document.querySelector("#notesList"),
    noteCount: document.querySelector("#noteCount"),
    newNoteButton: document.querySelector("#newNoteButton"),
    emptyNewButton: document.querySelector("#emptyNewButton"),
    searchInput: document.querySelector("#searchInput"),
    clearSearch: document.querySelector("#clearSearch"),
    titleInput: document.querySelector("#titleInput"),
    contentInput: document.querySelector("#contentInput"),
    editorPanel: document.querySelector("#editorPanel"),
    emptyEditor: document.querySelector("#emptyEditor"),
    updatedTime: document.querySelector("#updatedTime"),
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
  let activeId = null;
  let searchTerm = "";
  let saveTimer = null;
  let saveChain = Promise.resolve();
  let toastTimer = null;
  let deletedSnapshot = null;

  void loadVersion();
  initialize();

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
      const response = await fetch("/api/notes", { cache: "no-store" });
      if (!response.ok) throw new Error(`读取失败：${response.status}`);
      const value = await response.json();
      notes = Array.isArray(value) ? value.filter(isValidMetadata).map(normalizeMetadata) : [];

      if (notes.length === 0) {
        await addNote({
          title: "今天，从一条记录开始",
          content: "这里可以记录工作进展、临时想法和待办事项。\n\n每篇笔记都会按创建日期单独保存在项目的 data 目录中，不会上传到网络。",
          focus: false,
        });
      } else {
        activeId = sortNotes(notes)[0]?.id ?? null;
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

  function createNote(overrides = {}) {
    const now = Date.now();
    return {
      id: makeId(),
      title: "",
      content: "",
      preview: "",
      pinned: false,
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
    return {
      id: note.id,
      title: note.title,
      preview: typeof note.preview === "string" ? note.preview : "",
      pinned: Boolean(note.pinned),
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
    Object.assign(existing, fullNote);
    return existing;
  }

  function persistNote(note) {
    if (!note || typeof note.content !== "string") return Promise.resolve(false);
    const snapshot = JSON.stringify({
      id: note.id,
      title: note.title,
      content: note.content,
      pinned: Boolean(note.pinned),
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

  function getActiveNote() {
    return notes.find((note) => note.id === activeId) ?? null;
  }

  function renderAll() {
    renderList();
    renderEditor();
  }

  function renderList() {
    const normalizedTerm = searchTerm.trim().toLocaleLowerCase("zh-CN");
    const filtered = sortNotes(notes).filter((note) => {
      if (!normalizedTerm) return true;
      const searchable = `${note.title}\n${note.content ?? note.preview ?? ""}`;
      return searchable.toLocaleLowerCase("zh-CN").includes(normalizedTerm);
    });

    elements.noteCount.textContent = normalizedTerm ? `${filtered.length} 条结果` : `${notes.length} 篇`;
    elements.notesList.replaceChildren();

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "no-results";
      empty.innerHTML = normalizedTerm
        ? "<strong>没有找到相关笔记</strong><span>可搜索标题和内容摘要</span>"
        : "<strong>暂无笔记</strong><span>点击上方按钮新建</span>";
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
    elements.pinButton.setAttribute("aria-pressed", String(note.pinned));
    elements.pinButton.querySelector("span").textContent = note.pinned ? "取消置顶" : "置顶";
    elements.updatedTime.dateTime = new Date(note.updatedAt).toISOString();
    elements.updatedTime.textContent = `更新于 ${formatEditorTime(note.updatedAt)}`;
    elements.characterCount.textContent = `${countCharacters(note.content ?? "")} 字`;
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
    note.preview = makePreview(note.content);
    elements.updatedTime.textContent = `更新于 ${formatEditorTime(note.updatedAt)}`;
    elements.characterCount.textContent = `${countCharacters(note.content)} 字`;
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
    activeId = sortNotes(notes)[0]?.id ?? null;
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
    activeId = restored.id;
    deletedSnapshot = null;
    elements.toast.hidden = true;
    void persistNote(restored);
    renderAll();
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
    if (date.toDateString() === today.toDateString()) {
      return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
    }
    if (date.getFullYear() === today.getFullYear()) {
      return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date);
    }
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(date);
  }

  function formatEditorTime(timestamp) {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(timestamp));
  }

  function countCharacters(text) {
    return [...text.replace(/\s/g, "")].length;
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
  elements.pinButton.addEventListener("click", togglePin);
  elements.deleteButton.addEventListener("click", () => void deleteActiveNote());
  elements.undoDelete.addEventListener("click", undoDelete);
  elements.openSidebar.addEventListener("click", openSidebar);
  elements.closeSidebar.addEventListener("click", closeSidebar);
  elements.sidebarBackdrop.addEventListener("click", closeSidebar);

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

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
      event.preventDefault();
      void addNote();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      flushSave();
      setSaveState("saved", "已保存到 JSON");
    }
    if (event.key === "Escape") closeSidebar();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSave();
  });
  window.addEventListener("beforeunload", flushSave);
})();
