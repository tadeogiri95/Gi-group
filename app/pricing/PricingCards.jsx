"use client";
import { useRouter } from "next/navigation";
import TablaPrecios from "../components/TablaPrecios";

export default function PricingCards() {
  const router = useRouter();
  return <TablaPrecios onEmpezar={() => router.push("/")} />;
}
