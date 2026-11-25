/* 구인 글 자동 생성기 */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var out = $("#gen-out");
  if (!out) return;

  var tierNames = ["아이언", "브론즈", "실버", "골드", "플래티넘", "다이아", "초월자", "불멸", "레디언트"];
  var tierSel = $("#gen-tier");
  var html = "";
  tierNames.forEach(function (n, i) {
    if (i === 8) { html += '<option>레디언트</option>'; return; }
    for (var d = 1; d <= 3; d++) html += "<option>" + n + " " + d + "</option>";
  });
  tierSel.innerHTML = html;
  tierSel.value = "골드 2";

  function val(id, fallback) {
    var el = document.getElementById(id);
    var v = el ? String(el.value || "").trim() : "";
    return v || fallback;
  }

  function build() {
    var name = val("gen-name", "(닉네임)");
    var tier = val("gen-tier", "티어 미입력");
    var mode = val("gen-mode", "경쟁전(랭크)");
    var pos = val("gen-pos", "상관없음");
    var time = val("gen-time", "시간 협의");
    var mic = val("gen-mic", "가능");
    var size = val("gen-size", "1명 (듀오)");
    var note = val("gen-note", "즐겜 위주로 해요. 욕설 없이!");

    var text =
      "🎯 듀오 / 파티 구합니다\n" +
      "\n" +
      "👤 닉네임 : " + name + "\n" +
      "🏆 현재 티어 : " + tier + "\n" +
      "🎮 모드 : " + mode + "\n" +
      "🧩 포지션 : " + pos + "\n" +
      "🕒 시간대 : " + time + "\n" +
      "🎙️ 음성 : " + mic + "\n" +
      "👥 구하는 인원 : " + size + "\n" +
      "\n" +
      "📝 " + note + "\n" +
      "\n" +
      "#구인 #대깨발";
    out.textContent = text;
  }

  function toast(msg) {
    var el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("is-on");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("is-on"); }, 2200);
  }

  $$();

  function $$() {
    ["gen-name", "gen-tier", "gen-mode", "gen-pos", "gen-time", "gen-mic", "gen-size", "gen-note"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener("input", build);
        el.addEventListener("change", build);
      }
    });
  }

  $("#gen-btn").addEventListener("click", function () {
    build();
    toast("구인 글을 생성했습니다.");
  });

  $("#gen-copy").addEventListener("click", function () {
    var text = out.textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast("복사했습니다. #구인 채널에 붙여넣으세요!"); },
        function () { fallback(text); });
    } else fallback(text);
  });

  function fallback(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); toast("복사했습니다!"); } catch (e) { toast("복사에 실패했습니다."); }
    document.body.removeChild(ta);
  }

  $("#gen-reset").addEventListener("click", function () {
    $("#gen-name").value = "";
    $("#gen-tier").value = "골드 2";
    $("#gen-time").value = "평일 21시 이후";
    $("#gen-note").value = "";
    build();
    toast("초기화했습니다.");
  });

  build();
})();
