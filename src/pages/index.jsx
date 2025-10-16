// src/pages/index.jsx
import Head from "next/head";
import Link from "next/link";
import { useEffect } from "react";
import styles from "../styles/Landing.module.css";


const OWNER_GITHUB = "https://github.com/0xrootAnon";

export default function Landing() {
// Replace your existing useEffect(...) with this block
useEffect(() => {
  let onScroll;
  let pollTimer = null;
  let pollCount = 0;
  const POLL_INTERVAL = 250; // ms
  const POLL_MAX = Math.ceil(6000 / POLL_INTERVAL); // poll for up to ~6s

  try {
    const headerEl = document.querySelector(`.${styles.header}`);
    const revealElements = Array.from(document.querySelectorAll(`.${styles.reveal}`));
    const prefersReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const allRevealed = () => revealElements.every((el) => el.classList.contains(styles.revealed));

    const checkReveal = () => {
      if (!revealElements.length) return;
      revealElements.forEach((el) => {
        if (el.classList.contains(styles.revealed)) return;
        try {
          const rect = el.getBoundingClientRect();
          if (rect.top < window.innerHeight * 0.95) {
            el.classList.add(styles.revealed);
          }
        } catch (e) {
          // if measuring fails, just reveal to avoid permanent invisibility
          el.classList.add(styles.revealed);
        }
      });
    };

    // header scroll toggle + fallback reveal when IntersectionObserver not present
    onScroll = () => {
      const y = window.scrollY || window.pageYOffset || 0;
      if (headerEl) {
        if (y > 20) headerEl.classList.add(styles.headerScrolled);
        else headerEl.classList.remove(styles.headerScrolled);
      }
      if (!("IntersectionObserver" in window)) checkReveal();
    };

    window.addEventListener("scroll", onScroll);
    window.addEventListener("resize", onScroll);
    onScroll(); // initial run

    // run immediate check
    checkReveal();

    // IntersectionObserver if available
    let observer = null;
    if ("IntersectionObserver" in window && revealElements.length) {
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add(styles.revealed);
              observer.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.12 }
      );

      revealElements.forEach((el) => {
        try {
          const rect = el.getBoundingClientRect();
          if (rect.top < window.innerHeight * 0.95) {
            el.classList.add(styles.revealed);
          } else {
            if (!prefersReduced) observer.observe(el);
          }
        } catch (e) {
          el.classList.add(styles.revealed);
        }
      });
    }

    // Polling fallback: in case observer callbacks are delayed because main thread is busy
    if (!allRevealed()) {
      pollTimer = setInterval(() => {
        pollCount += 1;
        checkReveal();
        // stop polling when all revealed or max reached
        if (allRevealed() || pollCount >= POLL_MAX) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      }, POLL_INTERVAL);
    }

    // Also respond to visibility / pageshow events (mobile throttling can delay things)
    const onVisibility = () => {
      checkReveal();
      // if tab becomes visible again, restart a short poll to catch up
      if (!allRevealed() && !pollTimer) {
        pollCount = 0;
        pollTimer = setInterval(() => {
          pollCount += 1;
          checkReveal();
          if (allRevealed() || pollCount >= POLL_MAX) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
        }, POLL_INTERVAL);
      }
    };
    window.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onVisibility);

    // cleanup
    return () => {
      if (observer) observer.disconnect();
      if (onScroll) {
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
      }
      window.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onVisibility);
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };
  } catch (e) {
    // if something throws, ensure we don't leave listeners around
    if (onScroll) {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

// add (or paste) inside your Landing component, near other useEffect calls

// REPLACE the existing useEffect that adjusts the logo offset with this block
useEffect(() => {
  if (typeof window === "undefined") return;

  const LOGO_ID = "formatdaddy-logo";
  const CTA_SELECTOR = ".cta, a.cta, .primary, a.primary";
  const MOBILE_BREAKPOINT = 740;

  const applyLogoOffset = () => {
    const logoWrap = document.getElementById(LOGO_ID);
    if (!logoWrap) return;

    // mobile: enforce centered / static placement (use !important so stylesheet cannot override)
    if (window.innerWidth <= MOBILE_BREAKPOINT) {
      logoWrap.style.setProperty("position", "static", "important");
      logoWrap.style.setProperty("left", "auto", "important");
      logoWrap.style.setProperty("top", "auto", "important");
      logoWrap.style.setProperty("z-index", "", "important");
      // ensure image uses mobile width
      const img = logoWrap.querySelector("img");
      if (img) img.style.setProperty("width", "140px", "important");
      return;
    }

    // desktop: find CTA and compute inset
    const cta = document.querySelector(CTA_SELECTOR);
    const header = document.querySelector("header");
    let ctaRect = null;

    if (cta) {
      ctaRect = cta.getBoundingClientRect();
    } else if (header) {
      // fallback: right-most element inside header
      const rightMost = Array.from(header.querySelectorAll("*")).reduce((acc, el) => {
        const r = el.getBoundingClientRect();
        if (!acc || r.left > acc.left) return { el, left: r.left, right: r.right };
        return acc;
      }, null);
      if (rightMost) ctaRect = rightMost.el.getBoundingClientRect();
    }

    // default inset (header padding) if CTA not found
    let inset = 36;
    if (ctaRect) {
      const distanceFromRight = Math.round(window.innerWidth - ctaRect.right);
      inset = distanceFromRight;
    }

    // Apply position using CSS priority so it overrides any stylesheet !important
    logoWrap.style.setProperty("position", "fixed", "important");
    logoWrap.style.setProperty("top", "12px", "important");
    logoWrap.style.setProperty("left", `${inset}px`, "important");
    logoWrap.style.setProperty("z-index", "9999", "important");
    // ensure logo image width is maintained
    const logoImg = logoWrap.querySelector("img");
    if (logoImg) {
      logoImg.style.setProperty("width", "500px", "important");
      logoImg.style.setProperty("height", "auto", "important");
    }
  };

  // run immediately and shortly after load
  applyLogoOffset();
  const lateTimer = setTimeout(applyLogoOffset, 350);

  // recompute on resize/orientation (debounced)
  let t = null;
  const onResize = () => {
    clearTimeout(t);
    t = setTimeout(applyLogoOffset, 80);
  };
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);

  return () => {
    window.removeEventListener("resize", onResize);
    window.removeEventListener("orientationchange", onResize);
    clearTimeout(t);
    clearTimeout(lateTimer);
  };
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []);



  return (
    <>
      <Head>
        <title>formatDaddy</title>
        <meta name="description" content="FormatDaddy fast, privacy-first formatting tools that keep your files on your device." />
      </Head>

      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.brand}>
<div id="formatdaddy-logo" className={styles.logo}>
  <img src="/logo-formatdaddy.svg" alt="FormatDaddy: your assignment's final touch" className={styles.logoImage} />
</div>
          </div>

          <nav className={styles.nav}>
            <a className={styles.navLink} href="#about">About</a>
            <a className={styles.navLink} href="#how">How it works</a>
            <Link href="/tool" className={styles.cta} prefetch={false}>Try the tool</Link>
          </nav>
        </header>

        {/* HERO — intentionally NOT a reveal element */}
        <main className={styles.heroWrap}>
          <section className={styles.hero}>
            <div className={styles.heroCard}>
              <div className={styles.heroContent}>
                <h1 className={styles.h1}>Submission ready formatting, done for You</h1>

                <p className={styles.lead}>
                  Get perfectly formatted assignments in seconds. Private, Local, and Effortless. Set
                  preferences, click format, and download. No uploads. No accounts.
                </p>

                <div className={styles.ctaRow}>
                  <Link href="/tool" prefetch={false} className={`${styles.primary} ${styles.button}`}>Upload & Format</Link>
                  <a href="#about" className={styles.ghost}>Learn more</a>
                </div>

                <ul className={styles.features}>
                  <li>Private: everything runs on your device</li>
                  <li>Fast: instant preview & download</li>
                  <li>Simple: presets and one-click formatting</li>
                </ul>
              </div>

              <div className={styles.mockWrap} aria-hidden="true">
                <div className={styles.mockWindow}>
                  <div className={styles.mockHeader} />
                  <div className={styles.mockBody}>
                    <div className={styles.line} />
                    <div className={styles.lineShort} />
                    <div className={styles.line} />
                    <div className={styles.lineMini} />
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* BELOW-FOLD sections — they start hidden and reveal on scroll */}
          <section id="about" className={`${styles.about} ${styles.reveal}`}>
            <div className={styles.containerInner}>
              <h2>About FormatDaddy</h2>
              <p className={styles.muted}>
                Make your DOCX submission-ready in one click, Instantly, Privately, and Perfectly. 
Runs 100% in your browser, no servers, your file never leaves your device while formatting and styles stay intact. 
Pick font, spacing, margins and alignment, click Format, download a flawless .docx in seconds, zero installs, zero headaches. 
Stop losing marks or clients to sloppy formatting, you’ll wonder how you ever submitted without it. 
<strong>For investors: A privacy-native, lightning-fast product with viral growth hooks, low margins and a straightforward SaaS/institutional path that can scale to millions.</strong> 
We’re not replacing Word, we’re the finishing tool that transforms Word’s chaos into compliance, think Photopea for documents. 
Try it now, join the movement or get in early and help own the next privacy-first wave of the web.
              </p>
            </div>
          </section>

          <section id="how" className={`${styles.how} ${styles.reveal}`}>
            <div className={styles.containerInner}>
              <h3>How it works</h3>
              <ol>
                <li>Upload a file, choose formatting options</li>
                <li>We apply formatting locally in the browser</li>
                <li>Download the new file (no servers, no upload)</li>
              </ol>
            </div>
          </section>

          <footer className={styles.footer}>
            <div className={styles.footerLeft}>
              <div className={styles.footerBrand}><i>formatDaddy</i></div>
            </div>

            <div className={styles.footerCenter}>
              <div className={styles.footerCopy}>© 2025 FormatDaddy — Privacy-first tools</div>
              <div className={styles.privacyLine}>Your document never leaves your device.</div>
            </div>

            <div className={styles.footerRight}>
              <div className={styles.owner}>
                Owner:{" "}
                <a href={OWNER_GITHUB} target="_blank" rel="noopener noreferrer" className={styles.ownerLink}>
                  0xrootAnon
                </a>
              </div>
            </div>
          </footer>
        </main>
      </div>
    </>
  );
}
