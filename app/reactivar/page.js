import ReactivarCuenta from "./ReactivarCuenta";

export const metadata = {
  title: "Recuperar cuenta — Gypi",
  robots: { index: false },
};

export default async function Reactivar({ searchParams }) {
  const { t } = (await searchParams) || {};
  return <ReactivarCuenta token={typeof t === "string" ? t : ""} />;
}
