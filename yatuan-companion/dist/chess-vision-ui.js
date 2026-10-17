import { calibrateBoard, createStoneTracker, matchStoneDetection } from './chess-vision-core.js';
import { detectReferenceStones } from './chess-stone-detector.js';
import { isTransientStoneMiss } from './chess-vision-feedback.js';

const CORNERS = ['A1', 'O1', 'O15', 'A15'];
const SERVICE = 'http://127.0.0.1:4181';
const ROUND = n => Math.round(n * 10) / 10;

export function mountChessVision({ host, getState, onMove, onStatus }) {
  host.innerHTML = `
    <div class="cvn-steps"><span><b>01</b> 接摄像头</span><span><b>02</b> 标定四个角</span><span><b>03</b> 放下真实黑子</span></div>
    <div class="cvn-layout"><div class="cvn-camera-column">
      <div class="cvn-device-row"><label class="sr-only" for="cvn-device">棋盘摄像头</label><select id="cvn-device"><option value="">系统默认摄像头</option></select><button type="button" data-action="devices">刷新</button><button type="button" data-action="camera">连接摄像头</button></div>
      <div class="cvn-orientation"><label for="cvn-rotation">画面方向</label><select id="cvn-rotation"><option value="0">保持原方向</option><option value="180">旋转 180°</option></select><small>倒置摄像头可以转正后再标定。</small></div>
      <video class="cvn-video" muted playsinline></video><div class="cvn-preview"><canvas id="cvn-canvas" width="960" height="540" aria-label="摄像头棋盘画面，标定时按顺序点击四角" tabindex="0"></canvas><div class="cvn-placeholder"><span>⌗</span><strong>把摄像头对准整张投影棋盘</strong><p>只拍棋盘，不使用麦克风。画面留在本机。</p></div><span class="cvn-frame-label">尚未连接</span></div>
      <div class="cvn-calibration-actions"><button type="button" data-action="calibrate">拍照标定四角</button><button type="button" data-action="accept" hidden>确认这 225 个交叉点</button><label class="cvn-upload">导入棋盘照片<input id="cvn-photo" type="file" accept="image/png,image/jpeg,image/webp"></label><label class="cvn-upload">导入四角坐标<input id="cvn-coordinate-file" type="file" accept="application/json,.json"></label></div>
      <p class="cvn-hint" id="cvn-calibration-hint">在摄像头画面中依次点 A1 → O1 → O15 → A15。选择最外侧的交叉点，不是棋盘外框。</p>
    </div><div class="cvn-settings">
      <label for="cvn-engine">黑子识别方式</label><select id="cvn-engine"><option value="reference">空盘参照辅助识别 · 无需模型</option><option value="yolo">YOLO · 本机棋子模型</option></select>
      <p class="cvn-engine-note">覆盖落子 · 抗抖动版：黑子盖住唯一交叉点即可，轻微画面波动会保留确认进度。空盘参照算法，不是 YOLO。</p>
      <div class="cvn-reference"><button type="button" data-action="reference">记录空棋盘</button><span id="cvn-reference-state">尚未记录</span></div>
      <details class="cvn-reference-preview" hidden><summary>查看已记录的空盘</summary><canvas id="cvn-reference-canvas" aria-label="已记录的空棋盘参照"></canvas><p class="cvn-small">这里应该没有实体黑子。如果记录时已经放了黑子，请拿开后重新记录。</p></details>
      <div class="cvn-yolo" hidden><p>推理服务：<code>127.0.0.1:4181</code></p><button type="button" data-action="health">检查 YOLO 模型</button><p id="cvn-model-state">尚未检查。需要专门识别黑子的本机模型。</p></div>
      <label for="cvn-threshold">辅助识别灵敏度 <output id="cvn-threshold-value">23</output></label><input id="cvn-threshold" type="range" min="12" max="50" value="23"><p class="cvn-small">数字越低越灵敏；阴影被误识别时调高。</p>
      <div class="cvn-start-actions"><button type="button" class="cvn-primary" data-action="start">开始实物落子</button><button type="button" data-action="check">检查这一帧</button></div>
      <div class="cvn-status" role="status"><span class="cvn-status-dot"></span><p id="cvn-status-text">先打开右上角「棋局投影」，再连接拍摄桌面的摄像头。</p></div><progress id="cvn-progress" value="0" max="1" aria-label="落子稳定确认进度"></progress>
      <p class="cvn-small">开始后先等「准备好了」，再放下黑子并移开手。累计至少 3 个有效帧、约 700 毫秒后入局；短暂漏检不清空已有进度。芽团会自动下白子。也可以直接在网页落子。</p>
      <a class="cvn-guide" href="chess-camera-guide.html" target="_blank" rel="noopener">连接与标定说明 ↗</a>
    </div></div>
    <details class="cvn-coordinate-panel"><summary>四角与全部 225 个交叉点坐标 <span id="cvn-coordinate-count">等待标定</span></summary><p id="cvn-coordinate-info">相机坐标与投影坐标属于不同画面，通过四角透视标定对应。</p><div class="cvn-coordinate-actions"><button type="button" data-action="export" disabled>导出坐标 JSON</button></div><div class="cvn-corner-list"></div><div class="cvn-table-wrap"><table><thead><tr><th>位置</th><th>相机 X</th><th>相机 Y</th><th>投影 X</th><th>投影 Y</th></tr></thead><tbody></tbody></table></div></details>`;
  const $ = selector => host.querySelector(selector);
  const canvas = $('#cvn-canvas'), context = canvas.getContext('2d');
  const raw = document.createElement('canvas'), rawContext = raw.getContext('2d', { willReadFrequently: true });
  const video = $('.cvn-video');
  let stream = null, cameraStarting = false, cameraToken = 0, disposed = false, frameTimer = null;
  let photo = null, photoOriginal = null, frame = null, frozen = null, selecting = false, points = [], draft = null, calibration = null, reference = null;
  let calibrationProjection = null, calibrationOwner = null, capturedProjection = null, capturedOwner = null, modelReady = false, active = false, generation = 0, busy = false, request = null;
  let lastDetection = [], lastDiagnostic = [], detectionBlocked = false, lastResult = null, lastStatusKey = '', lastCoordinateKey = '', frameTime = -1;
  let previousState = null, sourceId = 'none', sourceDetails = null, lastReason = '';
  const tracker = createStoneTracker({ maxFrameGapMs: 3500 });

  function status(message, code = 'idle', candidate = null, progress = 0) {
    lastReason = message;
    $('#cvn-status-text').textContent = message;
    $('#cvn-progress').value = progress || 0;
    $('.cvn-status').classList.toggle('is-active', active);
    $('.cvn-status').classList.toggle('is-warning', ['blocked', 'unmatched', 'multiple', 'clear-required', 'invalid-frame', 'error', 'model-required'].includes(code));
    $('[data-action="start"]').textContent = active ? '暂停实物落子' : '开始实物落子';
    const value = { active, status: code, message, engine: $('#cvn-engine').value, candidate: candidate ? { index: candidate.index, label: candidate.label } : null };
    const key = JSON.stringify(value);
    if (key !== lastStatusKey) { lastStatusKey = key; onStatus(value); }
  }
  function pause(message = '实物落子已暂停。') {
    active = false; generation++; tracker.disarm(); request?.abort(); request = null;
    lastDetection = []; lastDiagnostic = []; detectionBlocked = false; lastResult = null;
    status(message, 'paused');
  }
  function invalidate(message, clear = true) {
    if (clear) { calibration = draft = reference = null; calibrationProjection = calibrationOwner = capturedProjection = capturedOwner = null; points = []; selecting = false; frozen = null; tracker.setCalibration(null); $('[data-action="accept"]').hidden = true; $('#cvn-calibration-hint').textContent = message; }
    pause(message); renderCoordinates(); updateReference();
  }
  function updateReference() {
    $('#cvn-reference-state').textContent = reference ? '已记录 · 只保存在本页' : '尚未记录';
    $('.cvn-reference-preview').hidden = !reference || $('#cvn-engine').value !== 'reference';
    const preview = $('#cvn-reference-canvas');
    preview.width = reference?.width || 1; preview.height = reference?.height || 1;
    if (reference) preview.getContext('2d').putImageData(reference, 0, 0);
  }
  function rememberDetections(result) {
    lastDetection = result.detections || [];
    lastDiagnostic = result.blocked ? result.diagnostics?.previewDetections || [] : [];
    detectionBlocked = Boolean(result.blocked);
  }
  function drawOverlay() {
    if (!frame) return;
    canvas.width = frame.width; canvas.height = frame.height;
    context.putImageData(frame, 0, 0);
    const cal = draft || calibration, scale = Math.max(1, frame.width / 800);
    context.font = `${13 * scale}px system-ui`; context.lineWidth = 1.25 * scale;
    if (cal) {
      context.strokeStyle = '#efff8a9c';
      for (let n = 0; n < 15; n++) {
        for (const [start, end] of [[n * 15, n * 15 + 14], [n, 210 + n]]) {
          const a = cal.intersections[start], b = cal.intersections[end];
          context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
        }
      }
      context.fillStyle = '#edff96';
      for (const p of cal.intersections) { context.beginPath(); context.arc(p.x, p.y, 1.7 * scale, 0, Math.PI * 2); context.fill(); }
    }
    (selecting ? points : cal?.corners || []).forEach((p, index) => {
      context.fillStyle = '#f9db78'; context.beginPath(); context.arc(p.x, p.y, 6 * scale, 0, Math.PI * 2); context.fill();
      context.fillStyle = '#151f14'; context.fillRect(p.x + 8 * scale, p.y - 20 * scale, 35 * scale, 20 * scale);
      context.fillStyle = '#fff9d4'; context.fillText(CORNERS[index], p.x + 11 * scale, p.y - 5 * scale);
    });
    for (const detection of [...lastDetection, ...lastDiagnostic]) {
      const center = detection.center || { x: detection.bbox[0] + detection.bbox[2] / 2, y: detection.bbox[1] + detection.bbox[3] / 2 };
      const match = calibration && matchStoneDetection(calibration, detection);
      context.strokeStyle = detectionBlocked ? '#ffd286' : '#69f6d1'; context.lineWidth = 2 * scale;
      const box = detection.bbox;
      if (box) context.strokeRect(...box);
      context.beginPath(); context.arc(center.x, center.y, 5 * scale, 0, Math.PI * 2); context.stroke();
      if (match) {
        context.beginPath(); context.moveTo(center.x, center.y); context.lineTo(match.x, match.y); context.stroke();
        context.fillStyle = detectionBlocked ? '#ffe0a6' : '#b2ffe9'; context.fillText(`${match.label} · ${detectionBlocked ? '待确认' : '黑子候选'}`, center.x + 10 * scale, center.y - 10 * scale);
      } else { context.fillStyle = '#ffe0a6'; context.fillText('检测到暗物 · 位置待确认', center.x + 10 * scale, center.y - 10 * scale); }
    }
    $('.cvn-placeholder').hidden = true;
    $('.cvn-frame-label').textContent = `${photo ? '照片 · 不自动落子' : selecting ? '标定快照' : '实时摄像头'} / ${frame.width} × ${frame.height}`;
  }
  function readFrame(ignoreFrozen = false) {
    if (frozen && !ignoreFrozen) return frozen;
    if (photo) return photo;
    if (!stream || video.readyState < 2 || !video.videoWidth) return null;
    const sourceWidth = video.videoWidth, sourceHeight = video.videoHeight;
    const scale = Math.min(1, 1600 / Math.max(sourceWidth, sourceHeight));
    const width = Math.round(sourceWidth * scale), height = Math.round(sourceHeight * scale);
    if (raw.width !== width || raw.height !== height) { raw.width = width; raw.height = height; }
    rawContext.save();
    if ($('#cvn-rotation').value === '180') { rawContext.translate(width, height); rawContext.rotate(Math.PI); }
    rawContext.drawImage(video, 0, 0, width, height); rawContext.restore();
    sourceDetails = { sourceWidth, sourceHeight, width, height, scale, scaleX: width / sourceWidth, scaleY: height / sourceHeight, rotation: Number($('#cvn-rotation').value) };
    return rawContext.getImageData(0, 0, width, height);
  }
  function copyFrame(value) { return new ImageData(new Uint8ClampedArray(value.data), value.width, value.height); }
  function rotatedPhoto() {
    if (!photoOriginal) return null;
    if ($('#cvn-rotation').value !== '180') return copyFrame(photoOriginal);
    const data = new Uint8ClampedArray(photoOriginal.data.length);
    for (let i = 0; i < data.length; i += 4) data.set(photoOriginal.data.subarray(data.length - i - 4, data.length - i), i);
    return new ImageData(data, photoOriginal.width, photoOriginal.height);
  }
  function renderCoordinates() {
    const projection = getState().projectionGeometry;
    const cal = draft || calibration;
    const key = `${cal?.signature || ''}|${projection?.signature || ''}`;
    if (key === lastCoordinateKey) return;
    lastCoordinateKey = key;
    const projected = projection?.intersections || [];
    const intersections = cal?.intersections || projected;
    $('#cvn-coordinate-count').textContent = cal ? '225 / 225 已计算' : projected.length ? '投影已就绪 · 等待相机标定' : '等待标定';
    $('[data-action="export"]').disabled = !cal;
    $('#cvn-coordinate-info').textContent = cal ? `相机识别图：${cal.width} × ${cal.height} 像素。${projection ? `投影视口：${projection.width} × ${projection.height} CSS 像素。` : '投影尚未连接。'}原点均在各自画面的左上角；行号由 A1 向 A15 增大。` : '投影坐标来自实际棋盘大小；相机坐标须在摄像头画面中完成四角标定。';
    const cell = value => Number.isFinite(value) ? String(ROUND(value)) : '—';
    $('tbody').innerHTML = intersections.map((p, i) => `<tr><td>${p.label}</td><td>${cell(cal?.intersections[i]?.x)}</td><td>${cell(cal?.intersections[i]?.y)}</td><td>${cell(projected[i]?.x)}</td><td>${cell(projected[i]?.y)}</td></tr>`).join('');
    $('.cvn-corner-list').innerHTML = [0, 14, 224, 210].map((index, i) => `<div><strong>${CORNERS[i]}</strong><span>相机 (${cell(cal?.intersections[index]?.x)}, ${cell(cal?.intersections[index]?.y)})</span><span>投影 (${cell(projected[index]?.x)}, ${cell(projected[index]?.y)})</span></div>`).join('');
  }
  async function devices() {
    try {
      const entries = await navigator.mediaDevices?.enumerateDevices?.() || [];
      const select = $('#cvn-device'), selected = select.value;
      select.replaceChildren(new Option('系统默认摄像头', ''));
      entries.filter(item => item.kind === 'videoinput').forEach((item, i) => select.add(new Option(item.label || `摄像头 ${i + 1}`, item.deviceId)));
      if ([...select.options].some(item => item.value === selected)) select.value = selected;
    } catch { status('暂时无法读取摄像头列表。可先连接默认摄像头。', 'error'); }
  }
  function closeCamera(message) {
    cameraToken++; cameraStarting = false;
    stream?.getTracks().forEach(track => track.stop()); stream = null; video.srcObject = null;
    $('[data-action="camera"]').textContent = '连接摄像头';
    if (message) invalidate(message);
  }
  async function openCamera() {
    if (stream || cameraStarting) { closeCamera('摄像头已关闭，实物落子已暂停。'); return; }
    if (!navigator.mediaDevices?.getUserMedia) { status('请用 Chrome，通过 localhost 或 HTTPS 打开页面以使用摄像头。', 'error'); return; }
    invalidate('正在请求棋盘摄像头权限…'); photo = photoOriginal = null;
    const token = ++cameraToken; cameraStarting = true;
    $('[data-action="camera"]').textContent = '取消连接';
    const timeout = setTimeout(() => {
      if (cameraStarting && token === cameraToken) { cameraToken++; cameraStarting = false; $('[data-action="camera"]').textContent = '连接摄像头'; status('摄像头启动超时，请检查权限或设备占用后重试。', 'error'); }
    }, 15000);
    try {
      const id = $('#cvn-device').value;
      const next = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...(id ? { deviceId: { exact: id } } : {}), width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (disposed || token !== cameraToken) { next.getTracks().forEach(track => track.stop()); return; }
      stream = next; video.srcObject = next; await video.play();
      if (disposed || token !== cameraToken) { next.getTracks().forEach(track => track.stop()); return; }
      cameraStarting = false; sourceId = `camera:${next.getVideoTracks()[0]?.getSettings().deviceId || id}:${token}`;
      next.getVideoTracks().forEach(track => track.addEventListener('ended', () => { if (stream === next) closeCamera('摄像头已断开，请重新连接并标定。'); }, { once: true }));
      $('[data-action="camera"]').textContent = '关闭摄像头';
      status('摄像头已连接。打开投影角标，然后拍照标定四角。', 'camera-ready'); await devices();
    } catch (error) {
      if (token !== cameraToken || disposed) return;
      closeCamera();
      status(error.name === 'NotAllowedError' ? '摄像头权限未开启，请在地址栏允许后重试。' : error.name === 'NotFoundError' ? '没有找到摄像头，请连接 USB 摄像头。' : '摄像头未能启动，请检查设备占用、连接和权限。', 'error');
    } finally { clearTimeout(timeout); }
  }
  async function health() {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 4000);
    modelReady = false;
    try {
      const response = await fetch(`${SERVICE}/health`, { signal: controller.signal, credentials: 'omit', cache: 'no-store' });
      const info = await response.json();
      modelReady = response.ok && info.ready === true && info.engine === 'yolo';
      $('#cvn-model-state').textContent = modelReady ? `模型已就绪：${info.model || '本机棋子模型'}` : info.reason || '没有可用的黑子模型。';
      if (!modelReady) status('YOLO 模型尚未就绪；可先用辅助识别验证链路。', 'model-required');
    } catch { $('#cvn-model-state').textContent = '本机 YOLO 服务未连接。请按说明启动服务并加载棋子模型。'; status('YOLO 服务未连接，尚未开始识别。', 'model-required'); }
    finally { clearTimeout(timeout); }
    return modelReady;
  }
  async function detect(current) {
    if ($('#cvn-engine').value === 'reference') return detectReferenceStones(current, reference, calibration, { board: getState().game.board, darkening: Number($('#cvn-threshold').value) });
    raw.width = current.width; raw.height = current.height; rawContext.putImageData(current, 0, 0);
    const controller = new AbortController(); request = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${SERVICE}/detect`, { method: 'POST', credentials: 'omit', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: raw.toDataURL('image/jpeg', .9), confidence: .6 }) });
      const result = await response.json();
      if (!response.ok || result.ready !== true || result.engine !== 'yolo') throw new Error(result.reason || result.error || 'YOLO 推理未就绪。');
      if (result.width !== current.width || result.height !== current.height || !Array.isArray(result.detections)) throw new Error('模型返回的画面尺寸不匹配，本帧不落子。');
      const detections = result.detections.filter(d => d.className === 'black_stone' && [d.x,d.y,d.width,d.height,d.confidence].every(Number.isFinite) && d.width > 0 && d.height > 0 && d.confidence >= .6 && d.confidence <= 1)
        .map(d => ({ label: 'black', confidence: d.confidence, bbox: [d.x - d.width / 2, d.y - d.height / 2, d.width, d.height] }));
      return { detections, blocked: false };
    } finally { clearTimeout(timeout); if (request === controller) request = null; }
  }
  function readyToDetect() {
    if (!calibration) throw new Error('请先拍照，选择四个角并确认标定。');
    if ($('#cvn-engine').value === 'reference' && !reference) throw new Error('辅助识别需要先记录一张没有实体棋子的空棋盘。');
    if ($('#cvn-engine').value === 'yolo' && !modelReady) throw new Error('请先检查并加载 YOLO 黑子模型。');
  }
  async function checkFrame() {
    if (busy || active) { status('请先暂停自动落子，再检查单帧。', active ? 'running' : 'busy'); return; }
    try {
      readyToDetect(); frame = readFrame(); if (!frame) throw new Error('请先连接摄像头或导入棋盘照片。');
      busy = true; const token = generation; const result = await detect(frame); if (token !== generation || disposed) return; rememberDetections(result);
      const labels = lastDetection.map(d => matchStoneDetection(calibration, d)?.label).filter(Boolean);
      status(result.blocked ? result.reason : labels.length ? `检查结果：黑子候选 ${labels.join('、')}。这次只检查，不会落子。` : '没有发现相对空盘新增的黑子。可展开「查看已记录的空盘」，核对参照图中是否已有黑子。单帧检查不会落子。', result.blocked ? 'blocked' : 'inspection'); drawOverlay();
    } catch (error) { status(error.message, 'error'); }
    finally { busy = false; }
  }
  async function start() {
    if (active) { pause(); return; }
    try {
      if (!stream || photo) throw new Error('自动落子需要实时摄像头；导入照片只用于标定和检查。');
      const state = getState();
      if (state.mode !== 'pet' || state.demo || state.game.winner || state.game.draw) throw new Error('请在「和芽团下棋」的正常对局中开启。');
      if (!state.projectionGeometry) throw new Error('请先从本棋室打开「棋局投影」，并显示棋盘。');
      if (selecting) throw new Error('请先确认四角标定。');
      readyToDetect();
      if (calibrationProjection !== state.projectionGeometry.signature || calibrationOwner !== state.activeProjectionId) throw new Error('投影窗口或尺寸已变化，请在当前投影下重新拍照标定。');
      active = true; generation++; frameTime = -1; tracker.arm();
      status('先移开手和未记录的黑子，正在确认棋盘基线。', 'baseline');
    } catch (error) { status(error.message, 'error'); }
  }
  async function loop() {
    if (disposed) return;
    let acquired = false; const iterationToken = generation;
    try {
      const next = readFrame();
      if (next) {
        frame = next;
        if (calibration && (frame.width !== calibration.width || frame.height !== calibration.height)) invalidate('摄像头分辨率已变化，请重新标定。');
        drawOverlay();
      }
      if (active && frame && !selecting && !busy && video.currentTime !== frameTime) {
        frameTime = video.currentTime; busy = true; acquired = true;
        const token = generation, before = getState(), gameId = before.gameId, moveCount = before.game.moves.length;
        const result = await detect(frame);
        if (disposed || !active || token !== generation) return;
        const current = getState();
        if (current.gameId !== gameId || current.game.moves.length !== moveCount) return;
        rememberDetections(result);
        const transient = isTransientStoneMiss(result, lastResult);
        lastResult = tracker.update({ detections: result.blocked ? null : result.detections, transient, game: current.game, gameId: current.gameId, sourceSignature: `${sourceId}|${$('#cvn-rotation').value}|${calibration.signature}|${calibrationProjection}|${calibrationOwner}`, now: performance.now(), enabled: true, demo: current.demo, mode: current.mode });
        if (lastResult.status === 'accepted') {
          const accepted = lastResult;
          // Both input paths use the owner game; the owner checks occupancy/turn once more.
          if (onMove(accepted.index)) { if (!getState().game.winner && !getState().game.draw) status(`已落黑子 ${accepted.candidate.label}，芽团正在想下一步。`, 'accepted', accepted.candidate, 1); }
          else { tracker.disarm(); active = false; status('棋局已变化，本次识别未落子。整理棋盘后重新开启。', 'paused'); }
        } else {
          const seen = lastDetection.map(d => matchStoneDetection(calibration, d)?.label).filter(Boolean);
          const message = lastResult.status === 'clear-required' && seen.length ? `已看到 ${seen.join('、')} 黑子。启动检查尚未完成，请先拿开，等「准备好了」再放下。` : lastResult.reason;
          const blocked = result.blocked && lastResult.status !== 'transient';
          status(blocked ? result.reason : message, blocked ? 'blocked' : lastResult.status, lastResult.candidate, lastResult.progress);
        }
        drawOverlay();
      }
    } catch (error) {
      if (active && iterationToken === generation) { tracker.update({ detections: null, game: getState().game, gameId: getState().gameId, now: performance.now() }); pause(error.name === 'AbortError' ? '识别超时，已暂停。本次没有落子。' : `识别已暂停：${error.message}`); }
    } finally { if (acquired) busy = false; if (!disposed) frameTimer = setTimeout(loop, 280); }
  }
  function calibrate() {
    const captured = readFrame(true);
    if (!captured) { status('先连接摄像头或导入完整棋盘照片。', 'error'); return; }
    pause('请点摄像头画面中的 A1（投影棋盘左上交叉点）。');
    reference = calibration = draft = null; tracker.setCalibration(null); points = []; selecting = true; frozen = copyFrame(captured); frame = frozen;
    capturedProjection = getState().projectionGeometry?.signature || null; capturedOwner = getState().activeProjectionId || null;
    $('[data-action="accept"]').hidden = true;
    $('#cvn-calibration-hint').textContent = '第 1 / 4 点：A1。按 A1 → O1 → O15 → A15 的顺序点击交叉点。';
    drawOverlay(); updateReference(); renderCoordinates();
  }
  canvas.addEventListener('click', event => {
    if (!selecting || !frozen || points.length === 4) return;
    const rect = canvas.getBoundingClientRect();
    points.push({ x: (event.clientX - rect.left) / rect.width * frame.width, y: (event.clientY - rect.top) / rect.height * frame.height });
    if (points.length < 4) { $('#cvn-calibration-hint').textContent = `第 ${points.length + 1} / 4 点：${CORNERS[points.length]}。请点最外侧交叉点。`; drawOverlay(); return; }
    try {
      draft = calibrateBoard(points, frame.width, frame.height);
      $('[data-action="accept"]').hidden = false;
      $('#cvn-calibration-hint').textContent = '225 个点已叠加。检查绿点是否对齐每一个交叉点；对齐后确认，否则重新拍照标定。';
      status('请核对全部交叉点与四角，再确认标定。', 'calibrating'); renderCoordinates(); drawOverlay();
    } catch (error) { points = []; draft = null; status(error.message, 'error'); drawOverlay(); }
  });
  function acceptCalibration() {
    if (!draft) return;
    if (capturedProjection !== (getState().projectionGeometry?.signature || null) || capturedOwner !== (getState().activeProjectionId || null)) { invalidate('标定期间投影已变化，请重新拍照标定。'); return; }
    calibration = draft; draft = null; tracker.setCalibration(calibration);
    calibrationProjection = capturedProjection; calibrationOwner = capturedOwner;
    selecting = false; frozen = null; $('[data-action="accept"]').hidden = true;
    $('#cvn-calibration-hint').textContent = '已标定。移动摄像头、投影仪或改变投影尺寸后，请重新拍照标定。';
    status('四角和 225 个交叉点已就绪。辅助模式还需记录空棋盘。', 'calibrated'); renderCoordinates();
  }
  function recordReference() {
    if (!calibration || selecting) { status('先确认四角标定，再记录空棋盘。', 'error'); return; }
    if (getState().game.moves.length) { status('请先开始新的一局、移走实体棋子，再记录空棋盘。', 'error'); return; }
    pause('正在记录空棋盘。');
    const captured = readFrame(); if (!captured) { status('当前没有可用画面。', 'error'); return; }
    reference = copyFrame(captured); updateReference(); status('空棋盘已记录。确认画面没有实体棋子，再开始实物落子。', 'reference-ready');
  }
  $('#cvn-photo').addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file) return;
    if (file.size > 15 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { status('请选择 15 MB 以内的 PNG、JPEG 或 WebP 图片。', 'error'); return; }
    try {
      closeCamera(); pause('照片只用于坐标标定和单帧检查，不会自动落子。');
      const photoToken = generation;
      const bitmap = await createImageBitmap(file);
      if (disposed || photoToken !== generation) { bitmap.close(); return; }
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      raw.width = Math.round(bitmap.width * scale); raw.height = Math.round(bitmap.height * scale); rawContext.drawImage(bitmap, 0, 0, raw.width, raw.height);
      sourceDetails = { sourceWidth: bitmap.width, sourceHeight: bitmap.height, width: raw.width, height: raw.height, scale, scaleX: raw.width / bitmap.width, scaleY: raw.height / bitmap.height }; bitmap.close();
      photoOriginal = rawContext.getImageData(0, 0, raw.width, raw.height); photo = rotatedPhoto(); frame = photo; frozen = null; selecting = false; draft = null; $('[data-action="accept"]').hidden = true;
      sourceDetails.rotation = Number($('#cvn-rotation').value);
      if (calibration && (calibration.width !== photo.width || calibration.height !== photo.height)) invalidate('照片尺寸变化，请重新标定。');
      sourceId = 'photo'; lastDetection = []; drawOverlay();
      status(calibration ? '照片已更新，可检查这一帧。照片不会自动落子。' : '照片已导入，点击「拍照标定四角」开始标定。', 'photo');
    } catch { status('照片未能打开，请换一张 PNG 或 JPEG 图片。', 'error'); }
    event.target.value = '';
  });
  $('#cvn-coordinate-file').addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      const captured = readFrame(true); if (!captured) throw new Error('先连接摄像头或导入棋盘照片，再导入坐标。');
      if (file.size > 256 * 1024) throw new Error('标定 JSON 请小于 256 KB。');
      const importToken = generation, importProjection = getState().projectionGeometry?.signature || null, importOwner = getState().activeProjectionId || null;
      const data = JSON.parse(await file.text());
      if (disposed || importToken !== generation || importProjection !== (getState().projectionGeometry?.signature || null) || importOwner !== (getState().activeProjectionId || null)) throw new Error('导入期间画面或投影已变化，请重新导入坐标。');
      const exported = data.schema === 'yatuan-chess-calibration-v1';
      const width = exported ? data.camera?.sourceWidth : data.width, height = exported ? data.camera?.sourceHeight : data.height;
      const sourcePoints = exported ? [0,14,224,210].map(i => data.intersections?.[i]?.sourceImage) : data.corners;
      if (![width, height].every(n => Number.isFinite(n) && n > 0) || !Array.isArray(sourcePoints) || sourcePoints.length !== 4
        || sourcePoints.some(p => !p || ![p.x,p.y].every(Number.isFinite) || p.x < 0 || p.y < 0 || p.x > width || p.y > height)) throw new Error('坐标文件缺少有效的四角和原图尺寸。');
      if (Math.abs(width / height / (captured.width / captured.height) - 1) > .02) throw new Error('坐标文件和当前画面的比例不同，请重新拍照标定。');
      const rotated = $('#cvn-rotation').value === '180';
      const imported = sourcePoints.map(p => ({ x: (rotated ? width - p.x : p.x) / width * captured.width, y: (rotated ? height - p.y : p.y) / height * captured.height }));
      const validated = calibrateBoard(imported, captured.width, captured.height);
      pause('已导入四角预设，请核对 225 个点后确认。');
      calibration = reference = null; tracker.setCalibration(null); draft = validated; points = imported; selecting = true; frozen = copyFrame(captured); frame = frozen;
      capturedProjection = importProjection; capturedOwner = importOwner;
      $('[data-action="accept"]').hidden = false;
      $('#cvn-calibration-hint').textContent = '坐标已导入。必须核对当前画面的全部绿点；相机位置改变后，旧坐标不能直接使用。';
      renderCoordinates(); updateReference(); drawOverlay();
    } catch (error) { status(error instanceof SyntaxError ? '这不是有效的坐标 JSON。' : error.message, 'error'); }
    event.target.value = '';
  });
  function exportCoordinates() {
    if (!calibration) return;
    const projection = getState().projectionGeometry;
    const payload = { schema: 'yatuan-chess-calibration-v1', createdAt: new Date().toISOString(), order: CORNERS, camera: { ...sourceDetails, origin: 'top-left', corners: calibration.corners, homography: calibration.matrix }, projection: projection ? { width: projection.width, height: projection.height, unit: 'CSS pixel', corners: projection.corners } : null,
      intersections: calibration.intersections.map(p => ({ index: p.index, label: p.label, row: p.row, col: p.col, camera: { x: p.x, y: p.y }, sourceImage: { x: (sourceDetails?.rotation === 180 ? calibration.width - p.x : p.x) / (sourceDetails?.scaleX || 1), y: (sourceDetails?.rotation === 180 ? calibration.height - p.y : p.y) / (sourceDetails?.scaleY || 1) }, projection: projection?.intersections[p.index] ? { x: projection.intersections[p.index].x, y: projection.intersections[p.index].y } : null })) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'yatuan-chess-coordinates.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const actions = { camera: openCamera, devices, calibrate, accept: acceptCalibration, reference: recordReference, start, check: checkFrame, health, export: exportCoordinates };
  host.addEventListener('click', event => { const action = event.target.closest('[data-action]')?.dataset.action; if (actions[action]) void actions[action](); });
  $('#cvn-device').addEventListener('change', () => { closeCamera('摄像头选择已变化，请重新连接并标定。'); });
  $('#cvn-rotation').addEventListener('change', () => {
    invalidate('画面方向已改变，请重新拍照标定。');
    if (photoOriginal) { photo = rotatedPhoto(); frame = photo; sourceDetails.rotation = Number($('#cvn-rotation').value); drawOverlay(); }
  });
  $('#cvn-engine').addEventListener('change', () => {
    pause('识别方式已切换，请确认设置后重新开启。');
    const yolo = $('#cvn-engine').value === 'yolo';
    $('.cvn-yolo').hidden = !yolo; $('.cvn-reference').hidden = yolo; $('#cvn-threshold').disabled = yolo;
    updateReference();
    $('.cvn-engine-note').textContent = yolo ? '真实 YOLO 推理在本机服务中运行。需要训练过的黑子检测模型；没有模型时不会假装识别成功。' : '覆盖落子 · 抗抖动版：黑子盖住唯一交叉点即可，轻微画面波动会保留确认进度。空盘参照算法，不是 YOLO。';
    if (yolo) void health();
  });
  $('#cvn-threshold').addEventListener('input', () => { $('#cvn-threshold-value').textContent = $('#cvn-threshold').value; if (active) pause('灵敏度已改变，请重新开启实物落子。'); });
  function update(state) {
    const previous = previousState;
    previousState = { gameId: state.gameId, board: state.game.board.slice(), mode: state.mode, demo: state.demo, geometry: state.projectionGeometry?.signature || null, projectionId: state.activeProjectionId || null };
    if (previous) {
      if (state.mode !== 'pet' && previous.mode === 'pet') { closeCamera('已离开芽团对局，摄像头已关闭。'); }
      else if (state.gameId !== previous.gameId && (calibration || active)) { reference = null; tracker.disarm(); pause('新的一局已开始。清空实体棋子，重新记录空棋盘并开启。'); updateReference(); }
      else if (previous.board.some((stone, i) => stone && state.game.board[i] !== stone)) pause('棋局已悔棋或重置。请移走对应的实体黑子，再重新开启。');
      else if ((previous.geometry !== previousState.geometry || previous.projectionId !== previousState.projectionId) && (calibration || selecting || draft)) invalidate('投影窗口、尺寸或位置已变化，请重新拍照标定。');
      else if (state.demo && !previous.demo && active) pause('演示期间暂停实物落子。');
      else if (active && (state.game.winner || state.game.draw)) pause('本局结束，已暂停实物落子。');
    }
    renderCoordinates();
  }
  function destroy() { disposed = true; active = false; generation++; request?.abort(); clearTimeout(frameTimer); closeCamera(); tracker.disarm(); }
  void devices(); void loop();
  return { update, destroy };
}
