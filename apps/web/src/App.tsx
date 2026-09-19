import { Upload } from "./pages/Upload";
import "./styles.css";

export function App() {
  return (
    <main className="app-shell">
      <nav className="topbar">
        <strong>Chiffra</strong>
        <span>Agent comptable marocain</span>
      </nav>
      <Upload />
    </main>
  );
}
