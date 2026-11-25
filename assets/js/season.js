/* ==========================================================================
   시즌 허브 — 랭킹 / 상점 / 기록 / 봇 연동
   ========================================================================== */
(function () {
  "use strict";

  if (!window.DGVStore) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var fmt = function (n) { return Math.round(Number(n) || 0).toLocaleString("ko-KR"); };

  var SHOP = [
    { id: "vp620", emoji: "🔫", name: "발로란트 620 VP", desc: "원하는 스킨 하나쯤은 사야죠. 계정 지급.", price: 3000, stock: 10, cat: "게임" },
    { id: "vp1375", emoji: "💥", name: "발로란트 1,375 VP", desc: "배틀패스 + 스킨 조합용. 계정 지급.", price: 6500, stock: 5, cat: "게임" },
    { id: "nitro", emoji: "💬", name: "디스코드 니트로 1개월", desc: "서버 부스트 없이도 이모지 자유. 선물 링크 지급.", price: 8000, stock: 5, cat: "디스코드" },
    { id: "coffee", emoji: "☕", name: "카페 아메리카노", desc: "내전하다 졸릴 때. 기프티콘 발송.", price: 4500, stock: 20, cat: "기프티콘" },
    { id: "chicken", emoji: "🍗", name: "치킨 기프티콘", desc: "5인 내전 우승 기념으로 딱. 브랜드 협의.", price: 10000, stock: 3, cat: "기프티콘" },
    { id: "title", emoji: "🏷️", name: "커스텀 칭호", desc: "디스코드 닉네임 옆에 붙는 시즌 한정 칭호.", price: 1500, stock: 99, cat: "서버" },
    { id: "mvp", emoji: "🥇", name: "내전 MVP 배지", desc: "프로필에 표시되는 MVP 배지. 시즌 종료 시 회수.", price: 2000, stock: 50, cat: "서버" },
    { id: "warn", emoji: "🏷️", name: "경고 차감권", desc: "경고 1회를 차감합니다. 서버 공지 기준 10,000코인.", price: 10000, stock: 10, cat: "서버" },
    { id: "jersey", emoji: "👕", name: "대깨발 굿즈 티셔츠", desc: "서버 로고 커스텀 티셔츠. 사이즈 협의 후 제작.", price: 15000, stock: 2, cat: "굿즈" }
  ];
  window.DGV_SHOP = SHOP;

  var ui = { tab: "rank", q: "", sort: "points", item: null };

  function toast(msg) {
    var el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("is-on");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("is-on"); }, 2600);
  }

  function load() { return window.DGVStore.load(); }
  function save(s) { window.DGVStore.save(s); }

  /* ---------------------------------------------------------------- stats */
  function renderStats() {
    var s = load();
    var rows = Object.keys(s.players);
    var awarded = s.history.reduce(function (a, h) { return a + (Number(h.total) || 0); }, 0);
    var pending = s.orders.filter(function (o) { return o.status === "pending"; }).length;

    $("#stat-players").innerHTML = rows.length + "<em>명</em>";
    $("#stat-points").innerHTML = fmt(awarded) + "<em>P</em>";
    $("#stat-games").innerHTML = s.history.length + "<em>회</em>";
    $("#stat-orders").innerHTML = pending + "<em>건</em>";
    $("#tab-shop-cnt").textContent = pending;
    $("#tab-hist-cnt").textContent = s.history.length;
    $("#hist-count").textContent = s.history.length;
  }

  /* ---------------------------------------------------------------- ranks */
  function sortedPlayers() {
    var s = load();
    var list = Object.keys(s.players).map(function (k) {
      var p = s.players[k];
      return {
        name: p.name,
        points: p.points,
        games: p.games,
        wins: p.wins,
        tier: p.tier || "",
        winRate: p.games ? (p.wins / p.games) * 100 : 0,
        lastAt: p.lastAt
      };
    });
    var q = ui.q.trim().toLowerCase();
    if (q) list = list.filter(function (p) { return p.name.toLowerCase().indexOf(q) >= 0; });
    list.sort(function (a, b) {
      if (ui.sort === "winRate") return b.winRate - a.winRate || b.points - a.points;
      if (ui.sort === "games") return b.games - a.games || b.points - a.points;
      if (ui.sort === "name") return a.name.localeCompare(b.name, "ko");
      return b.points - a.points || b.wins - a.wins;
    });
    return list;
  }

  function renderRank() {
    var all = sortedPlayers();
    var s = load();
    var hasData = Object.keys(s.players).length > 0;
    $("#rank-empty").hidden = hasData;
    $(".rank-wrap table").style.display = hasData ? "" : "none";
    $("#podium").innerHTML = "";

    if (!hasData) return;

    var top = all.slice(0, 3);
    if (top.length) {
      var medals = ["🥇", "🥈", "🥉"];
      $("#podium").innerHTML = top.map(function (p, i) {
        return '<div class="pod pod--' + (i + 1) + '">' +
          '<div class="pod__medal">' + medals[i] + "</div>" +
          '<div class="pod__name">' + esc(p.name) + "</div>" +
          '<div class="pod__tier">' + esc(p.tier || "TIER ?") + "</div>" +
          '<div class="pod__pts">' + fmt(p.points) + "<small>P</small></div>" +
          '<div class="pod__win">' + fmt(p.games) + "경기 · 승률 " + p.winRate.toFixed(0) + "%</div>" +
          "</div>";
      }).join("");
    }

    var max = all.reduce(function (m, p) { return Math.max(m, p.points); }, 1);
    $("#rank-body").innerHTML = all.map(function (p, i) {
      return "<tr>" +
        '<td class="rk ' + (i < 3 ? "top" : "") + '">' + (i + 1) + "</td>" +
        '<td><span class="who"><b>' + esc(p.name) + "</b>" +
        (p.tier ? '<span class="tierbadge">' + esc(p.tier) + "</span>" : "") + "</span></td>" +
        '<td class="num">' + fmt(p.games) + "</td>" +
        '<td class="num">' + fmt(p.wins) + "</td>" +
        '<td class="num wr">' + p.winRate.toFixed(0) + "%</td>" +
        '<td class="meter"><div class="meter__track"><div class="meter__fill" style="width:' +
        Math.max(2, (p.points / max) * 100).toFixed(1) + '%"></div></div></td>' +
        '<td class="pts">' + fmt(p.points) + " P</td>" +
        "</tr>";
    }).join("");
  }

  /* ----------------------------------------------------------------- shop */
  function shopUsed(itemId) {
    return load().orders.filter(function (o) {
      return o.itemId === itemId && o.status !== "cancelled";
    }).length;
  }

  function renderShop() {
    var s = load();
    var players = Object.keys(s.players).map(function (k) { return s.players[k]; });
    $("#shop-grid").innerHTML = SHOP.map(function (it) {
      var left = it.stock - shopUsed(it.id);
      var sold = left <= 0;
      return '<article class="shop-card' + (sold ? " is-soldout" : "") + '">' +
        '<div class="shop-card__top"><span class="shop-card__emoji">' + it.emoji + "</span>" +
        '<span class="shop-card__stock' + (left <= 3 ? " low" : "") + '">' +
        (sold ? "품절" : left + "개 남음") + "</span></div>" +
        "<h3>" + esc(it.name) + "</h3><p>" + esc(it.desc) + "</p>" +
        '<div class="shop-card__foot"><span class="shop-card__price">' + fmt(it.price) + "<small>P</small></span>" +
        '<button class="btn ' + (sold ? "btn--line" : "btn--primary") + '" type="button" data-buy="' + it.id + '"' +
        (sold || !players.length ? " disabled" : "") + ">" + (sold ? "품절" : "교환") + "</button></div></article>";
    }).join("");

    var orders = s.orders.slice(0, 20);
    if (!orders.length) {
      $("#orders-list").innerHTML = '<div class="empty" style="padding:26px;border:1px solid var(--line)">아직 교환 신청이 없습니다.</div>';
      return;
    }
    $("#orders-list").innerHTML = orders.map(function (o) {
      var date = new Date(o.at);
      var statusCls = o.status === "done" ? "done" : o.status === "cancelled" ? "cancelled" : "";
      var statusTxt = o.status === "done" ? "지급 완료" : o.status === "cancelled" ? "취소됨" : "대기 중";
      return '<div class="order">' +
        '<span class="order__emoji">' + (o.emoji || "🎁") + "</span>" +
        '<span class="order__who">' + esc(o.player) + "</span>" +
        '<span class="order__item">' + esc(o.name) + "</span>" +
        '<time datetime="' + o.at + '">' + date.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) + "</time>" +
        '<span class="order__status ' + statusCls + '">' + statusTxt + "</span>" +
        '<span class="order__price">-' + fmt(o.price) + " P</span>" +
        (o.status === "pending" ? '<button class="order__cancel" type="button" data-cancel="' + o.id + '">취소·환불</button>' : "") +
        "</div>";
    }).join("");
  }

  function openModal(item) {
    var s = load();
    var players = Object.keys(s.players).map(function (k) { return s.players[k]; })
      .filter(function (p) { return p.points >= item.price; })
      .sort(function (a, b) { return b.points - a.points; });

    if (!players.length) {
      toast("이 상품을 교환할 수 있는 포인트를 가진 참가자가 없습니다.");
      return;
    }
    ui.item = item;
    $("#redeem-emoji").textContent = item.emoji;
    $("#redeem-title").textContent = item.name;
    $("#redeem-price").textContent = fmt(item.price) + " P";
    $("#redeem-player").innerHTML = players.map(function (p) {
      return '<option value="' + esc(p.name) + '">' + esc(p.name) + " · " + fmt(p.points) + "P</option>";
    }).join("");
    $("#redeem-modal").hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(function () { $("#redeem-confirm").focus(); }, 30);
  }

  function closeModal() {
    $("#redeem-modal").hidden = true;
    document.body.style.overflow = "";
    ui.item = null;
  }

  /* -------------------------------------------------------------- history */
  function renderHistory() {
    var s = load();
    var list = s.history;
    $("#history-empty").hidden = list.length > 0;
    $("#history-list").innerHTML = list.map(function (h) {
      var d = new Date(h.at);
      var total = h.total || h.points.reduce(function (a, p) { return a + (Number(p.points) || 0); }, 0);
      var chips = h.points.map(function (p) {
        return '<span class="hist__chip">' + esc(p.name) + " <b>+" + fmt(p.points) + "P</b></span>";
      }).join("");
      return '<article class="hist">' +
        '<div class="hist__head">' +
        '<span class="hist__title">' + esc(h.title || "내전 정산") + "</span>" +
        '<span class="hist__date">' + d.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) + "</span>" +
        '<span class="hist__total">+' + fmt(total) + " P</span>" +
        '<button class="hist__del" type="button" data-hist="' + h.id + '">삭제</button>' +
        "</div>" +
        "<details><summary>참가자 " + h.points.length + "명 · 팀 " + (h.teams ? h.teams.length : 0) + "개</summary>" +
        '<div class="hist__body">' + chips + "</div></details></article>";
    }).join("");
  }

  /* ------------------------------------------------------------------ bot */
  function payload() {
    return window.DGVStore.snapshot(load());
  }

  function renderBot() {
    var s = load();
    if (!document.activeElement || !document.activeElement.closest || !document.activeElement.closest("#tab-bot")) {
      $("#bot-webhook").value = s.bot.webhook || "";
      $("#bot-api").value = s.bot.api || "";
    }
    $("#bot-json").textContent = JSON.stringify(payload(), null, 2);
  }

  function renderAll() {
    renderStats();
    renderRank();
    renderShop();
    renderHistory();
    renderBot();
  }

  /* --------------------------------------------------------------- events */
  function bind() {
    $$(".tabs button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var tab = btn.getAttribute("data-tab");
        ui.tab = tab;
        $$(".tabs button").forEach(function (b) {
          var on = b === btn;
          b.classList.toggle("is-active", on);
          b.setAttribute("aria-selected", on ? "true" : "false");
        });
        $$(".panel-tab").forEach(function (p) {
          p.hidden = p.id !== "tab-" + tab;
        });
        history.replaceState(null, "", "#" + tab);
      });
    });

    var search = $("#rank-search");
    if (search) search.addEventListener("input", function () {
      ui.q = search.value;
      renderRank();
    });

    var sort = $("#rank-sort");
    if (sort) sort.addEventListener("change", function () {
      ui.sort = sort.value;
      renderRank();
    });

    var demo = $("#seed-demo");
    if (demo) demo.addEventListener("click", function () { seedDemo(); });
    var emptySeed = $("#empty-seed");
    if (emptySeed) emptySeed.addEventListener("click", function () { seedDemo(); });

    var reset = $("#reset-season");
    if (reset) reset.addEventListener("click", function () {
      if (!confirm("시즌을 초기화할까요?\n모든 참가자 포인트, 교환 내역, 정산 기록이 삭제됩니다. (봇 설정은 유지)")) return;
      window.DGVStore.reset(true);
      renderAll();
      toast("시즌을 초기화했습니다.");
    });

    var grid = $("#shop-grid");
    if (grid) grid.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-buy]");
      if (!btn) return;
      var item = SHOP.filter(function (i) { return i.id === btn.getAttribute("data-buy"); })[0];
      if (item) openModal(item);
    });

    var orders = $("#orders-list");
    if (orders) orders.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-cancel]");
      if (!btn) return;
      if (!confirm("교환 신청을 취소하고 포인트를 환불할까요?")) return;
      window.DGVStore.cancelOrder(btn.getAttribute("data-cancel"));
      renderAll();
      toast("신청을 취소하고 포인트를 돌려받았습니다.");
    });

    $("#redeem-cancel").addEventListener("click", closeModal);
    $$("#redeem-modal [data-close]").forEach(function (el) {
      el.addEventListener("click", closeModal);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !$("#redeem-modal").hidden) closeModal();
    });

    $("#redeem-confirm").addEventListener("click", function () {
      if (!ui.item || $("#redeem-modal").hidden) return;
      var name = $("#redeem-player").value;
      var res = window.DGVStore.redeem(name, ui.item);
      if (!res.ok) {
        closeModal();
        renderAll();
        if (res.reason === "points") toast("포인트가 부족합니다. " + fmt(res.need) + "P 더 필요합니다.");
        else toast("재고가 없습니다.");
        return;
      }
      var rec = res.state.players[window.DGVStore.key(name)];
      closeModal();
      renderAll();
      toast("교환 신청 완료! 남은 포인트 " + fmt(rec ? rec.points : 0) + "P");
      notifyOrder(res.order, rec ? rec.points : 0);
    });

    var hist = $("#history-list");
    if (hist) hist.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-hist]");
      if (!btn) return;
      if (!confirm("이 정산 기록을 삭제할까요?\n해당 기록으로 지급된 포인트도 함께 차감됩니다.")) return;
      window.DGVStore.removeHistory(btn.getAttribute("data-hist"));
      renderAll();
      toast("기록을 삭제하고 포인트를 차감했습니다.");
    });

    var clearHist = $("#clear-history");
    if (clearHist) clearHist.addEventListener("click", function () {
      if (!confirm("모든 정산 기록을 삭제할까요?\n기록으로 지급된 포인트도 모두 차감됩니다.")) return;
      var s = load();
      s.history.slice().forEach(function (h) { window.DGVStore.removeHistory(h.id); });
      renderAll();
      toast("정산 기록을 모두 삭제했습니다.");
    });

    $("#bot-save").addEventListener("click", function () {
      var s = load();
      s.bot.webhook = $("#bot-webhook").value.trim();
      s.bot.api = $("#bot-api").value.trim();
      save(s);
      toast("봇 연동 설정을 저장했습니다.");
    });

    $("#bot-copy").addEventListener("click", function () {
      copyText(JSON.stringify(payload(), null, 2), "봇 연동 JSON을 복사했습니다.");
    });

    $("#bot-send").addEventListener("click", function () {
      var s = load();
      var url = s.bot.webhook || $("#bot-webhook").value.trim();
      if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(url)) {
        toast("알림 웹훅 URL을 먼저 저장해 주세요.");
        return;
      }
      var p = payload();
      var top = p.leaderboard.slice(0, 5);
      var payloadMsg = {
        username: "대깨발 시즌",
        embeds: [{
          title: "🏆 " + p.season + " 랭킹",
          description: top.map(function (x, i) {
            return "**" + (i + 1) + ". " + x.name + "** · " + fmt(x.points) + "P · " + x.games + "경기 승률 " + x.winRate + "%";
          }).join("\n") || "기록 없음",
          color: 0xff4655,
          footer: { text: "daeggabal.kr/season" },
          timestamp: new Date().toISOString()
        }]
      };
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadMsg)
      }).then(function (res) {
        toast(res.ok ? "디스코드로 랭킹을 전송했습니다." : "전송 실패 (" + res.status + ")");
      }).catch(function () { toast("전송 실패. 웹훅 URL을 확인해 주세요."); });
    });

    window.addEventListener("storage", function (e) {
      if (e.key === window.DGVStore.KEY) renderAll();
    });

    /* hash tab */
    var hash = (location.hash || "").replace("#", "");
    if (["rank", "shop", "history", "bot"].indexOf(hash) >= 0) {
      var btn = $('.tabs button[data-tab="' + hash + '"]');
      if (btn) btn.click();
    }
  }

  function notifyOrder(order, left) {
    var s = load();
    var url = s.bot.webhook;
    if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(url)) return;
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "대깨발 상점",
        embeds: [{
          title: "🎁 포인트 교환 신청",
          color: 0xffcf5c,
          fields: [
            { name: "참가자", value: order.player, inline: true },
            { name: "상품", value: order.name, inline: true },
            { name: "차감", value: fmt(order.price) + " P", inline: true },
            { name: "남은 포인트", value: fmt(left) + " P", inline: true },
            { name: "상태", value: "대기 중 · 운영진 확인 필요", inline: false }
          ],
          timestamp: new Date().toISOString(),
          footer: { text: "daeggabal.kr/season" }
        }]
      })
    }).catch(function () {});
  }

  function copyText(text, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg); },
        function () { fallback(text, okMsg); });
    } else fallback(text, okMsg);
  }

  function fallback(text, okMsg) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); toast(okMsg); } catch (e) { toast("복사에 실패했습니다."); }
    document.body.removeChild(ta);
  }

  /* ------------------------------------------------------------- demo data */
  function seedDemo() {
    if (Object.keys(load().players).length && !confirm("이미 시즌 데이터가 있습니다. 데모 데이터를 추가로 적립할까요?")) return;
    var roster = [
      ["대가리깨짐", "레디언트", 8], ["제트장인", "불멸 3", 7], ["오멘만함", "불멸 2", 6],
      ["사이퍼충", "초월자 3", 6], ["브림스톤", "초월자 1", 5], ["제트각", "다이아 3", 4],
      ["플래탈출", "플래티넘 2", 4], ["골드수문장", "골드 3", 3], ["실버1등", "실버 2", 2],
      ["브론즈영웅", "브론즈 3", 2], ["야스오장인", "다이아 1", 3], ["킬조이만함", "골드 1", 3]
    ];
    function settle(title, offset, ratio) {
      var points = roster.map(function (r, i) {
        var games = Math.max(1, Math.round((r[2] + offset) * ratio));
        var wins = Math.max(0, Math.round(games * (0.3 + ((i * 7) % 5) / 10)));
        return { name: r[0], tier: r[1], games: games, wins: wins, points: games * 150 + wins * 70 };
      });
      window.DGVStore.applySettlement({
        title: title,
        teams: [points.slice(0, 5).map(function (p) { return p.name; }), points.slice(5, 10).map(function (p) { return p.name; })],
        points: points
      });
    }
    settle("데모 · 11/18 내전", 2, 1);
    settle("데모 · 11/22 내전", 0, 0.7);
    renderAll();
    toast("데모 시즌 데이터를 만들었습니다.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { bind(); renderAll(); });
  } else {
    bind(); renderAll();
  }
})();
