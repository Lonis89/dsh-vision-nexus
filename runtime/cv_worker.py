#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
dsh-vision-nexus — 引擎 A：本地 Python CV 运行时 (cv_worker.py)
=====================================================================
通过 JSON 行协议与 TypeScript 调度层通信：
  - 探测模式： python cv_worker.py --probe       -> 输出依赖自检结果并退出
  - 执行模式： python cv_worker.py --run          <- stdin 一行 JSON 请求
                                                  -> stdout 最后一行是 JSON 结果

请求结构：
  {
    "op": "detect|crop|pixel_diff|extract_foreground|color_extract|
            trace_svg|html_render_snapshot|long_ocr|preprocess",
    "image_ids": ["img:0", ...],
    "params": { ... , "_image_paths": ["/abs/path/a.png", ...], "bbox": {...} },
    "workdir": "/abs/session/temp",
    "config": {"tileEdgePx":768, "preprocessMaxEdgePx":1280, "preprocessQuality":82}
  }

结果结构（stdout 最后一行）：
  {
    "data": { ... 结构化业务结果 ... },          # 不含图像二进制
    "confidence": 0.0..1.0,                      # 必带置信度
    "artifact_paths": ["/abs/session/temp/xxx.png"]  # 产物绝对路径（调度层注册为 Artifact）
  }

依赖策略：
  - 优先使用 Pillow / numpy；若缺失，自动降级到标准库实现（仍能完成大部分像素任务）。
  - HTML 渲染截图：优先 Playwright，缺失时返回明确的能力限制说明（不伪造）。
  - 长图 OCR：优先分块 + 可选 pytesseract；缺失时输出结构化 low-confidence 占位，
    绝不编造图中文字（严禁脑补）。

安全：所有原图 / 中间产物只写会话隔离目录，绝不打印 base64 到 stdout。
"""

import json
import sys
import os
import struct
from datetime import datetime, timezone

# ───────────────────────── 可选依赖 ─────────────────────────

try:
    from PIL import Image, ImageChops, ImageFilter, ImageDraw  # type: ignore
    HAS_PIL = True
except Exception:
    HAS_PIL = False

try:
    import numpy as np  # type: ignore
    HAS_NUMPY = True
except Exception:
    HAS_NUMPY = False


def _force_utf8_stdio():
    """把 stdout/stderr 固定为 UTF-8。

    Windows 下 Python 默认按系统代码页（cp936/GBK）编码 stdout，而宿主按 UTF-8
    解码，导致中文错误信息（如「越界」「无交集」）变成不可读乱码，降级链与模型
    都会拿到坏文本。这里在进程启动早期固定编码，使 worker 输出跨平台一致。
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


_force_utf8_stdio()


def emit(obj):
    """只把结构化 JSON 写到 stdout 最后一行；图像字节绝不外泄。"""
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def fail(msg):
    emit({"data": {"error": msg}, "confidence": 0.0, "artifact_paths": []})


# ───────────────────────── 探测模式 ─────────────────────────

def probe():
    emit({
        "data": {
            "python": sys.version.split()[0],
            "pillow": HAS_PIL,
            "numpy": HAS_NUMPY,
            "cv_engine": "ready",
        },
        "confidence": 1.0,
        "artifact_paths": [],
    })
    return 0


# ───────────────────────── 图像 IO ─────────────────────────

def load_image(path):
    """返回 (PIL.Image 或 None, width, height, mode)。

    损坏 / 不存在 / 不可解码的文件统一返回 (None, 0, 0, 'UNKNOWN')，由各算子
    的 img is None 分支给出结构化错误，避免异常冒泡成 exit 1 丢失错误语义。"""
    if HAS_PIL:
        try:
            img = Image.open(path)
            img.load()
            converted = img.convert("RGBA" if img.mode in ("RGBA", "LA") or "transparency" in img.info else "RGB")
            return converted, converted.width, converted.height, converted.mode
        except Exception:
            return None, 0, 0, "UNKNOWN"
    # 无 Pillow 时只解析尺寸（PNG/JPEG 头）。
    try:
        with open(path, "rb") as f:
            head = f.read(32)
    except Exception:
        return None, 0, 0, "UNKNOWN"
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        w, h = struct.unpack(">II", head[16:24])
        return None, w, h, "RGBA"
    return None, 0, 0, "UNKNOWN"


def save_png(img, path):
    if HAS_PIL:
        img.save(path, "PNG")
        return True
    return False


def out_path(workdir, op, ext="png"):
    os.makedirs(workdir, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
    return os.path.join(workdir, f"vnx_{op}_{stamp}.{ext}")


def clamp01(x):
    try:
        return max(0.0, min(1.0, float(x)))
    except Exception:
        return 0.0


def safe_int(value, default=None):
    """把不可信参数安全转成 int：None / NaN / Infinity / 非法字符串返回 default。

    Python 的 json.loads 默认接受 NaN/Infinity，int(nan) 会抛 ValueError 而被 run()
    捕获为 exit 1，丢失结构化错误语义。统一在此收口。"""
    if value is None or isinstance(value, bool):
        return default
    try:
        f = float(value)
        if f != f or f in (float("inf"), float("-inf")):  # NaN / Inf
            return default
        return int(f)
    except (TypeError, ValueError, OverflowError):
        return default


def safe_float(value, default=None):
    """把不可信参数安全转成有限 float：None / NaN / Infinity / 非法值返回 default。"""
    if value is None or isinstance(value, bool):
        return default
    try:
        f = float(value)
        if f != f or f in (float("inf"), float("-inf")):
            return default
        return f
    except (TypeError, ValueError, OverflowError):
        return default


# ───────────────────────── 各操作实现 ─────────────────────────

def op_detect(params, paths, cfg):
    """元素检测：连通区域近似 + 坐标框 + 编号 + 置信度。"""
    if not HAS_PIL or not paths:
        return {"data": {"elements": [], "notice": "元素检测需要 Pillow 运行时；当前不可用，未伪造检测结果。"},
                "confidence": 0.0, "artifact_paths": []}
    img, w, h, _ = load_image(paths[0])
    if img is None:
        return {"data": {"elements": [], "notice": "无法解码图像，未伪造检测结果。"},
                "confidence": 0.0, "artifact_paths": []}
    gray = img.convert("L")
    # 边缘密度投影：把图像划分为网格，统计高梯度块作为候选组件。
    if HAS_NUMPY:
        arr = np.asarray(gray, dtype=np.int16)
        gx = np.abs(np.diff(arr, axis=1, prepend=arr[:, :1]))
        gy = np.abs(np.diff(arr, axis=0, prepend=arr[:1, :]))
        edge = gx + gy
        cell = max(16, int(min(w, h) / 24))
        cols = max(1, w // cell)
        rows = max(1, h // cell)
        blocks = []
        for r in range(rows):
            for c in range(cols):
                sub = edge[r * cell:(r + 1) * cell, c * cell:(c + 1) * cell]
                density = float(sub.mean()) if sub.size else 0.0
                if density > 18:
                    blocks.append((c, r, density))
        block_coords = {(c, r) for c, r, _ in blocks}
        # 相邻块合并成矩形组件。
        elements = []
        used = set()
        idx = 1
        for c, r, density in sorted(blocks, key=lambda b: -b[2]):
            key = (c, r)
            if key in used:
                continue
            cw, ch, cells = 1, 1, [key]
            used.add(key)
            # 简单横向 / 纵向生长。
            changed = True
            while changed:
                changed = False
                for cc, rr in list(cells):
                    for nc, nr in ((cc + 1, rr), (cc, rr + 1)):
                        if (nc, nr) in block_coords and (nc, nr) not in used:
                            used.add((nc, nr))
                            cells.append((nc, nr))
                            cw = max(cw, nc - c + 1)
                            ch = max(ch, nr - r + 1)
                            changed = True
            bbox = {"x": c * cell, "y": r * cell,
                    "width": min(w - c * cell, cw * cell),
                    "height": min(h - r * cell, ch * cell)}
            conf = clamp01(0.45 + min(0.45, density / 120))
            elements.append({"index": idx, "label": "component", "bbox": bbox, "confidence": conf})
            idx += 1
            if idx > 60:
                break
    else:
        elements = []
    conf = clamp01(sum(e["confidence"] for e in elements) / len(elements)) if elements else 0.0
    return {"data": {"image_width": w, "image_height": h, "elements": elements,
                     "coordinate_system": "pixel, origin=top-left"},
            "confidence": conf, "artifact_paths": []}


def op_crop(params, paths, cfg):
    """按 bbox 裁剪子图，产物写入 workdir（调度层注册为 Artifact）。"""
    bbox = params.get("bbox") or {}
    x = safe_int(bbox.get("x", 0), 0)
    y = safe_int(bbox.get("y", 0), 0)
    bw = safe_int(bbox.get("width", 0), 0)
    bh = safe_int(bbox.get("height", 0), 0)
    if not HAS_PIL or not paths or bw <= 0 or bh <= 0:
        return {"data": {"error": "crop 需要 Pillow 运行时与合法 bbox"}, "confidence": 0.0, "artifact_paths": []}
    img, w, h, _ = load_image(paths[0])
    if img is None:
        return {"data": {"error": "无法解码图像，裁剪中止"}, "confidence": 0.0, "artifact_paths": []}
    # 先求交集再夹紧坐标，保证 right>left / lower>upper，避免 PIL 抛
    # "Coordinate 'right' is less than 'left'" 而 exit 1 丢失结构化错误。
    left, top = max(0, x), max(0, y)
    right, bottom = min(w, x + bw), min(h, y + bh)
    if right <= left or bottom <= top:
        return {"data": {"error": "bbox 与图像无交集（完全越界），裁剪中止",
                         "bbox": {"x": x, "y": y, "width": bw, "height": bh},
                         "image": {"width": w, "height": h}},
                "confidence": 0.0, "artifact_paths": []}
    x, y, x2, y2 = left, top, right, bottom
    sub = img.crop((x, y, x2, y2))
    p = out_path(cfg_workdir(params), "crop")
    save_png(sub, p)
    return {"data": {"bbox": {"x": x, "y": y, "width": x2 - x, "height": y2 - y},
                     "label": params.get("label", ""), "width": x2 - x, "height": y2 - y},
            "confidence": 1.0, "artifact_paths": [p] if os.path.exists(p) else []}


def op_pixel_diff(params, paths, cfg):
    """两图像素比对：差异热力图 + 差异坐标 + 差异占比 + 量化评估。"""
    if not (HAS_PIL and HAS_NUMPY) or len(paths) < 2:
        return {"data": {"error": "pixel_diff 需要 Pillow + numpy 运行时与两张已登记图像",
                         "notice": "多图比对强制走量化，禁止模糊文字对比；当前运行时不足，未伪造结果。"},
                "confidence": 0.0, "artifact_paths": []}
    a, aw, ah, _ = load_image(paths[0])
    b, bw, bh, _ = load_image(paths[1])
    if a is None or b is None or aw == 0 or ah == 0:
        return {"data": {"error": "无法解码图像，像素比对中止"},
                "confidence": 0.0, "artifact_paths": []}
    resized = (aw, ah) != (bw, bh)
    if resized:
        b = b.resize((aw, ah))
    aa = np.asarray(a.convert("RGB"), dtype=np.int16)
    bb = np.asarray(b.convert("RGB"), dtype=np.int16)
    delta = np.abs(aa - bb).mean(axis=2)
    # threshold 非法（NaN/Inf/字符串）时回退默认 24，避免 delta>nan 恒 False
    # 导致"静默误判 identical"；NaN 本身也不该从 JSON 进入业务判断。
    threshold = safe_float(params.get("threshold", 24), 24.0)
    threshold = max(0.0, min(255.0, threshold))
    mask = delta > threshold
    diff_pixels = int(mask.sum())
    total = aw * ah
    ratio = diff_pixels / total if total else 0.0
    # 差异坐标聚合（按网格给出差异块中心）。
    cell = max(16, int(min(aw, ah) / 16))
    coords = []
    for r in range(0, ah, cell):
        for c in range(0, aw, cell):
            sub = mask[r:r + cell, c:c + cell]
            if sub.size and float(sub.mean()) > 0.02:
                coords.append({"x": c, "y": r, "width": min(cell, aw - c),
                               "height": min(cell, ah - r),
                               "intensity": float(delta[r:r + cell, c:c + cell].mean())})
    # 热力图（红=差异）。
    heat = np.zeros((ah, aw, 3), dtype=np.uint8)
    heat[..., 0] = np.clip(delta * 3, 0, 255).astype(np.uint8)
    heat[..., 2] = np.clip((255 - delta) * 0.2, 0, 255).astype(np.uint8)
    hp = out_path(cfg_workdir(params), "diff_heat")
    Image.fromarray(heat, "RGB").save(hp, "PNG")
    quant = {"mean_abs_delta": float(delta.mean()), "max_abs_delta": float(delta.max()),
             "changed_ratio": round(ratio, 6), "threshold": threshold,
             "verdict": "identical" if ratio == 0 else ("minor" if ratio < 0.01 else "significant")}
    return {"data": {"diff_ratio": round(ratio, 6), "diff_pixels": diff_pixels,
                     "total_pixels": total, "diff_regions": coords[:200],
                     "quantitative": quant,
                     "resized_to_first": resized,
                     "notice": "已走 vision_pixel_diff 量化路径（非文字模糊对比）"
                               + ("；两图尺寸不一致，第二张已 resize 到第一张尺寸后比对" if resized else "")},
            "confidence": 1.0, "artifact_paths": [hp]}


def op_extract_foreground(params, paths, cfg):
    """前景抠图：GrabCut 近似（基于边缘/饱和度阈值），输出带 alpha 的 PNG。"""
    if not (HAS_PIL and HAS_NUMPY) or not paths:
        return {"data": {"error": "抠图需要 Pillow + numpy 运行时"}, "confidence": 0.0, "artifact_paths": []}
    img, w, h, _ = load_image(paths[0])
    if img is None:
        return {"data": {"error": "无法解码图像，抠图中止"}, "confidence": 0.0, "artifact_paths": []}
    rgb = np.asarray(img.convert("RGB"), dtype=np.int16)
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    sat = mx - mn
    # 背景近似：低饱和度的边角区域视为背景；其余为前景。
    alpha = np.where(sat > 28, 255, 0).astype(np.uint8)
    # 简单形态学：十字邻域投票平滑，减少椒盐。
    # 导入放进 try 内：numpy < 1.20 没有 sliding_window_view 时安静跳过平滑，
    # 不让 ImportError 冒泡到 run() 把整次抠图判成运行时错误。
    try:
        from numpy.lib.stride_tricks import sliding_window_view  # noqa
        pad = np.pad(alpha, 1, mode="edge")
        win = sliding_window_view(pad, (3, 3)).mean(axis=(2, 3))
        alpha = np.where(win > 127, 255, 0).astype(np.uint8)
    except Exception:
        pass
    rgba = np.dstack([rgb.astype(np.uint8), alpha])
    p = out_path(cfg_workdir(params), "foreground")
    Image.fromarray(rgba, "RGBA").save(p, "PNG")
    coverage = float((alpha > 0).mean())
    return {"data": {"mode": params.get("mode", "auto"), "foreground_coverage": round(coverage, 4),
                     "width": w, "height": h},
            "confidence": clamp01(0.5 + coverage * 0.4), "artifact_paths": [p]}


def op_color_extract(params, paths, cfg):
    """主色提取：量化聚类，输出十六进制色值 + 占比 + 色板图。"""
    if not HAS_PIL or not paths:
        return {"data": {"error": "主色提取需要 Pillow 运行时"}, "confidence": 0.0, "artifact_paths": []}
    img, w, h, _ = load_image(paths[0])
    if img is None:
        return {"data": {"error": "无法解码图像，主色提取中止"}, "confidence": 0.0, "artifact_paths": []}
    k = safe_int(params.get("color_count", 6), 6)
    small = img.convert("RGB").resize((64, 64))
    quantized = small.quantize(colors=max(2, min(24, k)))
    palette = quantized.getpalette()[: max(2, min(24, k)) * 3]
    counts = quantized.getcolors() or []
    total = sum(c for c, _ in counts) or 1
    colors = []
    for count, idx in sorted(counts, reverse=True):
        r, g, b = palette[idx * 3: idx * 3 + 3]
        colors.append({"hex": "#%02X%02X%02X" % (r, g, b),
                       "rgb": [r, g, b], "ratio": round(count / total, 4)})
        if len(colors) >= k:
            break
    # 色板图（Artifact）。
    sw, sh = 480, 80
    palette_img = Image.new("RGB", (sw, sh), (255, 255, 255))
    draw = ImageDraw.Draw(palette_img)
    x = 0
    for c in colors:
        cw = max(1, int(sw * c["ratio"]))
        draw.rectangle([x, 0, min(sw, x + cw), sh], fill=tuple(c["rgb"]))
        x += cw
    p = out_path(cfg_workdir(params), "palette")
    palette_img.save(p, "PNG")
    return {"data": {"colors": colors, "palette_colors": len(colors), "color_space": "sRGB"},
            "confidence": 0.95, "artifact_paths": [p]}


def op_trace_svg(params, paths, cfg):
    """轮廓追踪：位图二值化 → 边界矩形近似 → SVG 路径（矢量图 Artifact）。"""
    if not (HAS_PIL and HAS_NUMPY) or not paths:
        return {"data": {"error": "SVG 轮廓追踪需要 Pillow + numpy 运行时"}, "confidence": 0.0, "artifact_paths": []}
    img, w, h, _ = load_image(paths[0])
    if img is None:
        return {"data": {"error": "无法解码图像，轮廓追踪中止"}, "confidence": 0.0, "artifact_paths": []}
    gray = np.asarray(img.convert("L"), dtype=np.uint8)
    simplify = safe_float(params.get("simplify", 0.02), 0.02)
    simplify = max(0.0, min(1.0, simplify))
    bin_img = gray < 200
    # 用行/列投影近似轮廓：生成若干矩形 path（轻量矢量化，不依赖 cv2）。
    rects = []
    step = max(4, int(min(w, h) * simplify) or 4)
    for y in range(0, h, step):
        row = bin_img[y:y + step]
        xs = np.where(row.any(axis=0))[0]
        if xs.size:
            rects.append((int(xs.min()), y, int(xs.max() - xs.min() + 1), step))
    svg_parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">',
                 '<g fill="#000" fill-rule="evenodd">']
    for x, y, rw, rh in rects[:400]:
        svg_parts.append(f'<rect x="{x}" y="{y}" width="{rw}" height="{rh}"/>')
    svg_parts.append('</g></svg>')
    svg = "\n".join(svg_parts)
    p = out_path(cfg_workdir(params), "trace", "svg")
    with open(p, "w", encoding="utf-8") as f:
        f.write(svg)
    return {"data": {"width": w, "height": h, "path_segments": len(rects),
                     "simplify": simplify, "format": "svg"},
            "confidence": clamp01(0.55 + min(0.35, len(rects) / 500)), "artifact_paths": [p]}


def op_html_render_snapshot(params, paths, cfg):
    """HTML 渲染截图：用于 UI 复现闭环校验。"""
    html = params.get("html", "")
    w = int(params.get("width", 1280))
    h = int(params.get("height", 720))
    if not html:
        return {"data": {"error": "html 不能为空"}, "confidence": 0.0, "artifact_paths": []}
    # 面板「渲染截图依赖检测」关闭时不生成截图，明确告知能力限制（不伪造）。
    if cfg.get("browserRenderEnabled") is False:
        return {"data": {"renderer": "disabled",
                         "notice": "面板已关闭渲染截图依赖检测，未生成真实截图；不伪造像素结果。"},
                "confidence": 0.0, "artifact_paths": []}
    # 优先 Playwright；缺失时写 HTML 到 workdir 并返回明确的能力限制（不伪造截图）。
    try:
        from playwright.sync_api import sync_playwright  # type: ignore
        p = out_path(cfg_workdir(params), "html_snapshot")
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": w, "height": h})
            page.set_content(html, wait_until="load")
            page.screenshot(path=p)
            browser.close()
        return {"data": {"width": w, "height": h, "renderer": "playwright/chromium"},
                "confidence": 1.0, "artifact_paths": [p]}
    except Exception as e:
        # 降级：保存 HTML 源，明确告知未生成真实截图。
        p = out_path(cfg_workdir(params), "html_source", "html")
        with open(p, "w", encoding="utf-8") as f:
            f.write(str(html))
        return {"data": {"renderer": "unavailable", "notice":
                         "Playwright 不可用，未生成真实渲染截图；已保存 HTML 源供后续复现，不伪造像素结果。",
                         "width": w, "height": h},
                "confidence": 0.0, "artifact_paths": [p]}


def op_long_ocr(params, paths, cfg):
    """长图分段结构化 OCR：按 tileEdgePx 分块 → 逐段输出带位置标记的 markdown。"""
    if not paths:
        return {"data": {"error": "缺少图像"}, "confidence": 0.0, "artifact_paths": []}
    # 关键：tile 必须 >= 1，否则 while 循环 y=y+tile 不前进 → 死循环。
    # 正常面板路径有 config.ts 钳制，但 worker 作为独立协议端点必须自我保护。
    tile = safe_int(cfg.get("tileEdgePx", params.get("_tileEdgePx", 768)), 768)
    tile = max(1, min(8192, tile))
    language = params.get("language", "auto")
    # 面板 OCR 语言（zh/en/mix）→ tesseract lang 参数；auto 用引擎默认。
    TESS_LANG = {"zh": "chi_sim", "en": "eng", "mix": "chi_sim+eng", "auto": None}
    tess_lang = TESS_LANG.get(language, None)
    segments = []
    try:
        from PIL import Image  # noqa
        img, w, h, _ = load_image(paths[0])
        if img is None:
            return {"data": {"error": "无法解码图像，长图 OCR 中止"},
                    "confidence": 0.0, "artifact_paths": []}
        y = 0
        idx = 0
        while y < h:
            idx += 1
            y2 = min(h, y + tile)
            text = ""
            # 可选 tesseract；缺失时保持空文本（不编造文字）。
            try:
                import pytesseract  # type: ignore
                sub = img.crop((0, y, w, y2))
                text = pytesseract.image_to_string(sub, lang=tess_lang).strip()
            except Exception:
                text = ""
            segments.append({"segment": idx, "bbox": {"x": 0, "y": y, "width": w, "height": y2 - y},
                             "text": text, "confidence": 0.8 if text else 0.0,
                             "ocr_available": bool(text)})
            y = y2
        conf = clamp01(sum(s["confidence"] for s in segments) / len(segments)) if segments else 0.0
    except Exception:
        # 连 PIL 都没有：仅按配置给出结构化占位，绝无编造。
        segments.append({"segment": 1, "bbox": None, "text": "",
                         "confidence": 0.0, "ocr_available": False})
        conf = 0.0
    markdown = "\n\n".join(
        f"<!-- segment:{s['segment']} pos:{s['bbox']} conf:{s['confidence']} -->\n{s['text'] or '[无可识别文本]'}"
        for s in segments
    )
    return {"data": {"markdown": markdown, "segments": segments, "language": language,
                     "tiled": len(segments) > 1,
                     "notice": "" if conf > 0 else "本地 OCR 引擎未装载，未提取到任何文字；请配置 VL 后端或安装 tesseract，模型不得据此脑补内容。"},
            "confidence": conf, "artifact_paths": []}


def op_preprocess(params, paths, cfg):
    """上传前压缩预处理：按最长边等比降采样 + 质量压缩，产物写入 workdir。

    约定（安全 / 正确性）：
      - 只在确实能减小体积时才产出新文件；否则 changed=false，调用方保留原字节。
      - 带 alpha 的图保持 PNG（不因 JPEG 压缩丢透明），其余转 JPEG 按质量压缩。
      - 无 Pillow 时明确报 changed=false + 原因，绝不伪造"已压缩"。
      - 结果只含元信息（尺寸/字节数/媒体类型），图像字节不进 stdout。
    """
    if not HAS_PIL or not paths:
        return {"data": {"changed": False,
                         "reason": "Pillow 不可用或缺输入图，保留原图"},
                "confidence": 1.0, "artifact_paths": []}
    try:
        max_edge = int(cfg.get("preprocessMaxEdgePx", 1280) or 1280)
        quality = int(cfg.get("preprocessQuality", 82) or 82)
        max_edge = max(1, min(8192, max_edge))
        quality = max(1, min(100, quality))
        img, w, h, mode = load_image(paths[0])
        if img is None:
            return {"data": {"changed": False, "reason": "无法解码图像，保留原图"},
                    "confidence": 1.0, "artifact_paths": []}
        src_bytes = os.path.getsize(paths[0]) if os.path.isfile(paths[0]) else 0
        scale = min(1.0, max_edge / max(w, h)) if max(w, h) else 1.0
        nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
        resized = scale < 1.0
        has_alpha = "A" in mode or "transparency" in img.info
        workdir = cfg_workdir(params)
        if resized:
            try:
                resample = Image.Resampling.LANCZOS
            except Exception:
                resample = Image.LANCZOS
            img = img.resize((nw, nh), resample)
        # 生成候选（带 alpha 只能 PNG；无 alpha 同时试 PNG / JPEG），
        # 选出「体积最小且小于原图」的一个；任何候选都不比原图小则保留原图。
        # 避免"降采样后反而更大"（如 Synthetic 渐变图转 JPEG）的负优化。
        workdir = cfg_workdir(params)
        cand_png = os.path.join(workdir, "candidate.png")
        cand_jpg = os.path.join(workdir, "candidate.jpg")
        candidates = []
        try:
            img.save(cand_png, "PNG", optimize=True)
            candidates.append((cand_png, "image/png", os.path.getsize(cand_png)))
        except Exception:
            pass
        if not has_alpha:
            try:
                img.convert("RGB").save(cand_jpg, "JPEG", quality=quality, optimize=True, progressive=True)
                candidates.append((cand_jpg, "image/jpeg", os.path.getsize(cand_jpg)))
            except Exception:
                pass
        if not candidates:
            return {"data": {"changed": False, "reason": "编码候选均失败，保留原图"},
                    "confidence": 0.0, "artifact_paths": []}
        best_path, media_type, out_bytes = min(candidates, key=lambda c: c[2])
        if not src_bytes or out_bytes >= src_bytes:
            for p, _, _ in candidates:
                try:
                    os.remove(p)
                except Exception:
                    pass
            return {"data": {"changed": False,
                             "reason": "压缩未减小体积，保留原图",
                             "width": nw, "height": nh,
                             "best_candidate_bytes": out_bytes},
                    "confidence": 1.0, "artifact_paths": []}
        # 把胜出候选规范化命名为产物（清理落选文件）。
        out = out_path(workdir, "preprocess", "png" if media_type == "image/png" else "jpg")
        os.replace(best_path, out)
        for p, _, _ in candidates:
            if p != best_path:
                try:
                    os.remove(p)
                except Exception:
                    pass
        return {"data": {"changed": True, "media_type": media_type,
                         "width": nw, "height": nh, "original_width": w, "original_height": h,
                         "source_bytes": src_bytes, "processed_bytes": os.path.getsize(out),
                         "scale": round(scale, 4)},
                "confidence": 1.0, "artifact_paths": [out]}
    except Exception as e:
        return {"data": {"changed": False, "reason": "压缩异常: %s" % e},
                "confidence": 0.0, "artifact_paths": []}


def cfg_workdir(params):
    return params.get("_workdir") or os.getcwd()


OPS = {
    "detect": op_detect,
    "crop": op_crop,
    "pixel_diff": op_pixel_diff,
    "extract_foreground": op_extract_foreground,
    "color_extract": op_color_extract,
    "trace_svg": op_trace_svg,
    "html_render_snapshot": op_html_render_snapshot,
    "long_ocr": op_long_ocr,
    "preprocess": op_preprocess,
}


# ───────────────────────── 执行模式 ─────────────────────────

def run():
    raw = sys.stdin.readline()
    if not raw.strip():
        fail("空请求")
        return 1
    try:
        req = json.loads(raw)
    except Exception as e:
        fail("无法解析请求 JSON: %s" % e)
        return 1
    op = req.get("op")
    params = dict(req.get("params") or {})
    params["_workdir"] = req.get("workdir") or os.getcwd()
    paths = params.get("_image_paths") or []
    cfg = req.get("config") or {}
    handler = OPS.get(op)
    if not handler:
        fail("未知操作: %s" % op)
        return 1
    try:
        result = handler(params, paths, cfg)
        # 统一保证：置信度字段、产物列表、且 data 内不含 base64。
        result.setdefault("confidence", 0.0)
        result["confidence"] = clamp01(result["confidence"])
        result.setdefault("artifact_paths", [])
        result.setdefault("data", {})
        emit(result)
        return 0
    except Exception as e:
        fail("运行时错误: %s" % e)
        return 1


if __name__ == "__main__":
    if "--probe" in sys.argv:
        sys.exit(probe())
    elif "--run" in sys.argv:
        sys.exit(run())
    else:
        emit({"data": {"usage": "cv_worker.py --probe | --run"}, "confidence": 1.0, "artifact_paths": []})
        sys.exit(0)
