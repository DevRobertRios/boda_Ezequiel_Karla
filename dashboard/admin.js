/* =========================================================
   ADMIN PANEL — Lógica completa
   Login con Supabase Auth, CRUD de invitados, generador de
   códigos automático, importador CSV, exportadores
   ========================================================= */
(function () {

  /* =========================================================
     ⚠️ CONFIGURACIÓN SUPABASE
     Las mismas credenciales que ya usa rsvp.js
     ========================================================= */
  const SUPABASE_URL = 'https://nvkuqndqlfdxkvuhlwcy.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_8SX6IrG_3JGb-vIv3_ooXw_fMnrCRsy';
  const TABLE_INVITADOS = 'invitados';
  const TABLE_RSVP = 'rsvp';

  // URL base para construir los links de invitación.
  // IMPORTANTE: cambia esto cuando publiques (ej. https://ezequielykarla.com)
  const SITIO_BASE_URL = window.location.origin + window.location.pathname.replace('admin.html', '');

  // Prefijo fijo para todos los códigos generados (de la boda)
  const PREFIJO_CODIGO = 'EK';

  /* ---------------------------------------------------------
     Estado en memoria de la sesión del admin
     --------------------------------------------------------- */
  let accessToken = null; // token de Supabase Auth, se guarda solo en memoria
  let invitadosCache = []; // lista completa de invitados + su estado de rsvp

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
  const guestPases = document.getElementById('guest-pases');
  const guestGrupo = document.getElementById('guest-grupo');
  const guestCodigo = document.getElementById('guest-codigo');
  const guestOriginalCodigo = document.getElementById('guest-original-codigo');
  const guestModalError = document.getElementById('guest-modal-error');

  const importModal = document.getElementById('import-modal');
  const csvFileInput = document.getElementById('csv-file');
  const csvPreview = document.getElementById('csv-preview');
  const importModalError = document.getElementById('import-modal-error');
  const importConfirmBtn = document.getElementById('import-confirm-btn');

  const copyModal = document.getElementById('copy-modal');
  const copyList = document.getElementById('copy-list');

  const deleteModal = document.getElementById('delete-modal');
  const deleteModalDesc = document.getElementById('delete-modal-desc');

  let csvParsedRows = []; // filas válidas listas para importar
  let codigoPendienteBorrar = null;

  /* =========================================================
     GENERADOR DE CÓDIGOS
     Formato: EK-NOMBRE-XXX (prefijo boda + nombre + 3 random)
     Ejemplo: "Familia García" → EK-GARCIA-4F2
     ========================================================= */
  function quitarAcentos(texto) {
    return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function generarBaseDesdeNombre(nombre) {
    // Toma la primera palabra significativa del nombre (ignora "Familia", "Sr.", etc.)
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

    return data; // contiene access_token, refresh_token, etc.
  }

  function guardarSesion(data) {
    accessToken = data.access_token;
    // Guardamos en sessionStorage (se borra al cerrar pestaña) — no localStorage,
    // por seguridad: si alguien usa una compu compartida, no queda sesión abierta.
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
     CARGA DE DATOS — invitados + su estado de rsvp combinado
     ========================================================= */
  async function cargarInvitados() {
    tbody.innerHTML = '<tr><td colspan="7" class="t-center loading-row">Cargando invitados…</td></tr>';

    const [invitados, rsvps] = await Promise.all([
      supabaseFetch(`${TABLE_INVITADOS}?select=*&order=nombre_mostrar.asc`),
      supabaseFetch(`${TABLE_RSVP}?select=*`),
    ]);

    const rsvpPorCodigo = new Map(rsvps.map((r) => [r.codigo, r]));

    invitadosCache = invitados.map((inv) => {
      const rsvp = rsvpPorCodigo.get(inv.codigo);
      let estado = 'pendiente';
      if (rsvp) {
        estado = rsvp.asiste ? 'confirmado' : 'no-asiste';
      }
      return {
        ...inv,
        estado,
        confirmados: rsvp ? rsvp.num_personas_confirmadas : null,
      };
    });

    pintarTabla(invitadosCache);
    pintarMetricas(invitadosCache);
  }

  /* =========================================================
     MÉTRICAS — contadas por BOLETOS, no por familias
     ========================================================= */
  function pintarMetricas(lista) {
    const totalLugares = lista.reduce((sum, i) => sum + i.pases_asignados, 0);
    const confirmadosLugares = lista
      .filter((i) => i.estado === 'confirmado')
      .reduce((sum, i) => sum + (i.confirmados || 0), 0);
    const pendientesLugares = lista
      .filter((i) => i.estado === 'pendiente')
      .reduce((sum, i) => sum + i.pases_asignados, 0);
    const rechazadosLugares = lista
      .filter((i) => i.estado === 'no-asiste')
      .reduce((sum, i) => sum + i.pases_asignados, 0);

    document.getElementById('m-total').textContent = totalLugares;
    document.getElementById('m-confirmados').textContent = confirmadosLugares;
    document.getElementById('m-pendientes').textContent = pendientesLugares;
    document.getElementById('m-rechazados').textContent = rechazadosLugares;

    // Barra de progreso y porcentaje
    const pct = totalLugares > 0 ? Math.round((confirmadosLugares / totalLugares) * 100) : 0;
    const pctEl = document.getElementById('m-confirmados-pct');
    const barEl = document.getElementById('m-progress');
    if (pctEl) pctEl.textContent = `${pct}% del total`;
    if (barEl)  barEl.style.width = `${pct}%`;
  }

  /* =========================================================
     TABLA — pintar filas
     ========================================================= */
  function badgeEstado(estado) {
    const map = {
      'confirmado': { clase: 'estado-badge--confirmado', texto: 'Confirmado' },
      'pendiente': { clase: 'estado-badge--pendiente', texto: 'Pendiente' },
      'no-asiste': { clase: 'estado-badge--no-asiste', texto: 'No asiste' },
    };
    const info = map[estado];
    return `<span class="estado-badge ${info.clase}">${info.texto}</span>`;
  }

  function iniciales(nombre) {
    return nombre.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }

  function pintarTabla(lista) {
    // Actualiza el contador del header de tabla
    const countEl = document.getElementById('table-count');
    if (countEl) countEl.textContent = lista.length === 1 ? '1 invitado' : `${lista.length} invitados`;

    if (lista.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Sin invitados. Agrega uno o importa un CSV.</td></tr>';
      return;
    }

    tbody.innerHTML = lista.map((inv) => `
      <tr>
        <td>
          <div class="guest-cell">
            <div class="guest-avatar">${escapeHtml(iniciales(inv.nombre_mostrar))}</div>
            <div>
              <div class="guest-name">${escapeHtml(inv.nombre_mostrar)}</div>
              ${inv.grupo ? `<div class="guest-grupo">${escapeHtml(inv.grupo)}</div>` : ''}
            </div>
          </div>
        </td>
        <td><span class="codigo-cell">${escapeHtml(inv.codigo)}</span></td>
        <td class="t-center"><span class="pases-cell">${inv.pases_asignados}</span></td>
        <td class="t-center">${badgeEstado(inv.estado)}</td>
        <td class="t-center">${inv.confirmados === null ? '<span style="color:var(--taupe)">—</span>' : `<strong>${inv.confirmados}</strong>`}</td>
        <td class="t-right">
          <div class="row-actions">
            <button class="icon-btn" title="Copiar link" data-action="copiar-link" data-codigo="${escapeHtml(inv.codigo)}">🔗</button>
            <button class="icon-btn" title="Editar" data-action="editar" data-codigo="${escapeHtml(inv.codigo)}">✎</button>
            <button class="icon-btn icon-btn--danger" title="Eliminar" data-action="borrar" data-codigo="${escapeHtml(inv.codigo)}">✕</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  }

  /* ---------------------------------------------------------
     Búsqueda en vivo (por nombre o código)
     --------------------------------------------------------- */
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) {
      pintarTabla(invitadosCache);
      return;
    }
    const filtrados = invitadosCache.filter((inv) =>
      inv.nombre_mostrar.toLowerCase().includes(q) ||
      inv.codigo.toLowerCase().includes(q)
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
    }
  });

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
     MODAL: AGREGAR / EDITAR INVITADO
     ========================================================= */
  const openAddModalBtn = document.getElementById('open-add-modal');
  const guestCancelBtn = document.getElementById('guest-cancel-btn');
  const guestCodigoGroup = document.getElementById('guest-codigo-group');

  function abrirModalAgregar() {
    guestModalTitle.textContent = 'Agregar invitado';
    guestForm.reset();
    guestOriginalCodigo.value = '';
    guestPases.value = 1;
    guestCodigoGroup.style.display = 'none';
    document.querySelector('.modal-desc').textContent = 'El código se genera automáticamente al guardar.';
    guestModalError.classList.remove('is-visible');
    guestModal.classList.add('is-visible');
    guestNombre.focus();
  }

  function abrirModalEditar(invitado) {
    guestModalTitle.textContent = 'Editar invitado';
    document.querySelector('.modal-desc').textContent = 'Modifica los datos del invitado. El código no cambia.';
    guestNombre.value = invitado.nombre_mostrar;
    guestPases.value = invitado.pases_asignados;
    guestGrupo.value = invitado.grupo || '';
    guestCodigo.value = invitado.codigo;
    guestOriginalCodigo.value = invitado.codigo;
    guestCodigoGroup.style.display = 'block';
    guestModalError.classList.remove('is-visible');
    guestModal.classList.add('is-visible');
    guestNombre.focus();
  }

  openAddModalBtn.addEventListener('click', abrirModalAgregar);
  guestCancelBtn.addEventListener('click', () => guestModal.classList.remove('is-visible'));

  guestForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    guestModalError.classList.remove('is-visible');

    const nombre = guestNombre.value.trim();
    const pases = Number(guestPases.value);
    const grupo = guestGrupo.value.trim() || null;
    const esEdicion = !!guestOriginalCodigo.value;

    if (!nombre || pases < 1) {
      guestModalError.textContent = 'Revisa el nombre y el número de pases.';
      guestModalError.classList.add('is-visible');
      return;
    }

    try {
      if (esEdicion) {
        await supabaseFetch(`${TABLE_INVITADOS}?codigo=eq.${encodeURIComponent(guestOriginalCodigo.value)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ nombre_mostrar: nombre, pases_asignados: pases, grupo }),
        });
      } else {
        const codigosExistentes = new Set(invitadosCache.map((i) => i.codigo));
        const codigo = generarCodigo(nombre, codigosExistentes);
        await supabaseFetch(TABLE_INVITADOS, {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ codigo, nombre_mostrar: nombre, pases_asignados: pases, grupo }),
        });
      }

      guestModal.classList.remove('is-visible');
      await cargarInvitados();
    } catch (err) {
      guestModalError.textContent = 'No se pudo guardar: ' + err.message;
      guestModalError.classList.add('is-visible');
    }
  });

  /* =========================================================
     MODAL: BORRAR INVITADO
     ========================================================= */
  const deleteCancelBtn = document.getElementById('delete-cancel-btn');
  const deleteConfirmBtn = document.getElementById('delete-confirm-btn');

  function abrirModalBorrar(invitado) {
    codigoPendienteBorrar = invitado.codigo;
    deleteModalDesc.textContent = `Vas a eliminar a "${invitado.nombre_mostrar}" (código ${invitado.codigo}).`;
    deleteModal.classList.add('is-visible');
  }

  deleteCancelBtn.addEventListener('click', () => {
    deleteModal.classList.remove('is-visible');
    codigoPendienteBorrar = null;
  });

  deleteConfirmBtn.addEventListener('click', async () => {
    if (!codigoPendienteBorrar) return;
    try {
      // Borra primero su rsvp (si tiene) y luego al invitado, para no violar la
      // relación de llave foránea (rsvp.codigo → invitados.codigo)
      await supabaseFetch(`${TABLE_RSVP}?codigo=eq.${encodeURIComponent(codigoPendienteBorrar)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
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
     IMPORTAR CSV
     ========================================================= */
  const openImportModalBtn = document.getElementById('open-import-modal');
  const importCancelBtn = document.getElementById('import-cancel-btn');

  openImportModalBtn.addEventListener('click', () => {
    csvFileInput.value = '';
    csvPreview.innerHTML = '';
    csvParsedRows = [];
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
        const validas = [];

        filas.forEach((fila, idx) => {
          const nombre = (fila.nombre || '').trim();
          const pases = Number(fila.pases);
          const grupo = (fila.grupo || '').trim() || null;

          if (!nombre) {
            errores.push(`Fila ${idx + 2}: falta el nombre`);
            return;
          }
          if (!pases || pases < 1) {
            errores.push(`Fila ${idx + 2}: "${nombre}" tiene un número de pases inválido`);
            return;
          }
          validas.push({ nombre, pases, grupo });
        });

        csvParsedRows = validas;

        if (errores.length > 0) {
          importModalError.textContent = errores.join(' · ');
          importModalError.classList.add('is-visible');
        } else {
          importModalError.classList.remove('is-visible');
        }

        renderCsvPreview(validas);
        importConfirmBtn.disabled = validas.length === 0;
      },
      error: (err) => {
        importModalError.textContent = 'No se pudo leer el archivo: ' + err.message;
        importModalError.classList.add('is-visible');
      },
    });
  });

  function renderCsvPreview(filas) {
    if (filas.length === 0) {
      csvPreview.innerHTML = '';
      return;
    }
    csvPreview.innerHTML = `
      <table>
        <thead><tr><th>Nombre</th><th>Pases</th><th>Grupo</th></tr></thead>
        <tbody>
          ${filas.map((f) => `<tr><td>${escapeHtml(f.nombre)}</td><td>${f.pases}</td><td>${escapeHtml(f.grupo || '—')}</td></tr>`).join('')}
        </tbody>
      </table>
      <p style="margin-top:8px; color:var(--color-taupe); font-size:0.78rem;">${filas.length} invitado(s) listos para importar</p>
    `;
  }

  importConfirmBtn.addEventListener('click', async () => {
    if (csvParsedRows.length === 0) {
      importModalError.textContent = 'No hay filas válidas para importar. Revisa tu archivo CSV.';
      importModalError.classList.add('is-visible');
      return;
    }
    importConfirmBtn.disabled = true;
    importConfirmBtn.textContent = 'Importando…';

    try {
      const codigosExistentes = new Set(invitadosCache.map((i) => i.codigo));
      const nuevos = csvParsedRows.map((fila) => {
        const codigo = generarCodigo(fila.nombre, codigosExistentes);
        codigosExistentes.add(codigo); // evita duplicados dentro del mismo lote
        return {
          codigo,
          nombre_mostrar: fila.nombre,
          pases_asignados: fila.pases,
          grupo: fila.grupo,
        };
      });

      console.log('[Importar CSV] Enviando a Supabase:', nuevos);

      await supabaseFetch(TABLE_INVITADOS, {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(nuevos),
      });

      console.log('[Importar CSV] Insert exitoso. Recargando tabla…');

      importModal.classList.remove('is-visible');
      await cargarInvitados();

      console.log('[Importar CSV] Tabla recargada. Total invitados ahora:', invitadosCache.length);
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
     EXPORTAR — CSV descargable
     ========================================================= */
  document.getElementById('export-csv-btn').addEventListener('click', () => {
    const filas = invitadosCache.map((inv) => ({
      nombre: inv.nombre_mostrar,
      codigo: inv.codigo,
      grupo: inv.grupo || '',
      pases_asignados: inv.pases_asignados,
      estado: inv.estado,
      confirmados: inv.confirmados ?? '',
      link: construirLink(inv.codigo),
    }));

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
      const mensaje = `Hola ${inv.nombre_mostrar}! Nos encantaría contar con su presencia en nuestra boda. Pueden confirmar su asistencia aquí: ${link}`;
      return `
        <div class="copy-item">
          <div class="copy-item__info">
            <div class="copy-item__name">${escapeHtml(inv.nombre_mostrar)} · ${inv.pases_asignados} pase(s)</div>
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
     INICIALIZACIÓN
     ========================================================= */
  async function iniciarApp() {
    loginScreen.style.display = 'none';
    adminApp.classList.add('is-visible');
    try {
      await cargarInvitados();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" class="t-center loading-row">Error al cargar: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  // Al cargar la página, revisa si ya había una sesión activa (sessionStorage)
  if (recuperarSesion()) {
    iniciarApp();
  }

})();