// Aplica las traducciones YA CONFIRMADAS por el usuario. Ejecutar vía use_figma.
// Rellena FRAME_IDS, DICT (original -> traducción), MODE, LANG y, solo si el usuario lo aprobó, FONT_FALLBACK.
// Si falta una fuente sin fallback aprobado, no crea ni modifica nada y devuelve el error.

const FRAME_IDS = ["4:90"]; // <- sustituir (frames, o sección/página que los contenga)
const DICT = {
  // "Nueva emisión limitada del Plan Ahorro Multiplica": "New limited issue of the Multiplica Savings Plan",
};
const MODE = "duplicate"; // "duplicate" | "overwrite"
const LANG = "EN";
const FONT_FALLBACK = {
  // "Brand Sans|Bold": { family: "Montserrat", style: "Bold" },  // solo con OK del usuario
};
const PENDING_SUFFIX = "_PENDIENTE-FUENTE";
const GAP = 80; // separación en px entre el original y la copia

const key = (f) => `${f.family}|${f.style}`;

function framesOf(root) {
  return root.type === "PAGE" || root.type === "SECTION"
    ? root.children.filter((n) => "findAll" in n)
    : [root];
}
const textsOf = (frame) =>
  frame.findAllWithCriteria({ types: ["TEXT"] }).filter((t) => t.visible && t.characters.trim());

// 1. Reunir frames y comprobar TODAS las fuentes antes de tocar nada.
const sources = [];
for (const id of FRAME_IDS) {
  const root = await figma.getNodeByIdAsync(id);
  if (root && "findAll" in root) sources.push(...framesOf(root));
}

const needed = new Map();
for (const f of sources)
  for (const t of textsOf(f))
    if (DICT[t.characters.trim()] !== undefined)
      for (const s of t.getStyledTextSegments(["fontName"])) needed.set(key(s.fontName), s.fontName);

const missingFonts = [];
const usedFallback = [];
for (const [k, font] of needed) {
  try {
    await figma.loadFontAsync(font);
  } catch (e) {
    const fb = FONT_FALLBACK[k];
    if (!fb) { missingFonts.push(k); continue; }
    await figma.loadFontAsync(fb); // si el fallback tampoco existe, el error se propaga sin haber cambiado nada
    usedFallback.push({ original: k, fallback: key(fb) });
  }
}
if (missingFonts.length) {
  return { aborted: true, reason: "Fuentes no disponibles y sin fallback aprobado", missingFonts };
}
const fallbackFor = new Map(usedFallback.map((u) => [u.original, FONT_FALLBACK[u.original]]));

// 2. Duplicar y aplicar.
const created = [], mutated = [], missingText = new Set(), overflow = [], pendingFont = [];

for (const src of sources) {
  let frame = src;
  if (MODE === "duplicate") {
    frame = src.clone();
    frame.x = src.x + src.width + GAP;
    frame.y = src.y;
    frame.name = `${src.name}_${LANG}`;
    created.push(frame.id);
  }
  let frameUsesFallback = false;

  for (const t of textsOf(frame)) {
    const original = t.characters.trim();
    const translated = DICT[original];
    if (translated === undefined) { missingText.add(original); continue; }

    // Sustituir primero las fuentes no disponibles (solo en la copia y solo con fallback aprobado):
    // un texto con fuente ausente no admite cambios de caracteres hasta cambiarle la fuente.
    for (const s of t.getStyledTextSegments(["fontName"])) {
      const fb = fallbackFor.get(key(s.fontName));
      if (fb) { t.setRangeFontName(s.start, s.end, fb); frameUsesFallback = true; }
    }

    const before = { w: t.width, h: t.height };
    t.characters = translated;
    mutated.push(t.id);

    const b = t.absoluteBoundingBox, f = frame.absoluteBoundingBox;
    const outside = b && f &&
      (b.x < f.x || b.y < f.y || b.x + b.width > f.x + f.width || b.y + b.height > f.y + f.height);
    if (outside || t.height > before.h * 1.05 || t.width > before.w * 1.05)
      overflow.push({ frame: frame.name, frameId: frame.id, text: translated });
  }

  if (frameUsesFallback) {
    if (!frame.name.endsWith(PENDING_SUFFIX)) frame.name += PENDING_SUFFIX;
    pendingFont.push({ frame: frame.name, frameId: frame.id });
  }
}

return {
  createdNodeIds: created,
  mutatedNodeIds: mutated,
  missingText: [...missingText],
  overflow,
  pendingFont,
  usedFallback,
};
