import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import {
  buildRecipePayload,
  collectTags,
  filterRecipes,
  filterRecipesByTab,
  parseSmartRecipe,
  partitionRecipes,
  formatBinDate,
} from "./recipe-utils.js";

const firebaseConfig = {
  apiKey: "AIzaSyCqEJ5yRtTB1KjAG0RmnEsDNiXFJBKwUxo",
  authDomain: "tempco2fugt.firebaseapp.com",
  databaseURL: "https://tempco2fugt-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "tempco2fugt",
  storageBucket: "tempco2fugt.firebasestorage.app",
  messagingSenderId: "1068932962336",
  appId: "1:1068932962336:web:2d53a307fe3579fc5a4445",
  measurementId: "G-QXSRMHKXLV",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const APP_TITLE = "Opskriftsbibliotek";

const state = {
  user: null,
  recipes: [],
  binRecipes: [],
  searchQuery: "",
  activeTab: "permanent",
  activeTag: "",
  selectedIds: new Set(),
  detailRecipeId: null,
  editingRecipeId: null,
  unsubscribeRecipes: null,
};

const dom = {
  loadingView: document.getElementById("loading-view"),
  authView: document.getElementById("auth-view"),
  appView: document.getElementById("app-view"),
  loginForm: document.getElementById("login-form"),
  loginEmail: document.getElementById("login-email"),
  loginPassword: document.getElementById("login-password"),
  authError: document.getElementById("auth-error"),
  btnLogin: document.getElementById("btn-login"),
  recipeCount: document.getElementById("recipe-count"),
  searchInput: document.getElementById("search-input"),
  btnNewRecipe: document.getElementById("btn-new-recipe"),
  btnPrintSelected: document.getElementById("btn-print-selected"),
  btnPrintFiltered: document.getElementById("btn-print-filtered"),
  btnBin: document.getElementById("btn-bin"),
  btnLogout: document.getElementById("btn-logout"),
  filterbar: document.getElementById("filterbar"),
  tagFilters: document.getElementById("tag-filters"),
  btnToggleSelect: document.getElementById("btn-toggle-select"),
  tabAll: document.getElementById("tab-all"),
  tabAllCount: document.getElementById("tab-all-count"),
  tabWantToTry: document.getElementById("tab-want-to-try"),
  tabWantCount: document.getElementById("tab-want-count"),
  appError: document.getElementById("app-error"),
  recipeGrid: document.getElementById("recipe-grid"),
  emptyState: document.getElementById("empty-state"),
  emptyMessage: document.getElementById("empty-message"),
  btnEmptyNew: document.getElementById("btn-empty-new"),
  detailModal: document.getElementById("detail-modal"),
  detailSheetHost: document.getElementById("detail-sheet-host"),
  btnDetailPrint: document.getElementById("btn-detail-print"),
  btnDetailPromote: document.getElementById("btn-detail-promote"),
  btnDetailEdit: document.getElementById("btn-detail-edit"),
  btnDetailDelete: document.getElementById("btn-detail-delete"),
  btnDetailClose: document.getElementById("btn-detail-close"),
  binModal: document.getElementById("bin-modal"),
  btnEmptyBin: document.getElementById("btn-empty-bin"),
  btnBinClose: document.getElementById("btn-bin-close"),
  binError: document.getElementById("bin-error"),
  binEmpty: document.getElementById("bin-empty"),
  binList: document.getElementById("bin-list"),
  editorModal: document.getElementById("editor-modal"),
  editorHeading: document.getElementById("editor-heading"),
  smartPasteWrap: document.getElementById("smart-paste-wrap"),
  smartPasteInput: document.getElementById("smart-paste-input"),
  btnSmartClipboard: document.getElementById("btn-smart-clipboard"),
  smartPasteStatus: document.getElementById("smart-paste-status"),
  btnEditorClose: document.getElementById("btn-editor-close"),
  btnEditorCancel: document.getElementById("btn-editor-cancel"),
  recipeForm: document.getElementById("recipe-form"),
  fieldTitle: document.getElementById("field-title"),
  fieldTags: document.getElementById("field-tags"),
  fieldIngredients: document.getElementById("field-ingredients"),
  fieldSteps: document.getElementById("field-steps"),
  fieldNote: document.getElementById("field-note"),
  fieldPermanent: document.getElementById("field-permanent"),
  fieldWantToTry: document.getElementById("field-want-to-try"),
  editorError: document.getElementById("editor-error"),
  btnSaveRecipe: document.getElementById("btn-save-recipe"),
  printContainer: document.getElementById("print-container"),
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setBanner(node, message) {
  if (message) {
    node.textContent = message;
    node.hidden = false;
  } else {
    node.textContent = "";
    node.hidden = true;
  }
}

function mapFirebaseError(error) {
  const code = error?.code ?? "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Forkert e-mail eller adgangskode.";
    case "auth/invalid-email":
      return "Ugyldig e-mailadresse.";
    case "auth/too-many-requests":
      return "For mange forsøg. Prøv igen om lidt.";
    case "auth/network-request-failed":
      return "Netværksfejl. Tjek din internetforbindelse.";
    case "permission-denied":
      return "Manglende adgang til Firestore. Tjek sikkerhedsregler for users/{userId}/recipes/{recipeId}.";
    default:
      return error?.message || "Der opstod en uventet fejl.";
  }
}

function userRecipesCollection() {
  return collection(db, "users", state.user.uid, "recipes");
}

function recipeDocRef(recipeId) {
  return doc(db, "users", state.user.uid, "recipes", recipeId);
}

function getTabRecipes() {
  return filterRecipesByTab(state.recipes, state.activeTab);
}

function getFilteredRecipes() {
  return filterRecipes(
    state.recipes,
    state.searchQuery,
    state.activeTag,
    state.activeTab
  );
}

/**
 * Shared editorial sheet builder used for both Detail Modal preview and A4 Print export.
 */
function createRecipeSheet(recipe) {
  const sheet = el("article", "a4-sheet");

  const header = el("header", "sheet-header");
  header.appendChild(el("h1", "sheet-title", recipe.title));

  if (recipe.tags?.length) {
    const tagsRow = el("div", "sheet-tags");
    for (const tag of recipe.tags) {
      tagsRow.appendChild(el("span", "sheet-tag", tag));
    }
    header.appendChild(tagsRow);
  }
  sheet.appendChild(header);

  const columns = el("div", "sheet-columns");

  const ingCol = el("section", "sheet-ingredients");
  ingCol.appendChild(el("h2", "sheet-section-title", "Ingredienser"));
  const ingList = el("ul", "sheet-ingredients-list");
  for (const item of recipe.ingredients ?? []) {
    ingList.appendChild(el("li", "", item));
  }
  ingCol.appendChild(ingList);
  columns.appendChild(ingCol);

  const stepsCol = el("section", "sheet-steps");
  stepsCol.appendChild(el("h2", "sheet-section-title", "Fremgangsmåde"));
  const stepsList = el("ol", "sheet-steps-list");
  for (const step of recipe.steps ?? []) {
    stepsList.appendChild(el("li", "", step));
  }
  stepsCol.appendChild(stepsList);

  if (recipe.note) {
    const noteBox = el("aside", "sheet-note");
    noteBox.appendChild(el("h3", "sheet-note-title", "Noter"));
    noteBox.appendChild(el("p", "sheet-note-text", recipe.note));
    stepsCol.appendChild(noteBox);
  }

  columns.appendChild(stepsCol);
  sheet.appendChild(columns);
  return sheet;
}

function renderTabs() {
  const permanentCount = filterRecipesByTab(state.recipes, "permanent").length;
  const wantToTryCount = filterRecipesByTab(state.recipes, "wantToTry").length;
  dom.tabAllCount.textContent = String(permanentCount);
  dom.tabWantCount.textContent = String(wantToTryCount);

  const isWant = state.activeTab === "wantToTry";
  dom.tabAll.classList.toggle("active", !isWant);
  dom.tabAll.setAttribute("aria-selected", String(!isWant));
  dom.tabWantToTry.classList.toggle("active", isWant);
  dom.tabWantToTry.setAttribute("aria-selected", String(isWant));
}

function renderTags() {
  const tabRecipes = getTabRecipes();
  const tagCounts = collectTags(tabRecipes);
  if (state.activeTag && !tagCounts.some((t) => t.tag === state.activeTag)) {
    state.activeTag = "";
  }

  dom.tagFilters.replaceChildren();
  dom.filterbar.hidden = tabRecipes.length === 0;
  if (tabRecipes.length === 0) return;

  const allChip = el(
    "button",
    `tag-chip${state.activeTag === "" ? " active" : ""}`,
    `Alle (${tabRecipes.length})`
  );
  allChip.type = "button";
  allChip.addEventListener("click", () => {
    state.activeTag = "";
    renderLibrary();
  });
  dom.tagFilters.appendChild(allChip);

  for (const { tag, count } of tagCounts) {
    const chip = el(
      "button",
      `tag-chip${state.activeTag === tag ? " active" : ""}`,
      `${tag} (${count})`
    );
    chip.type = "button";
    chip.addEventListener("click", () => {
      state.activeTag = state.activeTag === tag ? "" : tag;
      renderLibrary();
    });
    dom.tagFilters.appendChild(chip);
  }
}

function renderCard(recipe) {
  const isSelected = state.selectedIds.has(recipe.id);
  const card = el(
    "article",
    `recipe-card${isSelected ? " selected" : ""}${recipe.wantToTry ? " is-want-to-try" : ""}`
  );
  card.tabIndex = 0;

  const top = el("div", "card-top");
  top.appendChild(el("h2", "card-title", recipe.title));

  const selectWrap = el("label", "card-select-wrap");
  selectWrap.addEventListener("click", (e) => e.stopPropagation());

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "card-select";
  checkbox.checked = isSelected;
  checkbox.ariaLabel = `Vælg ${recipe.title} til print`;
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      state.selectedIds.add(recipe.id);
    } else {
      state.selectedIds.delete(recipe.id);
    }
    renderLibrary();
  });
  selectWrap.appendChild(checkbox);
  top.appendChild(selectWrap);
  card.appendChild(top);

  if (recipe.tags?.length) {
    const tagsWrap = el("div", "card-tags");
    for (const tag of recipe.tags) {
      tagsWrap.appendChild(el("span", "mini-tag", tag));
    }
    card.appendChild(tagsWrap);
  }

  if (recipe.ingredients?.length) {
    card.appendChild(el("p", "card-preview", recipe.ingredients.join(" · ")));
  }

  const footer = el("div", "card-footer");
  const countsText = `${recipe.ingredients?.length ?? 0} ingr. · ${recipe.steps?.length ?? 0} trin`;
  footer.appendChild(el("span", "", countsText));

  const footerActions = el("div", "card-footer-actions");
  if (recipe.wantToTry) {
    const promoteBtn = el("button", "btn btn-primary btn-sm", "Gør permanent");
    promoteBtn.type = "button";
    promoteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      promoteToPermanent(recipe, promoteBtn);
    });
    footerActions.appendChild(promoteBtn);
  }

  const printBtn = el("button", "btn btn-secondary btn-sm", "Print A4");
  printBtn.type = "button";
  printBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    printRecipes([recipe]);
  });
  footerActions.appendChild(printBtn);
  footer.appendChild(footerActions);
  card.appendChild(footer);

  const openDetail = () => openDetailModal(recipe.id);
  card.addEventListener("click", openDetail);
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openDetail();
    }
  });

  return card;
}

function renderLibrary() {
  renderTabs();
  renderTags();

  const filtered = getFilteredRecipes();
  dom.recipeCount.textContent = String(state.recipes.length);

  const selectedCount = state.selectedIds.size;
  dom.btnPrintSelected.textContent = `Print valgte (${selectedCount})`;
  dom.btnPrintSelected.disabled = selectedCount === 0;
  dom.btnPrintFiltered.disabled = filtered.length === 0;

  if (filtered.length > 0) {
    const allFilteredSelected = filtered.every((r) => state.selectedIds.has(r.id));
    dom.btnToggleSelect.hidden = false;
    dom.btnToggleSelect.textContent = allFilteredSelected ? "Fravælg viste" : "Vælg alle viste";
  } else {
    dom.btnToggleSelect.hidden = true;
  }

  dom.recipeGrid.replaceChildren();

  if (filtered.length === 0) {
    dom.emptyState.hidden = false;
    const hasInTab = getTabRecipes().length > 0;
    if (state.activeTab === "wantToTry") {
      dom.emptyMessage.textContent = hasInTab
        ? "Ingen opskrifter under \"Vil gerne prøve\" matcher din søgning."
        : "Du har ingen opskrifter under \"Vil gerne prøve\" endnu.";
      dom.btnEmptyNew.textContent = "+ Tilføj til Vil gerne prøve";
    } else {
      dom.emptyMessage.textContent = hasInTab
        ? "Ingen opskrifter matcher din søgning."
        : "Du har ingen permanente opskrifter endnu.";
      dom.btnEmptyNew.textContent =
        state.recipes.length === 0 ? "+ Tilføj din første opskrift" : "+ Ny permanent opskrift";
    }
    dom.btnEmptyNew.hidden = hasInTab;
    return;
  }

  dom.emptyState.hidden = true;
  for (const recipe of filtered) {
    dom.recipeGrid.appendChild(renderCard(recipe));
  }
}

async function promoteToPermanent(recipe, triggerBtn = null) {
  if (!recipe?.wantToTry || recipe.deletedAt) return;
  setBanner(dom.appError, "");
  if (triggerBtn) triggerBtn.disabled = true;
  try {
    await updateDoc(recipeDocRef(recipe.id), {
      wantToTry: false,
      updatedAt: serverTimestamp(),
    });
    if (triggerBtn === dom.btnDetailPromote && dom.detailModal.open) {
      dom.detailModal.close();
    }
  } catch (error) {
    setBanner(dom.appError, mapFirebaseError(error));
    if (triggerBtn) triggerBtn.disabled = false;
  }
}

async function restoreRecipe(recipe, triggerBtn) {
  if (!recipe?.deletedAt) return;
  setBanner(dom.binError, "");
  triggerBtn.disabled = true;
  try {
    await updateDoc(recipeDocRef(recipe.id), {
      deletedAt: null,
      replacedBy: null,
    });
  } catch (error) {
    setBanner(dom.binError, mapFirebaseError(error));
    triggerBtn.disabled = false;
  }
}

async function deleteFromBin(recipesToDelete, triggerBtn = null) {
  // Guard: never permanently delete active recipes that are not in the bin.
  const targets = recipesToDelete.filter((r) => Boolean(r.deletedAt));
  if (!targets.length) return;
  setBanner(dom.binError, "");
  if (triggerBtn) triggerBtn.disabled = true;
  try {
    await Promise.all(targets.map((r) => deleteDoc(recipeDocRef(r.id))));
  } catch (error) {
    setBanner(dom.binError, mapFirebaseError(error));
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = triggerBtn === dom.btnEmptyBin ? state.binRecipes.length === 0 : false;
    }
  }
}

function renderBin() {
  const count = state.binRecipes.length;
  dom.btnBin.textContent = `Papirkurv (${count})`;
  dom.btnEmptyBin.disabled = count === 0;
  dom.binEmpty.hidden = count > 0;
  dom.binList.replaceChildren();

  for (const recipe of state.binRecipes) {
    const item = el("li", "bin-item");
    const info = el("div", "bin-item-info");
    info.appendChild(el("p", "bin-item-title", recipe.title));

    const dateText = formatBinDate(recipe.deletedAt);
    const label = recipe.replacedBy ? "Tidligere version" : "Slettet";
    info.appendChild(el("p", "bin-item-meta", dateText ? `${label} · ${dateText}` : label));
    item.appendChild(info);

    const actions = el("div", "bin-item-actions");
    const restoreBtn = el("button", "btn btn-secondary btn-sm", "Gendan");
    restoreBtn.type = "button";
    restoreBtn.addEventListener("click", () => restoreRecipe(recipe, restoreBtn));

    const purgeBtn = el("button", "btn btn-danger-ghost btn-sm", "Slet permanent");
    purgeBtn.type = "button";
    purgeBtn.addEventListener("click", () => {
      if (!window.confirm(`Slet "${recipe.title}" permanent fra databasen? Dette kan ikke fortrydes.`)) {
        return;
      }
      deleteFromBin([recipe], purgeBtn);
    });

    actions.append(restoreBtn, purgeBtn);
    item.appendChild(actions);
    dom.binList.appendChild(item);
  }
}

function openDetailModal(recipeId) {
  const recipe = state.recipes.find((r) => r.id === recipeId);
  if (!recipe) return;
  state.detailRecipeId = recipeId;
  dom.btnDetailPromote.disabled = false;
  dom.btnDetailPromote.hidden = !recipe.wantToTry;
  dom.detailSheetHost.replaceChildren(createRecipeSheet(recipe));
  if (!dom.detailModal.open) {
    dom.detailModal.showModal();
  }
}

function openEditorModal(recipe = null) {
  setBanner(dom.editorError, "");
  state.editingRecipeId = recipe ? recipe.id : null;
  dom.editorHeading.textContent = recipe ? "Rediger opskrift" : "Ny opskrift";
  dom.smartPasteWrap.hidden = Boolean(recipe);
  dom.smartPasteInput.value = "";
  dom.smartPasteStatus.hidden = true;
  dom.smartPasteStatus.classList.remove("is-error");
  dom.fieldTitle.value = recipe?.title ?? "";
  dom.fieldTags.value = (recipe?.tags ?? []).join(", ");
  dom.fieldIngredients.value = (recipe?.ingredients ?? []).join("\n");
  dom.fieldSteps.value = (recipe?.steps ?? []).join("\n");
  dom.fieldNote.value = recipe?.note ?? "";
  const isWantToTry = recipe ? Boolean(recipe.wantToTry) : state.activeTab === "wantToTry";
  dom.fieldWantToTry.checked = isWantToTry;
  dom.fieldPermanent.checked = !isWantToTry;

  if (!dom.editorModal.open) {
    dom.editorModal.showModal();
  }
  if (!window.matchMedia("(pointer: coarse)").matches) {
    dom.fieldTitle.focus();
  }
}

function setSmartStatus(message, isError = false) {
  dom.smartPasteStatus.textContent = message;
  dom.smartPasteStatus.classList.toggle("is-error", isError);
  dom.smartPasteStatus.hidden = !message;
}

function applySmartPaste(rawText) {
  const res = parseSmartRecipe(rawText);
  if (!res.ok) {
    setSmartStatus(res.error, true);
    return;
  }
  dom.fieldTitle.value = res.data.title;
  dom.fieldTags.value = res.data.tags;
  dom.fieldIngredients.value = res.data.ingredients;
  dom.fieldSteps.value = res.data.steps;
  dom.fieldNote.value = res.data.note;
  dom.smartPasteInput.value = "";
  setBanner(dom.editorError, "");
  setSmartStatus("Udfyldt ✓ — gennemgå felterne og tryk Gem.");
}

function printRecipes(recipes) {
  if (!recipes.length) return;
  dom.printContainer.replaceChildren(...recipes.map(createRecipeSheet));
  document.title = recipes.length === 1 ? recipes[0].title : `Opskrifter (${recipes.length})`;
  window.print();
}

window.addEventListener("afterprint", () => {
  document.title = APP_TITLE;
  dom.printContainer.replaceChildren();
});

function subscribeToRecipes(uid) {
  if (state.unsubscribeRecipes) state.unsubscribeRecipes();
  const q = query(collection(db, "users", uid, "recipes"), orderBy("updatedAt", "desc"));
  state.unsubscribeRecipes = onSnapshot(
    q,
    (snapshot) => {
      setBanner(dom.appError, "");
      const allDocs = snapshot.docs.map((snap) => ({ id: snap.id, ...snap.data() }));
      const { active, trashed } = partitionRecipes(allDocs);
      state.recipes = active;
      state.binRecipes = trashed;

      const validIds = new Set(state.recipes.map((r) => r.id));
      for (const id of Array.from(state.selectedIds)) {
        if (!validIds.has(id)) state.selectedIds.delete(id);
      }

      renderLibrary();
      renderBin();

      if (dom.detailModal.open && state.detailRecipeId) {
        if (validIds.has(state.detailRecipeId)) {
          openDetailModal(state.detailRecipeId);
        } else {
          dom.detailModal.close();
          state.detailRecipeId = null;
        }
      }
    },
    (error) => {
      setBanner(dom.appError, mapFirebaseError(error));
    }
  );
}

// Auth listeners
onAuthStateChanged(auth, (user) => {
  dom.loadingView.hidden = true;
  if (user) {
    state.user = user;
    dom.authView.hidden = true;
    dom.appView.hidden = false;
    dom.btnLogout.title = `Logget ind som ${user.email ?? ""}`;
    subscribeToRecipes(user.uid);
  } else {
    state.user = null;
    if (state.unsubscribeRecipes) {
      state.unsubscribeRecipes();
      state.unsubscribeRecipes = null;
    }
    state.recipes = [];
    state.binRecipes = [];
    state.selectedIds.clear();
    state.activeTab = "permanent";
    state.activeTag = "";
    state.searchQuery = "";
    dom.searchInput.value = "";
    if (dom.detailModal.open) dom.detailModal.close();
    if (dom.editorModal.open) dom.editorModal.close();
    if (dom.binModal.open) dom.binModal.close();
    renderBin();
    dom.appView.hidden = true;
    dom.authView.hidden = false;
    dom.loginPassword.value = "";
  }
});

dom.loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setBanner(dom.authError, "");
  dom.btnLogin.disabled = true;
  try {
    await signInWithEmailAndPassword(
      auth,
      dom.loginEmail.value.trim(),
      dom.loginPassword.value
    );
  } catch (error) {
    setBanner(dom.authError, mapFirebaseError(error));
  } finally {
    dom.btnLogin.disabled = false;
  }
});

dom.btnLogout.addEventListener("click", () => signOut(auth));

// Library & selection events
dom.searchInput.addEventListener("input", () => {
  state.searchQuery = dom.searchInput.value;
  renderLibrary();
});

dom.btnNewRecipe.addEventListener("click", () => openEditorModal());
dom.btnEmptyNew.addEventListener("click", () => openEditorModal());

dom.tabAll.addEventListener("click", () => {
  if (state.activeTab === "permanent") return;
  state.activeTab = "permanent";
  state.activeTag = "";
  renderLibrary();
});
dom.tabWantToTry.addEventListener("click", () => {
  if (state.activeTab === "wantToTry") return;
  state.activeTab = "wantToTry";
  state.activeTag = "";
  renderLibrary();
});

dom.btnToggleSelect.addEventListener("click", () => {
  const filtered = getFilteredRecipes();
  const allSelected = filtered.every((r) => state.selectedIds.has(r.id));
  for (const r of filtered) {
    if (allSelected) {
      state.selectedIds.delete(r.id);
    } else {
      state.selectedIds.add(r.id);
    }
  }
  renderLibrary();
});

dom.btnPrintSelected.addEventListener("click", () => {
  const selected = state.recipes.filter((r) => state.selectedIds.has(r.id));
  printRecipes(selected);
});

dom.btnPrintFiltered.addEventListener("click", () => {
  printRecipes(getFilteredRecipes());
});

// Detail modal events
dom.btnDetailClose.addEventListener("click", () => dom.detailModal.close());
dom.btnDetailPrint.addEventListener("click", () => {
  const recipe = state.recipes.find((r) => r.id === state.detailRecipeId);
  if (recipe) printRecipes([recipe]);
});
dom.btnDetailPromote.addEventListener("click", () => {
  const recipe = state.recipes.find((r) => r.id === state.detailRecipeId);
  if (recipe) promoteToPermanent(recipe, dom.btnDetailPromote);
});
dom.btnDetailEdit.addEventListener("click", () => {
  const recipe = state.recipes.find((r) => r.id === state.detailRecipeId);
  if (!recipe) return;
  dom.detailModal.close();
  openEditorModal(recipe);
});
dom.btnDetailDelete.addEventListener("click", async () => {
  const recipe = state.recipes.find((r) => r.id === state.detailRecipeId);
  if (!recipe || !window.confirm(`Flyt "${recipe.title}" til papirkurven?`)) return;
  try {
    await updateDoc(recipeDocRef(recipe.id), {
      deletedAt: serverTimestamp(),
      replacedBy: null,
    });
    dom.detailModal.close();
  } catch (error) {
    setBanner(dom.appError, mapFirebaseError(error));
  }
});

// Bin modal events
dom.btnBin.addEventListener("click", () => {
  setBanner(dom.binError, "");
  renderBin();
  if (!dom.binModal.open) dom.binModal.showModal();
});
dom.btnBinClose.addEventListener("click", () => dom.binModal.close());
dom.btnEmptyBin.addEventListener("click", () => {
  const count = state.binRecipes.length;
  if (!count) return;
  if (
    !window.confirm(
      `Tøm papirkurven og slet ${count} opskrift${count === 1 ? "" : "er"} permanent fra databasen? Dette kan ikke fortrydes.`
    )
  ) {
    return;
  }
  deleteFromBin(state.binRecipes, dom.btnEmptyBin);
});

// Editor modal events
dom.btnEditorClose.addEventListener("click", () => dom.editorModal.close());
dom.btnEditorCancel.addEventListener("click", () => dom.editorModal.close());

dom.smartPasteInput.addEventListener("paste", (e) => {
  const text = e.clipboardData?.getData("text") ?? "";
  if (!text) return;
  e.preventDefault();
  applySmartPaste(text);
});

dom.smartPasteInput.addEventListener("input", () => {
  if (dom.smartPasteInput.value.includes("\n")) {
    applySmartPaste(dom.smartPasteInput.value);
  }
});

dom.btnSmartClipboard.addEventListener("click", async () => {
  if (!navigator.clipboard?.readText) {
    setSmartStatus("Brug Ctrl+V i feltet til venstre (udklipsholder ikke understøttet).", true);
    dom.smartPasteInput.focus();
    return;
  }
  try {
    const text = await navigator.clipboard.readText();
    applySmartPaste(text);
  } catch {
    setSmartStatus("Adgang til udklipsholder afvist — brug Ctrl+V i feltet til venstre.", true);
    dom.smartPasteInput.focus();
  }
});

dom.recipeForm.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    dom.recipeForm.requestSubmit();
  }
});

dom.recipeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setBanner(dom.editorError, "");

  const result = buildRecipePayload({
    title: dom.fieldTitle.value,
    tags: dom.fieldTags.value,
    ingredients: dom.fieldIngredients.value,
    steps: dom.fieldSteps.value,
    note: dom.fieldNote.value,
    wantToTry: dom.fieldWantToTry.checked,
  });

  if (!result.ok) {
    setBanner(dom.editorError, result.error);
    return;
  }

  dom.btnSaveRecipe.disabled = true;
  let createdNewDoc = false;
  try {
    const payload = {
      ...result.data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      deletedAt: null,
    };
    if (state.editingRecipeId) {
      const previousId = state.editingRecipeId;
      const newDocRef = await addDoc(userRecipesCollection(), payload);
      createdNewDoc = true;
      state.editingRecipeId = null;
      await updateDoc(recipeDocRef(previousId), {
        deletedAt: serverTimestamp(),
        replacedBy: newDocRef.id,
      });
    } else {
      await addDoc(userRecipesCollection(), payload);
    }
    state.activeTab = result.data.wantToTry ? "wantToTry" : "permanent";
    state.activeTag = "";
    renderLibrary();
    dom.editorModal.close();
  } catch (error) {
    if (createdNewDoc) {
      dom.editorModal.close();
      setBanner(dom.appError, mapFirebaseError(error));
    } else {
      setBanner(dom.editorError, mapFirebaseError(error));
    }
  } finally {
    dom.btnSaveRecipe.disabled = false;
  }
});

// Close dialogs on backdrop click
for (const dialog of [dom.detailModal, dom.editorModal, dom.binModal]) {
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
}

// Keyboard shortcut: "/" focuses search when library is active
document.addEventListener("keydown", (e) => {
  if (
    e.key === "/" &&
    !dom.appView.hidden &&
    !dom.detailModal.open &&
    !dom.editorModal.open &&
    !dom.binModal.open &&
    !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)
  ) {
    e.preventDefault();
    dom.searchInput.focus();
  }
});
