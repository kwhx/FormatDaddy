// src/pages/tool.jsx
import dynamic from "next/dynamic";
import Head from "next/head";
import PasswordGate from "../components/PasswordGate";
import styles from "../styles/ToolWrapper.module.css";

// dynamic so engine code isn't server-rendered
const FormatEngine = dynamic(() => import("../components/FormatEngine"), { ssr: false });

export default function ToolPage() {
  return (
    <>
      <Head>
        <title>FormatDaddy</title>
      </Head>

      <PasswordGate>
        {(unlocked) =>
          unlocked ? (
            <div className={styles.engineWrap}>
              <FormatEngine />
            </div>
          ) : null
        }
      </PasswordGate>
    </>
  );
}
