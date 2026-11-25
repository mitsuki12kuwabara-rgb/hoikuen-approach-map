/* 地図の3段階切替（すっきり → 目安 → 標準）
 * 政治家ICT event-map の static/clean_basemap.js を保育園マップ用に移したもの。
 *   すっきり = 地理院「最適化ベクトルタイル」を MapLibre で描画（文字・記号・等高線なし、建物を強調）
 *   目安     = すっきり ＋ 駅・学校の目印（landmarks.js）
 *   標準     = 地理院「淡色地図」（これまでの地図）
 * 選んだモードは端末に記憶します。MapLibre が使えない環境では「標準」だけで動きます。
 * 出典: すっきり/目安 = 国土地理院最適化ベクトルタイル（試験公開）を加工して作成、標準 = 地理院タイル
 */
(function () {
  "use strict";
  var ICHIRAN = "https://maps.gsi.go.jp/development/ichiran.html";
  var ATTR_VEC = "<a href='" + ICHIRAN + "' target='_blank' rel='noopener'>国土地理院最適化ベクトルタイル</a>（試験公開）を加工して作成";
  var ATTR_PALE = "<a href='" + ICHIRAN + "' target='_blank' rel='noopener'>地理院タイル</a>";
  var KEY = "hoiku_basemap_mode_v1";
  function zl(a, za, b, zb, c, zc) { return ["interpolate", ["linear"], ["zoom"], a, za, b, zb, c, zc]; }

  function injectCss() {
    if (document.getElementById("lm-css")) return;
    var s = document.createElement("style");
    s.id = "lm-css";
    s.textContent =
      ".lm-tt{background:rgba(255,255,255,.88);border:none;box-shadow:none;" +
      "font-size:11px;font-weight:700;padding:0 3px;color:#1c2126;white-space:nowrap}" +
      ".lm-tt:before{display:none}" +
      ".lm-tt-sta{color:#1d4ed8}.lm-tt-school{color:#15803d}" +
      ".lm-tt-school{display:none}.lm-znear .lm-tt-school{display:block}" +
      ".lm-zfar .lm-tt-sta{display:none}" +
      ".lm-seg{display:flex;background:#fff;border:1px solid #d7dcd8;border-radius:9px;" +
      "box-shadow:0 1px 4px rgba(0,0,0,.2);overflow:hidden;font-family:inherit}" +
      ".lm-seg button{border:0;background:#fff;color:#434b52;font-size:12px;font-weight:700;" +
      "padding:7px 10px;cursor:pointer;border-right:1px solid #eceeeb;font-family:inherit}" +
      ".lm-seg button:last-child{border-right:0}" +
      ".lm-seg button.on{background:#1f7a8c;color:#fff}";
    document.head.appendChild(s);
  }

  function cleanStyle() {
    return {
      version: 8,
      sources: {
        gsi: {
          type: "vector", minzoom: 4, maxzoom: 16,
          tiles: ["https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/{z}/{x}/{y}.pbf"],
          attribution: ATTR_VEC
        }
      },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": "#f4f5f0" } },
        { id: "water", type: "fill", source: "gsi", "source-layer": "WA", paint: { "fill-color": "#cfe2ef" } },
        { id: "park", type: "fill", source: "gsi", "source-layer": "SpcfArea", paint: { "fill-color": "#e7efe1", "fill-opacity": 0.75 } },
        { id: "rd-casing", type: "line", source: "gsi", "source-layer": "RdEdg",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#d7d8d1", "line-width": zl(12, 0.6, 16, 1.6, 19, 2.6) } },
        { id: "rd-fill", type: "line", source: "gsi", "source-layer": "RdCompt",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#ffffff", "line-width": zl(13, 0.6, 16, 2.4, 19, 5) } },
        { id: "river", type: "line", source: "gsi", "source-layer": "RvrCL", paint: { "line-color": "#9cc4dd", "line-width": 1.2 } },
        { id: "rail", type: "line", source: "gsi", "source-layer": "RailCL", paint: { "line-color": "#9aa0a6", "line-width": 1.3, "line-dasharray": [3, 2] } },
        { id: "bld", type: "fill", source: "gsi", "source-layer": "BldA", paint: { "fill-color": "#e4ddcd", "fill-outline-color": "#b3ac98" } }
      ]
    };
  }

  var LM = {
    "駅":   { color: "#2563eb", r: 5, cls: "sta" },
    "学校": { color: "#16a34a", r: 4, cls: "school" }
  };

  function buildLandmarks() {
    var group = L.layerGroup();
    (window.HOIKU_LANDMARKS || []).forEach(function (it) {
      var sty = LM[it.cat]; if (!sty) return;
      var m = L.circleMarker([it.lat, it.lng], {
        radius: sty.r, color: "#ffffff", weight: 1.5,
        fillColor: sty.color, fillOpacity: 0.9, interactive: false
      });
      m.bindTooltip(it.name || "", { permanent: true, direction: "top", offset: [0, -2],
        className: "lm-tt lm-tt-" + sty.cls, opacity: 1 });
      group.addLayer(m);
    });
    return group;
  }

  window.addHoikuBasemap = function (map, opts) {
    opts = opts || {};
    injectCss();
    // 目印は保育園ピンより下に置く
    if (!map.getPane("lmPane")) { map.createPane("lmPane"); map.getPane("lmPane").style.zIndex = 420; }
    var pale = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png",
      { maxZoom: 18, attribution: ATTR_PALE });
    var vec = null;
    try {
      var cv = document.createElement("canvas");
      var gl = cv.getContext("webgl2") || cv.getContext("webgl");
      if (window.maplibregl && L.maplibreGL && gl) {
        vec = L.maplibreGL({ style: cleanStyle(), attribution: ATTR_VEC });
      }
    } catch (e) { vec = null; }

    var lmLayer = null;
    function landmarks() {
      if (!lmLayer) {
        lmLayer = buildLandmarks();
        lmLayer.eachLayer(function (l) { l.options.pane = "lmPane"; });
      }
      return lmLayer;
    }
    function applyZoomClass() {
      var el = map.getContainer(), z = map.getZoom();
      el.classList.toggle("lm-zfar", z < 14);
      el.classList.toggle("lm-znear", z >= 16);
    }
    map.on("zoomend", function () { if (mode === "landmark") applyZoomClass(); });

    var mode = null;   // clean | landmark | standard
    function setMode(m) {
      if (!vec) m = "standard";
      if (m === mode) return mode;
      var wantPale = (m === "standard");
      if (wantPale) {
        if (vec && map.hasLayer(vec)) map.removeLayer(vec);
        if (!map.hasLayer(pale)) pale.addTo(map);
      } else {
        if (map.hasLayer(pale)) map.removeLayer(pale);
        if (!map.hasLayer(vec)) vec.addTo(map);
      }
      if (m === "landmark") { landmarks().addTo(map); applyZoomClass(); }
      else if (lmLayer && map.hasLayer(lmLayer)) {
        map.removeLayer(lmLayer);
        map.getContainer().classList.remove("lm-zfar", "lm-znear");
      }
      mode = m;
      try { localStorage.setItem(KEY, m); } catch (e) {}
      if (btns) defs.forEach(function (x) { btns[x[0]].className = (x[0] === mode) ? "on" : ""; });
      return mode;
    }

    var saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) {}
    setMode(saved || opts.initialMode || "landmark");

    var defs = [["clean", "すっきり"], ["landmark", "目安"], ["standard", "標準"]], btns = null;
    if (vec) {
      var Seg = L.Control.extend({
        options: { position: opts.position || "topleft" },
        onAdd: function () {
          var wrap = L.DomUtil.create("div", "lm-seg");
          wrap.title = "地図の見え方";
          btns = {};
          defs.forEach(function (d) {
            var b = L.DomUtil.create("button", d[0] === mode ? "on" : "", wrap);
            b.type = "button"; b.textContent = d[1];
            b.onclick = function () { setMode(d[0]); };
            btns[d[0]] = b;
          });
          L.DomEvent.disableClickPropagation(wrap);
          L.DomEvent.disableScrollPropagation(wrap);
          return wrap;
        }
      });
      map.addControl(new Seg());
    }
    return { mode: function () { return mode; }, setMode: setMode };
  };
})();
