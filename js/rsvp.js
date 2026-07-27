/* =========================================================
   RSVP PERSONALIZADO — Lectura de código, saludo dinámico,
   confirmación individual por integrante y envío a Supabase
   ========================================================= */
(function () {

  /* =========================================================
     ⚠️ CONFIGURACIÓN SUPABASE
     Reemplaza estos valores con los de tu proyecto:
     Project Settings → API → Project URL / anon public key
     ========================================================= */
  const SUPABASE_URL = 'https://nvkuqndqlfdxkvuhlwcy.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_8SX6IrG_3JGb-vIv3_ooXw_fMnrCRsy';
  const TABLE_INVITADOS = 'invitados';
  const TABLE_MIEMBROS = 'miembros';

  // --- Referencias a los bloques de la sección RSVP ---
  const loadingEl   = document.querySelector('.rsvp-loading');
  const notFoundEl  = document.querySelector('.rsvp-not-found');
  const greetingEl  = document.querySelector('.rsvp-greeting');
  const form        = document.querySelector('#rsvp-form');

  if (!form) return; // si la sección RSVP no existe en esta página, no hacer nada

  const nombreEl     = document.querySelector('[data-rsvp-nombre]');
  const pasesEl      = document.querySelector('[data-rsvp-pases]');
  const miembrosList = document.querySelector('#miembros-list');
  const errorEl      = document.querySelector('.rsvp-error');
  const successEl    = document.querySelector('.rsvp-success');
  const submitBtn    = form.querySelector('.rsvp-submit');

  // Guarda el registro del invitado + sus miembros ya validados
  let invitadoActual = null;
  let miembrosActuales = [];

  /* ---------------------------------------------------------
     Helpers de estado visual
     --------------------------------------------------------- */
  function showOnly(target) {
    [loadingEl, notFoundEl].forEach((el) => el && el.classList.remove('is-visible'));
    if (target) target.classList.add('is-visible');
  }

  function showError(message) {
    errorEl.textContent = message;
    errorEl.classList.add('is-visible');
  }

  function clearError() {
    errorEl.classList.remove('is-visible');
    errorEl.textContent = '';
  }

  function setLoading(isLoading) {
    submitBtn.disabled = isLoading;
    submitBtn.textContent = isLoading ? 'Enviando...' : 'Confirmar Asistencia';
  }

  function launchConfetti() {
    const colors = ['#B8966A', '#8C6A3F', '#F2EAE0', '#FFFFFF'];
    const pieces = 60;

    for (let i = 0; i < pieces; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';

      const size = 6 + Math.random() * 6;
      const left = Math.random() * 100;
      const duration = 2.5 + Math.random() * 2;
      const delay = Math.random() * 0.6;
      const color = colors[Math.floor(Math.random() * colors.length)];
      const rotation = Math.random() * 360;

      piece.style.left = `${left}vw`;
      piece.style.width = `${size}px`;
      piece.style.height = `${size * 0.4}px`;
      piece.style.background = color;
      piece.style.transform = `rotate(${rotation}deg)`;
      piece.style.animation = `confetti-fall ${duration}s ease-in ${delay}s forwards`;

      document.body.appendChild(piece);

      setTimeout(() => piece.remove(), (duration + delay) * 1000 + 200);
    }
  }

  // Keyframes de confetti inyectados dinámicamente (mantiene CSS principal limpio)
  if (!document.querySelector('#confetti-keyframes')) {
    const style = document.createElement('style');
    style.id = 'confetti-keyframes';
    style.textContent = `
      @keyframes confetti-fall {
        0% { transform: translateY(0) rotate(0deg); opacity: 1; }
        100% { transform: translateY(100vh) rotate(540deg); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  /* ---------------------------------------------------------
     PASO 1 — Leer el código de invitado desde la URL
     Formato esperado: tusitio.com/?inv=garcia24
     --------------------------------------------------------- */
  function obtenerCodigoDeURL() {
    const params = new URLSearchParams(window.location.search);
    const codigo = params.get('inv');
    if (!codigo) return null;
    // No forzamos minúsculas: usamos ilike en la búsqueda, que ya es
    // insensible a mayúsculas. Sí escapamos % y _ (comodines de ilike)
    // por si alguien los pega sin querer al copiar el link.
    return codigo.trim().replace(/[%_]/g, '');
  }

  /* ---------------------------------------------------------
     PASO 2 — Buscar al invitado y a sus miembros en Supabase
     --------------------------------------------------------- */
  async function buscarInvitado(codigo) {
    // Usamos ilike (insensible a mayúsculas/minúsculas) en vez de eq,
    // así da igual si el código se copió/escribió distinto a como se
    // generó originalmente — sigue encontrando la fila correcta.
    const url = `${SUPABASE_URL}/rest/v1/${TABLE_INVITADOS}?codigo=ilike.${encodeURIComponent(codigo)}&select=*`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (!response.ok) {
      throw new Error('No se pudo validar la invitación');
    }

    const rows = await response.json();
    return rows.length > 0 ? rows[0] : null;
  }

  async function buscarMiembros(codigo) {
    const url = `${SUPABASE_URL}/rest/v1/${TABLE_MIEMBROS}?codigo=eq.${encodeURIComponent(codigo)}&select=id,nombre,asiste,orden&order=orden.asc`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (!response.ok) {
      throw new Error('No se pudo cargar la lista de integrantes');
    }

    return response.json();
  }

  /* ---------------------------------------------------------
     PASO 3 — Pintar el saludo y la lista de integrantes
     Cada integrante tiene su propio checkbox (marcado por
     defecto = asistirá, a menos que ya haya respondido antes)
     --------------------------------------------------------- */
  function pintarSaludo(invitado, miembros) {
    nombreEl.textContent = invitado.nombre_mostrar;

    const total = miembros.length;
    pasesEl.textContent = total === 1
      ? 'Tienen 1 lugar reservado'
      : `Tienen ${total} lugares reservados`;

    miembrosList.innerHTML = miembros.map((m) => {
      // Si ya había respondido antes, respeta su respuesta anterior.
      // Si nunca ha respondido (asiste === null), lo dejamos marcado
      // por defecto (lo más común es que confirmen a todos).
      const checked = m.asiste === false ? '' : 'checked';
      return `
        <label class="miembro-item">
          <input type="checkbox" name="miembro" value="${m.id}" ${checked}>
          <span class="miembro-item__check" aria-hidden="true"></span>
          <span class="miembro-item__nombre">${escapeHtml(m.nombre)}</span>
        </label>
      `;
    }).join('');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  }

  /* ---------------------------------------------------------
     Validación antes de enviar
     --------------------------------------------------------- */
  function validate() {
    if (!miembrosActuales || miembrosActuales.length === 0) {
      return 'No encontramos integrantes para esta invitación.';
    }
    return null;
  }

  /* ---------------------------------------------------------
     PASO 4 — Enviar la confirmación
     1) Marca asiste=true en los miembros con check
     2) Marca asiste=false en los miembros sin check
     3) Deja constancia en "rsvp" (para las métricas del admin)
     --------------------------------------------------------- */
  async function patchMiembros(ids, asiste) {
    if (ids.length === 0) return;
    const filtro = ids.map(encodeURIComponent).join(',');
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE_MIEMBROS}?id=in.(${filtro})`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ asiste }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(errText || 'Error al guardar la confirmación');
    }
  }

  async function marcarRespondido(codigo) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE_INVITADOS}?codigo=eq.${encodeURIComponent(codigo)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ respondido_at: new Date().toISOString() }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(errText || 'Error al guardar la confirmación');
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();

    const formData = new FormData(form);

    // Honeypot: si este campo oculto viene lleno, es un bot — abortamos en silencio
    if (formData.get('website')) {
      return;
    }

    const validationError = validate();
    if (validationError) {
      showError(validationError);
      return;
    }

    const idsMarcados = formData.getAll('miembro');
    const idsSet = new Set(idsMarcados);
    const idsNoMarcados = miembrosActuales
      .map((m) => m.id)
      .filter((id) => !idsSet.has(id));

    setLoading(true);

    try {
      await Promise.all([
        patchMiembros(idsMarcados, true),
        patchMiembros(idsNoMarcados, false),
      ]);
      await marcarRespondido(invitadoActual.codigo);

      form.classList.remove('is-visible');
      greetingEl.classList.remove('is-visible');
      successEl.classList.add('is-visible');
      if (idsMarcados.length > 0) launchConfetti();
    } catch (err) {
      console.error('RSVP error:', err);
      showError('Hubo un problema al enviar tu confirmación. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  });

  /* ---------------------------------------------------------
     INICIALIZACIÓN — corre apenas carga la página
     --------------------------------------------------------- */
  async function init() {
    showOnly(loadingEl);

    const codigo = obtenerCodigoDeURL();

    if (!codigo) {
      showOnly(notFoundEl);
      return;
    }

    try {
      const invitado = await buscarInvitado(codigo);

      if (!invitado) {
        showOnly(notFoundEl);
        return;
      }

      const miembros = await buscarMiembros(invitado.codigo);

      invitadoActual = invitado;
      miembrosActuales = miembros;
      pintarSaludo(invitado, miembros);

      showOnly(null); // oculta loading y not-found
      greetingEl.classList.add('is-visible');
      form.classList.add('is-visible');
    } catch (err) {
      console.error('Error validando invitación:', err);
      showOnly(notFoundEl);
    }
  }

  init();
})();