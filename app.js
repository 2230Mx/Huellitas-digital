// ===== 1. CONEXIÓN CON SUPABASE (pega aquí tus 2 datos) =====
const SUPABASE_URL = "https://kgdvbvatsjfruxudrgih.supabase.co";
const SUPABASE_KEY = "sb_publishable_G4UzdKF_gC0_FIRrYducnQ_RVhRBvLo";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const ESTADOS = {
  perdidas: ["En búsqueda", "Encontrado"],
  adopcion: ["En adopción", "Adoptado"]
};
const EMOJI = { Perro: "🐶", Gato: "🐱", Otro: "🐾" };

let publicaciones = [];
let seccion = "perdidas";
const $ = (s) => document.querySelector(s);

// ===== 2. LEER publicaciones desde Supabase =====
async function cargar() {
  if (SUPABASE_URL.startsWith("PEGA")) {
    $("#lista").innerHTML = '<p class="vacio">Falta pegar tu URL y tu clave de Supabase en app.js.</p>';
    return;
  }
  const { data, error } = await db.from("publicaciones").select("*").order("created_at", { ascending: false });
  if (error) { $("#lista").innerHTML = `<p class="vacio">No se pudieron cargar las publicaciones: ${esc(error.message)}</p>`; return; }
  publicaciones = data.map(p => ({ ...p, fecha: p.created_at.slice(0, 10) }));
  mostrar();
}

function llenarEstados(select, sec, incluirTodos) {
  select.innerHTML = (incluirTodos ? '<option value="">Todos los estados</option>' : "") +
    ESTADOS[sec].map(e => `<option>${e}</option>`).join("");
}

function mostrar() {
  const ciudad = $("#fCiudad").value.trim().toLowerCase();
  const esp = $("#fEspecie").value, tam = $("#fTamano").value, est = $("#fEstado").value;
  let lista = publicaciones.filter(p =>
    p.seccion === seccion &&
    (!ciudad || (p.ciudad || "").toLowerCase().includes(ciudad)) &&
    (!esp || p.especie === esp) && (!tam || p.tamano === tam) && (!est || p.estado === est));
  lista.sort((a, b) => $("#fOrden").value === "nuevo" ? b.created_at.localeCompare(a.created_at) : a.created_at.localeCompare(b.created_at));

  $("#conteo").textContent = `${lista.length} publicación(es)`;
  $("#lista").innerHTML = lista.length ? lista.map(tarjeta).join("") :
    '<p class="vacio">No hay publicaciones con esos filtros. Prueba quitando alguno o publica un caso nuevo.</p>';
}

function claseEstado(e) { return e === "En búsqueda" ? "busca" : (e === "Encontrado" || e === "Adoptado") ? "ok" : ""; }
function fotoHTML(p, cls = "foto") {
  return p.foto ? `<div class="${cls}" style="background-image:url('${esc(p.foto)}')"></div>`
                : `<div class="${cls}">${EMOJI[p.especie] || "🐾"}</div>`;
}
function tarjeta(p) {
  return `<button class="card" onclick="abrirFicha(${p.id})">
    ${fotoHTML(p)}
    <div class="cuerpo">
      <h3>${esc(p.nombre) || "Sin nombre"}</h3>
      <p class="meta">${esc(p.especie)} · ${esc(p.tamano)} · ${esc(p.ciudad)}</p>
      <span class="chip ${claseEstado(p.estado)}">${esc(p.estado)}</span>
    </div></button>`;
}
function esc(t) { return String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// ===== Ficha detallada =====
function abrirFicha(id) {
  const p = publicaciones.find(x => x.id === id);
  const tel = (p.whatsapp || "").replace(/\D/g, "");
  const wa = tel ? `<a class="btn wa" target="_blank" href="https://wa.me/${tel}?text=${encodeURIComponent("Hola, vi la publicación de " + (p.nombre || "este animal") + " en Huellitas a Casa")}">WhatsApp</a>` : "";
  const mail = p.correo ? `<a class="btn" href="mailto:${esc(p.correo)}">Correo</a>` : "";
  const otro = ESTADOS[p.seccion].find(e => e !== p.estado);
  $("#ficha").innerHTML = `<div class="det">
    ${fotoHTML(p)}
    <h2>${esc(p.nombre) || "Sin nombre"} <span class="chip ${claseEstado(p.estado)}">${esc(p.estado)}</span></h2>
    <dl>
      <dt>Especie</dt><dd>${esc(p.especie)}</dd>
      <dt>Raza</dt><dd>${esc(p.raza) || "No indicada"}</dd>
      <dt>Tamaño</dt><dd>${esc(p.tamano)}</dd>
      <dt>Publicado</dt><dd>${p.fecha}</dd>
      ${p.salud ? `<dt>Salud</dt><dd>${esc(p.salud)}</dd>` : ""}
      ${p.requisitos ? `<dt>Requisitos</dt><dd>${esc(p.requisitos)}</dd>` : ""}
    </dl>
    <p>${esc(p.descripcion)}</p>
    ${p.seccion === "perdidas" ? `<div class="mapa">📍 Zona aproximada: <b>${esc(p.ciudad)}</b>. Por privacidad no se muestra una dirección exacta.</div>` : ""}
    <div class="acciones">${wa}${mail}
      <button class="btn sec" onclick="compartir(${p.id})">Compartir</button>
      <button class="btn sec" onclick="cambiarEstado(${p.id},'${otro}')">Marcar como ${otro.toLowerCase()}</button>
      <button class="btn sec" onclick="$('#ficha').close()">Cerrar</button>
    </div></div>`;
  $("#ficha").showModal();
}

// ===== 3. ACTUALIZAR estado en Supabase =====
async function cambiarEstado(id, nuevo) {
  const { error } = await db.from("publicaciones").update({ estado: nuevo }).eq("id", id);
  if (error) return alert("No se pudo actualizar: " + error.message);
  $("#ficha").close();
  cargar();
}
function compartir(id) {
  const p = publicaciones.find(x => x.id === id);
  const texto = `${p.estado}: ${p.nombre || p.especie} en ${p.ciudad}. Ayúdanos a difundir 🐾`;
  if (navigator.share) navigator.share({ title: "Huellitas a Casa", text: texto, url: location.href });
  else { navigator.clipboard.writeText(texto + " " + location.href); alert("Texto copiado. Pégalo en tus redes."); }
}

// ===== 4. GUARDAR publicación nueva (foto a Storage + datos a la tabla) =====
$("#btnNueva").onclick = () => { actualizarEstadosForm(); $("#formDlg").showModal(); };
$("#cerrarForm").onclick = () => $("#formDlg").close();
$("#formNueva").elements.seccion.onchange = actualizarEstadosForm;
function actualizarEstadosForm() {
  const f = $("#formNueva");
  llenarEstados(f.elements.estado, f.elements.seccion.value, false);
}

$("#formNueva").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target, boton = f.querySelector('button[type="submit"]');
  const d = Object.fromEntries(new FormData(f));
  const archivo = f.elements.foto.files[0];
  delete d.foto;
  boton.disabled = true; boton.textContent = "Publicando…";

  try {
    d.foto = "";
    if (archivo) {
      const ext = (archivo.name.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "").toLowerCase();
      const ruta = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: errFoto } = await db.storage.from("fotos").upload(ruta, archivo);
      if (errFoto) throw errFoto;
      d.foto = db.storage.from("fotos").getPublicUrl(ruta).data.publicUrl;
    }
    const { error } = await db.from("publicaciones").insert(d);
    if (error) throw error;
    f.reset(); $("#formDlg").close();
    await cargar(); cambiarSeccion(d.seccion);
  } catch (err) {
    alert("No se pudo publicar: " + err.message);
  } finally {
    boton.disabled = false; boton.textContent = "Publicar";
  }
};

// ===== Cambiar entre Perdidas y Adopción =====
function cambiarSeccion(s) {
  seccion = s;
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.seccion === s));
  llenarEstados($("#fEstado"), s, true);
  mostrar();
}
document.querySelectorAll(".tab").forEach(t => t.onclick = () => cambiarSeccion(t.dataset.seccion));
$("#filtros").addEventListener("input", mostrar);
$("#btnDonar").onclick = (e) => { e.preventDefault(); alert("Aquí conectarás tu enlace de donación (Mercado Pago, PayPal, etc.)."); };

cambiarSeccion("perdidas");
cargar();