/* =========================================================
   RSVP — Validación, envío a Supabase y confirmación
   ========================================================= */
(function () {
  const form = document.querySelector('#rsvp-form');
  if (!form) return;

  const errorEl = document.querySelector('.rsvp-error');
  const successEl = document.querySelector('.rsvp-success');
  const submitBtn = form.querySelector('.rsvp-submit');

  /* =========================================================
     ⚠️ CONFIGURACIÓN SUPABASE
     Reemplaza estos valores con los de tu proyecto:
     Project Settings → API → Project URL / anon public key
     ========================================================= */
  const SUPABASE_URL = 'TU_SUPABASE_URL'; // ej: https://xxxxx.supabase.co
  const SUPABASE_ANON_KEY = 'TU_SUPABASE_ANON_KEY';
  const TABLE_NAME = 'rsvp';

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

  function validate(data) {
    if (!data.nombre || data.nombre.trim().length < 2) {
      return 'Por favor escribe tu nombre completo.';
    }
    if (!data.asiste) {
      return 'Indícanos si podrás acompañarnos.';
    }
    if (data.asiste === 'si' && (!data.num_personas || Number(data.num_personas) < 1)) {
      return 'Indícanos el número de personas que asistirán.';
    }
    return null;
  }

  async function submitToSupabase(payload) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE_NAME}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: 'return=minimal',
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
      nombre: data.nombre.trim(),
      asiste: data.asiste === 'si',
      num_personas: data.asiste === 'si' ? Number(data.num_personas) : 0,
      menu: data.menu || null,
      alergias: data.alergias?.trim() || null,
      cancion: data.cancion?.trim() || null,
      mensaje: data.mensaje?.trim() || null,
    };

    setLoading(true);

    try {
      await submitToSupabase(payload);
      form.style.display = 'none';
      successEl.classList.add('is-visible');
      launchConfetti();
    } catch (err) {
      console.error('RSVP error:', err);
      showError('Hubo un problema al enviar tu confirmación. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  });
})();
