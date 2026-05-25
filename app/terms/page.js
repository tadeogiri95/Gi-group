"use client";

export default function TermsOfService() {
  const S = {
    wrap: { maxWidth: 720, margin: "0 auto", padding: "40px 20px", fontFamily: "'Geist', system-ui", color: "#F5F0E8", background: "#0C0A09", minHeight: "100vh", lineHeight: 1.7 },
    h1: { fontSize: 28, fontWeight: 800, marginBottom: 8, fontFamily: "'Bricolage Grotesque', system-ui" },
    h2: { fontSize: 20, fontWeight: 700, marginTop: 32, marginBottom: 12, fontFamily: "'Bricolage Grotesque', system-ui" },
    p: { fontSize: 14, color: "#A39A8E", marginBottom: 16 },
    date: { fontSize: 12, color: "#615A52", marginBottom: 32 },
  };

  return (
    <div style={S.wrap}>
      <h1 style={S.h1}>Términos y Condiciones de Uso</h1>
      <p style={S.date}>Última actualización: 25 de mayo de 2026</p>

      <p style={S.p}>Estos términos regulan el uso de la aplicación GI Group RRHH ("la App"), operada por GI Amoblamientos SRL. Al usar la App, aceptás estos términos.</p>

      <h2 style={S.h2}>1. Descripción del servicio</h2>
      <p style={S.p}>La App es una herramienta de gestión de recursos humanos que permite a las empresas administrar fichaje de asistencia, registro de actividades, reportes de obra y comunicación interna.</p>

      <h2 style={S.h2}>2. Acceso y cuentas</h2>
      <p style={S.p}>El acceso a la App es proporcionado por tu empleador. No podés crear una cuenta por tu cuenta. Sos responsable de mantener la confidencialidad de tus credenciales de acceso. Debés notificar inmediatamente a tu empleador si detectás uso no autorizado de tu cuenta.</p>

      <h2 style={S.h2}>3. Uso aceptable</h2>
      <p style={S.p}>Te comprometés a:{"\n"}• Usar la App solo para fines laborales legítimos.{"\n"}• No intentar acceder a datos de otros usuarios.{"\n"}• No modificar, descompilar o realizar ingeniería inversa de la App.{"\n"}• No usar la App para actividades ilegales o no autorizadas.{"\n"}• Proporcionar información veraz en los reportes y registros.</p>

      <h2 style={S.h2}>4. Propiedad intelectual</h2>
      <p style={S.p}>Todos los derechos de propiedad intelectual sobre la App, incluyendo código fuente, diseño, marcas y contenido, pertenecen a GI Amoblamientos SRL. Se te otorga una licencia limitada, no exclusiva y revocable para usar la App según estos términos.</p>

      <h2 style={S.h2}>5. Disponibilidad del servicio</h2>
      <p style={S.p}>Nos esforzamos por mantener la App disponible, pero no garantizamos un funcionamiento ininterrumpido. Podemos realizar mantenimiento programado o de emergencia que afecte temporalmente la disponibilidad.</p>

      <h2 style={S.h2}>6. Limitación de responsabilidad</h2>
      <p style={S.p}>La App se proporciona "tal cual". No somos responsables por:{"\n"}• Pérdida de datos debido a fallos técnicos fuera de nuestro control.{"\n"}• Decisiones laborales tomadas en base a los datos de la App.{"\n"}• Interrupciones del servicio por causas de fuerza mayor.{"\n"}• Uso inadecuado de la App por parte de los usuarios.</p>

      <h2 style={S.h2}>7. Terminación</h2>
      <p style={S.p}>Tu acceso puede ser terminado por tu empleador en cualquier momento, o por nosotros en caso de violación de estos términos. Al finalizar el acceso, tus datos serán tratados según nuestra Política de Privacidad.</p>

      <h2 style={S.h2}>8. Modificaciones</h2>
      <p style={S.p}>Podemos modificar estos términos. Los cambios serán notificados a través de la App. El uso continuado después de la notificación constituye aceptación.</p>

      <h2 style={S.h2}>9. Legislación aplicable</h2>
      <p style={S.p}>Estos términos se rigen por las leyes de la República Argentina. Cualquier disputa será sometida a la jurisdicción de los tribunales ordinarios de la ciudad de Córdoba, Argentina.</p>

      <h2 style={S.h2}>10. Contacto</h2>
      <p style={S.p}>Para consultas sobre estos términos:{"\n"}Email: contacto@gigroup.com.ar{"\n"}Dirección: Córdoba, Argentina</p>
    </div>
  );
}
