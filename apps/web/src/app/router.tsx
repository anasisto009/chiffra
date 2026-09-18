import { createBrowserRouter, Navigate } from "react-router-dom";
import { Dashboard } from "../pages/Dashboard";
import { Review } from "../pages/Review";
import { Upload } from "../pages/Upload";
import { AppLayout } from "./AppLayout";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/upload" replace /> },
      { path: "upload", element: <Upload /> },
      { path: "dashboard", element: <Dashboard /> },
      { path: "review", element: <Review /> }
    ]
  }
]);
