/* =========================================================
   ANIMATIONS — Fade + Stagger + Gold Rule con IntersectionObserver
   ========================================================= */
(function () {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- Clase reutilizable para observar elementos ---
  function observe(selector, options) {
    const els = document.querySelectorAll(selector);
    if (!els.length) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, options || { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

    els.forEach((el) => observer.observe(el));
  }

  // Fade-up estándar
  observe('.fade-up');

  // Fade con scale
  observe('.fade-up-scale', { threshold: 0.12, rootMargin: '0px 0px -30px 0px' });

  // Fade desde derecha
  observe('.fade-right', { threshold: 0.12 });

  // Gold Rule: se activa al llegar la sección padre O el propio elemento
  observe('.gold-rule', { threshold: 0.3 });

  // Scroll indicator en hero: ocultar al hacer scroll
  if (!prefersReducedMotion) {
    const scrollHint = document.querySelector('.hero__scroll-hint');
    if (scrollHint) {
      window.addEventListener('scroll', function hideHint() {
        if (window.scrollY > 80) {
          scrollHint.style.opacity = '0';
          scrollHint.style.transition = 'opacity 0.4s ease';
          window.removeEventListener('scroll', hideHint);
        }
      }, { passive: true });
    }
  }
})();