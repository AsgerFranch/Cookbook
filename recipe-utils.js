/**
 * Pure helper functions for parsing, filtering, and normalizing concise recipes.
 */

/**
 * Split multiline textarea input into clean trimmed lines,
 * stripping accidental bullet or numbered list prefixes.
 * @param {string} text
 * @returns {string[]}
 */
export function parseLines(text) {
  if (typeof text !== "string") return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

/**
 * Parse comma-separated tags into unique lowercase tokens, preserving first-seen order.
 * @param {string} text
 * @returns {string[]}
 */
export function parseTags(text) {
  if (typeof text !== "string") return [];
  const seen = new Set();
  const tags = [];
  for (const raw of text.split(",")) {
    const tag = raw.trim().toLowerCase();
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}

/**
 * Validate and normalize form inputs into a Firestore-ready recipe object (without timestamps).
 * @param {{ title?: string, tags?: string, ingredients?: string, steps?: string, note?: string }} input
 * @returns {{ ok: true, data: object } | { ok: false, error: string }}
 */
export function buildRecipePayload(input) {
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  if (!title) {
    return { ok: false, error: "Skriv en titel til opskriften." };
  }

  const ingredients = parseLines(input.ingredients ?? "");
  const steps = parseLines(input.steps ?? "");
  if (ingredients.length === 0 && steps.length === 0) {
    return { ok: false, error: "Tilføj mindst én ingrediens eller ét trin." };
  }

  return {
    ok: true,
    data: {
      title,
      tags: parseTags(input.tags ?? ""),
      ingredients,
      steps,
      note: typeof input.note === "string" ? input.note.trim() : "",
    },
  };
}

/**
 * Collect sorted unique tags with recipe counts.
 * @param {Array<{ tags?: string[] }>} recipes
 * @returns {Array<{ tag: string, count: number }>}
 */
export function collectTags(recipes) {
  const counts = new Map();
  for (const recipe of recipes) {
    for (const tag of recipe.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag, "da"));
}

/**
 * Filter recipes by active tag and search query across title, tags, ingredients, and note.
 * @param {Array<object>} recipes
 * @param {string} query
 * @param {string} activeTag
 * @returns {Array<object>}
 */
export function filterRecipes(recipes, query = "", activeTag = "") {
  const q = query.trim().toLowerCase();
  return recipes.filter((recipe) => {
    if (activeTag && !(recipe.tags ?? []).includes(activeTag)) {
      return false;
    }
    if (!q) return true;
    const haystack = [
      recipe.title ?? "",
      ...(recipe.tags ?? []),
      ...(recipe.ingredients ?? []),
      recipe.note ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

const SECTION_PATTERNS = [
  { key: "title", re: /^(?:titel|title|opskrift)\s*:\s*(.*)$/i },
  { key: "tags", re: /^(?:tags?|kategorier?)\s*:\s*(.*)$/i },
  { key: "ingredients", re: /^(?:ingredienser|ingredients)\s*:\s*(.*)$/i },
  { key: "steps", re: /^(?:fremgangsm[åa]de|tilberedning|instruktioner|trin|steps|instructions|method)\s*:\s*(.*)$/i },
  { key: "note", re: /^(?:noter?|tips?|notes?)\s*:\s*(.*)$/i },
];

/**
 * Parse a structured recipe text block (from the Antigravity opskrift-import skill or plain text)
 * into raw string fields ready to populate the recipe editor form.
 * @param {string} rawText
 * @returns {{ ok: true, data: { title: string, tags: string, ingredients: string, steps: string, note: string } } | { ok: false, error: string }}
 */
export function parseSmartRecipe(rawText) {
  if (typeof rawText !== "string" || !rawText.trim()) {
    return { ok: false, error: "Indsæt en opskrifttekst først." };
  }

  let lines = rawText.replace(/\r\n?/g, "\n").trim().split("\n");
  // Strip wrapping markdown code fences if user copied them along with the block.
  if (/^```/.test(lines[0].trim())) lines.shift();
  if (lines.length && /^```$/.test(lines[lines.length - 1].trim())) lines.pop();

  const buckets = { title: [], tags: [], ingredients: [], steps: [], note: [] };
  let activeSection = null;
  let preambleTitle = "";

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    const headerCandidate = trimmed.replace(/^#{1,6}\s*/, "").replace(/[*_]/g, "");
    let matchedHeader = false;

    for (const { key, re } of SECTION_PATTERNS) {
      const m = headerCandidate.match(re);
      if (m) {
        activeSection = key;
        if (m[1]?.trim()) buckets[key].push(m[1].trim());
        matchedHeader = true;
        break;
      }
    }
    if (matchedHeader) continue;

    if (!activeSection) {
      if (!preambleTitle && trimmed) {
        preambleTitle = trimmed.replace(/^#{1,6}\s*/, "").replace(/^\*{1,2}(.+)\*{1,2}$/, "$1");
      }
      continue;
    }

    if (trimmed) {
      buckets[activeSection].push(trimmed);
    }
  }

  const title = buckets.title.join(" ").trim() || preambleTitle;
  const tags = parseTags(buckets.tags.join(", ")).join(", ");
  const ingredients = parseLines(buckets.ingredients.join("\n")).join("\n");
  const steps = parseLines(buckets.steps.join("\n")).join("\n");
  const note = buckets.note.join("\n").trim();

  if (!title || (!ingredients && !steps)) {
    return {
      ok: false,
      error: "Kunne ikke genkende opskriften. Tjek at Titel og Ingredienser/Fremgangsmåde er med.",
    };
  }

  return { ok: true, data: { title, tags, ingredients, steps, note } };
}

