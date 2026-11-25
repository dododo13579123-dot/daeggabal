/* 대가리 깨져도 발로란트 — UI script (no dependencies) */
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* sticky header state */
  var header = $(".site-header");
  if (header) {
    var onScroll = function () {
      header.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* mobile nav */
  var burger = $("#burger");
  var nav = $("#nav");
  if (burger && nav) {
    var setNav = function (open) {
      nav.classList.toggle("is-open", open);
      burger.setAttribute("aria-expanded", open ? "true" : "false");
      burger.setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기");
      document.body.style.overflow = open && window.innerWidth <= 980 ? "hidden" : "";
    };
    burger.addEventListener("click", function () {
      setNav(burger.getAttribute("aria-expanded") !== "true");
    });
    $$("a", nav).forEach(function (a) {
      a.addEventListener("click", function () { setNav(false); });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") setNav(false);
    });
    window.addEventListener("resize", function () {
      if (window.innerWidth > 980) setNav(false);
    });
  }

  /* active nav item */
  var path = location.pathname.replace(/\/index\.html$/, "/");
  $$(".nav > a").forEach(function (a) {
    var href = a.getAttribute("href") || "";
    if (!href || href.charAt(0) === "#" || /^https?:/.test(href)) return;
    var target = new URL(a.href, location.href).pathname.replace(/\/index\.html$/, "/");
    if (target === path) a.setAttribute("aria-current", "page");
  });

  /* scroll reveal */
  var revealItems = $$(".reveal");
  if (revealItems.length) {
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        });
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
      revealItems.forEach(function (el) { io.observe(el); });
    } else {
      revealItems.forEach(function (el) { el.classList.add("is-in"); });
    }
  }

  /* copy discord invite */
  var toast = $("#toast");
  var toastTimer;
  var showToast = function (msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove("is-on"); }, 2200);
  };

  $$("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var value = btn.getAttribute("data-copy");
      var done = function () { showToast("초대 링크를 복사했어요. 디스코드에서 붙여넣기!"); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(done, function () {
          showToast("복사에 실패했어요. 링크를 직접 선택해 주세요.");
        });
      } else {
        var ta = document.createElement("textarea");
        ta.value = value;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); done(); } catch (e) { showToast("복사에 실패했어요."); }
        document.body.removeChild(ta);
      }
    });
  });

  /* footer year */
  $$("[data-year]").forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });
})();
