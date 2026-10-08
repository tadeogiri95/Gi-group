"use client";
// Quién entró y el botón para salir. Desde R9 el tablero de gestión ya no tiene
// el botón de salir arriba: vive al final de "Más" y en "Mi cuenta y privacidad".
import { Button } from "./ui";
import { useAuth } from "../context/AuthContext";
import { nombreRol } from "../lib/textos";

export default function CerrarSesion({ usuario }) {
  const { logout } = useAuth();
  const nombre = usuario?.apodo || usuario?.nombre;
  return (
    <div className="flex flex-col gap-2">
      {nombre && (
        <p className="m-0 text-[13px] text-gypi-dim">
          Entraste como <b className="text-gypi-text">{nombre}</b> · {nombreRol(usuario?.rol, { soloSuDivision: usuario?.solo_su_division })}
        </p>
      )}
      <Button variant="outline" className="w-full" onClick={logout}>🚪 Cerrar sesión</Button>
    </div>
  );
}
