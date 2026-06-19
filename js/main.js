/* =========================================================
   MAIN — Inicialización general
   ========================================================= */
(function () {
  document.addEventListener('DOMContentLoaded', () => {
    // Inicializa el carrusel de galería (Swiper.js cargado vía CDN en index.html)
    const galleryEl = document.querySelector('.gallery .swiper');
    if (galleryEl && window.Swiper) {
      // eslint-disable-next-line no-new
      new Swiper(galleryEl, {
        slidesPerView: 1.3,
        centeredSlides: true,
        spaceBetween: 16,
        loop: true,
        pagination: {
          el: '.swiper-pagination',
          clickable: true,
        },
        breakpoints: {
          768: { slidesPerView: 2.3 },
        },
      });
    }
  });
})();
