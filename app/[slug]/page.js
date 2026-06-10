import { Suspense } from "react";
import { AuthProvider } from "../context/AuthContext";
import HomeContent from "./HomeContent";

export default function Home() {
  return (
    <AuthProvider>
      <Suspense>
        <HomeContent />
      </Suspense>
    </AuthProvider>
  );
}
