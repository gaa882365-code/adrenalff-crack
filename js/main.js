var ROLES = { user: 0, moderator: 1, administration: 2, owner: 3 };
var ROLE_LABEL = { user: "ПОЛЬЗОВАТЕЛЬ", moderator: "МОДЕРАТОР", administration: "АДМИНИСТРАЦИЯ", owner: "ВЛАДЕЛЕЦ" };
var ROLE_CLASS = { user: "role-user", moderator: "role-moderator", administration: "role-administration", owner: "role-owner" };
var TYPE_LABEL = { crack: "CRACK", keygen: "KEYGEN", loader: "LOADER", patch: "PATCH", linux: "LINUX" };

var statusLabel = { pending: "НА ПРОВЕРКЕ", approved: "ОДОБРЕНО", rejected: "ОТКАЗАНО" };
var statusClass = { pending: "badge-pending", approved: "badge-verified", rejected: "badge-rejected" };

var cfgOk = !!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY);
var sb = null;
if (cfgOk && window.supabase) {
  sb = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
}

var state = {
  user: null,
  profile: null,
  query: "",
  category: "Все",
  sort: "date-desc",
  view: "catalog",
  releases: [],
  allCats: ["Все"]
};

function init() {
  initAuth();
  bindUi();
  tick();
  setInterval(tick, 1000);

  if (!cfgOk) {
    document.getElementById("notice").style.display = "block";
    var grid = document.getElementById("releaseGrid");
    grid.innerHTML = '<div class="empty-state">supabase не настроен.<br>открой <b>js/supabase-config.js</b> и вставь URL + anon key</div>';
    return;
  }
  if (!window.supabase) {
    alert("не удалось загрузить supabase-js (нет интернета? cdn.jsdelivr.net заблокирован?)");
  }
  loadReleases();
}

/* ---------- auth ---------- */

function initAuth() {
  sb.auth.getSession().then(function (res) {
    if (res.error) return;
    setSession(res.data.session);
  });

  sb.auth.onAuthStateChange(function (event, session) {
    if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
    setSession(session);
  });
}

function setSession(session) {
  var isArmed = !!session;
  if (isArmed) {
    state.user = session.user;
    loadProfile(session.user.id);
  } else {
    state.user = null;
    state.profile = null;
    state.view = "catalog";
  }
  renderTopbar();
  renderViewBar();
  if (cfgOk) loadReleases();
}

function loadProfile(uid) {
  sb
    .from("profiles")
    .select("id, username, role")
    .eq("id", uid)
    .maybeSingle()
    .then(function (res) {
      if (!res.error && res.data) {
        state.profile = res.data;
      } else {
        state.profile = { username: "??", role: "user" };
      }
      renderTopbar();
      renderViewBar();
    });
}

function roleLevel() {
  return state.profile ? ROLES[state.profile.role] || 0 : 0;
}

function isMod() {
  return roleLevel() >= 1;
}

function renderTopbar() {
  var box = document.getElementById("topUser");
  if (!state.user) {
    box.innerHTML = '<button class="btn-login" id="btnLogin">ВХОД / РЕГ</button>';
    document.getElementById("btnLogin").addEventListener("click", openAuthModal);
    return;
  }
  var role = state.profile ? state.profile.role : "user";
  var name = state.profile ? state.profile.username : "??";
  var modBtn = isMod()
    ? '<button class="icon-btn" id="btnMod">МОДЕРАЦИЯ</button>'
    : "";
  box.innerHTML =
    '<div class="user-chip">' +
    '<span class="user-name">' + esc(name) + "</span>" +
    '<span class="role-badge ' + ROLE_CLASS[role] + '">' + ROLE_LABEL[role] + "</span>" +
    "</div>" +
    '<button class="icon-btn acc" id="btnUpload">ВЫЛОЖИТЬ</button>' +
    modBtn +
    '<button class="icon-btn warn" id="btnLogout">ВЫЙТИ</button>';

  document.getElementById("btnUpload").addEventListener("click", openUploadModal);
  document.getElementById("btnLogout").addEventListener("click", function () {
    sb.auth.signOut();
  });
  var mod = document.getElementById("btnMod");
  if (mod) mod.addEventListener("click", function () { toggleView("moderation"); });
}

function renderViewBar() {
  var bar = document.getElementById("viewBar");
  if (!state.user) {
    bar.style.display = "none";
    return;
  }
  var pending = state.releases.filter(function (r) { return r.status === "pending" && isMod(); });
  bar.style.display = "flex";
  document.getElementById("viewCatalog").className = "chip" + (state.view === "catalog" ? " active" : "");
  var modChip = document.getElementById("viewModeration");
  modChip.className = "chip" + (state.view === "moderation" ? " active" : "");
  modChip.style.display = isMod() ? "" : "none";
  document.getElementById("pendingNum").textContent = pending.length || "";
}

function toggleView(v) {
  state.view = v;
  renderViewBar();
  render();
}

/* ---------- data ---------- */

function loadReleases() {
  var q = sb.from("releases").select("*");
  if (!state.user) q = q.eq("status", "approved");
  q.order("date", { ascending: false }).then(function (res) {
    if (res.error) {
      toast("ошибка базы: " + res.error.message, true);
      return;
    }
    state.releases = res.data || [];
    state.allCats = ["Все"];
    state.releases.forEach(function (r) {
      if (state.allCats.indexOf(r.category) === -1) state.allCats.push(r.category);
    });
    renderChips();
    render();
  });
}

function visible(r) {
  if (r.status === "approved") return true;
  if (!state.user) return false;
  if (state.user.id === r.uploader) return true;
  return isMod();
}

function filter() {
  return state.releases.filter(function (r) {
    var okCat = state.category === "Все" || r.category === state.category;
    if (!okCat) return false;
    if (!state.query) return true;
    var hay = (r.title + " " + r.version + " " + r.category + " " + r.type).toLowerCase();
    return hay.indexOf(state.query) !== -1;
  });
}

function sortArr(arr) {
  var s = state.sort;
  arr.sort(function (a, b) {
    if (s === "az") return a.title.localeCompare(b.title, "ru");
    if (s === "dl-desc") return b.dl - a.dl;
    if (s === "date-asc") return (a.date || "").localeCompare(b.date || "");
    return (b.date || "").localeCompare(a.date || "");
  });
  return arr;
}

/* ---------- render ---------- */

function renderChips() {
  var box = document.getElementById("categoryChips");
  box.innerHTML = "";
  state.allCats.forEach(function (c) {
    var b = document.createElement("button");
    b.className = "chip" + (c === state.category ? " active" : "");
    b.textContent = c;
    b.addEventListener("click", function () {
      state.category = c;
      renderChips();
      render();
    });
    box.appendChild(b);
  });
}

function render() {
  var grid = document.getElementById("releaseGrid");

  if (state.view === "moderation" && isMod()) {
    renderModeration();
    return;
  }

  var approved = state.releases.filter(function (r) { return r.status === "approved" && visible(r); });
  var list = sortArr(filter().filter(function (r) { return r.status === "approved" && visible(r); }));
  var dlSum = approved.reduce(function (a, r) { return a + (r.dl || 0); }, 0);

  document.getElementById("stat-total").textContent = approved.length;
  document.getElementById("stat-verified").textContent = pendingCount();
  document.getElementById("stat-dl").textContent = dlSum.toLocaleString("ru-RU");
  document.getElementById("resultCount").innerHTML = "в каталоге&nbsp;<b>" + list.length + "</b>";

  if (!list.length) {
    grid.innerHTML = '<div class="empty-state">пусто. релизов нет.<br>зайди и <b>выложи первый</b></div>';
    return;
  }

  grid.innerHTML = list.map(cardHtml).join("");

  grid.querySelectorAll(".card").forEach(function (card) {
    card.addEventListener("click", function () {
      openRelease(parseInt(card.dataset.id, 10));
    });
  });
}

function pendingCount() {
  if (!state.user) return 0;
  return state.releases.filter(function (r) {
    return r.status === "pending" && (isMod() || state.user.id === r.uploader);
  }).length;
}

function cardHtml(r) {
  var badge = statusClass[r.status] ? '<span class="badge ' + statusClass[r.status] + '">' + statusLabel[r.status] + "</span>" : "";
  return (
    '<article class="card" data-id="' + r.id + '">' +
    '<div class="card-head">' +
    '<span class="card-idx">RELEASE #' + pad(String(r.id).slice(-2)) + "</span>" +
    badge +
    "</div>" +
    '<h3 class="card-title">' + esc(r.title) + "</h3>" +
    '<p class="card-desc">' + esc(r.desc || "") + "</p>" +
    '<div class="card-meta">' +
    '<span>' + esc(r.version || "") + "</span>" +
    '<span>' + esc(r.category) + "</span>" +
    '<span><b>' + esc(TYPE_LABEL[r.type] || r.type) + "</b></span>" +
    "</div>" +
    '<div class="card-meta">' +
    '<span>PLAT <b>' + esc(r.platform || "?") + "</b></span>" +
    '<span>SIZE <b>' + esc(r.size || "?") + "</b></span>" +
    '<span>DATE <b>' + fmtDate(r.date) + "</b></span>" +
    "</div>" +
    '<div class="card-foot">' +
    '<span>' + (r.dl || 0).toLocaleString("ru-RU") + " загрузок</span>" +
    '<span class="card-dl-cta">' + (r.status === "approved" ? "СМОТРЕТЬ" : "СТАТУС") + "</span>" +
    "</div>" +
    "</article>"
  );
}

function renderModeration() {
  var grid = document.getElementById("releaseGrid");
  document.getElementById("resultCount").innerHTML = "";

  var pending = sortArr(state.releases.filter(function (r) { return r.status === "pending"; }));
  var rejected = sortArr(state.releases.filter(function (r) { return r.status === "rejected"; }));

  document.getElementById("stat-total").textContent = state.releases.filter(function (r) { return r.status === "approved"; }).length;
  document.getElementById("stat-verified").textContent = pending.length;
  document.getElementById("stat-dl").textContent = state.releases.reduce(function (a, r) { return a + (r.dl || 0); }, 0);

  if (!pending.length && !rejected.length) {
    grid.innerHTML = '<div class="empty-state">очередь пуста. супер.</div>';
    return;
  }

  var html = "";
  html += '<div class="sort-lbl" style="margin-bottom:10px">// НА ПРОВЕРКЕ — ' + pending.length + "</div>";
  pending.forEach(function (r) { html += modRowHtml(r, true); });
  html += '<div class="sort-lbl" style="margin:26px 0 10px">// ОТКЛОНЕНО — ' + rejected.length + "</div>";
  rejected.forEach(function (r) { html += modRowHtml(r, false); });

  grid.innerHTML = html;

  grid.querySelectorAll("[data-act]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var id = parseInt(btn.dataset.id, 10);
      var act = btn.dataset.act;
      modAction(id, act);
    });
  });
}

function modRowHtml(r, needs) {
  return (
    '<div class="mod-row' + (needs ? " needs" : "") + '">' +
    '<div class="mod-row-top">' +
    '<span class="mod-row-title">' + esc(r.title) + ' <span class="accent">' + esc(r.version || "") + "</span></span>" +
    '<span class="badge ' + statusClass[r.status] + '">' + statusLabel[r.status] + "</span>" +
    "</div>" +
    '<div class="mod-row-meta">' +
    "<span>от <b>" + esc(r.uploader_name) + "</b></span>" +
    "<span>категория <b>" + esc(r.category) + "</b></span>" +
    "<span>тип <b>" + esc(TYPE_LABEL[r.type] || r.type) + "</b></span>" +
    "<span>размер <b>" + esc(r.size || "?") + "</b></span>" +
    "<span>дата <b>" + fmtDate(r.date) + "</b></span>" +
    "</div>" +
    '<div class="mod-row-desc">' + esc(r.desc || "") + "</div>" +
    (r.download_link
      ? '<div class="mod-row-meta">линк: <b>' + esc(r.download_link) + "</b></div>"
      : "") +
    '<div class="mod-row-actions">' +
    '<button class="icon-btn acc" data-act="approve" data-id="' + r.id + '">ОДОБРИТЬ</button>' +
    '<button class="icon-btn" data-act="reject" data-id="' + r.id + '">ОТКЛОНИТЬ</button>' +
    '<button class="icon-btn warn" data-act="delete" data-id="' + r.id + '">УДАЛИТЬ</button>' +
    "</div>" +
    "</div>"
  );
}

function modAction(id, act) {
  var upd = { reviewed_at: new Date().toISOString() };
  if (act === "approve") { upd.status = "approved"; }
  if (act === "reject") { upd.status = "rejected"; }
  var p;
  if (act === "delete") {
    p = sb.from("releases").delete().eq("id", id);
  } else {
    p = sb.from("releases").update(upd).eq("id", id);
  }
  p.then(function (res) {
    if (res.error) { toast("ошибка: " + res.error.message, true); return; }
    toast(act === "delete" ? "удалено" : act === "approve" ? "опубликовано ✓" : "отклонено");
    loadReleases();
  });
}

/* ---------- release modal ---------- */

function openRelease(id) {
  var r = null;
  state.releases.forEach(function (x) { if (x.id === id) r = x; });
  var modal = document.getElementById("releaseModal");
  var body = document.getElementById("modalBody");

  if (!r) {
    body.innerHTML = '<div class="m-error">РЕЛИЗ НЕ НАЙДЕН // 404</div>';
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    return;
  }

  var note = "";
  if (r.status === "pending") {
    note = '<div class="status-note pending">НА ПРОВЕРКЕ. релиз увидят модераторы. как одобрят — появится в каталоге.</div>';
  }
  if (r.status === "rejected") {
    note = '<div class="status-note rejected">ОТКЛОНЕНО. поправь описание / ссылку и выложи заново.</div>';
  }

  var dlPart = r.status === "approved"
    ? '<div class="m-block"><div class="m-block-label">// скачать</div>' +
      (r.download_link
        ? '<a class="btn-dl btn-inline" href="' + esc(r.download_link.replace(/"/g, "%22")) + '" target="_blank" rel="noopener" data-bump="' + r.id + '">скачать файлы</a>'
        : '<p class="m-sub">ссылка на файлы добавится оператором.</p>') +
      "</div>"
    : "";

  body.innerHTML =
    '<div class="m-head">' +
    '<h2 class="m-title">' + esc(r.title) + "</h2>" +
    '<span class="m-version">v' + esc(r.version || "") + "</span>" +
    "</div>" +
    '<div class="m-badges">' +
    '<span class="badge ' + statusClass[r.status] + '">' + statusLabel[r.status] + "</span>" +
    '<span class="badge badge-fresh">' + esc(TYPE_LABEL[r.type] || r.type) + "</span>" +
    "</div>" +
    note +
    '<div class="m-block"><div class="m-block-label">// описание</div>' +
    '<p class="m-desc">' + esc(r.desc || "-") + "</p></div>" +
    '<div class="m-block"><div class="m-block-label">// инфо</div>' +
    '<table class="m-table">' +
    "<tr><td>категория</td><td>" + esc(r.category) + "</td></tr>" +
    "<tr><td>платформа</td><td>" + esc(r.platform || "-") + "</td></tr>" +
    "<tr><td>размер</td><td>" + esc(r.size || "-") + "</td></tr>" +
    "<tr><td>выложен</td><td>" + fmtDate(r.date) + "</td></tr>" +
    "<tr><td>оператор</td><td>" + esc(r.uploader_name || "-") + "</td></tr>" +
    "<tr><td>загрузок</td><td>" + (r.dl || 0).toLocaleString("ru-RU") + "</td></tr>" +
    "</table></div>" +
    '<div class="m-block"><div class="m-block-label">// пароль архива</div>' +
    '<div class="m-pass">' +
    '<button class="m-pass-code" data-copy-pass>' + esc(r.password || "-") + "</button>" +
    '<span class="m-pass-hint">клик — скопировать</span></div></div>' +
    dlPart +
    '<div class="m-footer"><button class="btn-report">сообщить об ошибке</button></div>';

  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");

  var dlBtn = body.querySelector("[data-bump]");
  if (dlBtn) dlBtn.addEventListener("click", function () {
    sb.rpc("bump_dl", { rid: parseInt(dlBtn.dataset.bump, 10) });
  });

  body.querySelector("[data-copy-pass]").addEventListener("click", function (e) {
    var txt = e.target.textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(txt);
    var hint = body.querySelector(".m-pass-hint");
    hint.textContent = "скопировано ✓";
    setTimeout(function () { hint.textContent = "клик — скопировать"; }, 1400);
  });

  var rep = body.querySelector(".btn-report");
  rep.addEventListener("click", function () {
    rep.textContent = "отправлено оператору";
    setTimeout(function () { rep.textContent = "сообщить об ошибке"; }, 2000);
  });
}

/* ---------- auth modal ---------- */

function openAuthModal() {
  var m = document.getElementById("authModal");
  m.classList.add("open");
  m.setAttribute("aria-hidden", "false");
  document.getElementById("authMsg").textContent = "";
}

function closeModal(el) {
  el.closest(".modal").classList.remove("open");
  el.closest(".modal").setAttribute("aria-hidden", "true");
}

function bindUi() {
  document.querySelectorAll("[data-close-modal]").forEach(function (el) {
    el.addEventListener("click", function () { closeModal(el); });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal.open").forEach(function (m) {
        m.classList.remove("open");
        m.setAttribute("aria-hidden", "true");
      });
    }
  });

  document.querySelectorAll(".tab").forEach(function (t) {
    t.addEventListener("click", function () {
      document.querySelectorAll(".tab").forEach(function (x) { x.classList.remove("active"); });
      t.classList.add("active");
      var isReg = t.dataset.tab === "register";
      document.getElementById("formLogin").style.display = isReg ? "none" : "";
      document.getElementById("formRegister").style.display = isReg ? "" : "none";
      document.getElementById("authMsg").textContent = "";
    });
  });

  document.getElementById("formLogin").addEventListener("submit", onLogin);
  document.getElementById("formRegister").addEventListener("submit", onRegister);
  document.getElementById("formUpload").addEventListener("submit", onUpload);

  document.getElementById("searchInput").addEventListener("input", function (e) {
    state.query = e.target.value.toLowerCase();
    document.getElementById("searchOk").classList.toggle("on", e.target.value.length > 0);
    render();
  });
  document.getElementById("sortSelect").addEventListener("change", function (e) {
    state.sort = e.target.value;
    render();
  });
  document.getElementById("viewCatalog").addEventListener("click", function () { toggleView("catalog"); });
}

function authMsg(text, cls) {
  var el = document.getElementById("authMsg");
  el.textContent = text;
  el.className = "auth-msg " + (cls || "");
}

function onLogin(e) {
  e.preventDefault();
  var email = document.getElementById("loginEmail").value.trim();
  var pass = document.getElementById("loginPass").value;
  authMsg("проверяю...", "dim");
  sb.auth.signInWithPassword({ email: email, password: pass }).then(function (res) {
    if (res.error) {
      authMsg(res.error.message, "err");
      return;
    }
    closeModal(document.getElementById("authModal").querySelector(".modal-close"));
    toast("добро пожаловать");
  });
}

function onRegister(e) {
  e.preventDefault();
  var name = document.getElementById("regName").value.trim();
  var email = document.getElementById("regEmail").value.trim();
  var pass = document.getElementById("regPass").value;
  if (!name) { authMsg("придумай ник", "err"); return; }
  authMsg("создаю...", "dim");
  sb.auth.signUp({
    email: email,
    password: pass,
    options: { data: { username: name } }
  }).then(function (res) {
    if (res.error) {
      authMsg(res.error.message, "err");
      return;
    }
    if (res.data.session) {
      closeModal(document.getElementById("authModal").querySelector(".modal-close"));
      toast("аккаунт создан");
    } else {
      authMsg("аккаунт создан. подтверди e-mail — придёт письмо (или выключи confirm email в supabase)", "ok");
    }
  });
}

/* ---------- upload ---------- */

function openUploadModal() {
  if (!state.user) {
    toast("сначала войди", true);
    openAuthModal();
    return;
  }
  var catList = document.getElementById("catList");
  catList.innerHTML = "";
  state.allCats.forEach(function (c) {
    var o = document.createElement("option");
    o.value = c;
    catList.appendChild(o);
  });
  var m = document.getElementById("uploadModal");
  m.classList.add("open");
  m.setAttribute("aria-hidden", "false");
}

function onUpload(e) {
  e.preventDefault();
  if (!state.user) return;

  var title = document.getElementById("upTitle").value.trim();
  var category = document.getElementById("upCategory").value.trim();
  var desc = document.getElementById("upDesc").value.trim();
  if (!title || !category || !desc) {
    toast("заполни название, категорию и описание", true);
    return;
  }

  var row = {
    title: title,
    version: document.getElementById("upVersion").value.trim(),
    type: document.getElementById("upType").value,
    category: category,
    platform: document.getElementById("upPlatform").value.trim(),
    size: document.getElementById("upSize").value.trim(),
    desc: desc,
    download_link: document.getElementById("upLink").value.trim(),
    password: document.getElementById("upPass").value.trim() || "-",
    uploader: state.user.id,
    uploader_name: state.profile ? state.profile.username : "anon"
  };

  sb.from("releases").insert(row).then(function (res) {
    if (res.error) {
      toast("ошибка: " + res.error.message, true);
      return;
    }
    closeModal(document.getElementById("uploadModal").querySelector(".modal-close"));
    document.getElementById("formUpload").reset();
    toast("отправлено на проверку ✓");
    loadReleases();
  });
}

/* ---------- ui helpers ---------- */

function toast(text, isErr) {
  var el = document.getElementById("toast");
  el.textContent = text;
  el.className = "toast on" + (isErr ? " err" : "");
  clearTimeout(el._t);
  el._t = setTimeout(function () { el.className = "toast"; }, 2400);
}

function fmtDate(iso) {
  if (!iso) return "?";
  return String(iso).slice(0, 10);
}

function pad(n) { return (n < 10 ? "0" : "") + n; }

function tick() {
  var now = new Date();
  var el = document.getElementById("clock");
  if (el) el.textContent = pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());
}

function esc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

document.addEventListener("DOMContentLoaded", init);