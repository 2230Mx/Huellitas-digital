// ===== Datos de ejemplo (después los puedes guardar en una base de datos) =====
const ESTADOS = {
  perdidas: ["En búsqueda", "Encontrado"],
  adopcion: ["En adopción", "Adoptado"]
};
const EMOJI = { Perro: "🐶", Gato: "🐱", Otro: "🐾" };

let publicaciones = [
  { id: 1, seccion: "perdidas", estado: "En búsqueda", nombre: "Toby", especie: "Perro", raza: "Criollo", tamano: "Mediano",
    ciudad: "Jiutepec", fecha: "2026-10-12", descripcion: "Pelaje café con mancha blanca en el pecho. Lleva collar azul. Es amigable.",
    salud: "Vacunas al día", requisitos: "", whatsapp: "", correo: "", foto: "" },
  { id: 2, seccion: "perdidas", estado: "Encontrado", nombre: "", especie: "Gato", raza: "Siamés", tamano: "Pequeño",
    ciudad: "Cuernavaca", fecha: "2026-10-15", descripcion: "Gato de ojos azules encontrado cerca del parque. Muy tranquilo.",
    salud: "", requisitos: "", whatsapp: "", correo: "", foto: "" },
  { id: 3, seccion: "adopcion", estado: "En adopción", nombre: "Luna", especie: "Perro", raza: "Mestiza", tamano: "Mediano",
    ciudad: "Cuernavaca", fecha: "2026-10-10", descripcion: "Cariñosa, juguetona y buena con niños. Rescatada hace 6 meses.",
    salud: "Vacunada, esterilizada y desparasitada", requisitos: "Patio o espacio amplio. Entrevista previa y seguimiento.", whatsapp: "", correo: "", foto: "" },
  { id: 4, seccion: "adopcion", estado: "En adopción", nombre: "Mishi", especie: "Gato", raza: "Doméstico", tamano: "Pequeño",
    ciudad: "Jiutepec", fecha: "2026-10-14", descripcion: "Tranquilo, ideal para departamento. Se lleva bien con otros gatos.",
    salud: "Vacunado y esterilizado", requisitos: "Compromiso de esterilización y no dejarlo salir sin supervisión.", whatsapp: "", correo: "", foto: "" }
];

let seccion = "perdidas";
const $ = (s) => document.querySelector(s);

// ===== Llenar selects de estado =====
function llenarEstados(select, sec, incluirTodos) {
  select.innerHTML = (incluirTodos ? '<option value="">Todos los estados</option>' : "") +
    ESTADOS[sec].map(e => `<option>${e}</option>`).join("");
}

// ===== Mostrar tarjetas =====
function mostrar() {
  const ciudad = $("#fCiudad").value.trim().toLowerCase();
  const esp = $("#fEspecie").value, tam = $("#fTamano").value, est = $("#fEstado").value;
  let lista = publicaciones.filter(p =>
    p.seccion === seccion &&
    (!ciudad || p.ciudad.toLowerCase().includes(ciudad)) &&
    (!esp || p.especie === esp) && (!tam || p.tamano === tam) && (!est || p.estado === est));
  lista.sort((a, b) => $("#fOrden").value === "nuevo" ? b.fecha.localeCompare(a.fecha) : a.fecha.localeCompare(b.fecha));

  $("#conteo").textContent = `${lista.length} publicación(es)`;
  $("#lista").innerHTML = lista.length ? lista.map(tarjeta).join("") :
    '<p class="vacio">No hay publicaciones con esos filtros. Prueba quitando alguno o publica un caso nuevo.</p>';
}

function claseEstado(e) { return e === "En búsqueda" ? "busca" : (e === "Encontrado" || e === "Adoptado") ? "ok" : ""; }
function fotoHTML(p, cls = "foto") {
  return p.foto ? `<div class="${cls}" style="background-image:url('${p.foto}')"></div>`
                : `<div class="${cls}">${EMOJI[p.especie] || "🐾"}</div>`;
}
function tarjeta(p) {
  return `<button class="card" onclick="abrirFicha(${p.id})">
    ${fotoHTML(p)}
    <div class="cuerpo">
      <h3>${esc(p.nombre) || "Sin nombre"}</h3>
      <p class="meta">${p.especie} · ${p.tamano} · ${esc(p.ciudad)}</p>
      <span class="chip ${claseEstado(p.estado)}">${p.estado}</span>
    </div></button>`;
}
// Evita que el texto escrito por usuarios se interprete como HTML
function esc(t) { return (t || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// ===== Ficha detallada =====
function abrirFicha(id) {
  const p = publicaciones.find(x => x.id === id);
  const wa = p.whatsapp ? `<a class="btn wa" target="_blank" href="https://wa.me/${p.whatsapp}?text=${encodeURIComponent("Hola, vi la publicación de " + (p.nombre || "este animal") + " en Huellitas a Casa")}">WhatsApp</a>` : "";
  const mail = p.correo ? `<a class="btn" href="mailto:${esc(p.correo)}">Correo</a>` : "";
  const otro = ESTADOS[p.seccion].find(e => e !== p.estado);
  $("#ficha").innerHTML = `<div class="det">
    ${fotoHTML(p)}
    <h2>${esc(p.nombre) || "Sin nombre"} <span class="chip ${claseEstado(p.estado)}">${p.estado}</span></h2>
    <dl>
      <dt>Especie</dt><dd>${p.especie}</dd>
      <dt>Raza</dt><dd>${esc(p.raza) || "No indicada"}</dd>
      <dt>Tamaño</dt><dd>${p.tamano}</dd>
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

function cambiarEstado(id, nuevo) {
  publicaciones.find(p => p.id === id).estado = nuevo;
  $("#ficha").close(); mostrar();
}
function compartir(id) {
  const p = publicaciones.find(x => x.id === id);
  const texto = `${p.estado}: ${p.nombre || p.especie} en ${p.ciudad}. Ayúdanos a difundir 🐾`;
  if (navigator.share) navigator.share({ title: "Huellitas a Casa", text: texto, url: location.href });
  else { navigator.clipboard.writeText(texto + " " + location.href); alert("Texto copiado. Pégalo en tus redes."); }
}

// ===== Formulario de nueva publicación =====
$("#btnNueva").onclick = () => { actualizarEstadosForm(); $("#formDlg").showModal(); };
$("#cerrarForm").onclick = () => $("#formDlg").close();
$("#formNueva").elements.seccion.onchange = actualizarEstadosForm;
function actualizarEstadosForm() {
  const f = $("#formNueva");
  llenarEstados(f.elements.estado, f.elements.seccion.value, false);
}

$("#formNueva").onsubmit = (e) => {
  const f = e.target, d = Object.fromEntries(new FormData(f));
  const guardar = (foto) => {
    publicaciones.unshift({ id: Date.now(), fecha: new Date().toISOString().slice(0, 10), ...d, foto });
    seccion = d.seccion; cambiarSeccion(seccion); f.reset();
  };
  const archivo = f.elements.foto.files[0];
  if (archivo) { // Leer la foto como imagen en memoria
    const lector = new FileReader();
    lector.onload = () => guardar(lector.result);
    lector.readAsDataURL(archivo);
  } else guardar("");
  delete d.foto;
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