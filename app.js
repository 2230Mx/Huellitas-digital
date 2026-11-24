// ===== 1. CONEXIÓN CON SUPABASE =====
const SUPABASE_URL = "https://kgdvbvatsjfruxudrgih.supabase.co";
const SUPABASE_KEY = "sb_publishable_G4UzdKF_gC0_FIRrYducnQ_RVhRBvLo";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const ESTADOS = { perdidas: ["En búsqueda", "Encontrado"], adopcion: ["En adopción", "Adoptado"],
                  todos: ["En búsqueda", "En adopción"], finales: ["Encontrado", "Adoptado"] };
const DONAR_URL = ""; // pega aquí tu enlace de Mercado Pago, Ko-fi o PayPal
const EMOJI = { Perro: "🐶", Gato: "🐱", Otro: "🐾" };
const $ = (s) => document.querySelector(s);
let usuario = null, perfil = null, esAdmin = false, noLeidos = 0, canal = null;
let publicaciones = [], seccion = "todos", vista = "lista", mapaGen = null, capaPins = null, hashAbierto = false;

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

// ===== FOTOS: se achican antes de subirlas (más rápido y ahorra espacio) =====
async function achicar(archivo, max = 1000) {
  if (!archivo.type.startsWith("image/")) return archivo;
  try {
    const img = await createImageBitmap(archivo);
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.8));
    return blob && blob.size < archivo.size ? new File([blob], "foto.jpg", { type: "image/jpeg" }) : archivo;
  } catch (e) { return archivo; } // si algo falla, se sube la original
}
async function subirFoto(original) {
  const archivo = await achicar(original);
  const ext = (archivo.name.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "").toLowerCase();
  const ruta = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await db.storage.from("fotos").upload(ruta, archivo);
  if (error) throw error;
  return db.storage.from("fotos").getPublicUrl(ruta).data.publicUrl;
}

// ===== PERFIL (formulario de edición) =====
async function abrirPerfil() {
  const f = $("#perfilForm");
  const [n = "", ...ap] = (usuario.user_metadata?.full_name || "").split(" ");
  f.elements.nombre.value = perfil?.nombre ?? n;
  f.elements.apellido.value = perfil?.apellido ?? ap.join(" ");
  const { data } = await db.from("datos_privados").select("telefono").eq("id", usuario.id).maybeSingle();
  f.elements.telefono.value = data?.telefono ?? "";
  if (!$("#perfilDlg").open) $("#perfilDlg").showModal();
}
$("#btnPerfil").onclick = () => verPerfil(usuario.id);
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
  const { data, error } = await db.from("publicaciones").select("*").order("created_at", { ascending: false });
  if (error) { $("#lista").innerHTML = `<p class="vacio">No se pudieron cargar las publicaciones: ${esc(error.message)}</p>`; return; }
  publicaciones = data.map(p => ({ ...p, fecha: p.created_at.slice(0, 10) }));
  mostrar();
  pintarHero();
  pintarImpacto();
  if (!hashAbierto) { hashAbierto = true; abrirDesdeHash(); }
}
function llenarEstados(select, sec, incluirTodos) {
  select.innerHTML = (incluirTodos ? '<option value="">Todos los estados</option>' : "") + ESTADOS[sec].map(e => `<option>${e}</option>`).join("");
}
function mostrar() {
  const ciudad = $("#fCiudad").value.trim().toLowerCase(), esp = $("#fEspecie").value, tam = $("#fTamano").value, est = $("#fEstado").value;
  const lista = publicaciones.filter(p => enSeccion(p) &&
    (!ciudad || (p.ciudad || "").toLowerCase().includes(ciudad)) && (!esp || p.especie === esp) && (!tam || p.tamano === tam) && (!est || p.estado === est));
  lista.sort((a, b) => $("#fOrden").value === "nuevo" ? b.created_at.localeCompare(a.created_at) : a.created_at.localeCompare(b.created_at));
  $("#conteo").textContent = `${lista.length} publicación(es)`;
  $("#lista").innerHTML = lista.length ? lista.map(tarjeta).join("") : '<p class="vacio">Aquí aún no hay huellitas 🐾 Prueba quitando algún filtro.</p>';
  pintarMapa(lista);
}
const claseEstado = (e) => e === "En búsqueda" ? "busca" : (e === "Encontrado" || e === "Adoptado") ? "ok" : "";
const fotoHTML = (p, cls = "foto") => p.foto ? `<div class="${cls}" style="background-image:url('${esc(p.foto)}')"></div>` : `<div class="${cls}">${EMOJI[p.especie] || "🐾"}</div>`;
function tarjeta(p) {
  return `<button class="card" onclick="abrirFicha(${p.id})">${fotoHTML(p)}<div class="cuerpo">
    <h3>${esc(p.nombre) || "Sin nombre"}</h3><p class="meta">${esc(p.especie)} · ${esc(p.tamano)} · ${esc(p.ciudad)}</p>
    <span class="chip ${claseEstado(p.estado)}">${esc(p.estado)}</span></div></button>`;
}

const enSeccion = (p) => seccion === "todos" ? (p.estado === "En búsqueda" || p.estado === "En adopción")
  : seccion === "finales" ? (p.estado === "Encontrado" || p.estado === "Adoptado") : p.seccion === seccion;
const enlaceCaso = (id) => location.origin + location.pathname + "#caso-" + id;

// Abre una ficha directo desde un enlace como  ...vercel.app/#caso-12
function abrirDesdeHash() {
  const m = location.hash.match(/^#caso-(\d+)$/);
  if (m && publicaciones.some(x => x.id === +m[1])) abrirFicha(+m[1]);
}

// Lista o mapa general (rojo = perdidos, azul = adopción)
function cambiarVista(v) {
  vista = v;
  $("#vLista").classList.toggle("active", v === "lista");
  $("#vMapa").classList.toggle("active", v === "mapa");
  mostrar();
}
function pintarMapa(lista) {
  $("#mapaGeneral").hidden = vista !== "mapa";
  $("#lista").hidden = vista === "mapa";
  if (vista !== "mapa") return;
  if (!mapaGen) { mapaGen = mapaBase("mapaGeneral", [18.92, -99.18], 11); capaPins = L.layerGroup().addTo(mapaGen); }
  capaPins.clearLayers();
  const pts = lista.filter(p => p.lat != null);
  pts.forEach(p => L.circleMarker([p.lat, p.lng], { radius: 11, color: "#fff", weight: 3, fillOpacity: 1,
      fillColor: p.seccion === "perdidas" ? "#e5605d" : "#2f7fc1" }).addTo(capaPins)
    .bindPopup(`<b>${esc(p.nombre) || "Sin nombre"}</b><br>${esc(p.especie)} · ${esc(p.estado)}<br><a href="#caso-${p.id}">Ver ficha</a>`));
  setTimeout(() => { mapaGen.invalidateSize(); if (pts.length) mapaGen.fitBounds(pts.map(p => [p.lat, p.lng]), { padding: [40, 40], maxZoom: 15 }); }, 60);
}

// Panel de impacto: avance hacia las metas SMART del documento
async function pintarImpacto() {
  const c = $("#impacto"); if (!c) return;
  const { count } = await db.from("perfiles").select("id", { count: "exact", head: true });
  const total = publicaciones.length, ok = publicaciones.filter(p => p.estado === "Encontrado" || p.estado === "Adoptado").length;
  const metas = [["👥", count || 0, 100, "usuarios registrados", ""], ["📋", total, 50, "publicaciones", ""],
                 ["🏠", total ? Math.round(ok * 100 / total) : 0, 25, "casos resueltos", "%"]];
  c.innerHTML = metas.map(([i, v, meta, t, s]) => `<div class="meta-card"><b>${v}${s}</b><span>${i} ${t}</span>
    <div class="barra"><i style="width:${Math.min(100, v * 100 / meta)}%"></i></div><small>Meta: ${meta}${s}</small></div>`).join("");
}

// Contadores animados del inicio
function pintarHero() {
  const cont = $("#statsHero"); if (!cont) return;
  const n = (f) => publicaciones.filter(f).length;
  const datos = [["🏠", n(p => p.estado === "Encontrado" || p.estado === "Adoptado"), "han vuelto a casa"],
                 ["🔎", n(p => p.estado === "En búsqueda"), "siguen en búsqueda"],
                 ["💛", n(p => p.estado === "En adopción"), "esperan un hogar"]];
  cont.innerHTML = datos.map(([i, v, t]) => `<div><b data-n="${v}">0</b><span>${i} ${t}</span></div>`).join("");
  cont.querySelectorAll("b").forEach(b => {
    const fin = +b.dataset.n; let x = 0;
    const paso = setInterval(() => { x += Math.max(1, Math.ceil(fin / 20)); if (x >= fin) { x = fin; clearInterval(paso); } b.textContent = x; }, 40);
  });
}
function confeti() {
  const emojis = ["🐾", "💛", "🎉", "🐶", "🐱", "✨"];
  for (let i = 0; i < 40; i++) {
    const e = document.createElement("span");
    e.textContent = emojis[i % emojis.length];
    e.className = "confeti";
    e.style.left = Math.random() * 100 + "vw";
    e.style.animationDuration = 2 + Math.random() * 2 + "s";
    e.style.fontSize = 18 + Math.random() * 18 + "px";
    document.body.appendChild(e);
    setTimeout(() => e.remove(), 4500);
  }
}

// ===== FICHA =====
let mapaFicha = null;
$("#ficha").addEventListener("close", () => { if (location.hash.startsWith("#caso-")) history.replaceState(null, "", location.pathname + location.search); });
async function abrirFicha(id) {
  const p = publicaciones.find(x => x.id === id);
  if (!p) return;
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
    <button class="enlace" onclick="verPerfil('${p.user_id}')">
      <div class="avatar" style="${dueno.foto ? `background-image:url('${esc(dueno.foto)}')` : ""}">${dueno.foto ? "" : "👤"}</div>
      <span><b>${esc(dueno.nombre)} ${esc(dueno.apellido)}</b><br><span class="meta">👍 ${likes} me gusta · Ver perfil</span></span>
    </button>
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

  // Mapa: se muestra en perdidas y en adopción si la publicación tiene ubicación
  const mapa = p.lat != null
    ? `<p class="meta">📍 ${p.seccion === "perdidas" ? "Última vez visto" : "Ubicación del animal"} (zona aproximada)</p><div id="mapaFicha" class="mapaFicha"></div>`
    : `<div class="mapa">📍 Zona: <b>${esc(p.ciudad)}</b></div>`;

  $("#ficha").innerHTML = `<div class="det">${fotoHTML(p)}
    <h2>${esc(p.nombre) || "Sin nombre"} <span class="chip ${claseEstado(p.estado)}">${esc(p.estado)}</span></h2>
    <dl><dt>Especie</dt><dd>${esc(p.especie)}</dd><dt>Raza</dt><dd>${esc(p.raza) || "No indicada"}</dd>
    <dt>Tamaño</dt><dd>${esc(p.tamano)}</dd><dt>Ciudad</dt><dd>${esc(p.ciudad)}</dd><dt>Publicado</dt><dd>${p.fecha}</dd>
    ${p.salud ? `<dt>Salud</dt><dd>${esc(p.salud)}</dd>` : ""}${p.requisitos ? `<dt>Requisitos</dt><dd>${esc(p.requisitos)}</dd>` : ""}</dl>
    <p>${esc(p.descripcion)}</p>${mapa}${bloqueDueno}
    <div class="acciones">${acciones}${wa}<button class="btn sec" onclick="compartir(${p.id})">Compartir</button>${admin}
    <button class="btn sec" onclick="$('#ficha').close()">Cerrar</button></div></div>`;
  if (!$("#ficha").open) $("#ficha").showModal();
  if (p.lat != null) setTimeout(() => {
    if (!$("#mapaFicha")) return;
    mapaFicha = mapaBase("mapaFicha", [p.lat, p.lng], 15);
    L.marker([p.lat, p.lng]).addTo(mapaFicha);
  }, 100);
}

async function cambiarEstado(id, nuevo) {
  const { error } = await db.from("publicaciones").update({ estado: nuevo }).eq("id", id);
  if (error) return alert("No se pudo actualizar: " + error.message);
  $("#ficha").close(); cargar();
  if (nuevo === "Encontrado" || nuevo === "Adoptado") confeti();
}
function compartir(id) {
  const p = publicaciones.find(x => x.id === id);
  const texto = `${p.estado}: ${p.nombre || p.especie} en ${p.ciudad}. Ayúdanos a difundir 🐾`;
  if (navigator.share) navigator.share({ title: "Huellitas a Casa", text: texto, url: enlaceCaso(id) });
  else { navigator.clipboard.writeText(texto + " " + enlaceCaso(id)); alert("Texto copiado. Pégalo en tus redes."); }
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
        ${r.usuario_id ? `<button class="btn sec" onclick="verPerfil('${r.usuario_id}')">👤 Ver perfil</button>` : ""}
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

// ===== PERFIL DE USUARIO (tarjeta; con más datos para administradores) =====
async function verPerfil(uid) {
  const [pf, lk, mio, tel, rep] = await Promise.all([
    db.from("perfiles").select("*").eq("id", uid).maybeSingle(),
    db.from("likes").select("id", { count: "exact", head: true }).eq("a_user", uid),
    usuario ? db.from("likes").select("id").eq("a_user", uid).eq("de_user", usuario.id).maybeSingle() : Promise.resolve({ data: null }),
    esAdmin ? db.from("datos_privados").select("telefono").eq("id", uid).maybeSingle() : Promise.resolve({ data: null }),
    esAdmin ? db.from("reportes").select("*").eq("usuario_id", uid).order("created_at", { ascending: false }) : Promise.resolve({ data: [] })
  ]);
  const p = pf.data;
  if (!p) return alert("Este usuario ya no existe.");
  const likes = lk.count || 0, yaLike = !!mio.data, esYo = usuario && usuario.id === uid;
  const susPubs = publicaciones.filter(x => x.user_id === uid);
  const reportes = rep.data || [];

  const acciones = esYo ? `<button class="btn sec" onclick="$('#usuarioDlg').close();abrirPerfil()">Editar mi perfil</button>`
    : usuario ? `<button class="btn sec" onclick="likePerfil('${uid}',${yaLike})">${yaLike ? "Quitar 👍" : "👍 Me gusta"}</button>
                 <button class="btn sec" onclick="reportar('usuario','${uid}')">🚩 Reportar cuenta</button>`
    : `<button class="btn" onclick="login()">Inicia sesión para dar like o reportar</button>`;

  const bloqueAdmin = esAdmin ? `<div class="queja">
      <b>🛡 Solo administradores</b>
      <span>Teléfono: ${esc(tel.data?.telefono || "No registrado")}</span>
      <span>Reportes contra esta cuenta: <b>${reportes.length}</b></span>
      ${reportes.slice(0, 10).map(r => `<span class="meta">• ${esc(r.motivo)} (${r.tipo === "usuario" ? "cuenta" : "publicación"}, ${r.created_at.slice(0, 10)}${r.resuelto ? ", resuelto" : ""})</span>`).join("")}
      ${!esYo ? `<div class="acciones"><button class="btn peligro" onclick="eliminarCuenta('${uid}')">🗑 Eliminar cuenta</button></div>` : ""}
    </div>` : "";

  $("#usuarioDlg").innerHTML = `<div class="det">
    <div class="dueno">
      <div class="avatar grande" style="${p.foto ? `background-image:url('${esc(p.foto)}')` : ""}">${p.foto ? "" : "👤"}</div>
      <div><h2>${esc(p.nombre)} ${esc(p.apellido)}</h2>
      <span class="meta">Miembro desde ${p.created_at.slice(0, 10)}</span></div>
    </div>
    <div class="acciones">${acciones}</div>
    <div class="stats">
      <div><b>${likes}</b><span>👍 Likes</span></div>
      <div><b>${susPubs.length}</b><span>Publicaciones</span></div>
      <div><b>${susPubs.filter(x => x.estado === "Encontrado" || x.estado === "Adoptado").length}</b><span>Casos resueltos</span></div>
    </div>
    <h3>${esYo ? "Mis publicaciones" : "Publicaciones"}</h3>
    <div id="bandeja">${susPubs.length ? susPubs.map(x => `<button class="card" onclick="abrirFicha(${x.id})">
      <b>${esc(x.nombre) || "Sin nombre"}</b> · ${esc(x.especie)} · ${esc(x.ciudad)}
      <span class="chip ${claseEstado(x.estado)}">${esc(x.estado)}</span></button>`).join("") : '<p class="meta">Todavía no tiene publicaciones.</p>'}</div>
    ${bloqueAdmin}
    <button class="btn sec" onclick="$('#usuarioDlg').close()">Cerrar</button></div>`;
  if (!$("#usuarioDlg").open) $("#usuarioDlg").showModal();
}
async function likePerfil(uid, yaLike) {
  if (yaLike) await db.from("likes").delete().eq("de_user", usuario.id).eq("a_user", uid);
  else { const { error } = await db.from("likes").insert({ a_user: uid }); if (error) return alert(error.message); }
  verPerfil(uid);
}
async function eliminarCuenta(uid) {
  if (!confirm("¿Eliminar esta cuenta? Se borrarán también sus publicaciones, mensajes y likes. No se puede deshacer.")) return;
  const { error } = await db.rpc("eliminar_usuario", { uid });
  if (error) return alert("No se pudo eliminar la cuenta: " + error.message);
  $("#usuarioDlg").close(); $("#ficha").close();
  await cargar(); contarQuejas();
  if ($("#quejasDlg").open) abrirQuejas();
  alert("Cuenta eliminada.");
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
  $("#ficha").close(); $("#bandejaDlg").close(); $("#usuarioDlg").close(); $("#toast").hidden = true;
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
   $("#camposAdopcion").hidden = perdida; // vacunas y requisitos solo en adopción
  f.elements.descripcion.placeholder = perdida
    ? "Color, señas particulares, collar, dónde y cuándo se vio por última vez..."
    : "Carácter, edad aproximada, cómo es con niños y otros animales...";
  $("#mapaForm").hidden = false; // el mapa se usa en las dos secciones
  const txt = $("#textoMapa");
  if (txt) txt.textContent = perdida ? "📍 Toca el mapa donde se vio por última vez *" : "📍 Toca el mapa donde se encuentra el animal (zona aproximada) *";
  if (!mapSel) {
    mapSel = mapaBase("mapSel", [18.92, -99.18], 12);
    mapSel.on("click", (e) => {
      if (marcador) marcador.setLatLng(e.latlng); else marcador = L.marker(e.latlng).addTo(mapSel);
      f.elements.lat.value = e.latlng.lat.toFixed(3); // redondeado para no mostrar el punto exacto
      f.elements.lng.value = e.latlng.lng.toFixed(3);
    });
  }
}

// Al escribir la calle o la ciudad, el mapa busca el lugar y pone el marcador
let temporizador = null;
async function buscarEnMapa() {
  const f = $("#formNueva");
  const texto = [$("#buscaCalle")?.value.trim(), f.elements.ciudad.value.trim()].filter(Boolean).join(", ");
  if (texto.length < 3 || !mapSel) return;
  try {
    const r = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=mx&q=" + encodeURIComponent(texto));
    const lugares = await r.json();
    if (!lugares.length) return;
    const pos = L.latLng(+lugares[0].lat, +lugares[0].lon);
    mapSel.setView(pos, 16);
    if (marcador) marcador.setLatLng(pos); else marcador = L.marker(pos).addTo(mapSel);
    f.elements.lat.value = pos.lat.toFixed(3);
    f.elements.lng.value = pos.lng.toFixed(3);
  } catch (e) { /* sin internet o servicio ocupado: se puede tocar el mapa a mano */ }
}
["#buscaCalle", "#formNueva [name=ciudad]"].forEach(sel =>
  $(sel)?.addEventListener("input", () => { clearTimeout(temporizador); temporizador = setTimeout(buscarEnMapa, 900); }));

$("#formNueva").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target, boton = f.querySelector('button[type="submit"]');
  const d = Object.fromEntries(new FormData(f)), archivo = f.elements.foto.files[0];
  delete d.foto;
    if (d.seccion === "perdidas") { d.salud = ""; d.requisitos = ""; } // por si los llenó antes de cambiar de tipo
  if (!d.lat) return alert("Toca el mapa o escribe la calle para marcar la ubicación.");
  d.lat = Number(d.lat); d.lng = Number(d.lng);
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
$("#btnDonar").onclick = (e) => { e.preventDefault(); if (DONAR_URL) window.open(DONAR_URL, "_blank", "noopener"); else alert("Aquí irá tu enlace de donación. Se pega en DONAR_URL, al inicio de app.js."); };
$("#vLista").onclick = () => cambiarVista("lista");
$("#vMapa").onclick = () => cambiarVista("mapa");
window.addEventListener("hashchange", abrirDesdeHash);

cambiarSeccion("todos");
cargar();