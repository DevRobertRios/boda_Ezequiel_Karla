/* =========================================================
   RSVP PERSONALIZADO — Lectura de código, saludo dinámico,
   límite de pases y envío a Supabase (upsert por código)
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
  const TABLE_RSVP = 'rsvp';

  // --- Referencias a los 4 bloques de la sección RSVP ---
  const loadingEl   = document.querySelector('.rsvp-loading');
  const notFoundEl  = document.querySelector('.rsvp-not-found');
  const greetingEl  = document.querySelector('.rsvp-greeting');
  const form        = document.querySelector('#rsvp-form');

  if (!form) return; // si la sección RSVP no existe en esta página, no hacer nada

  const nombreEl    = document.querySelector('[data-rsvp-nombre]');
  const pasesEl     = document.querySelector('[data-rsvp-pases]');
  const numSelectEl = document.querySelector('#num_personas');
  const errorEl     = document.querySelector('.rsvp-error');
  const successEl   = document.querySelector('.rsvp-success');
  const submitBtn   = form.querySelector('.rsvp-submit');

  // Guarda el registro del invitado ya validado, para usarlo al enviar
  let invitadoActual = null;

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
     PASO 2 — Buscar al invitado en Supabase por su código
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

  /* ---------------------------------------------------------
     PASO 3 — Pintar el saludo y armar el selector de personas
     limitado al número de pases_asignados del invitado
     --------------------------------------------------------- */
  function pintarSaludo(invitado) {
    nombreEl.textContent = invitado.nombre_mostrar;

    const pases = invitado.pases_asignados;
    pasesEl.textContent = pases === 1
      ? 'Tienes 1 lugar reservado'
      : `Tienen ${pases} lugares reservados`;

    // Reconstruir el <select> de 1 hasta el máximo de pases asignados
    numSelectEl.innerHTML = '';
    for (let i = 1; i <= pases; i++) {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = i === 1 ? '1 persona' : `${i} personas`;
      numSelectEl.appendChild(option);
    }
    // Por defecto, selecciona el máximo de pases (lo más común: confirman todos)
    numSelectEl.value = String(pases);
  }

  /* ---------------------------------------------------------
     PASO 4 — Mostrar/ocultar el selector de personas según
     si la familia dijo que sí va a asistir o no
     --------------------------------------------------------- */
  const numPersonasGroup = document.querySelector('#num-personas-group');
  form.addEventListener('change', (e) => {
    if (e.target.name === 'asiste') {
      const asiste = e.target.value === 'si';
      numPersonasGroup.style.display = asiste ? '' : 'none';
    }
  });

  /* ---------------------------------------------------------
     Validación antes de enviar
     --------------------------------------------------------- */
  function validate(data) {
    if (!data.asiste) {
      return 'Indícanos si podrás acompañarnos.';
    }
    if (data.asiste === 'si' && (!data.num_personas || Number(data.num_personas) < 1)) {
      return 'Indícanos cuántas personas asistirán.';
    }
    if (data.asiste === 'si' && invitadoActual && Number(data.num_personas) > invitadoActual.pases_asignados) {
      return `Solo cuentan con ${invitadoActual.pases_asignados} lugares asignados.`;
    }
    return null;
  }

  /* ---------------------------------------------------------
     PASO 5 — Enviar la confirmación a la tabla rsvp
     Usamos upsert (Prefer: resolution=merge-duplicates) para que,
     si la familia confirma dos veces, se actualice su misma fila
     en vez de crear un duplicado — la tabla rsvp tiene
     codigo UNIQUE en el setup.sql, así que esto encaja directo.
     --------------------------------------------------------- */
  async function enviarRSVP(payload) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE_RSVP}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(payload),
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
    const data = Object.fromEntries(formData.entries());

    // Honeypot: si este campo oculto viene lleno, es un bot — abortamos en silencio
    if (data.website) {
      return;
    }

    const validationError = validate(data);
    if (validationError) {
      showError(validationError);
      return;
    }

    const payload = {
      codigo: invitadoActual.codigo,
      asiste: data.asiste === 'si',
      num_personas_confirmadas: data.asiste === 'si' ? Number(data.num_personas) : 0,
    };

    setLoading(true);

    try {
      await enviarRSVP(payload);
      form.classList.remove('is-visible');
      greetingEl.classList.remove('is-visible');
      successEl.classList.add('is-visible');
      if (data.asiste === 'si') launchConfetti();
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

      invitadoActual = invitado;
      pintarSaludo(invitado);

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