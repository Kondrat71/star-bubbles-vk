/* Адаптер площадки: vk */
(function () {
  var ok = false;
  var q = new URLSearchParams(location.search);
  function B() { return window.vkBridge; }
  function send(m, p) { return B().send(m, p || {}); }
  function preload() {
    send('VKWebAppCheckNativeAds', { ad_format: 'interstitial' }).catch(function () {});
    send('VKWebAppCheckNativeAds', { ad_format: 'reward' }).catch(function () {});
  }
  window.__PLATFORM_ADAPTER = {
    init: function () {
      if (!B()) return Promise.resolve();
      return send('VKWebAppInit').then(function () { ok = true; preload(); });
    },
    lang: function () { return q.get('vk_language'); },
    ready: function () {},
    gameplayStart: function () {},
    gameplayStop: function () {},
    interstitial: function () {
      if (!ok) return Promise.resolve();
      return send('VKWebAppShowNativeAds', { ad_format: 'interstitial' }).then(function () { preload(); }, function () { preload(); });
    },
    rewarded: function () {
      if (!ok) return Promise.resolve(false);
      return send('VKWebAppShowNativeAds', { ad_format: 'reward' }).then(
        function (d) { preload(); return !!(d && d.result); },
        function () { preload(); return false; }
      );
    },
    load: function () {
      if (!ok) return null;
      return send('VKWebAppStorageGet', { keys: ['save'] }).then(function (d) {
        var v = d && d.keys && d.keys[0] && d.keys[0].value;
        return v ? JSON.parse(v) : null;
      });
    },
    save: function (data) {
      if (!ok) return;
      var v = JSON.stringify(data);
      // Хранилище VK принимает до 4096 байт; больше — остаётся только сохранение в браузере.
      if (v.length <= 4000) send('VKWebAppStorageSet', { key: 'save', value: v }).catch(function () {});
    },
  };
})();
/*
 * Переходник площадки (vk). Игра написана под Яндекс SDK и ищет window.YaGames;
 * этот файл отдаёт ей такой же интерфейс, а внутри вызывает SDK площадки.
 * Если SDK площадки не загрузился (блокировщик рекламы, нет сети), игра всё равно работает:
 * реклама пропускается, прогресс хранится в браузере.
 */
(function () {
  'use strict';
  var A = window.__PLATFORM_ADAPTER;
  var handlers = {};
  var params = new URLSearchParams(location.search);

  function emit(name) {
    (handlers[name] || []).slice().forEach(function (f) {
      try { f(); } catch (e) { /* обработчик игры не должен ронять переходник */ }
    });
  }
  function safe(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }
  function timeout(p, ms, value) {
    return Promise.race([
      Promise.resolve(p).catch(function () { return value; }),
      new Promise(function (r) { setTimeout(function () { r(value); }, ms); }),
    ]);
  }
  function lsGet(k) { return safe(function () { return localStorage.getItem(k); }, null); }
  function lsSet(k, v) { safe(function () { localStorage.setItem(k, v); }); }

  // Таблица рекордов на площадках без своей: личный рекорд игрока.
  var LB = '__bridge_lb_';
  function myLang() {
    var l = safe(function () { return A.lang && A.lang(); }, null) || navigator.language || 'en';
    return String(l).slice(0, 2).toLowerCase();
  }
  var adOpen = false;

  function runAd(kind, cb) {
    cb = cb || {};
    if (adOpen) { (cb.onClose || function () {})(false); return; }
    adOpen = true;
    emit('game_api_pause');
    safe(function () { cb.onOpen && cb.onOpen(); });
    var show = kind === 'rewarded' ? A.rewarded : A.interstitial;
    // Подстраховка: если площадка не ответила за 75 с, отдаём управление игре.
    timeout(safe(function () { return show(); }, Promise.resolve(false)), 75000, kind === 'rewarded' ? false : undefined).then(function (res) {
      adOpen = false;
      emit('game_api_resume');
      if (kind === 'rewarded') {
        if (res) {
          safe(function () { cb.onRewarded && cb.onRewarded(); });
          safe(function () { cb.onClose && cb.onClose(true); });
        } else {
          safe(function () { cb.onError && cb.onError(new Error('rewarded ad not shown')); });
        }
      } else {
        safe(function () { cb.onClose && cb.onClose(true); });
      }
    });
  }

  var player = {
    isAuthorized: function () { return true; },
    getUniqueID: function () { return 'me'; },
    getName: function () { return ''; },
    getData: function () {
      return timeout(safe(function () { return A.load(); }, null), 4000, null).then(function (d) {
        return d ? { save: d } : {};
      });
    },
    setData: function (d) {
      if (d && d.save) safe(function () { A.save(d.save); });
      return Promise.resolve();
    },
  };

  var ysdk = {
    environment: { i18n: { lang: 'en' } },
    features: {
      LoadingAPI: { ready: function () { safe(function () { A.ready(); }); } },
      GameplayAPI: {
        start: function () { safe(function () { A.gameplayStart(); }); },
        stop: function () { safe(function () { A.gameplayStop(); }); },
      },
    },
    adv: {
      showFullscreenAdv: function (o) { runAd('fullscreen', o && o.callbacks); },
      showRewardedVideo: function (o) { runAd('rewarded', o && o.callbacks); },
    },
    auth: { openAuthDialog: function () { return Promise.resolve(); } },
    getPlayer: function () { return Promise.resolve(player); },
    isAvailableMethod: function (m) { return Promise.resolve(m === 'leaderboards.setScore'); },
    leaderboards: {
      setScore: function (name, score) {
        var best = Number(lsGet(LB + name) || 0);
        if (score > best) lsSet(LB + name, String(score));
        return Promise.resolve();
      },
      getEntries: function (name) {
        var best = Number(lsGet(LB + name) || 0);
        var me = myLang() === 'ru' ? 'Ваш рекорд' : 'Your best';
        return Promise.resolve({
          entries: best > 0 ? [{ rank: 1, score: best, player: { publicName: me, uniqueID: 'me' } }] : [],
        });
      },
    },
    on: function (name, f) {
      (handlers[name] = handlers[name] || []).push(f);
      return function () { ysdk.off(name, f); };
    },
    off: function (name, f) {
      handlers[name] = (handlers[name] || []).filter(function (x) { return x !== f; });
    },
  };

  var initP = null;
  window.YaGames = {
    init: function () {
      if (!initP) {
        initP = timeout(safe(function () { return A.init(); }, null), 6000, null).then(function () {
          ysdk.environment.i18n.lang = params.get('lang') || myLang();
          return ysdk;
        });
      }
      return initP;
    },
  };
})();
