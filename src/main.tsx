import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { applyInitialTheme } from "./context/theme";
import "./styles/tokens.css";
import "./styles/global.css";

// 在渲染前同步应用主题，减少深/浅主题切换时的闪烁。
applyInitialTheme();

const container = document.getElementById("root");

if (!container) {
  throw new Error("未找到根节点 #root，无法挂载 VibeAcross 前端。");
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
