// ===== 1. CONEXIÓN CON SUPABASE (pega aquí tus 2 datos) =====
const SUPABASE_URL = "https://kgdvbvatsjfruxudrgih.supabase.co";
const SUPABASE_KEY = "sb_publishable_G4UzdKF_gC0_FIRrYducnQ_RVhRBvLo";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const ESTADOS = { perdidas: ["En búsqueda", "Encontrado"], adopcion: ["En adopción", "Adoptado"] };
const EMOJI = { Perro: "🐶", Gato: "🐱", Otro: "🐾" };
const $ = (s) => document.querySelector(s);
let usuario = null, perfil = null, esAdmin = false, noLeidos = 0, canal = null;
let publicaciones = [], seccion = "perdidas";

function esc(t) { return String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function mapaBase(id, centro, zoom) {
  const m = L.map(id).setView(centro, zoom);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(m);
  return m;
}
// Los campos con data-num solo aceptan números (máximo 10)
document.querySelectorAll("input[data-num]").forEach(i =>
  i.addEventListener("input", () => { i.value = i.value.replace(/\D/g, "").slice(0, 10); }));

// ===== SESIÓN con Google =====
const login = () => db.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
$("#btnLogin").onclick = login;
$("#btnSalir").onclick = async () => { await db.auth.signOut(); };

db.auth.onAuthStateChange((_evento, sesion) => {
  const u = sesion?.user ?? null;
  setTimeout(() => iniciarSesion(u), 0); // evita bloqueos de Supabase
});
async function iniciarSesion(u) {
  if (u && usuario && u.id === usuario.id && perfil) return; // ya estaba iniciada
  usuario = u; perfil = null; esAdmin = false; noLeidos = 0;
  if (canal) { db.removeChannel(canal); canal = null; }
  if (usuario) {
    const [p, a] = await Promise.all([
      db.from("perfiles").select("*").eq("id", usuario.id).maybeSingle(),
      db.from("admins").select("user_id").eq("user_id", usuario.id).maybeSingle()
    ]);
    perfil = p.data; esAdmin = !!a.data;
    if (!perfil) abrirPerfil();
    contarNoLeidos(); suscribir();
    if (esAdmin) contarQuejas();
  }
  pintarSesion();
}
function pintarSesion() {
  $("#btnLogin").hidden = !!usuario;
  $("#sesion").hidden = !usuario;
  $("#btnMensajes").hidden = !usuario;
  $("#btnQuejas").hidden = !esAdmin;
  if (usuario) $("#nombreUsuario").textContent = perfil ? perfil.nombre : "Mi cuenta";
  pintarBadge();
}
function pintarBadge() { const b = $("#badge"); b.hidden = !noLeidos; b.textContent = noLeidos; }

// ===== PERFIL =====
async function subirFoto(archivo) {
  const ext = (archivo.name.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "").toLowerCase();
  const ruta = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await db.storage.from("fotos").upload(ruta, archivo);
  if (error) throw error;
  return db.storage.from("fotos").getPublicUrl(ruta).data.publicUrl;
}
async function abrirPerfil() {
  const f = $("#perfilForm");
  const [n = "", ...ap] = (usuario.user_metadata?.full_name || "").split(" ");
  f.elements.nombre.value = perfil?.nombre ?? n;
  f.elements.apellido.value = perfil?.apellido ?? ap.join(" ");
  const { data } = await db.from("datos_privados").select("telefono").eq("id", usuario.id).maybeSingle();
  f.elements.telefono.value = data?.telefono ?? "";
  if (!$("#perfilDlg").open) $("#perfilDlg").showModal();
}
$("#btnPerfil").onclick = abrirPerfil;
$("#cerrarPerfil").onclick = () => $("#perfilDlg").close();
$("#perfilForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target, d = Object.fromEntries(new FormData(f)), archivo = f.elements.foto.files[0];
  try {
    const foto = archivo ? await subirFoto(archivo) : (perfil?.foto ?? "");
    const r1 = await db.from("perfiles").upsert({ id: usuario.id, nombre: d.nombre.trim(), apellido: d.apellido.trim(), foto });
    if (r1.error) throw r1.error;
    const r2 = await db.from("datos_privados").upsert({ id: usuario.id, telefono: d.telefono.trim() });
    if (r2.error) throw r2.error;
    perfil = { id: usuario.id, nombre: d.nombre.trim(), apellido: d.apellido.trim(), foto };
    $("#perfilDlg").close(); pintarSesion();
  } catch (err) { alert("No se pudo guardar el perfil: " + err.message); }
};

// ===== LISTA de publicaciones =====
async function cargar() {
  if (SUPABASE_URL.startsWith("PEGA")) { $("#lista").innerHTML = '<p class="vacio">Falta pegar tu URL y tu clave de Supabase en config.js.</p>'; return; }
  const { data, error } = await db.from("publicaciones").select("*").order("created_at", { ascending: false });
  if (error) { $("#lista").innerHTML = `<p class="vacio">No se pudieron cargar las publicaciones: ${esc(error.message)}</p>`; return; }
  publicaciones = data.map(p => ({ ...p, fecha: p.created_at.slice(0, 10) }));
  mostrar();
}
function llenarEstados(select, sec, incluirTodos) {
  select.innerHTML = (incluirTodos ? '<option value="">Todos los estados</option>' : "") + ESTADOS[sec].map(e => `<option>${e}</option>`).join("");
}
function mostrar() {
  const ciudad = $("#fCiudad").value.trim().toLowerCase(), esp = $("#fEspecie").value, tam = $("#fTamano").value, est = $("#fEstado").value;
  const lista = publicaciones.filter(p => p.seccion === seccion &&
    (!ciudad || (p.ciudad || "").toLowerCase().includes(ciudad)) && (!esp || p.especie === esp) && (!tam || p.tamano === tam) && (!est || p.estado === est));
  lista.sort((a, b) => $("#fOrden").value === "nuevo" ? b.created_at.localeCompare(a.created_at) : a.created_at.localeCompare(b.created_at));
  $("#conteo").textContent = `${lista.length} publicación(es)`;
  $("#lista").innerHTML = lista.length ? lista.map(tarjeta).join("") : '<p class="vacio">No hay publicaciones con esos filtros.</p>';
}
const claseEstado = (e) => e === "En búsqueda" ? "busca" : (e === "Encontrado" || e === "Adoptado") ? "ok" : "";
const fotoHTML = (p, cls = "foto") => p.foto ? `<div class="${cls}" style="background-image:url('${esc(p.foto)}')"></div>` : `<div class="${cls}">${EMOJI[p.especie] || "🐾"}</div>`;
function tarjeta(p) {
  return `<button class="card" onclick="abrirFicha(${p.id})">${fotoHTML(p)}<div class="cuerpo">
    <h3>${esc(p.nombre) || "Sin nombre"}</h3><p class="meta">${esc(p.especie)} · ${esc(p.tamano)} · ${esc(p.ciudad)}</p>
    <span class="chip ${claseEstado(p.estado)}">${esc(p.estado)}</span></div></button>`;
}

// ===== FICHA =====
let mapaFicha = null;
async function abrirFicha(id) {
  const p = publicaciones.find(x => x.id === id);
  if (mapaFicha) { mapaFicha.remove(); mapaFicha = null; }
  let dueno = null, likes = 0, yaLike = false;
  if (p.user_id) {
    const r = await Promise.all([
      db.from("perfiles").select("*").eq("id", p.user_id).maybeSingle(),
      db.from("likes").select("id", { count: "exact", head: true }).eq("a_user", p.user_id),
      usuario ? db.from("likes").select("id").eq("a_user", p.user_id).eq("de_user", usuario.id).maybeSingle() : Promise.resolve({ data: null })
    ]);
    dueno = r[0].data; likes = r[1].count || 0; yaLike = !!r[2].data;
  }
  const esDueno = usuario && usuario.id === p.user_id;
  const otro = ESTADOS[p.seccion].find(e => e !== p.estado);

  const bloqueDueno = dueno ? `<div class="dueno">
    <div class="avatar" style="${dueno.foto ? `background-image:url('${esc(dueno.foto)}')` : ""}">${dueno.foto ? "" : "👤"}</div>
    <div><b>${esc(dueno.nombre)} ${esc(dueno.apellido)}</b><br><span class="meta">👍 ${likes} me gusta</span></div>
    ${!esDueno ? `<button class="btn sec" onclick="darLike('${p.user_id}',${yaLike},${p.id})">${yaLike ? "Quitar 👍" : "👍 Me gusta"}</button>
    <button class="btn sec" onclick="reportar('usuario','${p.user_id}')">🚩 Reportar cuenta</button>` : ""}</div>` : "";

  const acciones = !p.user_id ? "" : esDueno
    ? `<button class="btn" onclick="cambiarEstado(${p.id},'${otro}')">Marcar como ${otro.toLowerCase()}</button>`
    : usuario
      ? `<button class="btn" onclick="abrirChat(${p.id},'${p.user_id}')">💬 Enviar mensaje</button><button class="btn sec" onclick="reportar('publicacion',${p.id})">🚩 Reportar publicación</button>`
      : `<button class="btn" onclick="login()">Inicia sesión para escribir</button>`;

  // WhatsApp: se agrega el prefijo 52 y solo se usan números
  const tel = (p.whatsapp || "").replace(/\D/g, "");
  const wa = tel.length === 10 && !esDueno
    ? `<a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/52${tel}?text=${encodeURIComponent("Hola, vi la publicación de " + (p.nombre || "este animal") + " en Huellitas a Casa")}">WhatsApp</a>` : "";
  const admin = esAdmin ? `<button class="btn sec" onclick="eliminarPublicacion(${p.id})">🗑 Eliminar (admin)</button>` : "";

  const mapa = p.seccion === "perdidas"
    ? (p.lat != null ? `<p class="meta">📍 Última vez visto (zona aproximada)</p><div id="mapaFicha" class="mapaFicha"></div>`
                     : `<div class="mapa">📍 Zona: <b>${esc(p.ciudad)}</b></div>`) : "";

  $("#ficha").innerHTML = `<div class="det">${fotoHTML(p)}
    <h2>${esc(p.nombre) || "Sin nombre"} <span class="chip ${claseEstado(p.estado)}">${esc(p.estado)}</span></h2>
    <dl><dt>Especie</dt><dd>${esc(p.especie)}</dd><dt>Raza</dt><dd>${esc(p.raza) || "No indicada"}</dd>
    <dt>Tamaño</dt><dd>${esc(p.tamano)}</dd><dt>Ciudad</dt><dd>${esc(p.ciudad)}</dd><dt>Publicado</dt><dd>${p.fecha}</dd>
    ${p.salud ? `<dt>Salud</dt><dd>${esc(p.salud)}</dd>` : ""}${p.requisitos ? `<dt>Requisitos</dt><dd>${esc(p.requisitos)}</dd>` : ""}</dl>
    <p>${esc(p.descripcion)}</p>${mapa}${bloqueDueno}
    <div class="acciones">${acciones}${wa}<button class="btn sec" onclick="compartir(${p.id})">Compartir</button>${admin}
    <button class="btn sec" onclick="$('#ficha').close()">Cerrar</button></div></div>`;
  if (!$("#ficha").open) $("#ficha").showModal();
  if (p.lat != null && p.seccion === "perdidas") setTimeout(() => {
    mapaFicha = mapaBase("mapaFicha", [p.lat, p.lng], 15);
    L.marker([p.lat, p.lng]).addTo(mapaFicha);
  }, 100);
}

async function cambiarEstado(id, nuevo) {
  const { error } = await db.from("publicaciones").update({ estado: nuevo }).eq("id", id);
  if (error) return alert("No se pudo actualizar: " + error.message);
  $("#ficha").close(); cargar();
}
function compartir(id) {
  const p = publicaciones.find(x => x.id === id);
  const texto = `${p.estado}: ${p.nombre || p.especie} en ${p.ciudad}. Ayúdanos a difundir 🐾`;
  if (navigator.share) navigator.share({ title: "Huellitas a Casa", text: texto, url: location.href });
  else { navigator.clipboard.writeText(texto + " " + location.href); alert("Texto copiado. Pégalo en tus redes."); }
}

// ===== LIKES y REPORTES =====
async function darLike(aUser, yaLike, pubId) {
  if (yaLike) await db.from("likes").delete().eq("de_user", usuario.id).eq("a_user", aUser);
  else { const { error } = await db.from("likes").insert({ a_user: aUser }); if (error) return alert(error.message); }
  abrirFicha(pubId);
}
async function reportar(tipo, valor) {
  if (!usuario) return login();
  const motivo = prompt("¿Cuál es el motivo del reporte?");
  if (!motivo || !motivo.trim()) return;
  let fila;
  if (tipo === "usuario") fila = { tipo, usuario_id: valor, motivo: motivo.trim() };
  else { // en reportes de publicación también se guarda quién es el dueño
    const p = publicaciones.find(x => x.id === valor);
    fila = { tipo, publicacion_id: valor, usuario_id: p?.user_id ?? null, motivo: motivo.trim() };
  }
  const { error } = await db.from("reportes").insert(fila);
  alert(error ? "No se pudo enviar el reporte: " + error.message : "Reporte enviado. Gracias por ayudar a cuidar la comunidad.");
}

// ===== ADMINISTRADOR: eliminar publicaciones y buzón de quejas =====
async function eliminarPublicacion(id) {
  if (!confirm("¿Eliminar esta publicación? No se puede deshacer.")) return;
  const { data, error } = await db.from("publicaciones").delete().eq("id", id).select();
  if (error || !data || !data.length) return alert("No se pudo eliminar. ¿Tu cuenta es administradora?");
  $("#ficha").close(); await cargar();
  if ($("#quejasDlg").open) abrirQuejas();
}
async function contarQuejas() {
  const { count } = await db.from("reportes").select("id", { count: "exact", head: true }).eq("resuelto", false);
  const b = $("#badgeQuejas"); b.hidden = !count; b.textContent = count || 0;
}
async function abrirQuejas() {
  const { data: rs, error } = await db.from("reportes").select("*").order("resuelto").order("created_at", { ascending: false }).limit(100);
  if (error) return alert("No se pudieron cargar las quejas: " + error.message);
  const ids = [...new Set(rs.flatMap(r => [r.usuario_id, r.reportante]).filter(Boolean))];
  const { data: ps } = ids.length ? await db.from("perfiles").select("id,nombre,apellido").in("id", ids) : { data: [] };
  const nombre = (id) => { const x = (ps || []).find(p => p.id === id); return x ? esc(x.nombre + " " + x.apellido) : "Usuario sin perfil"; };
  const veces = {}; rs.forEach(r => { if (r.usuario_id) veces[r.usuario_id] = (veces[r.usuario_id] || 0) + 1; });
  $("#quejas").innerHTML = rs.length ? rs.map(r => {
    const pub = publicaciones.find(x => x.id === r.publicacion_id);
    return `<div class="queja ${r.resuelto ? "hecha" : ""}">
      <span><b>${r.tipo === "usuario" ? "Cuenta reportada" : "Publicación reportada"}:</b> ${r.usuario_id ? nombre(r.usuario_id) : "—"}
      <span class="meta">(${veces[r.usuario_id] || 0} reporte(s) contra esta cuenta)</span></span>
      ${r.tipo === "publicacion" ? `<span class="meta">Publicación: ${pub ? esc((pub.nombre || pub.especie) + " · " + pub.ciudad) : "ya eliminada"}</span>` : ""}
      <span>Motivo: ${esc(r.motivo)}</span>
      <span class="meta">Reportó: ${nombre(r.reportante)} · ${r.created_at.slice(0, 10)}</span>
      <div class="acciones">
        ${pub ? `<button class="btn sec" onclick="verDesdeQuejas(${pub.id})">Ver publicación</button><button class="btn sec" onclick="eliminarPublicacion(${pub.id})">🗑 Eliminar publicación</button>` : ""}
        ${r.resuelto ? "" : `<button class="btn" onclick="resolverQueja(${r.id})">✔ Resuelto</button>`}
      </div></div>`;
  }).join("") : '<p class="meta">No hay quejas.</p>';
  if (!$("#quejasDlg").open) $("#quejasDlg").showModal();
}
$("#btnQuejas").onclick = abrirQuejas;
function verDesdeQuejas(id) { $("#quejasDlg").close(); abrirFicha(id); }
async function resolverQueja(id) {
  const { error } = await db.from("reportes").update({ resuelto: true }).eq("id", id);
  if (error) return alert(error.message);
  abrirQuejas(); contarQuejas();
}

// ===== NOTIFICACIONES de mensajes (en tiempo real) =====
async function contarNoLeidos() {
  const { count } = await db.from("mensajes").select("id", { count: "exact", head: true }).eq("para_user", usuario.id).eq("leido", false);
  noLeidos = count || 0; pintarBadge();
}
function suscribir() {
  canal = db.channel("mensajes-" + usuario.id)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "mensajes", filter: `para_user=eq.${usuario.id}` }, (r) => recibido(r.new))
    .subscribe();
}
async function recibido(m) {
  if ($("#chatDlg").open && chat && chat.otroId === m.de_user && chat.pubId === m.publicacion_id) return pintarChat();
  noLeidos++; pintarBadge();
  const { data } = await db.from("perfiles").select("nombre,apellido").eq("id", m.de_user).maybeSingle();
  const quien = data ? data.nombre + " " + data.apellido : "Alguien";
  mostrarToast(`💬 ${quien}: ${m.texto}`, () => abrirChat(m.publicacion_id, m.de_user));
  if ("Notification" in window && Notification.permission === "granted" && document.hidden)
    new Notification("Huellitas a Casa", { body: `${quien}: ${m.texto}` });
}
function mostrarToast(texto, alClick) {
  const t = $("#toast"); t.textContent = texto; t.hidden = false;
  t.onclick = () => { t.hidden = true; if (alClick) alClick(); };
  clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true; }, 7000);
}

// ===== CHAT INTERNO =====
let chat = null, timer = null;
async function abrirChat(pubId, otroId) {
  chat = { pubId, otroId };
  $("#ficha").close(); $("#bandejaDlg").close(); $("#toast").hidden = true;
  if (!$("#chatDlg").open) $("#chatDlg").showModal();
  await pintarChat();
  clearInterval(timer); timer = setInterval(pintarChat, 5000);
}
$("#chatDlg").addEventListener("close", () => clearInterval(timer));
async function pintarChat() {
  if (!chat || !$("#chatDlg").open) return;
  const yo = usuario.id, el = chat.otroId;
  const { data } = await db.from("mensajes").select("*").eq("publicacion_id", chat.pubId)
    .or(`and(de_user.eq.${yo},para_user.eq.${el}),and(de_user.eq.${el},para_user.eq.${yo})`).order("created_at");
  const caja = $("#chatMsgs");
  caja.innerHTML = (data || []).map(m => `<div class="burbuja ${m.de_user === yo ? "mia" : ""}">${esc(m.texto)}</div>`).join("") || '<p class="meta">Escribe el primer mensaje.</p>';
  caja.scrollTop = caja.scrollHeight;
  if ((data || []).some(m => m.para_user === yo && !m.leido)) marcarLeidos();
}
async function marcarLeidos() {
  await db.from("mensajes").update({ leido: true }).eq("para_user", usuario.id).eq("de_user", chat.otroId).eq("publicacion_id", chat.pubId).eq("leido", false);
  contarNoLeidos();
}
$("#chatForm").onsubmit = async (e) => {
  e.preventDefault();
  const texto = $("#chatTexto").value.trim(); if (!texto) return;
  const { error } = await db.from("mensajes").insert({ publicacion_id: chat.pubId, para_user: chat.otroId, texto });
  if (error) return alert("No se pudo enviar: " + error.message);
  $("#chatTexto").value = ""; pintarChat();
};
$("#btnMensajes").onclick = async () => {
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  const { data } = await db.from("mensajes").select("*").order("created_at", { ascending: false });
  const conv = new Map();
  (data || []).forEach(m => {
    const otro = m.de_user === usuario.id ? m.para_user : m.de_user, k = m.publicacion_id + "|" + otro;
    if (!conv.has(k)) conv.set(k, { pubId: m.publicacion_id, otro, texto: m.texto, nuevos: 0 });
    if (m.para_user === usuario.id && !m.leido) conv.get(k).nuevos++;
  });
  const ids = [...new Set([...conv.values()].map(c => c.otro))];
  const { data: ps } = ids.length ? await db.from("perfiles").select("id,nombre,apellido").in("id", ids) : { data: [] };
  $("#bandeja").innerHTML = conv.size ? [...conv.values()].map(c => {
    const per = (ps || []).find(x => x.id === c.otro), pub = publicaciones.find(x => x.id === c.pubId);
    return `<button class="card" onclick="abrirChat(${c.pubId},'${c.otro}')"><b>${esc(per ? per.nombre + " " + per.apellido : "Usuario")}</b>
      · ${esc(pub ? (pub.nombre || pub.especie) : "Publicación")} ${c.nuevos ? `<span class="chip busca">${c.nuevos} nuevo(s)</span>` : ""}
      <br><span class="meta">${esc(c.texto)}</span></button>`;
  }).join("") : '<p class="meta">Todavía no tienes mensajes.</p>';
  if (!$("#bandejaDlg").open) $("#bandejaDlg").showModal();
};

// ===== PUBLICAR (requiere sesión y perfil) =====
let mapSel = null, marcador = null;
$("#btnNueva").onclick = () => {
  if (!usuario) { alert("Inicia sesión con Google para publicar."); return login(); }
  if (!perfil) { alert("Primero completa tu perfil."); return abrirPerfil(); }
  actualizarForm(); $("#formDlg").showModal(); setTimeout(() => mapSel && mapSel.invalidateSize(), 150);
};
$("#cerrarForm").onclick = () => $("#formDlg").close();
$("#formNueva").elements.seccion.onchange = () => { actualizarForm(); setTimeout(() => mapSel && mapSel.invalidateSize(), 150); };
function actualizarForm() {
  const f = $("#formNueva"), perdida = f.elements.seccion.value === "perdidas";
  llenarEstados(f.elements.estado, f.elements.seccion.value, false);
  $("#mapaForm").hidden = !perdida;
  if (perdida && !mapSel) {
    mapSel = mapaBase("mapSel", [18.92, -99.18], 12);
    mapSel.on("click", (e) => {
      if (marcador) marcador.setLatLng(e.latlng); else marcador = L.marker(e.latlng).addTo(mapSel);
      f.elements.lat.value = e.latlng.lat.toFixed(3); // redondeado para no mostrar el punto exacto
      f.elements.lng.value = e.latlng.lng.toFixed(3);
    });
  }
}
$("#formNueva").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target, boton = f.querySelector('button[type="submit"]');
  const d = Object.fromEntries(new FormData(f)), archivo = f.elements.foto.files[0];
  delete d.foto;
  if (d.seccion === "perdidas" && !d.lat) return alert("Toca el mapa para marcar dónde se vio por última vez.");
  d.lat = d.seccion === "perdidas" ? Number(d.lat) : null;
  d.lng = d.seccion === "perdidas" ? Number(d.lng) : null;
  d.whatsapp = (d.whatsapp || "").replace(/\D/g, "") || null;
  if (d.whatsapp && d.whatsapp.length !== 10) return alert("El WhatsApp debe tener 10 dígitos (sin el 52).");
  boton.disabled = true; boton.textContent = "Publicando…";
  try {
    d.foto = archivo ? await subirFoto(archivo) : "";
    const { error } = await db.from("publicaciones").insert(d);
    if (error) throw error;
    f.reset(); if (marcador) { marcador.remove(); marcador = null; }
    $("#formDlg").close(); await cargar(); cambiarSeccion(d.seccion);
  } catch (err) { alert("No se pudo publicar: " + err.message); }
  finally { boton.disabled = false; boton.textContent = "Publicar"; }
};

// ===== Secciones y filtros =====
function cambiarSeccion(s) {
  seccion = s;
  document.querySelectorAll(".tab[data-seccion]").forEach(t => t.classList.toggle("active", t.dataset.seccion === s));
  llenarEstados($("#fEstado"), s, true);
  mostrar();
}
document.querySelectorAll(".tab[data-seccion]").forEach(t => t.onclick = () => cambiarSeccion(t.dataset.seccion));
$("#filtros").addEventListener("input", mostrar);
$("#btnDonar").onclick = (e) => { e.preventDefault(); alert("Aquí conectarás tu enlace de donación (Mercado Pago, PayPal, etc.)."); };

cambiarSeccion("perdidas");
cargar();