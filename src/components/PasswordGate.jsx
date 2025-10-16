// src/components/PasswordGate.jsx
"use client";
import React, { useState } from "react";
import styles from "../styles/PasswordGate.module.css";

const SECRET_PASSWORD = "iownyou";

export default function PasswordGate({ children }) {
  const [unlocked, setUnlocked] = useState(false);
  const [pw, setPw] = useState("");
  const [attempted, setAttempted] = useState(false);

  const tryUnlock = (ev) => {
    ev && ev.preventDefault();
    setAttempted(true);
    if (pw === SECRET_PASSWORD) {
      // NOTE: no sessionStorage write — require password every time
      setUnlocked(true);
    } else {
      setPw("");
      setTimeout(() => setAttempted(false), 500);
    }
  };

  // Locked: do NOT mount children. Render a full-viewport blurred LOOKALIKE placeholder.
  if (!unlocked) {
    return (
      <div className={styles.container}>
        {/* Full-viewport "blur" placeholder (visual only) */}
        <div className={styles.placeholder} aria-hidden="true">
          <div className={styles.placeholderInner}>
            <div className={styles.phHeader} />
            <div className={styles.phHero} />
            <div className={styles.phBlocks}>
              <div className={styles.phBlock} />
              <div className={styles.phBlockShort} />
              <div className={styles.phBlock} />
            </div>
          </div>
        </div>

        {/* overlay dialog */}
        <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Access password">
          <div className={styles.card}>
            <div className={styles.logo}>  <img src="/logo-formatdaddy.svg" alt="FormatDaddy: your assignment's final touch" className={styles.logoImage} /></div>
            <h2 className={styles.title}>Enter access password</h2>
            <p className={styles.subtitle}>This tool is private. Enter the password to continue.</p>

            <form onSubmit={tryUnlock} className={styles.form}>
              <input
                className={`${styles.input} ${attempted ? styles.inputError : ""}`}
                autoFocus
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                type="password"
                placeholder="Password"
                aria-label="Password"
              />
              <div className={styles.actions}>
                <button type="submit" className={styles.primaryBtn}>Unlock</button>
                <button type="button" onClick={() => setPw("")} className={styles.ghostBtn}>Clear</button>
              </div>
            </form>

            <div className={styles.hint}>This is a private demo. Keep the password safe.</div>
          </div>
        </div>
      </div>
    );
  }

  // unlocked -> render children (children may be function or node)
  if (typeof children === "function") {
    try {
      return children(true);
    } catch (e) {
      console.error("[PasswordGate] children function error", e);
      return null;
    }
  }
  return <>{children}</>;
}
