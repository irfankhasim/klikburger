/**
 * Landing Klik Burger: modal hubungi / minta demo (tiada pendaftaran automatik).
 * Set e-mel pentadbir pada <body data-contact-email="admin@domain.com"> untuk pautan mailto.
 */
(function () {
  var backdrop = document.getElementById("lp-modal-backdrop");
  var form = document.getElementById("lp-contact-form");
  var successEl = document.getElementById("lp-success");
  var titleEl = document.getElementById("lp-modal-title");
  var descEl = document.getElementById("lp-modal-desc");
  var yearEl = document.getElementById("lp-year");
  var summaryPre = document.getElementById("lp-summary");
  var mailtoLink = document.getElementById("lp-mailto-link");
  var successMsg = document.getElementById("lp-success-msg");
  var copyBtn = document.getElementById("lp-copy-summary");
  var intent = "demo";
  var lastSummaryText = "";
  var closeMobileNav = function () {};

  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  function adminEmail() {
    var v = document.body && document.body.getAttribute("data-contact-email");
    return (v && String(v).trim()) || "";
  }

  function setIntent(mode) {
    intent = mode === "contact" ? "contact" : "demo";
    if (!titleEl || !descEl) return;
    if (intent === "contact") {
      titleEl.textContent = "Hubungi admin";
      descEl.textContent = "Beritahu kami siapa anda. Pasukan akan balas melalui telefon atau e-mel.";
    } else {
      titleEl.textContent = "Minta demo";
      descEl.textContent = "Isi maklumat asas. Tiada akaun dicipta; admin akan hubungi anda.";
    }
  }

  function openModal(mode) {
    closeMobileNav();
    setIntent(mode);
    if (!backdrop) return;
    backdrop.hidden = false;
    backdrop.setAttribute("aria-hidden", "false");
    backdrop.classList.add("is-open");
    if (form) {
      form.hidden = false;
      form.reset();
    }
    if (successEl) successEl.hidden = true;
    var name = document.getElementById("lp-name");
    if (name) setTimeout(function () { name.focus(); }, 50);
  }

  function closeModal() {
    if (!backdrop) return;
    backdrop.classList.remove("is-open");
    backdrop.setAttribute("aria-hidden", "true");
    backdrop.hidden = true;
    if (form) form.hidden = false;
    if (successEl) successEl.hidden = true;
  }

  function bindDemoTriggers(root) {
    (root || document).querySelectorAll(".js-open-demo").forEach(function (btn) {
      if (btn._lpBound) return;
      btn._lpBound = true;
      btn.addEventListener("click", function (e) {
        if (btn.tagName === "A") e.preventDefault();
        openModal(btn.getAttribute("data-intent") || "demo");
      });
    });
  }

  bindDemoTriggers(document);

  document.querySelectorAll(".js-open-demo-link").forEach(function (link) {
    link.addEventListener("click", function (e) {
      e.preventDefault();
      openModal(link.getAttribute("data-intent") || "demo");
    });
  });

  /* Mobile menu */
  var menuBtn = document.getElementById("lp-menu-btn");
  var navEl = document.getElementById("lp-nav");
  var lpRoot = document.body;

  function setMobileNavOpen(open) {
    if (!navEl || !menuBtn) return;
    navEl.classList.toggle("is-open", open);
    menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    if (lpRoot) lpRoot.classList.toggle("lp-nav-open", open);
  }

  closeMobileNav = function () {
    setMobileNavOpen(false);
  };

  if (menuBtn && navEl) {
    menuBtn.addEventListener("click", function () {
      setMobileNavOpen(!navEl.classList.contains("is-open"));
    });
    navEl.querySelectorAll(".lp-nav__link").forEach(function (link) {
      link.addEventListener("click", closeMobileNav);
    });
    navEl.querySelectorAll(".lp-nav__mobile-cta .js-open-demo, .lp-nav__mobile-cta a").forEach(function (el) {
      el.addEventListener("click", closeMobileNav);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && navEl.classList.contains("is-open")) closeMobileNav();
    });
    window.addEventListener(
      "resize",
      function () {
        if (window.matchMedia("(min-width: 901px)").matches) closeMobileNav();
      },
      { passive: true }
    );
  }

  /* Active nav on scroll */
  var navLinks = document.querySelectorAll(".lp-nav__link[data-nav]");
  var sections = [];
  navLinks.forEach(function (link) {
    var id = link.getAttribute("href");
    if (id && id.charAt(0) === "#") {
      var sec = document.querySelector(id);
      if (sec) sections.push({ el: sec, nav: link.getAttribute("data-nav") });
    }
  });

  function setActiveNav(navKey) {
    navLinks.forEach(function (link) {
      link.classList.toggle("is-active", link.getAttribute("data-nav") === navKey);
    });
  }

  if (sections.length && "IntersectionObserver" in window) {
    var navObs = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var found = sections.find(function (s) {
            return s.el === entry.target;
          });
          if (found) setActiveNav(found.nav);
        });
      },
      { rootMargin: "-35% 0px -55% 0px", threshold: 0 }
    );
    sections.forEach(function (s) {
      navObs.observe(s.el);
    });
  }

  /* Fade-in on scroll */
  var heroReveal = document.querySelectorAll(".lp-hero .lp-reveal");
  var scrollReveal = [];
  document.querySelectorAll(".lp-reveal").forEach(function (el) {
    if (!el.closest(".lp-hero")) scrollReveal.push(el);
  });
  heroReveal.forEach(function (el, i) {
    el.style.transitionDelay = i * 0.1 + "s";
    el.classList.add("is-visible");
  });
  if (scrollReveal.length && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    if ("IntersectionObserver" in window) {
      var revealObs = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("is-visible");
            revealObs.unobserve(entry.target);
          });
        },
        { root: null, rootMargin: "0px 0px -6% 0px", threshold: 0.1 }
      );
      scrollReveal.forEach(function (el, i) {
        el.style.transitionDelay = Math.min(i * 0.08, 0.4) + "s";
        revealObs.observe(el);
      });
    } else {
      scrollReveal.forEach(function (el) {
        el.classList.add("is-visible");
      });
    }
  } else {
    scrollReveal.forEach(function (el) {
      el.classList.add("is-visible");
    });
  }

  var closeBtn = document.getElementById("lp-modal-close");
  var cancelBtn = document.getElementById("lp-modal-cancel");
  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  if (cancelBtn) cancelBtn.addEventListener("click", closeModal);

  var successClose = document.getElementById("lp-success-close");
  if (successClose) successClose.addEventListener("click", closeModal);

  if (backdrop) {
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) closeModal();
    });
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && backdrop && !backdrop.hidden) closeModal();
  });

  function buildSummary(data) {
    var lines = [
      "[Klik Burger] Permintaan daripada landing",
      "Jenis: " + (intent === "contact" ? "Hubungi admin" : "Minta demo"),
      "Nama: " + data.name,
      "Telefon: " + data.phone,
      "E-mel: " + data.email
    ];
    if (data.message) lines.push("Catatan: " + data.message);
    lines.push("");
    lines.push("(Tiada pendaftaran automatik. Hubungi pelanggan secara manual.)");
    return lines.join("\n");
  }

  if (copyBtn) {
    copyBtn.addEventListener("click", function () {
      if (!lastSummaryText) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(lastSummaryText).then(
          function () {
            window.alert("Ringkasan disalin ke papan keratan.");
          },
          function () {
            window.prompt("Salin teks ini:", lastSummaryText);
          }
        );
      } else {
        window.prompt("Salin teks ini:", lastSummaryText);
      }
    });
  }

  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = document.getElementById("lp-name");
      var phone = document.getElementById("lp-phone");
      var email = document.getElementById("lp-email");
      var msg = document.getElementById("lp-msg");
      var n = name && name.value.trim();
      var p = phone && phone.value.trim();
      var em = email && email.value.trim();
      if (!n || !p || !em) {
        window.alert("Sila lengkapkan nama, telefon, dan e-mel.");
        return;
      }
      var data = { name: n, phone: p, email: em, message: msg && msg.value.trim() };
      lastSummaryText = buildSummary(data);

      var to = adminEmail();
      var subj =
        intent === "contact"
          ? "[Klik Burger] Hubungi | " + n
          : "[Klik Burger] Minta demo | " + n;

      if (mailtoLink) {
        if (to) {
          mailtoLink.href =
            "mailto:" +
            to +
            "?subject=" +
            encodeURIComponent(subj) +
            "&body=" +
            encodeURIComponent(lastSummaryText);
          mailtoLink.hidden = false;
        } else {
          mailtoLink.hidden = true;
          mailtoLink.removeAttribute("href");
        }
      }

      if (summaryPre) summaryPre.textContent = lastSummaryText;

      if (successMsg) {
        successMsg.textContent = to
          ? "Gunakan butang “Buka draf e-mel” untuk menghantar kepada pentadbir, atau salin ringkasan untuk saluran lain."
          : "Tetapkan atribut data-contact-email pada halaman ini untuk membolehkan draf e-mel automatik. Buat masa ini, salin ringkasan dan hubungi pentadbir secara manual.";
      }

      if (form) form.hidden = true;
      if (successEl) successEl.hidden = false;
    });
  }
})();
