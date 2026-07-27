/* =========================================================
   ÁLBUM PRIVADO — album.js
   Autenticación con Supabase Auth, galería paginada,
   lightbox con descarga individual, ocultar y borrar.
   ========================================================= */
(function () {

  /* =========================================================
     CONFIGURACIÓN — mismas constantes que admin.js
     ========================================================= */
  const SUPABASE_URL      = 'https://nvkuqndqlfdxkvuhlwcy.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_8SX6IrG_3JGb-vIv3_ooXw_fMnrCRsy';
  const TABLE_MEDIA       = 'media';
  const WEDDING_ID        = 'EK2026';
  const PAGE_SIZE         = 24; // fotos por página

  /* =========================================================
     ESTADO
     ========================================================= */
  let accessToken    = null;
  let currentPage    = 0;
  let currentFilter  = 'all';
  let totalCount     = 0;
  let lightboxItem   = null; // ítem activo en el lightbox

  /* =========================================================
     DOM REFS
     ========================================================= */
  const loginScreen   = document.getElementById('login-screen');
  const loginForm     = document.getElementById('login-form');
  const loginError    = document.getElementById('login-error');
  const loginSubmit   = document.getElementById('login-submit');
  const adminApp      = document.getElementById('admin-app');
  const logoutBtn     = document.getElementById('logout-btn');

  const asTotal       = document.getElementById('as-total');
  const asFotos       = document.getElementById('as-fotos');
  const asVideos      = document.getElementById('as-videos');
  const asOcultas     = document.getElementById('as-ocultas');

  const albumGrid     = document.getElementById('album-grid');
  const albumEmpty    = document.getElementById('album-empty');
  const albumLoading  = document.getElementById('album-loading');
  const albumPagination = document.getElementById('album-pagination');
  const loadMoreBtn   = document.getElementById('load-more-btn');
  const paginationInfo = document.getElementById('pagination-info');

  const lightbox      = document.getElementById('album-lightbox');
  const lbClose       = document.getElementById('lb-close');
  const lbMedia       = document.getElementById('lb-media');
  const lbMeta        = document.getElementById('lb-meta');
  const lbToggle      = document.getElementById('lb-toggle');
  const lbDownload    = document.getElementById('lb-download');
  const lbDelete      = document.getElementById('lb-delete');

  const deleteModal   = document.getElementById('delete-media-modal');
  const deleteCancel  = document.getElementById('delete-media-cancel');
  const deleteConfirm = document.getElementById('delete-media-confirm');

  /* =========================================================
     AUTENTICACIÓN — igual que admin.js
     ========================================================= */
  function authHeaders() {
    return {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}`,
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
      throw new Error(errText || `Error (${response.status})`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async function login(email, password) {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) throw new Error('Credenciales incorrectas');
    return response.json();
  }

  function guardarSesion(token) {
    sessionStorage.setItem('album_token', token);
    accessToken = token;
  }

  function recuperarSesion() {
    const token = sessionStorage.getItem('album_token');
    if (token) { accessToken = token; return true; }
    return false;
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    loginSubmit.disabled = true;
    loginSubmit.textContent = 'Entrando…';
    try {
      const data = await login(
        document.getElementById('login-email').value.trim(),
        document.getElementById('login-password').value
      );
      guardarSesion(data.access_token);
      iniciarApp();
    } catch (err) {
      loginError.textContent = err.message;
    } finally {
      loginSubmit.disabled = false;
      loginSubmit.textContent = 'Entrar';
    }
  });

  logoutBtn.addEventListener('click', () => {
    sessionStorage.removeItem('album_token');
    accessToken = null;
    adminApp.classList.remove('is-visible');
    loginScreen.style.display = '';
  });

  /* =========================================================
     CARGA DEL ÁLBUM
     ========================================================= */
  function buildQuery(filter, offset) {
    let q = `${TABLE_MEDIA}?wedding_id=eq.${WEDDING_ID}&order=uploaded_at.desc`;
    q += `&limit=${PAGE_SIZE}&offset=${offset}`;
    q += `&select=id,url,url_thumb,file_type,approved,guest_name,uploaded_at,file_name`;

    if (filter === 'image')  q += '&file_type=eq.image';
    if (filter === 'video')  q += '&file_type=eq.video';
    if (filter === 'hidden') q += '&approved=eq.false';

    return q;
  }

  async function cargarStats() {
    const all = await supabaseFetch(
      `${TABLE_MEDIA}?wedding_id=eq.${WEDDING_ID}&select=id,file_type,approved`
    );
    if (!all) return;
    totalCount = all.length;
    asTotal.textContent   = all.length;
    asFotos.textContent   = all.filter(x => x.file_type === 'image').length;
    asVideos.textContent  = all.filter(x => x.file_type === 'video').length;
    asOcultas.textContent = all.filter(x => !x.approved).length;
  }

  async function cargarPagina(reset = false) {
    if (reset) {
      currentPage = 0;
      albumGrid.innerHTML = '';
    }

    albumLoading.hidden  = false;
    albumEmpty.hidden    = true;
    albumPagination.hidden = true;

    const offset = currentPage * PAGE_SIZE;
    const data   = await supabaseFetch(buildQuery(currentFilter, offset));

    albumLoading.hidden = true;

    if (!data || data.length === 0) {
      if (currentPage === 0) albumEmpty.hidden = false;
      return;
    }

    data.forEach(item => albumGrid.appendChild(buildCard(item)));
    currentPage++;

    const loaded = currentPage * PAGE_SIZE;
    if (data.length === PAGE_SIZE) {
      albumPagination.hidden = false;
      paginationInfo.textContent = `Mostrando ${Math.min(loaded, totalCount)} de ${totalCount}`;
    }
  }

  /* =========================================================
     TARJETA DE FOTO
     ========================================================= */
  function buildCard(item) {
    const card = document.createElement('div');
    card.className = 'album-item' + (item.approved ? '' : ' album-item--hidden');
    card.dataset.id = item.id;

    // Thumbnail — imagen siempre, incluso para video
    const img = document.createElement('img');
    img.src     = item.url_thumb || item.url;
    img.alt     = `Foto de ${item.guest_name || 'invitado'}`;
    img.loading = 'lazy';
    card.appendChild(img);

    if (item.file_type === 'video') {
      const vbadge = document.createElement('span');
      vbadge.className   = 'album-item__video-badge';
      vbadge.textContent = '▶ VIDEO';
      card.appendChild(vbadge);
    }

    if (!item.approved) {
      const hbadge = document.createElement('span');
      hbadge.className   = 'album-item__hidden-badge';
      hbadge.textContent = 'Oculta';
      card.appendChild(hbadge);
    }

    if (item.guest_name) {
      const guest = document.createElement('div');
      guest.className   = 'album-item__guest';
      guest.textContent = item.guest_name;
      card.appendChild(guest);
    }

    card.addEventListener('click', () => openLightbox(item, card));
    return card;
  }

  /* =========================================================
     FILTROS
     ========================================================= */
  document.getElementById('album-filters').addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;

    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('filter-btn--active'));
    btn.classList.add('filter-btn--active');
    currentFilter = btn.dataset.filter;
    cargarPagina(true);
  });

  loadMoreBtn.addEventListener('click', () => cargarPagina(false));

  /* =========================================================
     LIGHTBOX
     ========================================================= */
  function openLightbox(item, card) {
    lightboxItem = { item, card };

    // Media
    lbMedia.innerHTML = '';
    if (item.file_type === 'video') {
      const vid = document.createElement('video');
      vid.src      = item.url;
      vid.controls = true;
      vid.autoplay = true;
      vid.playsInline = true;
      lbMedia.appendChild(vid);
    } else {
      const img = document.createElement('img');
      img.src = item.url;
      img.alt = `Foto de ${item.guest_name || 'invitado'}`;
      lbMedia.appendChild(img);
    }

    // Meta
    const fecha = new Date(item.uploaded_at).toLocaleDateString('es-MX', {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    lbMeta.innerHTML = `
      ${item.guest_name ? `<strong>${item.guest_name}</strong> · ` : ''}
      ${item.file_type === 'video' ? 'Video' : 'Foto'} · ${fecha}
    `;

    // Botón Ocultar / Mostrar
    lbToggle.textContent = item.approved ? 'Ocultar' : 'Mostrar';

    // Descarga — forzar descarga con ?fl_attachment en la URL de Cloudinary
    const downloadUrl = item.url.includes('cloudinary.com')
      ? item.url.replace('/upload/', '/upload/fl_attachment/')
      : item.url;
    lbDownload.href     = downloadUrl;
    lbDownload.download = item.file_name || `recuerdo-${item.id}`;

    lightbox.hidden = false;
    lbClose.focus();
  }

  function closeLightbox() {
    lightbox.hidden = true;
    lbMedia.innerHTML = '';
    lightboxItem = null;
  }

  lbClose.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLightbox(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !lightbox.hidden) closeLightbox(); });

  /* ---------- Ocultar / Mostrar desde lightbox ---------- */
  lbToggle.addEventListener('click', async () => {
    if (!lightboxItem) return;
    const { item, card } = lightboxItem;
    const newVal = !item.approved;

    lbToggle.textContent = '…';
    lbToggle.disabled    = true;

    try {
      await supabaseFetch(`${TABLE_MEDIA}?id=eq.${item.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ approved: newVal }),
      });

      item.approved = newVal;
      lbToggle.textContent = newVal ? 'Ocultar' : 'Mostrar';

      // Actualizar la tarjeta en el grid
      if (newVal) {
        card.classList.remove('album-item--hidden');
        card.querySelector('.album-item__hidden-badge')?.remove();
      } else {
        card.classList.add('album-item--hidden');
        if (!card.querySelector('.album-item__hidden-badge')) {
          const hbadge = document.createElement('span');
          hbadge.className   = 'album-item__hidden-badge';
          hbadge.textContent = 'Oculta';
          card.appendChild(hbadge);
        }
      }

      // Actualizar contador de ocultas
      cargarStats();

    } catch (err) {
      lbToggle.textContent = item.approved ? 'Ocultar' : 'Mostrar';
      alert('Error al actualizar: ' + err.message);
    } finally {
      lbToggle.disabled = false;
    }
  });

  /* ---------- Borrar desde lightbox ---------- */
  lbDelete.addEventListener('click', () => {
    deleteModal.classList.add('is-visible');
  });

  deleteCancel.addEventListener('click', () => {
    deleteModal.classList.remove('is-visible');
  });

  deleteConfirm.addEventListener('click', async () => {
    if (!lightboxItem) return;
    const { item, card } = lightboxItem;

    deleteConfirm.textContent = 'Eliminando…';
    deleteConfirm.disabled    = true;

    try {
      await supabaseFetch(`${TABLE_MEDIA}?id=eq.${item.id}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });

      // Quitar la tarjeta del grid con animación
      card.style.transition = 'opacity 0.3s, transform 0.3s';
      card.style.opacity    = '0';
      card.style.transform  = 'scale(0.85)';
      setTimeout(() => card.remove(), 320);

      deleteModal.classList.remove('is-visible');
      closeLightbox();
      cargarStats();

    } catch (err) {
      alert('Error al eliminar: ' + err.message);
    } finally {
      deleteConfirm.textContent = 'Sí, eliminar';
      deleteConfirm.disabled    = false;
    }
  });

  /* =========================================================
     INICIO
     ========================================================= */
  async function iniciarApp() {
    loginScreen.style.display = 'none';
    adminApp.classList.add('is-visible');
    albumLoading.hidden = false;
    try {
      await cargarStats();
      await cargarPagina(true);
    } catch (err) {
      albumLoading.hidden   = true;
      albumEmpty.hidden     = false;
      albumEmpty.textContent = 'Error al cargar: ' + err.message;
    }
  }

  if (recuperarSesion()) {
    iniciarApp();
  }

})();