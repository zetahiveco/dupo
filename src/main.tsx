import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app";
import "./styles.css";

async function report(message: string) {
  try {
    const core = await import("@tauri-apps/api/core");
    await core.invoke("log_message", { message });
  } catch {
    /* ignore */
  }
}

window.addEventListener("error", (event) => {
  void report(`error: ${event.message} @ ${event.filename}:${event.lineno}:${event.colno}`);
});
window.addEventListener("unhandledrejection", (event) => {
  void report(`unhandled rejection: ${String(event.reason)}`);
});
const originalError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  void report(`console.error: ${args.map(String).join(" ")}`);
  originalError(...args);
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
