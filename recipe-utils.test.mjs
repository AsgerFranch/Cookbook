import test from "node:test";
import assert from "node:assert/strict";
import {
  parseLines,
  parseTags,
  buildRecipePayload,
  collectTags,
  filterRecipes,
  filterRecipesByTab,
  parseSmartRecipe,
  isRecipeDeleted,
  partitionRecipes,
  formatBinDate,
} from "./recipe-utils.js";

test("parseLines trims blanks and strips list markers without breaking measurements", () => {
  const raw = `
    - 400 g spaghetti
    1. Kog vand med salt
    2) Steg bacon
    * 1.5 dl fløde
    2 spsk olie

    • Peber
  `;
  assert.deepEqual(parseLines(raw), [
    "400 g spaghetti",
    "Kog vand med salt",
    "Steg bacon",
    "1.5 dl fløde",
    "2 spsk olie",
    "Peber",
  ]);
});

test("parseTags normalizes casing, trims, and deduplicates", () => {
  assert.deepEqual(parseTags(" Aftensmad, hurtig , pasta, AFTENSMAD,  "), [
    "aftensmad",
    "hurtig",
    "pasta",
  ]);
});

test("buildRecipePayload rejects missing title or empty body", () => {
  assert.equal(buildRecipePayload({ title: "   ", ingredients: "Æg" }).ok, false);
  assert.equal(buildRecipePayload({ title: "Omelet", ingredients: "", steps: "  " }).ok, false);

  const valid = buildRecipePayload({
    title: " Omelet ",
    tags: "morgenmad, hurtig",
    ingredients: "3 æg\n1 spsk smør",
    steps: "1. Pisk æg\n2. Steg på pande",
    note: " Server med purløg ",
  });
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.data, {
    title: "Omelet",
    tags: ["morgenmad", "hurtig"],
    ingredients: ["3 æg", "1 spsk smør"],
    steps: ["Pisk æg", "Steg på pande"],
    note: "Server med purløg",
    wantToTry: false,
  });

  const wantToTry = buildRecipePayload({
    title: "Ramen",
    ingredients: "Nudler",
    wantToTry: true,
  });
  assert.equal(wantToTry.ok, true);
  assert.equal(wantToTry.data.wantToTry, true);
});

test("collectTags and filterRecipes filter by tag, query, and wantToTry", () => {
  const recipes = [
    { id: "1", title: "Pasta Carbonara", tags: ["aftensmad", "pasta"], ingredients: ["spaghetti", "æg"], note: "", wantToTry: false },
    { id: "2", title: "Pandekager", tags: ["dessert", "hurtig"], ingredients: ["mel", "mælk"], note: "citron", wantToTry: true },
    { id: "3", title: "Tomatsuppe", tags: ["aftensmad"], ingredients: ["tomat"], note: "", wantToTry: true },
  ];

  assert.deepEqual(collectTags(recipes), [
    { tag: "aftensmad", count: 2 },
    { tag: "dessert", count: 1 },
    { tag: "hurtig", count: 1 },
    { tag: "pasta", count: 1 },
  ]);

  assert.deepEqual(
    filterRecipes(recipes, "tomat", "aftensmad").map((r) => r.id),
    ["3"]
  );
  assert.deepEqual(
    filterRecipes(recipes, "citron", "").map((r) => r.id),
    ["2"]
  );
  assert.deepEqual(
    filterRecipes(recipes, "", "pasta").map((r) => r.id),
    ["1"]
  );
  assert.deepEqual(
    filterRecipes(recipes, "", "", "wantToTry").map((r) => r.id),
    ["2", "3"]
  );
  assert.deepEqual(
    filterRecipes(recipes, "", "", "permanent").map((r) => r.id),
    ["1"]
  );
  assert.deepEqual(
    filterRecipesByTab(recipes, "permanent").map((r) => r.id),
    ["1"]
  );
  assert.deepEqual(
    filterRecipesByTab(recipes, "wantToTry").map((r) => r.id),
    ["2", "3"]
  );
});

test("parseSmartRecipe parses skill block into editor fields", () => {
  const input = `\`\`\`text
Titel: Citronpasta
Tags: aftensmad, hurtig, Vegetar

Ingredienser:
400 g spaghetti
1 økologisk citron
50 g parmesan

Fremgangsmåde:
1. Kog pastaen al dente.
2. Vend pasta med citronskal, saft og parmesan.

Noter:
Server straks med frisk peber.
\`\`\``;

  const res = parseSmartRecipe(input);
  assert.equal(res.ok, true);
  assert.deepEqual(res.data, {
    title: "Citronpasta",
    tags: "aftensmad, hurtig, vegetar",
    ingredients: "400 g spaghetti\n1 økologisk citron\n50 g parmesan",
    steps: "Kog pastaen al dente.\nVend pasta med citronskal, saft og parmesan.",
    note: "Server straks med frisk peber.",
  });
});

test("parseSmartRecipe handles markdown headings without Noter and rejects junk", () => {
  const mdInput = `
# Pandekager
**Tags:** morgenmad, sødt

**Ingredienser:**
- 200 g hvedemel
- 4 dl mælk

## Fremgangsmåde:
1. Pisk dejen glat.
2. Steg tynde pandekager i smør.
`;
  const res = parseSmartRecipe(mdInput);
  assert.equal(res.ok, true);
  assert.equal(res.data.title, "Pandekager");
  assert.equal(res.data.tags, "morgenmad, sødt");
  assert.equal(res.data.ingredients, "200 g hvedemel\n4 dl mælk");
  assert.equal(res.data.steps, "Pisk dejen glat.\nSteg tynde pandekager i smør.");
  assert.equal(res.data.note, "");

  assert.equal(parseSmartRecipe("Tilfældig tekst uden opskrift").ok, false);
  assert.equal(parseSmartRecipe("").ok, false);
});

test("partitionRecipes splits active and binned recipes and sorts bin newest-first", () => {
  const ts = (iso) => ({ toDate: () => new Date(iso) });
  const recipes = [
    { id: "a", title: "Aktiv uden felt" },
    { id: "b", title: "Aktiv med null", deletedAt: null },
    { id: "c", title: "Ældre slettet", deletedAt: ts("2026-11-10T10:00:00Z") },
    { id: "d", title: "Nyere slettet", deletedAt: ts("2026-11-12T12:00:00Z") },
  ];

  assert.equal(isRecipeDeleted(recipes[0]), false);
  assert.equal(isRecipeDeleted(recipes[1]), false);
  assert.equal(isRecipeDeleted(recipes[2]), true);

  const { active, trashed } = partitionRecipes(recipes);
  assert.deepEqual(active.map((r) => r.id), ["a", "b"]);
  assert.deepEqual(trashed.map((r) => r.id), ["d", "c"]);
  assert.ok(formatBinDate(recipes[2].deletedAt).length > 0);
  assert.equal(formatBinDate(null), "");
});

