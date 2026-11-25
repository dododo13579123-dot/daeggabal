/* ==========================================================================
   대깨발 내전 밸런서
   - 티어/MMR 기반 팀 밸런싱 (2~8팀)
   - 싱글 엘리미네이션 토너먼트 + 부전승 자동 처리
   - 포인트 자동 정산 / 디스코드 웹훅 / 링크 공유 / CSV
   - localStorage 자동 저장
   ========================================================================== */
(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var uid = function () {
    return "p" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  };

  var STORE_KEY = "dgv.balancer.v1";
  var TEAM_COLORS = ["#ff4655", "#22d3ee", "#fbbf24", "#a78bfa", "#34d399", "#f472b6", "#fb923c", "#60a5fa"];
  var TEAM_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

  /* ---------------------------------------------------------------- tiers */
  var TIERS = (function () {
    var names = ["아이언", "브론즈", "실버", "골드", "플래티넘", "다이아", "초월자", "불멸", "레디언트"];
    var out = [];
    names.forEach(function (n, i) {
      if (i === 8) {
        out.push({ v: "8-1", label: "레디언트", base: 2500 });
        return;
      }
      for (var d = 1; d <= 3; d++) {
        out.push({ v: i + "-" + d, label: n + " " + d, base: i * 300 + (d - 1) * 100 + 100 });
      }
    });
    return out;
  })();

  var TIER_MAP = {};
  TIERS.forEach(function (t) { TIER_MAP[t.v] = t; });

  var TIER_ALIASES = [
    ["레디언트", 8], ["레디", 8],
    ["불멸", 7], ["초월자", 6], ["초월", 6],
    ["다이아", 5], ["플래티넘", 4], ["플래", 4], ["플레", 4],
    ["골드", 3], ["실버", 2], ["브론즈", 1], ["아이언", 0]
  ];

  function tierByValue(v) { return TIER_MAP[v] || TIERS[0]; }

  function mmrOf(tierValue, rr) {
    var t = tierByValue(tierValue);
    return t.base + clamp(Number(rr) || 0, 0, 100) * 1;
  }

  function parseTierToken(raw) {
    if (!raw) return null;
    var s = String(raw).replace(/\s+/g, "").toLowerCase();
    for (var i = 0; i < TIERS.length; i++) {
      if (TIERS[i].label.replace(/\s+/g, "").toLowerCase() === s) return TIERS[i].v;
    }
    for (var a = 0; a < TIER_ALIASES.length; a++) {
      var name = TIER_ALIASES[a][0];
      if (s.indexOf(name) === 0) {
        var base = TIER_ALIASES[a][1];
        if (base === 8) return "8-1";
        var div = parseInt(s.slice(name.length), 10);
        if (!div || div < 1 || div > 3) div = 1;
        return base + "-" + div;
      }
    }
    return null;
  }

  /* ---------------------------------------------------------------- state */
  var state = {
    players: [],
    settings: { teams: 2, size: 5, weight: 60, auto: true },
    teams: null,
    bracket: null,
    settled: "",
    rule: { play: 150, win: 70 }
  };

  var playerById = {};
  var recalcScores = function () {
    var w = clamp(Number(state.settings.weight) || 0, 0, 100) / 100;
    playerById = {};
    state.players.forEach(function (p) {
      p.curMmr = mmrOf(p.tier, p.rr);
      p.peakMmr = mmrOf(p.peakTier || p.tier, p.peakRR);
      p.score = p.curMmr * w + p.peakMmr * (1 - w);
      playerById[p.id] = p;
    });
  };

  var activePlayers = function () {
    return state.players.filter(function (p) { return p.active && String(p.name).trim(); });
  };

  /* ---------------------------------------------------------------- utils */
  var toastEl = $("#toast"), toastTimer;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("is-on"); }, 2600);
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) { /* ignore quota */ }
  }

  function teamsValid() {
    if (!state.teams || !state.teams.length) return false;
    return state.teams.every(function (t) {
      return t.every(function (id) { return !!playerById[id]; });
    });
  }

  /* ------------------------------------------------------------ balancing */
  function sumsOf(teams, scores) {
    return teams.map(function (t) {
      return t.reduce(function (s, p) {
        return s + (scores[typeof p === "string" ? p : p.id] || 0);
      }, 0);
    });
  }

  function costFromSums(sums) {
    var mean = sums.reduce(function (a, b) { return a + b; }, 0) / sums.length;
    var spread = Math.max.apply(null, sums) - Math.min.apply(null, sums);
    var sq = sums.reduce(function (a, s) { return a + (s - mean) * (s - mean); }, 0) / sums.length;
    return spread * 1.6 + Math.sqrt(sq);
  }

  function snakeAssign(order, k) {
    var teams = [];
    for (var i = 0; i < k; i++) teams.push([]);
    var dir = 1, idx = 0;
    order.forEach(function (p) {
      teams[idx].push(p);
      idx += dir;
      if (idx === k) { idx = k - 1; dir = -1; }
      else if (idx < 0) { idx = 0; dir = 1; }
    });
    return teams;
  }

  function localSearch(teams, scores) {
    var sums = sumsOf(teams, scores);
    var guard = 0, improved = true;
    while (improved && guard++ < 120) {
      improved = false;
      for (var a = 0; a < teams.length; a++) {
        for (var b = a + 1; b < teams.length; b++) {
          if (teams[a].length !== teams[b].length) continue;
          for (var i = 0; i < teams[a].length; i++) {
            for (var j = 0; j < teams[b].length; j++) {
              var pa = teams[a][i], pb = teams[b][j];
              var da = scores[pa.id], db = scores[pb.id];
              var trial = sums.slice();
              trial[a] = sums[a] - da + db;
              trial[b] = sums[b] - db + da;
              if (costFromSums(trial) + 1e-9 < costFromSums(sums)) {
                teams[a][i] = pb;
                teams[b][j] = pa;
                sums = trial;
                improved = true;
              }
            }
          }
        }
      }
    }
  }

  function buildTeams() {
    var active = activePlayers();
    if (active.length < 2) return null;
    var k = Math.min(Number(state.settings.teams) || 2, Math.max(2, Math.floor(active.length / 2)));
    var scores = {};
    active.forEach(function (p) { scores[p.id] = p.score; });

    var sorted = active.slice().sort(function (x, y) { return scores[y.id] - scores[x.id]; });
    var best = null;
    var attempts = active.length > 24 ? 12 : 26;

    for (var a = 0; a < attempts; a++) {
      var order = sorted.slice();
      if (a > 0) {
        order.sort(function (x, y) {
          return (scores[y.id] + (Math.random() - 0.5) * 110) - (scores[x.id] + (Math.random() - 0.5) * 110);
        });
      }
      var teams = snakeAssign(order, k);
      localSearch(teams, scores);
      var cost = costFromSums(sumsOf(teams, scores));
      if (!best || cost < best.cost) best = { teams: teams, cost: cost };
    }
    return best ? best.teams : null;
  }

  function balanceStats(teams) {
    var sums = sumsOf(teams, mapScores());
    var avgs = teams.map(function (t, i) { return sums[i] / (t.length || 1); });
    var mean = avgs.reduce(function (a, b) { return a + b; }, 0) / (avgs.length || 1);
    var spread = Math.max.apply(null, avgs) - Math.min.apply(null, avgs);
    var rel = mean ? (spread / mean) * 100 : 0;
    var score = clamp(100 - rel * 3.2, 0, 100);
    return { sums: sums, avgs: avgs, mean: mean, spread: spread, score: Math.round(score * 10) / 10 };
  }

  var mapScores = function () {
    var m = {};
    state.players.forEach(function (p) { m[p.id] = p.score; });
    return m;
  };

  function balance(announce) {
    recalcScores();
    var teams = buildTeams();
    if (!teams) { toast("참가자를 2명 이상 등록해 주세요."); return; }
    state.teams = teams.map(function (t) { return t.map(function (p) { return p.id; }); });
    state.bracket = buildBracket();
    renderAll();
    save();
    if (announce) toast("팀 밸런싱 완료 · " + (state.teams.length) + "팀");
  }

  /* -------------------------------------------------------------- bracket */
  function seedOrder(n) {
    var arr = [1, 2];
    for (var r = 1; r < Math.round(Math.log2(n)); r++) {
      var len = arr.length * 2 + 1;
      var next = [];
      arr.forEach(function (s) { next.push(s, len - s); });
      arr = next;
    }
    return arr;
  }

  function teamAvg(teamIds) {
    return teamIds.reduce(function (s, id) { return s + playerById[id].score; }, 0) / (teamIds.length || 1);
  }

  function buildBracket() {
    var teams = state.teams || [];
    var k = teams.length;
    if (k < 2) return null;
    var size = 1 << Math.ceil(Math.log2(k));
    var order = seedOrder(size);
    var ranked = teams.map(function (t, i) { return { i: i, avg: teamAvg(t) }; })
      .sort(function (a, b) { return b.avg - a.avg; })
      .map(function (x) { return x.i; });

    var seeds = order.map(function (s) { return s <= k ? ranked[s - 1] : null; });
    var rounds = [[]];
    for (var i = 0; i < seeds.length; i += 2) {
      var a = seeds[i], b = seeds[i + 1];
      rounds[0].push({
        a: a, b: b, sa: null, sb: null,
        bye: a === null || b === null,
        round: 0, index: i / 2
      });
    }
    var count = Math.round(Math.log2(size));
    for (var r = 1; r < count; r++) {
      var arr = [];
      var prev = rounds[r - 1].length / 2;
      for (var m = 0; m < prev; m++) arr.push({ a: null, b: null, sa: null, sb: null, bye: false, round: r, index: m });
      rounds.push(arr);
    }
    var br = { rounds: rounds, size: size };
    refreshBracket(br);
    return br;
  }

  function matchWinner(m, r) {
    if (m.a === null && m.b === null) return null;
    if (r === 0) {
      if (m.a === null) return m.b;
      if (m.b === null) return m.a;
    } else {
      if (m.a === null || m.b === null) return null;
    }
    if (m.sa === null || m.sb === null) return null;
    if (m.sa === m.sb) return null;
    return m.sa > m.sb ? m.a : m.b;
  }

  function refreshBracket(br) {
    if (!br) return;
    br.rounds.forEach(function (round, r) {
      round.forEach(function (m) {
        if (r > 0) {
          var prev = br.rounds[r - 1];
          var na = matchWinner(prev[m.index * 2], r - 1);
          var nb = matchWinner(prev[m.index * 2 + 1], r - 1);
          if (na !== m.a || nb !== m.b) {
            m.a = na; m.b = nb;
            m.sa = null; m.sb = null;
          }
        }
        m.winner = matchWinner(m, r);
      });
    });
  }

  /* --------------------------------------------------------------- render */
  function renderAll() {
    recalcScores();
    renderStats();
    renderResult();
    renderBracket();
    renderPoints();
  }

  function renderStats() {
    var active = activePlayers().length;
    var st = $("#stat-players");
    if (st) st.textContent = active;
    var tt = $("#stat-teams");
    if (tt) tt.textContent = state.teams ? state.teams.length : 0;
    var av = $("#stat-avg");
    if (av) av.textContent = state.teams ? Math.round(balanceStats(state.teams).mean) : 0;
  }

  function renderResult() {
    var wrap = $("#result");
    if (!wrap) return;
    if (!state.teams || !teamsValid()) {
      wrap.innerHTML =
        '<div class="pnl" style="margin-top:20px">' +
        '<div class="pnl__head"><h3>밸런스 결과</h3></div>' +
        '<div class="result__empty" style="padding:40px 20px;text-align:center;color:#a3a3b0;font-size:14px">' +
        '명단을 입력하고 <b style="color:#fff">밸런스 실행</b>을 누르면 팀과 대진표가 자동으로 만들어집니다.' +
        "</div></div>";
      return;
    }
    var stats = balanceStats(state.teams);
    var grade = stats.score >= 95 ? ["S", "완벽에 가까운 밸런스"] :
      stats.score >= 88 ? ["A", "아주 좋은 밸런스"] :
      stats.score >= 78 ? ["B", "무난한 밸런스"] :
      stats.score >= 65 ? ["C", "약간의 실력 차"] : ["D", "팀 재구성 권장"];

    var html = '<div class="result">';
    html += '<div class="result__top">';
    html += '<div class="gauge" style="--pct:' + stats.score + '">' +
      '<div class="gauge__in"><div class="gauge__num">' + Math.round(stats.score) + '<small>점</small></div>' +
      '<div class="gauge__label">BALANCE SCORE</div></div></div>';
    html += '<div class="result__summary">' +
      "<h3>팀 <em>" + state.teams.length + "개</em>로 나눴습니다</h3>" +
      "<p>팀 평균 MMR 차이는 <b>" + stats.spread.toFixed(1) + "</b>점. " +
      (stats.spread < 40 ? "거의 완벽하게 맞았습니다. 바로 시작하세요." :
        stats.spread < 100 ? "충분히 공정한 편입니다. 내전하기 좋아요." :
          "차이가 조금 큽니다. '다시 섞기'를 눌러 한 번 더 돌려보세요.") + "</p>" +
      '<span class="grade">GRADE ' + grade[0] + " · " + grade[1] + "</span>" +
      '<div class="result__stats">' +
      "<span>전체 평균 <b>" + stats.mean.toFixed(1) + "</b></span>" +
      "<span>최고 팀 <b>" + Math.max.apply(null, stats.avgs).toFixed(1) + "</b></span>" +
      "<span>최저 팀 <b>" + Math.min.apply(null, stats.avgs).toFixed(1) + "</b></span>" +
      "<span>참가 <b>" + activePlayers().length + "명</b></span>" +
      "</div></div></div>";

    html += '<div class="teams">';
    state.teams.forEach(function (teamIds, i) {
      var color = TEAM_COLORS[i % TEAM_COLORS.length];
      var sum = stats.sums[i];
      var avg = sum / (teamIds.length || 1);
      var diff = avg - stats.mean;
      var diffCls = Math.abs(diff) < 1 ? "even" : diff > 0 ? "up" : "down";
      var diffText = (diff > 0 ? "+" : "") + diff.toFixed(1);
      html += '<article class="team" style="--accent:' + color + '">' +
        '<span class="team__flag"></span>' +
        '<div class="team__head"><div><div class="team__name">TEAM ' + TEAM_LETTERS[i] +
        "<small>" + teamIds.length + " PLAYERS</small></div></div>" +
        '<div class="team__avg"><b>' + avg.toFixed(1) + '</b><span>AVG MMR</span>' +
        '<div class="team__diff ' + diffCls + '">' + diffText + "</div></div></div>" +
        '<div class="team__list">';
      teamIds.slice().sort(function (x, y) { return playerById[y].score - playerById[x].score; })
        .forEach(function (id, idx) {
          var p = playerById[id];
          html += '<div class="tmember"><span class="tmember__rank">' + String(idx + 1).padStart(2, "0") + "</span>" +
            '<span class="tmember__name">' + esc(p.name) +
            '<span class="tmember__tier">' + esc(tierByValue(p.tier).label) + " · " + Number(p.rr || 0) + "RR</span></span>" +
            '<span class="tmember__score">' + p.score.toFixed(0) + "</span></div>";
        });
      html += "</div><div class=\"team__bar\"><i style=\"width:0\"></i></div></article>";
    });
    html += "</div>";

    var maxSum = Math.max.apply(null, stats.avgs) || 1;
    html += '<div class="compare"><h3>TEAM MMR COMPARISON</h3>';
    state.teams.forEach(function (teamIds, i) {
      var color = TEAM_COLORS[i % TEAM_COLORS.length];
      var avg = stats.avgs[i];
      html += '<div class="cbar" style="--accent:' + color + '">' +
        '<span class="cbar__name">TEAM ' + TEAM_LETTERS[i] + "</span>" +
        '<span class="cbar__track"><i class="cbar__fill" data-w="' + (avg / maxSum * 100).toFixed(2) + '"></i></span>' +
        '<span class="cbar__val">' + avg.toFixed(1) + '<small>avg</small></span></div>';
    });
    html += '<div class="compare__avg"><span>전체 평균</span><span><b>' + stats.mean.toFixed(1) + "</b> MMR</span></div></div>";
    html += "</div>";

    wrap.innerHTML = html;
    requestAnimationFrame(function () {
      $$(".team__bar i", wrap).forEach(function (bar, i) {
        bar.style.width = clamp(stats.avgs[i] / maxSum * 100, 8, 100) + "%";
      });
      $$(".cbar__fill", wrap).forEach(function (bar) {
        bar.style.width = bar.getAttribute("data-w") + "%";
      });
    });
  }

  function roundName(total, r) {
    var left = total - 1 - r;
    if (left === 0) return "FINAL";
    if (left === 1) return "SEMI FINAL";
    return Math.pow(2, left + 1) + "강";
  }

  function renderBracket() {
    var wrap = $("#bracket-box");
    if (!wrap) return;
    var br = state.bracket;
    if (!br || !state.teams) {
      wrap.innerHTML = '<div class="pts__empty">팀을 먼저 구성하면 대진표가 자동으로 생성됩니다.</div>';
      return;
    }
    refreshBracket(br);
    var total = br.rounds.length;
    var html = '<div class="bracket-scroll"><div class="bracket">';
    br.rounds.forEach(function (round, r) {
      html += '<div class="rnd" style="--r:' + r + '">' +
        '<div class="rnd__title">' + roundName(total, r) + " · M" + round.length + "</div>";
      round.forEach(function (m) {
        var live = !m.bye && m.a !== null && m.b !== null && m.sa === null;
        var cls = "match" + (m.winner !== null && !m.bye ? " is-done" : "") + (live ? " is-live" : "");
        html += '<div class="' + cls + '" data-r="' + r + '" data-m="' + m.index + '">' +
          '<div class="match__top"><span>M' + String(m.index + 1).padStart(2, "0") + "</span>" +
          "<span>" + (m.bye ? "BYE" : m.winner !== null ? "DONE" : live ? "LIVE" : "WAIT") + "</span></div>";
        html += matchRow(m, "a", r);
        html += matchRow(m, "b", r);
        if (m.bye) html += '<div class="match__note">부전승 · 자동 진출</div>';
        html += "</div>";
      });
      html += "</div>";
    });
    html += "</div></div>";

    var finalM = br.rounds[total - 1][0];
    if (finalM.winner !== null) {
      var champIdx = finalM.winner;
      html += '<div class="champion"><div class="champion__ico">🏆</div><div>' +
        '<div class="champion__label">CHAMPION</div>' +
        '<div class="champion__name"><span>TEAM ' + TEAM_LETTERS[champIdx] + "</span> 우승</div>" +
        '<div class="champion__sub">대진표 기준 자동 집계 · 포인트는 아래에서 확인하세요</div>' +
        "</div></div>";
    }
    wrap.innerHTML = html;
  }

  function matchRow(m, side, r) {
    var teamIdx = m[side];
    var name = teamIdx === null ? "TBD" : "TEAM " + TEAM_LETTERS[teamIdx];
    var color = teamIdx === null ? "transparent" : TEAM_COLORS[teamIdx % TEAM_COLORS.length];
    var isWin = m.winner !== null && m.winner === teamIdx;
    var cls = "mrow" + (isWin ? " is-win" : "") + (teamIdx === null ? " is-tbd" : "");
    var score = m["s" + side];
    var val = score === null ? "" : score;
    var input = m.bye || teamIdx === null
      ? '<span style="font-size:10px;color:#5f5f6b">' + (teamIdx === null ? "-" : "BYE") + "</span>"
      : '<input type="number" min="0" max="9" inputmode="numeric" value="' + val +
      '" data-r="' + r + '" data-m="' + m.index + '" data-s="' + side + '" aria-label="' + name + ' 승수">';
    return '<div class="' + cls + '" style="--accent:' + color + '">' +
      '<span class="mrow__name">' + name +
      (teamIdx !== null ? "<small>· " + Math.round(teamAvg(state.teams[teamIdx])) + "</small>" : "") +
      "</span>" + input + "</div>";
  }

  /* ---------------------------------------------------------------- points */
  function computePoints() {
    var br = state.bracket;
    var rows = {};
    var playedTeams = {};
    if (br) {
      br.rounds.forEach(function (round, r) {
        round.forEach(function (m) {
          if (m.a === null || m.b === null || m.bye) return;
          if (m.sa === null || m.sb === null || m.sa === m.sb) return;
          var games = m.sa + m.sb;
          [m.a, m.b].forEach(function (ti) {
            (state.teams[ti] || []).forEach(function (id) {
              if (!rows[id]) rows[id] = { games: 0, wins: 0, team: ti };
              rows[id].games += games;
              rows[id].team = ti;
            });
          });
          (state.teams[m.winner] || []).forEach(function (id) {
            if (!rows[id]) rows[id] = { games: 0, wins: 0, team: m.winner };
            rows[id].wins += 1;
          });
        });
      });
    }
    var list = Object.keys(rows).map(function (id) {
      var p = playerById[id];
      var r = rows[id];
      return {
        id: id,
        name: p ? p.name : id,
        team: r.team,
        games: r.games,
        wins: r.wins,
        points: r.games * state.rule.play + r.wins * state.rule.win
      };
    }).sort(function (a, b) { return b.points - a.points || b.wins - a.wins; });
    return list;
  }

  function renderPoints() {
    var wrap = $("#points-box");
    if (!wrap) return;
    var list = computePoints();
    if (!list.length) {
      wrap.innerHTML = '<div class="pts__empty">대진표에 경기 스코어를 입력하면 포인트가 자동으로 정산됩니다.</div>';
      var ab = $("#apply-season");
      if (ab) { ab.disabled = true; ab.textContent = "시즌에 반영"; }
      var nt = $("#apply-season-note");
      if (nt) nt.textContent = "정산 포인트를 시즌 기록에 적립합니다.";
      return;
    }
    var html = '<div class="points"><table class="pts"><thead><tr>' +
      "<th>#</th><th>참가자</th><th>팀</th><th style=\"text-align:right\">경기</th>" +
      "<th style=\"text-align:right\">승</th><th style=\"text-align:right\">포인트</th>" +
      "</tr></thead><tbody>";
    list.forEach(function (x, i) {
      var color = TEAM_COLORS[x.team % TEAM_COLORS.length];
      html += "<tr><td>" + (i + 1) + "</td><td>" + esc(x.name) + "</td>" +
        '<td><span class="teamchip" style="--accent:' + color + ';color:' + color + '">TEAM ' + TEAM_LETTERS[x.team] + "</span></td>" +
        '<td class="num">' + x.games + "</td><td class=\"num\">" + x.wins + "</td>" +
        '<td class="pts-val">' + x.points.toLocaleString("ko-KR") + " P</td></tr>";
    });
    var total = list.reduce(function (s, x) { return s + x.points; }, 0);
    html += '</tbody><tfoot><tr><td colspan="5" style="text-align:right;color:#8d8d9a;font-size:11px;letter-spacing:.08em">TOTAL</td>' +
      '<td class="pts-val">' + total.toLocaleString("ko-KR") + " P</td></tr></tfoot></table></div>" +
      '<p class="hint">정산 규칙: 참여 경기 수 × ' + state.rule.play + "P + 승리 횟수 × " + state.rule.win +
      "P · 부전승은 경기로 집계하지 않습니다.</p>";
    wrap.innerHTML = html;

    var btn = $("#apply-season");
    var note = $("#apply-season-note");
    var sig = pointsSignature(list);
    var applied = !!sig && state.settled === sig;
    if (btn) {
      btn.disabled = applied;
      btn.textContent = applied ? "시즌 반영 완료" : "시즌에 반영";
    }
    if (note) note.textContent = applied
      ? "이 정산은 이미 시즌에 적립되었습니다."
      : "정산 포인트를 시즌 기록에 적립합니다.";
  }

  function pointsSignature(list) {
    return list.map(function (x) { return x.id + ":" + x.points + ":" + x.games + ":" + x.wins; }).join("|");
  }

  function applySeason() {
    var list = computePoints();
    if (!list.length) { toast("먼저 대진표에 경기 스코어를 입력해 주세요."); return; }
    if (!window.DGVStore) { toast("시즌 저장 모듈을 불러오지 못했습니다."); return; }
    var sig = pointsSignature(list);
    if (state.settled === sig) { toast("이미 시즌에 반영된 정산입니다."); return; }
    var res = window.DGVStore.applySettlement({
      title: "내전 정산 · " + new Date().toLocaleString("ko-KR", {
        month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
      }),
      teams: (state.teams || []).map(function (t) {
        return t.map(function (id) { return playerById[id] ? playerById[id].name : ""; });
      }),
      points: list.map(function (x) {
        var p = playerById[x.id];
        return {
          name: x.name, points: x.points, games: x.games, wins: x.wins,
          tier: p ? tierByValue(p.tier).label : ""
        };
      })
    });
    state.settled = sig;
    save();
    renderPoints();
    toast("시즌에 " + res.total.toLocaleString("ko-KR") + "P를 적립했습니다.");
  }

  /* ---------------------------------------------------------------- roster */
  function renderRoster() {
    var body = $("#roster-body");
    if (!body) return;
    if (!state.players.length) {
      body.innerHTML = '<tr><td colspan="9"><div class="roster__empty">참가자가 없습니다. <b style="color:#ff4655">+ 참가자 추가</b>를 눌러 명단을 만들어 주세요.</div></td></tr>';
      return;
    }
    var html = "";
    state.players.forEach(function (p, i) {
      html += '<tr data-id="' + p.id + '" class="' + (p.active ? "" : "is-off") + '">' +
        '<td class="col-no">' + String(i + 1).padStart(2, "0") + "</td>" +
        '<td><input type="text" data-field="name" value="' + esc(p.name) + '" placeholder="닉네임" maxlength="18" aria-label="닉네임"></td>' +
        '<td><select data-field="tier" class="w-tier" aria-label="현재 티어">' + tierOptions(p.tier) + "</select></td>" +
        '<td><input type="number" data-field="rr" class="w-rr" value="' + Number(p.rr || 0) + '" min="0" max="100" aria-label="현재 RR"></td>' +
        '<td><select data-field="peakTier" class="w-tier" aria-label="최고 티어">' + tierOptions(p.peakTier || p.tier) + "</select></td>" +
        '<td><input type="number" data-field="peakRR" class="w-rr" value="' + Number(p.peakRR || 0) + '" min="0" max="100" aria-label="최고 RR"></td>' +
        '<td class="col-score" data-score>' + (p.score || 0).toFixed(0) + "</td>" +
        '<td class="col-toggle"><label class="switch" title="참가 여부"><input type="checkbox" data-field="active" ' +
        (p.active ? "checked" : "") + ' aria-label="참가"><span class="switch__track"></span></label></td>' +
        '<td class="col-del"><button type="button" data-del aria-label="삭제">✕</button></td></tr>';
    });
    body.innerHTML = html;
  }

  function tierOptions(selected) {
    return TIERS.map(function (t) {
      return '<option value="' + t.v + '"' + (t.v === selected ? " selected" : "") + ">" + t.label + "</option>";
    }).join("");
  }

  function updateRowScore(id) {
    var row = $('[data-id="' + id + '"]', $("#roster-body"));
    if (!row) return;
    var cell = $("[data-score]", row);
    if (cell) cell.textContent = (playerById[id] ? playerById[id].score : 0).toFixed(0);
  }

  /* ------------------------------------------------------------- settings */
  function renderSettings() {
    var tc = $("#team-count"), ts = $("#team-size");
    if (tc) tc.value = state.settings.teams;
    if (ts) ts.value = state.settings.size;
    var w = $("#weight");
    if (w) {
      w.value = state.settings.weight;
      w.style.setProperty("--fill", state.settings.weight + "%");
    }
    var wv = $("#weight-val");
    if (wv) wv.textContent = state.settings.weight + "%";
    var auto = $("#auto-balance");
    if (auto) auto.checked = !!state.settings.auto;
    $$("[data-rule]").forEach(function (inp) {
      var k = inp.getAttribute("data-rule");
      if (state.rule[k] != null) inp.value = state.rule[k];
    });
    $$("[data-teams]").forEach(function (b) {
      b.disabled = (b.getAttribute("data-teams") === "dec" && state.settings.teams <= 2) ||
        (b.getAttribute("data-teams") === "inc" && state.settings.teams >= 8);
    });
    $$("[data-size]").forEach(function (b) {
      b.disabled = (b.getAttribute("data-size") === "dec" && state.settings.size <= 2) ||
        (b.getAttribute("data-size") === "inc" && state.settings.size >= 10);
    });
  }

  var autoTimer;
  function scheduleBalance() {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(function () { balance(false); }, 650);
  }

  /* ------------------------------------------------------------- import */
  function parseRoster(text) {
    var out = [];
    text.split(/\r?\n/).forEach(function (line) {
      line = line.trim();
      if (!line) return;
      var parts = line.split(/[,\t]+/).map(function (s) { return s.trim(); }).filter(Boolean);
      var name, tier, rr = 0, peakTier, peakRR = 0;
      if (parts.length >= 2 && parseTierToken(parts[1])) {
        name = parts[0];
        tier = parseTierToken(parts[1]);
        rr = clamp(parseInt(parts[2], 10) || 0, 0, 100);
        peakTier = parseTierToken(parts[3] || "") || tier;
        peakRR = clamp(parseInt(parts[4], 10) || 0, 0, 100);
      } else {
        var m = line.match(/^(.+?)\s+([가-힣A-Za-z]+)\s*(\d)?(?:\s+(\d{1,3}))?$/);
        if (!m) return;
        name = m[1].trim();
        tier = parseTierToken(m[2] + (m[3] || ""));
        if (!tier) return;
        rr = clamp(parseInt(m[4], 10) || 0, 0, 100);
        peakTier = tier;
      }
      out.push({
        id: uid(), name: name.slice(0, 18), tier: tier,
        rr: rr, peakTier: peakTier, peakRR: peakRR, active: true
      });
    });
    return out;
  }

  /* ----------------------------------------------------------------- init */
  function loadState() {
    var fromHash = null;
    if (location.hash.indexOf("#d=") === 0) {
      try {
        var bin = atob(location.hash.slice(3));
        var bytes = Uint8Array.from(bin, function (c) { return c.charCodeAt(0); });
        fromHash = JSON.parse(new TextDecoder().decode(bytes));
      } catch (e) { fromHash = null; }
    }
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { saved = null; }
    var src = fromHash || saved;
    if (src && Array.isArray(src.players)) {
      state.players = src.players;
      if (src.settings) state.settings = Object.assign(state.settings, src.settings);
      if (src.rule) state.rule = Object.assign(state.rule, src.rule);
      state.teams = Array.isArray(src.teams) ? src.teams : null;
      state.bracket = src.bracket || null;
      state.settled = src.settled || "";
    }
    state.players.forEach(function (p) {
      if (!p.id) p.id = uid();
      p.active = p.active !== false;
      if (!p.peakTier) p.peakTier = p.tier;
      if (p.rr == null) p.rr = 0;
      if (p.peakRR == null) p.peakRR = 0;
    });
    recalcScores();
  }

  function demoPlayers() {
    var data = [
      ["대가리깨짐", "8-1", 62, "8-1", 88],
      ["제트장인", "7-3", 41, "7-3", 66],
      ["오멘만함", "7-2", 12, "7-3", 40],
      ["사이퍼충", "6-3", 70, "7-1", 22],
      ["브림스톤", "6-1", 30, "6-2", 55],
      ["제트각", "5-3", 55, "6-1", 12],
      ["플래탈출", "4-2", 80, "5-1", 20],
      ["골드수문장", "3-3", 45, "4-1", 60],
      ["실버1등", "2-2", 60, "3-1", 30],
      ["브론즈영웅", "1-3", 22, "2-1", 70]
    ];
    return data.map(function (d, i) {
      return {
        id: "demo" + i, name: d[0], tier: d[1], rr: d[2],
        peakTier: d[3], peakRR: d[4], active: true
      };
    });
  }

  function init() {
    loadState();
    if (!state.players.length) state.players = demoPlayers();
    recalcScores();
    if (!teamsValid()) state.teams = null;
    renderRoster();
    renderSettings();

    if (state.teams && state.bracket) {
      if (!state.bracket.rounds) state.bracket = buildBracket();
    } else {
      balance(false);
    }
    renderAll();
    save();
  }

  /* --------------------------------------------------------------- events */
  function bind() {
    var body = $("#roster-body");
    if (body) {
      body.addEventListener("input", function (e) {
        var row = e.target.closest("tr[data-id]");
        if (!row) return;
        var p = playerById[row.getAttribute("data-id")];
        if (!p) return;
        var field = e.target.getAttribute("data-field");
        if (!field) return;
        if (field === "name") {
          p.name = e.target.value;
          save();
          return;
        }
        if (field === "rr" || field === "peakRR") {
          p[field] = clamp(parseInt(e.target.value, 10) || 0, 0, 100);
        } else if (field === "tier" || field === "peakTier") {
          p[field] = e.target.value;
        } else if (field === "active") {
          p.active = e.target.checked;
          row.classList.toggle("is-off", !p.active);
        }
        recalcScores();
        updateRowScore(p.id);
        renderStats();
        save();
        if (p.active && state.settings.auto) scheduleBalance();
      });
      body.addEventListener("change", function (e) {
        if (e.target.getAttribute("data-field") === "active") {
          var row = e.target.closest("tr[data-id]");
          var p = playerById[row.getAttribute("data-id")];
          if (p) {
            p.active = e.target.checked;
            row.classList.toggle("is-off", !p.active);
            recalcScores(); renderStats(); save();
            if (state.settings.auto) scheduleBalance(); else renderPoints();
          }
        }
      });
      body.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-del]");
        if (!btn) return;
        var row = btn.closest("tr[data-id]");
        var id = row.getAttribute("data-id");
        state.players = state.players.filter(function (p) { return p.id !== id; });
        state.teams = null;
        state.bracket = null;
        recalcScores();
        renderRoster();
        renderStats();
        save();
        if (state.settings.auto) scheduleBalance(); else renderResult();
      });
    }

    var add = $("#add-player");
    if (add) add.addEventListener("click", function () {
      var p = {
        id: uid(), name: "Player_" + (state.players.length + 1),
        tier: "3-2", rr: 0, peakTier: "3-2", peakRR: 0, active: true
      };
      state.players.push(p);
      recalcScores();
      renderRoster();
      save();
      var input = $('[data-id="' + p.id + '"] [data-field="name"]');
      if (input) { input.focus(); input.select(); }
      if (state.settings.auto) scheduleBalance();
    });

    var demo = $("#demo-btn");
    if (demo) demo.addEventListener("click", function () {
      state.players = demoPlayers();
      state.teams = null; state.bracket = null;
      recalcScores(); renderRoster(); save();
      balance(true);
    });

    var clear = $("#clear-btn");
    if (clear) clear.addEventListener("click", function () {
      if (!confirm("명단을 모두 지울까요? 되돌릴 수 없습니다.")) return;
      state.players = []; state.teams = null; state.bracket = null;
      renderRoster(); renderStats(); renderResult(); renderBracket(); renderPoints();
      save();
    });

    var importBtn = $("#import-btn");
    if (importBtn) importBtn.addEventListener("click", function () {
      var ta = $("#import-text");
      var list = parseRoster(ta.value || "");
      if (!list.length) { toast("인식된 참가자가 없습니다. 형식을 확인해 주세요."); return; }
      state.players = state.players.concat(list);
      state.teams = null; state.bracket = null;
      recalcScores(); renderRoster(); save();
      ta.value = "";
      toast(list.length + "명을 추가했습니다.");
      balance(true);
    });

    /* steppers */
    $$("[data-teams]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var dir = btn.getAttribute("data-teams") === "inc" ? 1 : -1;
        state.settings.teams = clamp(state.settings.teams + dir, 2, 8);
        renderSettings(); save(); balance(true);
      });
    });
    $$("[data-size]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var dir = btn.getAttribute("data-size") === "inc" ? 1 : -1;
        state.settings.size = clamp(state.settings.size + dir, 2, 10);
        renderSettings(); save();
      });
    });

    var weight = $("#weight");
    if (weight) weight.addEventListener("input", function () {
      state.settings.weight = Number(weight.value);
      $("#weight-val").textContent = weight.value + "%";
      weight.style.setProperty("--fill", weight.value + "%");
      recalcScores();
      $$("#roster-body [data-id]").forEach(function (row) {
        updateRowScore(row.getAttribute("data-id"));
      });
      renderStats();
      save();
      if (state.settings.auto) scheduleBalance();
    });

    var auto = $("#auto-balance");
    if (auto) auto.addEventListener("change", function () {
      state.settings.auto = auto.checked;
      save();
    });

    var bal = $("#balance-btn");
    if (bal) bal.addEventListener("click", function () { balance(true); });
    var balTop = $("#balance-btn-top");
    if (balTop) balTop.addEventListener("click", function () { balance(true); });

    var applyBtn = $("#apply-season");
    if (applyBtn) applyBtn.addEventListener("click", applySeason);

    document.addEventListener("keydown", function (e) {
      if (!e.altKey) return;
      var k = (e.key || "").toLowerCase();
      if (k === "b") { e.preventDefault(); balance(true); }
      if (k === "r") { e.preventDefault(); balance(false); toast("한 번 더 섞었습니다."); }
    });

    var reroll = $("#reroll-btn");
    if (reroll) reroll.addEventListener("click", function () {
      balance(false);
      toast("한 번 더 섞었습니다.");
    });

    /* bracket score inputs */
    var bracketBox = $("#bracket-box");
    if (bracketBox) {
      bracketBox.addEventListener("change", function (e) {
        var input = e.target;
        if (input.tagName !== "INPUT") return;
        var r = Number(input.getAttribute("data-r"));
        var m = Number(input.getAttribute("data-m"));
        var side = input.getAttribute("data-s");
        var match = state.bracket.rounds[r][m];
        var raw = input.value.trim();
        var v = raw === "" ? null : clamp(parseInt(raw, 10) || 0, 0, 99);
        match["s" + side] = v;
        refreshBracket(state.bracket);
        renderBracket();
        renderPoints();
        save();
        var again = $('[data-r="' + r + '"][data-m="' + m + '"][data-s="' + side + '"]', $("#bracket-box"));
        if (again) { again.focus(); }
      });
    }

    /* points rule */
    $$("[data-rule]").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var key = inp.getAttribute("data-rule");
        state.rule[key] = clamp(parseInt(inp.value, 10) || 0, 0, 100000);
        save(); renderPoints();
      });
    });

    /* share */
    var copyBtn = $("#copy-result");
    if (copyBtn) copyBtn.addEventListener("click", function () {
      if (!state.teams) { toast("먼저 밸런스를 실행해 주세요."); return; }
      var stats = balanceStats(state.teams);
      var lines = ["[대깨발 내전 밸런스]", "밸런스 점수: " + Math.round(stats.score) + "점 / 평균 " + stats.mean.toFixed(1) + " MMR", ""];
      state.teams.forEach(function (t, i) {
        lines.push("TEAM " + TEAM_LETTERS[i] + " (avg " + stats.avgs[i].toFixed(1) + ")");
        t.forEach(function (id) {
          var p = playerById[id];
          lines.push(" - " + p.name + " · " + tierByValue(p.tier).label + " · " + p.score.toFixed(0));
        });
        lines.push("");
      });
      copyText(lines.join("\n"), "결과를 복사했습니다.");
    });

    var shareBtn = $("#share-btn");
    if (shareBtn) shareBtn.addEventListener("click", function () {
      var payload = { players: state.players, settings: state.settings, teams: state.teams, rule: state.rule };
      var bytes = new TextEncoder().encode(JSON.stringify(payload));
      var bin = "";
      bytes.forEach(function (b) { bin += String.fromCharCode(b); });
      var url = location.origin + location.pathname + "#d=" + btoa(bin);
      copyText(url, "공유 링크를 복사했습니다. 붙여넣기만 하면 그대로 복원됩니다.");
    });

    var csvBtn = $("#csv-btn");
    if (csvBtn) csvBtn.addEventListener("click", function () {
      if (!state.teams) { toast("먼저 밸런스를 실행해 주세요."); return; }
      var rows = [["팀", "닉네임", "현재티어", "현재RR", "최고티어", "최고RR", "MMR"]];
      state.teams.forEach(function (t, i) {
        t.forEach(function (id) {
          var p = playerById[id];
          rows.push(["TEAM " + TEAM_LETTERS[i], p.name, tierByValue(p.tier).label, p.rr,
            tierByValue(p.peakTier).label, p.peakRR, p.score.toFixed(1)]);
        });
      });
      var pts = computePoints();
      if (pts.length) {
        rows.push([]);
        rows.push(["닉네임", "경기", "승", "포인트"]);
        pts.forEach(function (x) { rows.push([x.name, x.games, x.wins, x.points]); });
      }
      var csv = "\uFEFF" + rows.map(function (r) {
        return r.map(function (c) {
          var s = String(c == null ? "" : c);
          return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        }).join(",");
      }).join("\n");
      var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "대깨발-내전-" + new Date().toISOString().slice(0, 10) + ".csv";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      toast("CSV 파일을 저장했습니다.");
    });

    /* discord webhook */
    var send = $("#send-discord");
    if (send) send.addEventListener("click", function () {
      var url = ($("#webhook-url").value || "").trim();
      if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(url)) {
        toast("디스코드 웹훅 URL을 확인해 주세요.");
        return;
      }
      if (!state.teams) { toast("먼저 밸런스를 실행해 주세요."); return; }
      var stats = balanceStats(state.teams);
      var fields = state.teams.map(function (t, i) {
        return {
          name: "TEAM " + TEAM_LETTERS[i] + " · avg " + stats.avgs[i].toFixed(1),
          value: t.map(function (id) { return playerById[id].name; }).join(", ") || "-",
          inline: false
        };
      });
      var pts = computePoints();
      if (pts.length) {
        fields.push({
          name: "포인트 정산",
          value: pts.slice(0, 10).map(function (x) { return x.name + " " + x.points + "P"; }).join(" · "),
          inline: false
        });
      }
      var payload = {
        username: "대깨발 밸런서",
        embeds: [{
          title: "🏆 대깨발 내전 팀 구성",
          description: "밸런스 점수 **" + Math.round(stats.score) + "점** · 평균 " + stats.mean.toFixed(1) + " MMR",
          color: 0xff4655,
          fields: fields,
          footer: { text: "daeggabal.kr · 자동 생성" },
          timestamp: new Date().toISOString()
        }]
      };
      send.disabled = true;
      send.textContent = "전송 중...";
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(function (res) {
        if (res.ok) toast("디스코드로 전송했습니다.");
        else toast("전송 실패 (" + res.status + "). 웹훅을 확인해 주세요.");
      }).catch(function () {
        toast("전송 실패. 네트워크 또는 웹훅 URL을 확인해 주세요.");
      }).then(function () {
        send.disabled = false;
        send.textContent = "디스코드로 전송";
      });
    });

    /* reset bracket */
    var resetBr = $("#reset-bracket");
    if (resetBr) resetBr.addEventListener("click", function () {
      state.bracket = buildBracket();
      renderBracket(); renderPoints(); save();
      toast("대진표를 다시 만들었습니다.");
    });
  }

  function copyText(text, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg); },
        function () { fallbackCopy(text, okMsg); });
    } else fallbackCopy(text, okMsg);
  }

  function fallbackCopy(text, okMsg) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); toast(okMsg); }
    catch (e) { toast("복사에 실패했습니다."); }
    document.body.removeChild(ta);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { init(); bind(); });
  } else {
    init(); bind();
  }
})();
