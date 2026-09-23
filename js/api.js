import { config } from "./config.js";
export const sb = window.supabase.createClient(config.url, config.key, {
  auth: {
    storageKey: "carlea_v3_session",
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    fetch: (url, options) =>
      fetch(
        config.proxy
          ? String(url).replace(config.url, location.origin + "/sb")
          : url,
        options,
      ),
  },
});
export const $ = (id) => document.getElementById(id);
export const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const money = (v) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(v);
export function checked(r) {
  if (r.error) throw r.error;
  return r.data;
}
export async function signed(bucket, path) {
  if (!path) return "";
  const url =
    checked(await sb.storage.from(bucket).createSignedUrl(path, 300))
      ?.signedUrl || "";
  return config.proxy ? url.replace(config.url, location.origin + "/sb") : url;
}
export function toast(text) {
  $("toast").textContent = text;
  $("toast").style.display = "block";
  clearTimeout(window.toastTimeout);
  window.toastTimeout = setTimeout(
    () => ($("toast").style.display = "none"),
    5000,
  );
}
export function dialog(html) {
  $("dialogBody").innerHTML = html;
  if (!$("dialog").open) $("dialog").showModal();
}
export async function attempt(fn) {
  try {
    return await fn();
  } catch (e) {
    toast(e.message || "No se pudo completar la acción");
    return null;
  }
}
export function bind(id, fn) {
  const el = $(id);
  if (el) el.onclick = () => attempt(fn);
}
export function form(id, fn) {
  const el = $(id);
  if (el)
    el.onsubmit = async (e) => {
      e.preventDefault();
      const b = el.querySelector("[type=submit]");
      if (b) b.disabled = true;
      await attempt(() => fn(new FormData(el)));
      if (b) b.disabled = false;
    };
}
export async function upload(bucket, file, folder, max = 5 * 1024 * 1024) {
  if (!file?.size) throw Error("Selecciona un archivo");
  if (file.size > max)
    throw Error(
      "El archivo supera el límite de " + Math.floor(max / 1024 / 1024) + " MB",
    );
  const types = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
  };
  const type = file.type.split(";")[0];
  if (!types[type]) throw Error("Formato no permitido");
  const path = folder + "/" + crypto.randomUUID() + "." + types[type];
  checked(
    await sb.storage
      .from(bucket)
      .upload(path, file, { contentType: type, upsert: false }),
  );
  return path;
}
