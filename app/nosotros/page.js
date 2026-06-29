export const metadata = {
  title: "Quiénes somos — Gypi",
  description: "Conocé Gypi: por qué creamos una plataforma de gestión y productividad para empresas industriales y de servicios en Argentina.",
};

export default function Nosotros() {
  const S = {
    wrap: { maxWidth: 720, margin: "0 auto", padding: "40px 20px", fontFamily: "'Geist', system-ui", color: "#F5F0E8", background: "#0C0A09", height: "100dvh", overflowY: "auto", WebkitOverflowScrolling: "touch", lineHeight: 1.7 },
    h1: { fontSize: 28, fontWeight: 800, marginBottom: 8, fontFamily: "'Bricolage Grotesque', system-ui" },
    h2: { fontSize: 20, fontWeight: 700, marginTop: 32, marginBottom: 12, fontFamily: "'Bricolage Grotesque', system-ui" },
    p: { fontSize: 14, color: "#A39A8E", marginBottom: 16 },
    li: { fontSize: 14, color: "#A39A8E", marginBottom: 8, paddingLeft: 16 },
  };

  return (
    <div style={S.wrap}>
      <a href="/" style={{ fontSize: 13, color: "#F97316", textDecoration: "none", display: "inline-block", marginBottom: 24 }}>← Volver a Gypi</a>
      <h1 style={S.h1}>Quiénes somos</h1>
      <p style={S.p}>
        Gypi (Gestión y productividad industrial) es desarrollada por Gypi Software, un equipo argentino con base en Córdoba. Construimos software de gestión enfocado en empresas que operan en planta, obra o campo — donde el fichaje, las planillas en papel y los grupos de WhatsApp todavía hacen de sistema de gestión.
      </p>

      <h2 style={S.h2}>Por qué existe Gypi</h2>
      <p style={S.p}>
        Vimos de cerca cómo pymes industriales y de servicios pierden tiempo y plata reconciliando asistencia, reportes de obra y comunicación interna entre planillas sueltas, chats y memoria. Gypi nace para reemplazar ese caos con una sola herramienta simple: fichaje digital con geolocalización, reportes en tiempo real, reglas automáticas y un chat interno, todo accesible desde el celular como una app instalable (PWA), sin necesidad de bajar nada de una tienda de aplicaciones.
      </p>

      <h2 style={S.h2}>Qué nos importa</h2>
      <ul style={{ paddingLeft: 24, marginBottom: 16 }}>
        {[
          "Simplicidad: que una empresa pueda empezar a usar Gypi en minutos, sin capacitación extensa.",
          "Datos reales y seguros: la información de fichaje y reportes de cada empresa es privada y nunca se comparte con terceros.",
          "Precio justo: un plan gratuito real para empresas chicas, y planes pagos que escalan con el tamaño del equipo.",
          "Mejora continua: sumamos funciones a partir de lo que nos piden las empresas que ya usan la plataforma.",
        ].map((t, i) => (
          <li key={i} style={S.li}>{t}</li>
        ))}
      </ul>

      <h2 style={S.h2}>Dónde estamos</h2>
      <p style={S.p}>
        Operamos desde Córdoba, Argentina, y damos soporte a empresas en todo el país. Podés conocer más sobre cómo funciona la plataforma en nuestra <a href="/docs" style={{ color: "#F97316" }}>documentación</a> o escribirnos desde la página de <a href="/contacto" style={{ color: "#F97316" }}>contacto</a>.
      </p>
    </div>
  );
}
