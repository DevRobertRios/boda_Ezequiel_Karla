/* =========================================================
   RECUERDOS — Lógica completa
   Subida de fotos/videos a Supabase Storage,
   guardado de metadatos en tabla media,
   galería de las últimas fotos compartidas.
   =========================================================

   CONFIGURACIÓN: cambia solo estas dos constantes,
   son las mismas que usas en admin.js
   ========================================================= */

const SUPABASE_URL     = 'https://nvkuqndqlfdxkvuhlwcy.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_8SX6IrG_3JGb-vIv3_ooXw_fMnrCRsy';
const BUCKET_NAME      = 'recuerdos';   // nombre del bucket que creaste
const TABLE_MEDIA      = 'media';       // tabla en Supabase para metadatos
const WEDDING_ID       = 'EK2025';      // identifica esta boda (útil si escalas)
const MAX_FILE_SIZE_MB = 100;           // límite por archivo (videos pesados)
const GALLERY_LIMIT    = 20;            // cuántas fotos mostrar en la galería

/* ---------------------------------------------------------
   Inicializar cliente Supabase
   --------------------------------------------------------- */
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------------------------------------------------------
   Referencias DOM
   --------------------------------------------------------- */
const guestNameInput  = document.getElementById('guest-name');
const dropzone        = document.getElementById('dropzone');
const fileInput       = document.getElementById('file-input');
const previewGrid     = document.getElementById('preview-grid');
const progressWrap    = document.getElementById('progress-wrap');
const progressBar     = document.getElementById('progress-bar');
const progressLabel   = document.getElementById('progress-label');
const uploadBtn       = document.getElementById('upload-btn');
const statusOk        = document.getElementById('status-ok');
const statusErr       = document.getElementById('status-err');
const galleryGrid     = document.getElementById('gallery-grid');
const galleryEmpty    = document.getElementById('gallery-empty');
const galleryLoading  = document.getElementById('gallery-loading');

/* ---------------------------------------------------------
   Estado local
   --------------------------------------------------------- */
let selectedFiles = []; // Array de File

/* =========================================================
   ZONA DE SUBIDA — Drag & drop + click
   ========================================================= */

// Click en la dropzone abre el selector de archivos
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') fileInput.click();
});

// Drag & drop visual
dropzone.addEventListener('dragover', e => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  handleFiles([...e.dataTransfer.files]);
});

// Selección normal desde el input
fileInput.addEventListener('change', () => {
  handleFiles([...fileInput.files]);
  fileInput.value = ''; // reset para poder volver a seleccionar los mismos
});

/* ---------------------------------------------------------
   handleFiles — valida y agrega archivos al preview
   --------------------------------------------------------- */
function handleFiles(files) {
  hideStatus();

  const valid = files.filter(f => {
    if (!f.type.startsWith('image/') && !f.type.startsWith('video/')) {
      showError(`"${f.name}" no es una foto o video válido.`);
      return false;
    }
    if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      showError(`"${f.name}" supera los ${MAX_FILE_SIZE_MB} MB permitidos.`);
      return false;
    }
    return true;
  });

  valid.forEach(f => {
    // Evitar duplicados por nombre+tamaño
    const exists = selectedFiles.some(x => x.name === f.name && x.size === f.size);
    if (!exists) selectedFiles.push(f);
  });

  renderPreview();
  syncUploadBtn();
}

/* ---------------------------------------------------------
   renderPreview — muestra miniaturas de archivos elegidos
   --------------------------------------------------------- */
function renderPreview() {
  previewGrid.innerHTML = '';

  if (selectedFiles.length === 0) {
    previewGrid.hidden = true;
    return;
  }

  previewGrid.hidden = false;

  selectedFiles.forEach((file, idx) => {
    const item = document.createElement('div');
    item.className = 'rec-preview__item';

    const url = URL.createObjectURL(file);

    if (file.type.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = file.name;
      item.appendChild(img);
    } else {
      const vid = document.createElement('video');
      vid.src = url;
      vid.muted = true;
      vid.playsInline = true;
      item.appendChild(vid);

      const badge = document.createElement('span');
      badge.className = 'rec-preview__video-badge';
      badge.textContent = 'VIDEO';
      item.appendChild(badge);
    }

    // Botón quitar
    const removeBtn = document.createElement('button');
    removeBtn.className = 'rec-preview__remove';
    removeBtn.innerHTML = '✕';
    removeBtn.setAttribute('aria-label', `Quitar ${file.name}`);
    removeBtn.addEventListener('click', e => {
      e.stopPropagation();
      selectedFiles.splice(idx, 1);
      URL.revokeObjectURL(url);
      renderPreview();
      syncUploadBtn();
    });

    item.appendChild(removeBtn);
    previewGrid.appendChild(item);
  });
}

/* ---------------------------------------------------------
   syncUploadBtn — activa el botón solo si hay archivos
   --------------------------------------------------------- */
function syncUploadBtn() {
  uploadBtn.disabled = selectedFiles.length === 0;
}

/* =========================================================
   SUBIDA — sube archivos uno a uno con progreso
   ========================================================= */
uploadBtn.addEventListener('click', uploadFiles);

async function uploadFiles() {
  if (selectedFiles.length === 0) return;

  hideStatus();
  setUploading(true);

  const guestName = guestNameInput.value.trim() || null;
  const total     = selectedFiles.length;
  let   uploaded  = 0;
  const errors    = [];

  for (const file of selectedFiles) {
    try {
      // 1. Construir ruta única en el bucket
      const ext      = file.name.split('.').pop().toLowerCase();
      const unique   = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const filePath = `${WEDDING_ID}/${unique}.${ext}`;

      // 2. Subir a Supabase Storage
      const { error: uploadError } = await db.storage
        .from(BUCKET_NAME)
        .upload(filePath, file, { cacheControl: '3600', upsert: false });

      if (uploadError) throw uploadError;

      // 3. Obtener URL pública
      const { data: urlData } = db.storage
        .from(BUCKET_NAME)
        .getPublicUrl(filePath);

      const publicUrl = urlData.publicUrl;

      // 4. Guardar metadatos en tabla media
      const { error: dbError } = await db
        .from(TABLE_MEDIA)
        .insert({
          wedding_id:  WEDDING_ID,
          guest_name:  guestName,
          file_name:   file.name,
          file_type:   file.type.startsWith('video/') ? 'video' : 'image',
          url:         publicUrl,
          approved:    true   // auto-aprobado; cambia a false si quieres moderación
        });

      if (dbError) throw dbError;

      uploaded++;
      setProgress(Math.round((uploaded / total) * 100), uploaded, total);

    } catch (err) {
      console.error('Error subiendo', file.name, err);
      errors.push(file.name);
    }
  }

  setUploading(false);

  if (errors.length === 0) {
    // Éxito total
    selectedFiles = [];
    renderPreview();
    syncUploadBtn();
    guestNameInput.value = '';
    showSuccess();
    loadGallery(); // refrescar galería
  } else if (uploaded > 0) {
    // Éxito parcial
    showError(`Se subieron ${uploaded} de ${total}. Fallaron: ${errors.join(', ')}`);
    loadGallery();
  } else {
    showError('No se pudo subir ningún archivo. Intenta de nuevo.');
  }
}

/* ---------------------------------------------------------
   Helpers de UI durante la subida
   --------------------------------------------------------- */
function setUploading(active) {
  uploadBtn.disabled    = active;
  uploadBtn.textContent = active ? 'Subiendo…' : 'Compartir recuerdos';
  progressWrap.hidden   = !active;
  if (!active) {
    progressBar.style.width = '0%';
    progressLabel.textContent = '';
  }
}

function setProgress(pct, done, total) {
  progressBar.style.width    = pct + '%';
  progressLabel.textContent  = `${done} de ${total} archivos`;
}

/* =========================================================
   GALERÍA — últimas fotos subidas
   ========================================================= */
/* ---------------------------------------------------------
   Patrón de tamaños para el mosaico editorial.
   Se repite cada 8 fotos, mezclando horizontales, verticales
   y un destacado grande — evita que se vea como Instagram
   pero mantiene orden visual predecible.
   --------------------------------------------------------- */
const MASONRY_PATTERN = ['big', 'small', 'tall', 'small', 'small', 'wide', 'tall', 'small'];

function loadGallery() {
  galleryLoading.hidden = false;
  galleryEmpty.hidden   = true;
  galleryGrid.innerHTML = '';

  return fetchAndRenderGallery();
}

async function fetchAndRenderGallery() {
  const { data, error } = await db
    .from(TABLE_MEDIA)
    .select('id, url, file_type, guest_name, uploaded_at')
    .eq('wedding_id', WEDDING_ID)
    .eq('approved', true)
    .order('uploaded_at', { ascending: false })
    .limit(GALLERY_LIMIT);

  galleryLoading.hidden = true;

  if (error || !data || data.length === 0) {
    galleryEmpty.hidden = false;
    return;
  }

  data.forEach((item, i) => {
    const el = document.createElement('div');
    el.className = 'rec-gallery__item';
    el.setAttribute('data-size', MASONRY_PATTERN[i % MASONRY_PATTERN.length]);
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `Ver foto de ${item.guest_name || 'invitado'}`);

    if (item.file_type === 'video') {
      const vid = document.createElement('video');
      vid.src        = item.url;
      vid.muted      = true;
      vid.playsInline = true;
      vid.preload    = 'metadata';
      el.appendChild(vid);

      const icon = document.createElement('div');
      icon.className = 'rec-gallery__video-icon';
      icon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
      el.appendChild(icon);
    } else {
      const img = document.createElement('img');
      img.src     = item.url;
      img.alt     = `Foto de ${item.guest_name || 'invitado'}`;
      img.loading = 'lazy';
      el.appendChild(img);
    }

    // Índice tipo negativo de rollo (001, 002...) — refuerza el look de álbum
    const index = document.createElement('span');
    index.className = 'rec-gallery__index';
    index.textContent = String(i + 1).padStart(3, '0');
    el.appendChild(index);

    if (item.guest_name) {
      const author = document.createElement('div');
      author.className   = 'rec-gallery__author';
      author.textContent = item.guest_name;
      el.appendChild(author);
    }

    // Lightbox al hacer clic
    el.addEventListener('click', () => openLightbox(item));
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') openLightbox(item);
    });

    galleryGrid.appendChild(el);
  });
}

/* =========================================================
   LIGHTBOX simple
   ========================================================= */
function openLightbox(item) {
  const lb = document.createElement('div');
  lb.className = 'rec-lightbox';
  lb.setAttribute('role', 'dialog');
  lb.setAttribute('aria-modal', 'true');
  lb.setAttribute('aria-label', 'Ver foto en grande');

  const frame = document.createElement('div');
  frame.className = 'rec-lightbox__frame';

  if (item.file_type === 'video') {
    const vid = document.createElement('video');
    vid.src      = item.url;
    vid.controls = true;
    vid.autoplay = true;
    vid.playsInline = true;
    frame.appendChild(vid);
  } else {
    const img = document.createElement('img');
    img.src = item.url;
    img.alt = `Foto de ${item.guest_name || 'invitado'}`;
    frame.appendChild(img);
  }

  if (item.guest_name) {
    const caption = document.createElement('p');
    caption.className = 'rec-lightbox__caption';
    caption.textContent = item.guest_name;
    frame.appendChild(caption);
  }

  lb.appendChild(frame);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'rec-lightbox__close';
  closeBtn.innerHTML = '✕';
  closeBtn.setAttribute('aria-label', 'Cerrar');
  lb.appendChild(closeBtn);

  const close = () => {
    lb.remove();
    document.removeEventListener('keydown', escListener);
  };

  const escListener = e => { if (e.key === 'Escape') close(); };

  closeBtn.addEventListener('click', close);
  lb.addEventListener('click', e => { if (e.target === lb) close(); });
  document.addEventListener('keydown', escListener);

  document.body.appendChild(lb);
  closeBtn.focus();
}

/* =========================================================
   Helpers de mensajes de estado
   ========================================================= */
function showSuccess() {
  statusOk.hidden  = false;
  statusErr.hidden = true;
}

function showError(msg) {
  statusErr.textContent = msg;
  statusErr.hidden  = false;
  statusOk.hidden   = true;
}

function hideStatus() {
  statusOk.hidden  = true;
  statusErr.hidden = true;
}

/* =========================================================
   INIT
   ========================================================= */
loadGallery();