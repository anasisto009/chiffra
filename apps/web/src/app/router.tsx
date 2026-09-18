import { createBrowserRouter, Navigate } from "react-router-dom";
import { Dashboard } from "../pages/Dashboard";
import { ReviewPage } from "../pages/ReviewPage";
import { UploadPage } from "../pages/UploadPage";
import { ExportPage } from "../pages/ExportPage";
import { App } from "../App";

export const router = createBrowserRouter([
  {
    path: "*",
    element: <App />
  }
]);
