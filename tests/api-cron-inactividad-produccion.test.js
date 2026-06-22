// tests/api-cron-inactividad-produccion.test.js — Tests de GET /api/cron/inactividad-produccion
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock } from "./helpers/mockFetch.js";

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  process.env.CRON_SECRET = "test-cron-secret";
});

const { GET } = await import("../app/api/cron/inactividad-produccion/route.ts");

const EMPLEADO_ID = "33333333-3333-3333-3333-333333333333";
const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";

function cronReq() {
  return new Request("http://localhost/api/cron/inactividad-produccion", {
    headers: { Authorization: "Bearer test-cron-secret" },
  });
}

function handlerFichadas(ingresoHora) {
  return {
    match: (url) => url.includes("/rest/v1/fichadas") && url.includes("egreso=is.null"),
    respond: () => ({
      status: 200,
      body: [{ empleado_id: EMPLEADO_ID, legajo: 7, ingreso: ingresoHora, egreso: null, empresa_id: EMPRESA_ID }],
    }),
  };
}

const sinActividad = {
  match: (url) => url.includes("/rest/v1/registro_actividades"),
  respond: () => ({ status: 200, body: [] }),
};

const sinTokens = {
  match: (url) => url.includes("/rest/v1/push_tokens"),
  respond: () => ({ status: 200, body: [] }),
};

// ─── Regresión TZ Argentina ────────────────────────────────────────────────
// f.ingreso se guarda como hora civil Argentina ("HH:MM:SS", ver fichar/route.js).
// El cron lo combinaba con `new Date(`${hoy}T${f.ingreso}`)` sin sufijo de TZ,
// así que Node lo interpreta como hora LOCAL DEL PROCESO. En Vercel eso es
// UTC, no Argentina (UTC-3) — un corrimiento de 3hs que hacía aparecer casi
// cualquier fichada recién abierta como "hace >30min".
//
// Esta máquina de desarrollo ya tiene TZ=America/Argentina/Buenos_Aires, lo
// que enmascararía el bug (la interpretación local "por accidente" coincide
// con Argentina). Forzamos TZ=UTC para reproducir el runtime real de Vercel
// y que el test detecte una regresión sin importar dónde se corra.
function conTzUtc(fn) {
  return async (t) => {
    const tzOriginal = process.env.TZ;
    process.env.TZ = "UTC";
    try {
      await fn(t);
    } finally {
      if (tzOriginal === undefined) delete process.env.TZ;
      else process.env.TZ = tzOriginal;
    }
  };
}

test(
  "inactividad-produccion — ingreso hace 5 min (dentro de tolerancia) NO entra en enPlanta bajo TZ=UTC",
  conTzUtc(async (t) => {
    try {
      // 2026-06-17T13:00:00Z = 10:00 ART. Ingreso 09:55 ART = hace 5 min reales.
      t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-06-17T13:00:00.000Z") });
      global.fetch = createFetchMock([handlerFichadas("09:55:00")]);

      const res = await GET(cronReq());
      const json = await res.json();

      assert.equal(res.status, 200);
      assert.equal(
        json.msg,
        "Todos ficharon hace <30min",
        "con el bug de TZ esta fichada de hace 5 min se ve como 'hace >30min' (corrimiento de 3hs) y dispara una alerta falsa"
      );
      assert.equal(json.notificados, 0);
    } finally {
      t.mock.timers.reset();
    }
  })
);

test(
  "inactividad-produccion — ingreso hace 35 min sin actividad SÍ entra en inactivos bajo TZ=UTC",
  conTzUtc(async (t) => {
    try {
      // Mismo instante "ahora" que el caso anterior; ingreso 09:25 ART = hace 35 min reales.
      t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-06-17T13:00:00.000Z") });
      global.fetch = createFetchMock([handlerFichadas("09:25:00"), sinActividad, sinTokens]);

      const res = await GET(cronReq());
      const json = await res.json();

      assert.equal(res.status, 200);
      assert.equal(json.msg, "Sin tokens push para inactivos");
      assert.equal(json.inactivos, 1);
    } finally {
      t.mock.timers.reset();
    }
  })
);
