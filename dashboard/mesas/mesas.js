/* =========================================================
   MESAS — Plano de asientos
   Clic para seleccionar + clic para asignar (base, funciona en
   cualquier dispositivo) con drag & drop como mejora extra para
   escritorio. Exportación a Excel (SheetJS) y vista imprimible.
   ========================================================= */

(function () {

  /* =========================================================
     ⚠️ CONFIGURACIÓN SUPABASE
     Las mismas credenciales que usan rsvp.js y admin.js
     ========================================================= */
  const SUPABASE_URL = 'https://nvkuqndqlfdxkvuhlwcy.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_8SX6IrG_3JGb-vIv3_ooXw_fMnrCRsy';

  const TABLE_MESAS = 'mesas';
  const TABLE_ASIENTOS = 'asientos';
  const TABLE_MIEMBROS = 'miembros';

  let accessToken = null;

  /* ---------------------------------------------------------
     Estado en memoria
     --------------------------------------------------------- */
  let mesasCache = [];       // [{id, nombre, capacidad, asientos:[...]}]
  let todosMiembros = [];    // [{id, nombre, asiste, familia}]
  let miembroSeleccionadoId = null;
  let mesaPendienteBorrar = null;

  /* ---------------------------------------------------------
     Referencias al DOM
     --------------------------------------------------------- */
  const logoutBtn = document.getElementById('logout-btn');

  const sinsentarList = document.getElementById('sinsentar-list');
  const sinsentarCount = document.getElementById('sinsentar-count');
  const sinsentarHint = document.getElementById('sinsentar-hint');

  const mesasGrid = document.getElementById('mesas-grid');
  const mesasCanvasWrap = document.getElementById('mesas-canvas-wrap');
  const openAddMesaBtn = document.getElementById('open-add-mesa');

  const mesaModal = document.getElementById('mesa-modal');
  const mesaModalTitle = document.getElementById('mesa-modal-title');
  const mesaForm = document.getElementById('mesa-form');
  const mesaNombre = document.getElementById('mesa-nombre');
  const mesaForma = document.getElementById('mesa-forma');
  const mesaCapacidad = document.getElementById('mesa-capacidad');
  const mesaOriginalId = document.getElementById('mesa-original-id');
  const mesaModalError = document.getElementById('mesa-modal-error');
  const mesaCancelBtn = document.getElementById('mesa-cancel-btn');
  const mesaSubmitBtn = document.getElementById('mesa-submit-btn');

  const deleteMesaModal = document.getElementById('delete-mesa-modal');
  const deleteMesaDesc = document.getElementById('delete-mesa-desc');
  const deleteMesaCancelBtn = document.getElementById('delete-mesa-cancel-btn');
  const deleteMesaConfirmBtn = document.getElementById('delete-mesa-confirm-btn');

  const asignarModal = document.getElementById('asignar-modal');
  const asignarModalDesc = document.getElementById('asignar-modal-desc');
  const asignarBuscar = document.getElementById('asignar-buscar');
  const asignarLista = document.getElementById('asignar-lista');
  const asignarCancelBtn = document.getElementById('asignar-cancel-btn');
  let asientoParaAsignarId = null;

  const exportExcelBtn = document.getElementById('export-excel-btn');
  const printPlanoBtn = document.getElementById('print-plano-btn');
  const printListaBtn = document.getElementById('print-lista-btn');
  const printPlanoContainer = document.getElementById('print-plano');

  const toastContainer = document.getElementById('toast-container');

  const zoomInBtn = document.getElementById('zoom-in-btn');
  const zoomOutBtn = document.getElementById('zoom-out-btn');
  const zoomResetBtn = document.getElementById('zoom-reset-btn');
  const zoomLevelLabel = document.getElementById('zoom-level');

  /* =========================================================
     HELPERS DE FETCH A SUPABASE (igual que admin.js)
     ========================================================= */
  function authHeaders(extra = {}) {
    return {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}`,
      ...extra,
    };
  }

  async function supabaseFetch(path, options = {}) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(errText || `Error en la petición (${response.status})`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  }

  function estadoDeMiembro(m) {
    return m.asiste === true ? 'confirmado' : m.asiste === false ? 'no-asiste' : 'pendiente';
  }

  /* =========================================================
     NOTIFICACIONES — nunca mostramos el detalle técnico del
     error (endpoints, mensajes de la base de datos, etc.), solo
     un aviso claro para la persona. El detalle real se manda a
     la consola por si algún día hay que depurar.
     ========================================================= */
  function mostrarAviso(mensaje, tipo = 'error') {
    const toast = document.createElement('div');
    toast.className = `toast toast--${tipo}`;
    toast.textContent = mensaje;
    toastContainer.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));
    setTimeout(() => {
      toast.classList.remove('is-visible');
      setTimeout(() => toast.remove(), 250);
    }, 4200);
  }

  function registrarError(err) {
    // Detalle completo solo en consola del navegador (para depurar),
    // nunca visible en la interfaz.
    console.error(err);
  }

  function textoEstado(asiste) {
    return asiste === true ? 'Confirmado' : asiste === false ? 'No asiste' : 'Sin responder';
  }

  const FORMAS = {
    redonda: 'Redonda',
    cuadrada: 'Cuadrada',
    rectangular: 'Rectangular',
    imperial: 'Imperial',
  };

  function textoForma(forma) {
    return FORMAS[forma] || 'Redonda';
  }

  /* =========================================================
     SESIÓN — reutiliza el token guardado por admin.js.
     Si no hay sesión, regresa al panel principal a hacer login.
     ========================================================= */
  function recuperarSesion() {
    const token = sessionStorage.getItem('admin_access_token');
    if (token) {
      accessToken = token;
      return true;
    }
    return false;
  }

  function cerrarSesion() {
    sessionStorage.removeItem('admin_access_token');
    sessionStorage.removeItem('admin_refresh_token');
    window.location.href = '../index.html';
  }

  logoutBtn.addEventListener('click', cerrarSesion);

  /* =========================================================
     CARGA DE DATOS
     ========================================================= */
  async function cargarMesas() {
    mesasGrid.innerHTML = '<p class="mesas-loading">Cargando mesas…</p>';

    const [mesas, miembros] = await Promise.all([
      supabaseFetch(
        `${TABLE_MESAS}?select=id,nombre,capacidad,forma,pos_x,pos_y,asientos(id,numero,miembro_id,miembros(id,nombre,asiste,codigo,invitados(nombre_mostrar)))&order=nombre.asc`
      ),
      supabaseFetch(
        `${TABLE_MIEMBROS}?select=id,nombre,asiste,codigo,invitados(nombre_mostrar)&order=nombre.asc`
      ),
    ]);

    mesasCache = (mesas || []).map((m) => ({
      ...m,
      asientos: (m.asientos || []).slice().sort((a, b) => a.numero - b.numero),
    }));

    todosMiembros = (miembros || []).map((m) => ({
      id: m.id,
      nombre: m.nombre,
      asiste: m.asiste,
      familia: m.invitados ? m.invitados.nombre_mostrar : '',
    }));

    pintarMesas();
    pintarSinSentar();
  }

  /* =========================================================
     PANEL: SIN SENTAR
     ========================================================= */
  function idsOcupados() {
    const ids = new Set();
    mesasCache.forEach((m) => m.asientos.forEach((a) => { if (a.miembro_id) ids.add(a.miembro_id); }));
    return ids;
  }

  function pintarSinSentar() {
    const ocupados = idsOcupados();
    const sinSentar = todosMiembros.filter((m) => !ocupados.has(m.id));

    sinsentarCount.textContent = sinSentar.length;
    sinsentarHint.classList.toggle('is-visible', !!miembroSeleccionadoId);

    if (sinSentar.length === 0) {
      sinsentarList.innerHTML = '<p class="sinsentar-empty">Todos los invitados ya tienen mesa 🎉</p>';
      return;
    }

    // Total original por familia (para mostrar "2/3 sin sentar")
    const totalesPorFamilia = {};
    todosMiembros.forEach((m) => {
      const key = m.familia || 'Sin familia';
      totalesPorFamilia[key] = (totalesPorFamilia[key] || 0) + 1;
    });

    const grupos = {};
    sinSentar.forEach((m) => {
      const key = m.familia || 'Sin familia';
      (grupos[key] = grupos[key] || []).push(m);
    });

    const familias = Object.keys(grupos).sort((a, b) => a.localeCompare(b, 'es'));

    sinsentarList.innerHTML = familias.map((familia) => {
      const miembrosFamilia = grupos[familia].slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
      const total = totalesPorFamilia[familia];
      return `
        <div class="sinsentar-familia">
          <p class="sinsentar-familia__header">
            <span>${escapeHtml(familia)}</span>
            <span class="sinsentar-familia__badge">${miembrosFamilia.length}/${total}</span>
          </p>
          ${miembrosFamilia.map((m) => `
            <div class="sinsentar-item${m.id === miembroSeleccionadoId ? ' is-selected' : ''}" draggable="true" data-miembro-id="${m.id}">
              <span class="miembro-chip__dot miembro-chip__dot--${estadoDeMiembro(m)}"></span>
              <div class="sinsentar-item__info">
                <span class="sinsentar-item__nombre">${escapeHtml(m.nombre)}</span>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }).join('');
  }

  // Clic para seleccionar / deseleccionar
  sinsentarList.addEventListener('click', (e) => {
    const item = e.target.closest('.sinsentar-item');
    if (!item) return;
    const id = item.dataset.miembroId;
    miembroSeleccionadoId = miembroSeleccionadoId === id ? null : id;
    pintarSinSentar();
    pintarMesas();
  });

  // Drag como mejora extra (desktop)
  sinsentarList.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.sinsentar-item');
    if (!item) return;
    e.dataTransfer.setData('text/plain', JSON.stringify({ miembroId: item.dataset.miembroId }));
    e.dataTransfer.effectAllowed = 'move';
  });

  // Soltar aquí a alguien que venía de una silla = lo quita de la mesa
  sinsentarList.addEventListener('dragover', (e) => {
    e.preventDefault();
    sinsentarList.classList.add('is-dragover');
  });

  sinsentarList.addEventListener('dragleave', () => {
    sinsentarList.classList.remove('is-dragover');
  });

  sinsentarList.addEventListener('drop', (e) => {
    e.preventDefault();
    sinsentarList.classList.remove('is-dragover');
    let data;
    try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
    if (data && data.origenAsientoId) quitarDeAsiento(data.origenAsientoId);
  });

  /* =========================================================
     MESAS — pintar tarjetas + asientos
     ========================================================= */
  function posicionPorDefecto(indice) {
    const cols = 5;
    const anchoCelda = 290;
    const altoCelda = 270;
    const col = indice % cols;
    const row = Math.floor(indice / cols);
    return { x: 24 + col * anchoCelda, y: 24 + row * altoCelda };
  }

  /* =========================================================
     TAMAÑO DEL LIENZO — "expansible" en vez de fijo.
     En lugar de un canvas de 1600x1000 a fuerza, calculamos el
     tamaño real según dónde están las mesas más lejanas, con un
     margen de aire extra. Así:
       - Con pocas mesas, el lienzo no es enorme y vacío.
       - Si el cliente arrastra una mesa hacia el borde, el lienzo
         crece solo (ver ajustarTamanoLienzo en el drag de mesas).
       - CANVAS_MAX_* es solo un tope de seguridad, no un límite
         que el cliente vaya a notar en el uso normal.
     ========================================================= */
  const CANVAS_MIN_W = 1600;
  const CANVAS_MIN_H = 1000;
  const CANVAS_MARGEN = 400;
  const CANVAS_MAX_W = 6000;
  const CANVAS_MAX_H = 4000;

  function ajustarTamanoLienzo() {
    let maxX = 0;
    let maxY = 0;
    mesasGrid.querySelectorAll('.mesa-card').forEach((card) => {
      const left = parseFloat(card.style.left) || 0;
      const top = parseFloat(card.style.top) || 0;
      maxX = Math.max(maxX, left + card.offsetWidth);
      maxY = Math.max(maxY, top + card.offsetHeight);
    });

    const ancho = Math.min(CANVAS_MAX_W, Math.max(CANVAS_MIN_W, Math.ceil(maxX + CANVAS_MARGEN)));
    const alto = Math.min(CANVAS_MAX_H, Math.max(CANVAS_MIN_H, Math.ceil(maxY + CANVAS_MARGEN)));
    mesasGrid.style.width = `${ancho}px`;
    mesasGrid.style.height = `${alto}px`;
  }

  function pintarMesas() {
    if (mesasCache.length === 0) {
      mesasGrid.innerHTML = '<p class="mesas-empty">Aún no hay mesas. Agrega la primera con el botón de arriba.</p>';
      mesasGrid.style.width = `${CANVAS_MIN_W}px`;
      mesasGrid.style.height = `${CANVAS_MIN_H}px`;
      return;
    }

    mesasGrid.innerHTML = mesasCache.map((mesa, indice) => {
      const ocupados = mesa.asientos.filter((a) => a.miembro_id).length;
      const tienePosicion = mesa.pos_x !== null && mesa.pos_x !== undefined && mesa.pos_y !== null && mesa.pos_y !== undefined;
      const pos = tienePosicion ? { x: mesa.pos_x, y: mesa.pos_y } : posicionPorDefecto(indice);
      return `
      <div class="mesa-card mesa-card--${mesa.forma || 'redonda'}" data-mesa-id="${mesa.id}" data-forma="${mesa.forma || 'redonda'}" style="left:${pos.x}px; top:${pos.y}px;">
        <div class="mesa-card__header">
          <div>
            <p class="mesa-card__nombre">${escapeHtml(mesa.nombre)}</p>
            <p class="mesa-card__cap">${textoForma(mesa.forma)} · ${ocupados}/${mesa.capacidad} lugares</p>
          </div>
          <div class="row-actions" style="opacity:1;">
            <span class="mesa-card__drag-handle" title="Arrastra para mover la mesa">⠿</span>
            <button class="icon-btn" title="Editar mesa" data-action="editar-mesa" data-mesa-id="${mesa.id}">✎</button>
            <button class="icon-btn icon-btn--danger" title="Eliminar mesa" data-action="borrar-mesa" data-mesa-id="${mesa.id}">✕</button>
          </div>
        </div>
        <div class="mesa-card__seats">
          ${mesa.asientos.map(asientoHtml).join('')}
        </div>
      </div>
      `;
    }).join('');

    // Las posiciones ya están en el DOM, ahora sí podemos medir las
    // tarjetas reales (offsetWidth/offsetHeight) y ajustar el lienzo.
    ajustarTamanoLienzo();
  }

  function asientoHtml(a) {
    if (!a.miembro_id || !a.miembros) {
      const asignable = miembroSeleccionadoId ? ' es-asignable' : '';
      return `
        <div class="asiento asiento--vacio${asignable}" data-asiento-id="${a.id}" title="Lugar ${a.numero} — vacío">
          <span class="asiento__numero">${a.numero}</span>
        </div>
      `;
    }
    const m = a.miembros;
    const estado = estadoDeMiembro(m);
    const familia = m.invitados ? m.invitados.nombre_mostrar : '';
    const tituloFamilia = familia ? ` (${familia})` : '';
    return `
      <div class="asiento asiento--ocupado asiento--${estado}" draggable="true" data-asiento-id="${a.id}" data-miembro-id="${m.id}" title="${escapeHtml(m.nombre)}${escapeHtml(tituloFamilia)} — ${textoEstado(m.asiste)} (arrastra para cambiarla de mesa)">

        <span class="asiento__numero">${a.numero}</span>
        <span class="asiento__nombre">${escapeHtml(m.nombre)}</span>
        ${familia ? `<span class="asiento__familia">${escapeHtml(familia)}</span>` : ''}
        <button class="asiento__quitar" data-action="quitar-asiento" data-asiento-id="${a.id}" title="Quitar de la mesa">✕</button>
      </div>
    `;
  }

  // Clic: asignar (si hay alguien seleccionado), quitar, editar o borrar mesa
  mesasGrid.addEventListener('click', (e) => {
    const quitarBtn = e.target.closest('[data-action="quitar-asiento"]');
    if (quitarBtn) {
      e.stopPropagation();
      quitarDeAsiento(quitarBtn.dataset.asientoId);
      return;
    }

    const editarBtn = e.target.closest('[data-action="editar-mesa"]');
    if (editarBtn) {
      abrirModalEditarMesa(mesasCache.find((m) => m.id === editarBtn.dataset.mesaId));
      return;
    }

    const borrarBtn = e.target.closest('[data-action="borrar-mesa"]');
    if (borrarBtn) {
      abrirModalBorrarMesa(mesasCache.find((m) => m.id === borrarBtn.dataset.mesaId));
      return;
    }

    const asientoVacio = e.target.closest('.asiento--vacio');
    if (asientoVacio) {
      if (miembroSeleccionadoId) {
        asignarAsiento(asientoVacio.dataset.asientoId, miembroSeleccionadoId);
      } else {
        abrirModalAsignar(asientoVacio.dataset.asientoId);
      }
    }
  });

  // Arrastrar a alguien YA sentado, para moverlo a otra silla
  mesasGrid.addEventListener('dragstart', (e) => {
    const asiento = e.target.closest('.asiento--ocupado');
    if (!asiento) return;
    e.dataTransfer.setData('text/plain', JSON.stringify({
      miembroId: asiento.dataset.miembroId,
      origenAsientoId: asiento.dataset.asientoId,
    }));
    e.dataTransfer.effectAllowed = 'move';
  });

  // Drag & drop como mejora extra (desktop) — mismo resultado que clic-clic
  // (dragenter Y dragover deben prevenirse para que el navegador permita el drop)
  mesasGrid.addEventListener('dragenter', (e) => {
    if (!e.target.closest('.asiento--vacio')) return;
    e.preventDefault();
  });

  mesasGrid.addEventListener('dragover', (e) => {
    const asiento = e.target.closest('.asiento--vacio');
    if (!asiento) return;
    e.preventDefault();
    asiento.classList.add('is-dragover');
  });

  mesasGrid.addEventListener('dragleave', (e) => {
    const asiento = e.target.closest('.asiento--vacio');
    if (!asiento) return;
    asiento.classList.remove('is-dragover');
  });

  mesasGrid.addEventListener('drop', (e) => {
    const asiento = e.target.closest('.asiento--vacio');
    if (!asiento) return;
    e.preventDefault();
    asiento.classList.remove('is-dragover');
    let data;
    try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
    if (data && data.miembroId) asignarAsiento(asiento.dataset.asientoId, data.miembroId, data.origenAsientoId);
  });

  /* =========================================================
     ZOOM DEL PLANO — acercar/alejar para moverse más fácil
     ========================================================= */
  let zoomNivel = 1;
  const ZOOM_MIN = 0.4;
  const ZOOM_MAX = 1.8;
  const ZOOM_PASO = 0.1;

  function aplicarZoom() {
    mesasGrid.style.transform = `scale(${zoomNivel})`;
    zoomLevelLabel.textContent = `${Math.round(zoomNivel * 100)}%`;
  }

  zoomInBtn.addEventListener('click', () => {
    zoomNivel = Math.min(ZOOM_MAX, +(zoomNivel + ZOOM_PASO).toFixed(2));
    aplicarZoom();
  });

  zoomOutBtn.addEventListener('click', () => {
    zoomNivel = Math.max(ZOOM_MIN, +(zoomNivel - ZOOM_PASO).toFixed(2));
    aplicarZoom();
  });

  zoomResetBtn.addEventListener('click', () => {
    zoomNivel = 1;
    aplicarZoom();
  });

  aplicarZoom();

  /* Zoom con la rueda del mouse o el pad, centrado en el cursor
     (igual que en Figma / Google Maps). Al hacer scroll sobre el
     lienzo ya no se hace scroll normal, se hace zoom; para moverse
     se usa el pan con clic derecho de abajo, o las barras de scroll. */
  mesasCanvasWrap.addEventListener('wheel', (e) => {
    e.preventDefault();

    const delta = e.deltaY < 0 ? ZOOM_PASO : -ZOOM_PASO;
    const nuevoZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +(zoomNivel + delta).toFixed(2)));
    if (nuevoZoom === zoomNivel) return;

    const wrapRect = mesasCanvasWrap.getBoundingClientRect();
    // Punto bajo el cursor, en coordenadas "reales" del lienzo (sin escalar)
    const puntoX = (mesasCanvasWrap.scrollLeft + (e.clientX - wrapRect.left)) / zoomNivel;
    const puntoY = (mesasCanvasWrap.scrollTop + (e.clientY - wrapRect.top)) / zoomNivel;

    zoomNivel = nuevoZoom;
    aplicarZoom();

    // Reajusta el scroll para que ese mismo punto siga bajo el cursor
    mesasCanvasWrap.scrollLeft = puntoX * zoomNivel - (e.clientX - wrapRect.left);
    mesasCanvasWrap.scrollTop = puntoY * zoomNivel - (e.clientY - wrapRect.top);
  }, { passive: false });

  /* =========================================================
     PAN CON CLIC DERECHO — arrastrar el lienzo para moverse,
     sin depender solo de las barras de scroll.
     ========================================================= */
  mesasCanvasWrap.addEventListener('contextmenu', (e) => e.preventDefault());

  let arrastrePan = null; // { startX, startY, scrollLeft, scrollTop }

  mesasCanvasWrap.addEventListener('pointerdown', (e) => {
    if (e.button !== 2) return; // solo botón derecho
    arrastrePan = {
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: mesasCanvasWrap.scrollLeft,
      scrollTop: mesasCanvasWrap.scrollTop,
    };
    mesasCanvasWrap.classList.add('is-panning');
    mesasCanvasWrap.setPointerCapture(e.pointerId);
  });

  mesasCanvasWrap.addEventListener('pointermove', (e) => {
    if (!arrastrePan) return;
    mesasCanvasWrap.scrollLeft = arrastrePan.scrollLeft - (e.clientX - arrastrePan.startX);
    mesasCanvasWrap.scrollTop = arrastrePan.scrollTop - (e.clientY - arrastrePan.startY);
  });

  function terminarPan() {
    if (!arrastrePan) return;
    arrastrePan = null;
    mesasCanvasWrap.classList.remove('is-panning');
  }
  mesasCanvasWrap.addEventListener('pointerup', terminarPan);
  mesasCanvasWrap.addEventListener('pointercancel', terminarPan);

  /* =========================================================
     ARRASTRAR MESAS — mover la mesa completa (con sus sillas)
     libremente por el salón. Se usa Pointer Events (no HTML5
     drag&drop) porque así funciona igual con mouse y con dedo.
     Solo la manija ⠿ inicia el arrastre, para no chocar con
     los clics de asientos o los botones de editar/borrar.
     ========================================================= */
  let arrastreMesa = null; // { mesaId, el, offsetX, offsetY, canvasRect }

  mesasGrid.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return; // solo clic izquierdo (el derecho es para el pan del lienzo)
    const handle = e.target.closest('.mesa-card__drag-handle');
    if (!handle) return;
    const card = handle.closest('.mesa-card');
    if (!card) return;

    const canvasRect = mesasGrid.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    arrastreMesa = {
      mesaId: card.dataset.mesaId,
      el: card,
      offsetX: e.clientX - cardRect.left,
      offsetY: e.clientY - cardRect.top,
      canvasRect,
    };
    card.classList.add('is-dragging');
    handle.setPointerCapture(e.pointerId);
  });

  mesasGrid.addEventListener('pointermove', (e) => {
    if (!arrastreMesa) return;
    const { el, offsetX, offsetY, canvasRect } = arrastreMesa;
    // canvasRect/offsets están en píxeles de pantalla (ya escalados por el
    // zoom); hay que dividir entre el nivel de zoom para volver al
    // sistema de coordenadas "real" del lienzo, que es el que se guarda.
    let x = (e.clientX - canvasRect.left - offsetX) / zoomNivel;
    let y = (e.clientY - canvasRect.top - offsetY) / zoomNivel;
    // Solo se limita el mínimo (no se puede salir por arriba/izquierda)
    // y un tope de seguridad muy amplio (CANVAS_MAX_*). El lienzo real
    // crece solo mientras arrastras, así nunca "chocas" con un borde
    // que no tenga sentido para el cliente.
    x = Math.max(0, Math.min(x, CANVAS_MAX_W - el.offsetWidth));
    y = Math.max(0, Math.min(y, CANVAS_MAX_H - el.offsetHeight));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;

    // Si la mesa se acerca al borde actual del lienzo, lo agrandamos
    // en vivo para que siempre haya espacio de sobra hacia donde te
    // muevas (sensación de lienzo "expansible", sin límites raros).
    const anchoNecesario = Math.min(CANVAS_MAX_W, Math.ceil(x + el.offsetWidth + CANVAS_MARGEN));
    const altoNecesario = Math.min(CANVAS_MAX_H, Math.ceil(y + el.offsetHeight + CANVAS_MARGEN));
    if (anchoNecesario > mesasGrid.offsetWidth) mesasGrid.style.width = `${anchoNecesario}px`;
    if (altoNecesario > mesasGrid.offsetHeight) mesasGrid.style.height = `${altoNecesario}px`;
  });

  async function soltarMesa() {
    if (!arrastreMesa) return;
    const { mesaId, el } = arrastreMesa;
    el.classList.remove('is-dragging');
    const x = parseInt(el.style.left, 10) || 0;
    const y = parseInt(el.style.top, 10) || 0;
    arrastreMesa = null;

    const mesa = mesasCache.find((m) => m.id === mesaId);
    const posAnterior = mesa ? { x: mesa.pos_x, y: mesa.pos_y } : null;

    try {
      await supabaseFetch(`${TABLE_MESAS}?id=eq.${mesaId}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ pos_x: x, pos_y: y }),
      });
      if (mesa) { mesa.pos_x = x; mesa.pos_y = y; }
    } catch (err) {
      registrarError(err);
      mostrarAviso('No se pudo guardar la nueva posición de la mesa. Intenta de nuevo.');
      // Regresa la mesa visualmente a su última posición guardada
      if (posAnterior && posAnterior.x != null && posAnterior.y != null) {
        el.style.left = `${posAnterior.x}px`;
        el.style.top = `${posAnterior.y}px`;
      }
    }
  }

  mesasGrid.addEventListener('pointerup', soltarMesa);
  mesasGrid.addEventListener('pointercancel', soltarMesa);

  /* =========================================================
     ASIGNAR / QUITAR DE UN ASIENTO
     ========================================================= */
  async function asignarAsiento(asientoId, miembroId, origenAsientoId) {
    if (origenAsientoId === asientoId) return; // soltó en la misma silla, no hacer nada
    try {
      await supabaseFetch(`${TABLE_ASIENTOS}?id=eq.${asientoId}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ miembro_id: miembroId }),
      });
      if (origenAsientoId) {
        await supabaseFetch(`${TABLE_ASIENTOS}?id=eq.${origenAsientoId}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ miembro_id: null }),
        });
      }
      miembroSeleccionadoId = null;
      await cargarMesas();
    } catch (err) {
      registrarError(err);
      mostrarAviso('No se pudo asignar ese lugar. Intenta de nuevo.');
    }
  }

  async function quitarDeAsiento(asientoId) {
    try {
      await supabaseFetch(`${TABLE_ASIENTOS}?id=eq.${asientoId}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ miembro_id: null }),
      });
      await cargarMesas();
    } catch (err) {
      registrarError(err);
      mostrarAviso('No se pudo quitar a la persona de la mesa. Intenta de nuevo.');
    }
  }

  /* =========================================================
     MODAL: ASIGNAR ASIENTO (buscador rápido)
     Se abre al tocar una silla vacía sin selección previa —
     así siempre hay una forma directa de sentar a alguien.
     ========================================================= */
  function abrirModalAsignar(asientoId) {
    asientoParaAsignarId = asientoId;
    let nombreMesa = '';
    for (const mesa of mesasCache) {
      const a = mesa.asientos.find((x) => x.id === asientoId);
      if (a) { nombreMesa = `${mesa.nombre} — lugar ${a.numero}`; break; }
    }
    asignarModalDesc.textContent = nombreMesa ? `Elige quién se sienta en: ${nombreMesa}` : 'Elige quién se sienta aquí.';
    asignarBuscar.value = '';
    pintarListaAsignar('');
    asignarModal.classList.add('is-visible');
    asignarBuscar.focus();
  }

  function pintarListaAsignar(filtro) {
    const ocupados = idsOcupados();
    const texto = filtro.trim().toLowerCase();
    const disponibles = todosMiembros
      .filter((m) => !ocupados.has(m.id))
      .filter((m) => !texto || m.nombre.toLowerCase().includes(texto))
      .sort((a, b) => (a.familia || '').localeCompare(b.familia || '', 'es') || a.nombre.localeCompare(b.nombre, 'es'));

    if (disponibles.length === 0) {
      asignarLista.innerHTML = '<p class="sinsentar-empty">Nadie con ese nombre está sin mesa.</p>';
      return;
    }

    asignarLista.innerHTML = disponibles.map((m) => `
      <div class="sinsentar-item" data-miembro-id="${m.id}">
        <span class="miembro-chip__dot miembro-chip__dot--${estadoDeMiembro(m)}"></span>
        <div class="sinsentar-item__info">
          <span class="sinsentar-item__nombre">${escapeHtml(m.nombre)}</span>
          ${m.familia ? `<span class="sinsentar-item__familia">${escapeHtml(m.familia)}</span>` : ''}
        </div>
      </div>
    `).join('');
  }

  asignarBuscar.addEventListener('input', () => pintarListaAsignar(asignarBuscar.value));

  asignarLista.addEventListener('click', (e) => {
    const item = e.target.closest('.sinsentar-item');
    if (!item || !asientoParaAsignarId) return;
    asignarAsiento(asientoParaAsignarId, item.dataset.miembroId);
    asignarModal.classList.remove('is-visible');
    asientoParaAsignarId = null;
  });

  asignarCancelBtn.addEventListener('click', () => {
    asignarModal.classList.remove('is-visible');
    asientoParaAsignarId = null;
  });

  /* =========================================================
     MODAL: AGREGAR / EDITAR MESA
     ========================================================= */
  function abrirModalAgregarMesa() {
    mesaModalTitle.textContent = 'Agregar mesa';
    mesaForm.reset();
    mesaForma.value = 'redonda';
    mesaOriginalId.value = '';
    mesaModalError.classList.remove('is-visible');
    mesaModal.classList.add('is-visible');
    mesaNombre.focus();
  }

  function abrirModalEditarMesa(mesa) {
    mesaModalTitle.textContent = 'Editar mesa';
    mesaNombre.value = mesa.nombre;
    mesaForma.value = mesa.forma || 'redonda';
    mesaCapacidad.value = mesa.capacidad;
    mesaOriginalId.value = mesa.id;
    mesaModalError.classList.remove('is-visible');
    mesaModal.classList.add('is-visible');
    mesaNombre.focus();
  }

  openAddMesaBtn.addEventListener('click', abrirModalAgregarMesa);
  mesaCancelBtn.addEventListener('click', () => mesaModal.classList.remove('is-visible'));

  mesaForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    mesaModalError.classList.remove('is-visible');

    const nombre = mesaNombre.value.trim();
    const forma = mesaForma.value;
    const capacidad = parseInt(mesaCapacidad.value, 10);
    const esEdicion = !!mesaOriginalId.value;

    if (!nombre) {
      mesaModalError.textContent = 'Ponle un nombre a la mesa (ej. "Mesa 1").';
      mesaModalError.classList.add('is-visible');
      return;
    }
    if (!capacidad || capacidad < 1) {
      mesaModalError.textContent = 'La capacidad debe ser de al menos 1 lugar.';
      mesaModalError.classList.add('is-visible');
      return;
    }

    mesaSubmitBtn.disabled = true;
    mesaSubmitBtn.textContent = 'Guardando…';

    try {
      if (esEdicion) {
        const mesaId = mesaOriginalId.value;
        const mesaActual = mesasCache.find((m) => m.id === mesaId);
        const capActual = mesaActual.asientos.length;

        await supabaseFetch(`${TABLE_MESAS}?id=eq.${mesaId}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ nombre, forma, capacidad }),
        });

        if (capacidad > capActual) {
          // Agregar los asientos nuevos que faltan
          const nuevos = [];
          for (let n = capActual + 1; n <= capacidad; n++) {
            nuevos.push({ mesa_id: mesaId, numero: n });
          }
          await supabaseFetch(TABLE_ASIENTOS, {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify(nuevos),
          });
        } else if (capacidad < capActual) {
          // Quitar asientos sobrantes — solo si están vacíos
          const sobrantes = mesaActual.asientos.filter((a) => a.numero > capacidad);
          const ocupadosSobrantes = sobrantes.filter((a) => a.miembro_id);
          if (ocupadosSobrantes.length > 0) {
            const errorAmigable = new Error(`No puedes reducir la capacidad: ${ocupadosSobrantes.length} de esos lugares ya tienen invitados. Quítalos primero.`);
            errorAmigable.amigable = true;
            throw errorAmigable;
          }
          const filtro = sobrantes.map((a) => encodeURIComponent(a.id)).join(',');
          if (filtro) {
            await supabaseFetch(`${TABLE_ASIENTOS}?id=in.(${filtro})`, {
              method: 'DELETE',
              headers: { Prefer: 'return=minimal' },
            });
          }
        }
      } else {
        const nuevaMesa = await supabaseFetch(TABLE_MESAS, {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify([{ nombre, forma, capacidad }]),
        });
        const mesaId = nuevaMesa[0].id;
        const asientosNuevos = Array.from({ length: capacidad }, (_, i) => ({ mesa_id: mesaId, numero: i + 1 }));
        await supabaseFetch(TABLE_ASIENTOS, {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(asientosNuevos),
        });
      }

      mesaModal.classList.remove('is-visible');
      await cargarMesas();
    } catch (err) {
      registrarError(err);
      mesaModalError.textContent = err.amigable ? err.message : 'No se pudo guardar la mesa. Intenta de nuevo en un momento.';
      mesaModalError.classList.add('is-visible');
    } finally {
      mesaSubmitBtn.disabled = false;
      mesaSubmitBtn.textContent = 'Guardar';
    }
  });

  /* =========================================================
     MODAL: BORRAR MESA
     (borra en cascada sus asientos por la FK en Supabase)
     ========================================================= */
  function abrirModalBorrarMesa(mesa) {
    mesaPendienteBorrar = mesa.id;
    const ocupados = mesa.asientos.filter((a) => a.miembro_id).length;
    deleteMesaDesc.textContent =
      `Vas a eliminar "${mesa.nombre}" y sus ${mesa.capacidad} asiento(s).` +
      (ocupados > 0 ? ` ${ocupados} de ellos tienen invitados asignados — quedarán sin mesa.` : '');
    deleteMesaModal.classList.add('is-visible');
  }

  deleteMesaCancelBtn.addEventListener('click', () => {
    deleteMesaModal.classList.remove('is-visible');
    mesaPendienteBorrar = null;
  });

  deleteMesaConfirmBtn.addEventListener('click', async () => {
    if (!mesaPendienteBorrar) return;
    try {
      await supabaseFetch(`${TABLE_MESAS}?id=eq.${mesaPendienteBorrar}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
      deleteMesaModal.classList.remove('is-visible');
      mesaPendienteBorrar = null;
      await cargarMesas();
    } catch (err) {
      registrarError(err);
      mostrarAviso('No se pudo eliminar la mesa. Intenta de nuevo en un momento.');
    }
  });

  [mesaModal, deleteMesaModal, asignarModal].forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('is-visible');
    });
  });

  /* =========================================================
     EXPORTAR — Excel (SheetJS, del lado del cliente)
     ========================================================= */
  exportExcelBtn.addEventListener('click', () => {
    if (typeof XLSX === 'undefined') {
      mostrarAviso('No se pudo preparar el Excel. Revisa tu conexión e intenta de nuevo.');
      return;
    }

    const filasMesas = [];
    mesasCache.forEach((mesa) => {
      mesa.asientos.forEach((a) => {
        filasMesas.push({
          'Mesa': mesa.nombre,
          'Asiento': a.numero,
          'Invitado': a.miembros ? a.miembros.nombre : '— vacío —',
        });
      });
    });

    const ocupados = idsOcupados();
    const filasSinSentar = todosMiembros
      .filter((m) => !ocupados.has(m.id))
      .map((m) => ({ 'Invitado': m.nombre, 'Familia': m.familia }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasMesas), 'Mesas');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasSinSentar), 'Sin sentar');
    XLSX.writeFile(wb, 'mesas-ezequiel-karla.xlsx');
  });

  /* =========================================================
     EXPORTAR — vista imprimible (CSS @media print + Ctrl+P)
     ========================================================= */
  printPlanoBtn.addEventListener('click', () => {
    if (mesasCache.length === 0) {
      mostrarAviso('Todavía no hay mesas para armar el plano.', 'info');
      return;
    }

    const ANCHO_LIENZO = 1600;
    const ALTO_LIENZO = 1000;
    const ANCHO_PLANO = 680; // ancho del mini-mapa impreso, en px
    const escala = ANCHO_PLANO / ANCHO_LIENZO;
    const altoPlano = Math.round(ALTO_LIENZO * escala);

    const colorPorForma = {
      redonda: '#C9A96E',
      cuadrada: '#5E1A2E',
      rectangular: '#7A7267',
      imperial: '#4A2F22',
    };

    const miniMesasHtml = mesasCache.map((mesa, indice) => {
      const tienePosicion = mesa.pos_x != null && mesa.pos_y != null;
      const pos = tienePosicion ? { x: mesa.pos_x, y: mesa.pos_y } : posicionPorDefecto(indice);
      const ocupados = mesa.asientos.filter((a) => a.miembro_id).length;
      const esRedonda = (mesa.forma || 'redonda') === 'redonda';
      const ancho = esRedonda ? 46 : 60;
      const alto = esRedonda ? 46 : 40;
      const color = colorPorForma[mesa.forma] || colorPorForma.redonda;
      return `
        <div class="print-mesa-mini${esRedonda ? ' es-redonda' : ''}" style="left:${Math.round(pos.x * escala)}px; top:${Math.round(pos.y * escala)}px; width:${ancho}px; height:${alto}px; border-color:${color};">
          <span class="print-mesa-mini__nombre">${escapeHtml(mesa.nombre)}</span>
          <span class="print-mesa-mini__cap">${ocupados}/${mesa.capacidad}</span>
        </div>
      `;
    }).join('');

    printPlanoContainer.innerHTML = `
      <p class="print-plano__title">Plano de mesas — Ezequiel &amp; Karla</p>
      <p class="print-plano__subtitulo">Vista general — así están acomodadas las mesas en el salón</p>
      <div class="print-plano-general" style="width:${ANCHO_PLANO}px; height:${altoPlano}px;">
        ${miniMesasHtml}
      </div>
      ${mesasCache.map((mesa) => `
        <div class="print-mesa">
          <h3>${escapeHtml(mesa.nombre)} <span class="print-mesa__forma">— ${textoForma(mesa.forma)}</span> (${mesa.asientos.filter((a) => a.miembro_id).length}/${mesa.capacidad})</h3>
          <ul>
            ${mesa.asientos.map((a) => (
              a.miembros
                ? `<li>${a.numero}. ${escapeHtml(a.miembros.nombre)}</li>`
                : `<li class="vacio">${a.numero}. — vacío —</li>`
            )).join('')}
          </ul>
        </div>
      `).join('')}
    `;

    window.print();
  });

  /* =========================================================
     EXPORTAR — vista imprimible de asignación
     (índice alfabético + detalle por mesa, para las hosters
     el día del evento; sin el mini-mapa del plano)
     ========================================================= */
  printListaBtn.addEventListener('click', () => {
    if (mesasCache.length === 0) {
      mostrarAviso('Todavía no hay mesas para armar la lista.', 'info');
      return;
    }

    // Índice alfabético: todos los invitados, sentados y sin sentar
    const indice = [];
    mesasCache.forEach((mesa) => {
      mesa.asientos.forEach((a) => {
        if (a.miembros) {
          indice.push({
            nombre: a.miembros.nombre,
            ubicacion: mesa.nombre,
            sinMesa: false,
          });
        }
      });
    });
    const ocupados = idsOcupados();
    todosMiembros
      .filter((m) => !ocupados.has(m.id))
      .forEach((m) => indice.push({ nombre: m.nombre, ubicacion: 'Sin mesa asignada', sinMesa: true }));

    indice.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

    const indiceHtml = indice.map((item) => `
      <li>
        <span class="print-indice__nombre">${escapeHtml(item.nombre)}</span>
        <span class="print-indice__ubicacion${item.sinMesa ? ' sin-mesa' : ''}">${escapeHtml(item.ubicacion)}</span>
      </li>
    `).join('');

    printPlanoContainer.innerHTML = `
      <p class="print-plano__title">Asignación de mesas — Ezequiel &amp; Karla</p>
      <p class="print-plano__subtitulo">Lista rápida para el día del evento</p>

      <div class="print-lista-seccion">
        <h3 class="print-lista-seccion__titulo">Índice alfabético (${indice.length})</h3>
        <ul class="print-indice">${indiceHtml}</ul>
      </div>

      <div class="print-lista-divisor">
        <h3 class="print-lista-seccion__titulo">Detalle por mesa</h3>
      </div>
      ${mesasCache.map((mesa) => `
        <div class="print-mesa">
          <h3>${escapeHtml(mesa.nombre)} <span class="print-mesa__forma">— ${textoForma(mesa.forma)}</span> (${mesa.asientos.filter((a) => a.miembro_id).length}/${mesa.capacidad})</h3>
          <ul>
            ${mesa.asientos.map((a) => (
              a.miembros
                ? `<li>${a.numero}. ${escapeHtml(a.miembros.nombre)}</li>`
                : `<li class="vacio">${a.numero}. — vacío —</li>`
            )).join('')}
          </ul>
        </div>
      `).join('')}
    `;

    window.print();
  });

  /* =========================================================
     INICIALIZACIÓN
     ========================================================= */
  if (recuperarSesion()) {
    cargarMesas().catch((err) => {
      registrarError(err);
      mesasGrid.innerHTML = '<p class="mesas-empty">No se pudo cargar el plano de mesas. Verifica tu conexión y vuelve a intentarlo.</p>';
      sinsentarList.innerHTML = '<p class="sinsentar-empty">No se pudo cargar.</p>';
    });
  } else {
    window.location.href = '../index.html';
  }

})();