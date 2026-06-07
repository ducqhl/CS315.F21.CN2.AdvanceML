/* CS315 Docs — shared interactive behaviours */

/* ── Nav toggle ── */
function toggleNav(btn) {
  var nav     = document.getElementById("sidebar-nav");
  var overlay = document.getElementById("nav-overlay");
  var isOpen  = nav.classList.toggle("open");
  overlay.classList.toggle("open", isOpen);
  btn.setAttribute("aria-expanded", isOpen);
  btn.setAttribute("aria-label", isOpen ? "Đóng menu" : "Mở menu điều hướng");
}

function closeNav() {
  var nav     = document.getElementById("sidebar-nav");
  var overlay = document.getElementById("nav-overlay");
  var btn     = document.querySelector(".nav-toggle");
  nav.classList.remove("open");
  overlay.classList.remove("open");
  if (btn) {
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", "Mở menu điều hướng");
  }
}

document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") closeNav();
});

/* ── Page progress bar ── */
(function () {
  var bar = document.getElementById("page-progress");
  if (!bar) return;
  function upd() {
    var doc = document.documentElement;
    var scrolled = (doc.scrollTop || document.body.scrollTop);
    var total    = doc.scrollHeight - doc.clientHeight;
    var pct = total > 0 ? scrolled / total : 0;
    bar.style.transform = "scaleX(" + Math.min(pct, 1) + ")";
  }
  window.addEventListener("scroll", upd, { passive: true });
  upd();
})();

/* ── Copy buttons on code blocks ── */
document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll("pre").forEach(function (pre) {
    /* skip if already wrapped */
    if (pre.parentNode.classList.contains("code-block")) return;
    var wrap = document.createElement("div");
    wrap.className = "code-block";
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(pre);
    var btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.textContent = "Copy";
    btn.setAttribute("aria-label", "Copy code");
    btn.addEventListener("click", function () {
      var codeEl = pre.querySelector("code");
      var text   = codeEl ? codeEl.innerText : pre.innerText;
      navigator.clipboard.writeText(text).then(function () {
        btn.textContent = "Copied!";
        btn.classList.add("copied");
        setTimeout(function () {
          btn.textContent = "Copy";
          btn.classList.remove("copied");
        }, 2000);
      }).catch(function () {
        btn.textContent = "Copy";
      });
    });
    wrap.appendChild(btn);
  });

  /* ── Q&A accordion ── */
  document.querySelectorAll(".qa-q").forEach(function (q) {
    /* inject chevron if not present */
    if (!q.querySelector(".qa-chevron")) {
      var ch = document.createElement("span");
      ch.className = "qa-chevron";
      ch.setAttribute("aria-hidden", "true");
      ch.textContent = "▾";
      q.appendChild(ch);
    }
    q.addEventListener("click", function () {
      var item = q.closest(".qa-item");
      if (!item) return;
      item.classList.toggle("open");
    });
  });
});
