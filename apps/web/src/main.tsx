import React from "react";
import ReactDOM from "react-dom/client";
import { AppProviders } from "./app/providers";
import { router } from "./app/router";
import { RouterProvider } from "react-router-dom";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </React.StrictMode>
);

