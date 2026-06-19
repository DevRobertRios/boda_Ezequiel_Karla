/* =========================================================
   COUNTDOWN — Cuenta regresiva en tiempo real
   ========================================================= */
(function () {
  // Fecha objetivo: 11 Octubre 2026, zona horaria America/Mexico_City (UTC-6)
  const WEDDING_DATE = new Date('2026-10-11T12:00:00-06:00').getTime();

  const els = {
    days: document.querySelector('[data-countdown="days"]'),
    hours: document.querySelector('[data-countdown="hours"]'),
    minutes: document.querySelector('[data-countdown="minutes"]'),
    seconds: document.querySelector('[data-countdown="seconds"]'),
  };

  if (!els.days) return;

  function pad(num) {
    return String(num).padStart(2, '0');
  }

  function update() {
    const now = Date.now();
    const diff = WEDDING_DATE - now;

    if (diff <= 0) {
      els.days.textContent = '00';
      els.hours.textContent = '00';
      els.minutes.textContent = '00';
      els.seconds.textContent = '00';
      clearInterval(timer);
      return;
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    els.days.textContent = pad(days);
    els.hours.textContent = pad(hours);
    els.minutes.textContent = pad(minutes);
    els.seconds.textContent = pad(seconds);
  }

  update();
  const timer = setInterval(update, 1000);
})();
