// src/pages/index.js
import Head from "next/head";
import { useState, useRef, useEffect } from "react";
import mammoth from "mammoth";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import styles from "../styles/Home.module.css"; // CSS Module for layout

export default function Home() {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("idle");
  const [htmlContent, setHtmlContent] = useState("");
  const [docBlob, setDocBlob] = useState(null);
  const fileInputRef = useRef();
  // small UI state: sidebar toggle (default open on larger screens)
const [sidebarOpen, setSidebarOpen] = useState(true);

// ref for the download button so we can briefly flash it when formatting completes
const downloadBtnRef = useRef(null);


// ensure sidebar is open on larger screens and reopen when resizing up
useEffect(() => {
  // on mount, sync to initial width
  const syncOpen = () => {
    try {
      // match the CSS breakpoint used in your styles
      if (window.innerWidth >= 880) {
        setSidebarOpen(true);
      }
    } catch (e) {}
  };
  syncOpen();

  // add listener to reopen when resizing to desktop size
  const onResize = () => {
    if (window.innerWidth >= 880) {
      setSidebarOpen(true);
    }
  };
  window.addEventListener("resize", onResize);
  return () => window.removeEventListener("resize", onResize);
}, []); // run once


  // Formatting inputs (restored)
  const [font, setFont] = useState("Times New Roman");
  const [fontSize, setFontSize] = useState(12);
  const [spacing, setSpacing] = useState(1.5); // 1.0, 1.5, etc
  const [marginLeft, setMarginLeft] = useState(1.5);
  const [marginRight, setMarginRight] = useState(1.0);
  const [marginTop, setMarginTop] = useState(1.0);
  const [marginBottom, setMarginBottom] = useState(1.0);
  const [alignment, setAlignment] = useState("justify");

  const MAX_BYTES = 25 * 1024 * 1024;
  const twips = (inches) => Math.round(inches * 1440);

  // Collect mapping imageFileName -> array of extents (objects with cx, cy and xmlPath context) found in a DOM
const collectImageExtentsFromDom = (dom) => {
  const extents = {}; // basename -> [{cx,cy, node}] (node is the <wp:extent> or <a:ext> element)
  // search for <a:blip r:embed="rId..."> occurrences and walk up to find wp:extent or a:ext sibling
  const blips = dom.getElementsByTagName("a:blip");
  for (let i = 0; i < blips.length; i++) {
    const blip = blips[i];
    const rid = blip.getAttribute("r:embed") || blip.getAttribute("r:id") || blip.getAttribute("embed");
    if (!rid) continue;
    // find the <wp:inline> or <wp:anchor> ancestor and its sibling <wp:extent> or within <a:xfrm><a:ext>
    let anc = blip.parentNode;
    while (anc && anc.nodeName !== "wp:inline" && anc.nodeName !== "wp:anchor" && anc.nodeName !== "w:drawing") {
      anc = anc.parentNode;
    }
    if (!anc) continue;
    let extentNode = null;
    // typical patterns:
    // <wp:inline><wp:extent cx="" cy=""/>
    // or nested <a:xfrm><a:ext cx="" cy=""/>
    const possibleExtents = anc.getElementsByTagName("wp:extent");
    if (possibleExtents && possibleExtents.length > 0) extentNode = possibleExtents[0];
    else {
      const ax = anc.getElementsByTagName("a:xfrm");
      if (ax && ax.length > 0) {
        const ae = ax[0].getElementsByTagName("a:ext");
        if (ae && ae.length > 0) extentNode = ae[0];
      }
    }
    // we need to map rid -> target filename: this mapping is resolved later via rels
    if (extentNode) {
      const cx = extentNode.getAttribute("cx");
      const cy = extentNode.getAttribute("cy");
      // stash by rid; resolution to basename will happen later
      if (!extents[rid]) extents[rid] = [];
      extents[rid].push({ cx: cx || null, cy: cy || null });
    }
  }
  return extents; // keyed by rId string
};

// Resolve relationship rId -> target filename for a rels XML text (document or word/_rels/document.xml.rels).
const parseRelsMap = (relsText) => {
  const map = {};
  try {
    const p = new DOMParser();
    const dom = p.parseFromString(relsText, "application/xml");
    const rels = dom.getElementsByTagName("Relationship");
    for (let i = 0; i < rels.length; i++) {
      const r = rels[i];
      const id = r.getAttribute("Id") || r.getAttribute("Id");
      const tgt = r.getAttribute("Target") || '';
      if (id && tgt) {
        // normalize target to basename only
        const name = tgt.split('/').pop();
        map[id] = name;
      }
    }
  } catch (e) {
    // ignore
  }
  return map;
};

// After downscaling/replacing an image file, restore the recorded extents (rId -> cx/cy) into the DOMs
const restoreImageExtentsToDom = (dom, rIdToBasenameMap, rIdExtentsMap) => {
  // for each rId in rIdExtentsMap, if rIdToBasenameMap resolves, apply extents to any <wp:extent> or <a:ext> nodes
  for (const rid in rIdExtentsMap) {
    const entries = rIdExtentsMap[rid];
    // find all blips with that rId in this DOM
    const blips = dom.querySelectorAll(`a\\:blip[r\\:embed="${rid}"], a\\:blip[r\\:id="${rid}"], a\\:blip[embed="${rid}"]`);
    for (let b = 0; b < blips.length; b++) {
      const blip = blips[b];
      let anc = blip.parentNode;
      while (anc && anc.nodeName !== "wp:inline" && anc.nodeName !== "wp:anchor" && anc.nodeName !== "w:drawing") {
        anc = anc.parentNode;
      }
      if (!anc) continue;
      // possible <wp:extent> children
      const possibleExtents = anc.getElementsByTagName("wp:extent");
      if (possibleExtents && possibleExtents.length > 0) {
        // apply the first recorded extent entry
        const e = entries[0];
        if (e.cx) possibleExtents[0].setAttribute("cx", e.cx);
        if (e.cy) possibleExtents[0].setAttribute("cy", e.cy);
        continue;
      }
      // else look for a:xfrm/a:ext
      const ax = anc.getElementsByTagName("a:xfrm");
      if (ax && ax.length > 0) {
        const ae = ax[0].getElementsByTagName("a:ext");
        if (ae && ae.length > 0) {
          const e = entries[0];
          if (e.cx) ae[0].setAttribute("cx", e.cx);
          if (e.cy) ae[0].setAttribute("cy", e.cy);
        }
      }
    }
  }
};

  // Insert these helpers near the top of your file (after twips or where convenient)

// small helper to yield so mobile browsers can breathe
const maybeYield = async (i, batch = 500) => {
  if (i % batch === 0) {
    // yield to event loop
    await new Promise((r) => setTimeout(r, 0));
  }
};

const promiseWithTimeout = (p, ms, onTimeout) => {
  let timer;
  const timeoutPromise = new Promise((_, rej) => {
    timer = setTimeout(() => {
      if (onTimeout) onTimeout();
      rej(new Error("timeout"));
    }, ms);
  });
  return Promise.race([p.then((v) => { clearTimeout(timer); return v; }), timeoutPromise]);
};

// rough mobile detection (works on iPhone/Android)
const isLikelyMobile = () => {
  try {
    if (typeof navigator === "undefined") return false;
    return /Mobi|Android|iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 1);
  } catch (e) {
    return false;
  }
};

  const onFileChange = (f) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".docx")) {
      alert("Please upload a .docx file");
      return;
    }
    if (f.size > MAX_BYTES) {
      alert("File too large — maximum supported client-side upload is 25 MB");
      return;
    }
    setFile(f);
    setDocBlob(null);
    setHtmlContent("");
    setStatus("idle");
  };

  // Helper utilities for XML manipulation (unchanged)
  const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const createEl = (doc, localName) => doc.createElementNS(ns, "w:" + localName);
  const setAttr = (el, name, value) => el.setAttributeNS(ns, "w:" + name, value);

  // Apply run-level formatting: add rPr -> rFonts + sz + szCs
  // Replace your existing applyRunFormatting with this async version
const applyRunFormatting = async (docDom, fontName, fontSizePt) => {
  const rNodes = docDom.getElementsByTagName("w:r");
  const sizeVal = String(Math.round(fontSizePt * 2)); // half-points
  for (let i = 0; i < rNodes.length; i++) {
    const r = rNodes[i];

    let rPr = null;
    for (let j = 0; j < r.childNodes.length; j++) {
      if (r.childNodes[j].nodeName === "w:rPr") {
        rPr = r.childNodes[j];
        break;
      }
    }
    if (!rPr) {
      rPr = createEl(docDom, "rPr");
      r.insertBefore(rPr, r.firstChild);
    }

    let rFonts = null;
    for (let k = 0; k < rPr.childNodes.length; k++) {
      if (rPr.childNodes[k].nodeName === "w:rFonts") {
        rFonts = rPr.childNodes[k];
        break;
      }
    }
    if (!rFonts) {
      rFonts = createEl(docDom, "rFonts");
      rPr.appendChild(rFonts);
    }
    rFonts.setAttribute("w:ascii", fontName);
    rFonts.setAttribute("w:hAnsi", fontName);
    rFonts.setAttribute("w:cs", fontName);

    let sz = null;
    for (let k = 0; k < rPr.childNodes.length; k++) {
      if (rPr.childNodes[k].nodeName === "w:sz") {
        sz = rPr.childNodes[k];
        break;
      }
    }
    if (!sz) {
      sz = createEl(docDom, "sz");
      rPr.appendChild(sz);
    }
    sz.setAttribute("w:val", sizeVal);

    let szCs = null;
    for (let k = 0; k < rPr.childNodes.length; k++) {
      if (rPr.childNodes[k].nodeName === "w:szCs") {
        szCs = rPr.childNodes[k];
        break;
      }
    }
    if (!szCs) {
      szCs = createEl(docDom, "szCs");
      rPr.appendChild(szCs);
    }
    szCs.setAttribute("w:val", sizeVal);

    // yield occasionally on large documents
    await maybeYield(i, 400);
  }
};


  // Apply paragraph formatting: alignment + spacing
  // Replace your applyParagraphFormatting with this async version
// Replace the previous applyParagraphFormatting with this conservative variant
const applyParagraphFormatting = async (docDom, alignmentVal, spacingLines) => {
  const pNodes = docDom.getElementsByTagName("w:p");
  const mapping = { left: "left", right: "right", center: "center", justify: "both" };
  const alignWordVal = mapping[alignmentVal] || "both";
  const lineVal = String(Math.round(spacingLines * 240));

  for (let i = 0; i < pNodes.length; i++) {
    const p = pNodes[i];
    let pPr = null;
    for (let j = 0; j < p.childNodes.length; j++) {
      if (p.childNodes[j].nodeName === "w:pPr") {
        pPr = p.childNodes[j];
        break;
      }
    }
    if (!pPr) {
      pPr = createEl(docDom, "pPr");
      p.insertBefore(pPr, p.firstChild);
    }

    // Only add <w:jc> if it does not already exist (non-destructive)
    let jc = null;
    for (let k = 0; k < pPr.childNodes.length; k++) {
      if (pPr.childNodes[k].nodeName === "w:jc") {
        jc = pPr.childNodes[k];
        break;
      }
    }
    if (!jc) {
      jc = createEl(docDom, "jc");
      pPr.appendChild(jc);
      jc.setAttribute("w:val", alignWordVal);
    }

    // Only add <w:spacing> if it does not already exist (non-destructive)
    let spacingEl = null;
    for (let k = 0; k < pPr.childNodes.length; k++) {
      if (pPr.childNodes[k].nodeName === "w:spacing") {
        spacingEl = pPr.childNodes[k];
        break;
      }
    }
    if (!spacingEl) {
      spacingEl = createEl(docDom, "spacing");
      pPr.appendChild(spacingEl);
      spacingEl.setAttribute("w:line", lineVal);
      spacingEl.setAttribute("w:lineRule", "auto");
    }

    await maybeYield(i, 200);
  }
};


  // Apply section (page) margins in sectPr -> pgMar
// Replace applySectionMargins with async version (fast but still yields once)
const applySectionMargins = async (docDom, margins) => {
  const sectPrs = docDom.getElementsByTagName("w:sectPr");
  if (!sectPrs || sectPrs.length === 0) {
    const body = docDom.getElementsByTagName("w:body")[0];
    const newSect = createEl(docDom, "sectPr");
    body.appendChild(newSect);
    const pgMar = createEl(docDom, "pgMar");
    newSect.appendChild(pgMar);
    pgMar.setAttribute("w:top", String(twips(margins.top)));
    pgMar.setAttribute("w:right", String(twips(margins.right)));
    pgMar.setAttribute("w:bottom", String(twips(margins.bottom)));
    pgMar.setAttribute("w:left", String(twips(margins.left)));
    return;
  }
  const lastSect = sectPrs[sectPrs.length - 1];
  let pgMar = null;
  for (let i = 0; i < lastSect.childNodes.length; i++) {
    if (lastSect.childNodes[i].nodeName === "w:pgMar") {
      pgMar = lastSect.childNodes[i];
      break;
    }
  }
  if (!pgMar) {
    pgMar = createEl(docDom, "pgMar");
    lastSect.appendChild(pgMar);
  }
  pgMar.setAttribute("w:top", String(twips(margins.top)));
  pgMar.setAttribute("w:right", String(twips(margins.right)));
  pgMar.setAttribute("w:bottom", String(twips(margins.bottom)));
  pgMar.setAttribute("w:left", String(twips(margins.left)));

  // tiny yield
  await new Promise((r) => setTimeout(r, 0));
};


  // Apply the same run/para formatting to header/footer XML DOM
// Apply header/footer formatting (async wrapper)
const applyFormattingToHeaderFooterDom = async (dom, fontName, fontSizePt, alignmentVal, spacingLines) => {
  await applyRunFormatting(dom, fontName, fontSizePt);
  await applyParagraphFormatting(dom, alignmentVal, spacingLines);
};


  // Main handler: modify original docx in-place and offer download
// Replace your handleFormat's "processing" below where document parsing & modification happens
const handleFormat = async () => {
  if (!file) {
    alert("No file selected");
    return;
  }

  setStatus("uploading");
  await new Promise((r) => setTimeout(r, 200));
  setStatus("processing");

  // 1) Load zip
  let zip;
  try {
    const ab = await file.arrayBuffer();
    zip = await JSZip.loadAsync(ab);
  } catch (err) {
    console.error("Failed to load zip:", err);
    alert("Failed to read the DOCX file.");
    setStatus("idle");
    return;
  }

  const readText = async (path) => {
    const entry = zip.file(path);
    if (!entry) return null;
    return await entry.async("text");
  };
  const writeText = (path, text) => {
    zip.file(path, text);
  };

  // 2) Parse document.xml and apply formatting (now using async batched functions)
let documentXml = await readText("word/document.xml");
if (!documentXml) {
  alert("Invalid DOCX: missing word/document.xml");
  setStatus("idle");
  return;
}

// Trim any leading bytes before the XML declaration (fixes "XML declaration allowed only at the start" errors)
try {
  const xmlStart = documentXml.indexOf("<?xml");
  if (xmlStart > 0) {
    console.warn("Trimming leading bytes before <?xml in word/document.xml (index " + xmlStart + ")");
    documentXml = documentXml.slice(xmlStart);
  }
  // also trim leading whitespace (just in case)
  documentXml = documentXml.replace(/^\s+/, "");
} catch (e) {
  console.warn("Could not sanitize documentXml before parse:", e);
}

const parser = new DOMParser();
const docDom = parser.parseFromString(documentXml, "application/xml");
if (docDom.getElementsByTagName("parsererror").length > 0) {
  console.warn("document.xml failed to parse cleanly; aborting.");
  alert("Invalid or corrupt DOCX — could not parse document.xml");
  setStatus("idle");
  return;
}
  const fileNames = Object.keys(zip.files);
  const headerFiles = fileNames.filter((p) => /^word\/header.*\.xml$/i.test(p));
  const footerFiles = fileNames.filter((p) => /^word\/footer.*\.xml$/i.test(p));

// capture image extents for document main body
const docRelTxt = await readText("word/_rels/document.xml.rels");
const docRelMap = docRelTxt ? parseRelsMap(docRelTxt) : {};
const docRIdExtents = collectImageExtentsFromDom(docDom);

// capture header/footer extents (if headers exist, parse them first and capture extents)
const headerRIdExtents = {};
for (const hf of headerFiles) {
  const hxml = await readText(hf);
  if (!hxml) continue;
  const hdom = new DOMParser().parseFromString(hxml, "application/xml");
  const x = collectImageExtentsFromDom(hdom);
  // merge into headerRIdExtents
  Object.assign(headerRIdExtents, x);
}
// same for footers
const footerRIdExtents = {};
for (const ff of footerFiles) {
  const fxml = await readText(ff);
  if (!fxml) continue;
  const fdom = new DOMParser().parseFromString(fxml, "application/xml");
  const x = collectImageExtentsFromDom(fdom);
  Object.assign(footerRIdExtents, x);
}

// Capture original table properties so we can restore borders if our edits remove them
const originalDocDom = parser.parseFromString(documentXml, "application/xml");
const originalTblPrs = captureTableTblPrs(originalDocDom);

  // Apply run + paragraph formatting throughout document.xml (async)
  try {
    await applyRunFormatting(docDom, font, fontSize);
    await applyParagraphFormatting(docDom, alignment, spacing);
    await applySectionMargins(docDom, { top: marginTop, right: marginRight, bottom: marginBottom, left: marginLeft });
  } catch (err) {
    console.warn("Formatting step failed:", err);
  }
// restore table tblPrs (borders) if original had them but our transformation removed them
try {
  restoreTableTblPrsIfMissing(docDom, originalTblPrs);
} catch (e) {
  console.warn("Failed to restore table tblPrs:", e);
}

// after: restoreTableTblPrsIfMissing(docDom, originalTblPrs);
try {
  ensureExplicitTableBorders(docDom);
  convertAnchorsToInline(docDom);
} catch (e) {
  console.warn("Post-format doc adjustments failed:", e);
}

try {
  restoreImageExtentsToDom(docDom, docRelMap, docRIdExtents);
} catch (e) {
  console.warn("Failed to restore image extents into document DOM:", e);
}

  // Serialize and write back document.xml
  const serializer = new XMLSerializer();
  const updatedDocumentXml = serializer.serializeToString(docDom);
  // ensure an XML declaration exists (some parsers expect it)
  const ensureXmlDecl = (xmlString) => {
  if (!xmlString) return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  if (xmlString.trim().startsWith("<?xml")) return xmlString;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + xmlString;
};
writeText("word/document.xml", ensureXmlDecl(updatedDocumentXml));

// right after:
// const parser = new DOMParser();
// const serializer = new XMLSerializer();

const tryParseAndSanitize = (rawText, path = '') => {
  const p = new DOMParser();

  // 1) quick trim to first <?xml if present
  const idx = rawText.indexOf('<?xml');
  if (idx > 0) rawText = rawText.slice(idx);

  // 2) remove BOM and leading whitespace
  rawText = rawText.replace(/^\uFEFF/, '').replace(/^\s+/, '');

  // 3) try parse as-is
  let doc = p.parseFromString(rawText, "application/xml");
  if (doc.getElementsByTagName('parsererror').length === 0) {
    return { ok: true, doc, text: rawText };
  }

  // 4) remove HTML parsererror wrapper (whole wrapper or inlined fragment)
  let cleaned = rawText.replace(
    /^(?:\s*<\?xml[\s\S]*?\?>\s*)?(?:\s*)<html[\s\S]*?<parsererror[\s\S]*?<\/parsererror>[\s\S]*?<\/html>\s*$/i,
    ''
  );
  cleaned = cleaned.replace(/<html[\s\S]*?<parsererror[\s\S]*?<\/parsererror>[\s\S]*?<\/html>/ig, '');

  // Add canonical xml declaration at the start for parsing
  const withDecl = cleaned.replace(/^\s*(?:<\?xml[\s\S]*?\?>\s*)*/, '<?xml version="1.0" encoding="UTF-8"?>\n');

  doc = p.parseFromString(withDecl, "application/xml");
  if (doc.getElementsByTagName('parsererror').length === 0) {
    return { ok: true, doc, text: withDecl };
  }

  // final: parsing failed — return failure and original rawText so caller can keep original file
  const pe = doc.getElementsByTagName('parsererror')[0];
  return { ok: false, error: pe, text: rawText };
};
// Capture table properties (tblPr) from a DOM and return an array of serialized tblPr strings (one per table in order)
// Capture table properties (tblPr) from a DOM and return an array of serialized tblPr strings (one per table in order)
function captureTableTblPrs(dom) {
  const tbls = dom.getElementsByTagName("w:tbl");
  const arr = [];
  for (let i = 0; i < tbls.length; i++) {
    const tbl = tbls[i];
    let tblPr = null;
    for (let j = 0; j < tbl.childNodes.length; j++) {
      if (tbl.childNodes[j].nodeName === "w:tblPr") {
        tblPr = tbl.childNodes[j];
        break;
      }
    }
    arr.push(tblPr ? new XMLSerializer().serializeToString(tblPr) : null);
  }
  return arr;
}

// Restore tblPr strings into a DOM where the table at index i has null/absent tblPr but originalTblPrs[i] is present.
// This function only adds tblPr if the current table lacks it (conservative).
function restoreTableTblPrsIfMissing(dom, originalTblPrs) {
  const tbls = dom.getElementsByTagName("w:tbl");
  for (let i = 0; i < tbls.length && i < originalTblPrs.length; i++) {
    const tbl = tbls[i];
    const hasTblPr = Array.from(tbl.childNodes).some(n => n.nodeName === "w:tblPr");
    if (!hasTblPr && originalTblPrs[i]) {
      try {
        // Parse the original tblPr string into a temporary XML document
        const parser = new DOMParser();
        const parsedDoc = parser.parseFromString(originalTblPrs[i], "application/xml");
        const origTblPr = parsedDoc.documentElement;
        // Import the original tblPr node (and its children) into the target DOM so namespaces & structure are preserved
        const imported = dom.importNode(origTblPr, true);
        // Insert imported node at top of table
        tbl.insertBefore(imported, tbl.firstChild);
        console.log("Restored tblPr for table index", i);
      } catch (err) {
        console.warn("Failed to import/restore tblPr for table index", i, err);
      }
    }
  }
}

// Add near your other namespace/constants:
const WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";

// Ensure tables have explicit borders (Quick Look-friendly)
const ensureExplicitTableBorders = (dom) => {
  try {
    const tbls = dom.getElementsByTagName("w:tbl");
    for (let i = 0; i < tbls.length; i++) {
      const tbl = tbls[i];
      // find or create tblPr
      let tblPr = null;
      for (let j = 0; j < tbl.childNodes.length; j++) {
        if (tbl.childNodes[j].nodeName === "w:tblPr") {
          tblPr = tbl.childNodes[j];
          break;
        }
      }
      if (!tblPr) {
        tblPr = createEl(dom, "tblPr");
        tbl.insertBefore(tblPr, tbl.firstChild);
      }

      // if no tblBorders, add a simple visible border set
      const existingBorders = Array.from(tblPr.childNodes).find(n => n.nodeName === "w:tblBorders");
      if (!existingBorders) {
        const tblBorders = createEl(dom, "tblBorders");
        const sides = ["top", "left", "bottom", "right", "insideH", "insideV"];
        for (const s of sides) {
          const el = createEl(dom, s);
          // Single-line black border; tweak w:sz if you want thicker
          el.setAttribute("w:val", "single");
          el.setAttribute("w:sz", "4");        // 4 half-points => 2pt; adjust if needed
          el.setAttribute("w:color", "000000");
          tblBorders.appendChild(el);
        }
        tblPr.appendChild(tblBorders);
      }
    }
  } catch (e) {
    console.warn("ensureExplicitTableBorders failed:", e);
  }
};

// Convert floating/anchored drawings to inline drawings to avoid overlap in previews
const convertAnchorsToInline = (dom) => {
  try {
    // snapshot list because we'll be replacing nodes
    const anchors = Array.from(dom.getElementsByTagName("wp:anchor"));
    for (const anchor of anchors) {
      // create a wp:inline element in the same namespace
      const inline = dom.createElementNS(anchor.namespaceURI || WP_NS, "wp:inline");

      // copy attributes
      for (let a = 0; a < anchor.attributes.length; a++) {
        const at = anchor.attributes[a];
        inline.setAttribute(at.name, at.value);
      }

      // move children into inline (this preserves extent, graphic, etc.)
      while (anchor.firstChild) {
        inline.appendChild(anchor.firstChild);
      }

      // remove any wrapping instructions that only make sense for anchors
      // (e.g. <wp:wrap ...>) — transform them to nothing for inline images
      const wraps = inline.getElementsByTagName("wp:wrap");
      for (let w = wraps.length - 1; w >= 0; w--) {
        const node = wraps[w];
        node.parentNode && node.parentNode.removeChild(node);
      }

      // replace anchor with inline (if anchor has a parent)
      if (anchor.parentNode) {
        anchor.parentNode.replaceChild(inline, anchor);
      }
    }
  } catch (e) {
    console.warn("convertAnchorsToInline failed:", e);
  }
};


// sanitize XML strings before writing to zip
// stronger sanitizer: remove BOM, remove HTML <parsererror> wrapper even if preceded by xml decl,
// collapse duplicate xml declarations, and ensure single xml declaration at start.
const sanitizeXmlBeforeWrite = (xmlString) => {
  if (!xmlString) return '<?xml version="1.0" encoding="UTF-8"?>\n';

  //remove BOM
  xmlString = xmlString.replace(/^\uFEFF/, '');

  //if the string contains an HTML parsererror wrapper (from failed DOMParser.parseFromString),remove it even if there's an XML declaration before it.
  //this matches optional leading xml decl + the whole <html>.. <parsererror> .. </html> block
  xmlString = xmlString.replace(
    /^(?:\s*<\?xml[\s\S]*?\?>\s*)?(?:<!DOCTYPE[\s\S]*?>\s*)?(?:\s*)<html[\s\S]*?<parsererror[\s\S]*?<\/parsererror>[\s\S]*?<\/html>\s*$/i,
    ''
  );
  //ong man, if parsererror appears *inside* the string (not the whole string), remove that fragment.
  xmlString = xmlString.replace(/<html[\s\S]*?<parsererror[\s\S]*?<\/parsererror>[\s\S]*?<\/html>/ig, '');
  //lets collapse any leading whitespace + multiple xml declarations into a single canonical declaration
  xmlString = xmlString.replace(/^\s*(?:<\?xml[\s\S]*?\?>\s*)*/, '<?xml version="1.0" encoding="UTF-8"?>\n');
  return xmlString;
};

//moving media files found at root (media/...) into word/media/ to match rels.
const moveRootMediaIntoWord = async (zip) => {
  try {
    const names = Object.keys(zip.files);
    const rootMedia = names.filter((p) => /^media\/.+$/i.test(p));
    if (rootMedia.length === 0) return;

    // ensure the word/media/ directory will exist (JSZip doesn't really need dirs)
    for (const p of rootMedia) {
      const newPath = 'word/' + p; // e.g. media/image.png -> word/media/image.png
      // read binary content and re-add under word/
      const data = await zip.file(p).async('arraybuffer');
      zip.file(newPath, data, { binary: true });
      // remove old root entry
      zip.remove(p);
      console.log(`Moved ${p} -> ${newPath}`);
    }
  } catch (e) {
    console.warn("moveRootMediaIntoWord failed:", e);
  }
};

// Fix relationship Targets that reference media with leading slashes or wrong relative paths.
// This reads any rel file under word/_rels and rewrites Target values to the expected relative path.
// Fix relationship Targets that reference media with leading slashes or wrong relative paths.
// This reads any rel file under word/_rels and rewrites Target values to the expected relative path.
// Robust sanitizeRelTargets: DOM-first, conservative text fallback if DOMParser fails
const sanitizeRelTargets = async (zip) => {
  try {
    const relFiles = Object.keys(zip.files).filter(p => /^word\/_rels\/.*\.rels$/i.test(p));

    for (const rf of relFiles) {
      try {
        const txt = await zip.file(rf).async('text');

        // Try structured DOM approach first
        try {
          const parser = new DOMParser();
          const serializer = new XMLSerializer();
          const dom = parser.parseFromString(txt, "application/xml");
          const pe = dom.getElementsByTagName('parsererror');
          if (!pe || pe.length === 0) {
            // DOM parsed OK -> normalize Relationship Target attributes
            const rels = dom.getElementsByTagName('Relationship');
            let changed = false;
            for (let i = 0; i < rels.length; i++) {
              const rel = rels[i];
              let t = rel.getAttribute('Target') || '';
              if (!t) continue;

              // strip leading slash(es)
              t = t.replace(/^\/+/, '');

              // normalize /word/media/... or /media/... -> media/...
              t = t.replace(/^(?:word\/)?media\//i, (m) => 'media/');

              if (rel.getAttribute('Target') !== t) {
                const old = rel.getAttribute('Target');
                rel.setAttribute('Target', t);
                changed = true;
                console.log(`Sanitized rel Target in ${rf}: ${old} -> ${t}`);
              }
            }
            if (changed) {
              const out = serializer.serializeToString(dom);
              zip.file(rf, sanitizeXmlBeforeWrite(out));
            }
            continue; // next rel file
          }
          // if parsererror present, fall through to text fallback below
          console.warn(`DOMParser reported parsererror for ${rf}, will use text fallback`);
        } catch (domErr) {
          console.warn(`DOM parse attempt failed for ${rf}:`, domErr);
          // fall through to text fallback below
        }

        // Text fallback (conservative): only touch Target="..." attributes,
        // avoid writing any parsererror HTML back into the ZIP.
        let fixed = txt.replace(/^\uFEFF/, '').replace(/^\s+/, '');

        // Replace Target="/word/media/xxx" or Target="/media/xxx" -> Target="media/xxx"
        fixed = fixed.replace(/Target="\/*(?:word\/)?media\//gi, 'Target="media/');

        // Collapse other leading slashes in Targets: Target="/foo/bar" -> Target="foo/bar"
        fixed = fixed.replace(/Target="\/*([^"]+)"/gi, (m, p1) => `Target="${p1}"`);

        // Ensure we don't accidentally carry HTML parsererror blocks
        fixed = sanitizeXmlBeforeWrite(fixed);

        // write back sanitized text (ensure xml decl)
        zip.file(rf, ensureXmlDecl(fixed));
        console.log(`Applied text-fallback sanitization to ${rf}`);
      } catch (rfErr) {
        console.warn(`Failed to sanitize rel file ${rf}:`, rfErr);
      }
    }
  } catch (e) {
    console.warn("sanitizeRelTargets failed (outer):", e);
  }
};


const ensureContentTypesForMedia = async (zip) => {
  try {
    const ctPath = "[Content_Types].xml";
    let ctText = await readText(ctPath);
    if (!ctText) {
      ctText = '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>';
    }
    const parser = new DOMParser();
    const ctDom = parser.parseFromString(ctText, "application/xml");
    const pe = ctDom.getElementsByTagName('parsererror');
    if (pe && pe.length > 0) {
      console.warn("[Content_Types].xml parse error — skipping content types patch");
      return;
    }

    const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
    const typesEl = ctDom.documentElement;

    const hasDefault = (ext) => {
      const defaults = typesEl.getElementsByTagNameNS(CT_NS, "Default");
      for (let i = 0; i < defaults.length; i++) {
        if (defaults[i].getAttribute("Extension") === ext) return true;
      }
      return false;
    };
    const hasOverride = (partName) => {
      const overrides = typesEl.getElementsByTagNameNS(CT_NS, "Override");
      for (let i = 0; i < overrides.length; i++) {
        if (overrides[i].getAttribute("PartName") === partName) return true;
      }
      return false;
    };
    const ensureDefault = (ext, ct) => {
      if (!hasDefault(ext)) {
        const def = ctDom.createElementNS(CT_NS, "Default");
        def.setAttribute("Extension", ext);
        def.setAttribute("ContentType", ct);
        typesEl.appendChild(def);
      }
    };
    ensureDefault("png", "image/png");
    ensureDefault("jpeg", "image/jpeg");
    ensureDefault("jpg", "image/jpeg");
    ensureDefault("gif", "image/gif");

    const names = Object.keys(zip.files);
    const mediaFiles = names.filter((p) => /^word\/media\/.+\.(png|jpe?g|gif|bmp)$/i.test(p));
    for (const mf of mediaFiles) {
      const partName = `/${mf}`;
      if (!hasOverride(partName)) {
        const ext = mf.split('.').pop().toLowerCase();
        let contentType = "application/octet-stream";
        if (ext === "png") contentType = "image/png";
        else if (ext === "jpg" || ext === "jpeg") contentType = "image/jpeg";
        else if (ext === "gif") contentType = "image/gif";
        else if (ext === "bmp") contentType = "image/bmp";

        const ov = ctDom.createElementNS(CT_NS, "Override");
        ov.setAttribute("PartName", partName);
        ov.setAttribute("ContentType", contentType);
        typesEl.appendChild(ov);
        console.log(`Added Override for ${partName} -> ${contentType}`);
      }
    }

    const patched = new XMLSerializer().serializeToString(ctDom);
    zip.file(ctPath, ensureXmlDecl(sanitizeXmlBeforeWrite(patched)));
    console.log("[Content_Types].xml patched for media entries");
  } catch (e) {
    console.warn("Failed to ensure content types:", e);
  }
};


// Enhanced validator + debug dump
const validateXmlPartsInZipWithDebug = async (zip) => {
  const parser = new DOMParser();
  const xmlFiles = Object.keys(zip.files).filter(p => p.toLowerCase().endsWith('.xml'));
  const failures = [];

  for (const p of xmlFiles) {
    try {
      const txt = await zip.file(p).async('text');
      // trim stray bytes before xml declaration
      const start = txt.indexOf('<?xml');
      const clean = start > 0 ? txt.slice(start) : txt;
      const parsed = parser.parseFromString(clean, "application/xml");
      const pe = parsed.getElementsByTagName('parsererror');
      if (pe && pe.length > 0) {
        const errText = (pe[0].textContent || pe[0].innerText || pe[0].innerHTML || "").slice(0, 2000);
        const snippet = clean.slice(0, 4000);
        console.error(`XML parse error in ${p}: ${errText}`);
        console.error(`Snippet for ${p}:\n`, snippet);
        failures.push({ path: p, error: errText, snippet });
      }
    } catch (e) {
      // unexpected read/parse failure
      console.error(`Exception validating ${p}:`, e && e.message ? e.message : e);
      const txt = (await zip.file(p).async('text').catch(()=>null)) || '';
      failures.push({ path: p, error: (e && e.message) || String(e), snippet: txt.slice(0,4000) });
    }
  }

  if (failures.length > 0) {
    // build debug zip for download (so you can inspect on desktop)
    try {
      const debugZip = new JSZip();
      // add failing parts
      failures.forEach((f, idx) => {
        debugZip.file(`failures/${idx}-${f.path.replace(/\//g, '_')}.xml`, f.snippet || '');
      });
      // add short diagnostic text
      const diagLines = failures.map(f => `FILE: ${f.path}\nERROR: ${f.error}\n---\n`).join('\n');
      debugZip.file('diagnostic.txt', diagLines + `\nUser agent: ${navigator.userAgent}\nOriginal file: ${(file && file.name) || 'n/a'}`);

      // add the full generated DOCX (pack the current zip)
      try {
        const generatedBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: false });
        debugZip.file('generated.docx', generatedBlob);
      } catch (genErr) {
        // if packing generated.zip fails, add the textual listing instead
        debugZip.file('pack-failed.txt', 'Failed to pack generated DOCX: ' + String(genErr));
      }

      const debugBlob = await debugZip.generateAsync({ type: 'blob' });
      // Download automatically (works on iPhone Safari as user-initiated code path during button click)
      saveAs(debugBlob, 'docx-debug.zip');
      console.warn('Validation failed — downloaded docx-debug.zip with failing parts and generated.docx for inspection.');
    } catch (dbgErr) {
      console.error('Failed to build/download debug zip:', dbgErr);
    }

    // Throw so your existing catch shows the alert and aborts
    throw new Error('xml-validation-failed: ' + failures.map(f => f.path).join(','));
  }

  // no failures -> OK
  console.log('All XML parts parsed OK in-memory');
};

// For headers/footers you must parse the xml again into a DOM, call restoreImageExtentsToDom, and serialize/write back the header/footer file.
// (Integrate this inside the header/footer loops you already have.)

// 3) Update headers & footers if present (async)

// safer header/footer parse + sanitize + write flow
for (const hf of headerFiles) {
  const xml = await readText(hf);
  if (!xml) continue;

  const parsed = tryParseAndSanitize(xml, hf);
  if (!parsed.ok) {
    console.warn(`Failed to parse ${hf} even after sanitization — keeping original (no overwrite).`, parsed.error && parsed.error.textContent);
    // Do not write broken parsererror HTML back into the zip.
    continue;
  }

  // parsed.doc is a safe DOM we can modify
// parsed.doc is a safe DOM we can modify
const dom = parsed.doc;
try {
  await applyFormattingToHeaderFooterDom(dom, font, fontSize, alignment, spacing);

  // restore extents for images referenced in this header (non-fatal)
  try {
    restoreImageExtentsToDom(dom, docRelMap, headerRIdExtents);
  } catch (re) {
    console.warn(`Failed to restore header image extents for ${hf}:`, re);
  }

} catch (e) {
  console.warn(`applyFormattingToHeaderFooterDom failed for ${hf}:`, e);
  // If formatting fails, keep original instead of writing broken output
  continue;
}
// inside header loop, before serialize/write
ensureExplicitTableBorders(dom);
convertAnchorsToInline(dom);
const out = new XMLSerializer().serializeToString(dom);
zip.file(hf, ensureXmlDecl(sanitizeXmlBeforeWrite(out)));
}

for (const ff of footerFiles) {
  const xml = await readText(ff);
  if (!xml) continue;

  const parsed = tryParseAndSanitize(xml, ff);
  if (!parsed.ok) {
    console.warn(`Failed to parse ${ff} even after sanitization — keeping original (no overwrite).`, parsed.error && parsed.error.textContent);
    continue;
  }

const dom = parsed.doc;
try {
  await applyFormattingToHeaderFooterDom(dom, font, fontSize, alignment, spacing);

  // restore extents for images referenced in this footer (non-fatal)
  try {
    restoreImageExtentsToDom(dom, docRelMap, footerRIdExtents);
  } catch (re) {
    console.warn(`Failed to restore footer image extents for ${ff}:`, re);
  }

} catch (e) {
  console.warn(`applyFormattingToHeaderFooterDom failed for ${ff}:`, e);
  continue;
}
// inside header loop, before serialize/write
ensureExplicitTableBorders(dom);
convertAnchorsToInline(dom);

const out = new XMLSerializer().serializeToString(dom);
zip.file(ff, ensureXmlDecl(sanitizeXmlBeforeWrite(out)));
}


  // ensure media lands in word/media/ and rels/content-types are consistent:
await moveRootMediaIntoWord(zip);
await sanitizeRelTargets(zip);
await ensureContentTypesForMedia(zip);

// validate XML parts in-memory (throws if any parse errors)
try {
  await validateXmlPartsInZipWithDebug(zip);
} catch (validationErr) {
  console.error("Validation failed for generated archive:", validationErr);
  alert("Formatting failed: generated DOCX could not be validated. See console for details.");
  setStatus("idle");
  return; // abort — do not generate / hand out corrupted docx
}

  // 4) Generate new docx blob from zip and produce preview from that same blob
  // helper: downscale large images inside the zip (client-side)
const downscaleImagesInZip = async (zip, opts = {}) => {
  const {
    maxDimension = 2048,   // largest side (px); lower on mobile
    minSizeBytes = 150 * 1024 // only downscale images bigger than this
  } = opts;

  const names = Object.keys(zip.files);
  for (const name of names) {
    const m = name.match(/^word\/media\/(.+)\.(png|jpe?g)$/i);
    if (!m) continue;
    const basename = m[1];
    const ext = m[2].toLowerCase();
    const file = zip.file(name);
    if (!file) continue;
    try {
      const uint8 = await file.async("uint8array");
      if (uint8.length < minSizeBytes) continue; // skip small images

      // Build blob with guessed mime (keep same format if possible)
      const origMime = (ext === "png") ? "image/png" : "image/jpeg";
      const blob = new Blob([uint8], { type: origMime });

      // For PNGs, do a quick check for alpha / transparency. If alpha present, skip downscaling to avoid layout/visual changes.
      if (ext === "png") {
        // quick header check for color type requires parsing IHDR chunk: not super-light, so we do a soft approach:
        // createImageBitmap and inspect pixels for alpha (works in supported browsers)
        let bmp;
        try {
          bmp = await createImageBitmap(blob);
        } catch (err) {
          console.warn("createImageBitmap failed for", name, "— skipping downscale", err);
          continue;
        }
        // create an offscreen canvas to sample a few pixels to detect alpha presence cheaply
        const cw = Math.min(32, bmp.width);
        const ch = Math.min(32, bmp.height);
        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bmp, 0, 0, cw, ch);
        const px = ctx.getImageData(0, 0, cw, ch).data;
        let hasAlpha = false;
        for (let i = 3; i < px.length; i += 4) {
          if (px[i] < 255) { hasAlpha = true; break; }
        }
        bmp.close && bmp.close();
        if (hasAlpha) {
          console.log("PNG has alpha; skipping downscale to preserve transparency:", name);
          continue; // skip downscale for transparent PNG
        }
        // else we can continue to downscale as PNG
      }

      // createImageBitmap will fail for some exotic images on older Safari; guard it
      let bitmap;
      try {
        bitmap = await createImageBitmap(blob);
      } catch (err) {
        console.warn("createImageBitmap failed, skipping downscale:", name, err);
        continue;
      }

      const largestSide = Math.max(bitmap.width, bitmap.height);
      if (largestSide <= maxDimension) {
        bitmap.close && bitmap.close();
        continue; // no downscale needed
      }

      const scale = maxDimension / largestSide;
      const targetW = Math.round(bitmap.width * scale);
      const targetH = Math.round(bitmap.height * scale);

      // draw to canvas
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);
      bitmap.close && bitmap.close();

      // keep same format as original: PNG -> PNG, JPG -> JPG (so we don't change transparency or cause layout quirks)
      const outMime = origMime;

      // get the blob (quality param for jpeg only)
      const newBlob = await new Promise((res) => {
        canvas.toBlob(res, outMime, ext === "png" ? undefined : 0.8);
      });
      if (!newBlob) {
        console.warn("canvas.toBlob returned null for", name);
        continue;
      }

      const ab = await newBlob.arrayBuffer();
      // replace the file in the zip with the new ArrayBuffer (binary)
      zip.file(name, ab, { binary: true });

      console.log(`Downscaled ${name}: ${uint8.length} → ${ab.byteLength} bytes`);
      // small yield so mobile devices don't freeze
      await new Promise((r) => setTimeout(r, 0));
    } catch (e) {
      console.warn("Failed to downscale", name, e);
      // don't throw — if downscale fails, leave original image in place
    }
  }
};

// Downscale images (especially for mobile) before packaging
const imgMaxDim = isLikelyMobile() ? 1400 : 2048;
await downscaleImagesInZip(zip, { maxDimension: imgMaxDim, minSizeBytes: 120 * 1024 });

  // --- ZIP generate + validation (DEFLATE first, fallback to STORE) ---
try {
  const tryGenerate = async (opts) => {
    return await zip.generateAsync(opts);
  };

  let finalBlob = null;
  const msTimeout = 25000; // 25s for generation (adjust if needed)

  // Attempt DEFLATE first (no streaming) — most compatible
  try {
    const blob = await promiseWithTimeout(
      tryGenerate({ type: "blob", compression: "DEFLATE", streamFiles: false }),
      msTimeout
    );

    // validate by trying to open the produced blob
    try {
      await JSZip.loadAsync(blob);
      finalBlob = blob;
      console.log("Zip generation: DEFLATE produced a valid archive");
    } catch (valErr) {
      console.warn("DEFLATE produced archive failed JSZip validation:", valErr);
    }
  } catch (errDE) {
    console.warn("DEFLATE generateAsync timed out or errored; will attempt STORE:", errDE);
  }

  // fallback: STORE (no compression) — still no streaming
  if (!finalBlob) {
    try {
      const blob = await promiseWithTimeout(
        tryGenerate({ type: "blob", compression: "STORE", streamFiles: false }),
        msTimeout
      );
      // validate
      await JSZip.loadAsync(blob); // throws if invalid
      finalBlob = blob;
      console.log("Zip generation: STORE produced a valid archive (fallback)");
    } catch (errStore) {
      console.error("Both DEFLATE and STORE generation failed or timed out:", errStore);
      throw errStore;
    }
  }

  // wrap in docx MIME type (helps iOS Quick Look)
  const typedDocx = new Blob([await finalBlob.arrayBuffer()], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  });

  // Optional debug: list some top-level entries so you can inspect logs
  try {
    const check = await JSZip.loadAsync(typedDocx);
    console.log("Generated docx entries:", Object.keys(check.files).slice(0, 30));
  } catch (chkErr) {
    console.warn("Validation read-back failed after final blob:", chkErr);
    // we already validated above; if this fails here, still continue to hand user the file
  }

  // Attempt preview with mammoth (non-blocking, timed)
  try {
    const modifiedArrayBuffer = await typedDocx.arrayBuffer();
    const mammothPromise = mammoth.convertToHtml({ arrayBuffer: modifiedArrayBuffer }, {
      convertImage: mammoth.images.inline((image) => image.read("base64").then(b64 => ({ src: `data:${image.contentType};base64,${b64}` })))
    });
    const mammothResult = await promiseWithTimeout(mammothPromise, 12000); // 12s preview timeout
    setHtmlContent(mammothResult.value);
  } catch (previewErr) {
    console.warn("Preview failed or timed out — continuing with download-ready file:", previewErr);
  }

  setDocBlob(typedDocx);
  setStatus("done");
} catch (err) {
  console.error("Failed to generate or validate DOCX:", err);
  alert("Failed to generate formatted DOCX: " + (err && err.message ? err.message : String(err)));
  setStatus("idle");
}

}; // handleFormat


  return (
    <div className={styles.pageContainer}>
      <Head>
        <title>formatdaddy — in-place formatting</title>
      </Head>
{/* Reveal button - shown when sidebar is closed (only useful on small screens) */}
{!sidebarOpen && (
  <button
    type="button"
    onClick={() => setSidebarOpen(true)}
    className={styles.sidebarReveal}
    aria-label="Open formatting sidebar"
  >
    ☰
  </button>
)}

      {/* Left fixed sidebar with formatting controls */}
      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.open : styles.closed}`}>
        <h2>formatdaddy</h2>
        {/* small toggle button (visible on small screens via CSS) */}
<button
  type="button"
  className={styles.sidebarToggle}
  onClick={() => setSidebarOpen(s => !s)}
  aria-expanded={sidebarOpen}
  aria-label={sidebarOpen ? "Collapse sidebar" : "Open sidebar"}
>
  {sidebarOpen ? "✕" : "☰"}
</button>
        <div className="tagline muted">Upload. Relax. Submission Ready Formatting in One Click</div>

        <div className="formGroup">
          <label>Font</label>
          <input className="input" value={font} onChange={(e) => setFont(e.target.value)} />
        </div>

        <div className="formGroup">
          <label>Font Size (pt)</label>
          <input
            className="input"
            type="number"
            value={fontSize}
            onChange={(e) => setFontSize(parseFloat(e.target.value) || 10)}
          />
        </div>

        <div className="formGroup">
          <label>Line Spacing</label>
          <input
            className="input"
            type="number"
            step="0.1"
            value={spacing}
            onChange={(e) => setSpacing(parseFloat(e.target.value) || 1)}
          />
        </div>

        <div className="formGroup">
          <label>Alignment</label>
          <select className="input" value={alignment} onChange={(e) => setAlignment(e.target.value)}>
            <option value="justify">Justified</option>
            <option value="left">Left</option>
            <option value="right">Right</option>
            <option value="center">Center</option>
          </select>
        </div>

        <div className="formGroup">
          <label>Margin Left (in)</label>
          <input
            className="input"
            type="number"
            step="0.1"
            value={marginLeft}
            onChange={(e) => setMarginLeft(parseFloat(e.target.value) || 0)}
          />
        </div>

        <div className="formGroup">
          <label>Margin Right (in)</label>
          <input
            className="input"
            type="number"
            step="0.1"
            value={marginRight}
            onChange={(e) => setMarginRight(parseFloat(e.target.value) || 0)}
          />
        </div>

        <div className="formGroup">
          <label>Margin Top (in)</label>
          <input
            className="input"
            type="number"
            step="0.1"
            value={marginTop}
            onChange={(e) => setMarginTop(parseFloat(e.target.value) || 0)}
          />
        </div>

        <div className="formGroup">
          <label>Margin Bottom (in)</label>
          <input
            className="input"
            type="number"
            step="0.1"
            value={marginBottom}
            onChange={(e) => setMarginBottom(parseFloat(e.target.value) || 0)}
          />
        </div>

        {/* Sidebar actions: both use the polished primary CTA style */}
        <div className="actions">
          <button
            className="btn btn--primary"
            onClick={handleFormat}
            aria-disabled={status === "processing" || status === "uploading"}
          >
            Format Document
          </button>

          {status === "done" && docBlob && (
            <button
   ref={downloadBtnRef}
   className="btn btn--primary"
   onClick={() => saveAs(docBlob, (file?.name || "formatted") + "-formatted.docx")}
   style={{ marginTop: 8 }}
 >
   Download Formatted DOCX
 </button>
          )}
        </div>

        <div style={{ marginTop: 12 }}>
          <div className="muted" style={{ fontSize: 13 }}>
            Status: {status}
          </div>
        </div>
      </aside>

      {/* Right workspace */}
      <main className={styles.workspace}>
        {/* Upload area (top 30%) */}
        <section className={styles.upload}>
          <div
            className={styles.dropZone}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const dt = e.dataTransfer;
              if (dt.files && dt.files.length > 0) {
                onFileChange(dt.files[0]);
                dt.clearData();
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
          >
            {file ? (
              <p><strong>File:</strong> {file.name} ({(file.size / 1024).toFixed(1)} KB)</p>
            ) : (
              <p>Drag & drop a .docx file here, or click to select</p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".docx"
              style={{ display: "none" }}
              onChange={(e) => onFileChange(e.target.files[0])}
            />
          </div>

          {/* Progress indicators similar to your original project */}
          {status === "uploading" && (
            <div className="progress-container" style={{ width: "100%", marginTop: 12 }}>
              <p className="progress-label">Uploading file...</p>
              <div className="progress-bar uploading" />
            </div>
          )}
          {status === "processing" && (
            <div className="progress-container" style={{ width: "100%", marginTop: 12 }}>
              <p className="progress-label">Applying formatting...</p>
              <div className="progress-bar processing" />
            </div>
          )}
        </section>

        {/* Preview area (bottom 70%) — scrolls internally */}
        <section className={styles.preview}>
          {status === "processing" && <div className="muted">Processing... please wait</div>}

          {status !== "done" && htmlContent === "" && (
            <div className="muted">Preview will appear here after formatting. Use the controls on the left and click “Format Document”.</div>
          )}

          {htmlContent && (
            <div dangerouslySetInnerHTML={{ __html: htmlContent }} />
          )}
        </section>
      </main>
    </div>
  );
}
