/* ==========================================================================
   DGV Season Store — 시즌 포인트/상점/기록 공용 저장소
   - localStorage 기반. 밸런서와 시즌 페이지가 함께 사용합니다.
   - Discord 봇 연동을 위한 JSON 스키마를 그대로 노출합니다.
   ========================================================================== */
(function () {
  "use strict";

  var KEY = "dgv.season.v1";

  function defaults() {
    return {
      version: 1,
      season: { name: "시즌 1", startedAt: new Date().toISOString().slice(0, 10) },
      players: {},
      history: [],
      orders: [],
      bot: { webhook: "", api: "" }
    };
  }

  function load() {
    var d;
    try {
      d = JSON.parse(localStorage.getItem(KEY) || "null");
    } catch (e) {
      d = null;
    }
    if (!d || typeof d !== "object") d = defaults();
    d.season = d.season || defaults().season;
    d.players = d.players || {};
    d.history = Array.isArray(d.history) ? d.history : [];
    d.orders = Array.isArray(d.orders) ? d.orders : [];
    d.bot = d.bot || { webhook: "", api: "" };
    return d;
  }

  function save(s) {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
      return true;
    } catch (e) {
      return false;
    }
  }

  function key(name) {
    return String(name || "").trim().toLowerCase();
  }

  function ensure(s, name, tier) {
    var k = key(name);
    if (!s.players[k]) {
      s.players[k] = {
        name: String(name || "").trim(),
        points: 0,
        games: 0,
        wins: 0,
        spent: 0,
        tier: tier || "",
        joinedAt: new Date().toISOString(),
        lastAt: null
      };
    }
    if (tier) s.players[k].tier = tier;
    return s.players[k];
  }

  function id(prefix) {
    return (prefix || "x") + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function applySettlement(payload) {
    var s = load();
    var at = new Date().toISOString();
    var total = 0;
    (payload.points || []).forEach(function (p) {
      if (!p || !String(p.name || "").trim()) return;
      var rec = ensure(s, p.name, p.tier);
      var points = Math.max(0, Math.round(Number(p.points) || 0));
      rec.points += points;
      rec.games += Math.max(0, Math.round(Number(p.games) || 0));
      rec.wins += Math.max(0, Math.round(Number(p.wins) || 0));
      rec.lastAt = at;
      total += points;
    });
    s.history.unshift({
      id: id("h"),
      at: at,
      title: payload.title || "내전 정산",
      teams: payload.teams || [],
      points: payload.points || [],
      total: total
    });
    s.history = s.history.slice(0, 100);
    save(s);
    return { ok: true, total: total, state: s };
  }

  function redeem(playerName, item) {
    var s = load();
    var rec = ensure(s, playerName);
    var price = Math.max(0, Math.round(Number(item.price) || 0));
    if (rec.points < price) {
      return { ok: false, reason: "points", state: s, need: price - rec.points };
    }
    var used = s.orders.filter(function (o) {
      return o.itemId === item.id && o.status !== "cancelled";
    }).length;
    if (typeof item.stock === "number" && used >= item.stock) {
      return { ok: false, reason: "stock", state: s };
    }
    rec.points -= price;
    rec.spent += price;
    var order = {
      id: id("o"),
      at: new Date().toISOString(),
      player: rec.name,
      itemId: item.id,
      name: item.name,
      emoji: item.emoji || "🎁",
      price: price,
      status: "pending"
    };
    s.orders.unshift(order);
    s.orders = s.orders.slice(0, 200);
    save(s);
    return { ok: true, order: order, state: s };
  }

  function cancelOrder(orderId) {
    var s = load();
    var idx = -1;
    s.orders.forEach(function (o, i) { if (o.id === orderId) idx = i; });
    if (idx < 0) return { ok: false, state: s };
    var o = s.orders[idx];
    if (o.status === "cancelled") return { ok: false, state: s };
    var rec = ensure(s, o.player);
    rec.points += o.price;
    rec.spent = Math.max(0, rec.spent - o.price);
    s.orders[idx] = Object.assign({}, o, { status: "cancelled", cancelledAt: new Date().toISOString() });
    save(s);
    return { ok: true, state: s };
  }

  function removeHistory(historyId) {
    var s = load();
    var h = null;
    s.history = s.history.filter(function (x) {
      if (x.id === historyId) { h = x; return false; }
      return true;
    });
    if (h) {
      (h.points || []).forEach(function (p) {
        var rec = s.players[key(p.name)];
        if (!rec) return;
        rec.points = Math.max(0, rec.points - (Number(p.points) || 0));
        rec.games = Math.max(0, rec.games - (Number(p.games) || 0));
        rec.wins = Math.max(0, rec.wins - (Number(p.wins) || 0));
      });
    }
    save(s);
    return { ok: !!h, state: s };
  }

  function reset(keepBot) {
    var d = defaults();
    if (keepBot) {
      var old = load();
      d.bot = old.bot;
      d.season = old.season;
    }
    save(d);
    return d;
  }

  function snapshot(s) {
    s = s || load();
    var rows = Object.keys(s.players).map(function (k) {
      var p = s.players[k];
      return {
        name: p.name,
        points: p.points,
        games: p.games,
        wins: p.wins,
        winRate: p.games ? Math.round((p.wins / p.games) * 1000) / 10 : 0,
        tier: p.tier || "",
        lastAt: p.lastAt
      };
    }).sort(function (a, b) { return b.points - a.points || b.wins - a.wins; });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    return {
      season: s.season.name,
      updatedAt: new Date().toISOString(),
      leaderboard: rows,
      shop: (window.DGV_SHOP || []).map(function (it) {
        var used = s.orders.filter(function (o) {
          return o.itemId === it.id && o.status !== "cancelled";
        }).length;
        return {
          id: it.id, name: it.name, price: it.price,
          stock: Math.max(0, it.stock - used)
        };
      }),
      orders: s.orders.slice(0, 30)
    };
  }

  window.DGVStore = {
    KEY: KEY,
    defaults: defaults,
    load: load,
    save: save,
    ensure: ensure,
    key: key,
    applySettlement: applySettlement,
    redeem: redeem,
    cancelOrder: cancelOrder,
    removeHistory: removeHistory,
    reset: reset,
    snapshot: snapshot
  };
})();
