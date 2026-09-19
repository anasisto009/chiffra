import { API_URL } from "../api";

export function TvaExportButton() {
  function downloadCsv(): void {
    window.location.href = `${API_URL}/api/export/tva?format=csv`;
  }

  return (
    <button className="secondary-button" type="button" onClick={downloadCsv}>
      Download TVA CSV
    </button>
  );
}

