/* =========================================================
   MUSIC — Modal de consentimiento + control flotante
   ========================================================= */
(function () {
  const modal = document.querySelector('.music-modal');
  const audio = document.querySelector('#wedding-audio');
  const yesBtn = document.querySelector('[data-music="yes"]');
  const noBtn = document.querySelector('[data-music="no"]');
  const toggleBtn = document.querySelector('.music-toggle');

  if (!modal || !audio) return;

  function showModal() {
    modal.classList.add('is-visible');
  }

  function hideModal() {
    modal.classList.remove('is-visible');
  }

  function playMusic() {
    audio.play().catch(() => {
      // Si el navegador bloquea la reproducción, no rompemos la experiencia
    });
    toggleBtn.classList.add('is-active', 'is-playing');
  }

  function pauseMusic() {
    audio.pause();
    toggleBtn.classList.remove('is-playing');
  }

  // Se activa cuando el sobre termina de abrirse (ver envelope.js)
  document.addEventListener('invitation:revealed', () => {
    setTimeout(showModal, 500);
  }, { once: true });

  yesBtn?.addEventListener('click', () => {
    hideModal();
    playMusic();
  });

  noBtn?.addEventListener('click', () => {
    hideModal();
    toggleBtn.classList.add('is-active');
  });

  toggleBtn?.addEventListener('click', () => {
    if (audio.paused) {
      playMusic();
    } else {
      pauseMusic();
    }
  });
})();
