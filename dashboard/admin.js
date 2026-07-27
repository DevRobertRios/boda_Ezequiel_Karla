/* =========================================================
   ADMIN PANEL — Lógica completa
   Login con Supabase Auth, CRUD de familias + integrantes,
   generador de códigos automático, importador CSV, exportadores
   ========================================================= */
 
(function () {
 
  /* =========================================================
     ⚠️ CONFIGURACIÓN SUPABASE
     Las mismas credenciales que ya usa rsvp.js
     ========================================================= */
  const SUPABASE_URL = 'https://nvkuqndqlfdxkvuhlwcy.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_8SX6IrG_3JGb-vIv3_ooXw_fMnrCRsy';
 
  const TABLE_INVITADOS = 'invitados';
  const TABLE_MIEMBROS = 'miembros';
  const TABLE_MEDIA = 'media';
  const WEDDING_ID_MEDIA = 'EK2026';
  const RECUERDOS_LIMIT = 12;
 
  // URL base para construir los links de invitación.
  // IMPORTANTE: cambia esto cuando publiques (ej. https://ezequielykarla.com)
  // const SITIO_BASE_URL = window.location.origin + window.location.pathname.replace('admin.html', '');
  const SITIO_BASE_URL = window.location.origin + "/index.html";

 
  // Prefijo fijo para todos los códigos generados (de la boda)
  const PREFIJO_CODIGO = 'EK';
 
  /* ---------------------------------------------------------
     Estado en memoria de la sesión del admin
     --------------------------------------------------------- */
  let accessToken = null; // token de Supabase Auth, se guarda solo en memoria
 
  /* ----- DOM refs widget recuerdos ----- */
  const rwTotal   = document.getElementById('rw-total');
  const rwFotos   = document.getElementById('rw-fotos');
  const rwVideos  = document.getElementById('rw-videos');
  const rwOcultas = document.getElementById('rw-ocultas');
  const rwGrid    = document.getElementById('rw-grid');
  const rwEmpty   = document.getElementById('rw-empty');
  const rwLoading = document.getElementById('rw-loading');
 
  // Lista completa de familias con sus integrantes ya calculados
  let invitadosCache = [];
  // Códigos de familia actualmente expandidos en la tabla
  const expandidos = new Set();
 
  /* ---------------------------------------------------------
     Referencias al DOM
     --------------------------------------------------------- */
  const loginScreen = document.getElementById('login-screen');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const loginSubmit = document.getElementById('login-submit');
 
  const adminApp = document.getElementById('admin-app');
  const logoutBtn = document.getElementById('logout-btn');
 
  const tbody = document.getElementById('invitados-tbody');
  const searchInput = document.getElementById('search-input');
 
  const guestModal = document.getElementById('guest-modal');
  const guestModalTitle = document.getElementById('guest-modal-title');
  const guestForm = document.getElementById('guest-form');
  const guestNombre = document.getElementById('guest-nombre');
  const guestGrupo = document.getElementById('guest-grupo');
  const guestCodigo = document.getElementById('guest-codigo');
  const guestOriginalCodigo = document.getElementById('guest-original-codigo');
  const guestModalError = document.getElementById('guest-modal-error');
  const miembrosInputs = document.getElementById('miembros-inputs');
  const addMiembroBtn = document.getElementById('add-miembro-btn');
 
  const importModal = document.getElementById('import-modal');
  const csvFileInput = document.getElementById('csv-file');
  const csvPreview = document.getElementById('csv-preview');
  const importModalError = document.getElementById('import-modal-error');
  const importConfirmBtn = document.getElementById('import-confirm-btn');
 
  const copyModal = document.getElementById('copy-modal');
  const copyList = document.getElementById('copy-list');
 
  const deleteModal = document.getElementById('delete-modal');
  const deleteModalDesc = document.getElementById('delete-modal-desc');
 
  let csvGrupos = []; // familias agrupadas, listas para importar
  let codigoPendienteBorrar = null;
  let miembrosBorradosPendientes = []; // ids de miembros a eliminar al guardar edición
 
  /* =========================================================
     GENERADOR DE CÓDIGOS
     Formato: EK-NOMBRE-XXX (prefijo boda + alias + 3 random)
     Ejemplo: "Familia Godínez" → EK-GODINEZ-4F2
     ========================================================= */
  function quitarAcentos(texto) {
    return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
 
  function generarBaseDesdeNombre(nombre) {
    const palabrasIgnorar = ['familia', 'sr', 'sra', 'sr.', 'sra.', 'don', 'doña', 'de', 'la', 'los'];
    const palabras = quitarAcentos(nombre.toLowerCase())
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((p) => p && !palabrasIgnorar.includes(p));
 
    const base = palabras[0] || 'inv';
    return base.slice(0, 8).toUpperCase();
  }
 
  function generarSufijoRandom() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin O/0/I/1 para evitar confusión
    let sufijo = '';
    for (let i = 0; i < 3; i++) {
      sufijo += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return sufijo;
  }
 
  function generarCodigo(nombre, codigosExistentes) {
    const base = generarBaseDesdeNombre(nombre);
    let intento = 0;
    let codigo;
    do {
      codigo = `${PREFIJO_CODIGO}-${base}-${generarSufijoRandom()}`;
      intento++;
    } while (codigosExistentes.has(codigo) && intento < 20);
    return codigo;
  }
 
  function construirLink(codigo) {
    return `${SITIO_BASE_URL}?inv=${encodeURIComponent(codigo)}`;
  }
 
  /* =========================================================
     HELPERS DE FETCH A SUPABASE
     --------------------------------------------------------- */
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
 
  /* =========================================================
     AUTENTICACIÓN
     ========================================================= */
  async function login(email, password) {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email, password }),
    });
 
    const data = await response.json();
 
    if (!response.ok) {
      throw new Error(data.error_description || data.msg || 'Correo o contraseña incorrectos');
    }
 
    return data;
  }
 
  function guardarSesion(data) {
    accessToken = data.access_token;
    sessionStorage.setItem('admin_access_token', data.access_token);
    sessionStorage.setItem('admin_refresh_token', data.refresh_token);
  }
 
  function recuperarSesion() {
    const token = sessionStorage.getItem('admin_access_token');
    if (token) {
      accessToken = token;
      return true;
    }
    return false;
  }
 
  function cerrarSesion() {
    accessToken = null;
    sessionStorage.removeItem('admin_access_token');
    sessionStorage.removeItem('admin_refresh_token');
    adminApp.classList.remove('is-visible');
    loginScreen.style.display = 'flex';
  }
 
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.classList.remove('is-visible');
    loginSubmit.disabled = true;
    loginSubmit.textContent = 'Entrando…';
 
    try {
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      const data = await login(email, password);
      guardarSesion(data);
      await iniciarApp();
    } catch (err) {
      loginError.textContent = err.message;
      loginError.classList.add('is-visible');
    } finally {
      loginSubmit.disabled = false;
      loginSubmit.textContent = 'Entrar';
    }
  });
 
  logoutBtn.addEventListener('click', cerrarSesion);
 
  /* =========================================================
     CARGA DE DATOS — familias + sus integrantes embebidos
     ========================================================= */
  async function cargarInvitados() {
    tbody.innerHTML = '<tr class="loading-row"><td colspan="7">Cargando invitados…</td></tr>';
 
    const invitados = await supabaseFetch(
      `${TABLE_INVITADOS}?select=*,miembros(id,nombre,asiste,orden)&order=nombre_mostrar.asc`
    );
 
    invitadosCache = invitados.map((inv) => {
      const miembros = (inv.miembros || []).slice().sort((a, b) => a.orden - b.orden);
      const confirmados = miembros.filter((m) => m.asiste === true).length;
      const declinados = miembros.filter((m) => m.asiste === false).length;
      const sinResponder = miembros.filter((m) => m.asiste === null).length;
 
      let estado = 'pendiente';
      if (inv.respondido_at) {
        if (sinResponder > 0) estado = 'parcial';
        else if (confirmados > 0) estado = 'confirmado';
        else estado = 'no-asiste';
      }
 
      return {
        ...inv,
        miembros,
        totalIntegrantes: miembros.length,
        confirmados,
        declinados,
        sinResponder,
        estado,
      };
    });
 
    pintarTabla(invitadosCache);
    pintarMetricas(invitadosCache);
  }
 
  /* =========================================================
     MÉTRICAS — contadas por INTEGRANTES reales
     ========================================================= */
  function pintarMetricas(lista) {
    const totalLugares = lista.reduce((sum, i) => sum + i.totalIntegrantes, 0);
    const confirmadosLugares = lista.reduce((sum, i) => sum + i.confirmados, 0);
    const pendientesLugares = lista.reduce((sum, i) => sum + i.sinResponder, 0);
    const rechazadosLugares = lista.reduce((sum, i) => sum + i.declinados, 0);
 
    document.getElementById('m-total').textContent = totalLugares;
    document.getElementById('m-confirmados').textContent = confirmadosLugares;
    document.getElementById('m-pendientes').textContent = pendientesLugares;
    document.getElementById('m-rechazados').textContent = rechazadosLugares;
 
    const pct = totalLugares > 0 ? Math.round((confirmadosLugares / totalLugares) * 100) : 0;
    const pctEl = document.getElementById('m-confirmados-pct');
    const barEl = document.getElementById('m-progress');
    if (pctEl) pctEl.textContent = `${pct}% del total`;
    if (barEl) barEl.style.width = `${pct}%`;
  }
 
  /* =========================================================
     TABLA — pintar filas (familia + fila expandible de integrantes)
     ========================================================= */
  function badgeEstado(estado) {
    const map = {
      'confirmado': { clase: 'estado-badge--confirmado', texto: 'Confirmado' },
      'pendiente':  { clase: 'estado-badge--pendiente',  texto: 'Pendiente' },
      'parcial':    { clase: 'estado-badge--parcial',    texto: 'Parcial' },
      'no-asiste':  { clase: 'estado-badge--no-asiste',  texto: 'No asiste' },
    };
    const info = map[estado];
    return `<span class="estado-badge ${info.clase}">${info.texto}</span>`;
  }
 
  function iniciales(nombre) {
    return nombre.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }
 
  function chipMiembro(m) {
    const estado = m.asiste === true ? 'confirmado' : m.asiste === false ? 'no-asiste' : 'pendiente';
    return `
      <span class="miembro-chip">
        <span class="miembro-chip__dot miembro-chip__dot--${estado}"></span>
        ${escapeHtml(m.nombre)}
      </span>
    `;
  }
 
  function pintarTabla(lista) {
    const countEl = document.getElementById('table-count');
    if (countEl) countEl.textContent = lista.length === 1 ? '1 familia' : `${lista.length} familias`;
 
    if (lista.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7">Sin invitados. Agrega una familia o importa un CSV.</td></tr>';
      return;
    }
 
    tbody.innerHTML = lista.map((inv) => {
      const expandido = expandidos.has(inv.codigo);
      return `
      <tr class="familia-row${expandido ? ' is-expanded' : ''}" data-codigo="${escapeHtml(inv.codigo)}">
        <td class="expand-cell">
          <button class="expand-btn" type="button" data-action="expandir" data-codigo="${escapeHtml(inv.codigo)}" title="Ver integrantes">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </td>
        <td class="name-cell">
          <div class="guest-cell">
            <div class="guest-avatar">${escapeHtml(iniciales(inv.nombre_mostrar))}</div>
            <div>
              <div class="guest-name">${escapeHtml(inv.nombre_mostrar)}</div>
              ${inv.grupo ? `<div class="guest-grupo">${escapeHtml(inv.grupo)}</div>` : ''}
            </div>
          </div>
        </td>
        <td data-label="Código"><span class="codigo-cell">${escapeHtml(inv.codigo)}</span></td>
        <td class="t-center" data-label="Integrantes"><span class="pases-cell">${inv.totalIntegrantes}</span></td>
        <td class="t-center" data-label="Estado">${badgeEstado(inv.estado)}</td>
        <td class="t-center" data-label="Confirmados"><strong>${inv.confirmados}</strong>/${inv.totalIntegrantes}</td>
        <td class="t-right">
          <div class="row-actions">
            <button class="icon-btn" title="Copiar link" data-action="copiar-link" data-codigo="${escapeHtml(inv.codigo)}">🔗</button>
            <button class="icon-btn" title="Editar" data-action="editar" data-codigo="${escapeHtml(inv.codigo)}">✎</button>
            <button class="icon-btn icon-btn--danger" title="Eliminar" data-action="borrar" data-codigo="${escapeHtml(inv.codigo)}">✕</button>
          </div>
        </td>
      </tr>
      <tr class="miembros-row${expandido ? '' : ' is-hidden'}" data-codigo="${escapeHtml(inv.codigo)}">
        <td colspan="7">
          <div class="miembros-chips">
            ${inv.miembros.length > 0 ? inv.miembros.map(chipMiembro).join('') : '<span style="color:var(--taupe); font-size:0.78rem;">Sin integrantes agregados</span>'}
          </div>
        </td>
      </tr>
    `;
    }).join('');
  }
 
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  }
 
  /* ---------------------------------------------------------
     Búsqueda en vivo (por nombre de familia, integrante o código)
     --------------------------------------------------------- */
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) {
      pintarTabla(invitadosCache);
      return;
    }
    const filtrados = invitadosCache.filter((inv) =>
      inv.nombre_mostrar.toLowerCase().includes(q) ||
      inv.codigo.toLowerCase().includes(q) ||
      inv.miembros.some((m) => m.nombre.toLowerCase().includes(q))
    );
    pintarTabla(filtrados);
  });
 
  /* ---------------------------------------------------------
     Delegación de eventos para botones de cada fila
     --------------------------------------------------------- */
  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
 
    const codigo = btn.dataset.codigo;
    const accion = btn.dataset.action;
    const invitado = invitadosCache.find((i) => i.codigo === codigo);
 
    if (accion === 'copiar-link') {
      copiarAlPortapapeles(construirLink(codigo), btn);
    } else if (accion === 'editar') {
      abrirModalEditar(invitado);
    } else if (accion === 'borrar') {
      abrirModalBorrar(invitado);
    } else if (accion === 'expandir') {
      toggleExpandir(codigo);
    }
  });
 
  function toggleExpandir(codigo) {
    if (expandidos.has(codigo)) {
      expandidos.delete(codigo);
    } else {
      expandidos.add(codigo);
    }
    const filaRow = tbody.querySelector(`.familia-row[data-codigo="${CSS.escape(codigo)}"]`);
    const miembrosRow = tbody.querySelector(`.miembros-row[data-codigo="${CSS.escape(codigo)}"]`);
    if (filaRow) filaRow.classList.toggle('is-expanded', expandidos.has(codigo));
    if (miembrosRow) miembrosRow.classList.toggle('is-hidden', !expandidos.has(codigo));
  }
 
  function copiarAlPortapapeles(texto, btnRef) {
    navigator.clipboard.writeText(texto).then(() => {
      if (btnRef) {
        const original = btnRef.textContent;
        btnRef.textContent = '✓';
        setTimeout(() => { btnRef.textContent = original; }, 1200);
      }
    });
  }
 
  /* =========================================================
     MODAL: AGREGAR / EDITAR FAMILIA (con integrantes dinámicos)
     ========================================================= */
  const openAddModalBtn = document.getElementById('open-add-modal');
  const guestCancelBtn = document.getElementById('guest-cancel-btn');
  const guestCodigoGroup = document.getElementById('guest-codigo-group');
 
  function filaMiembroInput(nombre = '', miembroId = '') {
    const row = document.createElement('div');
    row.className = 'miembro-input-row';
    row.dataset.miembroId = miembroId;
    row.innerHTML = `
      <input type="text" class="miembro-nombre-input" placeholder="Nombre del integrante" value="${escapeHtml(nombre)}">
      <button type="button" class="miembro-remove-btn" title="Quitar">✕</button>
    `;
    row.querySelector('.miembro-remove-btn').addEventListener('click', () => {
      if (miembroId) miembrosBorradosPendientes.push(miembroId);
      row.remove();
    });
    return row;
  }
 
  addMiembroBtn.addEventListener('click', () => {
    const row = filaMiembroInput();
    miembrosInputs.appendChild(row);
    row.querySelector('input').focus();
  });
 
  function abrirModalAgregar() {
    guestModalTitle.textContent = 'Agregar familia';
    guestForm.reset();
    guestOriginalCodigo.value = '';
    guestCodigoGroup.style.display = 'none';
    document.querySelector('#guest-modal .modal-desc').textContent = 'El código se genera automáticamente al guardar. Agrega a cada persona que va a asistir.';
    guestModalError.classList.remove('is-visible');
    miembrosBorradosPendientes = [];
    miembrosInputs.innerHTML = '';
    miembrosInputs.appendChild(filaMiembroInput());
    guestModal.classList.add('is-visible');
    guestNombre.focus();
  }
 
  function abrirModalEditar(invitado) {
    guestModalTitle.textContent = 'Editar familia';
    document.querySelector('#guest-modal .modal-desc').textContent = 'Modifica los datos de la familia y sus integrantes. El código no cambia.';
    guestNombre.value = invitado.nombre_mostrar;
    guestGrupo.value = invitado.grupo || '';
    guestCodigo.value = invitado.codigo;
    guestOriginalCodigo.value = invitado.codigo;
    guestCodigoGroup.style.display = 'block';
    guestModalError.classList.remove('is-visible');
    miembrosBorradosPendientes = [];
    miembrosInputs.innerHTML = '';
    if (invitado.miembros.length === 0) {
      miembrosInputs.appendChild(filaMiembroInput());
    } else {
      invitado.miembros.forEach((m) => miembrosInputs.appendChild(filaMiembroInput(m.nombre, m.id)));
    }
    guestModal.classList.add('is-visible');
    guestNombre.focus();
  }
 
  openAddModalBtn.addEventListener('click', abrirModalAgregar);
  guestCancelBtn.addEventListener('click', () => guestModal.classList.remove('is-visible'));
 
  guestForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    guestModalError.classList.remove('is-visible');
 
    const nombre = guestNombre.value.trim();
    const grupo = guestGrupo.value.trim() || null;
    const esEdicion = !!guestOriginalCodigo.value;
 
    const filasMiembros = Array.from(miembrosInputs.querySelectorAll('.miembro-input-row'));
    const miembrosData = filasMiembros
      .map((row) => ({
        id: row.dataset.miembroId || null,
        nombre: row.querySelector('.miembro-nombre-input').value.trim(),
      }))
      .filter((m) => m.nombre);
 
    if (!nombre) {
      guestModalError.textContent = 'Ponle un alias a la familia (ej. "Familia Godínez").';
      guestModalError.classList.add('is-visible');
      return;
    }
    if (miembrosData.length === 0) {
      guestModalError.textContent = 'Agrega al menos un integrante.';
      guestModalError.classList.add('is-visible');
      return;
    }
 
    const submitBtn = document.getElementById('guest-submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Guardando…';
 
    try {
      if (esEdicion) {
        const codigo = guestOriginalCodigo.value;
 
        await supabaseFetch(`${TABLE_INVITADOS}?codigo=eq.${encodeURIComponent(codigo)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ nombre_mostrar: nombre, grupo }),
        });
 
        // Borra los integrantes que el usuario quitó
        if (miembrosBorradosPendientes.length > 0) {
          const filtro = miembrosBorradosPendientes.map(encodeURIComponent).join(',');
          await supabaseFetch(`${TABLE_MIEMBROS}?id=in.(${filtro})`, {
            method: 'DELETE',
            headers: { Prefer: 'return=minimal' },
          });
        }
 
        // Actualiza integrantes existentes (nombre / orden)
        const existentes = miembrosData.filter((m) => m.id);
        await Promise.all(existentes.map((m, idx) =>
          supabaseFetch(`${TABLE_MIEMBROS}?id=eq.${encodeURIComponent(m.id)}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ nombre: m.nombre, orden: idx }),
          })
        ));
 
        // Inserta integrantes nuevos
        const nuevos = miembrosData.filter((m) => !m.id);
        if (nuevos.length > 0) {
          await supabaseFetch(TABLE_MIEMBROS, {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify(nuevos.map((m, idx) => ({
              codigo,
              nombre: m.nombre,
              orden: existentes.length + idx,
            }))),
          });
        }
      } else {
        const codigosExistentes = new Set(invitadosCache.map((i) => i.codigo));
        const codigo = generarCodigo(nombre, codigosExistentes);
 
        await supabaseFetch(TABLE_INVITADOS, {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ codigo, nombre_mostrar: nombre, grupo }),
        });
 
        await supabaseFetch(TABLE_MIEMBROS, {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(miembrosData.map((m, idx) => ({
            codigo,
            nombre: m.nombre,
            orden: idx,
          }))),
        });
      }
 
      guestModal.classList.remove('is-visible');
      await cargarInvitados();
    } catch (err) {
      guestModalError.textContent = 'No se pudo guardar: ' + err.message;
      guestModalError.classList.add('is-visible');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Guardar';
    }
  });
 
  /* =========================================================
     MODAL: BORRAR FAMILIA
     (borra en cascada a sus integrantes por la FK en Supabase)
     ========================================================= */
  const deleteCancelBtn = document.getElementById('delete-cancel-btn');
  const deleteConfirmBtn = document.getElementById('delete-confirm-btn');
 
  function abrirModalBorrar(invitado) {
    codigoPendienteBorrar = invitado.codigo;
    deleteModalDesc.textContent = `Vas a eliminar a "${invitado.nombre_mostrar}" (código ${invitado.codigo}) y sus ${invitado.totalIntegrantes} integrante(s).`;
    deleteModal.classList.add('is-visible');
  }
 
  deleteCancelBtn.addEventListener('click', () => {
    deleteModal.classList.remove('is-visible');
    codigoPendienteBorrar = null;
  });
 
  deleteConfirmBtn.addEventListener('click', async () => {
    if (!codigoPendienteBorrar) return;
    try {
      // La FK miembros.codigo → invitados.codigo tiene ON DELETE CASCADE,
      // así que basta con borrar la fila de invitados.
      await supabaseFetch(`${TABLE_INVITADOS}?codigo=eq.${encodeURIComponent(codigoPendienteBorrar)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
      deleteModal.classList.remove('is-visible');
      codigoPendienteBorrar = null;
      await cargarInvitados();
    } catch (err) {
      alert('No se pudo eliminar: ' + err.message);
    }
  });
 
  /* =========================================================
     IMPORTAR CSV — una fila por integrante, agrupadas por familia
     ========================================================= */
  const openImportModalBtn = document.getElementById('open-import-modal');
  const importCancelBtn = document.getElementById('import-cancel-btn');
 
  openImportModalBtn.addEventListener('click', () => {
    csvFileInput.value = '';
    csvPreview.innerHTML = '';
    csvGrupos = [];
    importConfirmBtn.disabled = true;
    importModalError.classList.remove('is-visible');
    importModal.classList.add('is-visible');
  });
 
  importCancelBtn.addEventListener('click', () => importModal.classList.remove('is-visible'));
 
  csvFileInput.addEventListener('change', () => {
    const file = csvFileInput.files[0];
    if (!file) return;
 
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const filas = results.data;
        const errores = [];
        const gruposPorFamilia = new Map(); // clave: familia en minúsculas
 
        filas.forEach((fila, idx) => {
          const familia = (fila.familia || '').trim();
          const integrante = (fila.integrante || '').trim();
          const grupo = (fila.grupo || '').trim() || null;
 
          if (!familia) {
            errores.push(`Fila ${idx + 2}: falta el nombre de la familia`);
            return;
          }
          if (!integrante) {
            errores.push(`Fila ${idx + 2}: "${familia}" tiene un integrante sin nombre`);
            return;
          }
 
          const clave = familia.toLowerCase();
          if (!gruposPorFamilia.has(clave)) {
            gruposPorFamilia.set(clave, { familia, grupo, integrantes: [] });
          }
          gruposPorFamilia.get(clave).integrantes.push(integrante);
        });
 
        csvGrupos = Array.from(gruposPorFamilia.values());
 
        if (errores.length > 0) {
          importModalError.textContent = errores.join(' · ');
          importModalError.classList.add('is-visible');
        } else {
          importModalError.classList.remove('is-visible');
        }
 
        renderCsvPreview(csvGrupos);
        importConfirmBtn.disabled = csvGrupos.length === 0;
      },
      error: (err) => {
        importModalError.textContent = 'No se pudo leer el archivo: ' + err.message;
        importModalError.classList.add('is-visible');
      },
    });
  });
 
  function renderCsvPreview(grupos) {
    if (grupos.length === 0) {
      csvPreview.innerHTML = '';
      return;
    }
    csvPreview.innerHTML = `
      <table>
        <thead><tr><th>Familia</th><th>Grupo</th><th>Integrantes</th></tr></thead>
        <tbody>
          ${grupos.map((g) => `<tr><td>${escapeHtml(g.familia)}</td><td>${escapeHtml(g.grupo || '—')}</td><td>${escapeHtml(g.integrantes.join(', '))}</td></tr>`).join('')}
        </tbody>
      </table>
      <p style="margin-top:8px; color:var(--taupe); font-size:0.78rem;">${grupos.length} familia(s), ${grupos.reduce((s, g) => s + g.integrantes.length, 0)} integrante(s) en total</p>
    `;
  }
 
  importConfirmBtn.addEventListener('click', async () => {
    if (csvGrupos.length === 0) {
      importModalError.textContent = 'No hay filas válidas para importar. Revisa tu archivo CSV.';
      importModalError.classList.add('is-visible');
      return;
    }
    importConfirmBtn.disabled = true;
    importConfirmBtn.textContent = 'Importando…';
 
    try {
      const codigosExistentes = new Set(invitadosCache.map((i) => i.codigo));
      const nuevosInvitados = [];
      const nuevosMiembros = [];
 
      csvGrupos.forEach((g) => {
        const codigo = generarCodigo(g.familia, codigosExistentes);
        codigosExistentes.add(codigo);
        nuevosInvitados.push({ codigo, nombre_mostrar: g.familia, grupo: g.grupo });
        g.integrantes.forEach((nombre, idx) => {
          nuevosMiembros.push({ codigo, nombre, orden: idx });
        });
      });
 
      await supabaseFetch(TABLE_INVITADOS, {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(nuevosInvitados),
      });
 
      await supabaseFetch(TABLE_MIEMBROS, {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(nuevosMiembros),
      });
 
      importModal.classList.remove('is-visible');
      await cargarInvitados();
    } catch (err) {
      console.error('[Importar CSV] Error:', err);
      importModalError.textContent = 'Error al importar: ' + err.message;
      importModalError.classList.add('is-visible');
    } finally {
      importConfirmBtn.disabled = false;
      importConfirmBtn.textContent = 'Importar';
    }
  });
 
  /* =========================================================
     EXPORTAR — CSV descargable (una fila por integrante)
     ========================================================= */
  document.getElementById('export-csv-btn').addEventListener('click', () => {
    const filas = [];
    invitadosCache.forEach((inv) => {
      const link = construirLink(inv.codigo);
      inv.miembros.forEach((m) => {
        filas.push({
          familia: inv.nombre_mostrar,
          codigo: inv.codigo,
          grupo: inv.grupo || '',
          integrante: m.nombre,
          estado_integrante: m.asiste === true ? 'Confirmado' : m.asiste === false ? 'No asiste' : 'Sin responder',
          link,
        });
      });
    });
 
    const csv = Papa.unparse(filas);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'invitados-ezequiel-karla.csv';
    a.click();
    URL.revokeObjectURL(url);
  });
 
  /* =========================================================
     EXPORTAR — vista para copiar y pegar en WhatsApp
     ========================================================= */
  const exportViewBtn = document.getElementById('export-view-btn');
  const copyCloseBtn = document.getElementById('copy-close-btn');
 
  exportViewBtn.addEventListener('click', () => {
    if (invitadosCache.length === 0) {
      alert('Todavía no hay invitados para mostrar.');
      return;
    }
 
    copyList.innerHTML = invitadosCache.map((inv) => {
      const link = construirLink(inv.codigo);
      const nombres = inv.miembros.map((m) => m.nombre).join(', ');
      const mensaje = `Hola ${inv.nombre_mostrar}! Nos encantaría contar con su presencia en nuestra boda. Tenemos ${inv.totalIntegrantes} lugar(es) reservado(s) para: ${nombres}. Pueden confirmar su asistencia aquí: ${link}`;
      return `
        <div class="copy-item">
          <div class="copy-item__info">
            <div class="copy-item__name">${escapeHtml(inv.nombre_mostrar)} · ${inv.totalIntegrantes} integrante(s)</div>
            <div class="copy-item__link">${escapeHtml(link)}</div>
          </div>
          <button class="btn-outline copy-item__btn" data-mensaje="${escapeHtml(mensaje)}">Copiar mensaje</button>
        </div>
      `;
    }).join('');
 
    copyModal.classList.add('is-visible');
  });
 
  copyList.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mensaje]');
    if (!btn) return;
    navigator.clipboard.writeText(btn.dataset.mensaje).then(() => {
      btn.textContent = 'Copiado ✓';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'Copiar mensaje';
        btn.classList.remove('copied');
      }, 1500);
    });
  });
 
  copyCloseBtn.addEventListener('click', () => copyModal.classList.remove('is-visible'));
 
  /* =========================================================
     Cerrar modales al hacer click fuera del cuadro
     ========================================================= */
  [guestModal, importModal, copyModal, deleteModal].forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('is-visible');
    });
  });
 
 
  /* =========================================================
     ÁLBUM DE RECUERDOS — widget + toggle approved
     ========================================================= */
  async function cargarRecuerdos() {
    if (!rwGrid) return;
    rwLoading.hidden = false;
    rwEmpty.hidden   = true;
    rwGrid.innerHTML = '';
 
    try {
      const data = await supabaseFetch(
        `${TABLE_MEDIA}?wedding_id=eq.${WEDDING_ID_MEDIA}&order=uploaded_at.desc&limit=${RECUERDOS_LIMIT}&select=id,url_thumb,url,file_type,approved,guest_name`
      );
 
      const all = await supabaseFetch(
        `${TABLE_MEDIA}?wedding_id=eq.${WEDDING_ID_MEDIA}&select=id,file_type,approved`
      );
 
      rwLoading.hidden = true;
 
      if (!all || all.length === 0) {
        rwEmpty.hidden        = false;
        rwTotal.textContent   = '0 archivos';
        rwFotos.textContent   = '0';
        rwVideos.textContent  = '0';
        rwOcultas.textContent = '0';
        return;
      }
 
      rwTotal.textContent   = `${all.length} ${all.length === 1 ? 'archivo' : 'archivos'}`;
      rwFotos.textContent   = all.filter(x => x.file_type === 'image').length;
      rwVideos.textContent  = all.filter(x => x.file_type === 'video').length;
      rwOcultas.textContent = all.filter(x => !x.approved).length;
 
      (data || []).forEach(item => {
        const wrap = document.createElement('div');
        wrap.className       = 'rw-thumb' + (item.approved ? '' : ' rw-thumb--hidden');
        wrap.dataset.id       = item.id;
        wrap.dataset.approved = item.approved ? '1' : '0';
 
        const img = document.createElement('img');
        img.src     = item.url_thumb || item.url;
        img.alt     = `Foto de ${item.guest_name || 'invitado'}`;
        img.loading = 'lazy';
        wrap.appendChild(img);
 
        if (item.file_type === 'video') {
          const badge       = document.createElement('span');
          badge.className   = 'rw-thumb__video-badge';
          badge.textContent = 'VIDEO';
          wrap.appendChild(badge);
        }
 
        const overlay   = document.createElement('div');
        overlay.className = 'rw-thumb__overlay';
 
        const toggleBtn       = document.createElement('button');
        toggleBtn.className   = 'rw-thumb__toggle';
        toggleBtn.textContent = item.approved ? 'Ocultar' : 'Mostrar';
 
        let currentApproved = item.approved;
        toggleBtn.addEventListener('click', async () => {
          await toggleAprobado(wrap, toggleBtn, item.id, currentApproved);
          currentApproved = !currentApproved;
        });
 
        overlay.appendChild(toggleBtn);
        wrap.appendChild(overlay);
        rwGrid.appendChild(wrap);
      });
 
    } catch (err) {
      rwLoading.hidden  = true;
      rwEmpty.hidden    = false;
      rwEmpty.textContent = 'Error al cargar el álbum: ' + err.message;
    }
  }
 
  async function toggleAprobado(wrap, btn, id, currentApproved) {
    const newVal   = !currentApproved;
    const prevText = btn.textContent;
    btn.textContent = '…';
    btn.disabled    = true;
 
    try {
      await supabaseFetch(`${TABLE_MEDIA}?id=eq.${id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ approved: newVal }),
      });
 
      if (newVal) {
        wrap.classList.remove('rw-thumb--hidden');
      } else {
        wrap.classList.add('rw-thumb--hidden');
      }
      btn.textContent = newVal ? 'Ocultar' : 'Mostrar';
 
      const ocultas = rwGrid.querySelectorAll('.rw-thumb--hidden').length;
      if (rwOcultas) rwOcultas.textContent = ocultas;
 
    } catch (err) {
      console.error('Error actualizando approved:', err);
      btn.textContent = prevText;
    } finally {
      btn.disabled = false;
    }
  }
 
  /* =========================================================
     INICIALIZACIÓN
     ========================================================= */
  async function iniciarApp() {
    loginScreen.style.display = 'none';
    adminApp.classList.add('is-visible');
    try {
      await cargarInvitados();
      await cargarRecuerdos();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" class="t-center loading-row">Error al cargar: ${escapeHtml(err.message)}</td></tr>`;
    }
  }
 
  if (recuperarSesion()) {
    iniciarApp();
  }
 
})();