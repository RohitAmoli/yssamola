/* Shared behaviour for every page: sticky header state, mobile nav,
   active link, scroll-reveal animations, and back-to-top. */
(function () {
  "use strict";

  const header = document.querySelector(".site-header");
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");
  const backdrop = document.querySelector(".nav-backdrop");

  /* Sticky header shadow on scroll */
  const onScroll = () => {
    if (header) header.classList.toggle("scrolled", window.scrollY > 8);
    const topBtn = document.getElementById("topBtn");
    if (topBtn) topBtn.classList.toggle("show", window.scrollY > 420);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* Mobile navigation */
  const closeNav = () => {
    toggle && toggle.classList.remove("open");
    links && links.classList.remove("open");
    backdrop && backdrop.classList.remove("show");
    document.body.style.overflow = "";
  };
  if (toggle && links) {
    toggle.addEventListener("click", () => {
      const open = links.classList.toggle("open");
      toggle.classList.toggle("open", open);
      backdrop && backdrop.classList.toggle("show", open);
      document.body.style.overflow = open ? "hidden" : "";
    });
    backdrop && backdrop.addEventListener("click", closeNav);
    links.querySelectorAll("a").forEach((a) => a.addEventListener("click", closeNav));
    window.addEventListener("keydown", (e) => e.key === "Escape" && closeNav());
  }

  /* Highlight the current page in the nav */
  const here = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  document.querySelectorAll(".nav-links a").forEach((a) => {
    const href = (a.getAttribute("href") || "").toLowerCase();
    if (href === here || (here === "" && href === "index.html")) a.classList.add("active");
  });

  /* Scroll-reveal */
  const revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && revealEls.length) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("in"));
  }

  /* Back to top */
  const topBtn = document.getElementById("topBtn");
  topBtn && topBtn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  /* Set current year */
  document.querySelectorAll("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));
})();
