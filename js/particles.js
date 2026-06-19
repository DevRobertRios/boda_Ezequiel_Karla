/* =========================================================
   PARTICLES — Partículas doradas decorativas (ligeras)
   ========================================================= */
(function () {
  const layers = document.querySelectorAll('.particles-layer');
  if (!layers.length) return;

  // Respeta la preferencia de "reduced motion"
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) return;

  layers.forEach((layer) => {
    const count = Number(layer.dataset.count) || 14;

    for (let i = 0; i < count; i++) {
      const p = document.createElement('span');
      p.className = 'particle';

      const left = Math.random() * 100;
      const size = 3 + Math.random() * 4;
      const duration = 8 + Math.random() * 10;
      const delay = Math.random() * 10;

      p.style.left = `${left}%`;
      p.style.bottom = '0';
      p.style.width = `${size}px`;
      p.style.height = `${size}px`;
      p.style.animationDuration = `${duration}s`;
      p.style.animationDelay = `${delay}s`;

      layer.appendChild(p);
    }
  });
})();
