import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// No <React.StrictMode>: its dev-only double mount creates, destroys and recreates the
// MapLibre map within one tick, which leaves MapLibre's shared worker pool unable to render.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
