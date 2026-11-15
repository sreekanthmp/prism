import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

document.title = "Prism";
const root = document.getElementById("root");
if (!root) throw new Error("the page has no #root to draw into");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
