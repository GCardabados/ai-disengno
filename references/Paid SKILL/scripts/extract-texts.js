// Extrae y etiqueta los textos a traducir + comprueba fuentes. Solo lectura. Ejecutar vía use_figma.
// MASTER_ID: frame de la pieza maestra (sus textos se etiquetan primero, en orden de lectura).
// OTHER_IDS: adaptaciones (frames, o una sección/página que los contenga). Puede ir vacío.
// Devuelve { fields, extra, fonts } — sin estilos ni geometría, para gastar los mínimos tokens.

const MASTER_ID = "4:90"; // <- sustituir
const OTHER_IDS = []; // <- sustituir

function framesOf(root) {
  return root.type === "PAGE" || root.type === "SECTION"
    ? root.children.filter((n) => "findAll" in n)
    : [root];
}

function textsOf(frame) {
  return frame
    .findAllWithCriteria({ types: ["TEXT"] })
    .filter((t) => t.visible && t.characters.trim())
    .sort((a, b) => {
      const A = a.absoluteTransform, B = b.absoluteTransform;
      // Orden de lectura: por filas (tolerancia 8 px) y luego de izquierda a derecha.
      return Math.abs(A[1][2] - B[1][2]) > 8 ? A[1][2] - B[1][2] : A[0][2] - B[0][2];
    });
}

const fontKeys = new Map(); // "Family|Style" -> { family, style, usedIn:Set }
function collectFonts(t, label) {
  for (const seg of t.getStyledTextSegments(["fontName"])) {
    const k = `${seg.fontName.family}|${seg.fontName.style}`;
    if (!fontKeys.has(k)) fontKeys.set(k, { ...seg.fontName, usedIn: new Set() });
    fontKeys.get(k).usedIn.add(label);
  }
}

const seen = new Map(); // texto -> etiqueta
const fields = [];
const extra = [];

function register(t, list) {
  const text = t.characters.trim();
  if (seen.has(text)) {
    collectFonts(t, seen.get(text));
    return;
  }
  const label = `Texto ${seen.size + 1}`;
  seen.set(text, label);
  const mixed = t.getStyledTextSegments(["fontName", "fontWeight", "fills"]).length > 1;
  list.push({ label, layer: t.name, text, ...(mixed && { mixedStyles: true }) });
  collectFonts(t, label);
}

const master = await figma.getNodeByIdAsync(MASTER_ID);
if (!master || !("findAll" in master)) throw new Error(`Pieza maestra ${MASTER_ID} no encontrada`);
for (const t of textsOf(master)) register(t, fields);

for (const id of OTHER_IDS) {
  const root = await figma.getNodeByIdAsync(id);
  if (!root || !("findAll" in root)) continue;
  for (const frame of framesOf(root)) {
    if (frame.id === MASTER_ID) continue;
    for (const t of textsOf(frame)) register(t, extra);
  }
}

// Comprobación de fuentes: se intenta cargar cada una; nunca se sustituye nada aquí.
const fonts = [];
for (const f of fontKeys.values()) {
  let loadable = true;
  try {
    await figma.loadFontAsync({ family: f.family, style: f.style });
  } catch (e) {
    loadable = false;
  }
  fonts.push({ family: f.family, style: f.style, loadable, usedIn: [...f.usedIn] });
}

return { master: master.name, fields, extra, fonts };
