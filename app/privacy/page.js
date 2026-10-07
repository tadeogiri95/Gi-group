export const metadata = {
  title: "Política de Privacidad — Gypi",
  description: "Cómo Gypi recopila, usa y protege los datos de fichaje y gestión laboral de tu empresa.",
};

export default function PrivacyPolicy() {
  const S = {
    // height + overflowY (no minHeight): html/body llevan overflow:hidden en mobile,
    // así que cada página pública necesita su propio contenedor de scroll (igual que /contacto).
    wrap: { maxWidth: 720, margin: "0 auto", padding: "40px 20px", fontFamily: "'Geist', system-ui", color: "#F5F0E8", background: "#0C0A09", height: "100dvh", overflowY: "auto", WebkitOverflowScrolling: "touch", lineHeight: 1.7 },
    h1: { fontSize: 28, fontWeight: 800, marginBottom: 8, fontFamily: "'Bricolage Grotesque', system-ui" },
    h2: { fontSize: 20, fontWeight: 700, marginTop: 32, marginBottom: 12, fontFamily: "'Bricolage Grotesque', system-ui" },
    p: { fontSize: 14, color: "#A39A8E", marginBottom: 16 },
    date: { fontSize: 12, color: "#615A52", marginBottom: 32 },
  };

  return (
    <div style={S.wrap}>
      <a href="/" style={{ fontSize: 13, color: "#F97316", textDecoration: "none", display: "inline-block", marginBottom: 24 }}>← Volver a Gypi</a>
      <h1 style={S.h1}>Política de Privacidad</h1>
      <p style={S.date}>Última actualización: 2 de julio de 2026</p>

      <p style={S.p}>Gypi (Gestión y productividad industrial) ("la App") es operada por Gypi Software ("nosotros"). Esta política describe cómo recopilamos, usamos y protegemos tu información personal.</p>

      <h2 style={S.h2}>1. Información que recopilamos</h2>
      <p style={S.p}>Recopilamos la siguiente información cuando usás la App:</p>
      <p style={S.p}>• Nombre completo y datos de contacto proporcionados por tu empleador.{"\n"}• Horarios de ingreso y egreso laboral.{"\n"}• Ubicación geográfica (solo durante el fichaje, con tu consentimiento).{"\n"}• Registros de actividades y tareas laborales.{"\n"}• Fotografías adjuntas a reportes de obra (solo cuando el usuario las sube voluntariamente).{"\n"}• Datos de uso de la aplicación.</p>

      <h2 style={S.h2}>2. Cómo usamos la información</h2>
      <p style={S.p}>Usamos tu información exclusivamente para:{"\n"}• Gestionar el fichaje y asistencia laboral.{"\n"}• Registrar actividades y productividad.{"\n"}• Generar reportes para la gerencia de tu empresa.{"\n"}• Mejorar el funcionamiento de la App.</p>

      <h2 style={S.h2}>3. Almacenamiento y seguridad</h2>
      <p style={S.p}>Tus datos se almacenan en servidores seguros de Supabase (infraestructura de Amazon Web Services) con encriptación en tránsito y en reposo. Las contraseñas se almacenan hasheadas con bcrypt. Solo personal autorizado de tu empresa puede acceder a tus datos.</p>

      <h2 style={S.h2}>4. Compartir información</h2>
      <p style={S.p}>No vendemos, alquilamos ni compartimos tu información personal con terceros, excepto:{"\n"}• Con tu empleador, para fines de gestión laboral.{"\n"}• Cuando sea requerido por ley o autoridad competente.{"\n"}• Con proveedores de servicios técnicos (Supabase, Vercel, Firebase) que procesan datos en nuestro nombre bajo estrictas obligaciones de confidencialidad.</p>

      <h2 id="cookies" style={S.h2}>5. Cookies y publicidad</h2>
      <p style={S.p}>Gypi no muestra publicidad ni usa cookies de seguimiento o de terceros con fines publicitarios. Tus datos laborales (fichadas, ubicación, reportes) nunca se comparten con redes publicitarias.</p>
      <p style={S.p}>Solo usamos cookies y almacenamiento local estrictamente necesarios para el funcionamiento del servicio: mantener tu sesión iniciada, proteger los formularios contra envíos falsificados (CSRF) y recordar preferencias de la App. Estas cookies no requieren consentimiento porque sin ellas el servicio no puede funcionar.</p>

      <h2 style={S.h2}>6. Geolocalización</h2>
      <p style={S.p}>La App puede solicitar acceso a tu ubicación para verificar el fichaje en el lugar de trabajo. Este permiso es opcional y podés revocarlo en cualquier momento desde la configuración de tu dispositivo. La ubicación solo se registra en el momento del fichaje y no se rastrea de forma continua.</p>

      <h2 style={S.h2}>7. Tus derechos</h2>
      <p style={S.p}>Tenés derecho a:{"\n"}• Acceder a tus datos personales.{"\n"}• Solicitar la corrección de datos inexactos.{"\n"}• Solicitar la eliminación de tus datos (sujeto a obligaciones legales de retención).{"\n"}• Revocar el consentimiento para la geolocalización.{"\n"}{"\n"}Para ejercer estos derechos, contactá a tu empleador o escribinos a contacto@gypi.app.</p>

      <h2 style={S.h2}>8. Retención de datos</h2>
      <p style={S.p}>Conservamos tus datos mientras dure tu relación laboral con la empresa que utiliza la App, y por el período adicional que exija la legislación laboral argentina vigente.</p>

      <h2 style={S.h2}>9. Cambios a esta política</h2>
      <p style={S.p}>Podemos actualizar esta política ocasionalmente. Te notificaremos de cambios significativos a través de la App. El uso continuado de la App después de los cambios constituye aceptación de la política actualizada.</p>

      <h2 style={S.h2}>10. Contacto</h2>
      <p style={S.p}>Si tenés preguntas sobre esta política, contactanos en:{"\n"}Email: contacto@gypi.app{"\n"}Dirección: Córdoba, Argentina</p>

      <footer style={{ marginTop: 48, paddingTop: 24, borderTop: "1px solid #2A2520", textAlign: "center", fontSize: 12, color: "#615A52" }}>
        <a href="/" style={{ color: "#615A52", textDecoration: "none" }}>Gypi</a>
        {" · "}
        <a href="/pricing" style={{ color: "#615A52", textDecoration: "none" }}>Precios</a>
        {" · "}
        <a href="/docs" style={{ color: "#615A52", textDecoration: "none" }}>Docs</a>
        {" · "}
        <a href="/terms" style={{ color: "#615A52", textDecoration: "none" }}>Términos</a>
        {" · "}
        <a href="/privacy" style={{ color: "#615A52", textDecoration: "none" }}>Privacidad</a>
      </footer>
    </div>
  );
}
