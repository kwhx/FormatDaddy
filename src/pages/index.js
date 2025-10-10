// pages/index.js
import Head from "next/head";
import { useState, useRef } from "react";
import mammoth from "mammoth";
import { saveAs } from "file-saver";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
} from "docx";

export default function Home() {
  // Form fields and state
  const [file, setFile] = useState(null);
  const [font, setFont] = useState("Times New Roman");
  const [fontSize, setFontSize] = useState(12);
  const [spacing, setSpacing] = useState(1.5);
  const [marginLeft, setMarginLeft] = useState(1.5);
  const [marginRight, setMarginRight] = useState(1.0);
  const [marginTop, setMarginTop] = useState(1.0);
  const [marginBottom, setMarginBottom] = useState(1.0);
  const [alignment, setAlignment] = useState("justify");
  const [status, setStatus] = useState("idle"); // idle, uploading, processing, done
  const [htmlContent, setHtmlContent] = useState("");
  const [docBlob, setDocBlob] = useState(null);
  const fileInputRef = useRef();

  // Handle file selection (drag/drop or click)
  const onFileChange = (f) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".docx")) {
      alert("Please upload a .docx file");
      return;
    }
    setFile(f);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const dt = e.dataTransfer;
    if (dt.files && dt.files.length > 0) {
      onFileChange(dt.files[0]);
      dt.clearData();
    }
  };

  const handleFormat = () => {
    if (!file) {
      alert("No file selected");
      return;
    }
    // Start upload/processing sequence
    setStatus("uploading");
    const reader = new FileReader();
    reader.onload = async (e) => {
      const arrayBuffer = e.target.result;
      // Simulate an upload delay for the progress bar
      await new Promise((r) => setTimeout(r, 1000));
      setStatus("processing");

      // Convert DOCX to HTML (semantic)
      let mammothResult;
      try {
        mammothResult = await mammoth.convertToHtml({ arrayBuffer });
      } catch (err) {
        alert("Error reading DOCX file");
        setStatus("idle");
        return;
      }
      setHtmlContent(mammothResult.value);

      // Parse HTML and build new docx content
      const parser = new DOMParser();
      const htmlDoc = parser.parseFromString(mammothResult.value, "text/html");
      const body = htmlDoc.body;
      const children = [];

      const alignMap = {
        left: AlignmentType.LEFT,
        right: AlignmentType.RIGHT,
        center: AlignmentType.CENTER,
        justify: AlignmentType.JUSTIFIED,
      };
      const alignType = alignMap[alignment] || AlignmentType.JUSTIFIED;
      const lineSpacing = Math.round(spacing * 240); // docx spacing units

      // Helper to create a paragraph from text (with style)
      const makeParagraph = (text, options = {}) => {
        return new Paragraph({
          children: [
            new TextRun({
              text: text,
              font: font,
              size: Math.round(fontSize * 2), // docx uses half-points
            }),
          ],
          alignment: alignType,
          spacing: { line: lineSpacing },
          ...options,
        });
      };

      // Recursively process nodes
      const processNode = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.nodeValue.trim();
          if (text) {
            children.push(makeParagraph(text));
          }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const tag = node.tagName;
          if (tag === "P" || tag.match(/H[1-6]/)) {
            // Paragraph or heading
            const txt = node.textContent || "";
            children.push(makeParagraph(txt));
          } else if (tag === "LI") {
            // List item: prefix bullet char
            const txt = "• " + (node.textContent || "");
            children.push(makeParagraph(txt));
          } else if (tag === "UL" || tag === "OL") {
            // List container: process children
            node.childNodes.forEach(processNode);
          } else if (tag === "TABLE") {
            // Basic table handling: output each cell separated by tabs
            node.querySelectorAll("tr").forEach((tr) => {
              const cells = Array.from(tr.children).map((td) => td.textContent.trim());
              const line = cells.join(" \t ");
              children.push(makeParagraph(line));
            });
          } else if (tag === "IMG") {
            // Skip images for now (could be enhanced)
          } else {
            // Default: process child nodes
            node.childNodes.forEach(processNode);
          }
        }
      };

      // Process all top-level nodes
      body.childNodes.forEach(processNode);

      // Create docx with one section and the specified margins
      const twips = (inches) => inches * 1440;
      const doc = new Document({
        sections: [
          {
            properties: {
              page: {
                margin: {
                  top: twips(marginTop),
                  right: twips(marginRight),
                  bottom: twips(marginBottom),
                  left: twips(marginLeft),
                },
              },
            },
            children: children,
          },
        ],
      });

      // Generate the .docx file blob
      const blob = await Packer.toBlob(doc);
      setDocBlob(blob);
      setStatus("done");
    };
    reader.readAsArrayBuffer(file);
  };

  // UI JSX
  return (
    <div className="container">
      <Head>
        <title>formatdaddy</title>
        <meta name="description" content="Upload. Relax. Submission Ready Formatting in One Click — formatdaddy" />
      </Head>

      <header className="card-header">
        <h1 style={{ textTransform: "lowercase", letterSpacing: "-0.02em" }}>formatdaddy</h1>
        <p className="tagline">Upload. Relax. Submission Ready Formatting in One Click</p>
      </header>

      <div
        className="drop-zone"
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => fileInputRef.current && fileInputRef.current.click()}
      >
        {file ? (
          <p><strong>File:</strong> {file.name}</p>
        ) : (
          <p>Drag &amp; drop a .docx file here, or click to select</p>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx"
          onChange={(e) => onFileChange(e.target.files[0])}
          style={{ display: "none" }}
        />
      </div>

      <div className="form-row">
        <label>Font:</label>
        <input
          type="text"
          value={font}
          onChange={(e) => setFont(e.target.value)}
          placeholder="e.g. Times New Roman"
        />
      </div>

      {/* remaining form rows */}

      <div className="form-row">
        <label>Font Size (pt):</label>
        <input
          type="number"
          value={fontSize}
          step="0.5"
          onChange={(e) => setFontSize(parseFloat(e.target.value) || 0)}
        />
      </div>
      <div className="form-row">
        <label>Line Spacing:</label>
        <input
          type="number"
          value={spacing}
          step="0.1"
          onChange={(e) => setSpacing(parseFloat(e.target.value) || 1)}
        />
      </div>
      <div className="form-row">
        <label>Margin Left (in):</label>
        <input
          type="number"
          value={marginLeft}
          step="0.1"
          onChange={(e) => setMarginLeft(parseFloat(e.target.value) || 0)}
        />
      </div>
      <div className="form-row">
        <label>Margin Right (in):</label>
        <input
          type="number"
          value={marginRight}
          step="0.1"
          onChange={(e) => setMarginRight(parseFloat(e.target.value) || 0)}
        />
      </div>
      <div className="form-row">
        <label>Margin Top (in):</label>
        <input
          type="number"
          value={marginTop}
          step="0.1"
          onChange={(e) => setMarginTop(parseFloat(e.target.value) || 0)}
        />
      </div>
      <div className="form-row">
        <label>Margin Bottom (in):</label>
        <input
          type="number"
          value={marginBottom}
          step="0.1"
          onChange={(e) => setMarginBottom(parseFloat(e.target.value) || 0)}
        />
      </div>
      <div className="form-row">
        <label>Alignment:</label>
        <select value={alignment} onChange={(e) => setAlignment(e.target.value)}>
          <option value="justify">Justified</option>
          <option value="left">Left</option>
          <option value="right">Right</option>
          <option value="center">Center</option>
        </select>
      </div>

      <button className="format-btn" onClick={handleFormat}>
        Format Document
      </button>

      {status === "uploading" && (
        <div className="progress-container">
          <p>Uploading file...</p>
          <div className="progress-bar uploading"></div>
        </div>
      )}
      {status === "processing" && (
        <div className="progress-container">
          <p>Applying formatting...</p>
          <div className="progress-bar processing"></div>
        </div>
      )}
      {status === "done" && docBlob && (
        <div className="download-section">
          <button
            className="download-btn"
            onClick={() => saveAs(docBlob, (file.name || "formatted") + "-formatted.docx")}
          >
            Download Formatted DOCX
          </button>
          <h2>Document Preview:</h2>
          <div
            className="preview"
            dangerouslySetInnerHTML={{ __html: htmlContent }}
          ></div>
        </div>
      )}
    </div>
  );
}
