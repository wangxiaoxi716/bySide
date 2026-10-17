import { createLiveController, getLiveConfig, saveLiveConfig, discoverLocalAI } from './live.js';
import { getAIConfig, saveAIConfig, requestAI } from './ai.js';
import { listCameras } from './media.js';
import { esc, icon } from './stage.js';

export function mountLiveUI({ beforeStart = () => {}, onActive = () => {} } = {}) {
  const controller = createLiveController();
  const panel = document.createElement('dialog');
  panel.className = 'live-dialog';
  panel.setAttribute('aria-labelledby', 'live-title');
  panel.innerHTML = `<header class="modal-header"><div><span class="eyebrow">REAL WORLD · 在桌边，听见你</span><h2 id="live-title">桌边实时陪伴</h2></div><button type="button" class="icon-btn" data-live="close" aria-label="收起实时陪伴面板">${icon('close')}</button></header>
  <div class="modal-body"><p class="live-intro">先点一次开始，再叫醒我。你说话，我听；你吃饭，我在。</p>
  <div class="live-status" role="status"><i></i><div><strong id="live-mode">尚未开始</strong><p id="live-message"></p></div></div>
  <p class="live-error" role="alert" id="live-error"></p>
  <p class="live-error" role="status" id="live-voice-warning"></p>
  <div class="live-grid"><div><div class="live-camera"><video id="live-camera" autoplay muted playsinline></video><div id="live-camera-placeholder">${icon('camera',32)}<p>唤醒后，再看看你的这一餐。</p></div><span>USB 摄像头 · 对准实际餐盘</span></div><p class="field-hint" id="live-observation">唤醒后，拍摄的餐盘图片会发送至你配置的 AI 服务。</p></div>
  <div class="live-fields"><label class="field-label" for="live-camera-select">选择摄像头</label><select id="live-camera-select"><option value="">系统默认摄像头</option></select><button type="button" class="text-btn" data-live="devices">刷新设备列表</button>
  <label class="field-label" for="live-interval">观察间隔</label><select id="live-interval"><option value="5">5 秒 · 互动频繁</option><option value="10">10 秒 · 日常陪伴</option><option value="15">15 秒 · 更安静</option></select>
  <label class="field-label" for="live-wake">唤醒词</label><input id="live-wake" maxlength="20" minlength="2" value="芽团芽团"><p class="field-hint">麦克风使用浏览器默认输入设备。语音识别可能经浏览器服务处理；不是离线唤醒。</p></div></div>
  <div class="live-metrics"><span id="live-frames">已拍摄 0 帧</span><span id="live-requests">已请求 0 次</span><span id="live-last">尚未观察</span></div>
  <div class="live-actions"><button type="button" class="btn primary" data-live="start">${icon('mic',17)} 开始陪伴</button><button type="button" class="btn warm" data-live="wake">唤醒芽团</button><button type="button" class="btn secondary" data-live="pause">暂停观察</button><button type="button" class="btn secondary" data-live="stop">结束陪伴</button></div>
  <p class="live-hint">说“暂停观察”关闭摄像头，说“继续观察”恢复，说“结束陪伴”停止。收起面板后仍继续陪伴；朗读时暂不收音。</p>
  <form class="live-chat"><input id="live-text" aria-label="实时陪伴文字输入" placeholder="也可以输入：帮我看看盘子里有什么" maxlength="1000"><button class="btn primary" type="submit">发送</button></form>

  <details class="live-connection"><summary>AI 服务连接</summary><p class="field-hint">本机方案填 /api/chat/completions；API Key 只保存在电脑的 .env 文件。在线私有站点需要另行部署 HTTPS 代理。</p><label class="field-label" for="live-endpoint">代理接口地址</label><input id="live-endpoint" autocomplete="off" placeholder="/api/chat/completions"><label class="field-label" for="live-model">模型（本机代理以 .env 为准）</label><input id="live-model" autocomplete="off" placeholder="deepseek-flash"><div class="button-row"><button type="button" class="btn secondary small" data-live="save-ai">保存连接</button><button type="button" class="btn secondary small" data-live="test-ai">测试文字连接</button></div><p class="field-hint" id="live-ai-result"></p></details>
  <a class="live-guide-link" href="help.html" target="_blank" rel="noopener">${icon('book',17)} 查看接线、DeepSeek 配置和使用说明 ${icon('arrow',16)}</a></div>`;
  document.body.append(panel);
  const $ = selector => panel.querySelector(selector);
  const video = $('#live-camera');
  let checking = false, testAbort = null, wasActive = false;
  const modeNames = { idle: '尚未开始', starting: '准备中', armed: '等你唤醒', observing: '正在观察', thinking: '正在思考', speaking: '正在回应', paused: '观察已暂停', error: '需要处理' };
  function showError(message) { $('#live-error').textContent = message || ''; }
  async function refreshCameras() {
    try {
      const current = $('#live-camera-select').value || getLiveConfig().cameraId;
      const cameras = await listCameras();
      $('#live-camera-select').innerHTML = '<option value="">系统默认摄像头</option>' + cameras.map((c, i) => `<option value="${esc(c.deviceId)}">${esc(c.label || `摄像头 ${i + 1}（允许权限后显示名称）`)}</option>`).join('');
      if (cameras.some(c => c.deviceId === current)) $('#live-camera-select').value = current;
      else if (current) { $('#live-camera-select').insertAdjacentHTML('beforeend', `<option value="${esc(current)}">上次选择的摄像头（待连接）</option>`); $('#live-camera-select').value = current; }
    } catch (error) { showError(error.message); }
  }
  function loadFields() {
    const config = getLiveConfig(), ai = getAIConfig();
    $('#live-interval').value = String(config.intervalSeconds);
    $('#live-wake').value = config.wakePhrase;
    $('#live-endpoint').value = ai.endpoint || (['localhost', '127.0.0.1'].includes(location.hostname) ? '/api/chat/completions' : '');
    $('#live-model').value = ai.model;
    refreshCameras();
  }
  controller.subscribe(status => {
    if(status.active && !wasActive) onActive();
    wasActive = status.active;
    const modeName = status.mode === 'armed' && status.voiceState !== 'listening' ? (status.voiceState === 'unavailable' ? '手动互动可用' : '正在连接语音') : (modeNames[status.mode] || status.mode);
    $('#live-mode').textContent = (status.active && !status.localOwner ? '另一个窗口 · ' : '') + modeName;
    $('#live-message').textContent = status.message;
    $('#live-voice-warning').textContent = status.voiceWarning ? `${status.voiceWarning} 摄像头与 AI 可通过按钮和文字继续使用；恢复语音请结束陪伴后重试。` : '';
    panel.querySelector('.live-status').dataset.mode = status.mode;
    $('#live-camera-placeholder').hidden = Boolean(status.localOwner && video.srcObject);
    $('#live-frames').textContent = `已拍摄 ${status.frameCount} 帧`;
    $('#live-requests').textContent = `已请求 ${status.requestCount} 次`;
    $('#live-last').textContent = status.lastFrameAt ? `最近 ${new Date(status.lastFrameAt).toLocaleTimeString('zh-CN')}` : '尚未观察';
    $('#live-observation').textContent = status.observation || '唤醒后，餐盘图片会发送至你配置的 AI 服务；采样帧不保存到餐食日记。';
    if (status.error) showError(status.error);
    else showError('');
    $('[data-live="start"]').disabled = status.active || checking;
    const startLabel = status.mode === 'starting' ? '正在准备…' : status.mode === 'armed' ? (status.voiceState === 'listening' ? '已就绪 · 等待唤醒' : status.voiceState === 'unavailable' ? '已开启 · 手动互动' : '语音连接中…') : status.active ? '陪伴进行中' : '开始陪伴';
    $('[data-live="start"]').innerHTML = `${icon('mic',17)} ${startLabel}`;
    for (const name of ['wake', 'pause', 'stop']) $('[data-live="' + name + '"]').disabled = !status.active || (status.mode === 'starting' && name !== 'stop');
    for (const el of panel.querySelectorAll('.live-fields input,.live-fields select,[data-live="save-ai"],[data-live="test-ai"],#live-endpoint,#live-model')) el.disabled = status.active;
    document.body.classList.toggle('live-running', status.active);
    const badge = document.querySelector('#projection-live-status');
    if (badge) { badge.textContent = status.active || status.error ? `${modeName}${status.error || status.voiceWarning ? ' · 请打开陪伴面板检查' : ''}` : ''; }
    panel.querySelector('.live-hint').textContent = status.active && status.voiceState === 'unavailable' ? '语音暂不可用：点击“暂停观察”关闭摄像头，点击“唤醒芽团”恢复，点击“结束陪伴”停止。收起面板后仍继续陪伴。' : '说“暂停观察”关闭摄像头，说“继续观察”恢复，说“结束陪伴”停止。收起面板后仍继续陪伴；朗读时暂不收音。';
    document.querySelectorAll('[data-action="voice"],[data-action="meal-voice"]').forEach(button => button.disabled = status.active);
  });
  async function saveConnection() {
    if (controller.getStatus().active) throw new Error('请先结束陪伴，再修改连接。');
    saveAIConfig({ endpoint: $('#live-endpoint').value, model: $('#live-model').value });
    window.dispatchEvent(new Event('ai-config-changed'));
  }
  panel.addEventListener('click', async event => {
    const action = event.target.closest('[data-live]')?.dataset.live;
    if (!action) return;
    try {
      if (action === 'close') { panel.close(); return; }
      if (action === 'devices') { await refreshCameras(); return; }
      if (action === 'start') {
        if (checking) return;
        const wakePhrase = $('#live-wake').value.trim();
        if (wakePhrase.replace(/\s/g, '').length < 2) throw new Error('唤醒词至少需要两个字。');
        saveLiveConfig({ cameraId: $('#live-camera-select').value, intervalSeconds: Number($('#live-interval').value), wakePhrase });
        checking = true; $('[data-live="start"]').disabled = true;
        beforeStart();
        const health = await discoverLocalAI();
        if(health?.configured === false && (!getAIConfig().endpoint || getAIConfig().endpoint === '/api/chat/completions')) throw new Error('本机 AI 尚未配置：在 .env 中填入 DeepSeek Key 后重启服务。请查看下方接线与配置说明。');
        await controller.start(video);
        await refreshCameras();
        await controller.wake();
      }
      if (action === 'wake') await controller.wake();
      if (action === 'pause') controller.pauseObservation();
      if (action === 'stop') controller.stop();
      if (action === 'save-ai') { await saveConnection(); $('#live-ai-result').textContent = '连接已保存。点击测试确认实际可用。'; }
      if (action === 'test-ai') {
        await saveConnection(); testAbort?.abort(); testAbort = new AbortController();
        $('[data-live="test-ai"]').disabled = true; $('#live-ai-result').textContent = '正在测试文字连接…';
        const reply = await requestAI({ messages: [{ role: 'user', content: '请只回复：连接成功。' }], signal: testAbort.signal });
        $('#live-ai-result').textContent = `文字连接已响应：${reply.slice(0, 100)}。视觉请在唤醒后用实际餐盘确认。`;
      }
    } catch (error) { if (error.name !== 'AbortError') showError(error.message); }
    finally { checking = false; $('[data-live="start"]').disabled = controller.getStatus().active; $('[data-live="test-ai"]').disabled = controller.getStatus().active; }
  });
  panel.querySelector('.live-chat').addEventListener('submit', event => {
    event.preventDefault();
    const text = $('#live-text').value.trim();
    if (!text) return;
    const status = controller.getStatus();
    if (!status.active) { showError('先点“开始陪伴”，然后可以用文字交流。'); return; }
    $('#live-text').value = '';
    if (status.mode === 'armed') controller.wake(text);
    else controller.handleText(text);
  });
  panel.addEventListener('click', event => { if (event.target === panel) panel.close(); });
  panel.addEventListener('close', () => { testAbort?.abort(); if (controller.getStatus().active) controller.stop(); });
  addEventListener('pagehide', () => { testAbort?.abort(); controller.destroy(); });
  loadFields();
  return { controller, open() { loadFields(); if (!panel.open) panel.showModal(); } };
}
