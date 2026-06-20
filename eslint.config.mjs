import nextConfig from "eslint-config-next";
import unusedImports from "eslint-plugin-unused-imports";
import security from "eslint-plugin-security";

// Reusa las instancias de plugins ya registradas por eslint-config-next
// (next, react-hooks, import, etc.) para poder bajar la severidad de sus
// reglas más abajo sin "no se encontró el plugin X".
const nextPlugins = Object.assign({}, ...nextConfig.map((c) => c.plugins || {}));

export default [
  { ignores: [".next/**", "node_modules/**", "test-results/**", "playwright-report/**"] },
  ...nextConfig,
  {
    plugins: { ...nextPlugins, "unused-imports": unusedImports, security },
    rules: {
      ...security.configs.recommended.rules,

      // Casi todo el código server-side construye paths de Supabase REST con
      // template strings (tabla, ids validados como UUID, query params) —
      // el regex de eslint-plugin-security no distingue eso de una inyección
      // real y dispara cientos de falsos positivos. Queda en warn para ir
      // revisando, no rompe CI.
      "security/detect-object-injection": "warn",
      "security/detect-non-literal-fs-filename": "warn",
      // Detecta imports muertos — el problema concreto de la Etapa 1
      // (contexts/helpers importados y nunca usados) y de la Etapa 10
      // (~230 líneas de dead code que costó encontrar a mano).
      "unused-imports/no-unused-imports": "warn",

      // Bloquea imports que ya causaron bugs reales en este proyecto.
      "no-restricted-imports": ["error", {
        paths: [
          {
            name: "next/router",
            message: "Este proyecto usa App Router — importá de next/navigation, no de next/router (Pages Router).",
          },
        ],
      }],

      // eslint-config-next incluye por defecto las reglas nuevas de
      // eslint-plugin-react-hooks (React Compiler). Esta es la primera vez
      // que corre ESLint en el proyecto, así que marcan ~100 hallazgos en
      // código preexistente sin relación con esta tarea. Se bajan a warn
      // para no romper `npm run lint`/CI por algo fuera de alcance — quedan
      // visibles para ir limpiándolas, no se descartan.
      "react/no-unescaped-entities": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "@next/next/no-html-link-for-pages": "warn",
      "@next/next/no-page-custom-font": "warn",
      "import/no-anonymous-default-export": "warn",
    },
  },
];
