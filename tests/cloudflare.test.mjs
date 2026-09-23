import assert from "node:assert/strict";
import test from "node:test";
import worker from "../_worker.js";

test("el proxy conserva ruta, consulta y autorización", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  };
  try {
    const request = new Request("https://carlea.pages.dev/sb/rest/v1/profiles?select=*", {
      headers: { authorization: "Bearer prueba", apikey: "anon" },
    });
    const response = await worker.fetch(request, { ASSETS: { fetch: () => assert.fail("no debe servir un recurso estático") } });
    assert.equal(captured.url, "https://bekvgnxsqpjblxvoutvu.supabase.co/rest/v1/profiles?select=*");
    assert.equal(captured.init.headers.get("authorization"), "Bearer prueba");
    assert.equal(captured.init.headers.get("apikey"), "anon");
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reescribe redirecciones de Supabase al dominio publicado", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, {
    status: 302,
    headers: { location: "https://bekvgnxsqpjblxvoutvu.supabase.co/auth/v1/verify?token=abc" },
  });
  try {
    const response = await worker.fetch(
      new Request("https://carlea.pages.dev/sb/auth/v1/verify"),
      { ASSETS: { fetch: () => assert.fail("no debe servir un recurso estático") } },
    );
    assert.equal(response.headers.get("location"), "https://carlea.pages.dev/sb/auth/v1/verify?token=abc");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("los demás archivos se sirven desde Pages", async () => {
  const response = await worker.fetch(new Request("https://carlea.pages.dev/index.html"), {
    ASSETS: { fetch: async () => new Response("CARLEA") },
  });
  assert.equal(await response.text(), "CARLEA");
});

test("el ingreso reenvía un cuerpo completo y devuelve JSON legible", async () => {
  const originalFetch = globalThis.fetch;
  let receivedBody;
  globalThis.fetch = async (_url, init) => {
    receivedBody = JSON.parse(new TextDecoder().decode(init.body));
    return new Response(JSON.stringify({ access_token: "prueba", user: { id: "u1" } }), {
      headers: {
        "content-type": "application/json",
        "content-encoding": "gzip",
        "content-length": "999",
      },
    });
  };
  try {
    const request = new Request(
      "https://carlea.pages.dev/sb/auth/v1/token?grant_type=password",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "test@example.invalid", password: "clave" }),
      },
    );
    const response = await worker.fetch(request, {
      ASSETS: { fetch: () => assert.fail("no debe servir un recurso estático") },
    });
    assert.equal(receivedBody.email, "test@example.invalid");
    assert.deepEqual(await response.json(), { access_token: "prueba", user: { id: "u1" } });
    assert.equal(response.headers.has("content-encoding"), false);
    assert.equal(response.headers.has("content-length"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("una respuesta JSON vacía se convierte en un error legible", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("", { status: 200, headers: { "content-type": "application/json" } });
  try {
    const response = await worker.fetch(
      new Request("https://carlea.pages.dev/sb/auth/v1/user"),
      { ASSETS: { fetch: () => assert.fail("no debe servir un recurso estático") } },
    );
    assert.equal(response.status, 502);
    assert.match((await response.json()).message, /respuesta vacía/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
