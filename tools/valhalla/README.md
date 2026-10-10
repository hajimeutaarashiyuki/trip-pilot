# 步行分鐘矩陣（Valhalla）

桌機用 Docker 跑 Valhalla，把一城所有站對站的步行分鐘算好存進知識庫，手機離線讀（決策樹 Q6）。坡度：Valhalla 的 pedestrian costing 建圖時帶高程，秒數本身就含坡度。

## 一次性：建圖（每個地區一個容器）

```
# 東北（仙台）；資料與圖資放在專案根目錄的 valhalla/<區域>/，不進任何倉庫
docker run -d --name valhalla-tohoku -p 8002:8002 \
  -v "D:/App Design/igotanidea/trip-pilot/valhalla/tohoku:/custom_files" \
  -e tile_urls=https://download.geofabrik.de/asia/japan/tohoku-latest.osm.pbf \
  -e build_elevation=True -e serve_tiles=True -e use_tiles_ignore_pbf=False \
  ghcr.io/valhalla/valhalla-scripted:latest
docker logs -f valhalla-tohoku      # 看到 "Running valhalla service" 就好了
```

換區域：改容器名、資料夾、`tile_urls`（Geofabrik 的分區：台灣 asia/taiwan、關東 asia/japan/kanto…）、埠號。

## 每次：產矩陣

```
node tools/geocode.mjs ../kb/sendai          # 先有座標：Nominatim 查，查不到留 null；人工補 coords.manual.json
node tools/walk-matrix.mjs ../kb/sendai      # 打 Valhalla /sources_to_targets，寫 ../kb/sendai/walk.json
```

`walk.json` 的形狀：`{ "<poiId>|<poiId>": { "min": 12, "m": 950 } }`，雙向各一筆。引擎 `geo/matrix.js` 先查它，沒有才用直線距離 ×1.3 並記警告。

## 未量

建圖時間、高程 tile 大小、矩陣與 Google Maps 的誤差，跑過才知道；量了寫進 DEVLOG。
