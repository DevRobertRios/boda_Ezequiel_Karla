/* =========================================================
   RECUERDOS v6
   - Fotos:  thumbnail generado en canvas ANTES de subir
             → cero transformaciones Cloudinary, cero créditos extra
   - Videos: SIN canvas. Se sube el video normal y el thumbnail se
             pide por URL (transformación on-the-fly, so_auto).
             Cloudinary la genera la primera vez que se pide y la
             cachea. Evita por completo los problemas de iOS/Android
             con extracción de frames de video en el navegador.
   - Cloudinary: /originales/ para el archivo real,
                 /thumbnails/ solo para el thumb 400×400 de fotos
   - Supabase:   guarda url (original) + url_thumb
   - Límites:    10 MB fotos · 40 MB videos
   - IMPORTANTE: uploads unsigned NO admiten el parámetro 'eager' —
     Cloudinary lo rechaza con 400. Nunca agregarlo a subirACloudinary.
   ========================================================= */
(function () {

  /* =========================================================
     CONFIGURACIÓN
     ========================================================= */
  const CLOUDINARY_CLOUD            = 'kllozhil';
  const CLOUDINARY_PRESET_ORIGINALES = 'boda-ek2026-originales'; // preset con Asset folder: bodas/EK2026/originales
  const CLOUDINARY_PRESET_THUMBNAILS = 'boda-ek2026-thumbnails'; // preset con Asset folder: bodas/EK2026/thumbnails

  const SUPABASE_URL       = 'https://nvkuqndqlfdxkvuhlwcy.supabase.co';
  const SUPABASE_ANON_KEY  = 'sb_publishable_8SX6IrG_3JGb-vIv3_ooXw_fMnrCRsy';
  const TABLE_MEDIA        = 'media';
  const WEDDING_ID         = 'EK2026';

  const GALLERY_LIMIT      = 15;

  // Límites de tamaño
  const MAX_IMG_MB         = 10;   // fotos
  const MAX_VID_MB         = 40;   // videos

  // Thumbnail: cuadrado de este tamaño (px), calidad 0-1
  const THUMB_SIZE         = 400;
  const THUMB_QUALITY      = 0.82; // webp/jpeg

  /* =========================================================
     SUPABASE
     ========================================================= */
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  /* =========================================================
     DOM REFS
     ========================================================= */
  const guestNameInput = document.getElementById('guest-name');
  const dropzone       = document.getElementById('dropzone');
  const fileInput      = document.getElementById('file-input');
  const uploadQueue    = document.getElementById('upload-queue');
  const uploadBtn      = document.getElementById('upload-btn');
  const statusOk       = document.getElementById('status-ok');
  const statusErr      = document.getElementById('status-err');
  const galleryGrid    = document.getElementById('gallery-grid');
  const galleryEmpty   = document.getElementById('gallery-empty');
  const galleryLoading = document.getElementById('gallery-loading');

  /* =========================================================
     ESTADO
     ========================================================= */
  let selectedFiles = []; // { file, previewUrl, el }

  /* =========================================================
     GENERACIÓN DE THUMBNAILS EN CANVAS
     ========================================================= */

  // Pausa entre archivos para que iOS libere FileReader y memoria de canvas
  function esperar(ms) { return new Promise(res => setTimeout(res, ms)); }

  // Detección de tipo robusta: algunos navegadores Android/iOS (sobre todo
  // al compartir desde otra app o file managers) entregan file.type vacío.
  // Si no hay MIME type, caemos a revisar la extensión del nombre.
  const EXT_VIDEO = ['mp4', 'mov', 'm4v', 'webm', '3gp', '3gpp', 'avi', 'mkv'];
  const EXT_IMG   = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp'];

  function extDe(nombre) {
    const m = /\.([a-z0-9]+)$/i.exec(nombre || '');
    return m ? m[1].toLowerCase() : '';
  }
  function esVideo(file) {
    if (file.type) return file.type.startsWith('video/');
    return EXT_VIDEO.includes(extDe(file.name));
  }
  function esImagen(file) {
    if (file.type) return file.type.startsWith('image/');
    return EXT_IMG.includes(extDe(file.name));
  }

  // Genera thumbnail cuadrado — usa FileReader directo (más confiable en iOS)
  function imagenAThumb(file) {
    return new Promise((resolve) => {
      const reader  = new FileReader();
      let   settled = false;

      const timer = setTimeout(() => {
        if (!settled) { settled = true; resolve(thumbFallbackImagen()); }
      }, 20000);

      reader.onload = (e) => {
        if (settled) return;
        const img = new Image();

        img.onload = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = THUMB_SIZE;
            const ctx = canvas.getContext('2d');
            const ratio = Math.max(THUMB_SIZE / img.naturalWidth, THUMB_SIZE / img.naturalHeight);
            const w = img.naturalWidth  * ratio;
            const h = img.naturalHeight * ratio;
            ctx.drawImage(img, (THUMB_SIZE - w) / 2, (THUMB_SIZE - h) / 2, w, h);
            canvas.toBlob(
              blob => resolve(blob && blob.size > 500 ? blob : thumbFallbackImagen()),
              'image/jpeg', THUMB_QUALITY
            );
          } catch (_) { resolve(thumbFallbackImagen()); }
        };

        img.onerror = () => {
          if (!settled) { settled = true; clearTimeout(timer); resolve(thumbFallbackImagen()); }
        };
        img.src = e.target.result;
      };

      reader.onerror = () => {
        if (!settled) { settled = true; clearTimeout(timer); resolve(thumbFallbackImagen()); }
      };

      reader.readAsDataURL(file);
    });
  }

  // Thumb genérico para imágenes — fondo crema con icono de cámara
  function thumbFallbackImagen() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = THUMB_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#EDE6D9';
    ctx.fillRect(0, 0, THUMB_SIZE, THUMB_SIZE);
    ctx.strokeStyle = 'rgba(94,26,46,0.35)';
    ctx.lineWidth = 5;
    const m = 60;
    ctx.strokeRect(m, m, THUMB_SIZE - m * 2, THUMB_SIZE - m * 2);
    ctx.beginPath();
    ctx.arc(THUMB_SIZE / 2, THUMB_SIZE / 2, 38, 0, Math.PI * 2);
    ctx.stroke();
    return new Promise(res => canvas.toBlob(b => res(b || new Blob()), 'image/jpeg', 0.8));
  }

  // Thumb genérico para videos — fondo borgoña con ícono de play
  function thumbFallback() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = THUMB_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#3D0F1C';
    ctx.fillRect(0, 0, THUMB_SIZE, THUMB_SIZE);
    ctx.fillStyle = 'rgba(201,169,110,0.75)';
    ctx.beginPath();
    ctx.arc(THUMB_SIZE / 2, THUMB_SIZE / 2, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FAF0E8';
    ctx.beginPath();
    ctx.moveTo(THUMB_SIZE / 2 - 16, THUMB_SIZE / 2 - 22);
    ctx.lineTo(THUMB_SIZE / 2 + 26, THUMB_SIZE / 2);
    ctx.lineTo(THUMB_SIZE / 2 - 16, THUMB_SIZE / 2 + 22);
    ctx.closePath();
    ctx.fill();
    return new Promise(res => canvas.toBlob(b => res(b), 'image/jpeg', 0.85));
  }

  // NOTA: los thumbnails de video ya NO se generan en el cliente (canvas).
  // Ver cloudinaryVideoThumbUrl() más abajo — Cloudinary genera el frame
  // on-the-fly a partir de la URL del video ya subido, sin canvas ni
  // problemas de iOS/Android con extracción de frames.

  // preset: CLOUDINARY_PRESET_ORIGINALES o CLOUDINARY_PRESET_THUMBNAILS
  // El Asset folder ya está definido en cada preset en Cloudinary —
  // no necesitamos pasar 'folder' en el FormData.
  function subirACloudinary(fileOrBlob, preset, onProgress) {
    return new Promise((resolve, reject) => {
      const url      = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/auto/upload`;
      const formData = new FormData();

      // Si es Blob (thumb generado en canvas), le ponemos nombre explícito
      if (fileOrBlob instanceof Blob && !(fileOrBlob instanceof File)) {
        formData.append('file', fileOrBlob, `thumb_${Date.now()}.jpg`);
      } else {
        formData.append('file', fileOrBlob);
      }

      formData.append('upload_preset', preset);
      // No pasamos 'folder' — cada preset ya tiene su carpeta configurada en Cloudinary.
      // IMPORTANTE: NO se puede mandar 'eager'/'eager_async' aquí — Cloudinary solo
      // permite un set limitado de parámetros en uploads unsigned (upload_preset,
      // public_id, folder, tags, context, metadata, source, filename_override, etc).
      // 'eager' no está en esa lista y provoca un 400 Bad Request inmediato.
      // El thumbnail de video se genera después por URL (ver cloudinaryVideoThumbUrl),
      // no como parte del upload.

      const xhr = new XMLHttpRequest();

      if (onProgress) {
        xhr.upload.addEventListener('progress', e => {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        });
      }

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          // Cloudinary manda el motivo real en el body (ej: "File size too
          // large", "eager parameter is not allowed when using unsigned
          // upload", etc). Lo sacamos a la luz en vez de perderlo.
          let motivo = xhr.responseText;
          try { motivo = JSON.parse(xhr.responseText)?.error?.message || motivo; } catch (_) {}
          console.error('[cloudinary] respuesta de error:', xhr.status, motivo);
          reject(new Error(`Cloudinary ${xhr.status}: ${motivo}`));
        }
      });

      xhr.addEventListener('error', () => reject(new Error('Error de red — revisa tu conexión')));
      xhr.addEventListener('timeout', () => reject(new Error('Tiempo de espera agotado subiendo el archivo')));
      xhr.timeout = 120000; // 2 min — redes móviles lentas con archivos de hasta 40MB
      xhr.open('POST', url);
      xhr.send(formData);
    });
  }

  // Construye la URL del thumbnail de un video a partir de su secure_url.
  // Cloudinary genera thumbnails de video "al vuelo": basta con insertar una
  // transformación y cambiar la extensión final a un formato de imagen.
  // so_auto = Cloudinary elige automáticamente el mejor frame (evita negros/
  // créditos iniciales) — funciona igual de bien en videos de 1s que de 60s,
  // a diferencia de un offset fijo como so_2 que puede fallar en clips cortos.
  function cloudinaryVideoThumbUrl(secureUrl) {
    return secureUrl
      .replace('/upload/', '/upload/c_fill,w_400,h_400,so_auto,q_auto/')
      .replace(/\.[a-zA-Z0-9]+$/, '.jpg');
  }

  /* =========================================================
     DRAG & DROP / SELECCIÓN
     ========================================================= */
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') fileInput.click();
  });
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
  fileInput.addEventListener('change', () => {
    handleFiles([...fileInput.files]);
    fileInput.value = '';
  });

  /* =========================================================
     VALIDACIÓN Y COLA VISUAL
     ========================================================= */
  function handleFiles(files) {
    hideStatus();

    files.forEach(file => {
      const isVideo = esVideo(file);
      const isImage = esImagen(file);

      if (!isImage && !isVideo) {
        showError(`"${file.name}" no es una foto o video válido.`);
        return;
      }

      const limitMB = isVideo ? MAX_VID_MB : MAX_IMG_MB;
      const sizeMB  = file.size / (1024 * 1024);

      if (sizeMB > limitMB) {
        showError(
          isVideo
            ? `"${file.name}" supera los ${MAX_VID_MB} MB permitidos para videos.`
            : `"${file.name}" supera los ${MAX_IMG_MB} MB permitidos para fotos.`
        );
        return;
      }

      const already = selectedFiles.some(x => x.file.name === file.name && x.file.size === file.size);
      if (already) return;

      const previewUrl = URL.createObjectURL(file);
      const el         = buildQueueItem(file, previewUrl);
      selectedFiles.push({ file, previewUrl, el });
      uploadQueue.appendChild(el);
    });

    uploadQueue.hidden = selectedFiles.length === 0;
    syncUploadBtn();
  }

  /* ---------------------------------------------------------
     Tarjeta individual en la cola de subida
     --------------------------------------------------------- */
  function buildQueueItem(file, previewUrl) {
    const isVideo = esVideo(file);

    const item = document.createElement('div');
    item.className = 'rec-queue__item';

    // Miniatura
    const thumb = document.createElement('div');
    thumb.className = 'rec-queue__thumb';
    if (isVideo) {
      const vid = document.createElement('video');
      vid.src = previewUrl; vid.muted = true; vid.playsInline = true; vid.preload = 'metadata';
      thumb.appendChild(vid);
      const badge = document.createElement('span');
      badge.className = 'rec-queue__type-badge';
      badge.textContent = 'VIDEO';
      thumb.appendChild(badge);
    } else {
      const img = document.createElement('img');
      img.src = previewUrl; img.alt = file.name;
      thumb.appendChild(img);
    }

    // Info + progreso
    const info = document.createElement('div');
    info.className = 'rec-queue__info';

    const name = document.createElement('p');
    name.className   = 'rec-queue__name';
    name.textContent = file.name.length > 28 ? file.name.slice(0, 25) + '…' : file.name;

    const size = document.createElement('p');
    size.className   = 'rec-queue__size';
    size.textContent = formatBytes(file.size);

    const track = document.createElement('div');
    track.className = 'rec-queue__track';
    const bar = document.createElement('div');
    bar.className = 'rec-queue__bar';
    track.appendChild(bar);

    const pct = document.createElement('span');
    pct.className   = 'rec-queue__pct';
    pct.textContent = '';

    info.appendChild(name);
    info.appendChild(size);
    info.appendChild(track);
    info.appendChild(pct);

    // Botón quitar
    const removeBtn = document.createElement('button');
    removeBtn.className = 'rec-queue__remove';
    removeBtn.innerHTML = '✕';
    removeBtn.setAttribute('aria-label', `Quitar ${file.name}`);
    removeBtn.addEventListener('click', e => {
      e.stopPropagation();
      const i = selectedFiles.findIndex(x => x.el === item);
      if (i !== -1) {
        URL.revokeObjectURL(selectedFiles[i].previewUrl);
        selectedFiles.splice(i, 1);
      }
      item.remove();
      if (selectedFiles.length === 0) uploadQueue.hidden = true;
      syncUploadBtn();
    });

    item.appendChild(thumb);
    item.appendChild(info);
    item.appendChild(removeBtn);

    item._bar       = bar;
    item._pct       = pct;
    item._removeBtn = removeBtn;

    return item;
  }

  function syncUploadBtn() {
    uploadBtn.disabled = selectedFiles.length === 0;
  }

  /* =========================================================
     SUBIDA COMPLETA
     ========================================================= */
  uploadBtn.addEventListener('click', uploadAll);

  async function uploadAll() {
    if (selectedFiles.length === 0) return;
    hideStatus();

    uploadBtn.disabled    = true;
    uploadBtn.textContent = 'Subiendo…';

    selectedFiles.forEach(({ el }) => {
      if (el._removeBtn) el._removeBtn.hidden = true;
    });

    const guestName = guestNameInput.value.trim() || null;
    let uploaded    = 0;
    const errors    = [];

    // Procesamos 1 archivo a la vez en móvil para no agotar memoria del canvas.
    // Con 14 archivos simultáneos el navegador abre 14 ObjectURLs a la vez
    // y el canvas falla silenciosamente en iOS/Android.
    for (const entry of [...selectedFiles]) {
      const { file, el } = entry;
      const isVideo = esVideo(file);

      try {
        setItemState(el, 'uploading', 0);

        // Pausa de 300ms entre archivos — le da tiempo a iOS de liberar
        // el FileReader anterior antes de iniciar el siguiente
        await esperar(300);

        setItemPctLabel(el, 'Preparando…');

        if (isVideo) {
          // ── VIDEO ──
          // El canvas en móvil es poco confiable para capturar frames (frames
          // negros, restricciones de autoplay en iOS). Solución: subimos el
          // video normal (sin eager — no está permitido en uploads unsigned)
          // y construimos la URL del thumbnail después, por transformación
          // on-the-fly. Cloudinary la genera la primera vez que alguien la
          // pide y la cachea — no cuesta nada en el momento de subir.
          setItemPctLabel(el, 'Subiendo video…');
          const videoResult = await subirACloudinary(
            file,
            CLOUDINARY_PRESET_ORIGINALES,
            pct => setItemState(el, 'uploading', pct)
          );

          const thumbUrl = cloudinaryVideoThumbUrl(videoResult.secure_url);

          const { error } = await db.from(TABLE_MEDIA).insert({
            wedding_id:  WEDDING_ID,
            guest_name:  guestName,
            file_name:   file.name,
            file_type:   'video',
            url:         videoResult.secure_url,
            url_thumb:   thumbUrl,
            public_id:   videoResult.public_id,
            approved:    true,
          });

          if (error) throw error;

        } else {
          // ── FOTO ──
          // Canvas es confiable para imágenes — cero transformaciones Cloudinary.
          const thumbBlob = await imagenAThumb(file);

          setItemPctLabel(el, 'Subiendo…');
          const thumbResult = await subirACloudinary(
            thumbBlob, CLOUDINARY_PRESET_THUMBNAILS, null
          );
          const originalResult = await subirACloudinary(
            file,
            CLOUDINARY_PRESET_ORIGINALES,
            pct => setItemState(el, 'uploading', pct)
          );

          const { error } = await db.from(TABLE_MEDIA).insert({
            wedding_id:  WEDDING_ID,
            guest_name:  guestName,
            file_name:   file.name,
            file_type:   'image',
            url:         originalResult.secure_url,
            url_thumb:   thumbResult.secure_url,
            public_id:   originalResult.public_id,
            approved:    true,
          });

          if (error) throw error;
        }

        setItemState(el, 'done');
        uploaded++;

        // Liberar memoria antes del siguiente archivo
        if (entry.previewUrl) { URL.revokeObjectURL(entry.previewUrl); entry.previewUrl = null; }

      } catch (err) {
        console.error('[recuerdos] error en', file.name, err);
        setItemState(el, 'error');
        if (el._pct) el._pct.title = err.message || 'Error desconocido';
        errors.push(file.name);
      }
    }

    uploadBtn.textContent = 'Compartir recuerdos';

    if (errors.length === 0) {
      selectedFiles.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl));
      selectedFiles = [];
      guestNameInput.value = '';
      showSuccess();
      setTimeout(() => {
        uploadQueue.innerHTML = '';
        uploadQueue.hidden    = true;
        uploadBtn.disabled    = true;
      }, 2500);
      loadGallery();
    } else if (uploaded > 0) {
      showError(`Subidas ${uploaded} de ${selectedFiles.length}. Fallaron: ${errors.join(', ')}`);
      uploadBtn.disabled = false;
      selectedFiles.forEach(({ el }) => {
        if (el._removeBtn) el._removeBtn.hidden = false;
      });
    } else {
      showError('No se pudo subir ningún archivo. Revisa tu conexión.');
      uploadBtn.disabled = false;
      selectedFiles.forEach(({ el }) => {
        if (el._removeBtn) el._removeBtn.hidden = false;
      });
    }
  }

  /* ---------------------------------------------------------
     Estado visual de cada tarjeta en la cola
     --------------------------------------------------------- */
  function setItemState(el, state, pct = 0) {
    el.dataset.state = state;
    const bar   = el._bar;
    const pctEl = el._pct;

    if (state === 'uploading') {
      bar.style.width   = pct + '%';
      pctEl.textContent = pct + '%';
      pctEl.className   = 'rec-queue__pct';
    } else if (state === 'done') {
      bar.style.width   = '100%';
      pctEl.textContent = '✓';
      pctEl.className   = 'rec-queue__pct rec-queue__pct--done';
      el.classList.add('is-done');
    } else if (state === 'error') {
      pctEl.textContent = '✗';
      pctEl.className   = 'rec-queue__pct rec-queue__pct--error';
      el.classList.add('is-error');
    }
  }

  function setItemPctLabel(el, label) {
    if (el._pct) el._pct.textContent = label;
  }

  /* =========================================================
     GALERÍA — usa url_thumb guardada en Supabase
     ========================================================= */
  const MASONRY_PATTERN = ['big', 'small', 'tall', 'small', 'small', 'wide', 'tall', 'small'];

  async function loadGallery() {
    galleryLoading.hidden = false;
    galleryEmpty.hidden   = true;
    galleryGrid.innerHTML = '';

    const { data, error } = await db
      .from(TABLE_MEDIA)
      .select('id, url, url_thumb, file_type, guest_name, uploaded_at')
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
      el.className      = 'rec-gallery__item';
      el.dataset.size   = MASONRY_PATTERN[i % MASONRY_PATTERN.length];
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `Ver foto de ${item.guest_name || 'invitado'}`);

      // Siempre una imagen como thumb (incluso para video)
      const img     = document.createElement('img');
      img.src       = item.url_thumb || item.url; // url_thumb viene de canvas, ya es pequeña
      img.alt       = `Recuerdo de ${item.guest_name || 'la boda'}`;
      img.loading   = 'lazy';
      el.appendChild(img);

      if (item.file_type === 'video') {
        const icon = document.createElement('div');
        icon.className = 'rec-gallery__video-icon';
        icon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
        el.appendChild(icon);
      }

      const index       = document.createElement('span');
      index.className   = 'rec-gallery__index';
      index.textContent = String(i + 1).padStart(3, '0');
      el.appendChild(index);

      if (item.guest_name) {
        const author       = document.createElement('div');
        author.className   = 'rec-gallery__author';
        author.textContent = item.guest_name;
        el.appendChild(author);
      }

      el.addEventListener('click', () => openLightbox(item));
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') openLightbox(item);
      });

      galleryGrid.appendChild(el);
    });
  }

  /* =========================================================
     LIGHTBOX
     ========================================================= */
  function openLightbox(item) {
    const lb = document.createElement('div');
    lb.className = 'rec-lightbox';
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');

    const frame = document.createElement('div');
    frame.className = 'rec-lightbox__frame';

    if (item.file_type === 'video') {
      const vid = document.createElement('video');
      vid.src        = item.url;
      vid.controls   = true;
      vid.autoplay   = true;
      vid.playsInline = true;
      frame.appendChild(vid);
    } else {
      const img = document.createElement('img');
      img.src = item.url;
      img.alt = `Foto de ${item.guest_name || 'invitado'}`;
      frame.appendChild(img);
    }

    if (item.guest_name) {
      const caption       = document.createElement('p');
      caption.className   = 'rec-lightbox__caption';
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
     PRECARGA DEL NOMBRE DESDE ?ref=
     ========================================================= */
  async function preloadGuestName() {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (!ref) return;
    try {
      const { data, error } = await db
        .from('invitados')
        .select('nombre_mostrar')
        .ilike('codigo', ref.trim())
        .maybeSingle();
      if (!error && data?.nombre_mostrar) {
        guestNameInput.value = data.nombre_mostrar;
        guestNameInput.setAttribute('readonly', 'readonly');
        guestNameInput.title  = 'Nombre tomado de tu invitación';
        guestNameInput.style.opacity = '0.75';
        guestNameInput.style.cursor  = 'default';
      }
    } catch (_) { /* silencioso */ }
  }

  /* =========================================================
     UTILIDADES
     ========================================================= */
  function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function showSuccess() { statusOk.hidden = false; statusErr.hidden = true; }
  function showError(msg) { statusErr.textContent = msg; statusErr.hidden = false; statusOk.hidden = true; }
  function hideStatus()   { statusOk.hidden = true; statusErr.hidden = true; }

  /* =========================================================
     INIT
     ========================================================= */
  preloadGuestName();
  loadGallery();

})();