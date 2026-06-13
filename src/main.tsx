import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { MiniPlayerRemote } from "./player/MiniPlayer";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/layout.css";
import "./styles/insights.css";

const isMini = new URLSearchParams(window.location.search).get("miniplayer") === "1";
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isMini ? <MiniPlayerRemote /> : <App />}</React.StrictMode>,
);
