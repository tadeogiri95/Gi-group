"use client";
// ═══════════════════════════════════════════════════════════
// AppProvider — Combina AuthProvider + DataProvider + UIProvider
//               + ToastProvider en un solo wrapper.
//
// ENTREGA 2C: Simplifica [slug]/page.js. En vez de wrappear
// manualmente con 4 providers, se usa:
//
//   <AppProvider>
//     <MyApp />
//   </AppProvider>
//
// Orden: Auth primero (DataProvider depende de usuario),
//        Toast al final (disponible en todos los contexts).
// ═══════════════════════════════════════════════════════════

import { AuthProvider } from "./AuthContext";
import { DataProvider } from "./DataContext";
import { UIProvider } from "./UIContext";
import { ToastProvider } from "../components/Toast";

export default function AppProvider({ children }) {
  return (
    <AuthProvider>
      <DataProvider>
        <UIProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </UIProvider>
      </DataProvider>
    </AuthProvider>
  );
}
