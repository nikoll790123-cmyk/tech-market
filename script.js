(function () {
  'use strict';

  var MAIN = new Audio('assets/scream.mp3');
  MAIN.preload = 'auto';
  MAIN.volume = 1;
  MAIN.loop = true;

  var ECHO = new Audio('assets/scream.mp3');
  ECHO.preload = 'auto';
  ECHO.volume = 1;
  ECHO.loop = true;

  var overlay = document.getElementById('scareOverlay');
  var fired = false;
  var audioUnlocked = false;

  function playSound() {
    try {
      MAIN.loop = true;
      ECHO.loop = true;
      MAIN.currentTime = 0;
      var p1 = MAIN.play();
      if (p1 && p1.catch) p1.catch(function () {});
      setTimeout(function () {
        ECHO.currentTime = 0;
        var p2 = ECHO.play();
        if (p2 && p2.catch) p2.catch(function () {});
      }, 280);
    } catch (e) {}
  }

  function unlock() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    try {
      MAIN.volume = 0.0001;
      var p = MAIN.play();
      if (p && p.catch) p.catch(function () {});
      setTimeout(function () {
        MAIN.pause();
        MAIN.currentTime = 0;
        MAIN.volume = 1;
        if (fired) playSound();
      }, 120);
    } catch (e) {}
  }

  function show(withSound) {
    if (fired) return;
    fired = true;
    if (withSound) playSound();
    try {
      if (navigator.vibrate) navigator.vibrate([250, 60, 250]);
    } catch (e) {}
    try {
      var el = document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } catch (e2) {}
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function onFirstTouch() {
    unlock();
    show(true);
  }

  document.addEventListener('pointerdown', onFirstTouch, { once: true });
  document.addEventListener('touchstart', onFirstTouch, { once: true });
  document.addEventListener('click', function () {
    if (fired) playSound();
  });
})();