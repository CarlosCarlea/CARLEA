import {
  sb,
  $,
  esc,
  money,
  checked,
  signed,
  toast,
  dialog,
  attempt,
  bind,
  form,
  upload,
} from "./api.js";
import { catalog, fallbackCover } from "./catalog.js";
import {
  PLAN_LABELS,
  PLAN_PRICES,
  normalizeEntitlements,
  hasCapability,
  effectivePlan,
} from "./membership.js";
import { openChats, stopChat } from "./chat.js";
export const state = {
  user: null,
  profile: null,
  creator: null,
  settings: {},
  creators: [],
  subscriptions: [],
  entitlements: normalizeEntitlements(null),
  entitlementError: "",
};
const LEGAL_VERSION = "3.4";
const planName = (p) => PLAN_LABELS[p] || "Sin membresía verificada";
export function landingForProfile(profile) {
  if (!profile || profile.status !== "active") return "profile";
  if (profile.role === "admin") return "admin";
  if (profile.role === "creator") return "studio";
  return "home";
}
let accepted = false,
  routeVersion = 0,
  notificationsChannel,
  catalogChannel,
  catalogRefreshTimer,
  lastInteractionAt = Date.now(),
  activityTimer;
const empty = (t) => `<div class="empty muted">${esc(t)}</div>`;
const title = (eyebrow, h, p = "") =>
  `<div class="page-title"><div><div class="eyebrow">${eyebrow}</div><h1>${h}</h1>${p ? `<p>${p}</p>` : ""}</div></div>`;
const field = (label, name, value = "", type = "text") =>
  `<label class="field">${label}<input name="${name}" type="${type}" value="${esc(value)}" required></label>`;
function legalReady() {
  return (
    state.settings.operator_name &&
    state.settings.tax_id &&
    state.settings.address &&
    state.settings.privacy_email
  );
}
export function tierFor() {
  return { free: 0, premium: 1, diamond: 2 }[effectivePlan(state.entitlements)];
}
async function refreshEntitlements() {
  state.entitlements = normalizeEntitlements(null);
  state.entitlementError = "";
  if (!state.user) return;
  try {
    const data = checked(await sb.rpc("get_my_entitlements"));
    state.entitlements = normalizeEntitlements(data);
    if (!state.entitlements.ready)
      throw Error("Contrato de permisos incompatible");
  } catch (error) {
    state.entitlementError =
      "No se pudo verificar tu membresía. El acceso de pago permanece bloqueado. Reintenta o contacta a soporte.";
    console.warn(
      "No se pudieron cargar los permisos de membresía.",
      error?.code || "",
    );
  }
}
function upgradeNotice(feature = "El chat privado", plan = "premium") {
  dialog(
    `<span class="badge">${planName(plan)}</span><h2>${esc(feature)} está disponible ${plan === "premium" ? "desde Premium" : "en Diamante"}.</h2><p>${plan === "premium" ? "Accede a contenido Premium y conversa con texto y emojis." : "Comparte fotos, videos y notas de voz, y solicita videollamadas sujetas a aceptación."}</p><button id="upgradePlan" class="primary">Conocer ${planName(plan)}</button>`,
  );
  bind("upgradePlan", () => {
    $("dialog").close();
    location.hash = "plans";
  });
}
function accountLabel() {
  if (state.profile?.role === "admin") return "Administración";
  if (state.profile?.role === "creator") return "Creadora";
  if (state.entitlementError) return "Membresía sin verificar";
  return ["Gratis", "Premium", "Diamante"][tierFor()] || "Gratis";
}
function navigation() {
  const role = state.profile?.role;
  let items = [
    ["home", "⌂", "Creadoras"],
    ["chat", "◌", "Mensajes"],
    ["plans", "◇", "Membresías"],
    ["notifications", "♧", "Notificaciones"],
    ["profile", "○", "Mi perfil"],
  ];
  if (role === "creator") items = [
    ["home", "⌂", "Inicio"], ["profile", "○", "Mi perfil"], ["studio", "＋", "Mi contenido"],
    ["chat", "◌", "Mensajes"], ["experiences", "◇", "Experiencias"], ["agenda", "◷", "Agenda"],
    ["earnings", "$", "Mis ganancias"], ["notifications", "♧", "Notificaciones"],
  ];
  if (role === "admin") items = [
    ["admin", "▦", "Dashboard"], ["admin/accounts", "○", "Usuarios"], ["admin/identity", "◇", "Creadoras"],
    ["admin/content", "＋", "Contenido"], ["admin/chats", "◌", "Chats"], ["admin/experiences", "◷", "Experiencias"],
    ["admin/video", "▣", "Videollamadas"], ["admin/payments", "$", "Pagos"], ["admin/settlements", "↗", "Liquidaciones"],
    ["admin/reports", "!", "Reportes"], ["admin/audit", "≡", "Auditoría"], ["admin/settings", "⚙", "Configuración"],
  ];
  const currentHash = location.hash.slice(1) || (role === "admin" ? "admin" : "home");
  const current = currentHash.split("/")[0];
  $("nav").innerHTML = items.map(([id, icon, label]) => {
    const active = currentHash === id || (id === "admin" && currentHash === "admin");
    return `<a href="#${id}" class="${active ? "active" : ""}" ${active ? 'aria-current="page"' : ""}><span>${icon}</span><span>${label}</span></a>`;
  }).join("");
  $("identity").innerHTML = state.profile ? `${esc(state.profile.display_name)} <span class="badge">${accountLabel()}</span>` : '<span class="muted">Explora a tu ritmo</span>';
  $("access").textContent = state.user ? "Salir" : "Ingresar";
  const found = items.find((i) => i[0] === currentHash) || items.find((i) => i[0] === current);
  $("breadcrumb").textContent = innerWidth <= 720 ? "CARLÉA" : found?.[2] || "Descubrir";
}
async function loadAccount() {
  const auth = await sb.auth.getUser();
  if (auth.error && auth.error.name !== "AuthSessionMissingError")
    throw auth.error;
  const user = auth.data?.user || null;
  state.user = user;
  state.profile = null;
  state.creator = null;
  state.subscriptions = [];
  state.entitlements = normalizeEntitlements(null);
  state.entitlementError = "";
  if (notificationsChannel) {
    await sb.removeChannel(notificationsChannel);
    notificationsChannel = null;
  }
  if (!user) return;
  const profile = checked(
    await sb.from("profiles").select("*").eq("id", user.id).maybeSingle(),
  );
  if (!profile)
    throw Error(
      "No se encontró tu perfil. Contacta a soporte para completar el registro.",
    );
  state.profile = profile;
  state.creator = checked(
    await sb.from("creators").select("*").eq("user_id", user.id).maybeSingle(),
  );
  state.subscriptions = checked(
    await sb
      .from("client_subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100),
  );
  await refreshEntitlements();
  if (accepted) await saveConsent();
  notificationsChannel = sb
    .channel("my-notifications")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: "user_id=eq." + user.id,
      },
      (payload) => toast(payload.new.title),
    )
    .subscribe();
}
async function saveConsent() {
  if (!state.user || !accepted) return;
  const key = "carlea_consent_3_1_" + state.user.id;
  if (sessionStorage.getItem(key)) return;
  checked(
    await sb.from("legal_acceptances").insert({
      user_id: state.user.id,
      confirmed_adult: true,
      terms_version: "3.1",
      privacy_version: "3.1",
    }),
  );
  sessionStorage.setItem(key, "1");
}
async function loadCatalog() {
  let ranked = null;
  try { ranked = checked(await sb.rpc("list_ranked_creators")); } catch (error) { console.warn("Ranking 3.4 no disponible; usando catálogo compatible.", error?.message || error); }
  if (ranked) state.creators = ranked.map((c) => ({ ...catalog.find((x) => x.id === c.id), ...c }));
  else state.creators = checked(await sb.from("creators").select("*").eq("active", true).order("stage_name")).map((c) => ({ ...catalog.find((x) => x.id === c.id), ...c }));
  const ids = state.creators.map((c) => c.id), latestPublic = new Map();
  if (ids.length) {
    const posts = checked(await sb.from("content").select("creator_id,storage_bucket,storage_path,created_at").in("creator_id", ids).eq("status", "approved").eq("audience", "public").eq("media_type", "photo").order("created_at", { ascending: false }));
    for (const post of posts) if (!latestPublic.has(post.creator_id)) latestPublic.set(post.creator_id, post);
  }
  await Promise.all(state.creators.map(async (c) => {
    const post = latestPublic.get(c.id), bucket = c.cover_path ? "creator-content" : post?.storage_bucket, path = c.cover_path || post?.storage_path;
    if (!path) return;
    try { c.cover = await signed(bucket || "creator-content", path); } catch (error) { console.warn("No se pudo cargar la portada de", c.stage_name, error); }
  }));
}
function creatorPhoto(c) {
  return c.cover || fallbackCover;
}
function installImageFallbacks(root = document) {
  root.querySelectorAll("img[data-carlea-fallback]").forEach((image) => {
    image.onerror = () => {
      image.onerror = null;
      image.src = fallbackCover;
    };
  });
}
function scheduleCatalogRefresh() {
  clearTimeout(catalogRefreshTimer);
  catalogRefreshTimer = setTimeout(() => {
    const page = location.hash.slice(1).split("/")[0] || "home";
    if (accepted && ["home", "creator", "studio", "profile"].includes(page))
      attempt(route);
  }, 250);
}
function subscribeCatalogRefresh() {
  if (catalogChannel) return;
  catalogChannel = sb
    .channel("carlea-catalog-refresh")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "creators" },
      scheduleCatalogRefresh,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "content" },
      scheduleCatalogRefresh,
    )
    .subscribe();
}
async function creatorDashboard() {
  if (!state.creator) { $("main").innerHTML = empty("Tu cuenta aún no tiene un perfil de creadora vinculado."); return; }
  const [earningsR, messagesR, experiencesR, callsR, pendingR, rankR] = await Promise.all([
    sb.rpc("creator_earnings_summary", { p_creator_id: state.creator.id }),
    sb.from("messages").select("id,conversation_id", { count: "exact", head: true }).is("read_at", null).neq("sender_id", state.user.id),
    sb.from("experience_requests").select("id", { count: "exact", head: true }).eq("creator_id", state.creator.id).in("status", ["requested","admin_confirmed"]),
    sb.from("video_calls").select("id,conversations!inner(creator_id)", { count: "exact", head: true }).eq("conversations.creator_id", state.creator.id).in("status", ["requested","accepted"]),
    sb.from("content").select("id", { count: "exact", head: true }).eq("creator_id", state.creator.id).eq("status", "pending"),
    sb.rpc("list_ranked_creators"),
  ]);
  const earnings = earningsR.error ? {} : earningsR.data || {};
  const ranked = rankR.error ? [] : rankR.data || [];
  const mine = ranked.find((x) => x.id === state.creator.id) || {};
  $("main").innerHTML = `<div class="creator-dashboard">${title("TU ESPACIO", `Hola, ${esc(state.creator.stage_name)} 👋`, "Tu actividad, visibilidad y ganancias en un solo lugar.")}
    <section class="card earnings-hero"><div class="eyebrow">ESTE MES HAS GANADO</div><div class="stat">${money(Number(earnings.month_earned || 0))}</div><p>Calculado desde movimientos reales del ledger, no desde un contador editable.</p><a href="#earnings">Ver detalle de ganancias ↗</a></section>
    <div class="kpi-grid"><div class="kpi"><span>Mensajes pendientes</span><strong>${messagesR.count || 0}</strong></div><div class="kpi"><span>Videollamadas</span><strong>${callsR.count || 0}</strong></div><div class="kpi"><span>Experiencias</span><strong>${experiencesR.count || 0}</strong></div><div class="kpi"><span>Contenido en revisión</span><strong>${pendingR.count || 0}</strong></div></div>
    <div class="grid two"><section class="card"><h2>Tu visibilidad en CARLÉA</h2><p class="stat">#${mine.visibility_position || "—"}</p><p>${mine.online ? '<span class="online-dot"></span>Estás conectada' : "Activa recientemente según tu actividad real."}</p><p>✓ Publicar contenido aprobado recientemente ayuda a tu visibilidad.<br>✓ La actividad real y las respuestas cuentan.<br>⚠ Mantener una pestaña abierta sin actividad no genera posición permanente.</p><button id="improveVisibility" class="primary">Mejorar mi visibilidad</button></section>
    <section class="card"><h2>Acciones rápidas</h2><div class="stack"><a href="#studio">Subir foto o video ↗</a><a href="#chat">Responder mensajes ↗</a><a href="#experiences">Gestionar experiencias ↗</a><a href="#agenda">Actualizar agenda ↗</a><a href="#notifications">Ver notificaciones ↗</a></div></section></div></div>`;
  bind("improveVisibility", () => location.hash = "studio");
}
async function home() {
  if (state.profile?.role === "admin") { location.hash = "admin"; return admin(); }
  if (state.profile?.role === "creator") return creatorDashboard();
  await loadCatalog();
  $("main").innerHTML = title("DESCUBRE CARLÉA", "Conexiones a tu manera.", "Lo primero que ves son las creadoras. Filtra por actividad, ciudad y disponibilidad.") +
    `<div class="filters"><input id="search" type="search" aria-label="Buscar creadora" placeholder="Buscar una creadora…"><select id="creatorFilter" aria-label="Filtrar creadoras"><option value="all">Todas</option><option value="online">En línea</option><option value="recent">Activas recientemente</option></select><span class="small muted">${state.creators.length} perfiles</span></div><div id="catalog" class="grid four"></div>
    <div class="upgrade row between"><div><div class="eyebrow">UNA SOLA SUSCRIPCIÓN</div><h3>Accede al contenido habilitado en toda CARLÉA.</h3><p class="small">Premium es global, no por creadora. Diamante añade multimedia y videollamadas.</p></div><button id="discoverPlans" class="primary">Comparar planes ↗</button></div>
    <div class="upgrade row between"><div><div class="eyebrow">PARA CREADORAS</div><h3>¿Eres creadora? Construye tu perfil en CARLÉA.</h3><p class="small">Registro, verificación privada y revisión administrativa.</p></div><button id="homeCreatorJoin" class="creator-cta">Suscríbete aquí ↗</button></div>`;
  const draw = () => {
    const q = ($("search")?.value || "").toLowerCase(), f = $("creatorFilter")?.value || "all", now = Date.now();
    const list = state.creators.filter((c) => {
      const matches = `${c.stage_name} ${c.city || ""}`.toLowerCase().includes(q);
      if (!matches) return false;
      if (f === "online") return !!c.online;
      if (f === "recent") return c.last_active_at && now - new Date(c.last_active_at).getTime() < 7 * 86400000;
      return true;
    });
    $("catalog").innerHTML = list.map((c) => `<article class="creator-card"><div class="portrait"><img src="${esc(creatorPhoto(c))}" data-carlea-fallback alt="${esc(c.stage_name)}" loading="lazy">${c.verified ? '<span class="badge">✓ Identidad verificada</span>' : ""}</div><div class="creator-info"><div class="row between"><h2>${esc(c.stage_name)}</h2><span class="creator-status">${c.online ? '<span class="online-dot"></span>En línea' : c.last_active_at ? "Activa recientemente" : "Perfil"}</span></div><p>${esc(c.bio)}</p><p class="small muted">${esc(c.city || "")}${c.visibility_position ? ` · Visibilidad #${c.visibility_position}` : ""}</p><button class="full" data-open="${c.id}">Conocer a ${esc(c.stage_name)} ↗</button></div></article>`).join("") || empty("No encontramos coincidencias.");
    document.querySelectorAll("[data-open]").forEach((b) => b.onclick = () => location.hash = "creator/" + b.dataset.open);
    installImageFallbacks($("catalog"));
  };
  draw(); $("search").oninput = draw; $("creatorFilter").onchange = draw;
  bind("discoverPlans", () => location.hash = "plans");
  bind("homeCreatorJoin", () => register("creator"));
}
async function creatorPage(id) {
  const c = checked(await sb.from("creators").select("*").eq("id", id).single());
  const local = { ...(catalog.find((x) => x.id === id) || {}) };
  if (c.cover_path) { try { local.cover = await signed("creator-content", c.cover_path); } catch (_) {} }
  let posts = [];
  try { posts = checked(await sb.rpc("creator_content_manifest", { p_creator_id: id })); }
  catch (_) { posts = checked(await sb.from("content").select("*").eq("creator_id", id).eq("status", "approved").order("created_at", { ascending: false })).map((p) => ({...p, can_view:true})); }
  const exp = checked(await sb.from("experiences").select("*").eq("creator_id", id).eq("active", true).order("sort_order"));
  const postsHTML = [];
  for (const p of posts) {
    if (!p.can_view) {
      postsHTML.push(`<article class="card post locked-preview"><div><span class="badge">${p.audience === "diamond" ? "Diamante" : "Premium"}</span><h3>Contenido protegido</h3><p>${esc(p.caption || "Disponible con el plan correspondiente.")}</p><button class="primary" data-upgrade-preview>Ver membresías</button></div></article>`);
      continue;
    }
    const url = await signed(p.storage_bucket, p.storage_path);
    postsHTML.push(`<article class="card post">${p.media_type === "video" ? `<video controls playsinline preload="metadata" src="${esc(url)}"></video>` : `<img src="${esc(url)}" data-carlea-fallback alt="${esc(p.caption || "Publicación")}">`}<p>${esc(p.caption)}</p><span class="badge">${{ public:"Público", premium:"Premium", diamond:"Diamante" }[p.audience] || esc(p.audience)}</span></article>`);
  }
  const safeLink = c.links && /^https:\/\//i.test(c.links) ? `<a href="${esc(c.links)}" target="_blank" rel="noopener noreferrer">Enlace de la creadora ↗</a>` : "";
  const online = state.creators.find((x) => x.id === id)?.online;
  $("main").innerHTML = `<section class="profile-hero"><img src="${esc(local.cover || fallbackCover)}" data-carlea-fallback alt="${esc(c.stage_name)}"><div><div class="eyebrow">${esc(c.city || "BOGOTÁ")} · CREADORA</div><h1>${esc(c.stage_name)}</h1><div class="creator-status">${online ? '<span class="online-dot"></span>En línea' : "Activa recientemente"}</div>${c.verified ? '<span class="badge">✓ Identidad verificada</span>' : '<span class="badge">Identidad pendiente</span>'}<p style="margin-top:15px">${esc(c.bio)}</p>${safeLink}<div class="row" style="margin-top:16px"><button id="creatorChat" class="primary">${c.chat_open ? "Abrir conversación" : "Consultar chat"}</button><button id="creatorVideo">Videollamada</button><a href="#experiences/${id}">Experiencias ↗</a><button id="report" class="text">Reportar</button></div></div></section>
    <h2>Publicaciones</h2><div class="grid three">${postsHTML.join("") || empty("Aún no hay publicaciones aprobadas.")}</div>
    <h2 style="margin-top:28px">Experiencias disponibles</h2><div class="grid three">${exp.map((x)=>`<article class="card"><span class="badge">${esc(x.category || "experiencia")}</span><h3>${esc(x.title)}</h3><p>${esc(x.description || "")}</p><p>${money(x.price_cop || 0)}</p><a href="#experiences/${id}">Solicitar ↗</a></article>`).join("") || empty("No hay experiencias disponibles en este momento.")}</div>`;
  installImageFallbacks($("main"));
  document.querySelectorAll("[data-upgrade-preview]").forEach((b)=>b.onclick=()=>location.hash="plans");
  bind("creatorChat", async () => {
    if (!state.user) return login(); await refreshEntitlements();
    if (state.entitlementError) throw Error(state.entitlementError);
    if (!hasCapability(state.entitlements,"canMessage")) return upgradeNotice();
    if (!c.chat_open) throw Error("La creadora aún no ha abierto su chat.");
    const conv=checked(await sb.rpc("get_or_create_conversation",{p_creator_id:id})); location.hash="chat/"+conv;
  });
  bind("creatorVideo", async()=>{
    if (!state.user) return login(); await refreshEntitlements();
    if (!hasCapability(state.entitlements,"canRequestVideoCall")) return upgradeNotice("Las videollamadas","diamond");
    const conv=checked(await sb.rpc("get_or_create_conversation",{p_creator_id:id})); location.hash="chat/"+conv;
  });
  bind("report", () => {
    if (!state.user) return login();
    dialog(`<h2>Reportar perfil</h2><form id="reportForm"><label class="field">Motivo<textarea name="reason" required minlength="5" maxlength="2000"></textarea></label><button class="primary" type="submit">Enviar reporte</button></form>`);
    form("reportForm", async(f)=>{checked(await sb.from("reports").insert({user_id:state.user.id,creator_id:id,reason:f.get("reason"),workflow_status:"open"})); $("dialog").close(); toast("Reporte enviado a administración");});
  });
}
async function plansPage() {
  if (state.user) await refreshEntitlements();
  const currentPlan = effectivePlan(state.entitlements);
  const statusLabels = {
    pending: "Pendiente de revisión",
    active: "Activa",
    cancelled: "Cancelada",
    expired: "Vencida",
  };
  const date = (value) =>
    value ? new Date(value).toLocaleDateString("es-CO") : "Sin fecha";
  const perks = {
    free: [
      "Perfiles y publicaciones gratuitas",
      "Perfil personal",
      "Sin mensajería privada",
    ],
    premium: [
      "Contenido Premium",
      "Chat privado de texto y emojis",
      "Solicitudes de experiencias",
      "Sin fotos, videos, voz ni videollamadas",
    ],
    diamond: [
      "Todo lo de Premium",
      "Contenido Diamante",
      "Fotos, videos y notas de voz",
      "Solicitudes de videollamada: requieren aceptación",
    ],
  };
  $("main").innerHTML =
    title("MEMBRESÍAS", "Elige cómo quieres conectar") +
    (state.entitlementError
      ? `<div class="notice error">${esc(state.entitlementError)}</div>`
      : "") +
    `<div class="grid three">${["free", "premium", "diamond"]
      .map((plan) => {
        const selected = !state.entitlementError && currentPlan === plan;
        return `<section class="card plan ${selected ? "selected" : ""}"><span class="badge ${plan === "diamond" ? "diamond" : ""}">${planName(plan)}${selected ? " · Plan actual" : ""}</span><h2>${{ free: "Descubre", premium: "Acércate", diamond: "Comparte más" }[plan]}</h2><div class="price">${money(PLAN_PRICES[plan])}${plan !== "free" ? '<span class="small muted"> COP / mes</span>' : ""}</div><ul>${perks[plan].map((text) => `<li>${text}</li>`).join("")}</ul>${plan === "free" ? '<button id="freeExplore">Seguir explorando</button>' : `<button class="primary full" data-subscribe="${plan}" ${selected ? "disabled" : ""}>${selected ? "Plan actual" : "Solicitar " + planName(plan)}</button>`}</section>`;
      })
      .join(
        "",
      )}</div><div class="notice"><b>En esta versión el pago será validado manualmente.</b> Una solicitud PENDIENTE no activa ningún beneficio. Administración debe verificar el pago real por un canal autorizado.</div>
    ${
      state.subscriptions.length
        ? `<section class="card"><h2>Mis membresías</h2>${state.subscriptions
            .map((s) => {
              const expired =
                s.status === "active" &&
                (!s.ends_at || new Date(s.ends_at) <= new Date());
              const label = expired
                ? "Vencida"
                : s.status === "active" && !s.verified_at
                  ? "Acceso histórico vigente · pago pendiente de revisión"
                  : statusLabels[s.status] || s.status;
              return `<div class="row between" style="padding:12px 0"><div><b>${planName(s.plan)}</b><p class="small">${esc(label)}${s.ends_at ? " · Hasta " + date(s.ends_at) : ""}</p>${s.cancel_at_period_end ? `<p class="small">${s.verified_at && !expired ? "Tu membresía seguirá activa hasta " + date(s.ends_at) + "." : "Cancelación registrada."}</p>` : ""}</div>${["active", "pending"].includes(s.status) && !s.cancelled_at && !expired ? `<button data-cancel="${s.id}">Cancelar ${s.status === "pending" ? "solicitud" : "membresía"}</button>` : ""}</div>`;
            })
            .join("")}</section>`
        : ""
    }`;
  bind("freeExplore", () => (location.hash = "home"));
  document.querySelectorAll("[data-subscribe]").forEach((button) => button.onclick = () => attempt(async () => {
    if (!state.user) return register("user");
    if (state.entitlementError) throw Error(state.entitlementError);
    if (state.profile.status !== "active") throw Error("Tu cuenta debe estar aprobada para solicitar un plan.");
    const plan = button.dataset.subscribe, price = PLAN_PRICES[plan];
    dialog(`<div class="eyebrow">CHECKOUT</div><h2>${planName(plan)}</h2><div class="price">${money(price)} COP</div><div class="notice"><b>En esta versión el pago será validado manualmente.</b><br>Continuar crea una solicitud pendiente. No se activará contenido, chat ni beneficios hasta que administración valide el pago.</div><form id="checkoutForm"><label class="check"><input name="confirm" type="checkbox" required><span>Entiendo que esto no representa un cobro automático.</span></label><button class="primary full" type="submit">Continuar al pago</button></form>`);
    form("checkoutForm", async (f) => {
      if (!f.get("confirm")) throw Error("Confirma las condiciones del checkout.");
      checked(await sb.rpc("request_client_membership", { p_plan: plan }));
      $("dialog").close(); await loadAccount(); await plansPage(); toast("Solicitud de pago creada. Estado: PENDIENTE.");
    });
  }));
  document.querySelectorAll("[data-cancel]").forEach(
    (button) =>
      (button.onclick = () =>
        attempt(async () => {
          const s = state.subscriptions.find(
            (row) => row.id === button.dataset.cancel,
          );
          const message =
            s.status === "active" && s.verified_at
              ? `Tu membresía seguirá activa hasta ${date(s.ends_at)}. ¿Confirmas la cancelación?`
              : "¿Cancelar esta solicitud de membresía?";
          if (!confirm(message)) return;
          checked(
            await sb.rpc("cancel_client_membership", {
              p_subscription_id: s.id,
            }),
          );
          await loadAccount();
          await plansPage();
          toast("Cancelación registrada.");
        })),
  );
}
function login() {
  dialog(
    `<div class="eyebrow">BIENVENIDO A CARLÉA</div><h2>Vuelve a conectar.</h2><form id="loginForm">${field("Correo", "email", "", "email")}${field("Contraseña", "password", "", "password")}<button type="submit" class="primary full">Ingresar</button></form><div class="row between" style="margin-top:20px"><button id="register" class="text">Crear una cuenta</button><button id="recover" class="text">Olvidé mi contraseña</button></div>`,
  );
  form("loginForm", async (f) => {
    checked(
      await sb.auth.signInWithPassword({
        email: f.get("email"),
        password: f.get("password"),
      }),
    );
    await loadAccount();
    $("dialog").close();
    location.hash = landingForProfile(state.profile);
    await route();
    toast(
      state.profile.role === "admin"
        ? "Sesión iniciada. Bienvenido al panel administrativo."
        : state.profile.role === "creator"
          ? "Sesión iniciada. Bienvenida a tu estudio."
          : "Sesión iniciada. Bienvenido a CARLÉA.",
    );
  });
  bind("register", register);
  bind("recover", () => {
    dialog(
      `<h2>Recupera tu acceso</h2><form id="recoveryForm">${field("Correo", "email", "", "email")}<button class="primary" type="submit">Enviar enlace</button></form>`,
    );
    form("recoveryForm", async (f) => {
      checked(
        await sb.auth.resetPasswordForEmail(f.get("email"), {
          redirectTo: location.origin,
        }),
      );
      toast("Si el correo tiene una cuenta, recibirá instrucciones.");
      $("dialog").close();
    });
  });
}
function register(kind = "user") {
  const creatorMode = kind === "creator";
  dialog(`<button id="backLogin" class="text">← Volver al ingreso</button><div class="eyebrow">${creatorMode ? "REGISTRO DE CREADORA" : "NUEVA CUENTA"}</div><h2>${creatorMode ? "Empieza tu perfil de creadora" : "Crea tu cuenta"}</h2>
    ${creatorMode ? '<div class="notice">Paso 1 de 2: crea y confirma tu cuenta. Después de ingresar completarás documentos, términos y la solicitud de membresía de creadora.</div>' : ""}
    <form id="registerForm">${field("Nombre", "name")}${creatorMode ? field("Alias / nombre artístico", "alias") : ""}${field("Correo", "email", "", "email")}${field("Fecha de nacimiento", "birth_date", "", "date")}
    <label class="field">Contraseña · mínimo 12 caracteres<input name="password" type="password" minlength="12" required autocomplete="new-password"></label><label class="field">Confirmar contraseña<input name="confirm_password" type="password" minlength="12" required autocomplete="new-password"></label><label class="check"><input id="showPasswords" type="checkbox"><span>Mostrar contraseñas</span></label>
    <input type="hidden" name="kind" value="${creatorMode ? "creator" : "user"}">
    <label class="check"><input name="adult" type="checkbox" required><span>Declaro que tengo 18 años o más.</span></label>
    <label class="check"><input name="terms" type="checkbox" required><span>Acepto los <button type="button" class="text" data-legal="terms">Términos de Uso</button>.</span></label>
    <label class="check"><input name="privacy" type="checkbox" required><span>Autorizo el tratamiento descrito en la <button type="button" class="text" data-legal="privacy">Política de tratamiento de datos</button>.</span></label>
    <label class="check"><input name="marketing" type="checkbox"><span>Opcional: quiero recibir comunicaciones comerciales.</span></label>
    <button type="submit" class="primary full">Crear cuenta</button></form><button id="cancelRegister" class="text full">Regresar sin crear cuenta</button>`);
  bind("backLogin", login); bind("cancelRegister", () => { $("dialog").close(); location.hash="home"; });
  bind("showPasswords", () => { const show=$("showPasswords").checked; document.querySelectorAll('#registerForm input[name="password"],#registerForm input[name="confirm_password"]').forEach((i)=>i.type=show?"text":"password"); });
  form("registerForm", async (f) => {
    if (!f.get("adult") || !f.get("terms") || !f.get("privacy")) throw Error("Confirma la mayoría de edad y las aceptaciones obligatorias.");
    if (f.get("password") !== f.get("confirm_password")) throw Error("Las contraseñas no coinciden.");
    const birth = new Date(f.get("birth_date") + "T12:00:00"), today=new Date(); let age=today.getFullYear()-birth.getFullYear();
    if (today < new Date(today.getFullYear(),birth.getMonth(),birth.getDate())) age--;
    if (!Number.isFinite(age) || age < 18) throw Error("Debes tener 18 años o más para crear una cuenta.");
    const alias = String(f.get("alias") || f.get("name") || "").trim();
    const data=checked(await sb.auth.signUp({email:f.get("email"),password:f.get("password"),options:{emailRedirectTo:location.origin,data:{display_name:f.get("name"),full_name:f.get("name"),alias,birth_date:f.get("birth_date"),account_type:creatorMode?"creator":"client",adult_confirmed:true,commercial_consent:!!f.get("marketing")}}}));
    if (data.session) {
      await loadAccount();
      if (f.get("marketing")) checked(await sb.from("commercial_consents").insert({user_id:state.user.id,channel:"email",granted:true,source:"registration_v3_4"}));
      checked(await sb.from("legal_acceptances").insert({user_id:state.user.id,confirmed_adult:true,terms_version:LEGAL_VERSION,privacy_version:LEGAL_VERSION,acceptance_type:creatorMode?"creator_account":"client_account",legal_version:LEGAL_VERSION,source:"registration_v3_4",evidence:{marketing:!!f.get("marketing")}}));
      $("dialog").close(); location.hash=creatorMode?"profile":"home"; await route();
      toast(creatorMode ? "Cuenta creada. Completa la verificación de creadora." : "Cuenta creada.");
    } else {
      dialog(`<h2>Cuenta creada</h2><p><b>Cuenta creada. Te enviamos un correo de verificación.</b></p><p class="muted">Confirma el correo antes de continuar. Después podrás ingresar y completar ${creatorMode ? "el registro de creadora" : "tu perfil"}.</p><button id="resendVerification" class="primary">Reenviar correo de verificación</button><button id="returnHome">Regresar</button>`);
      bind("resendVerification", async()=>{ checked(await sb.auth.resend({type:"signup",email:f.get("email"),options:{emailRedirectTo:location.origin}})); toast("Correo de verificación reenviado."); });
      bind("returnHome",()=>{$("dialog").close();location.hash="home";});
    }
  });
}
async function profilePage() {
  if (!state.user) {
    $("main").innerHTML =
      title("TU ESPACIO PERSONAL", "Un perfil tan tuyo como tus conexiones.") +
      '<button id="profileLogin" class="primary">Ingresar o crear cuenta</button>';
    bind("profileLogin", login);
    return;
  }
  const p = state.profile;
  let avatar = "";
  if (p.avatar_path) avatar = await signed("avatars", p.avatar_path);
  $("main").innerHTML =
    title(
      "MI CUENTA",
      esc(p.display_name || "Mi perfil"),
      `<span class="badge">${accountLabel()}</span> · ${esc(p.status)}`,
    ) +
    `${p.status !== "active" ? '<div class="notice">Tu cuenta está pendiente o suspendida. Las funciones privadas requieren aprobación del administrador.</div>' : ""}<div class="grid two"><section class="card"><h2>Tu perfil</h2>${avatar ? `<img class="avatar" src="${esc(avatar)}" alt="Tu foto">` : ""}<form id="profileForm">${field("Nombre visible", "name", p.display_name)}<label class="field">Biografía<textarea name="bio" maxlength="1200">${esc(p.bio)}</textarea></label><label class="field">Foto · JPG, PNG o WebP · hasta 3 MB<input name="avatar" type="file" accept="image/jpeg,image/png,image/webp"></label><button type="submit" class="primary" ${p.status !== "active" ? "disabled" : ""}>Guardar cambios</button></form><button id="changePassword" class="text" style="margin-top:16px">Cambiar contraseña</button></section><section class="card"><h2>Acceso y preferencias</h2><p>${esc(p.email)}</p><p>Membresía: <span class="badge">${state.entitlementError ? "Sin verificar" : planName(effectivePlan(state.entitlements))}</span></p><p class="small muted">Consulta la vigencia y el estado de tus solicitudes.</p><button id="myPlans">Mi membresía</button><a href="#experiences">Mis experiencias ↗</a><label class="check"><input id="marketing" type="checkbox" ${p.commercial_consent ? "checked" : ""}>Novedades comerciales por correo</label><button id="saveMarketing">Guardar preferencia</button><hr><button id="identityApply" class="text">Soy creadora: verificar mi identidad</button><p class="small muted">Documento y foto del rostro privados. No se publican en tu perfil.</p><button class="text" id="privacyRights">Consultar derechos sobre mis datos</button></section></div>${state.creator ? `<section class="card" style="margin-top:20px"><h2>Personaliza tu perfil de creadora</h2><form id="creatorForm">${field("Nombre artístico", "stage_name", state.creator.stage_name)}<label class="field">Biografía pública<textarea name="bio" maxlength="1200">${esc(state.creator.bio)}</textarea></label>${field("Enlace HTTPS", "links", state.creator.links || "https://", "url")}<label class="field">Estilo<select name="accent">${["gold", "rose", "violet"].map((v, i) => `<option value="${v}" ${state.creator.accent === v ? "selected" : ""}>${["Oro cálido", "Rosa suave", "Lavanda"][i]}</option>`).join("")}</select></label><label class="check"><input name="chat" type="checkbox" ${state.creator.chat_open ? "checked" : ""}>Abrir mi sala de chat</label><button class="primary" type="submit">Guardar perfil de creadora</button></form></section>` : ""}`;
  form("profileForm", async (f) => {
    let path = p.avatar_path;
    const file = f.get("avatar");
    if (file?.size)
      path = await upload("avatars", file, state.user.id, 3 * 1024 * 1024);
    checked(
      await sb
        .from("profiles")
        .update({
          display_name: f.get("name"),
          bio: f.get("bio"),
          avatar_path: path,
        })
        .eq("id", p.id),
    );
    await loadAccount();
    toast("Perfil actualizado");
    await profilePage();
  });
  form("creatorForm", async (f) => {
    const stageName = String(f.get("stage_name") || "").trim();
    if (stageName.length < 2 || stageName.length > 60)
      throw Error("El nombre artístico debe tener entre 2 y 60 caracteres.");
    const link = f.get("links");
    if (link !== "https://" && !/^https:\/\//i.test(link))
      throw Error("El enlace debe comenzar por https://");
    checked(
      await sb
        .from("creators")
        .update({
          stage_name: stageName,
          bio: f.get("bio"),
          links: link === "https://" ? "" : link,
          accent: f.get("accent"),
          chat_open: !!f.get("chat"),
        })
        .eq("id", state.creator.id),
    );
    await loadAccount();
    toast("Perfil de creadora actualizado");
    await profilePage();
  });
  bind("myPlans", () => (location.hash = "plans"));
  bind("privacyRights", () => legal("privacy"));
  bind("identityApply", applyIdentity);
  bind("saveMarketing", async () => {
    const value = $("marketing").checked;
    checked(
      await sb.from("commercial_consents").insert({
        user_id: p.id,
        channel: "email",
        granted: value,
        source: "profile_v3",
      }),
    );
    checked(
      await sb
        .from("profiles")
        .update({
          commercial_consent: value,
          commercial_consent_at: new Date().toISOString(),
        })
        .eq("id", p.id),
    );
    toast("Preferencia guardada");
  });
  bind("changePassword", passwordDialog);
}
function passwordDialog() {
  dialog(
    `<h2>Cambia tu contraseña</h2><form id="passwordForm"><label class="field">Nueva contraseña<input name="password" type="password" required minlength="12" autocomplete="new-password"></label><button class="primary" type="submit">Guardar contraseña</button></form>`,
  );
  form("passwordForm", async (f) => {
    checked(await sb.auth.updateUser({ password: f.get("password") }));
    $("dialog").close();
    toast("Contraseña actualizada");
  });
}
async function applyIdentity() {
  if (!state.user) return register("creator");
  if (!legalReady()) throw Error("Falta completar los datos legales del operador. No se recibirán documentos todavía.");
  if (!state.creator) throw Error("Esta cuenta aún no está vinculada como creadora. Confirma el correo, cierra sesión e ingresa nuevamente.");
  const p=state.profile, c=state.creator;
  dialog(`<div class="eyebrow">REGISTRO DE CREADORA · PASO 2</div><h2>Verificación y activación</h2><p>Los documentos se almacenan en un espacio privado distinto del contenido público. Solo administración autorizada puede solicitarlos mediante una acción auditada.</p>
    <div class="photo-guide"><div>1. Documento frontal<br><span class="small">Completo, legible, sin recortes.</span></div><div>2. Documento reverso<br><span class="small">Completo y enfocado.</span></div><div>3. Selfie con documento<br><span class="small">Rostro y documento visibles.</span></div></div>
    <form id="identityForm">${field("Alias / nombre artístico","stage_name",c.stage_name || p.display_name)}${field("Teléfono","phone",p.phone || "","tel")}${field("Ciudad","city",p.city || "")}${field("Fecha de nacimiento","birth_date",state.user.user_metadata?.birth_date || "","date")}
    <label class="field">Documento frontal · JPG/PNG/WebP · hasta 5 MB<input name="front" type="file" accept="image/jpeg,image/png,image/webp" required></label><label class="field">Documento reverso · hasta 5 MB<input name="back" type="file" accept="image/jpeg,image/png,image/webp" required></label><label class="field">Selfie sosteniendo el documento · hasta 5 MB<input name="selfie" type="file" accept="image/jpeg,image/png,image/webp" required></label>
    <p><b>Por favor lee completamente estas condiciones antes de continuar.</b></p><div id="creatorTermsScroll" class="legal-scroll" tabindex="0"><h3>Términos de Uso para Creadoras</h3><p>CARLÉA es una plataforma para personas mayores de edad. La creadora declara que la información suministrada es auténtica y que posee los derechos y autorizaciones necesarios sobre el contenido que publica.</p><p>Las experiencias ofrecidas en CARLÉA se describen como actividades sociales, gastronómicas, culturales o digitales. La plataforma no ofrece ni promueve servicios sexuales, explotación, trata, proxenetismo ni contenido ilegal.</p><p>El contenido puede ser objeto de moderación. Está prohibido publicar material de menores, contenido sin derechos suficientes, suplantaciones, amenazas, explotación o instrucciones para evadir las reglas de seguridad de la plataforma.</p><p>La membresía de creadora tiene un valor mensual actual de $39.900 COP. En esta versión la validación del pago es manual. Una solicitud pendiente no activa el perfil.</p><p>Los documentos de identidad son privados, no forman parte del perfil público y se conservan únicamente durante el período necesario para verificación, seguridad, obligaciones legales o defensa de reclamaciones según la política aplicable.</p><p>La aceptación electrónica queda asociada al usuario, versión legal, fecha/hora y evidencia técnica disponible.</p><p><b>Fin de las condiciones.</b></p></div>
    <label class="check"><input id="creatorTerms" name="terms" type="checkbox" disabled required><span>Acepto los Términos de Uso para Creadoras, versión ${LEGAL_VERSION}.</span></label>
    <label class="check"><input name="privacy" type="checkbox" required><span>Acepto la Política de tratamiento de datos aplicable al registro.</span></label>
    <label class="check"><input name="sensitive" type="checkbox" required><span>Autorizo específicamente el tratamiento privado de mi documento y fotografía para verificar identidad y mayoría de edad. Entiendo que estos datos pueden ser sensibles y no serán publicados.</span></label>
    <label class="check"><input name="marketing" type="checkbox"><span>Opcional: autorizo comunicaciones comerciales.</span></label>
    <div class="notice"><b>Membresía de creadora: ${money(39900)} COP/mes.</b><br>Al enviar el registro se crea una solicitud de pago PENDIENTE para revisión administrativa.</div><button class="primary full" type="submit">Enviar registro a revisión</button></form>`);
  const scroll=$("creatorTermsScroll"), terms=$("creatorTerms");
  const unlock=()=>{ if (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 8) terms.disabled=false; };
  scroll.addEventListener("scroll",unlock); unlock();
  form("identityForm", async(f)=>{
    if (!f.get("terms") || !f.get("privacy") || !f.get("sensitive")) throw Error("Completa las aceptaciones obligatorias.");
    const paths=[];
    try {
      paths.push(await upload("identity-private",f.get("front"),state.user.id));
      paths.push(await upload("identity-private",f.get("back"),state.user.id));
      paths.push(await upload("identity-private",f.get("selfie"),state.user.id));
      checked(await sb.rpc("submit_creator_application",{p_stage_name:f.get("stage_name"),p_phone:f.get("phone"),p_city:f.get("city"),p_birth_date:f.get("birth_date"),p_document_front:paths[0],p_document_back:paths[1],p_selfie:paths[2],p_legal_version:LEGAL_VERSION}));
      if (f.get("marketing")) checked(await sb.from("commercial_consents").insert({user_id:state.user.id,channel:"email",granted:true,source:"creator_onboarding_v3_4"}));
      $("dialog").close(); await loadAccount(); toast("Registro enviado. Estado: aprobación pendiente."); await profilePage();
    } catch(e) {
      if (paths.length) await sb.storage.from("identity-private").remove(paths).catch(()=>{});
      throw e;
    }
  });
}
async function studio(statusFilter = "published") {
  if (state.profile?.role !== "creator" || !state.creator) { $("main").innerHTML=empty("Necesitas una cuenta de creadora vinculada."); return; }
  const posts=checked(await sb.from("content").select("*").eq("creator_id",state.creator.id).order("created_at",{ascending:false}));
  const matches=(p)=> statusFilter==="review" ? p.status==="pending" : statusFilter==="rejected" ? p.status==="rejected" : p.status==="approved";
  const cards=[];
  for(const p of posts.filter(matches)){
    let preview=""; try { const url=await signed(p.storage_bucket||"creator-content",p.storage_path); preview=p.media_type==="video"?`<video controls playsinline preload="metadata" src="${esc(url)}"></video>`:`<img src="${esc(url)}" data-carlea-fallback alt="${esc(p.caption||"Publicación")}">`; } catch(_){ preview='<div class="empty muted">Vista previa no disponible</div>'; }
    cards.push(`<article class="card post">${preview}<div class="row between"><span class="badge">${esc(p.status)}</span><span class="badge">${esc(p.audience)}</span></div><h3>${esc(p.caption)}</h3>${p.rejection_reason?`<p class="error"><b>Motivo:</b> ${esc(p.rejection_reason)}</p>`:""}<div class="row">${p.status==="rejected"?`<button class="primary" data-resubmit="${p.id}">Editar y volver a enviar</button>`:""}${p.status==="approved"&&p.audience==="public"&&p.media_type==="photo"?`<button data-cover="${p.id}">Usar como portada</button>`:""}<button data-delete-post="${p.id}">Eliminar</button></div></article>`);
  }
  $("main").innerHTML=title("TU CONTENIDO","Tu contenido","Publica, revisa el estado de moderación y corrige lo que sea necesario.")+
    `<div class="row between"><div class="row"><button id="newPhoto" class="primary">Subir foto</button><button id="newVideo">Subir video</button></div><a href="#home">Volver al inicio de creadora ↗</a></div>
    <div class="content-tabs"><button data-content-tab="published" class="${statusFilter==="published"?"primary":""}">Publicados (${posts.filter(p=>p.status==="approved").length})</button><button data-content-tab="review" class="${statusFilter==="review"?"primary":""}">En revisión (${posts.filter(p=>p.status==="pending").length})</button><button data-content-tab="rejected" class="${statusFilter==="rejected"?"primary":""}">Rechazados (${posts.filter(p=>p.status==="rejected").length})</button></div>
    <div class="grid three">${cards.join("")||empty("No hay contenido en esta sección.")}</div>`;
  installImageFallbacks($("main"));
  const uploadDialog=(kind)=>{
    dialog(`<h2>${kind==="photo"?"Subir foto":"Subir video"}</h2><form id="postForm"><label class="field">Archivo · hasta 50 MB<input name="file" type="file" accept="${kind==="photo"?"image/jpeg,image/png,image/webp":"video/mp4,video/webm"}" required></label><label class="field">Descripción<textarea name="caption" maxlength="1200" required></textarea></label><label class="field">Acceso<select name="audience"><option value="public">Público</option><option value="premium">Premium</option><option value="diamond">Diamante</option></select></label><label class="check"><input name="rights" type="checkbox" required><span>Confirmo que poseo los derechos y autorizaciones necesarias de las personas adultas que aparecen.</span></label><button class="primary full" type="submit">Enviar a moderación</button></form>`);
    form("postForm",async(f)=>{ const file=f.get("file"),path=await upload("creator-content",file,state.user.id,50*1024*1024); const r=await sb.from("content").insert({creator_id:state.creator.id,uploaded_by:state.user.id,media_type:kind,audience:f.get("audience"),visibility:f.get("audience")==="public"?"public":"premium",storage_path:path,storage_bucket:"creator-content",caption:f.get("caption")}); if(r.error){await sb.storage.from("creator-content").remove([path]);throw r.error;} $("dialog").close();toast("Contenido enviado a moderación");await studio("review"); });
  };
  bind("newPhoto",()=>uploadDialog("photo")); bind("newVideo",()=>uploadDialog("video"));
  document.querySelectorAll("[data-content-tab]").forEach(b=>b.onclick=()=>studio(b.dataset.contentTab));
  document.querySelectorAll("[data-resubmit]").forEach(b=>b.onclick=()=>attempt(async()=>{const p=posts.find(x=>x.id===b.dataset.resubmit);dialog(`<h2>Editar y volver a enviar</h2><form id="resubmitForm"><label class="field">Descripción<textarea name="caption" maxlength="1200" required>${esc(p.caption)}</textarea></label><label class="field">Acceso<select name="audience"><option value="public" ${p.audience==="public"?"selected":""}>Público</option><option value="premium" ${p.audience==="premium"?"selected":""}>Premium</option><option value="diamond" ${p.audience==="diamond"?"selected":""}>Diamante</option></select></label><button class="primary" type="submit">Volver a enviar</button></form>`);form("resubmitForm",async(f)=>{checked(await sb.rpc("creator_resubmit_content",{p_content_id:p.id,p_caption:f.get("caption"),p_audience:f.get("audience")}));$("dialog").close();toast("Contenido reenviado");await studio("review");});}));
  document.querySelectorAll("[data-cover]").forEach(b=>b.onclick=()=>attempt(async()=>{const p=posts.find(x=>x.id===b.dataset.cover);checked(await sb.from("creators").update({cover_path:p.storage_path}).eq("id",state.creator.id));await loadAccount();toast("Portada actualizada");await studio(statusFilter);}));
  document.querySelectorAll("[data-delete-post]").forEach(b=>b.onclick=()=>attempt(async()=>{if(!confirm("¿Eliminar esta publicación?"))return;const p=posts.find(x=>x.id===b.dataset.deletePost);checked(await sb.storage.from(p.storage_bucket).remove([p.storage_path]));checked(await sb.from("content").delete().eq("id",p.id));await studio(statusFilter);}));
}
async function notifications() {
  if (!state.user) { $("main").innerHTML=empty("Ingresa para ver tus notificaciones."); return; }
  const list=checked(await sb.from("notifications").select("*").eq("user_id",state.user.id).is("dismissed_at",null).order("created_at",{ascending:false}).limit(150));
  const destination=(n)=>{
    if(n.action_target) return n.action_target.startsWith("#")?n.action_target:"#"+n.action_target;
    const map={conversation:"chat",experience_request:"experiences",content:"studio",payment:"plans",video_call:"chat"};
    return n.entity_type&&map[n.entity_type]?`#${map[n.entity_type]}${n.entity_type==="conversation"?"/"+n.entity_id:""}`:"#notifications";
  };
  $("main").innerHTML=title("NOTIFICACIONES","Tu actividad, separada de los mensajes.","Los mensajes privados viven en Mensajes; aquí aparecen avisos del sistema, pagos, experiencias y moderación.")+
    `<div class="row" style="margin-bottom:18px"><button id="readAll">Marcar todas como leídas</button><button id="deleteRead">Eliminar leídas</button><button id="clearNotifications" class="danger">Limpiar notificaciones</button></div><div class="stack">${list.map(n=>`<article class="card ${n.read_at?"notification-read":"notification-unread"}"><div class="row between"><span class="small muted">${new Date(n.created_at).toLocaleString("es-CO")}${n.read_at?"":" · No leída"}</span><span class="badge">${esc(n.type||"aviso")}</span></div><h3>${esc(n.title)}</h3><p>${esc(n.body)}</p><div class="row"><a href="${esc(destination(n))}" data-open-notification="${n.id}">Abrir ↗</a>${n.read_at?"":`<button data-notification="${n.id}" data-action="read">Marcar como leído</button>`}<button data-notification="${n.id}" data-action="dismiss">Eliminar</button></div></article>`).join("")||empty("No tienes notificaciones.")}</div>`;
  document.querySelectorAll("[data-notification]").forEach(b=>b.onclick=()=>attempt(async()=>{checked(await sb.rpc("notification_action",{p_notification_id:b.dataset.notification,p_action:b.dataset.action}));await notifications();}));
  document.querySelectorAll("[data-open-notification]").forEach(a=>a.onclick=()=>{sb.rpc("notification_action",{p_notification_id:a.dataset.openNotification,p_action:"read"});});
  bind("readAll",async()=>{checked(await sb.rpc("notification_bulk_action",{p_action:"read_all"}));await notifications();});
  bind("deleteRead",async()=>{if(!confirm("¿Eliminar lógicamente las notificaciones leídas?"))return;checked(await sb.rpc("notification_bulk_action",{p_action:"dismiss_read"}));await notifications();});
  bind("clearNotifications",async()=>{if(!confirm("¿Limpiar todas tus notificaciones?"))return;checked(await sb.rpc("notification_bulk_action",{p_action:"dismiss_all"}));await notifications();});
}
async function admin(tab = "dashboard") {
  if (state.profile?.role !== "admin" || state.profile.status !== "active") throw Error("Acceso reservado a administración.");
  const tabs=[["dashboard","Dashboard"],["accounts","Usuarios"],["identity","Creadoras"],["content","Contenido"],["chats","Chats"],["experiences","Experiencias"],["video","Videollamadas"],["payments","Pagos"],["settlements","Liquidaciones"],["reports","Reportes"],["audit","Auditoría"],["settings","Configuración"]];
  $("main").innerHTML=title("CENTRO DE CONTROL","Administración CARLÉA.","Entorno exclusivamente administrativo. No contiene compras, perfil comercial ni funciones de cliente/creadora.")+
    `<div class="content-tabs">${tabs.map(([id,label])=>`<button data-admin-tab="${id}" class="${tab===id?"primary":""}">${label}</button>`).join("")}</div><div id="adminBody">Cargando…</div>`;
  document.querySelectorAll("[data-admin-tab]").forEach(b=>b.onclick=()=>location.hash="admin/"+b.dataset.adminTab);
  const out=$("adminBody");
  if(tab==="dashboard"){
    const m=checked(await sb.rpc("admin_metrics"));
    out.innerHTML=`<div class="kpi-grid"><div class="kpi"><span>Usuarios activos</span><strong>${m.active_users||0}</strong></div><div class="kpi"><span>Creadoras activas</span><strong>${m.active_creators||0}</strong></div><div class="kpi"><span>Contenido pendiente</span><strong>${m.pending_content||0}</strong></div><div class="kpi"><span>Pagos pendientes</span><strong>${m.pending_payments||0}</strong></div></div>
      <section class="card attention"><h2>Requiere tu atención</h2><p>Experiencias vencidas: <b>${m.overdue_experiences||0}</b> · Alertas de chat abiertas: <b>${m.open_moderation_alerts||0}</b> · Reportes abiertos: <b>${m.open_reports||0}</b></p><div class="row"><a href="#admin/payments">Revisar pagos ↗</a><a href="#admin/chats">Revisar chats ↗</a><a href="#admin/reports">Revisar reportes ↗</a></div></section>
      <section class="card"><h2>Métricas económicas</h2><p>Ingresos brutos registrados: <b>${money(m.gross_revenue||0)}</b> · Comisión CARLÉA: <b>${money(m.platform_revenue||0)}</b> · Saldo creadoras: <b>${money(m.creator_net||0)}</b></p></section>`;
    return;
  }
  if(tab==="accounts"){
    const list=checked(await sb.from("profiles").select("*").order("created_at",{ascending:false}).limit(300));
    out.innerHTML=`<div class="card table-wrap"><table><thead><tr><th>Cuenta</th><th>Rol</th><th>Plan</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${list.map(p=>`<tr><td><b>${esc(p.display_name)}</b><br>${esc(p.email)}</td><td>${esc(p.role)}</td><td>${esc(p.plan||"")}</td><td>${esc(p.status)}</td><td>${p.id===state.user.id?"Tu cuenta":`<div class="row"><button data-toggle-account="${p.id}">${p.status==="active"?"Suspender":"Activar"}</button><button class="danger" data-delete-account="${p.id}">Eliminar</button></div>`}</td></tr>`).join("")}</tbody></table></div>`;
    document.querySelectorAll("[data-toggle-account]").forEach(b=>b.onclick=()=>attempt(async()=>{const p=list.find(x=>x.id===b.dataset.toggleAccount);checked(await sb.rpc("admin_set_profile",{p_user_id:p.id,p_role:p.role,p_plan:p.plan,p_status:p.status==="active"?"suspended":"active"}));await admin(tab);}));
    document.querySelectorAll("[data-delete-account]").forEach(b=>b.onclick=()=>attempt(async()=>{const p=list.find(x=>x.id===b.dataset.deleteAccount);const reason=prompt("Motivo de eliminación/anonimización (obligatorio):");if(!reason)return;const password=prompt("Reingresa tu contraseña de administrador para autorizar esta acción:");if(!password)return;if(!confirm(`Esta acción es sensible y quedará auditada. ¿Continuar con ${p.email}?`))return;const r=await fetch("/api/admin/delete-account",{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+(await sb.auth.getSession()).data.session.access_token},body:JSON.stringify({user_id:p.id,reason,password})});const body=await r.json().catch(()=>({}));if(!r.ok)throw Error(body.error||"No se pudo completar la eliminación segura");toast(body.mode==="hard_deleted"?"Cuenta eliminada":"Cuenta anonimizada y suspendida por conservación legal/financiera");await admin(tab);}));
    return;
  }
  if(tab==="identity"){
    const list=checked(await sb.from("creator_applications").select("*,creators(stage_name)").order("created_at",{ascending:false}));
    out.innerHTML=`<div class="stack">${list.map(a=>`<section class="card"><div class="row between"><div><span class="badge">${esc(a.status)}</span><h3>${esc(a.creators?.stage_name||a.stage_name)}</h3><p>${esc(a.city||"")} · ${a.birth_date?esc(a.birth_date):""}</p></div><div class="row"><button data-view-identity="${a.id}">Revisar documentos privados</button>${a.status==="pending"?`<button class="primary" data-review="${a.id}" data-approve="true">Aprobar</button><button data-review="${a.id}" data-approve="false">Rechazar</button>`:""}</div></div><p class="small muted">Términos ${esc(a.terms_version||a.consent_version)} · ${new Date(a.consent_at).toLocaleString("es-CO")}</p>${a.reason?`<p>${esc(a.reason)}</p>`:""}</section>`).join("")||empty("No hay solicitudes.")}</div>`;
    document.querySelectorAll("[data-view-identity]").forEach(b=>b.onclick=()=>attempt(async()=>{const paths=checked(await sb.rpc("admin_identity_access",{p_application_id:b.dataset.viewIdentity}));const urls=await Promise.all([paths.front,paths.back,paths.selfie].map(x=>signed("identity-private",x)));dialog(`<h2>Revisión privada y auditada</h2><p>Este acceso queda registrado. No compartas estos documentos.</p><div class="grid three"><img style="width:100%" alt="Documento frontal" src="${esc(urls[0])}"><img style="width:100%" alt="Documento reverso" src="${esc(urls[1])}"><img style="width:100%" alt="Selfie con documento" src="${esc(urls[2])}"></div>`);}));
    document.querySelectorAll("[data-review]").forEach(b=>b.onclick=()=>attempt(async()=>{const note=prompt("Motivo/resultado de la revisión:");if(!note)return;checked(await sb.rpc("review_application_v4",{p_application_id:b.dataset.review,p_approve:b.dataset.approve==="true",p_note:note}));await admin(tab);}));
    return;
  }
  if(tab==="content"){
    const list=checked(await sb.from("content").select("*,creators(stage_name)").eq("status","pending").order("created_at"));
    out.innerHTML=`<div class="grid two">${list.map(p=>`<article class="card"><span class="badge">${esc(p.audience)}</span><h3>${esc(p.creators?.stage_name)}</h3><p>${esc(p.caption)}</p><div class="row"><button data-preview="${p.id}">Ver</button><button class="primary" data-moderate="${p.id}" data-decision="approved">Aprobar</button><button data-moderate="${p.id}" data-decision="rejected">Rechazar</button></div></article>`).join("")||empty("No hay contenido pendiente.")}</div>`;
    document.querySelectorAll("[data-preview]").forEach(b=>b.onclick=()=>attempt(async()=>{const p=list.find(x=>x.id===b.dataset.preview),u=await signed(p.storage_bucket,p.storage_path);dialog(p.media_type==="video"?`<video controls style="width:100%" src="${esc(u)}"></video>`:`<img style="width:100%" alt="Contenido" src="${esc(u)}">`);}));
    document.querySelectorAll("[data-moderate]").forEach(b=>b.onclick=()=>attempt(async()=>{const note=b.dataset.decision==="rejected"?prompt("Motivo de rechazo:"):null;if(b.dataset.decision==="rejected"&&!note)return;checked(await sb.rpc("admin_moderate_content",{p_content_id:b.dataset.moderate,p_decision:b.dataset.decision,p_notes:note}));await admin(tab);})); return;
  }
  if(tab==="chats"){
    const [convs,alerts]=await Promise.all([sb.from("conversations").select("*,creators(stage_name)").order("created_at",{ascending:false}).limit(150),sb.from("moderation_alerts").select("*").in("status",["open","in_review"]).order("created_at",{ascending:false}).limit(100)]);
    const cs=checked(convs), as=checked(alerts);
    out.innerHTML=`<div class="notice">Entrar como moderador inicia en <b>SOLO LECTURA</b>, informa a los participantes y deja auditoría. La intervención debe habilitarse explícitamente.</div><h2>Alertas de contacto externo</h2><div class="stack">${as.map(a=>`<article class="card attention"><b>Posible intercambio de contacto</b><p>${esc(a.alert_type)} · ${new Date(a.created_at).toLocaleString("es-CO")}</p><a href="#chat/${a.conversation_id}">Abrir conversación ↗</a></article>`).join("")||empty("Sin alertas abiertas.")}</div><h2 style="margin-top:28px">Chats activos</h2><div class="stack">${cs.map(c=>`<article class="card row between"><div><b>${esc(c.creators?.stage_name||"Creadora")}</b><p>${esc(c.user_id)}</p></div><button data-enter-chat="${c.id}">Entrar como moderador</button></article>`).join("")}</div>`;
    document.querySelectorAll("[data-enter-chat]").forEach(b=>b.onclick=()=>attempt(async()=>{const reason=prompt("Motivo de acceso administrativo:");if(!reason)return;checked(await sb.rpc("admin_enter_chat",{p_conversation_id:b.dataset.enterChat,p_reason:reason}));location.hash="chat/"+b.dataset.enterChat;})); return;
  }
  if(tab==="experiences"){ await experiences(); return; }
  if(tab==="video"){
    const list=checked(await sb.from("video_calls").select("*,conversations(user_id,creator_id,creators(stage_name))").order("created_at",{ascending:false}).limit(150));
    out.innerHTML=`<div class="notice"><b>Control de videollamadas.</b> Cuando el pago está pendiente puedes validarlo aquí mismo. La creadora solo podrá aceptar después de la aprobación administrativa.</div><div class="stack">${list.map(v=>`<article class="card"><div class="row between"><h3>${esc(v.conversations?.creators?.stage_name||"Videollamada")}</h3><span class="badge">${esc(v.status)}</span></div><p>${v.duration_minutes||"—"} min · ${money(v.price_cop||0)} · Pago <b>${esc(v.payment_status||"pending")}</b></p><p class="small">Inicio real: ${v.started_at?new Date(v.started_at).toLocaleString("es-CO"):"No iniciado"}</p>${v.payment_status==="pending"&&v.payment_request_id?`<div class="row"><button class="primary" data-video-payment="${v.payment_request_id}" data-approve="true">Confirmar pago</button><button data-video-payment="${v.payment_request_id}" data-approve="false">Rechazar pago</button></div>`:""}</article>`).join("")||empty("No hay videollamadas.")}</div>`;
    document.querySelectorAll("[data-video-payment]").forEach(b=>b.onclick=()=>attempt(async()=>{const approve=b.dataset.approve==="true",ref=approve?prompt("Referencia del pago verificado externamente:"):null;if(approve&&!ref)return;const notes=prompt("Observación administrativa (opcional):")||"";checked(await sb.rpc("admin_review_payment",{p_payment_id:b.dataset.videoPayment,p_approve:approve,p_reference:ref,p_notes:notes}));toast(approve?"Pago aprobado. La creadora ya puede aceptar la videollamada.":"Pago rechazado");await admin(tab);}));
    return;
  }
  if(tab==="payments"){
    const list=checked(await sb.from("payment_requests").select("*,payer:profiles!payment_requests_user_id_fkey(display_name,email),reviewer:profiles!payment_requests_reviewed_by_fkey(display_name,email),creators(stage_name)").order("requested_at",{ascending:false}).limit(200));
    out.innerHTML=`<div class="notice"><b>Pagos y activaciones.</b> Aprobar activa exactamente el producto de la solicitud. PENDIENTE nunca concede beneficios.</div><div class="stack">${list.map(p=>`<article class="card ${p.status==="pending"?"attention":""}"><div class="row between"><div><span class="badge">${esc(p.status)}</span><h3>${esc(p.product_type)}</h3><p>${esc(p.payer?.display_name||p.creators?.stage_name||"Cuenta")} · ${money(p.amount_cop)}</p><span class="small muted">${new Date(p.requested_at).toLocaleString("es-CO")}</span></div>${p.status==="pending"?`<div class="row"><button class="primary" data-payment="${p.id}" data-approve="true">Aprobar</button><button data-payment="${p.id}" data-approve="false">Rechazar</button></div>`:""}</div></article>`).join("")||empty("No hay pagos.")}</div>`;
    document.querySelectorAll("[data-payment]").forEach(b=>b.onclick=()=>attempt(async()=>{const approve=b.dataset.approve==="true",ref=approve?prompt("Referencia del pago verificado externamente:"):null;if(approve&&!ref)return;const notes=prompt("Observación administrativa (opcional):")||"";checked(await sb.rpc("admin_review_payment",{p_payment_id:b.dataset.payment,p_approve:approve,p_reference:ref,p_notes:notes}));toast(approve?"Pago aprobado y producto activado":"Pago rechazado");await admin(tab);})); return;
  }
  if(tab==="settlements"){
    const rows=checked(await sb.from("financial_ledger").select("*,creators(stage_name)").order("occurred_at",{ascending:false}).limit(300));
    out.innerHTML=`<div class="card table-wrap"><table><thead><tr><th>Fecha</th><th>Creadora</th><th>Origen</th><th>Bruto</th><th>CARLÉA</th><th>Neto</th><th>Estado</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${new Date(r.occurred_at).toLocaleDateString("es-CO")}</td><td>${esc(r.creators?.stage_name)}</td><td>${esc(r.movement_type)}</td><td>${money(r.gross_cop)}</td><td>${money(r.platform_fee_cop)}</td><td>${money(r.net_cop)}</td><td>${esc(r.status)}</td></tr>`).join("")}</tbody></table></div>`; return;
  }
  if(tab==="reports"){
    const list=checked(await sb.from("reports").select("*").order("created_at",{ascending:false}).limit(200));
    out.innerHTML=`<div class="stack">${list.map(r=>`<article class="card"><div class="row between"><h3>Reporte</h3><span class="badge">${esc(r.workflow_status||r.status)}</span></div><p>${esc(r.reason)}</p><div class="row">${["open","in_review","resolved","closed"].map(x=>`<button data-report="${r.id}" data-status="${x}">${x}</button>`).join("")}</div></article>`).join("")||empty("Sin reportes.")}</div>`;
    document.querySelectorAll("[data-report]").forEach(b=>b.onclick=()=>attempt(async()=>{checked(await sb.rpc("admin_set_report_status",{p_report_id:b.dataset.report,p_status:b.dataset.status,p_notes:"Actualizado desde centro de reportes"}));await admin(tab);})); return;
  }
  if(tab==="audit"){
    const list=checked(await sb.from("admin_audit").select("*").order("created_at",{ascending:false}).limit(250));
    out.innerHTML=`<div class="card table-wrap"><table><thead><tr><th>Fecha</th><th>Administrador</th><th>Acción</th><th>Motivo</th></tr></thead><tbody>${list.map(a=>`<tr><td>${new Date(a.created_at).toLocaleString("es-CO")}</td><td>${esc(a.admin_id||"")}</td><td>${esc(a.action)}</td><td>${esc(a.reason)}</td></tr>`).join("")}</tbody></table></div>`; return;
  }
  if(tab==="settings"){
    const s=state.settings; out.innerHTML=`<div class="grid two"><section class="card"><h2>Datos legales</h2><form id="legalForm">${field("Nombre o razón social","operator_name",s.operator_name)}${field("NIT / identificación","tax_id",s.tax_id)}${field("Domicilio","address",s.address)}${field("Correo de privacidad y PQR","privacy_email",s.privacy_email,"email")}<label class="field">Retención de identidad (días)<input name="retention_days" type="number" min="1" max="365" value="${s.retention_days||30}" required></label><button class="primary" type="submit">Guardar</button></form></section><section class="card"><h2>Integraciones</h2><p>Supabase: fuente de verdad de estados persistentes.</p><p>Cloudflare Pages: frontend/Worker.</p><p>Pagos: validación manual; no hay pasarela automática.</p><p>Videollamada: WebRTC; TURN debe configurarse para producción.</p><p class="small muted">Los secretos pertenecen al Worker/entorno servidor, nunca al frontend.</p></section></div>`;
    form("legalForm",async(f)=>{const payload=Object.fromEntries(f);payload.retention_days=Number(payload.retention_days);checked(await sb.from("platform_settings").update(payload).eq("id",true));state.settings=checked(await sb.from("platform_settings").select("*").single());toast("Configuración guardada");}); return;
  }
}
async function experiences(cid) {
  if (!state.user) { $("main").innerHTML=empty("Ingresa para solicitar experiencias.")+'<button id="experienceLogin">Ingresar</button>'; bind("experienceLogin",login); return; }
  const role=state.profile?.role;
  const creatorId=role==="creator"?state.creator?.id:cid;
  let q=sb.from("experiences").select("*,creators(stage_name)").order("sort_order");
  if(creatorId) q=q.eq("creator_id",creatorId); else q=q.eq("active",true);
  const items=checked(await q);
  let rq=sb.from("experience_requests").select("*,experiences(title,price_cop),creators(stage_name)").order("requested_at",{ascending:false}).limit(150);
  if(role==="user") rq=rq.eq("user_id",state.user.id); if(role==="creator"&&state.creator) rq=rq.eq("creator_id",state.creator.id);
  const requests=checked(await rq);
  const sla=(r)=>{const start=new Date(r.requested_at||r.created_at).getTime(),end=r.creator_responded_at?new Date(r.creator_responded_at).getTime():Date.now(),h=(end-start)/3600000;return {h,cls:h>3?"sla-red":h>2?"sla-orange":"sla-normal",label:h>3?"🔴 requiere gestión":h>2?"🟠 atención":"normal"};};
  $("main").innerHTML=title("EXPERIENCIAS",role==="creator"?"¿En cuáles experiencias estás disponible?":"Momentos para compartir","Actividades sociales, gastronómicas, culturales o digitales dentro de las reglas de CARLÉA.")+
    (role==="creator"?'<div class="notice">Todas las experiencias existentes aparecen como disponibles hasta que las desactives. Desactivar una las retira de tu perfil público inmediatamente.</div>':"")+
    `<div class="grid three">${items.map(x=>`<article class="card"><span class="badge">${esc(x.category||"experiencia")}</span><h3>${esc(x.title)}</h3><p>${esc(x.description||"")} · ${x.duration_minutes||"—"} min</p><p>${money(x.price_cop||0)}</p>${role==="user"?`<button data-request-exp="${x.id}" class="primary">Solicitar experiencia</button>`:role==="creator"?`<label class="check"><input data-toggle-exp="${x.id}" type="checkbox" ${x.active?"checked":""}><span>Disponible en mi perfil</span></label>`:""}</article>`).join("")||empty("No hay experiencias disponibles.")}</div>
    <h2 style="margin-top:30px">Solicitudes</h2><div class="stack">${requests.map(r=>{const t=sla(r);return `<article class="card"><div class="row between"><div><h3>${esc(r.experiences?.title||"Experiencia")}</h3><p>${esc(r.creators?.stage_name||"")} · ${esc(r.response_kind||r.status)}</p><span class="small ${t.cls}">${t.label} · ${t.h.toFixed(1)} h esperando respuesta</span>${r.preferred_at?`<p class="small">Preferencia: ${new Date(r.preferred_at).toLocaleString("es-CO")}</p>`:""}<p class="small">Pago: <b>${esc(r.payment_status||"pendiente")}</b>${r.completed_at?" · Completada":""}</p></div>${role==="creator"&&!r.creator_responded_at?`<div class="row"><button class="primary" data-exp-response="${r.id}" data-decision="accepted">Aceptar</button><button data-exp-response="${r.id}" data-decision="proposed">Proponer horario</button><button data-exp-response="${r.id}" data-decision="rejected">Rechazar</button></div>`:role==="creator"&&r.response_kind==="accepted"&&r.payment_status==="approved"&&!r.completed_at?`<button class="primary" data-complete-exp="${r.id}">Marcar completada</button>`:""}</div></article>`;}).join("")||empty("Sin solicitudes.")}</div>`;
  document.querySelectorAll("[data-toggle-exp]").forEach(i=>i.onchange=()=>attempt(async()=>{checked(await sb.rpc("creator_toggle_experience",{p_experience_id:i.dataset.toggleExp,p_enabled:i.checked}));toast(i.checked?"Experiencia activada":"Experiencia desactivada");}));
  document.querySelectorAll("[data-request-exp]").forEach(b=>b.onclick=()=>attempt(async()=>{await refreshEntitlements();if(!hasCapability(state.entitlements,"canMessage"))return upgradeNotice("Las experiencias","premium");dialog(`<h2>Solicitar experiencia</h2><form id="experienceRequestForm"><label class="field">Fecha y hora preferida<input name="when" type="datetime-local" required></label><label class="field">Observaciones<textarea name="notes" maxlength="2000"></textarea></label><div class="notice"><b>En esta versión el pago será validado manualmente.</b> Confirmar crea la solicitud de experiencia y su pago en estado PENDIENTE.</div><button class="primary full" type="submit">Continuar al pago</button></form>`);form("experienceRequestForm",async(f)=>{checked(await sb.rpc("request_experience_scheduled",{p_experience_id:b.dataset.requestExp,p_preferred_at:new Date(f.get("when")).toISOString(),p_notes:f.get("notes")}));$("dialog").close();toast("Solicitud enviada a creadora y administración");await experiences(cid);});}));
  document.querySelectorAll("[data-exp-response]").forEach(b=>b.onclick=()=>attempt(async()=>{let proposed=null;if(b.dataset.decision==="proposed"){const v=prompt("Nuevo horario (AAAA-MM-DD HH:MM):");if(!v)return;proposed=new Date(v.replace(" ","T")).toISOString();}const notes=prompt("Observación (opcional):")||"";checked(await sb.rpc("creator_respond_experience_v4",{p_request_id:b.dataset.expResponse,p_decision:b.dataset.decision,p_proposed_at:proposed,p_notes:notes}));await experiences(cid);}));
  document.querySelectorAll("[data-complete-exp]").forEach(b=>b.onclick=()=>attempt(async()=>{if(!confirm("Confirma que la experiencia fue efectivamente realizada. Esta acción genera el movimiento financiero."))return;checked(await sb.rpc("complete_experience_request",{p_request_id:b.dataset.completeExp}));toast("Experiencia completada y registrada en ganancias");await experiences(cid);}));
}
async function agenda() {
  if(state.profile?.role!=="creator"||!state.creator){$("main").innerHTML=empty("Agenda disponible para creadoras.");return;}
  const slots=checked(await sb.from("creator_availability").select("*").eq("creator_id",state.creator.id).order("weekday").order("start_time"));
  const days=["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
  $("main").innerHTML=title("AGENDA","Tu disponibilidad","Define bloques simples para experiencias y videollamadas.")+`<section class="card"><form id="slotForm"><label class="field">Día<select name="weekday">${days.map((d,i)=>`<option value="${i}">${d}</option>`).join("")}</select></label><div class="grid two"><label class="field">Desde<input name="start" type="time" required></label><label class="field">Hasta<input name="end" type="time" required></label></div><label class="field">Aplica a<select name="applies"><option value="all">Experiencias y videollamadas</option><option value="experience">Solo experiencias</option><option value="video">Solo videollamadas</option></select></label><button class="primary" type="submit">Agregar disponibilidad</button></form></section><h2 style="margin-top:24px">Tus horarios</h2><div class="stack">${slots.map(s=>`<article class="card row between"><div><b>${days[s.weekday]}</b><p>${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)} · ${esc(s.applies_to)}</p></div><button data-delete-slot="${s.id}">Eliminar</button></article>`).join("")||empty("Aún no has definido disponibilidad.")}</div>`;
  form("slotForm",async(f)=>{checked(await sb.from("creator_availability").insert({creator_id:state.creator.id,weekday:Number(f.get("weekday")),start_time:f.get("start"),end_time:f.get("end"),applies_to:f.get("applies"),available:true}));await agenda();});
  document.querySelectorAll("[data-delete-slot]").forEach(b=>b.onclick=()=>attempt(async()=>{checked(await sb.from("creator_availability").delete().eq("id",b.dataset.deleteSlot));await agenda();}));
}
async function earnings() {
  if(state.profile?.role!=="creator"||!state.creator){$("main").innerHTML=empty("Ganancias disponibles para creadoras.");return;}
  const [summaryR,ledgerR,membershipR]=await Promise.all([sb.rpc("creator_earnings_summary",{p_creator_id:state.creator.id}),sb.from("financial_ledger").select("*").eq("creator_id",state.creator.id).order("occurred_at",{ascending:false}).limit(200),sb.from("creator_memberships").select("*").eq("creator_id",state.creator.id).maybeSingle()]);
  const s=checked(summaryR),rows=checked(ledgerR),m=membershipR.error?null:membershipR.data;
  $("main").innerHTML=title("MIS GANANCIAS","Este mes has ganado",money(Number(s.month_earned||0)))+`<div class="kpi-grid"><div class="kpi"><span>Videollamadas</span><strong>${money(Number(s.video_calls||0))}</strong></div><div class="kpi"><span>Experiencias</span><strong>${money(Number(s.experiences||0))}</strong></div><div class="kpi"><span>Disponible</span><strong>${money(Number(s.available||0))}</strong></div><div class="kpi"><span>Pendiente</span><strong>${money(Number(s.pending||0))}</strong></div></div><div class="notice">Membresía CARLÉA: ${money(39900)} COP/mes · Estado: <b>${esc(m?.status||"pendiente")}</b>. Cuando existe saldo suficiente, el ciclo administrativo puede descontar la membresía desde el ledger; si no, genera una solicitud de pago.</div><div class="card table-wrap"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Bruto</th><th>Comisión</th><th>Neto</th><th>Estado</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${new Date(r.occurred_at).toLocaleDateString("es-CO")}</td><td>${esc(r.movement_type)}</td><td>${money(r.gross_cop)}</td><td>${money(r.platform_fee_cop)}</td><td>${money(r.net_cop)}</td><td>${esc(r.status)}</td></tr>`).join("")}</tbody></table></div>`;
}
function legal(type) {
  const s = state.settings;
  const operator = legalReady()
    ? `<p><b>Responsable:</b> ${esc(s.operator_name)} · ${esc(s.tax_id)}<br><b>Domicilio:</b> ${esc(s.address)}<br><b>Privacidad y reclamaciones:</b> ${esc(s.privacy_email)}</p>`
    : '<div class="notice">Pendiente: identificación, domicilio y contacto del responsable. El registro y la recepción de documentos permanecerán bloqueados hasta completar estos datos. Este texto no certifica cumplimiento legal.</div>';
  dialog(
    `<div class="legal"><h2>${type === "privacy" ? "Tratamiento de datos y privacidad" : "Términos de uso"}</h2><span class="small muted">Versión 3.4 · 22 de septiembre de 2026</span>${operator}${type === "privacy" ? `<h3>Qué datos y para qué</h3><p>Tratamos datos de cuenta, nombre visible, correo, fecha de nacimiento, foto, biografía, suscripción global, publicaciones, mensajes, solicitudes y registros técnicos para prestar el servicio, controlar el acceso por edad, moderar abusos y atender solicitudes. Las novedades comerciales requieren una autorización separada y opcional.</p><h3>Identidad y datos sensibles</h3><p>Las creadoras pueden aportar documento y foto del rostro para una revisión humana de identidad y mayoría de edad, con autorización específica. No se publican ni se utilizan para reconocimiento facial automático. Su suministro es facultativo y puede solicitarse un método alternativo al responsable.</p><h3>Conversaciones y cámaras</h3><p>Las conversaciones son accesibles a sus participantes según sus permisos. Administración puede revisarlas por seguridad o moderación, dejando registro del motivo y notificando a los participantes. Las videollamadas requieren solicitud, aceptación y permisos de cámara y micrófono; CARLÉA no las graba.</p><h3>Proveedores y ubicación</h3><p>Supabase presta autenticación, base de datos, mensajería y almacenamiento; el alojamiento web y estos proveedores procesan datos técnicos. El responsable debe documentar los contratos y las condiciones de transmisión o transferencia internacional antes del lanzamiento comercial.</p><h3>Conservación y seguridad</h3><p>Los documentos de identidad se almacenan de forma privada y se consultan mediante enlaces temporales. Se prevé su eliminación a los ${Number(s.retention_days) || 30} días de la decisión, salvo obligación justificada. La eliminación sigue siendo manual hasta implementar un proceso automático validado.</p><h3>Tus derechos</h3><p>Puedes conocer, actualizar, rectificar, solicitar prueba de autorización y, cuando proceda, revocar o pedir la supresión de tus datos, además de presentar quejas ante la SIC. Las consultas y reclamos se atienden por el canal del responsable conforme a la Ley 1581 de 2012 y sus normas reglamentarias aplicables.</p><h3>Autorizaciones</h3><p>La mayoría de edad, los términos, la privacidad y las comunicaciones comerciales se solicitan por separado. La declaración de edad no sustituye la verificación de identidad de las creadoras. No se solicitan datos de menores.</p>` : `<h3>Acceso y comunidad</h3><p>CARLÉA es exclusivamente para mayores de 18 años. Se prohíben la suplantación, el acoso, la explotación, la trata, el proxenetismo, el material de menores y el contenido de terceros sin autorización.</p><h3>Suscripción global</h3><p>Gratis permite explorar perfiles y publicaciones públicas. Premium, por $19.900 mensuales, añade contenido Premium y chat de texto. Diamante, por $39.900 mensuales, añade contenido Diamante, multimedia y la posibilidad de contratar videollamadas de 30, 60 o 90 minutos. Los pagos permanecen pendientes hasta validación administrativa. Una sola suscripción da acceso al nivel contratado en toda CARLÉA y no se cobra por cada creadora.</p><h3>Pagos y cancelación</h3><p>Mientras no exista una pasarela integrada, solicitar un plan no genera ningún cargo. Administración debe verificar el pago por un canal autorizado antes de activar un mes. El precio, alcance, vigencia, procedimiento de cancelación, retracto cuando corresponda y canal de atención deben mostrarse antes del pago.</p><h3>Experiencias</h3><p>Las experiencias son actividades sociales lícitas y no constituyen oferta de servicios sexuales. Toda solicitud requiere confirmación y aceptación; los acuerdos que infrinjan la ley o estas reglas están prohibidos.</p><h3>Moderación</h3><p>Administración puede aprobar registros, verificar identidad, moderar publicaciones, suspender cuentas y revisar reportes. Las revisiones de chat dejan trazabilidad y notificación. Puedes reportar un perfil y solicitar revisión de una decisión.</p>`}</div>`,
  );
}
async function route() {
  if (!accepted) return;
  const v=++routeVersion; stopChat(); navigation();
  let [page="home",id]=location.hash.slice(1).split("/");
  if(state.profile?.role==="admin" && ["home","plans","profile","creator","studio","agenda","earnings"].includes(page)){ page="admin"; id="dashboard"; }
  if(state.profile?.role==="creator" && page==="plans"){ page="home"; id=undefined; }
  $("main").innerHTML='<p class="muted">Cargando tu espacio…</p>';
  try {
    if(page==="home") await home();
    else if(page==="creator") await creatorPage(id);
    else if(page==="plans") await plansPage();
    else if(page==="profile") await profilePage();
    else if(page==="experiences") await experiences(id);
    else if(page==="studio") await studio();
    else if(page==="agenda") await agenda();
    else if(page==="earnings") await earnings();
    else if(page==="notifications") await notifications();
    else if(page==="admin") await admin(id||"dashboard");
    else if(page==="chat") {
      if(!state.user||state.profile?.status!=="active"){ $("main").innerHTML=empty("Ingresa con una cuenta aprobada para acceder a Mensajes.")+'<button id="chatLogin">Ingresar</button>';bind("chatLogin",login); }
      else if(state.profile.role==="user"){await refreshEntitlements();if(state.entitlementError)throw Error(state.entitlementError);if(!hasCapability(state.entitlements,"canMessage")){await plansPage();upgradeNotice();}else await openChats(state,id);}
      else await openChats(state,id);
    } else await home();
  } catch(e){ if(v===routeVersion) $("main").innerHTML=`<div class="notice error">${esc(e.message)}</div><button id="retry">Volver a intentar</button>`; bind("retry",route); }
}
$("closeDialog").onclick = () => $("dialog").close();
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-legal]");
  if (t) legal(t.dataset.legal);
});
$("age").onchange = $("consent").onchange = () =>
  ($("enter").disabled = !($("age").checked && $("consent").checked));
bind("creatorJoin", () => register("creator"));
bind("enter", async () => {
  accepted = true;
  $("gate").classList.add("hidden");
  $("shell").inert = false;
  await attempt(saveConsent);
  await route();
});
bind("exit", () => {
  $("gate").innerHTML =
    '<section class="gate-card"><h2>Has salido de CARLÉA.</h2><p>Puedes cerrar esta pestaña.</p><button onclick="location.reload()">Volver</button></section>';
});
bind("access", async () => {
  if (state.user) {
    await sb.auth.signOut();
    state.user = null;
    state.profile = null;
    state.creator = null;
    state.subscriptions = [];
    state.entitlements = normalizeEntitlements(null);
    state.entitlementError = "";
    if (notificationsChannel) await sb.removeChannel(notificationsChannel);
    location.hash = "home";
    await route();
  } else login();
});
window.addEventListener("hashchange", () => attempt(route));
sb.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") setTimeout(passwordDialog, 0);
  if (event === "USER_UPDATED" || event === "TOKEN_REFRESHED")
    setTimeout(async () => {
      try {
        await loadAccount();
        if (accepted) await route();
      } catch (error) {
        console.warn("No se pudo refrescar el ambiente de la sesión.", error);
      }
    }, 0);
});
async function init() {
  state.settings = checked(
    await sb.from("platform_settings").select("*").single(),
  );
  await loadAccount();
  subscribeCatalogRefresh();
  navigation();
  ["pointerdown","keydown","scroll"].forEach((event)=>window.addEventListener(event,()=>lastInteractionAt=Date.now(),{passive:true}));
  clearInterval(activityTimer);
  activityTimer=setInterval(()=>{
    if(state.profile?.role==="creator"&&state.creator&&document.visibilityState==="visible")
      sb.rpc("touch_creator_activity",{p_recent_interaction:Date.now()-lastInteractionAt<120000}).then(()=>{});
  },60000);
}
attempt(init);
