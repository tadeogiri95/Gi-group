"use client";

export default function TermsOfService() {
  const S = {
    wrap: { maxWidth: 720, margin: "0 auto", padding: "40px 20px", fontFamily: "'Geist', system-ui", color: "#F5F0E8", background: "#0C0A09", minHeight: "100vh", lineHeight: 1.7 },
    h1: { fontSize: 28, fontWeight: 800, marginBottom: 8, fontFamily: "'Bricolage Grotesque', system-ui" },
    h2: { fontSize: 20, fontWeight: 700, marginTop: 32, marginBottom: 12, fontFamily: "'Bricolage Grotesque', system-ui" },
    p: { fontSize: 14, color: "#A39A8E", marginBottom: 16 },
    date: { fontSize: 12, color: "#615A52", marginBottom: 32 },
    li: { fontSize: 14, color: "#A39A8E", marginBottom: 8, paddingLeft: 16 },
    table: { width: "100%", borderCollapse: "collapse", marginBottom: 16 },
    th: { fontSize: 13, color: "#F5F0E8", textAlign: "left", padding: "8px 12px", borderBottom: "1px solid #2A2520", fontWeight: 600 },
    td: { fontSize: 13, color: "#A39A8E", padding: "8px 12px", borderBottom: "1px solid #1E1A16" },
  };

  return (
    <div style={S.wrap}>
      <a href="/" style={{ fontSize: 13, color: "#F97316", textDecoration: "none", display: "inline-block", marginBottom: 24 }}>← Volver a Gypi</a>
      <h1 style={S.h1}>Términos y Condiciones de Uso</h1>
      <p style={S.date}>Última actualización: 10 de junio de 2026</p>

      <p style={S.p}>Estos términos regulan el uso de la aplicación Gypi (Gestión y productividad industrial) ("la App"), operada por Gypi Software ("Gypi", "nosotros"). Al usar la App, aceptás estos términos.</p>

      <h2 style={S.h2}>1. Descripción del servicio</h2>
      <p style={S.p}>La App es una plataforma SaaS de gestión de recursos humanos que permite a las empresas administrar fichaje de asistencia, registro de actividades, reportes de obra, geolocalización de equipos y comunicación interna.</p>

      <h2 style={S.h2}>2. Acceso y cuentas</h2>
      <p style={S.p}>El acceso a la App es proporcionado por tu empleador (la "Empresa"). No podés crear una cuenta de forma individual. Sos responsable de mantener la confidencialidad de tus credenciales. Debés notificar inmediatamente a tu empleador si detectás uso no autorizado de tu cuenta.</p>

      <h2 style={S.h2}>3. Uso aceptable</h2>
      <p style={S.p}>Te comprometés a:</p>
      <ul style={{ paddingLeft: 24, marginBottom: 16 }}>
        {["Usar la App solo para fines laborales legítimos.",
          "No intentar acceder a datos de otros usuarios.",
          "No modificar, descompilar o realizar ingeniería inversa de la App.",
          "No usar la App para actividades ilegales o no autorizadas.",
          "Proporcionar información veraz en los reportes y registros."].map((t, i) => (
          <li key={i} style={S.li}>{t}</li>
        ))}
      </ul>

      <h2 style={S.h2}>4. Planes y facturación</h2>
      <p style={S.p}>Gypi ofrece planes gratuitos y de pago. Los planes de pago se facturan mensualmente a través de MercadoPago. Las tarifas vigentes se publican en gypi.app. Gypi se reserva el derecho de ajustar los precios con 30 días de preaviso.</p>

      <h2 style={S.h2}>5. Disponibilidad del servicio (SLA)</h2>
      <p style={S.p}>Gypi garantiza una disponibilidad mensual del <strong style={{ color: "#F5F0E8" }}>99,5 % de uptime</strong> para los planes de pago (Starter, Pro y Enterprise), medida sobre el mes calendario, excluyendo ventanas de mantenimiento programado notificadas con al menos 24 horas de anticipación.</p>
      <p style={S.p}>En caso de que el uptime mensual sea inferior al garantizado, Gypi otorgará un crédito proporcional al tiempo de inactividad adicional, aplicado al próximo período de facturación. El crédito es el único remedio disponible por incumplimiento del SLA; no corresponde reembolso en efectivo.</p>
      <p style={S.p}>Para el plan gratuito (Free) no aplica garantía de uptime.</p>

      <h2 style={S.h2}>6. Propiedad intelectual</h2>
      <p style={S.p}>Todos los derechos de propiedad intelectual sobre la App pertenecen a Gypi Software. Se te otorga una licencia limitada, no exclusiva y revocable para usar la App según estos términos. Los datos que tu empresa carga pertenecen a tu empresa.</p>

      <h2 style={S.h2}>7. Limitación de responsabilidad</h2>
      <p style={S.p}>La App se proporciona "tal cual". En la máxima medida permitida por la legislación aplicable:</p>
      <ul style={{ paddingLeft: 24, marginBottom: 16 }}>
        {["La responsabilidad total acumulada de Gypi por cualquier reclamación relacionada con el servicio estará limitada al monto pagado por la Empresa en los 3 meses anteriores al hecho que origina la reclamación.",
          "Gypi no será responsable por daños indirectos, pérdida de beneficios, pérdida de datos o daños punitivos.",
          "No garantizamos que la App esté libre de errores ni que satisfaga todos los requerimientos de la Empresa."].map((t, i) => (
          <li key={i} style={S.li}>{t}</li>
        ))}
      </ul>

      <h2 style={S.h2}>8. Terminación y retención de datos</h2>
      <p style={S.p}>Tu acceso puede ser terminado por tu empleador en cualquier momento, o por Gypi en caso de violación de estos términos o falta de pago.</p>
      <p style={S.p}><strong style={{ color: "#F5F0E8" }}>Retención de datos tras la cancelación:</strong> cuando una Empresa cancela su suscripción o esta vence sin renovación, los datos de esa empresa se conservarán durante <strong style={{ color: "#F5F0E8" }}>30 días calendario</strong> adicionales. Durante ese período la Empresa puede solicitar la exportación completa de sus datos a contacto@gypi.app. Transcurridos los 30 días sin solicitud de exportación, los datos serán eliminados de forma permanente.</p>
      <p style={S.p}>El plan gratuito (Free) no tiene garantía de retención de datos; los datos pueden eliminarse tras 90 días de inactividad total.</p>

      <h2 style={S.h2}>9. Modificaciones</h2>
      <p style={S.p}>Podemos modificar estos términos. Los cambios con impacto significativo se notificarán con 15 días de anticipación a través de la App o al email de administración registrado. El uso continuado constituye aceptación.</p>

      <h2 style={S.h2}>10. Legislación aplicable</h2>
      <p style={S.p}>Estos términos se rigen por las leyes de la República Argentina. Cualquier disputa será sometida a la jurisdicción de los tribunales ordinarios de la ciudad de Córdoba, Argentina.</p>

      <h2 style={S.h2}>11. Contacto</h2>
      <p style={S.p}>Para consultas sobre estos términos:<br />Email: contacto@gypi.app<br />Dirección: Córdoba, Argentina</p>
    </div>
  );
}
