"use client";

export default function PrivacyPolicy() {
  const S = {
    wrap: { maxWidth: 720, margin: "0 auto", padding: "40px 20px", fontFamily: "'Geist', system-ui", color: "#F5F0E8", background: "#0C0A09", minHeight: "100vh", lineHeight: 1.7 },
    h1: { fontSize: 28, fontWeight: 800, marginBottom: 8, fontFamily: "'Bricolage Grotesque', system-ui" },
    h2: { fontSize: 20, fontWeight: 700, marginTop: 32, marginBottom: 12, fontFamily: "'Bricolage Grotesque', system-ui" },
    p: { fontSize: 14, color: "#A39A8E", marginBottom: 16 },
    date: { fontSize: 12, color: "#615A52", marginBottom: 32 },
  };

  return (
    <div style={S.wrap}>
      <h1 style={S.h1}>Política de Privacidad</h1>
      <p style={S.date}>Última actualización: 25 de mayo de 2026</p>

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

      <h2 style={S.h2}>5. Geolocalización</h2>
      <p style={S.p}>La App puede solicitar acceso a tu ubicación para verificar el fichaje en el lugar de trabajo. Este permiso es opcional y podés revocarlo en cualquier momento desde la configuración de tu dispositivo. La ubicación solo se registra en el momento del fichaje y no se rastrea de forma continua.</p>

      <h2 style={S.h2}>6. Tus derechos</h2>
      <p style={S.p}>Tenés derecho a:{"\n"}• Acceder a tus datos personales.{"\n"}• Solicitar la corrección de datos inexactos.{"\n"}• Solicitar la eliminación de tus datos (sujeto a obligaciones legales de retención).{"\n"}• Revocar el consentimiento para la geolocalización.{"\n"}{"\n"}Para ejercer estos derechos, contactá a tu empleador o escribinos a contacto@gypi.app.</p>

      <h2 style={S.h2}>7. Retención de datos</h2>
      <p style={S.p}>Conservamos tus datos mientras dure tu relación laboral con la empresa que utiliza la App, y por el período adicional que exija la legislación laboral argentina vigente.</p>

      <h2 style={S.h2}>8. Cambios a esta política</h2>
      <p style={S.p}>Podemos actualizar esta política ocasionalmente. Te notificaremos de cambios significativos a través de la App. El uso continuado de la App después de los cambios constituye aceptación de la política actualizada.</p>

      <h2 style={S.h2}>9. Contacto</h2>
      <p style={S.p}>Si tenés preguntas sobre esta política, contactanos en:{"\n"}Email: contacto@gypi.app{"\n"}Dirección: Córdoba, Argentina</p>
    </div>
  );
}
