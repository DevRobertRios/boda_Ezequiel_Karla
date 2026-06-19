/* =========================================================
   ENVELOPE — Apertura del sobre digital
   ========================================================= */
(function () {
  const screen = document.querySelector('.envelope-screen');
  const envelope = document.querySelector('.envelope');
  const app = document.querySelector('.app');

  if (!screen || !envelope) return;

  let opened = false;

  function openEnvelope() {
    if (opened) return;
    opened = true;

    envelope.classList.add('is-open');

    // Espera la animación del sobre antes de revelar la invitación
    setTimeout(() => {
      screen.classList.add('is-hidden');
      document.body.style.overflow = '';

      // Dispara evento global: otras piezas (música, countdown) pueden escuchar esto
      document.dispatchEvent(new CustomEvent('invitation:revealed'));
    }, 1500);

    // Quita el listener para evitar doble disparo
    envelope.removeEventListener('click', openEnvelope);
    envelope.removeEventListener('keydown', handleKey);
  }

  function handleKey(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openEnvelope();
    }
  }

  // Bloquea el scroll de fondo mientras el sobre está visible
  document.body.style.overflow = 'hidden';

  envelope.addEventListener('click', openEnvelope);
  envelope.addEventListener('keydown', handleKey);
  envelope.setAttribute('tabindex', '0');
  envelope.setAttribute('role', 'button');
  envelope.setAttribute('aria-label', 'Abrir invitación');
})();
