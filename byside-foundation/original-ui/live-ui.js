import { getLiveConfig, saveLiveConfig, discoverLocalAI } from './live.js';
import { createDesktopCompanion } from './desktop-companion.js';
import { getAIConfig, saveAIConfig, requestAI } from './ai.js';
import { esc, icon } from './stage.js';

export function mountLiveUI({ beforeStart = () => {}, onActive = () => {}, realtimeTools = [], onRealtimeToolCall } = {}) {
  const controller = createDesktopCompanion({ tools: realtimeTools, onToolCall: onRealtimeToolCall });
  const panel = document.createElement('dialog');
  panel.className = 'live-dialog';
  panel.setAttribute('aria-labelledby', 'live-title');
  panel.innerHTML = `<header class="modal-header"><div><span class="eyebrow">REAL WORLD · 在桌边，听见你</span><h2 id="live-title">桌边实时陪伴</h2></div><div class="live-header-actions"><button type="button" class="icon-btn" data-live="close" aria-label="收起实时陪伴面板">${icon('close')}</button></div></header>
  <div class="modal-body"><p class="live-intro">一边和芽团说话，一边看看桌上的食物与物品。</p>
  <div class="live-status" role="status"><i></i><div><strong id="live-mode">尚未开始</strong><p id="live-message"></p></div></div>
  <p class="live-error" role="alert" id="live-error"></p>
  <p class="live-error" role="status" id="live-voice-warning"></p>
  <div class="live-grid"><div><div class="live-camera"><video id="live-camera" autoplay muted playsinline></video><img id="live-camera-still" alt="共享摄像头最近采样的桌面画面" hidden><div id="live-camera-placeholder">${icon('camera',32)}<p>开启摄像头后，芽团就能看看桌面。</p></div><span id="live-camera-source">摄像头 · 对准实际桌面</span></div><p class="field-hint" id="live-observation">开始后，桌面采样图片会发送至已配置的视觉模型。</p><p class="field-hint" id="live-foods"></p></div>
  <div class="live-fields"><label class="field-label" for="live-camera-select">选择摄像头</label><select id="live-camera-select"></select><button type="button" class="text-btn" data-live="devices">刷新设备列表</button>
  <label class="field-label" for="live-interval">观察间隔</label><select id="live-interval"><option value="5">5 秒 · 互动频繁</option><option value="10">10 秒 · 日常陪伴</option><option value="15">15 秒 · 更安静</option></select>
  <label class="field-label" for="live-wake">称呼</label><input id="live-wake" maxlength="20" minlength="2" value="芽团芽团"><p class="field-hint">连接后可直接说话，也可以说“暂停观察”“继续观察”“结束陪伴”。音频发送至豆包实时语音服务。</p><label class="live-duplex"><input id="live-duplex" type="checkbox">耳机模式（可打断）</label></div></div>
  <div class="live-actions"><button type="button" class="btn primary small" data-live="start">开始陪伴</button><button type="button" class="btn secondary small" data-live="pause">暂停观察</button><button type="button" class="btn secondary small" data-live="stop">结束陪伴</button></div>
  <div class="live-metrics"><span id="live-frames">已拍摄 0 帧</span><span id="live-requests">已请求 0 次</span><span id="live-last">尚未观察</span></div>
  <form class="live-chat"><input id="live-text" aria-label="实时陪伴文字输入" placeholder="也可以输入：帮我看看盘子里有什么" maxlength="1000"><button class="btn primary" type="submit">发送</button></form>

  <details class="live-connection"><summary>AI 服务连接</summary><p class="field-hint">模型和 API Key 由本机服务的 .env 配置，修改后请重启服务。</p><input id="live-endpoint" type="hidden"><input id="live-model" type="hidden"><div class="button-row"><button type="button" class="btn secondary small" data-live="test-ai">测试文字连接</button></div><p class="field-hint" id="live-ai-result"></p></details>
  <a class="live-guide-link" href="help.html" target="_blank" rel="noopener">${icon('book', 17)} 查看设备连接和陪伴使用说明 ${icon('arrow', 16)}</a></div>`;
  document.body.append(panel);
  const $ = selector => panel.querySelector(selector);
  const video = $('#live-camera');
  let checking = false, testAbort = null, directAbort = null, wasActive = false, lifecycle = 0;
  const modeNames = { idle: '尚未开始', starting: '准备中', listening: '正在听你说话', observing: '语音与桌面观察已连接', thinking: '正在思考', speaking: '正在回应', paused: '语音已连接 · 观察已暂停', stopping: '正在结束', error: '需要处理' };
  function showError(message) { $('#live-error').textContent = message || ''; }
  async function refreshCameras() {
    try {
      const current = $('#live-camera-select').value || getLiveConfig().cameraId;
      const entries = await navigator.mediaDevices?.enumerateDevices?.() || [];
      const cameras = entries.filter(d => d.kind === 'videoinput');
      $('#live-camera-select').innerHTML = '<option value="">系统默认摄像头</option>' + cameras.map((c, i) => `<option value="${esc(c.deviceId)}">${esc(c.label || `摄像头 ${i + 1}`)}</option>`).join('');
      if (cameras.some(c => c.deviceId === current)) $('#live-camera-select').value = current;
      else if (current) { $('#live-camera-select').insertAdjacentHTML('beforeend', `<option value="${esc(current)}">上次选择的摄像头（待连接）</option>`); $('#live-camera-select').value = current; }
    } catch (error) { showError(error.message); }
  }
  async function loadFields() {
    const config = getLiveConfig(), ai = getAIConfig();
    $('#live-interval').value = String(config.intervalSeconds);
    $('#live-wake').value = config.wakePhrase;
    $('#live-endpoint').value = ai.endpoint || '/api/chat/completions';
    $('#live-model').value = ai.model;
    await refreshCameras();
  }
  controller.subscribe(status => {
    if(status.active && !wasActive) onActive();
    wasActive = status.active;
    const modeName = modeNames[status.mode] || status.mode;
    $('#live-mode').textContent = modeName;
    $('#live-message').textContent = status.message;
    $('#live-voice-warning').textContent = status.voiceWarning || '';
    panel.querySelector('.live-status').dataset.mode = status.mode;
    $('#live-camera-placeholder').hidden = Boolean(status.observing && (video.srcObject || status.previewImage));
    video.hidden = status.shared || !status.observing;
    const still = $('#live-camera-still'); still.hidden = !status.previewImage;
    if (status.previewImage && still.getAttribute('src') !== status.previewImage) still.src = status.previewImage;
    if (!status.previewImage) still.removeAttribute('src');
    $('#live-camera-source').textContent = status.sourceLabel ? `${status.sourceLabel}${status.shared ? ' · 共享采样画面' : ' · 实时预览'}` : '摄像头 · 对准实际桌面';
    $('#live-frames').textContent = `已拍摄 ${status.frameCount} 帧`;
    $('#live-requests').textContent = `已请求 ${status.requestCount} 次`;
    $('#live-last').textContent = status.lastFrameAt ? `最近 ${new Date(status.lastFrameAt).toLocaleTimeString('zh-CN')}` : '尚未观察';
    $('#live-observation').textContent = status.observation || '开始后，桌面图片会发送至已配置的视觉模型。采样图片只在当前会话中使用。';
    $('#live-foods').textContent = status.foods.length ? `看到的食物与饮品　${status.foods.map(food => `${food.name}${food.certain ? '' : '（待确认）'}`).join('、')}` : '';
    if (status.error) showError(status.error);
    else showError('');
    $('[data-live="start"]').disabled = status.active;
    $('[data-live="pause"]').textContent = status.observing ? '暂停观察' : '继续观察';
    panel.querySelectorAll('[data-live="pause"],[data-live="stop"]').forEach(el => { el.disabled = !status.active || (status.mode === 'starting' && el.dataset.live !== 'stop'); });
    if (!status.visionEnabled) $('[data-live="pause"]').disabled = true;
    for (const el of panel.querySelectorAll('.live-fields input,.live-fields select,[data-live="test-ai"],#live-endpoint,#live-model')) el.disabled = status.active;
    document.body.classList.toggle('live-running', status.active);
    const badge = document.querySelector('#projection-live-status');
    if (badge) { badge.textContent = status.active || status.error ? `${modeName}${status.error || status.voiceWarning ? ' · 请打开陪伴面板检查' : ''}` : ''; }
    document.querySelectorAll('[data-action="voice"],[data-action="meal-voice"]').forEach(button => button.disabled = status.active);
  });
  async function saveConnection() {
    if (controller.getStatus().active) throw new Error('请先结束陪伴，再修改连接。');
    saveAIConfig({ endpoint: $('#live-endpoint').value, model: $('#live-model').value });
    window.dispatchEvent(new Event('ai-config-changed'));
  }
  async function startSession() {
    if (checking || controller.getStatus().active) return;
    const wakePhrase = $('#live-wake').value.trim();
    if (wakePhrase.replace(/\s/g, '').length < 2) throw new Error('唤醒词至少需要两个字。');
    saveLiveConfig({ cameraId: $('#live-camera-select').value, intervalSeconds: Number($('#live-interval').value), wakePhrase });
    const token = ++lifecycle;
    checking = true;
    try {
      await beforeStart();
      const health = await discoverLocalAI();
      if (token !== lifecycle || !panel.open) return;
      if(health?.mode !== 'model') throw new Error('AI 服务尚未配置：请由站点管理员配置服务端密钥。本机运行时可在 .env 中填写后重启服务。');
      await controller.start(video, { fullDuplex: $('#live-duplex').checked });
      await refreshCameras();
    } finally { checking = false; }
  }
  async function startDirect({audioOnly=false} = {}) {
    if (checking || controller.getStatus().active) return false;
    const token = ++lifecycle, abort = new AbortController();
    directAbort = abort; checking = true;
    try {
      await beforeStart();
      if (token !== lifecycle) return false;
      let response;
      try {
        response = await fetch('/api/v1/health', { cache: 'no-store', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]) });
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        throw new Error(error.name === 'TimeoutError' ? '连接本机陪伴服务超时。' : '无法连接本机陪伴服务。');
      }
      if (!response.ok) throw new Error('无法连接本机陪伴服务。');
      const health = await response.json().catch(() => { throw new Error('本机陪伴服务返回的数据无效。'); });
      if (token !== lifecycle) return false;
      directAbort = null; checking = false;
      return await controller.start(video, {
        fullDuplex: $('#live-duplex').checked,
        cameraId: '',
        sharedCameraOnly: true,
        desktopVision: !audioOnly && (health.speech?.provider === 'bailian' || health.mode === 'model'),
      });
    } finally {
      if (directAbort === abort) { directAbort = null; checking = false; }
    }
  }
  function stopDirect() {
    lifecycle++;
    if (directAbort) { directAbort.abort(); directAbort = null; checking = false; }
    return controller.stop();
  }
  panel.addEventListener('click', async event => {
    const action = event.target.closest('[data-live]')?.dataset.live;
    if (!action) return;
    try {
      if (action === 'close') { panel.close(); return; }
      if (action === 'devices') { await refreshCameras(); return; }
      if (action === 'start') await startSession();
      if (action === 'pause') { if (controller.getStatus().observing) controller.pauseObservation(); else await controller.wake(); }
      if (action === 'stop') await controller.stop();
      if (action === 'save-ai') { await saveConnection(); $('#live-ai-result').textContent = '连接已保存。点击测试确认实际可用。'; }
      if (action === 'test-ai') {
        await saveConnection(); testAbort?.abort(); testAbort = new AbortController();
        $('[data-live="test-ai"]').disabled = true; $('#live-ai-result').textContent = '正在测试文字连接…';
        const reply = await requestAI({ messages: [{ role: 'user', content: '请只回复：连接成功。' }], signal: testAbort.signal });
        $('#live-ai-result').textContent = `文字连接已响应，${reply.slice(0, 100)}。开始陪伴后可以确认桌面识别结果。`;
      }
    } catch (error) { if (error.name !== 'AbortError') showError(error.message); }
    finally { $('[data-live="test-ai"]').disabled = controller.getStatus().active; }
  });
  panel.querySelector('.live-chat').addEventListener('submit', event => {
    event.preventDefault();
    const text = $('#live-text').value.trim();
    if (!text) return;
    const status = controller.getStatus();
    if (!status.active) { showError('先点“开始陪伴”，然后可以用文字交流。'); return; }
    $('#live-text').value = '';
    void controller.handleText(text).catch(error => showError(error.message));
  });
  panel.addEventListener('click', event => { if (event.target === panel) panel.close(); });
  panel.addEventListener('close', () => { testAbort?.abort(); void stopDirect(); });
  $('#live-camera-select').addEventListener('change', () => {
    saveLiveConfig({ cameraId: $('#live-camera-select').value });
  });
  addEventListener('pagehide', () => { lifecycle++; directAbort?.abort(); testAbort?.abort(); controller.destroy(); navigator.mediaDevices?.removeEventListener('devicechange', refreshCameras); });
  navigator.mediaDevices?.addEventListener('devicechange', refreshCameras);
  loadFields();
  return { controller, startDirect, stopDirect, async open() { await loadFields(); if (!panel.open) panel.showModal(); startSession().catch(err => showError(err.message)); } };
}
