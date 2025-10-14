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
    }
    jc.setAttribute("w:val", alignWordVal);

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
    }
    spacingEl.setAttribute("w:line", lineVal);
    spacingEl.setAttribute("w:lineRule", "auto");

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


  // Apply run + paragraph formatting throughout document.xml (async)
  try {
    await applyRunFormatting(docDom, font, fontSize);
    await applyParagraphFormatting(docDom, alignment, spacing);
    await applySectionMargins(docDom, { top: marginTop, right: marginRight, bottom: marginBottom, left: marginLeft });
  } catch (err) {
    console.warn("Formatting step failed:", err);
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

// sanitize XML strings before writing to zip
const sanitizeXmlBeforeWrite = (xmlString) => {
  if (!xmlString) return '<?xml version="1.0" encoding="UTF-8"?>\n';
  // If the string contains an HTML parsererror wrapper (from DOMParser errors),
  // strip that whole wrapper.
  xmlString = xmlString.replace(/<html[\s\S]*?<parsererror[\s\S]*?<\/parsererror>[\s\S]*?<\/html>/i, "");
  // Remove any BOM
  xmlString = xmlString.replace(/^\uFEFF/, "");
  // collapse multiple XML declarations down to one at start
  xmlString = xmlString.replace(/^\s*(?:<\?xml[\s\S]*?\?>\s*)*/, '<?xml version="1.0" encoding="UTF-8"?>\n');
  return xmlString;
};

// Move media files found at root (media/...) into word/media/ to match rels.
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
const sanitizeRelTargets = async (zip) => {
  try {
    const relFiles = Object.keys(zip.files).filter(p => /^word\/_rels\/.*\.rels$/i.test(p));
    const parser = new DOMParser();
    const serializer = new XMLSerializer();
    const CT_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

    for (const rf of relFiles) {
      const txt = await zip.file(rf).async('text');
      // parse as XML
      const dom = parser.parseFromString(txt, "application/xml");
      const pe = dom.getElementsByTagName('parsererror');
      if (pe && pe.length > 0) {
        console.warn(`Skipping ${rf}: DOMParser produced parsererror (file may be malformed)`);
        continue; // do not re-write a broken rel file
      }

      const rels = dom.getElementsByTagName('Relationship');
      let changed = false;
      for (let i = 0; i < rels.length; i++) {
        const rel = rels[i];
        let t = rel.getAttribute('Target') || '';
        if (!t) continue;
        // strip leading slash
        t = t.replace(/^\/+/, '');
        // if target refers to media/* but not under word/, normalize to media/...
        // (document rels live in word/_rels so "media/..." is correct relative to word/)
        if (/^media\//i.test(t) && !/^word\/media\//i.test(t)) {
          // keep the tail after the first segment, to avoid doubling
          const tail = t.split('/').slice(1).join('/');
          if (tail) t = `media/${tail}`;
        }
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
    }
  } catch (e) {
    console.warn("sanitizeRelTargets failed:", e);
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


const validateXmlPartsInZip = async (zip) => {
  const parser = new DOMParser();
  const xmlFiles = Object.keys(zip.files).filter(p => p.toLowerCase().endsWith('.xml'));
  for (const p of xmlFiles) {
    try {
      const txt = await zip.file(p).async('text');
      const start = txt.indexOf('<?xml');
      const clean = start > 0 ? txt.slice(start) : txt;
      const parsed = parser.parseFromString(clean, "application/xml");
      const pe = parsed.getElementsByTagName('parsererror');
      if (pe && pe.length > 0) {
        const snippet = clean.slice(0, 512).replace(/\n/g, "\\n");
        console.error('XML parse error in', p, (pe[0].textContent || pe[0].innerText), 'snippet:', snippet);
        throw new Error('xml-parse-error:' + p);
      }
    } catch (e) {
      throw e;
    }
  }
  console.log('All XML parts parsed OK in-memory');
};


// 3) Update headers & footers if present (async)
  const fileNames = Object.keys(zip.files);
  const headerFiles = fileNames.filter((p) => /^word\/header.*\.xml$/i.test(p));
  const footerFiles = fileNames.filter((p) => /^word\/footer.*\.xml$/i.test(p));

  for (const hf of headerFiles) {
    const xml = await readText(hf);
    if (!xml) continue;
    const dom = parser.parseFromString(xml, "application/xml");
    await applyFormattingToHeaderFooterDom(dom, font, fontSize, alignment, spacing);
    const out = serializer.serializeToString(dom);
    writeText(hf, ensureXmlDecl(out));
  }
  for (const ff of footerFiles) {
    const xml = await readText(ff);
    if (!xml) continue;
    const dom = parser.parseFromString(xml, "application/xml");
    await applyFormattingToHeaderFooterDom(dom, font, fontSize, alignment, spacing);
    const out = serializer.serializeToString(dom);
    writeText(ff, ensureXmlDecl(out));
  }

  // ensure media lands in word/media/ and rels/content-types are consistent:
await moveRootMediaIntoWord(zip);
await sanitizeRelTargets(zip);
await ensureContentTypesForMedia(zip);

// validate XML parts in-memory (throws if any parse errors)
try {
  await validateXmlPartsInZip(zip);
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
    // only target images inside word/media/
    const m = name.match(/^word\/media\/(.+)\.(png|jpe?g)$/i);
    if (!m) continue;

    const ext = m[2].toLowerCase();
    const file = zip.file(name);
    if (!file) continue;
    try {
      const uint8 = await file.async("uint8array");
      if (uint8.length < minSizeBytes) continue; // skip small images

      // Build blob with guessed mime (keep same format if possible)
      const origMime = (ext === "png") ? "image/png" : "image/jpeg";
      const blob = new Blob([uint8], { type: origMime });

      // createImageBitmap will fail for some exotic images on older Safari; guard it
      let bitmap;
      try {
        bitmap = await createImageBitmap(blob);
      } catch (err) {
        console.warn("createImageBitmap failed, skipping downscale:", name, err);
        continue;
      }

      // compute scale
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

      // choose output mime: prefer jpeg for big images to reduce size
      const outMime = origMime === "image/png" ? "image/png" : "image/jpeg";

      // get the blob (quality param for jpeg)
      const newBlob = await new Promise((res) => {
        // use 0.8 quality for jpeg; for PNG type will ignore quality
        canvas.toBlob(res, outMime, 0.8);
      });
      if (!newBlob) {
        console.warn("canvas.toBlob returned null for", name);
        continue;
      }

      const ab = await newBlob.arrayBuffer();
      // replace the file in the zip with the new ArrayBuffer (binary)
      zip.file(name, ab, { binary: true });

      console.log(`Replaced ${name}: ${uint8.length} → ${ab.byteLength} bytes`);
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
